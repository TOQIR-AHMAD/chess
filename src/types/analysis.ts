import type { Color } from './game';

/**
 * A raw engine score. `type: 'cp'` carries centipawns, `type: 'mate'` carries
 * distance-to-mate in moves. Both are always stored **from White's point of view**
 * once normalised (`utils/evaluation.ts`), never side-to-move relative.
 */
export interface Score {
  type: 'cp' | 'mate';
  value: number;
}

/** One principal variation returned by a MultiPV search. */
export interface PvLine {
  multipv: number;
  /** Score from the point of view of the side to move. */
  score: Score;
  depth: number;
  selDepth: number | null;
  /** Moves in UCI form. */
  pv: string[];
  /** The same moves rendered in SAN, relative to the searched position. */
  san: string[];
  nodes: number | null;
  nps: number | null;
  timeMs: number | null;
}

/** Result of searching a single position. */
export interface SearchResult {
  fen: string;
  depth: number;
  /** Best move in UCI form (`bestmove` token), null if the position is terminal. */
  bestMove: string | null;
  ponder: string | null;
  lines: PvLine[];
  /** True when the search was cut short by a higher-priority request. */
  interrupted: boolean;
  nodes: number | null;
  nps: number | null;
  timeMs: number | null;
}

export interface EngineConfig {
  /** Target search depth for the full-game pass. */
  depth: number;
  /** Deeper target used for the position the user is currently viewing. */
  liveDepth: number;
  threads: number;
  /** Transposition table size in MB. */
  hash: number;
  /** Optional per-position time cap in ms (0 = depth-only). */
  moveTimeMs: number;
  multiPv: number;
}

export type MoveClassification =
  | 'brilliant'
  | 'great'
  | 'best'
  | 'excellent'
  | 'good'
  | 'book'
  | 'forced'
  | 'inaccuracy'
  | 'mistake'
  | 'blunder'
  | 'missed';

/**
 * Cut-offs for `services/classification.ts`.
 *
 * Every band is expressed in **expected points given away** (0-100), the axis
 * `utils/evaluation.ts` defines — not in centipawns. `version` is bumped whenever
 * the meaning of these numbers changes, so a settings object written by an older
 * build is discarded rather than reinterpreted under the new units.
 */
export interface ClassificationThresholds {
  /** Schema version for the units below. */
  version: number;
  /** Expected points lost at or above which a move is an inaccuracy. */
  inaccuracy: number;
  mistake: number;
  blunder: number;
  /** Loss at or below this still counts as "excellent"; anything up to `inaccuracy` is good. */
  excellent: number;
  /**
   * Expected points the player must throw away, while holding a decisive
   * advantage, for the move to be flagged as a missed opportunity.
   */
  missedWin: number;
  /** How far ahead of the alternatives the only good move must be to be "great". */
  greatMargin: number;
  /** Minimum material (in pawns) that must be given up for a brilliant move. */
  brilliantSacrifice: number;
  /** Plies to consider "book" when the line matches the opening database. */
  bookDepth: number;
}

/** Per-ply analysis record produced by `services/gameAnalysis.ts`. */
export interface MoveAnalysis {
  ply: number;
  moveNumber: number;
  color: Color;
  san: string;
  uci: string;
  /** Evaluation of the position before the move, from White's POV. */
  evalBefore: Score;
  /** Evaluation of the position after the move, from White's POV. */
  evalAfter: Score;
  /** Centipawns lost by the mover (>= 0), capped, from the mover's POV. */
  centipawnLoss: number;
  /** Win-probability drop for the mover, in percentage points (0-100). */
  winProbLoss: number;
  /** Expected points the mover gave away (0-100) — the axis classification uses. */
  expectedPointsLoss: number;
  /** Accuracy score for this move (0-100). */
  accuracy: number;
  classification: MoveClassification;
  /** Engine's preferred move in the position before the move was played. */
  bestMove: string | null;
  bestMoveSan: string | null;
  /** Principal variation (SAN) after the engine's best move. */
  bestLine: string[];
  /** Principal variation (SAN) following the move actually played. */
  playedLine: string[];
  /** True when the played move matched the engine's first choice. */
  isTopEngineMove: boolean;
  /** Depth actually reached for the "before" position. */
  depth: number;
  /** Opening name if this ply is still inside the opening book. */
  openingName?: string;
  eco?: string;
  /** Material sacrificed by the move, in pawns (>0 means material was given up). */
  sacrificedMaterial: number;
  /** Human-readable explanation assembled from engine data only. */
  explanation: string;
}

export interface AccuracyBreakdown {
  accuracy: number;
  counts: Record<MoveClassification, number>;
  /** Average centipawn loss over the side's moves. */
  averageCentipawnLoss: number;
  moveCount: number;
}

export interface GameReview {
  /** Cache/version key of the analysis run. */
  key: string;
  engine: EngineConfig;
  thresholds: ClassificationThresholds;
  moves: MoveAnalysis[];
  /** Evaluation after each ply, index 0 = starting position. Length = moves+1. */
  evaluations: Score[];
  white: AccuracyBreakdown;
  black: AccuracyBreakdown;
  opening: { name: string; eco: string | null; url: string | null } | null;
  completedAt: number;
}

export type AnalysisPhase = 'idle' | 'loading-engine' | 'analyzing' | 'done' | 'error' | 'cancelled';

export interface AnalysisProgress {
  phase: AnalysisPhase;
  /** Positions analysed so far. */
  completed: number;
  total: number;
  /** 0-100 */
  percent: number;
  message: string;
  /** Engine download progress while the WASM binary streams in (0-100). */
  enginePercent: number | null;
  error: string | null;
}
