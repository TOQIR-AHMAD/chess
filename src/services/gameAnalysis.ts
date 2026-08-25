import { Chess } from 'chess.js';
import type {
  AnalysisProgress,
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
import { Priority, analysePosition, cancelEngineWork, ensureEngine, resetEngineForNewGame } from './stockfish';
import { EngineAbortError } from '@/workers/stockfishWorker';

/**
 * Full-game analysis.
 *
 * The pass is *single sweep*: position `i` is searched once, and its result
 * supplies both the "evaluation before move i" and — after negating into White's
 * point of view — the "evaluation after move i-1". Analysing N moves therefore
 * costs N+1 searches rather than 2N.
 *
 * Terminal positions are scored without the engine, and positions still inside the
 * opening book are searched shallower, because their evaluation is not in doubt.
 */

/**
 * Bumped when the analysis output shape or algorithm changes, so cached reviews
 * produced by an older build are not served for a newer one.
 * 4 — opening book matches by position, which changes which moves count as book.
 * 5 — opening names drop the move sequence Chess.com appends to the URL slug.
 * 6 — sacrifices are measured once the engine's line has settled, so ordinary
 *     exchanges no longer read as material offered up (and as brilliancies).
 * 7 — a draw by repetition scores 0.00, and the only legal move is "forced".
 */
const ANALYSIS_VERSION = 7;

export interface AnalyseGameOptions {
  parsed: ParsedGame;
  engine: EngineConfig;
  thresholds: ClassificationThresholds;
  signal?: AbortSignal;
  onProgress?: (progress: AnalysisProgress) => void;
  /** Called as evaluations land, so the graph and bar can fill in progressively. */
  onPartial?: (evaluations: Array<Score | null>, moves: MoveAnalysis[]) => void;
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

  const report = (patch: Partial<AnalysisProgress>) => {
    options.onProgress?.({
      phase: 'analyzing',
      completed: 0,
      total,
      percent: 0,
      message: '',
      enginePercent: null,
      error: null,
      ...patch,
    });
  };

  report({ phase: 'loading-engine', message: 'Starting the engine…', total });
  await ensureEngine(engine);
  await resetEngineForNewGame();
  if (signal?.aborted) throw new AnalysisCancelled();

  const sanMoves = parsed.moves.map((move) => move.san);
  const bookPlies = bookDepthFor(sanMoves, thresholds.bookDepth);
  const opening = detectOpening(sanMoves, parsed.headers);

  const evaluations: Array<Score | null> = new Array(total).fill(null);
  const searches: Array<SearchResult | null> = new Array(total).fill(null);

  for (let i = 0; i < total; i += 1) {
    if (signal?.aborted) throw new AnalysisCancelled();

    const fen = positions[i];
    const terminal = terminalScoreInGame(positions, i);
    if (terminal) {
      evaluations[i] = terminal;
    } else {
      // Book positions are not in doubt; a shallow look keeps the graph honest
      // without spending the user's time on settled theory.
      const depth = i < bookPlies ? Math.min(engine.depth, 10) : engine.depth;
      try {
        const result = await analysePosition(fen, {
          depth,
          multiPv: engine.multiPv,
          moveTimeMs: engine.moveTimeMs || undefined,
          priority: Priority.Batch,
          signal,
        });

        // A preempted search still carries usable (if shallower) lines; retry only
        // when it produced nothing at all.
        if (result.lines.length === 0 && result.interrupted && !signal?.aborted) {
          const retry = await analysePosition(fen, {
            depth,
            multiPv: engine.multiPv,
            moveTimeMs: engine.moveTimeMs || undefined,
            priority: Priority.Batch,
            signal,
          });
          searches[i] = retry;
        } else {
          searches[i] = result;
        }

        const top = searches[i]?.lines[0];
        evaluations[i] = top ? toWhitePov(top.score, sideToMove(fen)) : { type: 'cp', value: 0 };
      } catch (error) {
        if (error instanceof EngineAbortError || signal?.aborted) throw new AnalysisCancelled();
        throw error;
      }
    }

    const completed = i + 1;
    report({
      phase: 'analyzing',
      completed,
      total,
      percent: Math.round((completed / total) * 100),
      message:
        i < total - 1
          ? `Analysing move ${Math.min(i + 1, parsed.moves.length)} of ${parsed.moves.length}`
          : 'Finishing up',
    });
    options.onPartial?.(evaluations.slice(), []);

    // Yield to the event loop so the UI stays responsive between positions.
    await Promise.resolve();
  }

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

  const review: GameReview = {
    key: '',
    engine,
    thresholds,
    moves,
    evaluations: evaluations.map((score) => score ?? { type: 'cp', value: 0 }),
    white: computeAccuracy(moves, 'white'),
    black: computeAccuracy(moves, 'black'),
    opening: opening ? { name: opening.name, eco: opening.eco, url: opening.url } : null,
    completedAt: Date.now(),
  };

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
