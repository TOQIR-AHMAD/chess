import type { ArchiveRef, ChessComGame, GameResultCode } from '@/types/chesscom';
import type { Color, GameOutcome, GameSummary, PgnHeaders } from '@/types/game';
import type { GameFilterState } from '@/types/player';
import { formatTimeControl, openingNameFromUrl } from '@/utils/format';
import { fetchMonthlyGames } from './chessComApi';
import { parsePgnHeaders, parseClock } from './pgnParser';

/**
 * Turns raw monthly-archive entries into the rows the game history renders, and
 * provides the filtering and search helpers the list uses.
 *
 * Deliberately avoids a full chess.js parse per game: a 100-game month would mean
 * 100 move-by-move replays just to render a table. Move counts and durations are
 * read straight off the PGN text instead, and the full parse happens once, lazily,
 * when a game is opened for analysis.
 */

const LOSS_CODES: GameResultCode[] = [
  'checkmated',
  'timeout',
  'resigned',
  'lose',
  'abandoned',
  'kingofthehill',
  'threecheck',
  'bughousepartnerlose',
];

const DRAW_CODES: GameResultCode[] = [
  'agreed',
  'repetition',
  'stalemate',
  'insufficient',
  '50move',
  'timevsinsufficient',
];

export function resultKind(code: GameResultCode | undefined): 'win' | 'loss' | 'draw' | null {
  if (!code) return null;
  if (code === 'win') return 'win';
  if (DRAW_CODES.includes(code)) return 'draw';
  if (LOSS_CODES.includes(code)) return 'loss';
  return null;
}

export function outcomeFrom(white: GameResultCode | undefined, black: GameResultCode | undefined): GameOutcome {
  if (white === 'win') return '1-0';
  if (black === 'win') return '0-1';
  if (resultKind(white) === 'draw' || resultKind(black) === 'draw') return '1/2-1/2';
  return '*';
}

/** Human label for how a game ended, e.g. "Resignation", "Checkmate". */
export function terminationLabel(white: GameResultCode | undefined, black: GameResultCode | undefined): string | null {
  const loser = resultKind(white) === 'win' ? black : white;
  switch (loser) {
    case 'checkmated':
      return 'Checkmate';
    case 'resigned':
      return 'Resignation';
    case 'timeout':
      return 'Timeout';
    case 'abandoned':
      return 'Abandoned';
    case 'agreed':
      return 'Agreement';
    case 'repetition':
      return 'Repetition';
    case 'stalemate':
      return 'Stalemate';
    case 'insufficient':
      return 'Insufficient material';
    case '50move':
      return 'Fifty-move rule';
    case 'timevsinsufficient':
      return 'Timeout vs insufficient material';
    default:
      return null;
  }
}

/**
 * Everything after the tag-pair block.
 *
 * Scans line by line rather than looking for the last `]`: Chess.com movetext is
 * full of `{[%clk 0:02:58]}` comments, and the naive search truncates the game.
 */
function extractMovetext(pgn: string): string {
  const lines = pgn.split(/\r?\n/);
  let index = 0;
  while (index < lines.length) {
    const line = lines[index].trim();
    if (line.length === 0) {
      index += 1;
      continue;
    }
    if (line.startsWith('[') && line.endsWith(']')) {
      index += 1;
      continue;
    }
    break;
  }
  return lines.slice(index).join('\n');
}

/**
 * Count plies without replaying the game: strip comments, NAGs, variations, move
 * numbers and the result token, then count what is left.
 */
export function countPlies(pgn: string | null | undefined): number {
  if (!pgn) return 0;
  const cleaned = extractMovetext(pgn)
    .replace(/\{[^}]*\}/g, ' ')
    .replace(/;[^\n]*/g, ' ')
    .replace(/\$\d+/g, ' ')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\b\d+\.(\.\.)?/g, ' ')
    // The result token ends the movetext. `*` needs its own rule because it is
    // not a word character, so `\b` would never match around it.
    .replace(/\b(?:1-0|0-1|1\/2-1\/2)\b/g, ' ')
    .replace(/(^|\s)\*(\s|$)/g, ' ');
  return cleaned.split(/\s+/).filter((token) => token.length > 0).length;
}

/** Elapsed time of a live game from its `StartTime`/`EndTime` tags. */
function durationFromHeaders(headers: PgnHeaders): number | null {
  const start = headers.StartTime ? parseClock(headers.StartTime) : null;
  const end = headers.EndTime ? parseClock(headers.EndTime) : null;
  if (start === null || end === null) return null;
  let delta = end - start;
  // Games that run past midnight UTC wrap around.
  if (delta < 0) delta += 24 * 3600;
  return delta >= 0 && delta < 24 * 3600 ? delta : null;
}

/** Numeric game id from a Chess.com game URL. */
export function gameIdFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const match = /\/game\/(?:live|daily)\/(\d+)/.exec(url);
  if (match) return match[1];
  const tail = url.split('/').filter(Boolean).pop();
  return tail && /^[\w-]+$/.test(tail) ? tail : null;
}

