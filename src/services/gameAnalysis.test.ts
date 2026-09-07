import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SearchResult } from '@/types/analysis';
import { DEFAULT_THRESHOLDS } from './classification';
import { parsePgn } from './pgnParser';

/**
 * Whole-pass analysis with a scripted engine, so the orchestration — one search
 * per position, evaluations negated into White's point of view, classification,
 * accuracy and cancellation — is verified without running Stockfish.
 */

/** Scores the fake engine returns, in side-to-move point of view, per position index. */
let scriptedScores: number[] = [];
let searchedFens: string[] = [];
/** Every search the pass asked for, in order, with the limits it asked for. */
let searchCalls: Array<{ fen: string; depth: number; moveTimeMs: number | undefined }> = [];
/** Set to force a different best move for a given position index. */
let alternativeBest: Record<number, string> = {};

const GAME = parsePgn('1. e4 e5 2. Nf3 Nc6 *');

vi.mock('./stockfish', () => ({
  Priority: { Batch: 0, Interactive: 10 },
  QUICK_PASS_BUDGET_MS: 5_000,
  QUICK_PASS_MAX_DEPTH: 14,
  ensureEngine: vi.fn(async () => ({})),
  resetEngineForNewGame: vi.fn(async () => {}),
  cancelEngineWork: vi.fn(),
  analysePosition: vi.fn(async (
    fen: string,
    options: { depth: number; moveTimeMs?: number },
  ): Promise<SearchResult> => {
    searchedFens.push(fen);
    searchCalls.push({ fen, depth: options.depth, moveTimeMs: options.moveTimeMs });
    const index = GAME.positions.indexOf(fen);
    const score = scriptedScores[index] ?? 0;
    // Default to playing the move the game actually played, so the engine agrees.
    const played = GAME.moves[index]?.uci ?? 'e2e4';
    const best = alternativeBest[index] ?? played;
    return {
      fen,
      depth: 14,
      bestMove: best,
      ponder: null,
      lines: [
        {
          multipv: 1,
          score: { type: 'cp', value: score },
          depth: 14,
          selDepth: 20,
          pv: [best],
          san: [],
          nodes: 1000,
          nps: 1000,
          timeMs: 10,
        },
      ],
      interrupted: false,
      nodes: 1000,
      nps: 1000,
      timeMs: 10,
    };
  }),
}));

const { AnalysisCancelled, analyseGame, analysisKey, cacheReview, getCachedReview, quickMoveTimeMs } =
  await import('./gameAnalysis');

/** One pass only, so these tests describe the full-depth sweep on its own. */
const ENGINE = {
  depth: 14,
  liveDepth: 20,
  threads: 1,
  hash: 64,
  moveTimeMs: 0,
  multiPv: 1,
  quickPass: false,
};
// Book detection would classify this whole opening as theory; switch it off so the
// loss-based classification is what is under test.
const THRESHOLDS = { ...DEFAULT_THRESHOLDS, bookDepth: 0 };

beforeEach(() => {
  searchedFens = [];
  searchCalls = [];
  alternativeBest = {};
  // Side-to-move scores: +20, −20, +15, +10, +600 → White POV +20, +20, +15, −10, +600.
  // The last step is the one under test: a level position that collapses to +6.00.
  scriptedScores = [20, -20, 15, 10, 600];
  window.localStorage.clear();
});

