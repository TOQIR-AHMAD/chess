import { Chess } from 'chess.js';
import type {
  AnalysisProgress,
  AnalysisStage,
  ClassificationThresholds,
  EngineConfig,
  GameReview,
  MoveAnalysis,
  Score,
  SearchResult,
} from '@/types/analysis';
import type { ParsedGame } from '@/types/game';
import { sideToMove, uciLineToSan, uciToSan } from '@/utils/chess';
import { terminalScoreInGame, toWhitePov } from '@/utils/evaluation';
import { CLASSIFICATION_ORDER, classifyMove, computeAccuracy, explainMove } from './classification';
import { bookDepthFor, detectOpening } from './openings';
import { caches } from './cache';
import {
  Priority,
  QUICK_PASS_BUDGET_MS,
  QUICK_PASS_MAX_DEPTH,
  analysePosition,
  cancelEngineWork,
  ensureEngine,
  resetEngineForNewGame,
} from './stockfish';
import { EngineAbortError } from '@/workers/stockfishWorker';

/**
 * Full-game analysis.
 *
 * Each pass is a *single sweep*: position `i` is searched once, and its result
 * supplies both the "evaluation before move i" and — after negating into White's
 * point of view — the "evaluation after move i-1". Analysing N moves therefore
 * costs N+1 searches rather than 2N.
 *
 * Terminal positions are scored without the engine, and positions still inside the
 * opening book are searched shallower, because their evaluation is not in doubt.
 *
 * ## Two passes, not one
 *
 * A depth-18 sweep is the evaluation this app is calibrated against, and it runs
 * into minutes. Waiting minutes for the *first* thing to appear is the wrong
 * trade, because most of what a review says — where the game turned, which moves
 * were blunders, roughly how accurate each side was — is already legible from a
 * far shallower look.
 *
 * So the sweep runs twice over the same arrays:
 *
 *   1. a **quick pass**, capped by a wall-clock budget (`QUICK_PASS_BUDGET_MS`)
 *      rather than a depth, which yields a complete review in about five seconds;
 *   2. the **full pass** at the configured depth, which overwrites every entry and
 *      produces the authoritative review — bit for bit what this function returned
 *      before the quick pass existed.
 *
 * The second pass starts from the first one's numbers, so the graph and the
 * evaluation bar never blank out and never go backwards while it refines. Only
 * the full pass's result is cached; the quick one is explicitly `preliminary`.
 */

/**
 * Per-position time cap for the quick pass: the time still available, spread over
 * the positions still to do, `width` of them at a time.
 *
 * Called before *every* search rather than once up front, with what is actually
 * left of the budget — so the pass steers itself back onto the clock instead of
 * trusting an estimate made before a single position had been searched. That
 * matters because the estimate is systematically optimistic: a `movetime` cap is
 * a floor the engine overshoots to finish its iteration, the live search of the
 * position on screen preempts a slot for as long as it likes, and each result
 * still has to be rendered into SAN. `QUICK_OVERHEAD_MS` is a first guess at that
 * gap; the feedback loop is what actually holds the budget.
 */
export function quickMoveTimeMs(
  remaining: number,
  width: number,
  budgetMs = QUICK_PASS_BUDGET_MS,
): number {
  const perPosition = (budgetMs * Math.max(1, width)) / Math.max(1, remaining) - QUICK_OVERHEAD_MS;
  return Math.round(Math.max(QUICK_MIN_MOVETIME_MS, Math.min(QUICK_MAX_MOVETIME_MS, perPosition)));
}

/** Wall-clock cost of a search beyond the time the engine is asked to spend, per position. */
const QUICK_OVERHEAD_MS = 35;
/** Shortest gap between two progress/partial publications from a sweep. */
const PUBLISH_INTERVAL_MS = 150;

/**
 * Searching is not the last thing between the user and a review: `buildReview`
 * still has to classify every move and replay the engine's lines into SAN, which
 * is chess.js work proportional to the game's length (measured at roughly this
 * many milliseconds per move). The sweep is handed the budget less that estimate,
 * so `QUICK_PASS_BUDGET_MS` measures what it claims to — time to a review on
 * screen — instead of stopping the clock one step early.
 */
const QUICK_BUILD_MS_PER_MOVE = 9;

/** The sweep's share of the quick-pass budget, once the build is paid for. */
function quickSweepBudgetMs(total: number, budgetMs = QUICK_PASS_BUDGET_MS): number {
  const build = Math.max(150, Math.min(1_500, total * QUICK_BUILD_MS_PER_MOVE));
  return Math.max(1_000, budgetMs - build);
}
/** Below this a search returns lines too thin to classify from; above it, a short game would idle. */
const QUICK_MIN_MOVETIME_MS = 30;
const QUICK_MAX_MOVETIME_MS = 400;

