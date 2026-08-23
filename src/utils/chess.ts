import { Chess } from 'chess.js';
import type { Color } from '@/types/game';

/** Conventional material values in pawns. Kings are excluded. */
export const PIECE_VALUES: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

export const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

/** Side to move encoded in a FEN. */
export function sideToMove(fen: string): 'w' | 'b' {
  return fen.split(' ')[1] === 'b' ? 'b' : 'w';
}

export function colorName(turn: 'w' | 'b'): Color {
  return turn === 'w' ? 'white' : 'black';
}

/** Material count for one side, in pawns, read straight off the FEN board field. */
export function materialForSide(fen: string, side: 'w' | 'b'): number {
  const board = fen.split(' ')[0] ?? '';
  let total = 0;
  for (const ch of board) {
    if (ch === '/' || (ch >= '1' && ch <= '8')) continue;
    const isWhite = ch === ch.toUpperCase();
    if ((side === 'w') !== isWhite) continue;
    total += PIECE_VALUES[ch.toLowerCase()] ?? 0;
  }
  return total;
}

/** Positive when White is up material. */
export function materialBalance(fen: string): number {
  return materialForSide(fen, 'w') - materialForSide(fen, 'b');
}

/**
 * Static exchange evaluation for one square.
 *
 * Returns the material (in pawns) the side to move wins by starting a sequence of
 * captures on `square`, assuming both sides always recapture with their least
 * valuable piece and either side may stop when continuing would lose material.
 * Legality — pins, discovered checks — is handled by chess.js rather than
 * approximated, which is slower than a bitboard SEE but exact.
 */
export function staticExchangeEval(fen: string, square: string): number {
  const chess = new Chess();
  try {
    chess.load(fen);
  } catch {
    return 0;
  }
  if (!chess.get(square as never)) return 0;
  return seeRecursive(chess, square, 0);
}

function seeRecursive(chess: Chess, square: string, depth: number): number {
  // A square can only be contested a bounded number of times; the guard is belt
  // and braces against a pathological position.
  if (depth > 32) return 0;

  const captures = chess
    .moves({ verbose: true })
    .filter((move) => move.to === square && move.captured);
  if (captures.length === 0) return 0;

  captures.sort(
    (a, b) => (PIECE_VALUES[a.piece] ?? 0) - (PIECE_VALUES[b.piece] ?? 0),
  );
  const chosen = captures[0];
  const won = PIECE_VALUES[chosen.captured ?? 'p'] ?? 0;

  chess.move(chosen);
  // The opponent only recaptures when it is good for them, hence the max(0, …).
  const value = Math.max(0, won - seeRecursive(chess, square, depth + 1));
  chess.undo();
  return value;
}

/**
 * Material the move offers up, in pawns.
 *
 * Two independent signals, combined by taking the larger:
 *
 *  1. **Exchange on the destination square** — what the move captured minus what
 *     the opponent wins back by starting captures there. An even trade nets zero;
 *     `Rxf7` answered by `Kxf7` nets four. This also catches *declined* sacrifices,
 *     because the offer is measured whether or not the engine's line accepts it.
 *  2. **Dip along the principal variation** — the worst material balance the mover
 *     reaches over the next few plies, which catches material given up somewhere
 *     other than the square just moved to.
 *
 * Returns a positive number when material was given up, 0 otherwise.
 */
export function sacrificedMaterial(fenBefore: string, uciMoves: string[], lookaheadPlies = 6): number {
  const played = uciMoves[0];
  if (!played) return 0;

  const chess = new Chess();
  try {
    chess.load(fenBefore);
  } catch {
    return 0;
  }

  let moved;
  try {
    moved = chess.move({
      from: played.slice(0, 2),
      to: played.slice(2, 4),
      promotion: played.length > 4 ? played[4] : undefined,
    });
  } catch {
    return 0;
  }
  if (!moved) return 0;

  const captured = PIECE_VALUES[moved.captured ?? ''] ?? 0;
  const recaptured = staticExchangeEval(chess.fen(), moved.to);
  const exchangeOffer = Math.max(0, recaptured - captured);

  const pvDip = principalVariationDip(fenBefore, uciMoves, lookaheadPlies);

  const offered = Math.max(exchangeOffer, pvDip);
  return offered > 0 ? Number(offered.toFixed(2)) : 0;
}

/** Worst material balance the mover reaches along the engine's line. */
function principalVariationDip(fenBefore: string, uciMoves: string[], lookaheadPlies: number): number {
  const mover = sideToMove(fenBefore);
  const sign = mover === 'w' ? 1 : -1;
  const before = materialBalance(fenBefore) * sign;

  const chess = new Chess();
  try {
    chess.load(fenBefore);
  } catch {
    return 0;
  }

  let worst = before;
  for (let i = 0; i < Math.min(uciMoves.length, lookaheadPlies); i += 1) {
    const uci = uciMoves[i];
    if (!uci) break;
    try {
      const move = chess.move({
        from: uci.slice(0, 2),
        to: uci.slice(2, 4),
        promotion: uci.length > 4 ? uci[4] : undefined,
      });
      if (!move) break;
    } catch {
      break;
    }
    // Only sample after the opponent has had the chance to recapture.
    if (i % 2 === 1) {
      worst = Math.min(worst, materialBalance(chess.fen()) * sign);
    }
  }

  const deficit = before - worst;
  return deficit > 0 ? Number(deficit.toFixed(2)) : 0;
}