describe('analyseGame', () => {
  it('searches every position exactly once', async () => {
    await analyseGame({ parsed: GAME, engine: ENGINE, thresholds: THRESHOLDS });
    expect(searchedFens).toHaveLength(GAME.positions.length);
    expect(new Set(searchedFens).size).toBe(GAME.positions.length);
  });

  it('stores evaluations from White’s point of view', async () => {
    const review = await analyseGame({ parsed: GAME, engine: ENGINE, thresholds: THRESHOLDS });
    expect(review.evaluations).toHaveLength(GAME.positions.length);
    expect(review.evaluations[0]).toEqual({ type: 'cp', value: 20 });
    // Position 1 has Black to move and the engine said −20 for Black → +20 for White.
    expect(review.evaluations[1]).toEqual({ type: 'cp', value: 20 });
    expect(review.evaluations[3]).toEqual({ type: 'cp', value: -10 });
    // Position 4 has White to move and the engine said +600 → +600 for White.
    expect(review.evaluations[4]).toEqual({ type: 'cp', value: 600 });
  });

  it('produces one analysis per move, linked to the right positions', async () => {
    const review = await analyseGame({ parsed: GAME, engine: ENGINE, thresholds: THRESHOLDS });
    expect(review.moves).toHaveLength(GAME.moves.length);

    for (const [index, move] of review.moves.entries()) {
      expect(move.ply).toBe(index);
      expect(move.san).toBe(GAME.moves[index].san);
      expect(move.evalBefore).toEqual(review.evaluations[index]);
      expect(move.evalAfter).toEqual(review.evaluations[index + 1]);
      expect(move.explanation.length).toBeGreaterThan(0);
    }
  });

  it('classifies the losing move and leaves the rest alone', async () => {
    const review = await analyseGame({ parsed: GAME, engine: ENGINE, thresholds: THRESHOLDS });
    // Black's 2...Nc6 takes the evaluation from level to +6.00 for White.
    const blunder = review.moves[3];
    expect(blunder.color).toBe('black');
    expect(blunder.centipawnLoss).toBe(610);
    expect(blunder.classification).toBe('blunder');
    expect(review.moves.slice(0, 3).every((move) => move.classification === 'best')).toBe(true);
  });

  it('names the best move and records whether it was played', async () => {
    alternativeBest[3] = 'g8f6';
    const review = await analyseGame({ parsed: GAME, engine: ENGINE, thresholds: THRESHOLDS });
    expect(review.moves[3].bestMove).toBe('g8f6');
    expect(review.moves[3].bestMoveSan).toBe('Nf6');
    expect(review.moves[3].isTopEngineMove).toBe(false);
    expect(review.moves[0].isTopEngineMove).toBe(true);
  });

  it('computes accuracy for both sides', async () => {
    const review = await analyseGame({ parsed: GAME, engine: ENGINE, thresholds: THRESHOLDS });
    expect(review.white.moveCount).toBe(2);
    expect(review.black.moveCount).toBe(2);
    expect(review.white.accuracy).toBeGreaterThan(review.black.accuracy);
    expect(review.black.counts.blunder).toBe(1);
    expect(review.white.counts.blunder).toBe(0);
  });

  it('identifies the opening', async () => {
    const review = await analyseGame({ parsed: GAME, engine: ENGINE, thresholds: THRESHOLDS });
    expect(review.opening?.name).toBe("King's Knight Opening, Normal Variation");
    expect(review.opening?.eco).toBe('C44');
  });

  it('marks opening moves as book when the book depth allows it', async () => {
    const review = await analyseGame({
      parsed: GAME,
      engine: ENGINE,
      thresholds: { ...DEFAULT_THRESHOLDS, bookDepth: 16 },
    });
    expect(review.moves.every((move) => move.classification === 'book')).toBe(true);
    expect(review.moves[0].openingName).toBe("King's Knight Opening, Normal Variation");
  });

  it('reports progress as it goes', async () => {
    const phases: string[] = [];
    const percents: number[] = [];
    await analyseGame({
      parsed: GAME,
      engine: ENGINE,
      thresholds: THRESHOLDS,
      onProgress: (progress) => {
        phases.push(progress.phase);
        percents.push(progress.percent);
      },
    });
    expect(phases[0]).toBe('loading-engine');
    expect(phases.at(-1)).toBe('done');
    expect(percents.at(-1)).toBe(100);
    expect(percents).toEqual([...percents].sort((a, b) => a - b));
  });

  it('publishes partial evaluations while it works, ending with a complete set', async () => {
    const snapshots: number[] = [];
    await analyseGame({
      parsed: GAME,
      engine: ENGINE,
      thresholds: THRESHOLDS,
      onPartial: (evaluations) => snapshots.push(evaluations.filter(Boolean).length),
    });
    // Publication is throttled (see PUBLISH_INTERVAL_MS), so how many land depends
    // on timing — but they only ever grow, and the last one is always the full set.
    expect(snapshots.length).toBeGreaterThan(0);
    expect(snapshots).toEqual([...snapshots].sort((a, b) => a - b));
    expect(snapshots.at(-1)).toBe(GAME.positions.length);
  });

  it('throws AnalysisCancelled when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      analyseGame({ parsed: GAME, engine: ENGINE, thresholds: THRESHOLDS, signal: controller.signal }),
    ).rejects.toBeInstanceOf(AnalysisCancelled);
  });

  it('scores a checkmate without asking the engine', async () => {
    const mated = parsePgn('1. f3 e5 2. g4 Qh4# 0-1');
    scriptedScores = [10, 10, 10, 10, 10];
    const review = await analyseGame({ parsed: mated, engine: ENGINE, thresholds: THRESHOLDS });

    // The final position is terminal, so only the first four are searched.
    expect(searchedFens).toHaveLength(mated.positions.length - 1);
    expect(review.evaluations.at(-1)).toEqual({ type: 'mate', value: -1 });
    expect(review.moves.at(-1)?.evalAfter).toEqual({ type: 'mate', value: -1 });
  });
});

