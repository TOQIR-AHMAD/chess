import type { GameReview, MoveAnalysis, MoveClassification, Score } from '@/types/analysis';
import type { TimeClass } from '@/types/chesscom';
import type { Color, GameSummary, ParsedGame } from '@/types/game';
import { clampedCp } from '@/utils/evaluation';
import { emptyCounts } from './classification';
import { splitOpeningName } from './openings';
import { parseBaseTime } from './pgnParser';

/**
 * Player insights: what a batch of reviewed games says about one player.
 *
 * Everything here is a pure function of the reviews `analyseGame` already
 * produces — no extra engine work. A single game shows what went wrong once; the
 * point of looking at twenty is to separate a habit from an accident. So every
 * statistic is aggregated over the player's own moves only, and every insight is
 * guarded by a minimum sample. A weakness is only claimed when there is enough
 * evidence for it to be a pattern.
 *
 * The rules are written to be explainable: each insight carries the numbers that
 * triggered it, and advice aimed at that specific habit.
 */

/** One reviewed game, from the point of view of the player being studied. */
export interface InsightGame {
  summary: GameSummary;
  parsed: ParsedGame;
  review: GameReview;
}

export type GamePhase = 'opening' | 'middlegame' | 'endgame';

export const PHASES: GamePhase[] = ['opening', 'middlegame', 'endgame'];

export const PHASE_LABELS: Record<GamePhase, string> = {
  opening: 'Opening',
  middlegame: 'Middlegame',
  endgame: 'Endgame',
};

/* ------------------------------------------------------------------------- */
/* Tunables                                                                   */
/* ------------------------------------------------------------------------- */

/** Moves up to and including this number count as the opening once book runs out. */
const OPENING_MOVES = 10;
/**
 * Queens, rooks, bishops and knights left on the board (both sides) at or below
 * which the position is an endgame — the same cut Lichess uses for its game
 * phase division.
 */
const ENDGAME_PIECES = 6;
/** An advantage this large (mover's point of view) counts as "clearly winning". */
const DECISIVE_CP = 300;
/** Plies the advantage has to hold for, so a single noisy evaluation cannot trigger it. */
const DECISIVE_PLIES = 2;
/** Errors made within this many seconds, with plenty of clock left, count as hasty. */
const HASTY_SECONDS = 3;
/** How many of the worst moves the report shows as critical moments. */
const CRITICAL_MOMENTS = 6;

const ERRORS: MoveClassification[] = ['mistake', 'blunder', 'missed'];
/** Replies that fully punish an opponent's error. */
const PUNISHING: MoveClassification[] = ['brilliant', 'great', 'best', 'excellent'];
const TOP_MOVES: MoveClassification[] = ['brilliant', 'great', 'best', 'excellent'];

const PIECE_NAMES: Record<string, string> = {
  p: 'pawn',
  n: 'knight',
  b: 'bishop',
  r: 'rook',
  q: 'queen',
  k: 'king',
};

/* ------------------------------------------------------------------------- */
/* Report shape                                                               */
/* ------------------------------------------------------------------------- */

export interface PhaseStat {
  phase: GamePhase;
  /** Player moves in this phase, book and forced moves excluded. */
  moves: number;
  /** Accuracy over those moves, on the same 0-100 scale as game accuracy. */
  accuracy: number;
  /** Mistakes, blunders and misses per 10 moves. */
  errorsPer10: number;
  blunders: number;
}

export interface ColorStat {
  color: Color;
  games: number;
  wins: number;
  draws: number;
  losses: number;
  /** Points scored, as a percentage of points available. */
  score: number;
  accuracy: number;
}

export interface OpeningStat {
  name: string;
  color: Color;
  games: number;
  wins: number;
  draws: number;
  losses: number;
  score: number;
  accuracy: number;
}

export interface PieceStat {
  piece: string;
  label: string;
  moves: number;
  errors: number;
  /** Errors per 100 moves with this piece. */
  errorRate: number;
}

export interface TimeStat {
  /** Games that carried clock readings. */
  games: number;
  /** Player moves made with the clock below the time-trouble line. */
  troubleMoves: number;
  troubleErrors: number;
  normalMoves: number;
  normalErrors: number;
  /** Errors made in a few seconds while the clock was comfortable. */
  hastyErrors: number;
  /** All errors in games where hasty play could be measured. */
  measuredErrors: number;
}

export interface CriticalMoment {
  gameId: string;
  summary: GameSummary;
  /** Index into the game's positions *after* the move, for linking into the review. */
  ply: number;
  moveNumber: number;
  color: Color;
  san: string;
  classification: MoveClassification;
  fenBefore: string;
  bestMove: string | null;
  bestMoveSan: string | null;
  bestLine: string[];
  evalBefore: Score;
  evalAfter: Score;
  expectedPointsLoss: number;
  phase: GamePhase;
  explanation: string;
}

