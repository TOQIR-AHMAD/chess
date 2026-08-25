import { describe, expect, it } from 'vitest';
import type { Score } from '@/types/analysis';
import {
  centipawnLoss,
  clampedCp,
  describeAdvantage,
  evalBarPercent,
  formatEval,
  formatEvalBarLabel,
  isMate,
  moveAccuracy,
  scoreToCp,
  terminalScore,
  terminalScoreInGame,
  toMoverPov,
  toWhitePov,
  winProbability,
} from './evaluation';

const cp = (value: number): Score => ({ type: 'cp', value });
const mate = (value: number): Score => ({ type: 'mate', value });

describe('point-of-view conversion', () => {
  it('leaves White-to-move scores untouched', () => {
    expect(toWhitePov(cp(72), 'w')).toEqual(cp(72));
    expect(toWhitePov(mate(5), 'w')).toEqual(mate(5));
  });

  it('flips Black-to-move scores into White’s point of view', () => {
    // "+3.1 for the side to move" with Black to move means White is losing.
    expect(toWhitePov(cp(310), 'b')).toEqual(cp(-310));
    expect(toWhitePov(mate(3), 'b')).toEqual(mate(-3));
    expect(toWhitePov(cp(-150), 'b')).toEqual(cp(150));
  });

  it('round-trips back to the mover', () => {
    const white = toWhitePov(cp(240), 'b');
    expect(toMoverPov(white, 'b')).toEqual(cp(240));
  });
});

describe('scoreToCp', () => {
  it('passes centipawns through', () => {
    expect(scoreToCp(cp(0))).toBe(0);
    expect(scoreToCp(cp(-1234))).toBe(-1234);
  });

  it('maps mates far above any centipawn score, ordered by distance', () => {
    expect(scoreToCp(mate(1))).toBeGreaterThan(scoreToCp(cp(10_000)));
    expect(scoreToCp(mate(1))).toBeGreaterThan(scoreToCp(mate(6)));
    expect(scoreToCp(mate(-1))).toBeLessThan(scoreToCp(mate(-6)));
    expect(scoreToCp(mate(-2))).toBeLessThan(0);
  });

  it('clamps into the human range for loss arithmetic', () => {
    expect(clampedCp(mate(2))).toBe(1000);
    expect(clampedCp(mate(-2))).toBe(-1000);
    expect(clampedCp(cp(5000))).toBe(1000);
    expect(clampedCp(cp(250))).toBe(250);
    expect(clampedCp(cp(250), 100)).toBe(100);
  });
});

describe('winProbability', () => {
  it('is 50% at a dead-equal evaluation', () => {
    expect(winProbability(cp(0))).toBeCloseTo(50, 5);
  });

  it('rises with the evaluation and stays inside 0-100', () => {
    expect(winProbability(cp(100))).toBeGreaterThan(55);
    expect(winProbability(cp(-100))).toBeLessThan(45);
    expect(winProbability(cp(100_000))).toBeLessThanOrEqual(100);
    expect(winProbability(cp(-100_000))).toBeGreaterThanOrEqual(0);
  });

  it('treats mate as decided', () => {
    expect(winProbability(mate(4))).toBe(100);
    expect(winProbability(mate(-4))).toBe(0);
    expect(winProbability(mate(0))).toBe(0);
  });

  it('is symmetric around equality', () => {
    expect(winProbability(cp(300)) + winProbability(cp(-300))).toBeCloseTo(100, 4);
  });
});

describe('moveAccuracy', () => {
  it('is 100 when nothing is given away', () => {
    expect(moveAccuracy(60, 60)).toBeCloseTo(100, 0);
    // Improving your position cannot score above 100.
    expect(moveAccuracy(50, 80)).toBeLessThanOrEqual(100);
  });

  it('falls as win probability is lost', () => {
    const small = moveAccuracy(60, 55);
    const large = moveAccuracy(60, 20);
    expect(small).toBeGreaterThan(large);
    expect(large).toBeGreaterThanOrEqual(0);
  });

  it('never leaves the 0-100 range', () => {
    expect(moveAccuracy(100, 0)).toBeGreaterThanOrEqual(0);
    expect(moveAccuracy(100, 0)).toBeLessThanOrEqual(100);
  });
});

describe('formatEval', () => {
  it('formats positive and negative evaluations with a sign', () => {
    expect(formatEval(cp(72))).toBe('+0.72');
    expect(formatEval(cp(-135))).toBe('-1.35');
    expect(formatEval(cp(0))).toBe('0.00');
  });

  it('formats mate scores from White’s point of view', () => {
    expect(formatEval(mate(5))).toBe('M5');
    expect(formatEval(mate(-3))).toBe('-M3');
    expect(formatEval(mate(0))).toBe('#');
  });

  it('handles very large evaluations', () => {
    expect(formatEval(cp(2500), { compact: true })).toBe('+25');
    expect(formatEval(cp(-2500), { compact: true })).toBe('-25');
  });

  it('returns a placeholder when there is no score', () => {
    expect(formatEval(null)).toBe('—');
    expect(formatEval(undefined)).toBe('—');
  });

  it('produces short bar labels', () => {
    expect(formatEvalBarLabel(cp(72))).toBe('0.7');
    expect(formatEvalBarLabel(cp(-1550))).toBe('16');
    expect(formatEvalBarLabel(mate(-3))).toBe('M3');
  });
});

