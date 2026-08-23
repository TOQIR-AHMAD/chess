import type { ChessComProfile, ChessComStats, TimeClass, WinLossRecord } from './chesscom';

/** A rating card shown on the profile (one per time class + puzzles). */
export interface RatingCard {
  key: 'rapid' | 'blitz' | 'bullet' | 'daily' | 'puzzles';
  label: string;
  rating: number | null;
  best: number | null;
  record: WinLossRecord | null;
}

/** View model produced by `playerService` from the profile + stats endpoints. */
export interface PlayerSummary {
  username: string;
  displayName: string;
  profileUrl: string | null;
  avatar: string | null;
  title: string | null;
  countryCode: string | null;
  countryName: string | null;
  location: string | null;
  status: string | null;
  followers: number | null;
  isStreamer: boolean;
  twitchUrl: string | null;
  /** FIDE rating, present only if the player published one. */
  fide: number | null;
  /** Unix seconds */
  joined: number | null;
  /** Unix seconds */
  lastOnline: number | null;
  ratings: RatingCard[];
  raw: { profile: ChessComProfile; stats: ChessComStats | null };
}

export interface GameFilterState {
  timeClass: TimeClass | 'all';
  result: 'all' | 'win' | 'loss' | 'draw';
  color: 'all' | 'white' | 'black';
  /** ISO date strings (yyyy-mm-dd) or null. */
  from: string | null;
  to: string | null;
  /** Free-text search across opponents, openings and event names. */
  query: string;
}
