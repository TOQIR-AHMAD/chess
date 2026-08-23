import { describe, expect, it } from 'vitest';
import type { PvLine } from '@/types/analysis';
import { collectPvLines, isUciMove, mergePvLine, parseBestMove, parseInfoLine } from './uci';

describe('parseInfoLine', () => {
  it('parses a full info line', () => {
    const info = parseInfoLine(
      'info depth 18 seldepth 26 multipv 1 score cp 72 nodes 1234567 nps 987654 hashfull 210 time 1250 pv e2e4 e7e5 g1f3',
    );
    expect(info).not.toBeNull();
    expect(info).toMatchObject({
      depth: 18,
      selDepth: 26,
      multipv: 1,
      score: { type: 'cp', value: 72 },
      nodes: 1234567,
      nps: 987654,
      timeMs: 1250,
      hashFull: 210,
      bound: null,
    });
    expect(info?.pv).toEqual(['e2e4', 'e7e5', 'g1f3']);
  });

  it('parses mate scores, positive and negative', () => {
    expect(parseInfoLine('info depth 12 score mate 5 pv e2e4')?.score).toEqual({ type: 'mate', value: 5 });
    expect(parseInfoLine('info depth 12 score mate -3 pv e2e4')?.score).toEqual({ type: 'mate', value: -3 });
    expect(parseInfoLine('info depth 0 score mate 0')?.score).toEqual({ type: 'mate', value: 0 });
  });

  it('parses negative and very large centipawn scores', () => {
    expect(parseInfoLine('info depth 9 score cp -1350 pv e2e4')?.score).toEqual({ type: 'cp', value: -1350 });
    expect(parseInfoLine('info depth 9 score cp 29999 pv e2e4')?.score).toEqual({ type: 'cp', value: 29999 });
  });

  it('records score bounds', () => {
    expect(parseInfoLine('info depth 14 score cp 40 lowerbound pv e2e4')?.bound).toBe('lower');
    expect(parseInfoLine('info depth 14 score cp 40 upperbound pv e2e4')?.bound).toBe('upper');
  });

  it('parses multipv indexes', () => {
    expect(parseInfoLine('info depth 10 multipv 3 score cp 5 pv d2d4')?.multipv).toBe(3);
  });

  it('stops the pv at the first non-move token', () => {
    const info = parseInfoLine('info depth 5 score cp 10 pv e2e4 e7e5 string junk');
    expect(info?.pv).toEqual(['e2e4', 'e7e5']);
  });

  it('reads promotion moves in the pv', () => {
    expect(parseInfoLine('info depth 5 score cp 10 pv a7a8q')?.pv).toEqual(['a7a8q']);
  });

  it('handles currmove progress lines', () => {
    const info = parseInfoLine('info depth 20 currmove e2e4 currmovenumber 1');
    expect(info?.currMove).toBe('e2e4');
    expect(info?.score).toBeNull();
  });

  it('ignores lines that carry nothing we track', () => {
    expect(parseInfoLine('info string NNUE evaluation using nn-9067e33176e.nnue')).toBeNull();
    expect(parseInfoLine('bestmove e2e4')).toBeNull();
    expect(parseInfoLine('uciok')).toBeNull();
    expect(parseInfoLine('info')).toBeNull();
  });
});

describe('parseBestMove', () => {
  it('reads the best move and ponder move', () => {
    expect(parseBestMove('bestmove e2e4 ponder e7e5')).toEqual({ bestMove: 'e2e4', ponder: 'e7e5' });
    expect(parseBestMove('bestmove g1f3')).toEqual({ bestMove: 'g1f3', ponder: null });
  });

  it('treats "(none)" as no move — a terminal position', () => {
    expect(parseBestMove('bestmove (none)')).toEqual({ bestMove: null, ponder: null });
  });

  it('returns null for other lines', () => {
    expect(parseBestMove('info depth 4')).toBeNull();
  });
});

describe('isUciMove', () => {
  it('accepts squares and promotions only', () => {
    expect(isUciMove('e2e4')).toBe(true);
    expect(isUciMove('a7a8q')).toBe(true);
    expect(isUciMove('e1g1')).toBe(true);
    expect(isUciMove('0000')).toBe(false);
    expect(isUciMove('e2e9')).toBe(false);
    expect(isUciMove('string')).toBe(false);
  });
});

describe('mergePvLine', () => {
  const toSan = () => [];

  it('keeps the deepest line per multipv slot', () => {
    const lines = new Map<number, PvLine>();
    mergePvLine(lines, parseInfoLine('info depth 8 multipv 1 score cp 10 pv e2e4')!, toSan);
    mergePvLine(lines, parseInfoLine('info depth 14 multipv 1 score cp 30 pv d2d4')!, toSan);
    expect(lines.get(1)?.depth).toBe(14);
    expect(lines.get(1)?.pv).toEqual(['d2d4']);
  });

  it('does not let a shallower line overwrite a deeper one', () => {
    const lines = new Map<number, PvLine>();
    mergePvLine(lines, parseInfoLine('info depth 14 multipv 1 score cp 30 pv d2d4')!, toSan);
    mergePvLine(lines, parseInfoLine('info depth 8 multipv 1 score cp 10 pv e2e4')!, toSan);
    expect(lines.get(1)?.depth).toBe(14);
  });

  it('discards provisional bounded scores', () => {
    const lines = new Map<number, PvLine>();
    mergePvLine(lines, parseInfoLine('info depth 14 score cp 30 lowerbound pv d2d4')!, toSan);
    expect(lines.size).toBe(0);
  });

  it('ignores lines with no pv or no score', () => {
    const lines = new Map<number, PvLine>();
    mergePvLine(lines, parseInfoLine('info depth 14 score cp 30')!, toSan);
    mergePvLine(lines, parseInfoLine('info depth 20 currmove e2e4 currmovenumber 1')!, toSan);
    expect(lines.size).toBe(0);
  });

  it('sorts collected lines by multipv rank', () => {
    const lines = new Map<number, PvLine>();
    mergePvLine(lines, parseInfoLine('info depth 12 multipv 3 score cp -20 pv c2c4')!, toSan);
    mergePvLine(lines, parseInfoLine('info depth 12 multipv 1 score cp 30 pv e2e4')!, toSan);
    mergePvLine(lines, parseInfoLine('info depth 12 multipv 2 score cp 10 pv d2d4')!, toSan);
    expect(collectPvLines(lines).map((line) => line.multipv)).toEqual([1, 2, 3]);
  });
});
