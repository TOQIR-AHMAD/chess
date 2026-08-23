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

export function analysisPath(username: string, game: Pick<GameSummary, 'id' | 'archive'>): string {
  const month = `${game.archive.year}-${String(game.archive.month).padStart(2, '0')}`;
  return `/analyze/${encodeURIComponent(username)}/${encodeURIComponent(game.id)}?m=${month}`;
}
