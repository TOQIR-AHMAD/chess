import { describe, expect, it } from 'vitest';
import { Chess } from 'chess.js';
import { ECO_BOOK } from '@/data/eco';
import { bookDepthFor, detectOpening, matchBookLine, splitOpeningName } from './openings';

describe('ECO book integrity', () => {
  it('contains only legal move sequences', () => {
    const invalid: string[] = [];
    for (const entry of ECO_BOOK) {
      const chess = new Chess();
      for (const san of entry.moves.split(' ')) {
        try {
          chess.move(san);
        } catch {
          invalid.push(`${entry.eco} ${entry.name}: illegal "${san}" in "${entry.moves}"`);
          break;
        }
      }
    }
    expect(invalid).toEqual([]);
  });

  it('has a well-formed ECO code and a name for every entry', () => {
    for (const entry of ECO_BOOK) {
      expect(entry.eco).toMatch(/^[A-E]\d{2}$/);
      expect(entry.name.trim().length).toBeGreaterThan(0);
    }
  });

  it('has no duplicate move sequences', () => {
    const seen = new Set<string>();
    const duplicates: string[] = [];
    for (const entry of ECO_BOOK) {
      if (seen.has(entry.moves)) duplicates.push(entry.moves);
      seen.add(entry.moves);
    }
    expect(duplicates).toEqual([]);
  });
});

describe('matchBookLine', () => {
  it('finds the longest matching line', () => {
    const match = matchBookLine(['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5', 'c3', 'Nf6']);
    expect(match?.name).toBe('Italian Game, Giuoco Piano');
    expect(match?.eco).toBe('C50');
  });

  it('prefers the specific variation over the family', () => {
    expect(matchBookLine(['e4', 'e5', 'Nf3', 'Nc6', 'Bc4'])?.name).toBe('Italian Game');
    expect(matchBookLine(['e4', 'c5', 'Nf3', 'd6', 'd4', 'cxd4', 'Nxd4', 'Nf6', 'Nc3', 'a6'])?.name).toBe(
      'Sicilian Defense, Najdorf Variation',
    );
  });

  it('ignores check, mate and annotation marks', () => {
    expect(matchBookLine(['e4', 'c5', 'Nf3', 'd6', 'Bb5+'])?.name).toBe('Sicilian Defense, Moscow Variation');
    expect(matchBookLine(['e4!', 'e5?!'])?.name).toBeTruthy();
  });

  it('accepts zero-notation castling', () => {
    const withZeroes = ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'Nf6', '0-0', 'Nxe4'];
    expect(matchBookLine(withZeroes)?.eco).toBe('C67');
  });

  it('returns null when the game leaves theory immediately', () => {
    expect(matchBookLine(['h4', 'a5'])).toBeNull();
    expect(matchBookLine([])).toBeNull();
  });

  it('recognises a transposition into a known line', () => {
    // The King's Indian reached through an English move order — never starts 1.d4.
    const transposed = ['c4', 'g6', 'd4', 'Bg7', 'Nc3', 'Nf6', 'e4', 'd6'];
    expect(matchBookLine(transposed)?.name).toBe("King's Indian Defense, Main Line");

    // The Italian reached via 2...Nc6 3.Bc4 from a Bishop's Opening move order.
    const italian = ['e4', 'e5', 'Bc4', 'Nc6', 'Nf3', 'Bc5', 'c3'];
    expect(matchBookLine(italian)?.name).toBe('Italian Game, Giuoco Piano');
  });
});

describe('detectOpening', () => {
  const italian = ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5', 'c3'];

  it('prefers the name Chess.com supplies in the PGN', () => {
    const opening = detectOpening(italian, {
      ECO: 'C50',
      ECOUrl: 'https://www.chess.com/openings/Italian-Game-Giuoco-Pianissimo-4.d3',
    });
    expect(opening?.source).toBe('pgn');
    expect(opening?.name).toBe('Italian Game Giuoco Pianissimo');
    expect(opening?.eco).toBe('C50');
    expect(opening?.bookPlies).toBeGreaterThan(0);
  });

  it('falls back to the bundled database when the PGN has no opening tags', () => {
    const opening = detectOpening(italian, {});
    expect(opening?.source).toBe('database');
    expect(opening?.name).toBe('Italian Game, Giuoco Piano');
    expect(opening?.eco).toBe('C50');
  });

  it('reports an ECO code even when no name is available', () => {
    const opening = detectOpening(['h4', 'a5'], { ECO: 'A00' });
    expect(opening?.name).toBe('ECO A00');
    expect(opening?.bookPlies).toBe(0);
  });

  it('returns null rather than guessing when nothing is known', () => {
    expect(detectOpening(['h4', 'a5'], {})).toBeNull();
    expect(detectOpening([], {})).toBeNull();
  });

  it('strips the trailing move sequence from a Chess.com opening slug', () => {
    const opening = detectOpening([], {
      ECOUrl: 'https://www.chess.com/openings/Kings-Pawn-Opening-Wayward-Queen-Attack-2...Nc6',
    });
    expect(opening?.name).toBe('Kings Pawn Opening Wayward Queen Attack');
  });
});

describe('bookDepthFor', () => {
  it('reports how many plies of the game are known theory', () => {
    expect(bookDepthFor(['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5', 'c3', 'Nf6', 'd4'], 16)).toBe(7);
  });

  it('counts theory reached by transposition', () => {
    // All eight plies are opening theory even though the move order never starts 1.d4:
    // the position after 4...d6 sits inside the King's Indian Classical line.
    expect(bookDepthFor(['c4', 'g6', 'd4', 'Bg7', 'Nc3', 'Nf6', 'e4', 'd6'], 16)).toBe(8);
  });

  it('stops counting as soon as the game leaves the book', () => {
    // 2...a5 is not theory, so the later moves cannot be book either.
    expect(bookDepthFor(['e4', 'e5', 'Nf3', 'a5', 'Bc4', 'Nc6'], 16)).toBe(3);
  });

  it('never exceeds the configured cap', () => {
    expect(bookDepthFor(['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5', 'c3'], 4)).toBe(4);
  });

  it('is zero for a game that leaves theory at once', () => {
    expect(bookDepthFor(['h4', 'a5'], 16)).toBe(0);
  });
});

describe('splitOpeningName', () => {
  it('separates the family from the variation', () => {
    expect(splitOpeningName('Sicilian Defense, Najdorf Variation')).toEqual({
      family: 'Sicilian Defense',
      variation: 'Najdorf Variation',
    });
    expect(splitOpeningName('Ruy Lopez')).toEqual({ family: 'Ruy Lopez', variation: null });
  });
});