/**
 * Bumped when the analysis output shape or algorithm changes, so cached reviews
 * produced by an older build are not served for a newer one.
 * 4 — opening book matches by position, which changes which moves count as book.
 * 5 — opening names drop the move sequence Chess.com appends to the URL slug.
 * 6 — sacrifices are measured once the engine's line has settled, so ordinary
 *     exchanges no longer read as material offered up (and as brilliancies).
 * 7 — a draw by repetition scores 0.00, and the only legal move is "forced".
 * 9 — brilliancies follow Chess.com's stated rules: the *alternative* decides
 *     whether the game was already won (and only a completely won one counts),
 *     and the mover's rating sets how strictly the move is graded. Evaluations
 *     now come from single-threaded searches, so they no longer vary run to run.
 */
const ANALYSIS_VERSION = 9;

export interface AnalyseGameOptions {
  parsed: ParsedGame;
  engine: EngineConfig;
  thresholds: ClassificationThresholds;
  signal?: AbortSignal;
  onProgress?: (progress: AnalysisProgress) => void;
  /** Called as evaluations land, so the graph and bar can fill in progressively. */
  onPartial?: (evaluations: Array<Score | null>, moves: MoveAnalysis[]) => void;
  /**
   * The quick pass's complete-but-provisional review, delivered as soon as it is
   * ready. The promise still resolves later with the full-depth one.
   */
  onPreliminary?: (review: GameReview) => void;
}

export class AnalysisCancelled extends Error {
  constructor() {
    super('Analysis cancelled');
    this.name = 'AnalysisCancelled';
  }
}

/** Stable cache key for a game + engine configuration. */
export function analysisKey(pgn: string, engine: EngineConfig, thresholds: ClassificationThresholds): string {
  const payload = JSON.stringify({
    v: ANALYSIS_VERSION,
    d: engine.depth,
    m: engine.multiPv,
    t: engine.moveTimeMs,
    th: thresholds,
    p: hashString(pgn),
  });
  return hashString(payload);
}

