import type {
  ArchiveRef,
  ArchivesResponse,
  ChessComGame,
  ChessComProfile,
  ChessComStats,
  MonthlyGamesResponse,
} from '@/types/chesscom';
import { CURRENT_MONTH_TTL, caches } from './cache';
import { ApiError, request } from './http';

/**
 * Client for the Chess.com Published-Data API.
 *
 * Endpoints (verified against https://www.chess.com/news/view/published-data-api):
 *   GET /pub/player/{username}
 *   GET /pub/player/{username}/stats
 *   GET /pub/player/{username}/games/archives
 *   GET /pub/player/{username}/games/{YYYY}/{MM}
 *   GET /pub/player/{username}/games/{YYYY}/{MM}/pgn   (text/x-chess-pgn)
 *
 * No API key is required and no private data is requested. Responses are
 * validated before use because the API occasionally omits optional fields.
 */
export const API_BASE = 'https://api.chess.com/pub';

/** Chess.com usernames: 3-25 chars, letters/digits/underscore/hyphen. */
const USERNAME_RE = /^[A-Za-z0-9_-]{3,25}$/;

export function isValidUsername(value: string): boolean {
  return USERNAME_RE.test(value.trim());
}

export function normaliseUsername(value: string): string {
  return value.trim().toLowerCase();
}

/** Accepts a bare username or a chess.com member URL and returns the username. */
export function extractUsername(input: string): string {
  const trimmed = input.trim();
  const urlMatch = /chess\.com\/(?:member|members)\/([A-Za-z0-9_-]+)/i.exec(trimmed);
  if (urlMatch) return normaliseUsername(urlMatch[1]);
  return normaliseUsername(trimmed.replace(/^@/, ''));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Narrow an unknown payload to `{ archives: string[] }`. */
function isArchivesResponse(value: unknown): value is ArchivesResponse {
  return isRecord(value) && Array.isArray(value.archives);
}

/** Narrow an unknown payload to `{ games: unknown[] }`. */
function isGamesResponse(value: unknown): value is MonthlyGamesResponse {
  return isRecord(value) && Array.isArray(value.games);
}

export async function fetchProfile(username: string, signal?: AbortSignal): Promise<ChessComProfile> {
  const key = normaliseUsername(username);
  const cached = caches.profile.get(key) as ChessComProfile | null;
  if (cached) return cached;

  const data = await request<unknown>(`${API_BASE}/player/${encodeURIComponent(key)}`, { signal });
  if (!isRecord(data) || typeof data.username !== 'string') {
    throw new ApiError('invalid-response', 'Player profile was missing a username');
  }
  const profile = data as unknown as ChessComProfile;
  caches.profile.set(key, profile);
  return profile;
}

export async function fetchStats(username: string, signal?: AbortSignal): Promise<ChessComStats> {
  const key = normaliseUsername(username);
  const cached = caches.stats.get(key) as ChessComStats | null;
  if (cached) return cached;

  const data = await request<unknown>(`${API_BASE}/player/${encodeURIComponent(key)}/stats`, { signal });
  if (!isRecord(data)) throw new ApiError('invalid-response', 'Player stats were not an object');
  const stats = data as unknown as ChessComStats;
  caches.stats.set(key, stats);
  return stats;
}

/** Monthly archive URLs, newest first. */
export async function fetchArchives(username: string, signal?: AbortSignal): Promise<ArchiveRef[]> {
  const key = normaliseUsername(username);
  const cached = caches.archives.get(key) as ArchiveRef[] | null;
  if (cached) return cached;

  const data = await request<unknown>(`${API_BASE}/player/${encodeURIComponent(key)}/games/archives`, {
    signal,
  });
  if (!isArchivesResponse(data)) {
    throw new ApiError('invalid-response', 'Archive list was malformed');
  }

  const refs: ArchiveRef[] = [];
  for (const url of data.archives) {
    if (typeof url !== 'string') continue;
    const match = /\/games\/(\d{4})\/(\d{2})$/.exec(url);
    if (!match) continue;
    refs.push({ year: Number(match[1]), month: Number(match[2]), url });
  }
  // API returns oldest first; the UI always wants the most recent games.
  refs.sort((a, b) => b.year - a.year || b.month - a.month);

  caches.archives.set(key, refs);
  return refs;
}

function isCurrentMonth(year: number, month: number): boolean {
  const now = new Date();
  return now.getUTCFullYear() === year && now.getUTCMonth() + 1 === month;
}

/** Games for one month. Cached; the in-progress month uses a short TTL. */
export async function fetchMonthlyGames(
  username: string,
  year: number,
  month: number,
  signal?: AbortSignal,
): Promise<ChessComGame[]> {
  const user = normaliseUsername(username);
  const key = `${user}:${year}-${String(month).padStart(2, '0')}`;
  const cached = caches.months.get(key) as ChessComGame[] | null;
  if (cached) return cached;

  const url = `${API_BASE}/player/${encodeURIComponent(user)}/games/${year}/${String(month).padStart(2, '0')}`;
  const data = await request<unknown>(url, { signal });
  if (!isGamesResponse(data)) {
    throw new ApiError('invalid-response', 'Monthly games response was malformed');
  }

  const games = (data.games as unknown[]).filter(
    (game): game is ChessComGame =>
      isRecord(game) && isRecord(game.white) && isRecord(game.black) &&
      typeof (game.white as { username?: unknown }).username === 'string' &&
      typeof (game.black as { username?: unknown }).username === 'string',
  );

  caches.months.set(key, games, isCurrentMonth(year, month) ? CURRENT_MONTH_TTL : undefined);
  return games;
}

/**
 * Bulk PGN for a month. The archive JSON already embeds each game's PGN, so this
 * is only used for the "download month" action, never for analysis.
 */
export async function fetchMonthlyPgn(
  username: string,
  year: number,
  month: number,
  signal?: AbortSignal,
): Promise<string> {
  const user = normaliseUsername(username);
  const url = `${API_BASE}/player/${encodeURIComponent(user)}/games/${year}/${String(month).padStart(2, '0')}/pgn`;
  return request<string>(url, { signal, as: 'text' });
}

/** Games currently in progress (daily chess). Useful as a fallback for empty archives. */
export async function fetchCurrentGames(username: string, signal?: AbortSignal): Promise<ChessComGame[]> {
  const user = normaliseUsername(username);
  const data = await request<unknown>(`${API_BASE}/player/${encodeURIComponent(user)}/games`, { signal });
  if (!isGamesResponse(data)) return [];
  return data.games;
}
