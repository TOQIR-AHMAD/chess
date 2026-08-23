import type { ChessComProfile, ChessComStats, GameTypeStats } from '@/types/chesscom';
import type { PlayerSummary, RatingCard } from '@/types/player';
import { countryCodeFromUrl, countryName } from '@/utils/format';
import { fetchProfile, fetchStats } from './chessComApi';
import { toApiError } from './http';

/**
 * Composes the profile and stats endpoints into the single view model the
 * profile UI consumes. Stats are optional: a brand-new account has a profile but
 * no rated games, and the page must still render.
 */

function ratingCard(
  key: RatingCard['key'],
  label: string,
  stats: GameTypeStats | undefined,
): RatingCard {
  return {
    key,
    label,
    rating: typeof stats?.last?.rating === 'number' ? stats.last.rating : null,
    best: typeof stats?.best?.rating === 'number' ? stats.best.rating : null,
    record: stats?.record ?? null,
  };
}

export function buildPlayerSummary(profile: ChessComProfile, stats: ChessComStats | null): PlayerSummary {
  const code = countryCodeFromUrl(profile.country);
  const puzzles = stats?.tactics?.highest?.rating;

  const ratings: RatingCard[] = [
    ratingCard('rapid', 'Rapid', stats?.chess_rapid),
    ratingCard('blitz', 'Blitz', stats?.chess_blitz),
    ratingCard('bullet', 'Bullet', stats?.chess_bullet),
    ratingCard('daily', 'Daily', stats?.chess_daily),
    {
      key: 'puzzles',
      label: 'Puzzles',
      rating: typeof puzzles === 'number' ? puzzles : null,
      best: typeof puzzles === 'number' ? puzzles : null,
      record: null,
    },
  ];

  return {
    username: profile.username,
    displayName: profile.name?.trim() || profile.username,
    profileUrl: profile.url ?? null,
    avatar: profile.avatar ?? null,
    title: profile.title ?? null,
    countryCode: code,
    countryName: countryName(code),
    location: profile.location ?? null,
    status: profile.status ?? null,
    followers: typeof profile.followers === 'number' ? profile.followers : null,
    isStreamer: Boolean(profile.is_streamer),
    twitchUrl: profile.twitch_url ?? null,
    // FIDE ratings appear on either endpoint depending on the account.
    fide: pickFide(profile, stats),
    joined: typeof profile.joined === 'number' ? profile.joined : null,
    lastOnline: typeof profile.last_online === 'number' ? profile.last_online : null,
    ratings,
    raw: { profile, stats },
  };
}

function pickFide(profile: ChessComProfile, stats: ChessComStats | null): number | null {
  if (typeof profile.fide === 'number' && profile.fide > 0) return profile.fide;
  if (typeof stats?.fide === 'number' && stats.fide > 0) return stats.fide;
  return null;
}

/**
 * Load a player. Stats failures are tolerated — a missing stats block only means
 * the player has no rated games, which is not an error for the profile page.
 */
export async function loadPlayer(username: string, signal?: AbortSignal): Promise<PlayerSummary> {
  const profile = await fetchProfile(username, signal);

  let stats: ChessComStats | null = null;
  try {
    stats = await fetchStats(username, signal);
  } catch (error) {
    const apiError = toApiError(error);
    if (apiError.kind === 'aborted') throw apiError;
    stats = null;
  }

  return buildPlayerSummary(profile, stats);
}

/** Best available rating across time classes, used for compact summaries. */
export function peakRating(player: PlayerSummary): { label: string; rating: number } | null {
  let best: { label: string; rating: number } | null = null;
  for (const card of player.ratings) {
    if (card.key === 'puzzles' || card.rating === null) continue;
    if (!best || card.rating > best.rating) best = { label: card.label, rating: card.rating };
  }
  return best;
}

/** Aggregate win/loss/draw across all time classes. */
export function totalRecord(player: PlayerSummary): { win: number; loss: number; draw: number; total: number } {
  let win = 0;
  let loss = 0;
  let draw = 0;
  for (const card of player.ratings) {
    if (!card.record) continue;
    win += card.record.win ?? 0;
    loss += card.record.loss ?? 0;
    draw += card.record.draw ?? 0;
  }
  return { win, loss, draw, total: win + loss + draw };
}
