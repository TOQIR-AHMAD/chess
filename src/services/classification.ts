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
  expectedPoints,
  expectedPointsLoss,
  formatEval,
  moveAccuracy,
  toMoverPov,
  winProbability,
} from '@/utils/evaluation';
import { formatSanLine, sacrificedMaterial } from '@/utils/chess';

/**
 * Move classification.
 *
 * Moves are judged on **expected points given away** (see `utils/evaluation.ts`),
 * not on raw centipawn loss. That distinction is the whole model: half a pawn
 * dropped at equality is a real error, and the same half pawn dropped while
 * already eight pawns down is not — a centipawn threshold cannot tell those apart
 * and ends up calling every move in a decided game a blunder.
 *
 * The bands below are set to line up with how Chess.com's Game Review labels the
 * same game, so a game reviewed here reads the way players expect. They are still
 * fully configurable from the analysis settings panel. See README.md.
 */
export const DEFAULT_THRESHOLDS: ClassificationThresholds = {
  version: 2,
  inaccuracy: 8,
  mistake: 12,
  blunder: 20,
  excellent: 0.5,
  missedWin: 10,
  greatMargin: 15,
  brilliantSacrifice: 1.5,
  bookDepth: 16,
};

export interface ClassificationMeta {
  label: string;
  /** Move-quality colour class (see `index.css`). */
  color: string;
  /** Filled-pill class for the same colour. */
  badge: string;
  description: string;
}

export const CLASSIFICATION_META: Record<MoveClassification, ClassificationMeta> = {
  brilliant: {
    label: 'Brilliant',
    color: 'cls-brilliant',
    badge: 'badge-brilliant',
    description: 'A sound sacrifice the engine confirms.',
  },
  great: {
    label: 'Great',
    color: 'cls-great',
    badge: 'badge-great',
    description: 'The only move that held the position.',
  },
  best: {
    label: 'Best',
    color: 'cls-best',
    badge: 'badge-best',
    description: "The engine's top choice.",
  },
  excellent: {
    label: 'Excellent',
    color: 'cls-excellent',
    badge: 'badge-excellent',
    description: 'Practically as good as the best move.',
  },
  good: {
    label: 'Good',
    color: 'cls-good',
    badge: 'badge-good',
    description: 'A reasonable move that keeps the position.',
  },
  book: {
    label: 'Book',
    color: 'cls-book',
    badge: 'badge-book',
    description: 'Known opening theory.',
  },
  forced: {
    label: 'Forced',
    color: 'cls-forced',
    badge: 'badge-forced',
    description: 'The only legal move.',
  },
  inaccuracy: {
    label: 'Inaccuracy',
    color: 'cls-inaccuracy',
    badge: 'badge-inaccuracy',
    description: 'A small step in the wrong direction.',
  },
  mistake: {
    label: 'Mistake',
    color: 'cls-mistake',
    badge: 'badge-mistake',
    description: 'Gives away a meaningful part of the advantage.',
  },
  blunder: {
    label: 'Blunder',
    color: 'cls-blunder',
    badge: 'badge-blunder',
    description: 'A serious error that changes the outcome.',
  },
  missed: {
    label: 'Miss',
    color: 'cls-missed',
    badge: 'badge-missed',
    description: 'A winning continuation was available.',
  },
};

/**
 * Order used by the game-review breakdown panel: best to worst, with the missed
 * win sitting just above the blunder — it costs more than a mistake, but the
 * position it leaves behind is still playable.
 */
export const CLASSIFICATION_ORDER: MoveClassification[] = [
  'brilliant',
  'great',
  'best',
  'excellent',
  'good',
  'book',
  'forced',
  'inaccuracy',
  'mistake',
  'missed',
  'blunder',
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
  /** Rating of the player who made the move, when the PGN carries one. */
  moverRating: number | null;
  thresholds: ClassificationThresholds;
}

