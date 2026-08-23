import { describe, expect, it } from 'vitest';
import type { ChessComGame } from '@/types/chesscom';
import type { GameSummary } from '@/types/game';
import {
  EMPTY_FILTERS,
  countPlies,
  filterGames,
  gameIdFromUrl,
  hasActiveFilters,
  opponentOf,
  outcomeFrom,
  resultKind,
  summariseGames,
  terminationLabel,
  toGameSummary,
} from './gameService';

const PGN = `[Event "Live Chess"]
[Site "Chess.com"]
[Date "2024.05.02"]
[White "alice"]
[Black "bob"]
[Result "1-0"]
[ECO "B20"]
[ECOUrl "https://www.chess.com/openings/Sicilian-Defense-2.Nf3"]
[TimeControl "180+2"]
[StartTime "20:00:00"]
[EndTime "20:04:30"]

1. e4 {[%clk 0:03:00]} 1... c5 {[%clk 0:03:00]} 2. Nf3 {[%clk 0:02:58]} 2... d6 {[%clk 0:02:57]} 3. d4 1-0`;

const RAW_GAME: ChessComGame = {
  url: 'https://www.chess.com/game/live/104857382910',
  pgn: PGN,
  time_control: '180+2',
  time_class: 'blitz',
  rules: 'chess',
  rated: true,
  end_time: 1_714_680_270,
  eco: 'https://www.chess.com/openings/Sicilian-Defense-2.Nf3',
  white: { username: 'alice', rating: 1800, result: 'win' },
  black: { username: 'bob', rating: 1780, result: 'resigned' },
  accuracies: { white: 88.4, black: 72.1 },
};

const ARCHIVE = { year: 2024, month: 5 };

describe('result mapping', () => {
  it('classifies Chess.com result codes', () => {
    expect(resultKind('win')).toBe('win');
    expect(resultKind('resigned')).toBe('loss');
    expect(resultKind('checkmated')).toBe('loss');
    expect(resultKind('timeout')).toBe('loss');
    expect(resultKind('abandoned')).toBe('loss');
    expect(resultKind('agreed')).toBe('draw');
    expect(resultKind('stalemate')).toBe('draw');
    expect(resultKind('repetition')).toBe('draw');
    expect(resultKind('insufficient')).toBe('draw');
    expect(resultKind('50move')).toBe('draw');
    expect(resultKind(undefined)).toBeNull();
  });

  it('derives the scoreline', () => {
    expect(outcomeFrom('win', 'resigned')).toBe('1-0');
    expect(outcomeFrom('checkmated', 'win')).toBe('0-1');
    expect(outcomeFrom('agreed', 'agreed')).toBe('1/2-1/2');
    expect(outcomeFrom('stalemate', 'stalemate')).toBe('1/2-1/2');
    expect(outcomeFrom(undefined, undefined)).toBe('*');
  });

  it('labels how the game ended', () => {
    expect(terminationLabel('win', 'resigned')).toBe('Resignation');
    expect(terminationLabel('win', 'checkmated')).toBe('Checkmate');
    expect(terminationLabel('win', 'timeout')).toBe('Timeout');
    expect(terminationLabel('agreed', 'agreed')).toBe('Agreement');
    expect(terminationLabel('insufficient', 'insufficient')).toBe('Insufficient material');
  });
});

describe('gameIdFromUrl', () => {
  it('reads the numeric id from live and daily URLs', () => {
    expect(gameIdFromUrl('https://www.chess.com/game/live/104857382910')).toBe('104857382910');
    expect(gameIdFromUrl('https://www.chess.com/game/daily/556677')).toBe('556677');
  });

  it('falls back to the last path segment', () => {
    expect(gameIdFromUrl('https://example.com/games/abc-123')).toBe('abc-123');
    expect(gameIdFromUrl(null)).toBeNull();
  });
});

describe('countPlies', () => {
  it('counts moves without replaying the game', () => {
    expect(countPlies(PGN)).toBe(5);
  });

  it('ignores comments, NAGs and the result token', () => {
    expect(countPlies('[White "a"]\n\n1. e4 {a comment} e5 $1 2. Nf3 1/2-1/2')).toBe(3);
  });

  it('handles a missing or empty PGN', () => {
    expect(countPlies(null)).toBe(0);
    expect(countPlies('')).toBe(0);
    expect(countPlies('[White "a"]\n\n*')).toBe(0);
  });
});

