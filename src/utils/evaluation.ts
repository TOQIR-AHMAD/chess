import type { Score } from '@/types/analysis';
import { repetitionCount, sideToMove, terminalState } from './chess';

/**
 * Evaluation maths.
 *
 * Two conventions are used and it is important to keep them apart:
 *  - The UCI protocol reports scores **relative to the side to move**.
 *  - Everything stored in application state is **relative to White**
 *    (positive = good for White), because that is what a human reads on an
 *    evaluation bar or graph.
 *
 * `toWhitePov` / `toMoverPov` convert between the two.
 */

/** Centipawn magnitude used to represent a forced mate in the numeric domain. */
export const MATE_CP = 100_000;

/** Losses beyond this many centipawns are clamped; keeps blowouts from skewing stats. */
export const EVAL_CLAMP_CP = 1000;

export function isMate(score: Score): boolean {
  return score.type === 'mate';
}

/** Flip a side-to-move relative score into White's point of view. */
export function toWhitePov(score: Score, sideToMove: 'w' | 'b'): Score {
  if (sideToMove === 'w') return { ...score };
  return { type: score.type, value: -score.value };
}

/** Flip a White-relative score into the given mover's point of view. */
export function toMoverPov(score: Score, mover: 'w' | 'b'): Score {
  return toWhitePov(score, mover);
}

/**
 * Project a score onto a single centipawn axis.
 * Mate scores map to a huge value that still orders by distance-to-mate,
 * so "mate in 1" ranks above "mate in 6".
 */
export function scoreToCp(score: Score): number {
  if (score.type === 'cp') return score.value;
  if (score.value === 0) return 0;
  const sign = score.value > 0 ? 1 : -1;
  return sign * (MATE_CP - Math.min(Math.abs(score.value), 200) * 100);
}

/** Centipawn value clamped into a sane human range, used for loss arithmetic. */
export function clampedCp(score: Score, clamp = EVAL_CLAMP_CP): number {
  const cp = scoreToCp(score);
  return Math.max(-clamp, Math.min(clamp, cp));
}

/**
 * Win probability for the side the score belongs to, expressed as 0-100.
 *
 * Uses the logistic model published by the Lichess project
 * (`50 + 50 * (2 / (1 + exp(-0.00368208 * cp)) - 1)`), which is fitted against a
 * large corpus of real games. This is *not* Chess.com's model.
 */
export function winProbability(score: Score): number {
  if (score.type === 'mate') {
    if (score.value === 0) return 0; // side to move has been mated
    return score.value > 0 ? 100 : 0;
  }
  const cp = Math.max(-EVAL_CLAMP_CP, Math.min(EVAL_CLAMP_CP, score.value));
  const raw = 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * cp)) - 1);
  return Math.max(0, Math.min(100, raw));
}

/**
 * Steepness of the expected-points curve used for move classification.
 *
 * Sharper than `winProbability`'s Lichess-fitted constant. That model is fitted to
 * *outcomes* across a huge rating range, so it still gives the side a pawn down a
 * generous share of the pie; classification needs the opposite bias — once a game
 * is decided, further evaluation drops should stop registering as new errors.
 *
 * The value is a fit, not a guess: it and the bands in `DEFAULT_THRESHOLDS` were
 * grid-searched against Chess.com's own labels for a reviewed game, scored on the
 * plies where the two can meaningfully be compared. The optimum is a broad plateau
 * — thousands of parameter sets score within one label of each other — so these are
 * the roundest values in the middle of it rather than the sharp maximum, which
 * would be fitting noise.
 */
export const EXPECTED_POINTS_K = 0.005;

/**
 * Expected points (0-100) for the side the score belongs to.
 *
 * This is the axis every move classification is measured on: a move is judged by
 * how many expected points it gave away, not by how many centipawns. The two agree
 * around equality and diverge exactly where they should — 0.5 pawns thrown away at
 * equality is a real error, the same 0.5 pawns thrown away while eight pawns down
 * is noise.
 */
export function expectedPoints(score: Score): number {
  if (score.type === 'mate') {
    if (score.value === 0) return 0; // side to move has been mated
    return score.value > 0 ? 100 : 0;
  }
  const cp = Math.max(-EVAL_CLAMP_CP, Math.min(EVAL_CLAMP_CP, score.value));
  const raw = 50 + 50 * (2 / (1 + Math.exp(-EXPECTED_POINTS_K * cp)) - 1);
  return Math.max(0, Math.min(100, raw));
}

/** Expected points given away by the mover, in points (0-100). */
export function expectedPointsLoss(before: Score, after: Score, mover: 'w' | 'b'): number {
  const b = expectedPoints(toMoverPov(before, mover));
  const a = expectedPoints(toMoverPov(after, mover));
  return Math.max(0, b - a);
}

