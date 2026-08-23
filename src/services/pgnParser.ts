import { Chess } from 'chess.js';
import type { Color, GameOutcome, ParsedGame, ParsedMove, PgnHeaders } from '@/types/game';
import { START_FEN } from '@/utils/chess';

/** Thrown when a PGN cannot be turned into a playable game. */
export class PgnError extends Error {
  readonly reason: 'empty' | 'no-moves' | 'invalid';

  constructor(message: string, reason: 'empty' | 'no-moves' | 'invalid' = 'invalid') {
    super(message);
    this.name = 'PgnError';
    this.reason = reason;
  }

  get userMessage(): string {
    switch (this.reason) {
      case 'empty':
        return 'This game has no PGN attached, so it cannot be analysed.';
      case 'no-moves':
        return 'This PGN contains no moves — the game may have been aborted before the first move.';
      default:
        return 'This PGN could not be read. It may be malformed or use an unsupported variant.';
    }
  }
}

const HEADER_RE = /^\s*\[\s*([A-Za-z0-9_]+)\s+"((?:[^"\\]|\\.)*)"\s*\]\s*$/;

/**
 * Read the tag-pair block. Done with a dedicated pass rather than via chess.js so
 * that metadata survives even when the movetext is unusable.
 */
export function parsePgnHeaders(pgn: string): PgnHeaders {
  const headers: PgnHeaders = {};
  for (const line of pgn.split(/\r?\n/)) {
    if (line.trim().length === 0) continue;
    const match = HEADER_RE.exec(line);
    if (!match) {
      // Tag pairs always precede the movetext; stop at the first non-tag line.
      if (line.trim().startsWith('[')) continue;
      break;
    }
    headers[match[1]] = match[2].replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  }
  return headers;
}

/** `0:02:57.1` / `1:59:59` → seconds. */
export function parseClock(value: string): number | null {
  const match = /^(\d+):(\d{1,2}):(\d{1,2}(?:\.\d+)?)$/.exec(value.trim());
  if (!match) {
    const short = /^(\d{1,2}):(\d{1,2}(?:\.\d+)?)$/.exec(value.trim());
    if (!short) return null;
    return Number(short[1]) * 60 + Number(short[2]);
  }
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
}

function extractClock(comment: string | undefined): number | null {
  if (!comment) return null;
  const match = /\[%clk\s+([^\]]+)\]/.exec(comment);
  return match ? parseClock(match[1]) : null;
}

function outcomeFromResult(result: string | undefined): GameOutcome {
  switch (result) {
    case '1-0':
    case '0-1':
    case '1/2-1/2':
      return result;
    default:
      return '*';
  }
}

/**
 * Sanitise a PGN before it is parsed or rendered.
 *
 * Chess.com PGNs are trusted-ish, but the movetext is user-influenced (usernames
 * and event names land in tag pairs), so anything that could be interpreted as
 * markup is stripped and the payload is length-capped.
 */
export function sanitisePgn(pgn: string): string {
  return pgn
    // Strip a leading byte-order mark.
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n')
    // Remove control characters that have no business in a PGN.
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .slice(0, 500_000);
}

/**
 * Parse a PGN into moves plus the FEN of every position along the way.
 * Throws `PgnError` for empty / move-less / unreadable input.
 */
export function parsePgn(rawPgn: string | null | undefined): ParsedGame {
  if (!rawPgn || rawPgn.trim().length === 0) {
    throw new PgnError('PGN is empty', 'empty');
  }

  const pgn = sanitisePgn(rawPgn);
  const headers = parsePgnHeaders(pgn);
  const isChess960 = (headers.Variant ?? '').toLowerCase().includes('960');

  const chess = new Chess();
  try {
    chess.loadPgn(pgn, { strict: false });
  } catch (error) {
    // A truncated download or an unsupported variant lands here.
    throw new PgnError(error instanceof Error ? error.message : 'Unreadable PGN', 'invalid');
  }

  const history = chess.history({ verbose: true });
  if (history.length === 0) {
    throw new PgnError('PGN contained no moves', 'no-moves');
  }

  const commentsByFen = new Map<string, string>();
  for (const entry of chess.getComments()) commentsByFen.set(entry.fen, entry.comment);

  const moves: ParsedMove[] = history.map((move, index) => {
    const color: Color = move.color === 'w' ? 'white' : 'black';
    // The full-move counter is field 6 of the position the move was played from,
    // which keeps numbering correct for games that start from a custom FEN.
    const moveNumber = Number.parseInt(move.before.split(' ')[5] ?? '1', 10) || 1;

    return {
      ply: index,
      moveNumber,
      color,
      san: move.san,
      uci: move.lan,
      from: move.from,
      to: move.to,
      piece: move.piece,
      captured: move.captured,
      promotion: move.promotion,
      fenBefore: move.before,
      fenAfter: move.after,
      clockSeconds: extractClock(commentsByFen.get(move.after)),
      secondsSpent: null,
      check: move.san.includes('+'),
      mate: move.san.includes('#'),
    };
  });

  annotateThinkTime(moves, headers);

  // chess.js reports the true starting position on the first move, which also
  // covers games that begin from a `[SetUp]`/`[FEN]` header.
  const initialFen = history[0]?.before ?? headers.FEN ?? START_FEN;
  const positions = [initialFen, ...moves.map((m) => m.fenAfter)];

  return {
    headers,
    moves,
    initialFen,
    positions,
    outcome: outcomeFromResult(headers.Result),
    isChess960,
  };
}

