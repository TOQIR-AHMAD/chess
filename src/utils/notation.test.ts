import { describe, expect, it } from 'vitest';
import { formatThinkTime, splitSan, toFigurine } from './notation';

describe('splitSan', () => {
  it('replaces the piece letter with its figurine', () => {
    expect(splitSan('Nf3')).toEqual({ figurine: '♞', rest: 'f3' });
    expect(splitSan('Bxf7+')).toEqual({ figurine: '♝', rest: 'xf7+' });
    expect(splitSan('Qh5#')).toEqual({ figurine: '♛', rest: 'h5#' });
    expect(splitSan('Rad1')).toEqual({ figurine: '♜', rest: 'ad1' });
    expect(splitSan('Kg1')).toEqual({ figurine: '♚', rest: 'g1' });
  });

  it('leaves pawn moves and castling alone', () => {
    expect(splitSan('e4')).toEqual({ figurine: '', rest: 'e4' });
    expect(splitSan('exd5')).toEqual({ figurine: '', rest: 'exd5' });
    expect(splitSan('O-O')).toEqual({ figurine: '', rest: 'O-O' });
    expect(splitSan('O-O-O')).toEqual({ figurine: '', rest: 'O-O-O' });
  });

  it('keeps the promotion piece as a letter', () => {
    // Only the *moving* piece becomes a symbol; `=Q` stays readable.
    expect(splitSan('e8=Q')).toEqual({ figurine: '', rest: 'e8=Q' });
    expect(splitSan('bxa8=N+')).toEqual({ figurine: '', rest: 'bxa8=N+' });
  });

  it('handles empty input', () => {
    expect(splitSan('')).toEqual({ figurine: '', rest: '' });
  });
});

describe('toFigurine', () => {
  it('rebuilds the move as one string', () => {
    expect(toFigurine('Nf3')).toBe('♞f3');
    expect(toFigurine('e4')).toBe('e4');
    expect(toFigurine('O-O')).toBe('O-O');
  });
});

describe('formatThinkTime', () => {
  it('shows sub-minute thinks in seconds', () => {
    expect(formatThinkTime(2.2)).toBe('2.2s');
    expect(formatThinkTime(0)).toBe('0.0s');
    expect(formatThinkTime(13.9)).toBe('14s');
    expect(formatThinkTime(59)).toBe('59s');
  });

  it('switches to m:ss past a minute', () => {
    expect(formatThinkTime(65)).toBe('1:05');
    expect(formatThinkTime(600)).toBe('10:00');
  });

  it('returns nothing when there is no reading', () => {
    expect(formatThinkTime(null)).toBe('');
    expect(formatThinkTime(-1)).toBe('');
    expect(formatThinkTime(Number.NaN)).toBe('');
  });
});