export interface ClassificationOutput {
  classification: MoveClassification;
  centipawnLoss: number;
  winProbLoss: number;
  expectedPointsLoss: number;
  accuracy: number;
  sacrificedMaterial: number;
  isTopEngineMove: boolean;
}

/** Expected points at or above which a side is considered to be winning. */
const DECISIVE_POINTS = 80;

/**
 * Brilliancy calibration.
 *
 * Chess.com states four things about the label, and only four:
 *
 *   1. "A Brilliant move is when you find a good piece sacrifice."
 *   2. "You should not be in a bad position after a Brilliant move."
 *   3. "You should not be completely winning even if you hadn't found the move."
 *   4. The criteria are more lenient for newer players than for higher-rated ones.
 *
 * Those four rules are what `isBrilliant` implements. The *numbers* below are ours:
 * Chess.com does not publish its cutoffs, so these are calibrated against how its
 * Game Review labels the same games, in the same spirit as the bands above. See
 * README.md — this is not, and does not claim to be, their algorithm.
 */

/** Rating at or below which the most generous criteria apply. */
const BRILLIANT_LENIENT_RATING = 800;
/** Rating at or above which the strictest criteria apply. */
const BRILLIANT_STRICT_RATING = 2200;
/** Multiplier on the sacrifice threshold at master level (rule 1). */
const BRILLIANT_SACRIFICE_STRICT_SCALE = 1.4;
/**
 * Expected points a beginner's sacrifice may give away and still count (rule 1).
 *
 * Anchored to Chess.com's own published bands rather than picked: it labels a move
 * losing up to 0.05 expected points — 5 on this 0-100 scale — as "Good", and rule 1
 * asks only for a *good* sacrifice, not a perfect one. The slack matters because
 * our lite engine often disagrees with their full-NNUE one about which move is
 * best: in the position that prompted this, ours prefers Rxa1+ and scores the
 * brilliancy 1.3-2.0 points worse depending on the run, so a tighter bar made the
 * label flicker between reviews of the same game.
 */
const BRILLIANT_MAX_LOSS_LENIENT = 5;
/** Centipawns, mover's point of view: below this the position is "bad" (rule 2). */
const BRILLIANT_MIN_EVAL_AFTER = -50;
/**
 * Centipawns at which the game counts as *completely* winning for rule 3 — roughly
 * a queen up, or a forced mate (`clampedCp` reports mate as ±1000).
 *
 * The bar is deliberately this high. "Completely winning" is not the same as
 * "winning": a sacrifice found while already a rook up is still a real find, and
 * Chess.com awards it — its own review calls 15...Nc2+ brilliant in a position
 * evaluated at -6.5. Only an advantage that plays itself disqualifies the move.
 */
const BRILLIANT_ALREADY_WON_CP = 800;

