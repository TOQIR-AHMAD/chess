import type { GameSummary } from '@/types/game';

/**
 * Route helpers.
 *
 * The analysis route carries the archive month as a query hint (`?m=YYYY-MM`) so a
 * refresh or shared link resolves the game in a single API request instead of
 * scanning back through a player's monthly archives.
 */

export function playerPath(username: string): string {
  return `/player/${encodeURIComponent(username)}`;
}

/** `ply`, when given, opens the review at that position (0 = the start). */
export function analysisPath(username: string, game: Pick<GameSummary, 'id' | 'archive'>, ply?: number): string {
  const month = `${game.archive.year}-${String(game.archive.month).padStart(2, '0')}`;
  const at = ply !== undefined ? `&ply=${ply}` : '';
  return `/analyze/${encodeURIComponent(username)}/${encodeURIComponent(game.id)}?m=${month}${at}`;
}

export const INSIGHTS_PATH = '/insights';

export const SETTINGS_PATH = '/settings';
