import { describe, expect, it } from 'vitest';
import type { GameReview, MoveAnalysis, MoveClassification, Score } from '@/types/analysis';
import type { ChessComGame } from '@/types/chesscom';
import type { Color, GameSummary } from '@/types/game';
import { DEFAULT_ENGINE_CONFIG } from './stockfish';
import { DEFAULT_THRESHOLDS, computeAccuracy } from './classification';
import { parsePgn } from './pgnParser';
import {
  archiveOverlaps,
  blendedAccuracy,
  buildInsights,
  countMajorsAndMinors,
  cutoffFor,
  isInsightCandidate,
  openingFamily,
  phaseOf,
  timeTroubleLine,
  type InsightGame,
} from './insights';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const ROOK_ENDGAME = '4k3/8/8/8/8/8/r7/R3K3 w - - 0 40';

/** A Giuoco Piano main line, 24 plies — long enough to reach move 12. */
const SANS = [
  'e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5', 'c3', 'Nf6', 'd4', 'exd4', 'cxd4', 'Bb4+',
  'Bd2', 'Bxd2+', 'Nbxd2', 'd5', 'exd5', 'Nxd5', 'Qb3', 'Nce7', 'O-O', 'O-O', 'Rfe1', 'c6',
];

function clock(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `0:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/** PGN for `SANS`, optionally with a `[%clk]` after every ply. */
function pgnFor(clocks?: number[], timeControl = '180'): string {
  const body = SANS.map((san, i) => {
    const prefix = i % 2 === 0 ? `${i / 2 + 1}. ` : '';
    const comment = clocks ? ` {[%clk ${clock(clocks[i])}]}` : '';
    return `${prefix}${san}${comment}`;
  }).join(' ');
  return `[Event "Live Chess"]\n[TimeControl "${timeControl}"]\n\n${body} *`;
}

function summary(overrides: Partial<GameSummary> = {}): GameSummary {
  return {
    id: '1',
    url: null,
    white: { username: 'me', rating: 1500, result: null, accuracy: null },
    black: { username: 'them', rating: 1500, result: null, accuracy: null },
    outcome: '*',
    playerResult: 'win',
    playerColor: 'white',
    timeClass: 'blitz',
    timeControl: '180',
    timeControlLabel: '3 min',
    rated: true,
    rules: 'chess',
    endTime: 1_700_000_000,
    startTime: null,
    durationSeconds: null,
    moveCount: 12,
    eco: null,
    ecoUrl: null,
    openingName: 'Italian Game, Giuoco Piano',
    event: null,
    termination: 'Resignation',
    pgn: pgnFor(),
    archive: { year: 2023, month: 11 },
    raw: {} as ChessComGame,
    ...overrides,
  };
}

interface GameSpec {
  id?: string;
  color?: Color;
  result?: 'win' | 'loss' | 'draw';
  termination?: string;
  clocks?: number[];
  /** Classification per ply; unlisted plies are "best" (or "book" in the first four). */
  labels?: Record<number, MoveClassification>;
  /** Best move per ply in SAN. */
  best?: Record<number, string>;
  /** First move of the engine's line after the played move. */
  reply?: Record<number, string>;
  /** White-POV evaluation after each ply (index = ply). */
  evals?: Record<number, number>;
  opening?: string;
}

function makeGame(spec: GameSpec = {}): InsightGame {
  const color = spec.color ?? 'white';
  const pgn = pgnFor(spec.clocks);
  const parsed = parsePgn(pgn);
  const evaluations: Score[] = parsed.positions.map((_, index) => ({
    type: 'cp',
    value: index === 0 ? 20 : (spec.evals?.[index - 1] ?? 20),
  }));

  const moves: MoveAnalysis[] = parsed.moves.map((move, index) => {
    const classification = spec.labels?.[index] ?? (index < 4 ? 'book' : 'best');
    const bad = classification === 'mistake' || classification === 'blunder' || classification === 'missed';
    return {
      ply: move.ply,
      moveNumber: move.moveNumber,
      color: move.color,
      san: move.san,
      uci: move.uci,
      evalBefore: evaluations[index],
      evalAfter: evaluations[index + 1],
      centipawnLoss: bad ? 200 : 0,
      winProbLoss: bad ? 20 : 0,
      expectedPointsLoss: classification === 'blunder' ? 30 : bad ? 15 : 0,
      accuracy: bad ? 40 : 100,
      classification,
      bestMove: null,
      bestMoveSan: spec.best?.[index] ?? move.san,
      bestLine: [],
      playedLine: spec.reply?.[index] ? [spec.reply[index]] : ['a6'],
      isTopEngineMove: !bad,
      depth: 14,
      openingName: index < 4 ? 'Italian Game' : undefined,
      sacrificedMaterial: 0,
      explanation: '',
    };
  });

  const review: GameReview = {
    key: 'k',
    engine: DEFAULT_ENGINE_CONFIG,
    thresholds: DEFAULT_THRESHOLDS,
    moves,
    evaluations,
    white: computeAccuracy(moves, 'white'),
    black: computeAccuracy(moves, 'black'),
    opening: { name: spec.opening ?? 'Italian Game, Giuoco Piano', eco: 'C53', url: null },
    completedAt: 0,
  };

  return {
    summary: summary({
      id: spec.id ?? '1',
      playerColor: color,
      playerResult: spec.result ?? 'win',
      termination: spec.termination ?? 'Resignation',
      pgn,
    }),
    parsed,
    review,
  };
}

describe('game phases', () => {
  it('counts queens, rooks and minor pieces for both sides', () => {
    expect(countMajorsAndMinors(START)).toBe(14);
    expect(countMajorsAndMinors(ROOK_ENDGAME)).toBe(2);
  });

  it('calls a position with six or fewer pieces an endgame, whatever the move number', () => {
    expect(phaseOf(ROOK_ENDGAME, 5, false)).toBe('endgame');
  });

  it('keeps the first ten moves, and anything still in book, in the opening', () => {
    expect(phaseOf(START, 10, false)).toBe('opening');
    expect(phaseOf(START, 11, false)).toBe('middlegame');
    expect(phaseOf(START, 14, true)).toBe('opening');
  });
});

describe('game selection', () => {
  const now = Date.UTC(2026, 8, 18); // 18 Sep 2026

  it('reaches back the requested number of days', () => {
    expect(cutoffFor(30, now)).toBe(Date.UTC(2026, 7, 19) / 1000);
  });

  it('only scans months that can hold games inside the window', () => {
    const cutoff = cutoffFor(30, now);
    expect(archiveOverlaps({ year: 2026, month: 9 }, cutoff)).toBe(true);
    expect(archiveOverlaps({ year: 2026, month: 8 }, cutoff)).toBe(true);
    expect(archiveOverlaps({ year: 2026, month: 7 }, cutoff)).toBe(false);
  });

  it('keeps standard games the player took part in, inside the window and time class', () => {
    const filter = { cutoff: 1_600_000_000, timeClass: 'blitz' as const };
    expect(isInsightCandidate(summary(), filter)).toBe(true);
    expect(isInsightCandidate(summary({ rules: 'chess960' }), filter)).toBe(false);
    expect(isInsightCandidate(summary({ playerColor: null }), filter)).toBe(false);
    expect(isInsightCandidate(summary({ pgn: null }), filter)).toBe(false);
    expect(isInsightCandidate(summary({ moveCount: 3 }), filter)).toBe(false);
    expect(isInsightCandidate(summary({ endTime: 1_500_000_000 }), filter)).toBe(false);
    expect(isInsightCandidate(summary({ timeClass: 'rapid' }), filter)).toBe(false);
    expect(isInsightCandidate(summary({ timeClass: 'rapid' }), { ...filter, timeClass: 'all' })).toBe(true);
  });
});

describe('buildInsights', () => {
  it('reports the record and only counts the player’s own, non-book moves', () => {
    const report = buildInsights([
      makeGame({ id: 'a', result: 'win' }),
      makeGame({ id: 'b', result: 'loss', color: 'black' }),
      makeGame({ id: 'c', result: 'draw' }),
    ]);

    expect(report.games).toBe(3);
    expect(report.record).toEqual({ wins: 1, draws: 1, losses: 1, score: 50 });
    // 12 moves a side, the first two of each side in book.
    expect(report.moves).toBe(30);
    expect(report.colors.map((entry) => entry.color)).toEqual(['white', 'black']);
  });

  it('aggregates errors per game and ranks the worst moves first', () => {
    const report = buildInsights([
      makeGame({ id: 'a', labels: { 8: 'mistake', 14: 'blunder' } }),
      makeGame({ id: 'b', labels: { 10: 'blunder' } }),
    ]);

    expect(report.counts.blunder).toBe(2);
    expect(report.perGame.blunders).toBe(1);
    expect(report.critical.map((moment) => moment.classification)).toEqual(['blunder', 'blunder', 'mistake']);
    // The link points at the position after the move, where the review explains it.
    expect(report.critical[2].ply).toBe(9);
    expect(report.critical[2].fenBefore).toBe(makeGame().parsed.positions[8]);
  });

  it('separates missed tactics from overlooked threats', () => {
    const report = buildInsights([
      makeGame({
        labels: { 8: 'mistake', 10: 'blunder', 12: 'missed' },
        best: { 8: 'Nxe5', 10: 'Bxf7+', 12: 'Qh5' },
        reply: { 8: 'Bxf2+', 10: 'h6' },
      }),
    ]);

    expect(report.tactics).toEqual({ errors: 3, missedForcing: 2, threatErrors: 2, overlookedThreats: 1 });
  });

  it('checks whether the player punished the opponent’s errors', () => {
    const report = buildInsights([
      // Black errs on plies 5 and 9; White answers the first well and the second badly.
      makeGame({ labels: { 5: 'blunder', 9: 'mistake', 10: 'inaccuracy' } }),
    ]);

    expect(report.punishing).toEqual({ chances: 2, punished: 1 });
  });

  it('tracks converting winning positions and saving lost ones', () => {
    const report = buildInsights([
      makeGame({ id: 'a', result: 'win', evals: { 10: 400, 11: 450 } }),
      makeGame({ id: 'b', result: 'draw', evals: { 10: 400, 11: 450 } }),
      // A single-ply spike is not a winning position.
      makeGame({ id: 'c', result: 'draw', evals: { 10: 400 } }),
      makeGame({ id: 'd', result: 'draw', color: 'black', evals: { 10: 500, 11: 500 } }),
    ]);

    expect(report.conversion).toEqual({ winning: 2, won: 1 });
    expect(report.resilience).toEqual({ losing: 1, saved: 1 });
  });

  it('splits errors by the clock the player had when they moved', () => {
    expect(timeTroubleLine(180)).toBe(18);
    expect(timeTroubleLine(60)).toBe(10);
    expect(timeTroubleLine(900)).toBe(30);

    // Both clocks run down evenly to 5 seconds, so the last plies are in time trouble.
    const clocks = SANS.map((_, i) => Math.max(5, 175 - i * 8));
    const report = buildInsights([makeGame({ clocks, labels: { 22: 'blunder' } })]);

    expect(report.time).not.toBeNull();
    expect(report.time?.troubleErrors).toBe(1);
    expect(report.time?.normalErrors).toBe(0);
    expect((report.time?.troubleMoves ?? 0) + (report.time?.normalMoves ?? 0)).toBe(10);
  });

  it('has no clock section when the games carry no clocks', () => {
    expect(buildInsights([makeGame()]).time).toBeNull();
  });

  it('names frequent blunders as a weakness and a clean record as a strength', () => {
    const blundering = buildInsights(
      ['a', 'b', 'c'].map((id) => makeGame({ id, labels: { 8: 'blunder', 12: 'blunder' } })),
    );
    expect(blundering.weaknesses.map((entry) => entry.id)).toContain('blunders');

    const clean = buildInsights(['a', 'b', 'c', 'd', 'e'].map((id) => makeGame({ id })));
    expect(clean.strengths.map((entry) => entry.id)).toContain('blunders-low');
    expect(clean.weaknesses.map((entry) => entry.id)).not.toContain('blunders');
  });

  it('flags an opening that keeps losing, and one that keeps winning', () => {
    const report = buildInsights([
      ...['a', 'b', 'c'].map((id) => makeGame({ id, result: 'loss', opening: 'Sicilian Defense, Najdorf' })),
      ...['d', 'e', 'f'].map((id) => makeGame({ id, result: 'win', opening: 'Italian Game, Two Knights' })),
    ]);

    expect(report.openings.map((entry) => entry.name).sort()).toEqual(['Italian Game', 'Sicilian Defense']);
    expect(report.weaknesses.some((entry) => entry.id === 'opening-weak-white-Sicilian Defense')).toBe(true);
    expect(report.strengths.some((entry) => entry.id === 'opening-strong-white-Italian Game')).toBe(true);
  });

  it('makes no claims from an empty sample', () => {
    const report = buildInsights([]);
    expect(report.games).toBe(0);
    expect(report.strengths).toEqual([]);
    expect(report.weaknesses).toEqual([]);
  });
});

describe('openingFamily', () => {
  it('groups variations under their family, with or without punctuation', () => {
    expect(openingFamily('Sicilian Defense, Najdorf Variation')).toBe('Sicilian Defense');
    expect(openingFamily('Sicilian Defense Kan Maroczy Bind Formation')).toBe('Sicilian Defense');
    expect(openingFamily('Italian Game Two Knights Modern Bishops Opening')).toBe('Italian Game');
    expect(openingFamily('Queens Pawn Opening Chigorin Variation')).toBe('Queens Pawn Opening');
    expect(openingFamily('Kings Indian Attack Double Fianchetto')).toBe('Kings Indian Attack');
    expect(openingFamily('Ruy Lopez')).toBe('Ruy Lopez');
  });

  it('ignores games without a usable name', () => {
    expect(openingFamily('Undefined')).toBeNull();
    expect(openingFamily(null)).toBeNull();
  });
});

describe('blendedAccuracy', () => {
  it('is dragged down by a single very bad move', () => {
    expect(blendedAccuracy([100, 100, 100])).toBe(100);
    expect(blendedAccuracy([100, 100, 10])).toBeLessThan(60);
    expect(blendedAccuracy([])).toBe(0);
  });
});