/**
 * Classify a single move.
 *
 * Decision order (first match wins):
 *   1. Book       — the position is still inside a known ECO line.
 *   2. Forced     — there was nothing else to play.
 *   3. Brilliant  — a genuine material sacrifice that the engine endorses.
 *   4. Great      — the one move that held the position, with every alternative
 *                   clearly worse.
 *   5. Miss       — a forced mate or decisive advantage was thrown away, but the
 *                   resulting position is not itself lost.
 *   6. Blunder / Mistake / Inaccuracy — by expected points given away.
 *   7. Best / Excellent / Good — the engine's own move, then by the same axis.
 *
 * Everything from step 5 down is measured in expected points rather than
 * centipawns, which is what keeps a decided game from filling up with blunders:
 * a side already down a rook has almost no expected points left to lose, so no
 * further drop can cross the blunder band.
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

  const pointsLoss = expectedPointsLoss(input.evalBefore, input.evalAfter, moverColor);
  const pointsBefore = expectedPoints(toMoverPov(input.evalBefore, moverColor));
  const pointsAfter = expectedPoints(toMoverPov(input.evalAfter, moverColor));

  const isTopEngineMove = input.bestMove !== null && input.bestMove === input.uci;
  const sacrifice = sacrificedMaterial(input.fenBefore, [input.uci, ...playedContinuation(input)], 6);

  const base: Omit<ClassificationOutput, 'classification'> = {
    centipawnLoss: loss,
    winProbLoss,
    expectedPointsLoss: pointsLoss,
    accuracy,
    sacrificedMaterial: sacrifice,
    isTopEngineMove,
  };

  if (input.isBook) return { ...base, classification: 'book' };

  // Nothing to judge: with one legal move the player made no decision, so the
  // evaluation swing that follows is the position's doing, not theirs.
  if (input.legalMoveCount === 1) return { ...base, classification: 'forced' };

  if (isBrilliant(input, { pointsLoss, moverBefore, moverAfter, sacrifice })) {
    return { ...base, classification: 'brilliant' };
  }

  if (isGreat(input, { pointsLoss, isTopEngineMove })) {
    return { ...base, classification: 'great' };
  }

  if (isMissedWin(input, { pointsLoss, pointsBefore, pointsAfter })) {
    return { ...base, classification: 'missed' };
  }

  if (pointsLoss >= thresholds.blunder) return { ...base, classification: 'blunder' };
  if (pointsLoss >= thresholds.mistake) return { ...base, classification: 'mistake' };
  if (pointsLoss >= thresholds.inaccuracy) return { ...base, classification: 'inaccuracy' };

  // "Best" is reserved for the engine's own first choice. A move that merely costs
  // nothing measurable is excellent — the engine still had something it liked more.
  if (isTopEngineMove) return { ...base, classification: 'best' };
  if (pointsLoss <= thresholds.excellent) return { ...base, classification: 'excellent' };
  return { ...base, classification: 'good' };
}

/** Engine continuation after the played move, used to see recaptures. */
function playedContinuation(input: ClassificationInput): string[] {
  // The best line starts from the position *before* the move, so it is only a
  // valid continuation when the played move is also the engine's first choice.
  if (input.bestMove === input.uci) return input.bestLineUci.slice(1);
  return [];
}

/**
 * Chess.com's four brilliancy rules, in order.
 *
 * The rule that does the most work — and the one most often got wrong — is the
 * third. "Completely winning even if you hadn't found the move" is a statement
 * about the **alternative**, not about the position: a sacrifice that creates a
 * winning position out of an equal one is exactly what the label is for, and
 * testing the position's own evaluation would throw those away, because the
 * evaluation before the move already assumes the best move is found. What has to
 * be merely-not-winning is the line the player would have got by playing something
 * else. See `bestAlternative`.
 */
function isBrilliant(
  input: ClassificationInput,
  ctx: { pointsLoss: number; moverBefore: number; moverAfter: number; sacrifice: number },
): boolean {
  const { thresholds } = input;
  const moverColor: 'w' | 'b' = input.mover === 'white' ? 'w' : 'b';

  // A forced move is not a brilliancy, it is the only thing on the board.
  if (input.legalMoveCount <= 1) return false;

  // Rule 4: newer players are graded more generously than titled ones.
  const strictness = ratingStrictness(input.moverRating);

  // Rule 1a — "a piece sacrifice": real material, judged after forced recaptures.
  const minSacrifice = thresholds.brilliantSacrifice * lerp(1, BRILLIANT_SACRIFICE_STRICT_SCALE, strictness);
  if (ctx.sacrifice < minSacrifice) return false;

  // Rule 1b — "a *good* one": the engine still has to endorse the move. Anything
  // that gives away real value is a speculative sacrifice, not a sound one.
  const maxLoss = Math.max(
    thresholds.excellent,
    lerp(BRILLIANT_MAX_LOSS_LENIENT, thresholds.excellent, strictness),
  );
  if (ctx.pointsLoss > maxLoss) return false;

  // Rule 2 — "you should not be in a bad position after a Brilliant move."
  if (ctx.moverAfter < BRILLIANT_MIN_EVAL_AFTER) return false;

  // Rule 3 — "you should not be completely winning even if you hadn't found it."
  // Falls back to the position's own evaluation at MultiPV 1, where there is no
  // second line to judge the counterfactual against.
  const alternative = bestAlternative(input) ?? input.evalBefore;
  if (clampedCp(toMoverPov(alternative, moverColor)) >= BRILLIANT_ALREADY_WON_CP) return false;

  return true;
}