export function toGameSummary(
  game: ChessComGame,
  archive: { year: number; month: number },
  viewer: string,
): GameSummary {
  const headers = game.pgn ? parsePgnHeaders(game.pgn) : {};
  const plies = countPlies(game.pgn);
  const viewerLower = viewer.toLowerCase();

  const whiteName = game.white.username;
  const blackName = game.black.username;
  const playerColor: Color | null =
    whiteName.toLowerCase() === viewerLower ? 'white' : blackName.toLowerCase() === viewerLower ? 'black' : null;

  const playerResult =
    playerColor === 'white'
      ? resultKind(game.white.result)
      : playerColor === 'black'
        ? resultKind(game.black.result)
        : null;

  const id = gameIdFromUrl(game.url) ?? game.uuid ?? `${archive.year}-${archive.month}-${game.end_time ?? 0}`;
  const ecoUrl = game.eco ?? headers.ECOUrl ?? null;

  return {
    id,
    url: game.url ?? headers.Link ?? null,
    white: {
      username: whiteName,
      rating: typeof game.white.rating === 'number' ? game.white.rating : null,
      result: game.white.result ?? null,
      accuracy: typeof game.accuracies?.white === 'number' ? game.accuracies.white : null,
    },
    black: {
      username: blackName,
      rating: typeof game.black.rating === 'number' ? game.black.rating : null,
      result: game.black.result ?? null,
      accuracy: typeof game.accuracies?.black === 'number' ? game.accuracies.black : null,
    },
    outcome: outcomeFrom(game.white.result, game.black.result),
    playerResult,
    playerColor,
    timeClass: game.time_class ?? null,
    timeControl: game.time_control ?? headers.TimeControl ?? null,
    timeControlLabel: formatTimeControl(game.time_control ?? headers.TimeControl, game.time_class),
    rated: game.rated !== false,
    rules: game.rules ?? 'chess',
    endTime: typeof game.end_time === 'number' ? game.end_time : null,
    startTime: typeof game.start_time === 'number' ? game.start_time : null,
    durationSeconds: durationFromHeaders(headers),
    moveCount: Math.ceil(plies / 2),
    eco: headers.ECO ?? null,
    ecoUrl,
    openingName: headers.Opening ?? openingNameFromUrl(ecoUrl),
    event: headers.Event ?? null,
    termination: terminationLabel(game.white.result, game.black.result),
    pgn: game.pgn ?? null,
    archive,
    raw: game,
  };
}

/** Load and normalise one month of games, newest first. */
export async function loadArchive(
  username: string,
  ref: ArchiveRef,
  signal?: AbortSignal,
): Promise<GameSummary[]> {
  const games = await fetchMonthlyGames(username, ref.year, ref.month, signal);
  return games
    .map((game) => toGameSummary(game, { year: ref.year, month: ref.month }, username))
    .sort((a, b) => (b.endTime ?? 0) - (a.endTime ?? 0));
}

export const EMPTY_FILTERS: GameFilterState = {
  timeClass: 'all',
  result: 'all',
  color: 'all',
  from: null,
  to: null,
  query: '',
};

function dateToUnix(value: string | null, endOfDay = false): number | null {
  if (!value) return null;
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!parts) return null;
  const ms = Date.UTC(
    Number(parts[1]),
    Number(parts[2]) - 1,
    Number(parts[3]),
    endOfDay ? 23 : 0,
    endOfDay ? 59 : 0,
    endOfDay ? 59 : 0,
  );
  return Math.floor(ms / 1000);
}

/** Apply the game-history filter bar to a list of games. */
export function filterGames(games: GameSummary[], filters: GameFilterState): GameSummary[] {
  const from = dateToUnix(filters.from);
  const to = dateToUnix(filters.to, true);
  const query = filters.query.trim().toLowerCase();

  return games.filter((game) => {
    if (filters.timeClass !== 'all' && game.timeClass !== filters.timeClass) return false;
    if (filters.result !== 'all' && game.playerResult !== filters.result) return false;
    if (filters.color !== 'all' && game.playerColor !== filters.color) return false;
    if (from !== null && (game.endTime ?? 0) < from) return false;
    if (to !== null && (game.endTime ?? 0) > to) return false;

    if (query.length > 0) {
      const haystack = [
        game.white.username,
        game.black.username,
        game.openingName ?? '',
        game.eco ?? '',
        game.event ?? '',
        game.timeControlLabel,
        game.termination ?? '',
      ]
        .join(' ')
        .toLowerCase();
      if (!haystack.includes(query)) return false;
    }

    return true;
  });
}

/** True when any filter is doing something. */
export function hasActiveFilters(filters: GameFilterState): boolean {
  return (
    filters.timeClass !== 'all' ||
    filters.result !== 'all' ||
    filters.color !== 'all' ||
    filters.from !== null ||
    filters.to !== null ||
    filters.query.trim().length > 0
  );
}

/** The opponent of the searched player. */
export function opponentOf(game: GameSummary): { username: string; rating: number | null } | null {
  if (game.playerColor === 'white') return { username: game.black.username, rating: game.black.rating };
  if (game.playerColor === 'black') return { username: game.white.username, rating: game.white.rating };
  return null;
}

/** Aggregate stats over the currently loaded games, shown above the list. */
export function summariseGames(games: GameSummary[]): {
  total: number;
  wins: number;
  losses: number;
  draws: number;
  winRate: number;
} {
  let wins = 0;
  let losses = 0;
  let draws = 0;
  for (const game of games) {
    if (game.playerResult === 'win') wins += 1;
    else if (game.playerResult === 'loss') losses += 1;
    else if (game.playerResult === 'draw') draws += 1;
  }
  const decided = wins + losses + draws;
  return {
    total: games.length,
    wins,
    losses,
    draws,
    winRate: decided > 0 ? Math.round((wins / decided) * 100) : 0,
  };
}