describe('the quick first pass', () => {
  /** Deep enough that a quick pass is worth running before it. */
  const DEEP = { ...ENGINE, depth: 18, quickPass: true };

  it('hands over a complete preliminary review before the full one', async () => {
    const drafts: Array<{ preliminary?: boolean; moves: number; accuracy: number }> = [];
    const final = await analyseGame({
      parsed: GAME,
      engine: DEEP,
      thresholds: THRESHOLDS,
      onPreliminary: (draft) =>
        drafts.push({
          preliminary: draft.preliminary,
          moves: draft.moves.length,
          accuracy: draft.white.accuracy,
        }),
    });

    expect(drafts).toHaveLength(1);
    // "Complete" is the point: every move classified and both accuracies computed,
    // not a partially filled review.
    expect(drafts[0].moves).toBe(GAME.moves.length);
    expect(drafts[0].preliminary).toBe(true);
    expect(drafts[0].accuracy).toBeGreaterThan(0);
    expect(final.preliminary).toBe(false);
  });

  it('sweeps every position twice — once cheaply, once at the configured depth', async () => {
    await analyseGame({ parsed: GAME, engine: DEEP, thresholds: THRESHOLDS });
    expect(searchCalls).toHaveLength(GAME.positions.length * 2);

    const quick = searchCalls.slice(0, GAME.positions.length);
    const full = searchCalls.slice(GAME.positions.length);

    // The quick pass is bounded by the clock, and capped well short of the target.
    expect(quick.every((call) => (call.moveTimeMs ?? 0) > 0)).toBe(true);
    expect(quick.every((call) => call.depth <= 14)).toBe(true);
    // The full pass is exactly what it was before the quick pass existed.
    expect(full.every((call) => call.depth === 18)).toBe(true);
    expect(full.every((call) => call.moveTimeMs === undefined)).toBe(true);
  });

  it('labels each progress report with the sweep it belongs to', async () => {
    const stages: string[] = [];
    await analyseGame({
      parsed: GAME,
      engine: DEEP,
      thresholds: THRESHOLDS,
      onProgress: (progress) => {
        if (progress.phase === 'analyzing') stages.push(progress.stage);
      },
    });
    // Throttling decides how many land; the order they arrive in does not change.
    expect(stages[0]).toBe('quick');
    expect(stages.at(-1)).toBe('full');
    expect(stages.lastIndexOf('quick')).toBeLessThan(stages.indexOf('full'));
  });

  it('is skipped when it is switched off', async () => {
    await analyseGame({ parsed: GAME, engine: { ...DEEP, quickPass: false }, thresholds: THRESHOLDS });
    expect(searchCalls).toHaveLength(GAME.positions.length);
  });

  it('is skipped when the configured depth is no deeper than the quick cap', async () => {
    // Nothing to pre-empt: the "full" pass is already about as fast as the quick one.
    await analyseGame({ parsed: GAME, engine: { ...DEEP, depth: 12 }, thresholds: THRESHOLDS });
    expect(searchCalls).toHaveLength(GAME.positions.length);
  });

  it('is skipped for a game the pool can take in a couple of rounds', async () => {
    await analyseGame({ parsed: GAME, engine: { ...DEEP, threads: 4 }, thresholds: THRESHOLDS });
    expect(searchCalls).toHaveLength(GAME.positions.length);
  });

  it('reaches the same final review as a single-pass run', async () => {
    const twoPass = await analyseGame({ parsed: GAME, engine: DEEP, thresholds: THRESHOLDS });
    searchCalls = [];
    const onePass = await analyseGame({
      parsed: GAME,
      engine: { ...DEEP, quickPass: false },
      thresholds: THRESHOLDS,
    });

    expect(twoPass.evaluations).toEqual(onePass.evaluations);
    expect(twoPass.moves.map((move) => move.classification)).toEqual(
      onePass.moves.map((move) => move.classification),
    );
    expect(twoPass.white.accuracy).toBe(onePass.white.accuracy);
  });
});