describe('evalBarPercent', () => {
  it('sits at the midpoint when equal', () => {
    expect(evalBarPercent(cp(0))).toBeCloseTo(50, 5);
  });

  it('saturates but never fully collapses', () => {
    expect(evalBarPercent(cp(3000))).toBeLessThanOrEqual(98);
    expect(evalBarPercent(cp(-3000))).toBeGreaterThanOrEqual(2);
  });

  it('goes to the extremes for mate', () => {
    expect(evalBarPercent(mate(2))).toBe(100);
    expect(evalBarPercent(mate(-2))).toBe(0);
  });

  it('defaults to the midpoint with no score', () => {
    expect(evalBarPercent(null)).toBe(50);
  });
});

describe('centipawnLoss', () => {
  it('measures the drop from the mover’s point of view', () => {
    // White went from +1.40 to -2.70 → lost 4.10 pawns.
    expect(centipawnLoss(cp(140), cp(-270), 'w')).toBe(410);
    // The same swing is a *gain* for Black, so no loss is recorded.
    expect(centipawnLoss(cp(140), cp(-270), 'b')).toBe(0);
  });

  it('never returns a negative loss', () => {
    expect(centipawnLoss(cp(-100), cp(300), 'w')).toBe(0);
  });

  it('clamps enormous swings', () => {
    expect(centipawnLoss(mate(1), mate(-1), 'w')).toBe(2000);
  });

  it('treats a missed mate as a large but bounded loss', () => {
    expect(centipawnLoss(mate(3), cp(20), 'w')).toBe(980);
  });
});

describe('terminalScore', () => {
  it('returns a mate score for a checkmated position, signed for the winner', () => {
    // Fool's mate: Black has just mated, White to move.
    const whiteMated = 'rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3';
    expect(terminalScore(whiteMated)).toEqual({ type: 'mate', value: -1 });

    const blackMated = 'rnbqkbnr/ppppp2p/5p2/6pQ/4P3/8/PPPP1PPP/RNB1KBNR b KQkq - 1 3';
    expect(terminalScore(blackMated)).toEqual({ type: 'mate', value: 1 });
  });

  it('returns a level score for stalemate and other draws', () => {
    const stalemate = '7k/5Q2/6K1/8/8/8/8/8 b - - 0 1';
    expect(terminalScore(stalemate)).toEqual({ type: 'cp', value: 0 });

    const insufficient = '4k3/8/8/8/8/8/8/4K3 w - - 0 1';
    expect(terminalScore(insufficient)).toEqual({ type: 'cp', value: 0 });
  });

  it('returns null for a live position', () => {
    expect(terminalScore('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1')).toBeNull();
  });
});

describe('terminalScoreInGame', () => {
  /*
   * Both knights out and back twice (Nf3 Nf6 Ng1 Ng8, twice over). The starting
   * position returns at index 4 and again at index 8, and that third occurrence
   * is a draw — something none of these FENs can show on its own.
   */
  const openings = [
    'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    'rnbqkbnr/pppppppp/8/8/8/5N2/PPPPPPPP/RNBQKB1R b KQkq - 1 1',
    'rnbqkb1r/pppppppp/5n2/8/8/5N2/PPPPPPPP/RNBQKB1R w KQkq - 2 2',
    'rnbqkb1r/pppppppp/5n2/8/8/8/PPPPPPPP/RNBQKBNR b KQkq - 3 2',
    'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 4 3',
    'rnbqkbnr/pppppppp/8/8/8/5N2/PPPPPPPP/RNBQKB1R b KQkq - 5 3',
    'rnbqkb1r/pppppppp/5n2/8/8/5N2/PPPPPPPP/RNBQKB1R w KQkq - 6 4',
    'rnbqkb1r/pppppppp/5n2/8/8/8/PPPPPPPP/RNBQKBNR b KQkq - 7 4',
    'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 8 5',
  ];

  it('scores the third occurrence of a position as the draw it is', () => {
    expect(terminalScoreInGame(openings, 0)).toBeNull();
    expect(terminalScoreInGame(openings, 4)).toBeNull();
    expect(terminalScoreInGame(openings, 8)).toEqual({ type: 'cp', value: 0 });
  });

  it('still reports checkmate ahead of repetition', () => {
    const mated = ['rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3'];
    expect(terminalScoreInGame(mated, 0)).toEqual({ type: 'mate', value: -1 });
  });
});

describe('describeAdvantage', () => {
  it('describes the position in plain language', () => {
    expect(describeAdvantage(cp(10))).toBe('Equal position');
    expect(describeAdvantage(cp(120))).toContain('White is clearly better');
    expect(describeAdvantage(cp(-600))).toContain('Black is completely winning');
    expect(describeAdvantage(mate(4))).toBe('White mates in 4');
    expect(describeAdvantage(mate(-2))).toBe('Black mates in 2');
    expect(describeAdvantage(null)).toBe('Not analysed yet');
  });
});

describe('isMate', () => {
  it('identifies mate scores', () => {
    expect(isMate(mate(3))).toBe(true);
    expect(isMate(cp(3))).toBe(false);
  });
});
