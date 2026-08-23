import type {
  AccuracyBreakdown,
  ClassificationThresholds,
  MoveAnalysis,
  MoveClassification,
  Score,
} from '@/types/analysis';
import type { Color } from '@/types/game';
import {
  centipawnLoss,
  clampedCp,
  formatEval,
  moveAccuracy,
  toMoverPov,
  winProbability,
} from '@/utils/evaluation';
import { formatSanLine, sacrificedMaterial } from '@/utils/chess';

/**
 * Move classification.
 *
 * Thresholds are expressed in **pawns** so they read the way players talk, and
 * every one of them is configurable from the analysis settings panel. The scheme
 * below is our own: it is inspired by how modern review tools present a game, but
 * the cut-offs, the ordering and the brilliant/missed heuristics are defined here
 * and documented in README.md rather than copied from any particular site.
 */
export const DEFAULT_THRESHOLDS: ClassificationThresholds = {
  inaccuracy: 0.5,
  mistake: 1.0,
  blunder: 2.0,
  best: 0.05,
  excellent: 0.15,
  good: 0.35,
  missedWin: 2.0,
  brilliantSacrifice: 1.5,
  bookDepth: 16,
  hopeless: 6.0,
};

export interface ClassificationMeta {
  label: string;
  /** Annotation glyph appended to the move in the move list. */
  glyph: string;
  /** Move-quality colour class (see `index.css`). */
  color: string;
  /** Filled-pill class for the same colour. */
  badge: string;
  description: string;
}

export const CLASSIFICATION_META: Record<MoveClassification, ClassificationMeta> = {
  brilliant: {
    label: 'Brilliant',
    glyph: '!!',
    color: 'cls-brilliant',
    badge: 'badge-brilliant',
    description: 'A sound sacrifice the engine confirms.',
  },
  best: {
    label: 'Best',
    glyph: '',
    color: 'cls-best',
    badge: 'badge-best',
    description: "The engine's top choice.",
  },
  excellent: {
    label: 'Excellent',
    glyph: '',
    color: 'cls-excellent',
    badge: 'badge-excellent',
    description: 'Practically as good as the best move.',
  },
  good: {
    label: 'Good',
    glyph: '',
    color: 'cls-good',
    badge: 'badge-good',
    description: 'A reasonable move that keeps the position.',
  },
  book: {
    label: 'Book',
    glyph: '',
    color: 'cls-book',
    badge: 'badge-book',
    description: 'Known opening theory.',
  },
  inaccuracy: {
    label: 'Inaccuracy',
    glyph: '?!',
    color: 'cls-inaccuracy',
    badge: 'badge-inaccuracy',
    description: 'A small step in the wrong direction.',
  },
  mistake: {
    label: 'Mistake',
    glyph: '?',
    color: 'cls-mistake',
    badge: 'badge-mistake',
    description: 'Gives away a meaningful part of the advantage.',
  },
  blunder: {
    label: 'Blunder',
    glyph: '??',
    color: 'cls-blunder',
    badge: 'badge-blunder',
    description: 'A serious error that changes the outcome.',
  },
  missed: {
    label: 'Missed win',
    glyph: '?',
    color: 'cls-missed',
    badge: 'badge-missed',
    description: 'A winning continuation was available.',
  },
};

/** Order used by the game-review breakdown panel. */
export const CLASSIFICATION_ORDER: MoveClassification[] = [
  'brilliant',
  'best',
  'excellent',
  'good',
  'book',
  'inaccuracy',
  'mistake',
  'blunder',
  'missed',
];

export interface ClassificationInput {
  mover: Color;
  san: string;
  uci: string;
  fenBefore: string;
  /** White-relative evaluation of the position before the move. */
  evalBefore: Score;
  /** White-relative evaluation of the position after the move. */
  evalAfter: Score;
  /** Engine's preferred move in UCI form, if any. */
  bestMove: string | null;
  /** Principal variation of the engine's best move, in UCI. */
  bestLineUci: string[];
  /** White-relative score of the engine's second choice, when MultiPV >= 2. */
  secondBestEval: Score | null;
  isBook: boolean;
  legalMoveCount: number;
  thresholds: ClassificationThresholds;
}