export interface TrendPoint {
  gameId: string;
  summary: GameSummary;
  accuracy: number;
  result: 'win' | 'loss' | 'draw' | null;
}

export type InsightTone = 'strength' | 'weakness';

export interface Insight {
  id: string;
  tone: InsightTone;
  title: string;
  /** The numbers that triggered this insight. */
  evidence: string;
  /** What to do about it. Empty for most strengths. */
  advice: string;
  /** Used to rank insights of the same tone; higher means more important. */
  weight: number;
}

export interface InsightReport {
  games: number;
  /** Player moves counted for quality stats (book and forced moves excluded). */
  moves: number;
  record: { wins: number; draws: number; losses: number; score: number };
  accuracy: number;
  averageCentipawnLoss: number;
  counts: Record<MoveClassification, number>;
  perGame: { blunders: number; mistakes: number; missed: number; inaccuracies: number };
  /** Share of counted moves that were brilliant, great, best or excellent. */
  topMoveShare: number;
  phases: PhaseStat[];
  colors: ColorStat[];
  openings: OpeningStat[];
  pieces: PieceStat[];
  time: TimeStat | null;
  tactics: {
    errors: number;
    /** Errors where the engine's move was a check or a capture. */
    missedForcing: number;
    /** Mistakes and blunders the opponent could answer with a check or capture. */
    threatErrors: number;
    overlookedThreats: number;
  };
  punishing: { chances: number; punished: number };
  conversion: { winning: number; won: number };
  resilience: { losing: number; saved: number };
  timeouts: { losses: number; games: number };
  trend: TrendPoint[];
  critical: CriticalMoment[];
  strengths: Insight[];
  weaknesses: Insight[];
}

/* ------------------------------------------------------------------------- */
/* Game selection                                                             */
/* ------------------------------------------------------------------------- */

/** Games shorter than this many full moves say nothing about how someone plays. */
export const MIN_GAME_MOVES = 6;

/** Unix seconds of the start of the look-back window. */
export function cutoffFor(days: number, now = Date.now()): number {
  return Math.floor((now - days * 24 * 3600 * 1000) / 1000);
}

/** True when a monthly archive can contain games that ended after `cutoff`. */
export function archiveOverlaps(ref: { year: number; month: number }, cutoff: number): boolean {
  // `month` is 1-based, so this is midnight on the first day of the next month.
  const monthEnd = Date.UTC(ref.year, ref.month, 1) / 1000;
  return monthEnd > cutoff;
}

/**
 * Whether a game is worth feeding to the insights pass: standard chess, the
 * player took part, it has moves to analyse, and it is inside the window.
 */
export function isInsightCandidate(
  game: GameSummary,
  filter: { cutoff: number; timeClass: TimeClass | 'all' },
): boolean {
  if (game.rules !== 'chess') return false;
  if (!game.pgn || game.playerColor === null) return false;
  if (game.moveCount < MIN_GAME_MOVES) return false;
  if (game.endTime === null || game.endTime < filter.cutoff) return false;
  if (filter.timeClass !== 'all' && game.timeClass !== filter.timeClass) return false;
  return true;
}

/* ------------------------------------------------------------------------- */
/* Building blocks                                                            */
/* ------------------------------------------------------------------------- */

/** Queens, rooks, bishops and knights on the board, both sides together. */
export function countMajorsAndMinors(fen: string): number {
  const board = fen.split(' ')[0] ?? '';
  let count = 0;
  for (const ch of board) {
    const lower = ch.toLowerCase();
    if (lower === 'q' || lower === 'r' || lower === 'b' || lower === 'n') count += 1;
  }
  return count;
}

export function phaseOf(fenBefore: string, moveNumber: number, inBook: boolean): GamePhase {
  if (countMajorsAndMinors(fenBefore) <= ENDGAME_PIECES) return 'endgame';
  if (inBook || moveNumber <= OPENING_MOVES) return 'opening';
  return 'middlegame';
}

/** Words that close an opening's family name: "Sicilian *Defense*", "Italian *Game*". */
const FAMILY_ENDINGS = new Set(['Defense', 'Defence', 'Opening', 'Game', 'Gambit', 'Attack', 'System']);

/**
 * The opening family a game belongs to, so its variations pool their evidence.
 *
 * Names taken from Chess.com's opening URL carry no punctuation — "Sicilian
 * Defense Kan Maroczy Bind Formation" — so the family is cut at its first
 * family word rather than at a comma.
 */
export function openingFamily(name: string | null | undefined): string | null {
  if (!name) return null;
  const { family } = splitOpeningName(name.trim());
  if (!family || /^(undefined|\?)$/i.test(family)) return null;
  const words = family.split(/\s+/);
  const end = words.findIndex((word) => FAMILY_ENDINGS.has(word));
  return end >= 0 ? words.slice(0, end + 1).join(' ') : family;
}

