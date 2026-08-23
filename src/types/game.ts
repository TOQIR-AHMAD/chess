import type { ChessComGame, GameResultCode, TimeClass } from './chesscom';

export type Color = 'white' | 'black';
export type GameOutcome = '1-0' | '0-1' | '1/2-1/2' | '*';

export interface GameSideSummary {
  username: string;
  rating: number | null;
  result: GameResultCode | null;
  /** Chess.com accuracy for this side, when the game was reviewed on their site. */
  accuracy: number | null;
}

/**
 * Normalised row used by the game-history list. Derived entirely from the
 * Chess.com monthly-archive payload plus the PGN header block.
 */
export interface GameSummary {
  /** Stable id: the numeric id from the game URL, or the archive uuid. */
  id: string;
  url: string | null;
  white: GameSideSummary;
  black: GameSideSummary;
  outcome: GameOutcome;
  /** Result from the perspective of the searched player. */
  playerResult: 'win' | 'loss' | 'draw' | null;
  playerColor: Color | null;
  timeClass: TimeClass | null;
  /** Raw Chess.com time control token, e.g. "180+2". */
  timeControl: string | null;
  timeControlLabel: string;
  rated: boolean;
  rules: string;
  /** Unix seconds */
  endTime: number | null;
  /** Unix seconds */
  startTime: number | null;
  /** Elapsed clock time of the game in seconds, when derivable from the PGN. */
  durationSeconds: number | null;
  /** Number of full moves (Black's reply included in the same move number). */
  moveCount: number;
  eco: string | null;
  ecoUrl: string | null;
  openingName: string | null;
  event: string | null;
  termination: string | null;
  pgn: string | null;
  archive: { year: number; month: number };
  raw: ChessComGame;
}

export interface PgnHeaders {
  [key: string]: string | undefined;
  Event?: string;
  Site?: string;
  Date?: string;
  Round?: string;
  White?: string;
  Black?: string;
  Result?: string;
  WhiteElo?: string;
  BlackElo?: string;
  ECO?: string;
  ECOUrl?: string;
  Opening?: string;
  TimeControl?: string;
  Termination?: string;
  StartTime?: string;
  EndTime?: string;
  UTCDate?: string;
  UTCTime?: string;
  Link?: string;
}

/** One ply of a parsed game. */
export interface ParsedMove {
  /** 0-based ply index. */
  ply: number;
  /** 1-based move number as printed in the move list. */
  moveNumber: number;
  color: Color;
  san: string;
  /** Long algebraic (`e2e4`, `e7e8q`) — the form the engine speaks. */
  uci: string;
  from: string;
  to: string;
  piece: string;
  captured?: string;
  promotion?: string;
  /** FEN *before* the move was played. */
  fenBefore: string;
  /** FEN *after* the move was played. */
  fenAfter: string;
  /** Remaining clock in seconds, parsed from a `[%clk ...]` comment. */
  clockSeconds: number | null;
  /** Seconds the player actually spent on this move, derived from the clocks. */
  secondsSpent: number | null;
  check: boolean;
  mate: boolean;
}

export interface ParsedGame {
  headers: PgnHeaders;
  moves: ParsedMove[];
  /** FEN of the starting position (supports FEN/SetUp headers). */
  initialFen: string;
  /** All positions, index i = position after i plies. Length = moves.length + 1. */
  positions: string[];
  outcome: GameOutcome;
  isChess960: boolean;
}