export interface ClassificationOutput {
  classification: MoveClassification;
  centipawnLoss: number;
  winProbLoss: number;
  accuracy: number;
  sacrificedMaterial: number;
  isTopEngineMove: boolean;
}

const pawnsToCp = (pawns: number) => Math.round(pawns * 100);

/**
 * Classify a single move.
 *
 * Decision order (first match wins):
 *   1. Book        — the position is still inside a known ECO line.
 *   2. Brilliant   — a genuine material sacrifice that the engine endorses.
 *   3. Missed win  — a forced mate or decisive advantage was thrown away, but the
 *                    resulting position is not itself lost.
 *   4. Blunder / Mistake / Inaccuracy — by centipawn loss.
 *   5. Best / Excellent / Good — by how close the move is to the engine's choice.
 *
 * "Hopeless" damping: once a side is worse than `thresholds.hopeless` pawns, further
 * drops can no longer be blunders — losing a lost game more thoroughly is not a new error.
 */
export function classifyMove(input: ClassificationInput): ClassificationOutput {
  const { thresholds, mover } = input;
  const moverColor: 'w' | 'b' = mover === 'white' ? 'w' : 'b';

  const loss = centipawnLoss(input.evalBefore, input.evalAfter, moverColor);
  const moverBefore = clampedCp(toMoverPov(input.evalBefore, moverColor));
  const moverAfter = clampedCp(toMoverPov(input.evalAfter, moverColor));

  const winBefore = winProbability(toMoverPov(input.evalBefore, moverColor));
  const winAfter = winProbability(toMoverPov(input.evalAfter, moverColor));
  const winProbLoss = Math.max(0, winBefore - winAfter);
  const accuracy = moveAccuracy(winBefore, winAfter);

  const isTopEngineMove = input.bestMove !== null && input.bestMove === input.uci;
  const sacrifice = sacrificedMaterial(input.fenBefore, [input.uci, ...playedContinuation(input)], 6);

  const base: Omit<ClassificationOutput, 'classification'> = {
    centipawnLoss: loss,
    winProbLoss,
    accuracy,
    sacrificedMaterial: sacrifice,
    isTopEngineMove,
  };

  if (input.isBook) return { ...base, classification: 'book' };

  if (isBrilliant(input, { loss, moverBefore, moverAfter, sacrifice })) {
    return { ...base, classification: 'brilliant' };
  }

  if (isMissedWin(input, { loss, moverBefore, moverAfter })) {
    return { ...base, classification: 'missed' };
  }

  const hopelessCp = pawnsToCp(thresholds.hopeless);
  const alreadyLost = moverBefore <= -hopelessCp;

  if (!alreadyLost) {
    if (loss >= pawnsToCp(thresholds.blunder)) return { ...base, classification: 'blunder' };
    if (loss >= pawnsToCp(thresholds.mistake)) return { ...base, classification: 'mistake' };
  }
  if (loss >= pawnsToCp(thresholds.inaccuracy)) return { ...base, classification: 'inaccuracy' };

  if (isTopEngineMove || loss <= pawnsToCp(thresholds.best)) return { ...base, classification: 'best' };
  if (loss <= pawnsToCp(thresholds.excellent)) return { ...base, classification: 'excellent' };
  return { ...base, classification: 'good' };
}

/** Engine continuation after the played move, used to see recaptures. */
function playedContinuation(input: ClassificationInput): string[] {
  // The best line starts from the position *before* the move, so it is only a
  // valid continuation when the played move is also the engine's first choice.
  if (input.bestMove === input.uci) return input.bestLineUci.slice(1);
  return [];
}