function isForcing(san: string | null | undefined): boolean {
  return Boolean(san && (san.includes('x') || san.includes('+') || san.includes('#')));
}

function isError(move: MoveAnalysis): boolean {
  return ERRORS.includes(move.classification);
}

/** Moves whose quality says something: theory and the only legal move do not. */
function isCounted(move: MoveAnalysis): boolean {
  return move.classification !== 'book' && move.classification !== 'forced';
}

function mean(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((total, value) => total + value, 0) / values.length;
}

function harmonicMean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.length / values.reduce((total, value) => total + 1 / Math.max(value, 1), 0);
}

/**
 * Accuracy over an arbitrary set of moves: the mean and harmonic mean of the
 * per-move accuracies, averaged — the unweighted form of the game accuracy in
 * `computeAccuracy`, so a phase's figure reads on the same scale.
 */
export function blendedAccuracy(accuracies: number[]): number {
  if (accuracies.length === 0) return 0;
  return round1((mean(accuracies) + harmonicMean(accuracies)) / 2);
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function percent(part: number, whole: number): number {
  return whole > 0 ? Math.round((part / whole) * 100) : 0;
}

function scorePercent(wins: number, draws: number, games: number): number {
  return games > 0 ? Math.round(((wins + draws / 2) / games) * 100) : 0;
}

/** Evaluation from the player's side, clamped to a human range. */
function playerCp(score: Score, color: Color): number {
  const cp = clampedCp(score);
  return color === 'white' ? cp : -cp;
}

/** Whether the player's evaluation stayed past `threshold` for `DECISIVE_PLIES` in a row. */
function reached(evaluations: Score[], color: Color, test: (cp: number) => boolean): boolean {
  let run = 0;
  for (const score of evaluations) {
    run = test(playerCp(score, color)) ? run + 1 : 0;
    if (run >= DECISIVE_PLIES) return true;
  }
  return false;
}

/** The clock at which a time control counts as time trouble, in seconds. */
export function timeTroubleLine(baseSeconds: number): number {
  return Math.max(10, Math.min(30, baseSeconds * 0.1));
}

/* ------------------------------------------------------------------------- */
/* The report                                                                 */
/* ------------------------------------------------------------------------- */

export function buildInsights(games: InsightGame[]): InsightReport {
  const counts = emptyCounts();
  const phaseAcc: Record<GamePhase, { accuracies: number[]; errors: number; blunders: number }> = {
    opening: { accuracies: [], errors: 0, blunders: 0 },
    middlegame: { accuracies: [], errors: 0, blunders: 0 },
    endgame: { accuracies: [], errors: 0, blunders: 0 },
  };
  const pieceAcc = new Map<string, { moves: number; errors: number }>();
  const colorAcc = new Map<Color, { games: number; wins: number; draws: number; losses: number; acc: number[] }>();
  const openingAcc = new Map<
    string,
    { name: string; color: Color; games: number; wins: number; draws: number; losses: number; acc: number[] }
  >();

  const tactics = { errors: 0, missedForcing: 0, threatErrors: 0, overlookedThreats: 0 };
  const punishing = { chances: 0, punished: 0 };
  const conversion = { winning: 0, won: 0 };
  const resilience = { losing: 0, saved: 0 };
  const timeouts = { losses: 0, games: 0 };
  const time: TimeStat = {
    games: 0,
    troubleMoves: 0,
    troubleErrors: 0,
    normalMoves: 0,
    normalErrors: 0,
    hastyErrors: 0,
    measuredErrors: 0,
  };

  const record = { wins: 0, draws: 0, losses: 0 };
  const gameAccuracies: number[] = [];
  const centipawnLosses: number[] = [];
  const errorsSeen: Array<{ game: InsightGame; move: MoveAnalysis; phase: GamePhase }> = [];
  let counted = 0;
  let topMoves = 0;

  for (const game of games) {
    const { summary, parsed, review } = game;
    const color = summary.playerColor;
    if (!color) continue;

    const result = summary.playerResult;
    if (result === 'win') record.wins += 1;
    else if (result === 'draw') record.draws += 1;
    else if (result === 'loss') record.losses += 1;

    const side = review[color];
    gameAccuracies.push(side.accuracy);
    for (const key of Object.keys(counts) as MoveClassification[]) counts[key] += side.counts[key];

    // Colour.
    const byColor = colorAcc.get(color) ?? { games: 0, wins: 0, draws: 0, losses: 0, acc: [] };
    byColor.games += 1;
    if (result === 'win') byColor.wins += 1;
    else if (result === 'draw') byColor.draws += 1;
    else if (result === 'loss') byColor.losses += 1;
    byColor.acc.push(side.accuracy);
    colorAcc.set(color, byColor);

    // Opening, grouped by family so "Sicilian Defense, Najdorf" and "…, Dragon"
    // pool their evidence — a single variation rarely repeats often enough.
    const family = openingFamily(review.opening?.name ?? summary.openingName);
    if (family) {
      const key = `${color}:${family}`;
      const entry = openingAcc.get(key) ?? {
        name: family,
        color,
        games: 0,
        wins: 0,
        draws: 0,
        losses: 0,
        acc: [],
      };
      entry.games += 1;
      if (result === 'win') entry.wins += 1;
      else if (result === 'draw') entry.draws += 1;
      else if (result === 'loss') entry.losses += 1;
      entry.acc.push(side.accuracy);
      openingAcc.set(key, entry);
    }

    // Conversion and resilience, from the evaluation curve.
    if (reached(review.evaluations, color, (cp) => cp >= DECISIVE_CP)) {
      conversion.winning += 1;
      if (result === 'win') conversion.won += 1;
    }
    if (reached(review.evaluations, color, (cp) => cp <= -DECISIVE_CP)) {
      resilience.losing += 1;
      if (result !== 'loss') resilience.saved += 1;
    }

    if (summary.termination === 'Timeout' && result === 'loss') timeouts.losses += 1;
    if (summary.termination === 'Timeout') timeouts.games += 1;

    // Clock handling. Daily games carry days on the clock, which says nothing
    // about handling time pressure.
    const base = summary.timeClass === 'daily' ? null : parseBaseTime(parsed.headers.TimeControl);
    const hasClocks = base !== null && parsed.moves.some((move) => move.clockSeconds !== null);
    const troubleLine = base !== null ? timeTroubleLine(base) : 0;
    // Hasty play is not a meaningful idea in bullet, where every move is quick.
    const measuresHaste = hasClocks && base !== null && base >= 180;
    if (hasClocks) time.games += 1;
    let clockBefore = base;

    review.moves.forEach((move, index) => {
      const parsedMove = parsed.moves[index];

      if (move.color !== color) {
        // The opponent erred: did the player's reply make them pay?
        const reply = review.moves[index + 1];
        if (
          (move.classification === 'mistake' || move.classification === 'blunder') &&
          reply &&
          reply.color === color &&
          reply.classification !== 'forced'
        ) {
          punishing.chances += 1;
          if (PUNISHING.includes(reply.classification)) punishing.punished += 1;
        }
        return;
      }

      const clock = clockBefore;
      if (parsedMove?.clockSeconds !== null && parsedMove?.clockSeconds !== undefined) {
        clockBefore = parsedMove.clockSeconds;
      }

      if (!isCounted(move)) return;
      counted += 1;
      centipawnLosses.push(move.centipawnLoss);
      if (TOP_MOVES.includes(move.classification)) topMoves += 1;

      const fenBefore = parsed.positions[index] ?? parsedMove?.fenBefore ?? '';
      const phase = phaseOf(fenBefore, move.moveNumber, move.openingName !== undefined);
      const error = isError(move);

      phaseAcc[phase].accuracies.push(move.accuracy);
      if (error) phaseAcc[phase].errors += 1;
      if (move.classification === 'blunder') phaseAcc[phase].blunders += 1;

      const piece = parsedMove?.piece ?? move.san.match(/^[NBRQK]/)?.[0]?.toLowerCase() ?? 'p';
      const pieceEntry = pieceAcc.get(piece) ?? { moves: 0, errors: 0 };
      pieceEntry.moves += 1;
      if (error) pieceEntry.errors += 1;
      pieceAcc.set(piece, pieceEntry);

      if (hasClocks && clock !== null) {
        if (clock < troubleLine) {
          time.troubleMoves += 1;
          if (error) time.troubleErrors += 1;
        } else {
          time.normalMoves += 1;
          if (error) time.normalErrors += 1;
        }
      }

      if (!error) return;

      errorsSeen.push({ game, move, phase });
      tactics.errors += 1;
      if (move.bestMoveSan && move.bestMoveSan !== move.san && isForcing(move.bestMoveSan)) {
        tactics.missedForcing += 1;
      }
      // A miss throws away the player's own chance; only mistakes and blunders
      // hand the opponent something, so only they can "overlook a threat".
      if (move.classification !== 'missed') {
        tactics.threatErrors += 1;
        if (isForcing(move.playedLine[0])) tactics.overlookedThreats += 1;
      }

      if (measuresHaste) {
        time.measuredErrors += 1;
        const spent = parsedMove?.secondsSpent;
        if (spent !== null && spent !== undefined && spent <= HASTY_SECONDS && clock !== null && clock >= troubleLine * 3) {
          time.hastyErrors += 1;
        }
      }
    });
  }

  const gameCount = gameAccuracies.length;
  const phases: PhaseStat[] = PHASES.map((phase) => {
    const entry = phaseAcc[phase];
    const moves = entry.accuracies.length;
    return {
      phase,
      moves,
      accuracy: blendedAccuracy(entry.accuracies),
      errorsPer10: moves > 0 ? round1((entry.errors / moves) * 10) : 0,
      blunders: entry.blunders,
    };
  });

  const colors: ColorStat[] = (['white', 'black'] as Color[])
    .map((color) => {
      const entry = colorAcc.get(color);
      if (!entry) return null;
      return {
        color,
        games: entry.games,
        wins: entry.wins,
        draws: entry.draws,
        losses: entry.losses,
        score: scorePercent(entry.wins, entry.draws, entry.games),
        accuracy: round1(mean(entry.acc)),
      };
    })
    .filter((entry): entry is ColorStat => entry !== null);

  const openings: OpeningStat[] = [...openingAcc.values()]
    .map((entry) => ({
      name: entry.name,
      color: entry.color,
      games: entry.games,
      wins: entry.wins,
      draws: entry.draws,
      losses: entry.losses,
      score: scorePercent(entry.wins, entry.draws, entry.games),
      accuracy: round1(mean(entry.acc)),
    }))
    .sort((a, b) => b.games - a.games || a.name.localeCompare(b.name));

  const pieces: PieceStat[] = ['p', 'n', 'b', 'r', 'q', 'k']
    .map((piece) => {
      const entry = pieceAcc.get(piece) ?? { moves: 0, errors: 0 };
      return {
        piece,
        label: PIECE_NAMES[piece],
        moves: entry.moves,
        errors: entry.errors,
        errorRate: entry.moves > 0 ? round1((entry.errors / entry.moves) * 100) : 0,
      };
    })
    .filter((entry) => entry.moves > 0);

  const critical: CriticalMoment[] = errorsSeen
    .sort((a, b) => b.move.expectedPointsLoss - a.move.expectedPointsLoss)
    .slice(0, CRITICAL_MOMENTS)
    .map(({ game, move, phase }) => ({
      gameId: game.summary.id,
      summary: game.summary,
      ply: move.ply + 1,
      moveNumber: move.moveNumber,
      color: move.color,
      san: move.san,
      classification: move.classification,
      fenBefore: game.parsed.positions[move.ply] ?? '',
      bestMove: move.bestMove,
      bestMoveSan: move.bestMoveSan,
      bestLine: move.bestLine,
      evalBefore: move.evalBefore,
      evalAfter: move.evalAfter,
      expectedPointsLoss: move.expectedPointsLoss,
      phase,
      explanation: move.explanation,
    }));

  const trend: TrendPoint[] = games
    .filter((game) => game.summary.playerColor !== null)
    .map((game) => ({
      gameId: game.summary.id,
      summary: game.summary,
      accuracy: game.review[game.summary.playerColor as Color].accuracy,
      result: game.summary.playerResult,
    }))
    .sort((a, b) => (a.summary.endTime ?? 0) - (b.summary.endTime ?? 0));

  const perGame = {
    blunders: gameCount > 0 ? round1(counts.blunder / gameCount) : 0,
    mistakes: gameCount > 0 ? round1(counts.mistake / gameCount) : 0,
    missed: gameCount > 0 ? round1(counts.missed / gameCount) : 0,
    inaccuracies: gameCount > 0 ? round1(counts.inaccuracy / gameCount) : 0,
  };

  const report: InsightReport = {
    games: gameCount,
    moves: counted,
    record: { ...record, score: scorePercent(record.wins, record.draws, gameCount) },
    accuracy: round1(mean(gameAccuracies)),
    averageCentipawnLoss: Math.round(mean(centipawnLosses)),
    counts,
    perGame,
    topMoveShare: percent(topMoves, counted),
    phases,
    colors,
    openings,
    pieces,
    time: time.games > 0 ? time : null,
    tactics,
    punishing,
    conversion,
    resilience,
    timeouts,
    trend,
    critical,
    strengths: [],
    weaknesses: [],
  };

  const insights = deriveInsights(report);
  report.strengths = insights.filter((entry) => entry.tone === 'strength').sort((a, b) => b.weight - a.weight);
  report.weaknesses = insights.filter((entry) => entry.tone === 'weakness').sort((a, b) => b.weight - a.weight);
  return report;
}

/* ------------------------------------------------------------------------- */
/* Rules                                                                      */
/* ------------------------------------------------------------------------- */

const PHASE_ADVICE: Record<GamePhase, string> = {
  opening:
    'Pick one opening as White and one defence against 1.e4 and 1.d4, and learn the ideas behind the first 10 moves — where the pieces belong and which pawn breaks you are playing for — rather than memorising lines. After every game, look up the first move where you left theory.',
  middlegame:
    'Before every move, run a blunder check: list all checks, captures and threats for both sides. Solve 15–20 minutes of tactics puzzles a day, and when you have no tactic, pick a plan — improve your worst piece, or target a weak pawn.',
  endgame:
    'Study the fundamental endgames: king and pawn (opposition, the square rule), Lucena and Philidor rook positions, and activating your king as soon as the queens come off. Play out won endgames against the engine until converting them feels routine.',
};

const PIECE_ADVICE: Record<string, string> = {
  q: 'Queen moves are where you lose the most. Before moving the queen, check every square the opponent attacks and every piece that can chase it — early queen adventures and unprotected queens are the usual culprits.',
  k: 'King moves are error-prone for you. Keep the king sheltered until the endgame, and once the queens are off, march it to the centre deliberately rather than on impulse.',
  r: 'Rook moves go wrong more often than your other moves. Rooks belong on open files and the seventh rank — and in endgames, behind passed pawns.',
  b: 'Bishop moves go wrong more often than your other moves. Look at which pawns block your bishop, and check whether a bishop move leaves a piece behind it undefended.',
  n: 'Knight moves go wrong more often than your other moves. Knights are short-range: check forks and look for outposts the opponent’s pawns cannot attack.',
  p: 'Pawn moves go wrong more often than your other moves. Pawns cannot move back — ask what squares each push gives away, especially in front of your own king.',
};

function deriveInsights(report: InsightReport): Insight[] {
  const out: Insight[] = [];
  const { games } = report;
  if (games === 0) return out;

  // --- Game phases -------------------------------------------------------
  const phases = report.phases.filter((entry) => entry.moves >= 15);
  if (phases.length >= 2) {
    const sorted = [...phases].sort((a, b) => a.accuracy - b.accuracy);
    const worst = sorted[0];
    const best = sorted[sorted.length - 1];
    const gap = best.accuracy - worst.accuracy;
    if (gap >= 4) {
      out.push({
        id: `phase-weak-${worst.phase}`,
        tone: 'weakness',
        title: `${PHASE_LABELS[worst.phase]} is your weakest phase`,
        evidence: `${worst.accuracy.toFixed(1)}% accuracy in the ${worst.phase} against ${best.accuracy.toFixed(
          1,
        )}% in the ${best.phase}, with ${worst.errorsPer10} errors per 10 moves (${worst.moves} moves analysed).`,
        advice: PHASE_ADVICE[worst.phase],
        weight: 40 + gap * 3,
      });
      out.push({
        id: `phase-strong-${best.phase}`,
        tone: 'strength',
        title: `Strong ${best.phase} play`,
        evidence: `${best.accuracy.toFixed(1)}% accuracy over ${best.moves} ${best.phase} moves — your best phase.`,
        advice: '',
        weight: 30 + gap * 2,
      });
    }
  }

  // --- Blunders ----------------------------------------------------------
  if (games >= 3 && report.perGame.blunders >= 0.8) {
    out.push({
      id: 'blunders',
      tone: 'weakness',
      title: 'Blunders are deciding your games',
      evidence: `${report.counts.blunder} blunders in ${games} games — ${report.perGame.blunders} per game. One blunder usually undoes everything good in a game.`,
      advice:
        'Adopt a fixed routine before you release each move: what does my opponent’s last move threaten, and what does my move leave undefended? At faster time controls, play one step slower until the blunder rate comes down — it is worth more rating than any opening.',
      weight: 50 + report.perGame.blunders * 25,
    });
  } else if (games >= 5 && report.perGame.blunders <= 0.3) {
    out.push({
      id: 'blunders-low',
      tone: 'strength',
      title: 'Very few blunders',
      evidence: `Only ${report.counts.blunder} blunders in ${games} games (${report.perGame.blunders} per game). Opponents have to beat you — you rarely beat yourself.`,
      advice: '',
      weight: 45,
    });
  }

  // --- Tactics -----------------------------------------------------------
  const { tactics } = report;
  if (tactics.errors >= 5) {
    const forcingShare = percent(tactics.missedForcing, tactics.errors);
    if (forcingShare >= 50) {
      out.push({
        id: 'missed-tactics',
        tone: 'weakness',
        title: 'You miss forcing moves',
        evidence: `In ${tactics.missedForcing} of your ${tactics.errors} errors (${forcingShare}%) the engine’s move was a check or a capture you did not play.`,
        advice:
          'Train tactical vision: daily puzzles, focused on forks, pins and discovered attacks. In your games, look at every check and capture first — even the ones that look silly — before thinking about quiet moves.',
        weight: 30 + forcingShare * 0.6,
      });
    }
  }
  if (tactics.threatErrors >= 5) {
    const threatShare = percent(tactics.overlookedThreats, tactics.threatErrors);
    if (threatShare >= 50) {
      out.push({
        id: 'overlooked-threats',
        tone: 'weakness',
        title: 'You overlook your opponent’s threats',
        evidence: `${tactics.overlookedThreats} of your ${tactics.threatErrors} mistakes and blunders (${threatShare}%) allowed an immediate check or capture.`,
        advice:
          'After every opponent move, ask “what does this move want?” before looking for your own ideas. Then, before moving, check that every piece you leave behind is still defended.',
        weight: 35 + threatShare * 0.6,
      });
    }
  }

  // --- Punishing mistakes ------------------------------------------------
  const { punishing } = report;
  if (punishing.chances >= 4) {
    const rate = percent(punishing.punished, punishing.chances);
    if (rate < 50) {
      out.push({
        id: 'punishing-weak',
        tone: 'weakness',
        title: 'Opponent mistakes go unpunished',
        evidence: `Your opponents made ${punishing.chances} mistakes or blunders; you found the strongest reply to only ${punishing.punished} (${rate}%).`,
        advice:
          'When your opponent’s move surprises you, slow down — it is often a mistake. Ask what it left undefended, and look for a way to win material or attack before playing a “normal” move.',
        weight: 25 + (100 - rate) * 0.4,
      });
    } else if (rate >= 70) {
      out.push({
        id: 'punishing-strong',
        tone: 'strength',
        title: 'You punish mistakes',
        evidence: `You found the strongest reply to ${punishing.punished} of ${punishing.chances} opponent mistakes and blunders (${rate}%).`,
        advice: '',
        weight: 20 + rate * 0.3,
      });
    }
  }

  // --- Converting and defending ------------------------------------------
  const { conversion, resilience } = report;
  if (conversion.winning >= 3) {
    const rate = percent(conversion.won, conversion.winning);
    if (rate < 70) {
      out.push({
        id: 'conversion-weak',
        tone: 'weakness',
        title: 'Winning positions slip away',
        evidence: `You were clearly winning (+3 or better) in ${conversion.winning} games but won only ${conversion.won} of them (${rate}%).`,
        advice:
          'When ahead, simplify: trade pieces (not pawns), remove your opponent’s counterplay first, and stop looking for the most beautiful win. Practise by playing won positions out against the engine.',
        weight: 30 + (100 - rate) * 0.5,
      });
    } else if (rate >= 85) {
      out.push({
        id: 'conversion-strong',
        tone: 'strength',
        title: 'Reliable at converting advantages',
        evidence: `You won ${conversion.won} of the ${conversion.winning} games in which you got a clearly winning position (${rate}%).`,
        advice: '',
        weight: 25 + rate * 0.2,
      });
    }
  }
  if (resilience.losing >= 3) {
    const rate = percent(resilience.saved, resilience.losing);
    if (rate >= 30) {
      out.push({
        id: 'resilience',
        tone: 'strength',
        title: 'Tough to put away',
        evidence: `You were clearly losing in ${resilience.losing} games and still saved ${resilience.saved} of them (${rate}%).`,
        advice: '',
        weight: 20 + rate * 0.3,
      });
    }
  }

  // --- Clock -------------------------------------------------------------
  const { time, timeouts } = report;
  if (time && time.troubleMoves >= 10 && time.normalMoves >= 20) {
    const trouble = (time.troubleErrors / time.troubleMoves) * 100;
    const normal = (time.normalErrors / time.normalMoves) * 100;
    if (trouble >= 10 && trouble >= normal * 1.8) {
      out.push({
        id: 'time-trouble',
        tone: 'weakness',
        title: 'Your play collapses in time trouble',
        evidence: `With little time left you erred on ${Math.round(trouble)}% of moves, against ${Math.round(
          normal,
        )}% with a comfortable clock (${time.troubleMoves} time-trouble moves).`,
        advice:
          'Avoid getting there: spend less time on routine moves in the opening, and set yourself a budget — no single move longer than a tenth of your clock unless the position is truly critical.',
        weight: 30 + (trouble - normal) * 1.5,
      });
    } else if (time.troubleMoves >= 15 && trouble <= normal * 1.1) {
      out.push({
        id: 'time-calm',
        tone: 'strength',
        title: 'Calm under time pressure',
        evidence: `Your error rate with little time left (${Math.round(trouble)}%) is no worse than with a full clock (${Math.round(normal)}%).`,
        advice: '',
        weight: 20,
      });
    }
  }
  if (timeouts.losses >= 2 && report.record.losses > 0 && timeouts.losses / report.record.losses >= 0.2) {
    const share = percent(timeouts.losses, report.record.losses);
    out.push({
      id: 'timeouts',
      tone: 'weakness',
      title: 'You lose on time',
      evidence: `${timeouts.losses} of your ${report.record.losses} losses (${share}%) were on time.`,
      advice:
        'Play faster in familiar positions and keep a reserve for the endgame. If a position is hard, choose a safe, good-enough move instead of searching for the perfect one.',
      weight: 25 + share * 0.5,
    });
  }
  if (time && time.measuredErrors >= 5) {
    const share = percent(time.hastyErrors, time.measuredErrors);
    if (share >= 40) {
      out.push({
        id: 'hasty',
        tone: 'weakness',
        title: 'Hasty moves cost you',
        evidence: `${time.hastyErrors} of your ${time.measuredErrors} errors (${share}%) were played in ${HASTY_SECONDS} seconds or less while you still had plenty of time.`,
        advice:
          'Sit on your hands: when you have time on the clock, take at least a few seconds on every move to look at your opponent’s threats. The fastest moves are the ones most often wrong.',
        weight: 25 + share * 0.5,
      });
    }
  }

  // --- Colour ------------------------------------------------------------
  const white = report.colors.find((entry) => entry.color === 'white');
  const black = report.colors.find((entry) => entry.color === 'black');
  if (white && black && white.games >= 3 && black.games >= 3) {
    const accuracyGap = white.accuracy - black.accuracy;
    const scoreGap = white.score - black.score;
    if (Math.abs(accuracyGap) >= 5 || Math.abs(scoreGap) >= 25) {
      const weak = accuracyGap + scoreGap / 5 < 0 ? white : black;
      const strong = weak === white ? black : white;
      out.push({
        id: `color-${weak.color}`,
        tone: 'weakness',
        title: `You struggle with the ${weak.color} pieces`,
        evidence: `As ${weak.color}: ${weak.score}% score and ${weak.accuracy.toFixed(1)}% accuracy over ${weak.games} games. As ${strong.color}: ${strong.score}% and ${strong.accuracy.toFixed(1)}%.`,
        advice:
          weak.color === 'white'
            ? 'Your White repertoire may not suit you. Choose an opening that leads to positions you understand, and study the typical plans rather than the move orders.'
            : 'Your Black repertoire may not suit you. Choose solid defences you understand, and study the typical middlegame plans that follow from them.',
        weight: 20 + Math.abs(accuracyGap) * 2 + Math.abs(scoreGap) * 0.4,
      });
    }
  }

  // --- Openings ----------------------------------------------------------
  for (const opening of report.openings) {
    if (opening.games < 3) continue;
    const tally = `${opening.wins}W ${opening.draws}D ${opening.losses}L`;
    if (opening.score <= 35) {
      out.push({
        id: `opening-weak-${opening.color}-${opening.name}`,
        tone: 'weakness',
        title: `Trouble in the ${opening.name} as ${opening.color}`,
        evidence: `${tally} over ${opening.games} games (${opening.score}% score, ${opening.accuracy.toFixed(1)}% accuracy).`,
        advice: `Replay your ${opening.name} games side by side and find where each one went wrong. If it is the same idea every time, learn that one position properly — or switch to a line you are more comfortable in.`,
        weight: 15 + (50 - opening.score) * 0.6 + opening.games,
      });
    } else if (opening.score >= 65) {
      out.push({
        id: `opening-strong-${opening.color}-${opening.name}`,
        tone: 'strength',
        title: `The ${opening.name} works for you as ${opening.color}`,
        evidence: `${tally} over ${opening.games} games (${opening.score}% score).`,
        advice: '',
        weight: 15 + (opening.score - 50) * 0.5 + opening.games,
      });
    }
  }

  // --- Pieces ------------------------------------------------------------
  const overallRate = report.moves > 0 ? (tactics.errors / report.moves) * 100 : 0;
  const pieceWeakness = report.pieces
    .filter((entry) => entry.errors >= 4 && entry.moves >= 15 && entry.errorRate >= overallRate * 1.75)
    .sort((a, b) => b.errorRate - a.errorRate)[0];
  if (pieceWeakness) {
    out.push({
      id: `piece-${pieceWeakness.piece}`,
      tone: 'weakness',
      title: `Careless ${pieceWeakness.label} moves`,
      evidence: `${pieceWeakness.errorRate}% of your ${pieceWeakness.label} moves were errors, against ${round1(
        overallRate,
      )}% of your moves overall (${pieceWeakness.errors} of ${pieceWeakness.moves}).`,
      advice: PIECE_ADVICE[pieceWeakness.piece] ?? '',
      weight: 15 + (pieceWeakness.errorRate / Math.max(overallRate, 1)) * 5,
    });
  }

  // --- Move quality ------------------------------------------------------
  const special = report.counts.brilliant + report.counts.great;
  if (special >= 3) {
    out.push({
      id: 'only-moves',
      tone: 'strength',
      title: 'You find critical moves',
      evidence: `${report.counts.brilliant} brilliant and ${report.counts.great} great moves — positions where only one move held, and you found it.`,
      advice: '',
      weight: 20 + special * 2,
    });
  }
  if (report.moves >= 60 && report.topMoveShare >= 60) {
    out.push({
      id: 'top-moves',
      tone: 'strength',
      title: 'Consistently finds the engine’s moves',
      evidence: `${report.topMoveShare}% of your moves out of the opening book were best or excellent.`,
      advice: '',
      weight: 15 + (report.topMoveShare - 60),
    });
  }

  return out;
}