/** Convert a UCI move to SAN in the context of `fen`. Returns null when illegal. */
export function uciToSan(fen: string, uci: string): string | null {
  const chess = new Chess();
  try {
    chess.load(fen);
    const move = chess.move({
      from: uci.slice(0, 2),
      to: uci.slice(2, 4),
      promotion: uci.length > 4 ? uci[4] : undefined,
    });
    return move ? move.san : null;
  } catch {
    return null;
  }
}

/** Convert a whole UCI principal variation into SAN, stopping at the first illegal move. */
export function uciLineToSan(fen: string, uciMoves: string[], limit = 12): string[] {
  const chess = new Chess();
  try {
    chess.load(fen);
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const uci of uciMoves.slice(0, limit)) {
    try {
      const move = chess.move({
        from: uci.slice(0, 2),
        to: uci.slice(2, 4),
        promotion: uci.length > 4 ? uci[4] : undefined,
      });
      if (!move) break;
      out.push(move.san);
    } catch {
      break;
    }
  }
  return out;
}

/** Render a SAN line with move numbers: `24. Rxf7+ Kxf7 25. Qh5+`. */
export function formatSanLine(fen: string, san: string[], maxPlies = 8): string {
  if (san.length === 0) return '';
  const parts = fen.split(' ');
  let moveNumber = Number.parseInt(parts[5] ?? '1', 10);
  if (!Number.isFinite(moveNumber)) moveNumber = 1;
  let whiteToMove = (parts[1] ?? 'w') === 'w';

  const out: string[] = [];
  for (const move of san.slice(0, maxPlies)) {
    if (whiteToMove) {
      out.push(`${moveNumber}. ${move}`);
    } else {
      out.push(out.length === 0 ? `${moveNumber}... ${move}` : move);
      moveNumber += 1;
    }
    whiteToMove = !whiteToMove;
  }
  return out.join(' ');
}

/** Legal destination squares for a piece, used for click-to-move highlighting. */
export function legalTargets(fen: string, square: string): string[] {
  const chess = new Chess();
  try {
    chess.load(fen);
    return chess
      .moves({ square: square as never, verbose: true })
      .map((m) => (typeof m === 'string' ? m : m.to));
  } catch {
    return [];
  }
}

/** True when the side to move is in check. */
export function isInCheck(fen: string): boolean {
  const chess = new Chess();
  try {
    chess.load(fen);
    return chess.inCheck();
  } catch {
    return false;
  }
}

/** Square occupied by the king of the given side, or null. */
export function kingSquare(fen: string, side: 'w' | 'b'): string | null {
  const chess = new Chess();
  try {
    chess.load(fen);
  } catch {
    return null;
  }
  const target = side === 'w' ? 'K' : 'k';
  for (const row of chess.board()) {
    for (const cell of row) {
      if (cell && (cell.color === 'w' ? 'K' : 'k') === target && cell.type === 'k') return cell.square;
    }
  }
  return null;
}

/** Terminal state of a position, or null when the game continues. */
export function terminalState(fen: string): 'checkmate' | 'stalemate' | 'draw' | null {
  const chess = new Chess();
  try {
    chess.load(fen);
  } catch {
    return null;
  }
  if (chess.isCheckmate()) return 'checkmate';
  if (chess.isStalemate()) return 'stalemate';
  if (chess.isDraw()) return 'draw';
  return null;
}

/**
 * Material still on the board for each side, plus the captured pieces, so the
 * board panel can show the familiar "+3" material indicator.
 */
export function materialSnapshot(fen: string): {
  white: number;
  black: number;
  diff: number;
  capturedByWhite: string[];
  capturedByBlack: string[];
} {
  const START_COUNTS: Record<string, number> = { p: 8, n: 2, b: 2, r: 2, q: 1 };
  const counts: Record<'w' | 'b', Record<string, number>> = {
    w: { p: 0, n: 0, b: 0, r: 0, q: 0 },
    b: { p: 0, n: 0, b: 0, r: 0, q: 0 },
  };
  const board = fen.split(' ')[0] ?? '';
  for (const ch of board) {
    if (ch === '/' || (ch >= '1' && ch <= '8')) continue;
    const lower = ch.toLowerCase();
    if (lower === 'k') continue;
    const side: 'w' | 'b' = ch === ch.toUpperCase() ? 'w' : 'b';
    if (counts[side][lower] !== undefined) counts[side][lower] += 1;
  }

  const capturedByWhite: string[] = [];
  const capturedByBlack: string[] = [];
  for (const [piece, start] of Object.entries(START_COUNTS)) {
    // Promotions can push a count above the starting number; clamp at 0.
    const missingBlack = Math.max(0, start - (counts.b[piece] ?? 0));
    const missingWhite = Math.max(0, start - (counts.w[piece] ?? 0));
    for (let i = 0; i < missingBlack; i += 1) capturedByWhite.push(piece);
    for (let i = 0; i < missingWhite; i += 1) capturedByBlack.push(piece);
  }

  const white = materialForSide(fen, 'w');
  const black = materialForSide(fen, 'b');
  return {
    white,
    black,
    diff: Math.round((white - black) * 100) / 100,
    capturedByWhite,
    capturedByBlack,
  };
}
