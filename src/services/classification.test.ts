import { describe, expect, it } from 'vitest';
import type { MoveAnalysis, Score } from '@/types/analysis';
import {
  CLASSIFICATION_META,
  CLASSIFICATION_ORDER,
  DEFAULT_THRESHOLDS,
  classifyMove,
  computeAccuracy,
  emptyCounts,
  explainMove,
  type ClassificationInput,
} from './classification';
import { START_FEN } from '@/utils/chess';

const cp = (value: number): Score => ({ type: 'cp', value });
const mate = (value: number): Score => ({ type: 'mate', value });

/** A quiet, legal White move in the opening, used where the move itself is irrelevant. */
function input(overrides: Partial<ClassificationInput> = {}): ClassificationInput {
  return {
    mover: 'white',
    san: 'Nf3',
    uci: 'g1f3',
    fenBefore: START_FEN,
    evalBefore: cp(20),
    evalAfter: cp(20),
    bestMove: 'g1f3',
    bestLineUci: ['g1f3', 'g8f6'],
    secondBestEval: null,
    isBook: false,
    legalMoveCount: 20,
    moverRating: null,
    thresholds: DEFAULT_THRESHOLDS,
    ...overrides,
  };
}

describe('classifyMove — loss bands', () => {
  it('marks the engine’s own choice as best', () => {
    const result = classifyMove(input());
    expect(result.classification).toBe('best');
    expect(result.isTopEngineMove).toBe(true);
    expect(result.expectedPointsLoss).toBe(0);
  });

  it('marks a near-perfect alternative as excellent', () => {
    const result = classifyMove(input({ uci: 'b1c3', san: 'Nc3', evalAfter: cp(18) }));
    expect(result.classification).toBe('excellent');
    expect(result.expectedPointsLoss).toBeLessThanOrEqual(DEFAULT_THRESHOLDS.excellent);
  });

  it('marks a small drop as good', () => {
    const result = classifyMove(input({ uci: 'b1c3', san: 'Nc3', evalAfter: cp(0) }));
    expect(result.classification).toBe('good');
  });

  it('marks a drop past the inaccuracy band as an inaccuracy', () => {
    const result = classifyMove(input({ uci: 'b1c3', san: 'Nc3', evalAfter: cp(-60) }));
    expect(result.classification).toBe('inaccuracy');
    expect(result.expectedPointsLoss).toBeGreaterThanOrEqual(DEFAULT_THRESHOLDS.inaccuracy);
  });

  it('marks a larger drop as a mistake', () => {
    const result = classifyMove(input({ uci: 'b1c3', san: 'Nc3', evalAfter: cp(-90) }));
    expect(result.classification).toBe('mistake');
    expect(result.expectedPointsLoss).toBeGreaterThanOrEqual(DEFAULT_THRESHOLDS.mistake);
  });

  it('marks a decisive swing as a blunder', () => {
    const result = classifyMove(input({ uci: 'b1c3', san: 'Nc3', evalBefore: cp(140), evalAfter: cp(-270) }));
    expect(result.classification).toBe('blunder');
    expect(result.centipawnLoss).toBe(410);
  });

  it('scales the same centipawn drop by how much was left to lose', () => {
    // A 400cp drop starting from equality is a blunder...
    const fromEven = classifyMove(input({ uci: 'b1c3', san: 'Nc3', evalBefore: cp(0), evalAfter: cp(-400) }));
    // ...but the identical drop from an already lost position is not a new error.
    const fromLost = classifyMove(input({ uci: 'b1c3', san: 'Nc3', evalBefore: cp(-600), evalAfter: cp(-1000) }));
    expect(fromEven.centipawnLoss).toBe(fromLost.centipawnLoss);
    expect(fromEven.classification).toBe('blunder');
    expect(fromLost.classification).toBe('good');
  });

  it('reads the swing from Black’s point of view too', () => {
    // Black's evaluation improves from −1.40 to +2.70 (White POV), so Black lost nothing.
    const result = classifyMove(
      input({ mover: 'black', evalBefore: cp(-140), evalAfter: cp(-270), uci: 'g8f6', bestMove: 'g8f6' }),
    );
    expect(result.expectedPointsLoss).toBe(0);
    expect(result.classification).toBe('best');
  });

  it('honours custom thresholds', () => {
    const strict = { ...DEFAULT_THRESHOLDS, inaccuracy: 1, mistake: 2, blunder: 3 };
    const result = classifyMove(
      input({ uci: 'b1c3', san: 'Nc3', evalAfter: cp(-20), thresholds: strict }),
    );
    expect(result.classification).toBe('blunder');
  });
});

describe('classifyMove — book moves', () => {
  it('takes precedence over every other class', () => {
    const result = classifyMove(input({ isBook: true, evalAfter: cp(-500) }));
    expect(result.classification).toBe('book');
  });
});