/**
 * Fill in how long each move actually took, from the clock left before and after.
 *
 * A player's clock runs down from their previous reading, and any increment is
 * added back after the move, so the time spent is
 * `previousClock - currentClock + increment`. The first move of each side counts
 * down from the time control's base time.
 *
 * Games without `[%clk]` comments simply keep `null`, and the UI hides the column.
 */
function annotateThinkTime(moves: ParsedMove[], headers: PgnHeaders): void {
  const base = parseBaseTime(headers.TimeControl);
  const increment = parseIncrement(headers.TimeControl) ?? 0;
  const previous: Record<Color, number | null> = { white: base, black: base };

  for (const move of moves) {
    const before = previous[move.color];
    if (move.clockSeconds === null || before === null) continue;

    const spent = before - move.clockSeconds + increment;
    // Clocks can drift by a tick either way; only keep plausible readings.
    move.secondsSpent = spent >= 0 && spent < 24 * 3600 ? Math.round(spent * 10) / 10 : null;
    previous[move.color] = move.clockSeconds;
  }
}

/** Non-throwing variant used where a failure should degrade rather than crash. */
export function tryParsePgn(pgn: string | null | undefined): ParsedGame | null {
  try {
    return parsePgn(pgn);
  } catch {
    return null;
  }
}

/**
 * Wall-clock length of the game in seconds.
 * Prefers the Chess.com `StartTime`/`EndTime` tag pairs (with date rollover
 * handled), and falls back to the difference between the players' clocks.
 */
export function gameDurationSeconds(headers: PgnHeaders, moves: ParsedMove[]): number | null {
  const start = combineDateTime(headers.UTCDate ?? headers.Date, headers.StartTime);
  const end = combineDateTime(headers.EndDate ?? headers.UTCDate ?? headers.Date, headers.EndTime);
  if (start !== null && end !== null && end >= start) {
    const delta = end - start;
    // Daily games span days; only trust the timestamp path for sane live values.
    if (delta > 0 && delta < 24 * 3600) return delta;
  }

  // Fallback: base time minus what each player had left, summed over both sides.
  const base = parseBaseTime(headers.TimeControl);
  if (base === null) return null;
  const lastWhite = [...moves].reverse().find((m) => m.color === 'white' && m.clockSeconds !== null);
  const lastBlack = [...moves].reverse().find((m) => m.color === 'black' && m.clockSeconds !== null);
  if (!lastWhite || !lastBlack) return null;
  const increment = parseIncrement(headers.TimeControl) ?? 0;
  const whiteMoves = moves.filter((m) => m.color === 'white').length;
  const blackMoves = moves.filter((m) => m.color === 'black').length;
  const used =
    base - (lastWhite.clockSeconds ?? 0) + increment * whiteMoves +
    (base - (lastBlack.clockSeconds ?? 0) + increment * blackMoves);
  return used > 0 ? Math.round(used) : null;
}

function combineDateTime(date: string | undefined, time: string | undefined): number | null {
  if (!time) return null;
  const timeSeconds = parseClock(time);
  if (timeSeconds === null) return null;
  if (!date) return timeSeconds;
  const match = /^(\d{4})\.(\d{2})\.(\d{2})$/.exec(date);
  if (!match) return timeSeconds;
  const days = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) / 1000;
  return days + timeSeconds;
}

/** Base seconds from a PGN `TimeControl` tag (`180+2`, `600`, `1/259200`). */
export function parseBaseTime(timeControl: string | undefined): number | null {
  if (!timeControl || timeControl === '-') return null;
  if (timeControl.includes('/')) {
    const perMove = Number.parseInt(timeControl.split('/')[1] ?? '', 10);
    return Number.isFinite(perMove) ? perMove : null;
  }
  const base = Number.parseInt(timeControl.split('+')[0] ?? '', 10);
  return Number.isFinite(base) ? base : null;
}

export function parseIncrement(timeControl: string | undefined): number | null {
  if (!timeControl || !timeControl.includes('+')) return null;
  const inc = Number.parseInt(timeControl.split('+')[1] ?? '', 10);
  return Number.isFinite(inc) ? inc : null;
}

/** Number of full moves in the game (Black's reply shares White's number). */
export function fullMoveCount(moves: ParsedMove[]): number {
  return Math.ceil(moves.length / 2);
}