/**
 * What the position would have been worth had the player not found this move.
 *
 * When the played move is the engine's own first choice, the alternative is its
 * second line. Otherwise the engine's first choice *is* the alternative, and the
 * evaluation before the move already reflects it.
 */
function bestAlternative(input: ClassificationInput): Score | null {
  if (input.bestMove === input.uci) return input.secondBestEval;
  return input.evalBefore;
}

/**
 * How strictly to grade this player: 0 at beginner level, 1 at master level.
 *
 * An unrated game sits in the middle rather than at either extreme — guessing
 * "beginner" would sprinkle brilliancies over imported master games, and guessing
 * "master" would deny them to the club players this tool is mostly used by.
 */
function ratingStrictness(rating: number | null): number {
  if (rating === null || !Number.isFinite(rating)) return 0.5;
  const span = BRILLIANT_STRICT_RATING - BRILLIANT_LENIENT_RATING;
  return clamp((rating - BRILLIANT_LENIENT_RATING) / span, 0, 1);
}

function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * t;
}

/**
 * "Great" is for the move that was *needed*: the engine's own choice, in a position
 * where every alternative it looked at was clearly worse. Without a second line to
 * compare against (MultiPV 1) there is no way to know an alternative existed, so the
 * label simply never fires.
 */
function isGreat(input: ClassificationInput, ctx: { pointsLoss: number; isTopEngineMove: boolean }): boolean {
  const { thresholds } = input;
  if (!ctx.isTopEngineMove) return false;
  if (input.legalMoveCount <= 1) return false;
  if (!input.secondBestEval) return false;
  if (ctx.pointsLoss > thresholds.excellent) return false;

  const moverColor: 'w' | 'b' = input.mover === 'white' ? 'w' : 'b';
  const played = expectedPoints(toMoverPov(input.evalAfter, moverColor));
  const second = expectedPoints(toMoverPov(input.secondBestEval, moverColor));
  return played - second >= thresholds.greatMargin;
}

/**
 * A miss is an opportunity declined: the player held a decisive advantage — or an
 * outright forced mate — and gave a real share of it back while still standing well
 * enough that the game is not lost. Measuring the giveaway in expected points is
 * what stops "mate in 11 became merely winning by five pawns" from counting: the
 * position was worth ~100 points before and ~96 after, so nothing was really lost.
 */
function isMissedWin(
  input: ClassificationInput,
  ctx: { pointsLoss: number; pointsBefore: number; pointsAfter: number },
): boolean {
  const { thresholds } = input;

  // The resulting position must still be playable — throwing a win away *and*
  // ending up lost is a blunder, not a missed opportunity.
  if (ctx.pointsAfter < 35) return false;
  // There has to have been something to miss.
  if (ctx.pointsBefore < DECISIVE_POINTS) return false;

  return ctx.pointsLoss >= thresholds.missedWin;
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

    case 'forced':
      return `The only legal move. Evaluation ${before} → ${after}.`;

    case 'brilliant':
      return `${analysis.san} gives up ${analysis.sacrificedMaterial} point${
        analysis.sacrificedMaterial === 1 ? '' : 's'
      } of material, and the engine confirms it works: the evaluation moves from ${before} to ${after}.${
        line ? ` Main line: ${line}.` : ''
      }`;

    case 'great':
      return `The move the position demanded — the engine's choice, and every alternative it looked at was clearly worse. Evaluation ${before} → ${after}.${
        line ? ` It continues ${line}.` : ''
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
    great: 0,
    best: 0,
    excellent: 0,
    good: 0,
    book: 0,
    forced: 0,
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