describe('classifyMove — hopeless positions', () => {
  it('does not punish further drops once the game is lost', () => {
    const result = classifyMove(
      input({ uci: 'b1c3', san: 'Nc3', evalBefore: cp(-800), evalAfter: cp(-1500) }),
    );
    // A 7-pawn drop, but from a position that was already worth almost nothing.
    expect(result.expectedPointsLoss).toBeLessThan(DEFAULT_THRESHOLDS.inaccuracy);
    expect(['excellent', 'good']).toContain(result.classification);
  });

  it('still calls it a blunder from a merely bad position', () => {
    const result = classifyMove(
      input({ uci: 'b1c3', san: 'Nc3', evalBefore: cp(-200), evalAfter: cp(-900) }),
    );
    expect(result.classification).toBe('blunder');
  });
});

describe('classifyMove — missed wins', () => {
  it('flags a squandered winning advantage', () => {
    const result = classifyMove(
      input({ uci: 'b1c3', san: 'Nc3', evalBefore: cp(320), evalAfter: cp(40) }),
    );
    expect(result.classification).toBe('missed');
  });

  it('flags a missed forced mate', () => {
    const result = classifyMove(
      input({ uci: 'b1c3', san: 'Nc3', evalBefore: mate(3), evalAfter: cp(30) }),
    );
    expect(result.classification).toBe('missed');
  });

  it('is a blunder, not a missed win, when the position collapses', () => {
    const result = classifyMove(
      input({ uci: 'b1c3', san: 'Nc3', evalBefore: mate(3), evalAfter: cp(-400) }),
    );
    expect(result.classification).toBe('blunder');
  });

  it('is not flagged when the win is retained', () => {
    const result = classifyMove(
      input({ uci: 'b1c3', san: 'Nc3', evalBefore: cp(900), evalAfter: cp(700) }),
    );
    expect(result.classification).not.toBe('missed');
  });
});