/** FNV-1a — small, fast and stable across reloads. */
function hashString(value: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

export function getCachedReview(key: string): GameReview | null {
  return (caches.analysis.get(key) as GameReview | null) ?? null;
}

export function cacheReview(key: string, review: GameReview): void {
  caches.analysis.set(key, review);
}

/** PGN `WhiteElo`/`BlackElo`, or null when the game carries no rating. */
function parseRating(value: string | undefined): number | null {
  if (!value) return null;
  const rating = Number.parseInt(value, 10);
  return Number.isFinite(rating) && rating > 0 ? rating : null;
}

function legalMoveCount(fen: string): number {
  const chess = new Chess();
  try {
    chess.load(fen);
    return chess.moves().length;
  } catch {
    return 0;
  }
}

/** Evaluate a whole game, reporting progress as it goes. */
export async function analyseGame(options: AnalyseGameOptions): Promise<GameReview> {
  const { parsed, engine, thresholds, signal } = options;
  const positions = parsed.positions;
  const total = positions.length;

  /** Which sweep is running; carried on every progress report. */
  let stage: AnalysisStage = 'full';

  const report = (patch: Partial<AnalysisProgress>) => {
    options.onProgress?.({
      phase: 'analyzing',
      stage,
      completed: 0,
      total,
      percent: 0,
      message: '',
      enginePercent: null,
      error: null,
      ...patch,
    });
  };

  /**
   * A quick pass only pays for itself when the full one is going to be slow
   * enough to be worth pre-empting. If the configured depth is no deeper than the
   * quick cap, or the pool can take the whole game in one or two rounds, the full
   * pass is already about as fast as the quick one would be.
   */
  const width = Math.max(1, Math.min(engine.threads, total));
  const wantsQuickPass = engine.quickPass && engine.depth > QUICK_PASS_MAX_DEPTH && total > width * 2;
  if (wantsQuickPass) stage = 'quick';

  report({ phase: 'loading-engine', message: 'Starting the engine…', total });
  await ensureEngine(engine);
  await resetEngineForNewGame();
  if (signal?.aborted) throw new AnalysisCancelled();

  const sanMoves = parsed.moves.map((move) => move.san);
  const bookPlies = bookDepthFor(sanMoves, thresholds.bookDepth);
  const opening = detectOpening(sanMoves, parsed.headers);
  // Chess.com grades brilliancies more leniently for newer players, so the mover's
  // rating is part of classifying their move.
  const ratings = {
    white: parseRating(parsed.headers.WhiteElo),
    black: parseRating(parsed.headers.BlackElo),
  };

  const evaluations: Array<Score | null> = new Array(total).fill(null);
  const searches: Array<SearchResult | null> = new Array(total).fill(null);

  /**
   * One sweep over every position, at a given depth and optional time cap.
   *
   * Writes into the shared `evaluations` / `searches` arrays, so a later sweep
   * simply overwrites what an earlier one put there. Anything it has not reached
   * yet still holds the earlier pass's value, which is what keeps the graph whole
   * while the full pass refines it.
   */
  const sweep = async (pass: {
    depth: number;
    /** Fixed per-position cap. Ignored when `budgetMs` is set. */
    moveTimeMs: number;
    /** Total wall-clock allowance for the whole sweep; makes the cap adaptive. */
    budgetMs?: number;
    verb: string;
  }): Promise<void> => {
    const startedAt = Date.now();

    /** Evaluate one position, filling `evaluations[i]` and `searches[i]`. */
    const analyseIndex = async (i: number, claimed: number): Promise<void> => {
      const fen = positions[i];
      const terminal = terminalScoreInGame(positions, i);
      if (terminal) {
        evaluations[i] = terminal;
        return;
      }

      // Book positions are not in doubt; a shallow look keeps the graph honest
      // without spending the user's time on settled theory.
      const depth = i < bookPlies ? Math.min(pass.depth, 10) : pass.depth;
      const moveTimeMs = pass.budgetMs
        ? quickMoveTimeMs(total - claimed, width, Math.max(0, pass.budgetMs - (Date.now() - startedAt)))
        : pass.moveTimeMs;
      const search = {
        depth,
        multiPv: engine.multiPv,
        moveTimeMs: moveTimeMs || undefined,
        priority: Priority.Batch,
        signal,
      };

      try {
        const result = await analysePosition(fen, search);

        // A preempted search still carries usable (if shallower) lines; retry only
        // when it produced nothing at all.
        if (result.lines.length === 0 && result.interrupted && !signal?.aborted) {
          searches[i] = await analysePosition(fen, search);
        } else {
          searches[i] = result;
        }

        const top = searches[i]?.lines[0];
        evaluations[i] = top ? toWhitePov(top.score, sideToMove(fen)) : { type: 'cp', value: 0 };
      } catch (error) {
        if (error instanceof EngineAbortError || signal?.aborted) throw new AnalysisCancelled();
        throw error;
      }
    };

    /*
     * Feed the engine pool from several positions at once.
     *
     * The positions in a game are independent, so this is pure throughput: `width`
     * of them are in flight at any moment and each worker claims the next index as
     * it frees up. Indices are handed out in order, so the evaluation graph still
     * fills in roughly left to right.
     *
     * One index at a time, deliberately. Claiming contiguous *blocks* to keep each
     * engine's transposition table warm across neighbouring positions sounds better
     * and measures worse — 107s against 83s on a 54-move game — because the opening
     * is far cheaper than the middlegame, so fixed blocks leave workers idling at
     * the ends while one grinds through a hard stretch. Load balance beats locality
     * here.
     */
    let nextIndex = 0;
    let completed = 0;
    let failure: unknown = null;
    let lastPublished = 0;

    const worker = async (): Promise<void> => {
      while (failure === null) {
        if (signal?.aborted) throw new AnalysisCancelled();
        // No await between reading and advancing, so no two workers get the same index.
        const i = nextIndex;
        if (i >= total) return;
        nextIndex += 1;

        try {
          await analyseIndex(i, nextIndex);
        } catch (error) {
          // Stop the sibling workers too, rather than letting them run on against a
          // review that is already going to be thrown away.
          failure = error;
          throw error;
        }

        completed += 1;

        /*
         * Publishing is throttled, and that is a throughput decision rather than a
         * cosmetic one. Every publication re-renders the move list, the evaluation
         * graph and the analysis panel; at a dozen positions a second that work
         * lands on the same main thread that has to receive and parse every `info`
         * line the pool emits, so the renders end up delaying the searches they
         * are reporting on. The last position of a sweep always publishes, so the
         * final state is exact whatever the timing.
         */
        const now = Date.now();
        if (completed === total || now - lastPublished >= PUBLISH_INTERVAL_MS) {
          lastPublished = now;
          report({
            phase: 'analyzing',
            completed,
            total,
            percent: Math.round((completed / total) * 100),
            message:
              completed < total
                ? `${pass.verb} move ${Math.min(completed, parsed.moves.length)} of ${parsed.moves.length}`
                : 'Finishing up',
          });
          options.onPartial?.(evaluations.slice(), []);
        }

        // Yield to the event loop so the UI stays responsive between positions.
        await Promise.resolve();
      }
    };

    await Promise.all(Array.from({ length: width }, () => worker()));
    if (failure !== null) throw failure;
  };

  /** Turn the current contents of `evaluations` / `searches` into a review. */
  const buildReview = (used: EngineConfig, preliminary: boolean): GameReview => {
    const moves: MoveAnalysis[] = parsed.moves.map((move, index) => {
      const fenBefore = positions[index];
      const before = evaluations[index] ?? { type: 'cp' as const, value: 0 };
      const after = evaluations[index + 1] ?? { type: 'cp' as const, value: 0 };
      const search = searches[index];
      const turn = sideToMove(fenBefore);

      const bestLine = search?.lines[0];
      const bestMove = bestLine?.pv[0] ?? search?.bestMove ?? null;
      const secondLine = search?.lines[1];
      const secondBestEval = secondLine ? toWhitePov(secondLine.score, turn) : null;

      const classification = classifyMove({
        mover: move.color,
        san: move.san,
        uci: move.uci,
        fenBefore,
        evalBefore: before,
        evalAfter: after,
        bestMove,
        bestLineUci: bestLine?.pv ?? [],
        secondBestEval,
        isBook: index < bookPlies,
        legalMoveCount: legalMoveCount(fenBefore),
        moverRating: ratings[move.color],
        thresholds,
      });

      const bestLineSan = bestLine ? uciLineToSan(fenBefore, bestLine.pv, 10) : [];
      const playedLineSan = searches[index + 1]
        ? uciLineToSan(positions[index + 1], searches[index + 1]?.lines[0]?.pv ?? [], 8)
        : [];

      const partial: Omit<MoveAnalysis, 'explanation'> = {
        ply: move.ply,
        moveNumber: move.moveNumber,
        color: move.color,
        san: move.san,
        uci: move.uci,
        evalBefore: before,
        evalAfter: after,
        centipawnLoss: classification.centipawnLoss,
        winProbLoss: classification.winProbLoss,
        expectedPointsLoss: classification.expectedPointsLoss,
        accuracy: classification.accuracy,
        classification: classification.classification,
        bestMove,
        bestMoveSan: bestMove ? uciToSan(fenBefore, bestMove) : null,
        bestLine: bestLineSan,
        playedLine: playedLineSan,
        isTopEngineMove: classification.isTopEngineMove,
        depth: search?.depth ?? 0,
        openingName: index < bookPlies ? (opening?.name ?? undefined) : undefined,
        eco: index < bookPlies ? (opening?.eco ?? undefined) : undefined,
        sacrificedMaterial: classification.sacrificedMaterial,
      };

      return {
        ...partial,
        explanation: explainMove(partial, {
          fenBefore,
          bestLineSan,
          openingName: opening?.name ?? null,
        }),
      };
    });

    return {
      key: '',
      engine: used,
      thresholds,
      moves,
      evaluations: evaluations.map((score) => score ?? { type: 'cp', value: 0 }),
      white: computeAccuracy(moves, 'white'),
      black: computeAccuracy(moves, 'black'),
      opening: opening ? { name: opening.name, eco: opening.eco, url: opening.url } : null,
      completedAt: Date.now(),
      preliminary,
    };
  };

  /*
   * The quick pass. Time-capped rather than depth-capped, so it costs about
   * `QUICK_PASS_BUDGET_MS` whatever the machine — see `quickMoveTimeMs`. Its
   * output is a complete review, handed over the moment it exists.
   */
  if (wantsQuickPass) {
    const sweepBudget = quickSweepBudgetMs(total);
    await sweep({
      depth: QUICK_PASS_MAX_DEPTH,
      moveTimeMs: 0,
      budgetMs: sweepBudget,
      verb: 'Reviewing',
    });
    if (signal?.aborted) throw new AnalysisCancelled();
    // Recorded against the cap the *first* position was given: the pass adapts as
    // it goes, so there is no single move time, only the one it aimed for.
    const quick: EngineConfig = {
      ...engine,
      depth: QUICK_PASS_MAX_DEPTH,
      moveTimeMs: quickMoveTimeMs(total, width, sweepBudget),
    };
    options.onPreliminary?.(buildReview(quick, true));
  }

  // The full pass, at the configured depth and with no time cap: the evaluation
  // the classification thresholds are calibrated against, and the only one cached.
  stage = 'full';
  report({
    phase: 'analyzing',
    completed: 0,
    total,
    percent: 0,
    message: wantsQuickPass ? `Refining at depth ${engine.depth}…` : 'Preparing…',
  });
  await sweep({ depth: engine.depth, moveTimeMs: engine.moveTimeMs, verb: wantsQuickPass ? 'Refining' : 'Analysing' });

  const review = buildReview(engine, false);
  report({ phase: 'done', completed: total, total, percent: 100, message: 'Analysis complete' });
  return review;
}

/** Abort any in-flight engine work (used when navigating away from a game). */
export function cancelAnalysis(): void {
  cancelEngineWork();
}

/** Total move-quality tally across both sides, for the review dashboard. */
export function combinedCounts(review: GameReview): Array<{ key: string; label: string; white: number; black: number }> {
  return CLASSIFICATION_ORDER.map((key) => ({
    key,
    label: key,
    white: review.white.counts[key],
    black: review.black.counts[key],
  }));
}