function isBrilliant(
  input: ClassificationInput,
  ctx: { loss: number; moverBefore: number; moverAfter: number; sacrifice: number },
): boolean {
  const { thresholds } = input;
  // A forced move is not a brilliancy, it is the only thing on the board.
  if (input.legalMoveCount <= 1) return false;
  // Real material must be given up, judged after the forced recaptures.
  if (ctx.sacrifice < thresholds.brilliantSacrifice) return false;
  // The engine has to endorse it: near-best, and not merely the least-bad option.
  if (ctx.loss > pawnsToCp(thresholds.excellent)) return false;
  // The sacrifice has to keep the game at least balanced.
  if (ctx.moverAfter < -50) return false;
  // Sacrifices while already completely winning are just simplification.
  if (ctx.moverBefore > 600) return false;
  // If a quiet alternative was almost as good, the sacrifice was not necessary
  // brilliance — require the second choice to be clearly worse.
  if (input.secondBestEval) {
    const second = clampedCp(toMoverPov(input.secondBestEval, input.mover === 'white' ? 'w' : 'b'));
    if (ctx.moverAfter - second < 30) return false;
  }
  return true;
}

function isMissedWin(
  input: ClassificationInput,
  ctx: { loss: number; moverBefore: number; moverAfter: number },
): boolean {
  const { thresholds } = input;
  const moverColor: 'w' | 'b' = input.mover === 'white' ? 'w' : 'b';
  const before = toMoverPov(input.evalBefore, moverColor);
  const after = toMoverPov(input.evalAfter, moverColor);

  const hadForcedMate = before.type === 'mate' && before.value > 0;
  const keptForcedMate = after.type === 'mate' && after.value > 0;

  // The resulting position must still be playable — throwing a win away *and*
  // ending up lost is a blunder, not a missed opportunity.
  if (ctx.moverAfter < -150) return false;

  if (hadForcedMate && !keptForcedMate && ctx.loss >= pawnsToCp(thresholds.inaccuracy)) return true;

  const winCp = pawnsToCp(thresholds.missedWin);
  return ctx.moverBefore >= winCp && ctx.moverAfter < winCp * 0.75 && ctx.loss >= pawnsToCp(thresholds.mistake);
}

/**
 * Build the human-readable explanation shown in the analysis panel.
 * Every sentence is derived from engine output or the position itself — nothing
 * is invented, and no claim is made that the engine cannot support.
 */
export function explainMove(
  analysis: Omit<MoveAnalysis, 'explanation'>,
  context: { fenBefore: string; bestLineSan: string[]; openingName?: string | null },
): string {
  const before = formatEval(analysis.evalBefore);
  const after = formatEval(analysis.evalAfter);
  const lossPawns = (analysis.centipawnLoss / 100).toFixed(2);
  const best = analysis.bestMoveSan;
  const line = context.bestLineSan.length > 0 ? formatSanLine(context.fenBefore, context.bestLineSan, 6) : null;

  switch (analysis.classification) {
    case 'book':
      return context.openingName
        ? `Still in known theory — ${context.openingName}. The evaluation stays at ${after}.`
        : `A known opening move. The evaluation stays at ${after}.`;

    case 'brilliant':
      return `${analysis.san} gives up ${analysis.sacrificedMaterial} point${
        analysis.sacrificedMaterial === 1 ? '' : 's'
      } of material, and the engine confirms it works: the evaluation moves from ${before} to ${after}.${
        line ? ` Main line: ${line}.` : ''
      }`;

    case 'best':
      return analysis.isTopEngineMove
        ? `The engine's first choice at depth ${analysis.depth}. Evaluation ${before} → ${after}.${
            line ? ` It continues ${line}.` : ''
          }`
        : `As good as the top move — only ${lossPawns} pawns behind it. Evaluation ${before} → ${after}.`;

    case 'excellent':
      return `A strong move, ${lossPawns} pawns behind the engine's ${best ?? 'choice'}. Evaluation ${before} → ${after}.`;

    case 'good':
      return `A playable move that costs ${lossPawns} pawns against the engine's ${best ?? 'choice'}. Evaluation ${before} → ${after}.`;

    case 'inaccuracy':
      return `${analysis.san} loses ${lossPawns} pawns of evaluation (${before} → ${after}).${
        best ? ` ${best} was more accurate${line ? `: ${line}` : ''}.` : ''
      }`;

    case 'mistake':
      return `The evaluation swings from ${before} to ${after} — ${lossPawns} pawns handed over.${
        best ? ` The engine prefers ${best}${line ? `, with ${line}` : ''}.` : ''
      }`;

    case 'blunder':
      return `A serious error: ${before} → ${after}, a ${lossPawns} pawn swing.${
        best ? ` ${best} held the position${line ? `: ${line}` : ''}.` : ''
      }`;

    case 'missed': {
      const hadMate = analysis.evalBefore.type === 'mate';
      if (hadMate && best) {
        return `A forced mate was on the board — ${best} leads to ${formatEval(analysis.evalBefore)}${
          line ? ` (${line})` : ''
        }. After ${analysis.san} the evaluation is ${after}.`;
      }
      return `${best ?? 'The engine move'} kept a winning advantage at ${before}${
        line ? ` with ${line}` : ''
      }. ${analysis.san} lets it slip to ${after}.`;
    }

    default:
      return `Evaluation ${before} → ${after}.`;
  }
}