describe('classifyMove — brilliant moves', () => {
  // Rf1xf7 offers a rook for a pawn; the king recaptures.
  const sacFen = '4k3/5p2/8/8/8/8/8/4KR2 w - - 0 1';

  it('recognises a sound sacrifice the engine endorses', () => {
    const result = classifyMove(
      input({
        fenBefore: sacFen,
        san: 'Rxf7',
        uci: 'f1f7',
        bestMove: 'f1f7',
        bestLineUci: ['f1f7', 'e8f7'],
        evalBefore: cp(80),
        evalAfter: cp(420),
        secondBestEval: cp(20),
      }),
    );
    expect(result.sacrificedMaterial).toBe(4);
    expect(result.classification).toBe('brilliant');
  });

  it('is not brilliant when no material is given up', () => {
    const result = classifyMove(input({ evalBefore: cp(80), evalAfter: cp(420), secondBestEval: cp(20) }));
    expect(result.classification).not.toBe('brilliant');
  });

  it('is not brilliant when the engine does not endorse it', () => {
    const result = classifyMove(
      input({
        fenBefore: sacFen,
        san: 'Rxf7',
        uci: 'f1f7',
        bestMove: 'e1e2',
        bestLineUci: ['e1e2'],
        evalBefore: cp(80),
        evalAfter: cp(-300),
      }),
    );
    expect(result.classification).toBe('blunder');
  });

  it('is not brilliant when it is the only legal move', () => {
    const result = classifyMove(
      input({
        fenBefore: sacFen,
        san: 'Rxf7',
        uci: 'f1f7',
        bestMove: 'f1f7',
        bestLineUci: ['f1f7', 'e8f7'],
        evalBefore: cp(80),
        evalAfter: cp(420),
        legalMoveCount: 1,
      }),
    );
    // Forced, not brilliant: a sacrifice you had no choice about is not a decision.
    expect(result.classification).toBe('forced');
  });

  /**
   * Regression test for the real case that exposed the bug: 15...Nc2+ in
   * Durli–TOQIR_EHMED. Black is already winning by 6.6 pawns and sacrifices a
   * knight anyway; Chess.com's own Game Review calls it brilliant. Rejecting a
   * sacrifice merely because the player was *winning* threw these away — only a
   * completely won game disqualifies one.
   */
  it('is brilliant while already winning, as Chess.com scores it', () => {
    // Black rook takes the f2 pawn and is recaptured by the king.
    const blackSacFen = '4kr2/8/8/8/8/8/5P2/4K3 b - - 0 1';
    const result = classifyMove(
      input({
        mover: 'black',
        fenBefore: blackSacFen,
        san: 'Rxf2',
        uci: 'f8f2',
        bestMove: 'f8f2',
        bestLineUci: ['f8f2', 'e1f2'],
        evalBefore: cp(-657),
        evalAfter: cp(-620),
        secondBestEval: cp(-600),
        moverRating: 532,
      }),
    );
    expect(result.sacrificedMaterial).toBeGreaterThanOrEqual(1.5);
    expect(result.classification).toBe('brilliant');
  });

  /**
   * Pins a deliberate departure from the previous implementation, which required a
   * brilliancy to beat the runner-up by 30cp. Chess.com states no such rule — its
   * only comparison is whether you were *winning* without the move — and requiring
   * uniqueness suppresses the most attractive case of all: a sound sacrifice in a
   * level position. Being the only move that holds is what "Great" is for.
   */
  it('is brilliant even when a quiet move was nearly as good, if neither was winning', () => {
    const result = classifyMove(
      input({
        fenBefore: sacFen,
        san: 'Rxf7',
        uci: 'f1f7',
        bestMove: 'f1f7',
        bestLineUci: ['f1f7', 'e8f7'],
        evalBefore: cp(100),
        evalAfter: cp(100),
        secondBestEval: cp(95),
      }),
    );
    expect(result.classification).toBe('brilliant');
  });

  /**
   * Chess.com's rule is "you should not be completely winning **even if you hadn't
   * found the move**" — a statement about the alternative, not about the position.
   * The evaluation before the move already assumes the best move is found, so
   * testing it would reject exactly the sacrifices the label exists for.
   */
  it('is not brilliant when the alternative was already winning anyway', () => {
    const result = classifyMove(
      input({
        fenBefore: sacFen,
        san: 'Rxf7',
        uci: 'f1f7',
        bestMove: 'f1f7',
        bestLineUci: ['f1f7', 'e8f7'],
        evalBefore: cp(900),
        evalAfter: cp(950),
        // A quiet move was completely winning too, so nothing was really found.
        secondBestEval: cp(900),
      }),
    );
    expect(result.classification).not.toBe('brilliant');
  });

  it('is brilliant when the sacrifice is what creates the win', () => {
    const result = classifyMove(
      input({
        fenBefore: sacFen,
        san: 'Rxf7',
        uci: 'f1f7',
        bestMove: 'f1f7',
        bestLineUci: ['f1f7', 'e8f7'],
        // Without the sacrifice the game was merely pleasant; with it, winning.
        evalBefore: cp(900),
        evalAfter: cp(950),
        secondBestEval: cp(60),
      }),
    );
    expect(result.classification).toBe('brilliant');
  });

  it('is not brilliant when the position is bad after the sacrifice', () => {
    const result = classifyMove(
      input({
        fenBefore: sacFen,
        san: 'Rxf7',
        uci: 'f1f7',
        bestMove: 'f1f7',
        bestLineUci: ['f1f7', 'e8f7'],
        evalBefore: cp(-200),
        evalAfter: cp(-200),
        secondBestEval: cp(-260),
      }),
    );
    expect(result.classification).not.toBe('brilliant');
  });

  describe('rating leniency', () => {
    /**
     * The same sacrifice, slightly imprecise: it gives away 1.15 expected points,
     * which is inside the beginner's allowance and outside the master's.
     */
    const speculative = {
      fenBefore: sacFen,
      san: 'Rxf7',
      uci: 'f1f7',
      bestMove: 'f1f7',
      bestLineUci: ['f1f7', 'e8f7'],
      evalBefore: cp(120),
      evalAfter: cp(110),
      secondBestEval: cp(60),
    };

    it('grants a beginner the benefit of the doubt', () => {
      const result = classifyMove(input({ ...speculative, moverRating: 700 }));
      expect(result.classification).toBe('brilliant');
    });

    it('holds a master to the engine move', () => {
      const result = classifyMove(input({ ...speculative, moverRating: 2300 }));
      expect(result.classification).not.toBe('brilliant');
    });
  });
});

describe('classifyMove — great moves', () => {
  it('flags the engine move when every alternative was far worse', () => {
    const result = classifyMove(input({ evalAfter: cp(20), secondBestEval: cp(-400) }));
    expect(result.classification).toBe('great');
  });

  it('is only best when the alternatives were nearly as good', () => {
    const result = classifyMove(input({ evalAfter: cp(20), secondBestEval: cp(10) }));
    expect(result.classification).toBe('best');
  });

  it('needs a second line to compare against', () => {
    const result = classifyMove(input({ evalAfter: cp(20), secondBestEval: null }));
    expect(result.classification).toBe('best');
  });

  it('does not apply to a move the engine did not choose', () => {
    const result = classifyMove(
      input({ uci: 'b1c3', san: 'Nc3', evalAfter: cp(20), secondBestEval: cp(-400) }),
    );
    expect(result.classification).not.toBe('great');
  });
});