/**
 * Accuracy for a single move, derived from how much win probability it gave away.
 *
 * `103.1668 * exp(-0.04354 * drop) - 3.1669`, clamped to [0, 100] — an exponential
 * decay tuned so that a 0-point drop scores 100 and a ~10-point drop scores ~65.
 * Documented in README.md; it is our own configuration of a public model and is
 * deliberately not a reproduction of any proprietary formula.
 */
export function moveAccuracy(winBefore: number, winAfter: number): number {
  const drop = Math.max(0, winBefore - winAfter);
  const raw = 103.1668 * Math.exp(-0.04354 * drop) - 3.1669;
  return Math.max(0, Math.min(100, raw));
}

/**
 * Format a White-relative score the way it is shown next to the board.
 * `+0.72`, `-1.35`, `M5` (White mates), `-M3` (Black mates).
 */
export function formatEval(score: Score | null | undefined, options: { compact?: boolean } = {}): string {
  if (!score) return '—';
  if (score.type === 'mate') {
    if (score.value === 0) return '#';
    const n = Math.abs(score.value);
    return score.value > 0 ? `M${n}` : `-M${n}`;
  }
  const pawns = score.value / 100;
  if (options.compact) {
    const rounded = Math.abs(pawns) >= 10 ? pawns.toFixed(0) : pawns.toFixed(1);
    return pawns > 0 ? `+${rounded}` : rounded;
  }
  const rounded = pawns.toFixed(2);
  return pawns > 0 ? `+${rounded}` : rounded;
}

/** Short label used inside the evaluation bar. */
export function formatEvalBarLabel(score: Score | null | undefined): string {
  if (!score) return '';
  if (score.type === 'mate') {
    if (score.value === 0) return '#';
    return `M${Math.abs(score.value)}`;
  }
  const pawns = Math.abs(score.value) / 100;
  return pawns >= 10 ? pawns.toFixed(0) : pawns.toFixed(1);
}

/**
 * Portion of the evaluation bar (0-100) that White should occupy.
 * Uses win probability so the bar moves the way a player intuits it: quickly
 * around equality, slowly once the game is decided.
 */
export function evalBarPercent(score: Score | null | undefined): number {
  if (!score) return 50;
  if (score.type === 'mate') return score.value > 0 ? 100 : score.value === 0 ? 0 : 0;
  const prob = winProbability(score);
  // Keep a sliver of the losing side visible so the bar never fully collapses.
  return Math.max(2, Math.min(98, prob));
}

/** Plain-language description of who stands better. */
export function describeAdvantage(score: Score | null | undefined): string {
  if (!score) return 'Not analysed yet';
  if (score.type === 'mate') {
    if (score.value === 0) return 'Checkmate';
    const side = score.value > 0 ? 'White' : 'Black';
    return `${side} mates in ${Math.abs(score.value)}`;
  }
  const cp = Math.abs(score.value);
  const side = score.value > 0 ? 'White' : 'Black';
  if (cp < 30) return 'Equal position';
  if (cp < 90) return `${side} is slightly better`;
  if (cp < 200) return `${side} is clearly better`;
  if (cp < 500) return `${side} has a winning advantage`;
  return `${side} is completely winning`;
}

/**
 * Score of a finished position, already in White's point of view — no engine
 * search required (and none is possible: engines answer `bestmove (none)` here).
 *
 * A delivered checkmate is stored as mate-in-1 for the winner. Mate distance zero
 * cannot carry a sign in a single number, and the UI shows the game result rather
 * than a mate distance once `terminalState` reports the game is over.
 */
export function terminalScore(fen: string): Score | null {
  const state = terminalState(fen);
  if (state === null) return null;
  if (state !== 'checkmate') return { type: 'cp', value: 0 };
  // The side to move has been mated, so the other side is the winner.
  return { type: 'mate', value: sideToMove(fen) === 'w' ? -1 : 1 };
}

/**
 * Score of a position in the context of the game that reached it.
 *
 * Identical to `terminalScore` except that it can also see a draw by repetition,
 * which no single FEN can show. A game that ends by repetition is a draw however
 * lopsided the material is, and the evaluation has to say so: showing "Black is
 * winning by six pawns" under a drawn game is the graph contradicting the result.
 */
export function terminalScoreInGame(positions: string[], index: number): Score | null {
  const fen = positions[index];
  if (!fen) return null;
  const direct = terminalScore(fen);
  if (direct) return direct;
  return repetitionCount(positions, index) >= 3 ? { type: 'cp', value: 0 } : null;
}

/** Difference between two White-relative scores, from the mover's point of view. */
export function centipawnLoss(before: Score, after: Score, mover: 'w' | 'b', clamp = EVAL_CLAMP_CP): number {
  const b = clampedCp(toMoverPov(before, mover), clamp);
  const a = clampedCp(toMoverPov(after, mover), clamp);
  return Math.max(0, b - a);
}