describe('toGameSummary', () => {
  it('normalises an archive entry into a list row', () => {
    const game = toGameSummary(RAW_GAME, ARCHIVE, 'alice');
    expect(game.id).toBe('104857382910');
    expect(game.white.username).toBe('alice');
    expect(game.white.rating).toBe(1800);
    expect(game.white.accuracy).toBe(88.4);
    expect(game.black.username).toBe('bob');
    expect(game.outcome).toBe('1-0');
    expect(game.timeClass).toBe('blitz');
    expect(game.timeControlLabel).toBe('3+2');
    expect(game.rated).toBe(true);
    expect(game.termination).toBe('Resignation');
    expect(game.archive).toEqual(ARCHIVE);
  });

  it('reports the result from the searched player’s perspective', () => {
    expect(toGameSummary(RAW_GAME, ARCHIVE, 'alice')).toMatchObject({
      playerColor: 'white',
      playerResult: 'win',
    });
    expect(toGameSummary(RAW_GAME, ARCHIVE, 'bob')).toMatchObject({
      playerColor: 'black',
      playerResult: 'loss',
    });
    // A spectator is neither player.
    expect(toGameSummary(RAW_GAME, ARCHIVE, 'carol')).toMatchObject({
      playerColor: null,
      playerResult: null,
    });
  });

  it('matches usernames case-insensitively', () => {
    expect(toGameSummary(RAW_GAME, ARCHIVE, 'ALICE').playerColor).toBe('white');
  });

  it('derives the opening name from the ECO url', () => {
    const game = toGameSummary(RAW_GAME, ARCHIVE, 'alice');
    expect(game.eco).toBe('B20');
    expect(game.openingName).toBe('Sicilian Defense');
  });

  it('computes move count and duration from the PGN', () => {
    const game = toGameSummary(RAW_GAME, ARCHIVE, 'alice');
    expect(game.moveCount).toBe(3);
    expect(game.durationSeconds).toBe(270);
  });

  it('handles a game with no PGN attached', () => {
    const game = toGameSummary({ ...RAW_GAME, pgn: undefined }, ARCHIVE, 'alice');
    expect(game.moveCount).toBe(0);
    expect(game.durationSeconds).toBeNull();
    expect(game.pgn).toBeNull();
    // Still usable as a list row.
    expect(game.outcome).toBe('1-0');
  });

  it('formats daily time controls', () => {
    const daily = toGameSummary(
      { ...RAW_GAME, time_control: '1/259200', time_class: 'daily' },
      ARCHIVE,
      'alice',
    );
    expect(daily.timeControlLabel).toBe('3 days/move');
  });

  it('falls back to the uuid when there is no game url', () => {
    const game = toGameSummary({ ...RAW_GAME, url: undefined, uuid: 'abc-uuid' }, ARCHIVE, 'alice');
    expect(game.id).toBe('abc-uuid');
  });
});

describe('filterGames', () => {
  const base = toGameSummary(RAW_GAME, ARCHIVE, 'alice');
  const games: GameSummary[] = [
    base,
    {
      ...base,
      id: '2',
      timeClass: 'rapid',
      playerResult: 'loss',
      playerColor: 'black',
      endTime: 1_700_000_000,
      openingName: 'French Defense',
      white: { ...base.white, username: 'zoe' },
    },
    { ...base, id: '3', timeClass: 'bullet', playerResult: 'draw', endTime: 1_600_000_000 },
  ];

  it('returns everything by default', () => {
    expect(filterGames(games, EMPTY_FILTERS)).toHaveLength(3);
    expect(hasActiveFilters(EMPTY_FILTERS)).toBe(false);
  });

  it('filters by time class', () => {
    expect(filterGames(games, { ...EMPTY_FILTERS, timeClass: 'rapid' })).toHaveLength(1);
    expect(filterGames(games, { ...EMPTY_FILTERS, timeClass: 'daily' })).toHaveLength(0);
  });

  it('filters by result and colour', () => {
    expect(filterGames(games, { ...EMPTY_FILTERS, result: 'win' })).toHaveLength(1);
    expect(filterGames(games, { ...EMPTY_FILTERS, result: 'draw' })).toHaveLength(1);
    expect(filterGames(games, { ...EMPTY_FILTERS, color: 'black' })).toHaveLength(1);
  });

  it('filters by date range', () => {
    // 1 700 000 000 ≈ 2023-11-14, 1 714 680 270 ≈ 2024-05-02
    expect(filterGames(games, { ...EMPTY_FILTERS, from: '2024-01-01' })).toHaveLength(1);
    expect(filterGames(games, { ...EMPTY_FILTERS, to: '2023-12-31' })).toHaveLength(2);
    expect(filterGames(games, { ...EMPTY_FILTERS, from: '2020-01-01', to: '2024-12-31' })).toHaveLength(3);
  });

  it('searches opponents and openings', () => {
    expect(filterGames(games, { ...EMPTY_FILTERS, query: 'zoe' })).toHaveLength(1);
    expect(filterGames(games, { ...EMPTY_FILTERS, query: 'french' })).toHaveLength(1);
    expect(filterGames(games, { ...EMPTY_FILTERS, query: 'sicilian' })).toHaveLength(2);
    expect(filterGames(games, { ...EMPTY_FILTERS, query: 'nothing here' })).toHaveLength(0);
  });

  it('combines filters', () => {
    expect(
      filterGames(games, { ...EMPTY_FILTERS, timeClass: 'blitz', result: 'win', query: 'bob' }),
    ).toHaveLength(1);
  });

  it('reports when filters are active', () => {
    expect(hasActiveFilters({ ...EMPTY_FILTERS, query: '  ' })).toBe(false);
    expect(hasActiveFilters({ ...EMPTY_FILTERS, query: 'x' })).toBe(true);
    expect(hasActiveFilters({ ...EMPTY_FILTERS, from: '2024-01-01' })).toBe(true);
  });
});

describe('summariseGames and opponentOf', () => {
  const base = toGameSummary(RAW_GAME, ARCHIVE, 'alice');

  it('tallies wins, losses and draws', () => {
    const stats = summariseGames([
      base,
      { ...base, id: '2', playerResult: 'loss' },
      { ...base, id: '3', playerResult: 'draw' },
      { ...base, id: '4', playerResult: 'win' },
    ]);
    expect(stats).toMatchObject({ total: 4, wins: 2, losses: 1, draws: 1, winRate: 50 });
  });

  it('handles an empty list', () => {
    expect(summariseGames([])).toMatchObject({ total: 0, winRate: 0 });
  });

  it('finds the opponent', () => {
    expect(opponentOf(base)).toEqual({ username: 'bob', rating: 1780 });
    expect(opponentOf(toGameSummary(RAW_GAME, ARCHIVE, 'bob'))).toEqual({ username: 'alice', rating: 1800 });
    expect(opponentOf(toGameSummary(RAW_GAME, ARCHIVE, 'carol'))).toBeNull();
  });
});