/** Empty tally, used as the accumulator for a side's breakdown. */
export function emptyCounts(): Record<MoveClassification, number> {
  return {
    brilliant: 0,
    best: 0,
    excellent: 0,
    good: 0,
    book: 0,
    inaccuracy: 0,
    mistake: 0,
    blunder: 0,
    missed: 0,
  };
}

/**
 * Game accuracy for one side.
 *
 * Per-move accuracies are combined two ways and averaged:
 *   - a **volatility-weighted mean**, where moves played in sharp positions
 *     (large swings in the surrounding evaluations) count for more; and
 *   - a **harmonic mean**, which refuses to let a single catastrophic move be
 *     averaged away by a long tail of easy ones.
 *
 * This is our own scoring model, documented in README.md. It is not, and does not
 * claim to be, the algorithm any commercial site uses.
 */
export function computeAccuracy(moves: MoveAnalysis[], color: Color): AccuracyBreakdown {
  const own = moves.filter((move) => move.color === color);
  const counts = emptyCounts();
  for (const move of own) counts[move.classification] += 1;

  if (own.length === 0) {
    return { accuracy: 0, counts, averageCentipawnLoss: 0, moveCount: 0 };
  }

  const accuracies = own.map((move) => move.accuracy);
  const weights = volatilityWeights(moves, color);

  let weightedSum = 0;
  let weightTotal = 0;
  for (let i = 0; i < accuracies.length; i += 1) {
    weightedSum += accuracies[i] * weights[i];
    weightTotal += weights[i];
  }
  const weightedMean = weightTotal > 0 ? weightedSum / weightTotal : mean(accuracies);

  const harmonic = harmonicMean(accuracies);
  const accuracy = clamp((weightedMean + harmonic) / 2, 0, 100);

  const averageCentipawnLoss =
    own.reduce((total, move) => total + move.centipawnLoss, 0) / own.length;

  return {
    accuracy: Math.round(accuracy * 10) / 10,
    counts,
    averageCentipawnLoss: Math.round(averageCentipawnLoss),
    moveCount: own.length,
  };
}

/**
 * Weight each of a side's moves by how volatile the position was around it.
 * A move made while the evaluation is swinging wildly is a harder move, and both
 * the credit for finding it and the cost of missing it should count for more.
 */
function volatilityWeights(moves: MoveAnalysis[], color: Color): number[] {
  const windowSize = 4;
  const weights: number[] = [];
  const own = moves.filter((move) => move.color === color);

  for (const move of own) {
    const index = moves.indexOf(move);
    const window = moves.slice(Math.max(0, index - windowSize), Math.min(moves.length, index + windowSize + 1));
    const probs = window.map((entry) => winProbability(entry.evalAfter));
    const spread = probs.length > 1 ? Math.max(...probs) - Math.min(...probs) : 0;
    // Map a 0-100 point spread onto a 0.5 - 12 weight range.
    weights.push(clamp(spread / 10, 0.5, 12));
  }
  return weights;
}

function mean(values: number[]): number {
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function harmonicMean(values: number[]): number {
  // Guard against zeroes, which would send the harmonic mean to 0 outright.
  const safe = values.map((value) => Math.max(value, 1));
  return safe.length / safe.reduce((total, value) => total + 1 / value, 0);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
