import { Chess } from 'chess.js';
import { ECO_BOOK, type EcoEntry } from '@/data/eco';
import type { PgnHeaders } from '@/types/game';
import { openingNameFromUrl } from '@/utils/format';

/**
 * Opening identification.
 *
 * Two independent sources are used, in this order of trust:
 *   1. The PGN tag pairs Chess.com ships (`ECO`, `ECOUrl`, `Opening`). These come
 *      straight from their opening database and are authoritative.
 *   2. The bundled ECO table (`data/eco.ts`).
 *
 * The bundled table is matched **by position, not by move order**. Openings
 * transpose constantly — `1.c4 g6 2.d4 Bg7 3.Nc3 Nf6 4.e4` reaches the King's
 * Indian without ever starting `1.d4` — and a naive prefix match would give up at
 * the first move. Every book line is replayed once and indexed by the positions it
 * passes through, so any move order that reaches a known position is recognised.
 *
 * If neither source yields a name, `null` is returned — the UI then says the
 * opening is unknown rather than guessing.
 */

export interface OpeningInfo {
  name: string;
  eco: string | null;
  url: string | null;
  /** How many plies of the game are covered by a known book line. */
  bookPlies: number;
  source: 'pgn' | 'database';
}

/** Deepest book line in the table; games are only replayed this far. */
const MAX_BOOK_PLIES = 24;

interface BookIndex {
  /** Position → the most specific line that *ends* there. */
  named: Map<string, EcoEntry>;
  /** Every position any book line passes through. */
  known: Set<string>;
}

let indexCache: BookIndex | null = null;

/**
 * Positions compare on board, side to move, castling rights and en-passant file —
 * the move counters are irrelevant to whether two games have reached the same spot.
 */
function positionKey(fen: string): string {
  return fen.split(' ').slice(0, 4).join(' ');
}

/** Strip check/mate marks and annotation glyphs so SAN compares and replays cleanly. */
function normaliseSan(san: string): string {
  return san
    .replace(/[+#!?]/g, '')
    .replace(/0-0-0/g, 'O-O-O')
    .replace(/0-0/g, 'O-O');
}

/** Build (once) the position index for the bundled book. */
function bookIndex(): BookIndex {
  if (indexCache) return indexCache;

  const named = new Map<string, EcoEntry>();
  const known = new Set<string>();

  // Longest lines first, so the most specific name claims a shared position.
  const entries = [...ECO_BOOK].sort(
    (a, b) => b.moves.split(' ').length - a.moves.split(' ').length,
  );

  for (const entry of entries) {
    const chess = new Chess();
    let ok = true;
    for (const san of entry.moves.split(' ')) {
      try {
        if (!chess.move(normaliseSan(san))) {
          ok = false;
          break;
        }
      } catch {
        ok = false;
        break;
      }
      known.add(positionKey(chess.fen()));
    }
    if (!ok) continue;
    const key = positionKey(chess.fen());
    if (!named.has(key)) named.set(key, entry);
  }

  indexCache = { named, known };
  return indexCache;
}

/** Replay a game's opening moves, returning the position after each ply. */
function positionsFor(sanMoves: string[], limit = MAX_BOOK_PLIES): string[] {
  const chess = new Chess();
  const positions: string[] = [];
  for (const san of sanMoves.slice(0, limit)) {
    try {
      if (!chess.move(normaliseSan(san))) break;
    } catch {
      break;
    }
    positions.push(positionKey(chess.fen()));
  }
  return positions;
}

/**
 * The most specific book line the game reaches, by position.
 * Returns the deepest match, so a game that stays in theory is named by the
 * variation it ends up in rather than the family it started from.
 */
export function matchBookLine(sanMoves: string[]): EcoEntry | null {
  if (sanMoves.length === 0) return null;
  const { named } = bookIndex();
  const positions = positionsFor(sanMoves);

  for (let i = positions.length - 1; i >= 0; i -= 1) {
    const entry = named.get(positions[i]);
    if (entry) return entry;
  }
  return null;
}

/**
 * How many plies from the start the game counts as opening theory.
 *
 * This is the *deepest* ply that lands on a known book position, not the longest
 * unbroken run of them. Transpositions pass through move orders the table does not
 * list — `1.c4 g6 2.d4 Bg7 3.Nc3 Nf6` is off-book for four plies and then arrives
 * at a named King's Indian position — and stopping at the first gap would call
 * almost every transposed opening "out of book" by move two.
 *
 * Crediting everything up to the deepest match is safe because every position in
 * the table is an opening position: a game cannot reach one by accident in the
 * middlegame, so a late match really does mean the players were still in theory.
 */
export function bookDepthFor(sanMoves: string[], maxPlies: number): number {
  if (maxPlies <= 0 || sanMoves.length === 0) return 0;
  const { known } = bookIndex();
  const positions = positionsFor(sanMoves, Math.min(maxPlies, MAX_BOOK_PLIES));

  let deepest = 0;
  for (let i = 0; i < positions.length; i += 1) {
    if (known.has(positions[i])) deepest = i + 1;
  }
  return Math.min(deepest, maxPlies);
}

export function detectOpening(sanMoves: string[], headers: PgnHeaders = {}): OpeningInfo | null {
  const book = matchBookLine(sanMoves);
  const bookPlies = bookDepthFor(sanMoves, MAX_BOOK_PLIES);

  const pgnName = headers.Opening?.trim() || openingNameFromUrl(headers.ECOUrl);
  const pgnEco = headers.ECO?.trim() || null;

  if (pgnName) {
    return {
      name: pgnName,
      eco: pgnEco ?? book?.eco ?? null,
      url: headers.ECOUrl ?? null,
      bookPlies,
      source: 'pgn',
    };
  }

  if (book) {
    return { name: book.name, eco: book.eco, url: null, bookPlies, source: 'database' };
  }

  // An ECO code with no name is still worth surfacing.
  if (pgnEco) {
    return { name: `ECO ${pgnEco}`, eco: pgnEco, url: headers.ECOUrl ?? null, bookPlies, source: 'pgn' };
  }

  return null;
}

/** Split an opening name into its family and variation, for a two-line display. */
export function splitOpeningName(name: string): { family: string; variation: string | null } {
  const separators = [', ', ': '];
  for (const separator of separators) {
    const index = name.indexOf(separator);
    if (index > 0) {
      return { family: name.slice(0, index), variation: name.slice(index + separator.length) };
    }
  }
  return { family: name, variation: null };
}
