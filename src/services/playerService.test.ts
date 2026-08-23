import { describe, expect, it } from 'vitest';
import type { ChessComProfile, ChessComStats } from '@/types/chesscom';
import { buildPlayerSummary, peakRating, totalRecord } from './playerService';
import { extractUsername, isValidUsername, normaliseUsername } from './chessComApi';

const PROFILE: ChessComProfile = {
  '@id': 'https://api.chess.com/pub/player/hikaru',
  url: 'https://www.chess.com/member/Hikaru',
  username: 'hikaru',
  player_id: 15448422,
  title: 'GM',
  status: 'premium',
  name: 'Hikaru Nakamura',
  avatar: 'https://images.chesscomfiles.com/uploads/v1/user/15448422.jpg',
  location: 'Sunrise, Florida',
  country: 'https://api.chess.com/pub/country/US',
  joined: 1_389_043_258,
  last_online: 1_710_000_000,
  followers: 1_200_000,
  is_streamer: true,
  twitch_url: 'https://twitch.tv/gmhikaru',
  fide: 2802,
};

const STATS: ChessComStats = {
  chess_rapid: { last: { rating: 2850, date: 1, rd: 40 }, best: { rating: 2909 }, record: { win: 500, loss: 100, draw: 60 } },
  chess_blitz: { last: { rating: 3231, date: 1 }, best: { rating: 3360 }, record: { win: 9000, loss: 2000, draw: 1500 } },
  chess_bullet: { last: { rating: 3320, date: 1 }, best: { rating: 3399 }, record: { win: 12000, loss: 2500, draw: 900 } },
  chess_daily: { last: { rating: 2100, date: 1 }, record: { win: 30, loss: 4, draw: 6 } },
  tactics: { highest: { rating: 3600 } },
};

describe('buildPlayerSummary', () => {
  it('maps the profile endpoint onto the view model', () => {
    const player = buildPlayerSummary(PROFILE, STATS);
    expect(player.username).toBe('hikaru');
    expect(player.displayName).toBe('Hikaru Nakamura');
    expect(player.title).toBe('GM');
    expect(player.countryCode).toBe('US');
    expect(player.countryName).toBe('United States');
    expect(player.location).toBe('Sunrise, Florida');
    expect(player.fide).toBe(2802);
    expect(player.isStreamer).toBe(true);
    expect(player.joined).toBe(1_389_043_258);
    expect(player.lastOnline).toBe(1_710_000_000);
  });

  it('builds a rating card for every time class plus puzzles', () => {
    const player = buildPlayerSummary(PROFILE, STATS);
    expect(player.ratings.map((card) => card.key)).toEqual(['rapid', 'blitz', 'bullet', 'daily', 'puzzles']);

    const blitz = player.ratings.find((card) => card.key === 'blitz');
    expect(blitz?.rating).toBe(3231);
    expect(blitz?.best).toBe(3360);
    expect(blitz?.record?.win).toBe(9000);

    expect(player.ratings.find((card) => card.key === 'puzzles')?.rating).toBe(3600);
  });

  it('survives a player with no stats at all', () => {
    const player = buildPlayerSummary({ username: 'brandnew' }, null);
    expect(player.username).toBe('brandnew');
    expect(player.displayName).toBe('brandnew');
    expect(player.title).toBeNull();
    expect(player.fide).toBeNull();
    expect(player.countryCode).toBeNull();
    expect(player.ratings.every((card) => card.rating === null)).toBe(true);
  });

  it('leaves out ratings for time classes the player has never played', () => {
    const player = buildPlayerSummary(PROFILE, { chess_blitz: STATS.chess_blitz });
    expect(player.ratings.find((card) => card.key === 'blitz')?.rating).toBe(3231);
    expect(player.ratings.find((card) => card.key === 'rapid')?.rating).toBeNull();
  });

  it('reads a FIDE rating from the stats endpoint when the profile omits it', () => {
    const { fide, ...withoutFide } = PROFILE;
    void fide;
    const player = buildPlayerSummary(withoutFide, { ...STATS, fide: 2700 });
    expect(player.fide).toBe(2700);
  });

  it('ignores a zero FIDE rating', () => {
    const player = buildPlayerSummary({ ...PROFILE, fide: 0 }, null);
    expect(player.fide).toBeNull();
  });

  it('maps Chess.com’s non-ISO country codes', () => {
    const player = buildPlayerSummary(
      { ...PROFILE, country: 'https://api.chess.com/pub/country/XE' },
      null,
    );
    expect(player.countryCode).toBe('XE');
    expect(player.countryName).toBe('England');
  });
});

describe('peakRating and totalRecord', () => {
  it('finds the highest current rating across time classes', () => {
    const player = buildPlayerSummary(PROFILE, STATS);
    expect(peakRating(player)).toEqual({ label: 'Bullet', rating: 3320 });
  });

  it('returns null when the player has no ratings', () => {
    expect(peakRating(buildPlayerSummary({ username: 'x' }, null))).toBeNull();
  });

  it('sums the win/loss/draw record', () => {
    const record = totalRecord(buildPlayerSummary(PROFILE, STATS));
    expect(record.win).toBe(500 + 9000 + 12000 + 30);
    expect(record.loss).toBe(100 + 2000 + 2500 + 4);
    expect(record.draw).toBe(60 + 1500 + 900 + 6);
    expect(record.total).toBe(record.win + record.loss + record.draw);
  });
});

describe('username handling', () => {
  it('validates Chess.com username rules', () => {
    expect(isValidUsername('hikaru')).toBe(true);
    expect(isValidUsername('Magnus-Carlsen_1')).toBe(true);
    expect(isValidUsername('ab')).toBe(false);
    expect(isValidUsername('a'.repeat(26))).toBe(false);
    expect(isValidUsername('has space')).toBe(false);
    expect(isValidUsername('bad!char')).toBe(false);
  });

  it('normalises to lower case', () => {
    expect(normaliseUsername('  HiKaRu ')).toBe('hikaru');
  });

  it('extracts a username from a profile URL or @handle', () => {
    expect(extractUsername('https://www.chess.com/member/Hikaru')).toBe('hikaru');
    expect(extractUsername('chess.com/members/MagnusCarlsen')).toBe('magnuscarlsen');
    expect(extractUsername('@GothamChess')).toBe('gothamchess');
    expect(extractUsername('  DanielNaroditsky ')).toBe('danielnaroditsky');
  });
});