describe('quickMoveTimeMs', () => {
  it('spends the budget across the game, wider pools taking longer per position', () => {
    // 100 positions, 4 at a time, 5s budget → 25 rounds of 200ms, less overhead.
    expect(quickMoveTimeMs(100, 4, 5_000)).toBe(165);
    expect(quickMoveTimeMs(100, 8, 5_000)).toBe(365);
  });

  it('gives the positions still to do whatever is still left of the budget', () => {
    // Halfway through with more than half the time gone: the rest gets less each.
    expect(quickMoveTimeMs(50, 4, 2_000)).toBeLessThan(quickMoveTimeMs(50, 4, 3_000));
  });

  it('clamps rather than producing a useless or wasteful search', () => {
    // A very long game would otherwise get a few milliseconds per position.
    expect(quickMoveTimeMs(5_000, 1, 5_000)).toBe(30);
    // Out of budget entirely: still ask for the floor rather than nothing at all,
    // since `moveTimeMs: 0` would mean "no cap" and run to full depth.
    expect(quickMoveTimeMs(50, 4, 0)).toBe(30);
    // A short game would otherwise be allowed seconds per position.
    expect(quickMoveTimeMs(4, 8, 5_000)).toBe(400);
  });
});

describe('analysisKey and the review cache', () => {
  it('is stable for the same inputs', () => {
    const a = analysisKey('pgn text', ENGINE, DEFAULT_THRESHOLDS);
    const b = analysisKey('pgn text', ENGINE, DEFAULT_THRESHOLDS);
    expect(a).toBe(b);
  });

  it('changes when the game, the depth or the thresholds change', () => {
    const base = analysisKey('pgn text', ENGINE, DEFAULT_THRESHOLDS);
    expect(analysisKey('other pgn', ENGINE, DEFAULT_THRESHOLDS)).not.toBe(base);
    expect(analysisKey('pgn text', { ...ENGINE, depth: 18 }, DEFAULT_THRESHOLDS)).not.toBe(base);
    expect(
      analysisKey('pgn text', ENGINE, { ...DEFAULT_THRESHOLDS, blunder: 3 }),
    ).not.toBe(base);
  });

  it('round-trips a review through the cache', async () => {
    const review = await analyseGame({ parsed: GAME, engine: ENGINE, thresholds: THRESHOLDS });
    const key = analysisKey('pgn text', ENGINE, THRESHOLDS);

    expect(getCachedReview(key)).toBeNull();
    cacheReview(key, { ...review, key });

    const restored = getCachedReview(key);
    expect(restored?.moves).toHaveLength(review.moves.length);
    expect(restored?.white.accuracy).toBe(review.white.accuracy);
    expect(restored?.evaluations[3]).toEqual({ type: 'cp', value: -10 });
  });
});
