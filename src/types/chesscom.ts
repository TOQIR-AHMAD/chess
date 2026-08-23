/**
 * Shapes returned by the Chess.com Published-Data API (https://api.chess.com/pub).
 * Everything here mirrors the documented response bodies; all fields are optional
 * where the API may omit them, and responses are validated at runtime in
 * `services/chessComApi.ts` before they reach the UI.
 */

export type TimeClass = 'bullet' | 'blitz' | 'rapid' | 'daily';
export type GameRules = 'chess' | 'chess960' | 'bughouse' | 'kingofthehill' | 'threecheck' | 'crazyhouse';

/** `GET /pub/player/{username}` */
export interface ChessComProfile {
  '@id'?: string;
  url?: string;
  username: string;
  player_id?: number;
  title?: string;
  status?: string;
  name?: string;
  avatar?: string;
  location?: string;
  country?: string;
  /** Unix seconds */
  joined?: number;
  /** Unix seconds */
  last_online?: number;
  followers?: number;
  is_streamer?: boolean;
  twitch_url?: string;
  fide?: number;
  verified?: boolean;
  league?: string;
}

export interface RatingSnapshot {
  rating: number;
  date?: number;
  rd?: number;
  game?: string;
}

export interface WinLossRecord {
  win: number;
  loss: number;
  draw: number;
  time_per_move?: number;
  timeout_percent?: number;
}

export interface GameTypeStats {
  last?: RatingSnapshot;
  best?: RatingSnapshot;
  record?: WinLossRecord;
}

export interface PuzzleRushEntry {
  total_attempts?: number;
  score?: number;
}

/** `GET /pub/player/{username}/stats` */
export interface ChessComStats {
  chess_daily?: GameTypeStats;
  chess960_daily?: GameTypeStats;
  chess_rapid?: GameTypeStats;
  chess_blitz?: GameTypeStats;
  chess_bullet?: GameTypeStats;
  tactics?: { highest?: RatingSnapshot; lowest?: RatingSnapshot };
  puzzle_rush?: { best?: PuzzleRushEntry; daily?: PuzzleRushEntry };
  fide?: number;
}

/** `GET /pub/player/{username}/games/archives` */
export interface ArchivesResponse {
  archives: string[];
}

export type GameResultCode =
  | 'win'
  | 'checkmated'
  | 'agreed'
  | 'repetition'
  | 'timeout'
  | 'resigned'
  | 'stalemate'
  | 'lose'
  | 'insufficient'
  | '50move'
  | 'abandoned'
  | 'kingofthehill'
  | 'threecheck'
  | 'timevsinsufficient'
  | 'bughousepartnerlose';

export interface ChessComGameSide {
  '@id'?: string;
  username: string;
  rating?: number;
  result?: GameResultCode;
  uuid?: string;
}

/** A single entry of `GET /pub/player/{username}/games/{YYYY}/{MM}` */
export interface ChessComGame {
  url?: string;
  pgn?: string;
  fen?: string;
  /** e.g. "180+2", "1/259200" for daily */
  time_control?: string;
  time_class?: TimeClass;
  rules?: GameRules;
  rated?: boolean;
  /** Unix seconds */
  end_time?: number;
  /** Unix seconds (daily games only) */
  start_time?: number;
  /** Opening reference URL, e.g. https://www.chess.com/openings/Italian-Game */
  eco?: string;
  uuid?: string;
  initial_setup?: string;
  tcn?: string;
  white: ChessComGameSide;
  black: ChessComGameSide;
  accuracies?: { white?: number; black?: number };
  tournament?: string;
  match?: string;
}

export interface MonthlyGamesResponse {
  games: ChessComGame[];
}

/** Identifies one monthly archive. */
export interface ArchiveRef {
  year: number;
  month: number;
  url: string;
}