describe('accuracy scoring', () => {
  function move(overrides: Partial<MoveAnalysis>): MoveAnalysis {
    return {
      ply: 0,
      moveNumber: 1,
      color: 'white',
      san: 'e4',
      uci: 'e2e4',
      evalBefore: cp(20),
      evalAfter: cp(20),
      centipawnLoss: 0,
      winProbLoss: 0,
      expectedPointsLoss: 0,
      accuracy: 100,
      classification: 'best',
      bestMove: 'e2e4',
      bestMoveSan: 'e4',
      bestLine: [],
      playedLine: [],
      isTopEngineMove: true,
      depth: 14,
      sacrificedMaterial: 0,
      explanation: '',
      ...overrides,
    };
  }

  it('is 100 for a flawless side', () => {
    const moves = [move({ ply: 0 }), move({ ply: 2 }), move({ ply: 4 })];
    expect(computeAccuracy(moves, 'white').accuracy).toBeCloseTo(100, 0);
  });

  it('drops when moves give away win probability', () => {
    const moves = [
      move({ ply: 0, accuracy: 100 }),
      move({ ply: 2, accuracy: 40, classification: 'blunder', centipawnLoss: 400, evalAfter: cp(-380) }),
      move({ ply: 4, accuracy: 95 }),
    ];
    const result = computeAccuracy(moves, 'white');
    expect(result.accuracy).toBeLessThan(100);
    expect(result.accuracy).toBeGreaterThan(0);
    expect(result.counts.blunder).toBe(1);
    expect(result.averageCentipawnLoss).toBe(133);
  });

  it('only scores the requested colour', () => {
    const moves = [move({ ply: 0, color: 'white' }), move({ ply: 1, color: 'black', accuracy: 10 })];
    expect(computeAccuracy(moves, 'white').moveCount).toBe(1);
    expect(computeAccuracy(moves, 'black').moveCount).toBe(1);
    expect(computeAccuracy(moves, 'white').accuracy).toBeGreaterThan(
      computeAccuracy(moves, 'black').accuracy,
    );
  });

  it('handles a side with no moves', () => {
    const result = computeAccuracy([], 'white');
    expect(result).toEqual({ accuracy: 0, counts: emptyCounts(), averageCentipawnLoss: 0, moveCount: 0 });
  });

  it('stays inside 0-100 even for a catastrophic game', () => {
    const moves = Array.from({ length: 20 }, (_, index) =>
      move({ ply: index * 2, accuracy: 0, classification: 'blunder', centipawnLoss: 1000 }),
    );
    const result = computeAccuracy(moves, 'white');
    expect(result.accuracy).toBeGreaterThanOrEqual(0);
    expect(result.accuracy).toBeLessThanOrEqual(100);
  });
});

describe('explainMove', () => {
  const base: Omit<MoveAnalysis, 'explanation'> = {
    ply: 32,
    moveNumber: 17,
    color: 'white',
    san: 'Qe2',
    uci: 'd1e2',
    evalBefore: cp(140),
    evalAfter: cp(-270),
    centipawnLoss: 410,
    winProbLoss: 38,
    expectedPointsLoss: 58,
    accuracy: 24,
    classification: 'blunder',
    bestMove: 'd1d2',
    bestMoveSan: 'Qd2',
    bestLine: ['Qd2'],
    playedLine: [],
    isTopEngineMove: false,
    depth: 18,
    sacrificedMaterial: 0,
  };

  it('quotes real evaluations for a blunder', () => {
    const text = explainMove(base, { fenBefore: START_FEN, bestLineSan: [] });
    expect(text).toContain('+1.40');
    expect(text).toContain('-2.70');
    expect(text).toContain('Qd2');
  });

  it('names the opening for a book move', () => {
    const text = explainMove(
      { ...base, classification: 'book' },
      { fenBefore: START_FEN, bestLineSan: [], openingName: 'Italian Game' },
    );
    expect(text).toContain('Italian Game');
  });

  it('states the material given up for a brilliancy', () => {
    const text = explainMove(
      { ...base, classification: 'brilliant', sacrificedMaterial: 4, evalAfter: cp(420) },
      { fenBefore: START_FEN, bestLineSan: [] },
    );
    expect(text).toContain('4 points');
    expect(text).toContain('+4.20');
  });

  it('says a forced mate was available for a missed win', () => {
    const text = explainMove(
      { ...base, classification: 'missed', evalBefore: mate(3), evalAfter: cp(20) },
      { fenBefore: START_FEN, bestLineSan: [] },
    );
    expect(text).toContain('forced mate');
    expect(text).toContain('M3');
  });
});

describe('classification metadata', () => {
  it('has an entry for every classification', () => {
    for (const key of CLASSIFICATION_ORDER) {
      expect(CLASSIFICATION_META[key]).toBeDefined();
      expect(CLASSIFICATION_META[key].label.length).toBeGreaterThan(0);
    }
    expect(Object.keys(emptyCounts()).sort()).toEqual([...CLASSIFICATION_ORDER].sort());
  });
});
