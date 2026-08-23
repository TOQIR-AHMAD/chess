import { describe, expect, it } from 'vitest';
import {
  capitalise,
  countryCodeFromUrl,
  countryName,
  formatCompactNumber,
  formatDuration,
  formatNumber,
  formatTimeControl,
  openingNameFromUrl,
  pluralise,
} from './format';

describe('formatTimeControl', () => {
  it('renders live time controls', () => {
    expect(formatTimeControl('180+2')).toBe('3+2');
    expect(formatTimeControl('600')).toBe('10 min');
    expect(formatTimeControl('60')).toBe('1 min');
    expect(formatTimeControl('30')).toBe('0.5 min');
  });

  it('renders daily time controls', () => {
    expect(formatTimeControl('1/259200')).toBe('3 days/move');
    expect(formatTimeControl('1/86400')).toBe('1 day/move');
    expect(formatTimeControl('1/3600')).toBe('1h/move');
  });

  it('falls back to the time class when there is no token', () => {
    expect(formatTimeControl(null, 'blitz')).toBe('Blitz');
    expect(formatTimeControl(undefined, undefined)).toBe('—');
  });
});

describe('openingNameFromUrl', () => {
  it('drops the move sequence appended to the slug', () => {
    expect(openingNameFromUrl('https://www.chess.com/openings/Italian-Game-Giuoco-Piano-4.c3')).toBe(
      'Italian Game Giuoco Piano',
    );
    expect(
      openingNameFromUrl('https://www.chess.com/openings/Reti-Opening-Sicilian-Invitation-2.b3-Nc6-3.Bb2-d6'),
    ).toBe('Reti Opening Sicilian Invitation');
    expect(
      openingNameFromUrl('https://www.chess.com/openings/Kings-Pawn-Opening-Wayward-Queen-Attack-2...Nc6'),
    ).toBe('Kings Pawn Opening Wayward Queen Attack');
  });

  it('handles an ellipsis glued to the last word of the name', () => {
    expect(
      openingNameFromUrl(
        'https://www.chess.com/openings/English-Opening-Anglo-Indian-Defense-Queens-Knight-Variation...7.Nge2-e5',
      ),
    ).toBe('English Opening Anglo Indian Defense Queens Knight Variation');
    expect(
      openingNameFromUrl('https://www.chess.com/openings/Alapin-Sicilian-Defense...3.d4...'),
    ).toBe('Alapin Sicilian Defense');
  });

  it('keeps a slug that carries no moves', () => {
    expect(openingNameFromUrl('https://www.chess.com/openings/Sicilian-Defense')).toBe('Sicilian Defense');
  });

  it('returns null for anything that is not an opening URL', () => {
    expect(openingNameFromUrl(null)).toBeNull();
    expect(openingNameFromUrl('https://www.chess.com/game/live/123')).toBeNull();
  });
});

describe('countryCodeFromUrl and countryName', () => {
  it('reads the country code', () => {
    expect(countryCodeFromUrl('https://api.chess.com/pub/country/US')).toBe('US');
    expect(countryCodeFromUrl('https://api.chess.com/pub/country/XE')).toBe('XE');
    expect(countryCodeFromUrl(null)).toBeNull();
  });

  it('maps Chess.com’s non-ISO codes', () => {
    expect(countryName('XE')).toBe('England');
    expect(countryName('XS')).toBe('Scotland');
    expect(countryName('US')).toBe('United States');
    expect(countryName(null)).toBeNull();
  });
});

describe('formatDuration', () => {
  it('formats minutes and hours', () => {
    expect(formatDuration(75)).toBe('1:15');
    expect(formatDuration(3862)).toBe('1:04:22');
    expect(formatDuration(0)).toBe('0:00');
  });

  it('handles missing values', () => {
    expect(formatDuration(null)).toBe('—');
    expect(formatDuration(-1)).toBe('—');
  });
});

describe('misc helpers', () => {
  it('formats numbers', () => {
    expect(formatNumber(null)).toBe('—');
    expect(formatCompactNumber(1_500_000)).toMatch(/1\.5M/);
    expect(formatCompactNumber(null)).toBe('—');
  });

  it('capitalises and pluralises', () => {
    expect(capitalise('blitz')).toBe('Blitz');
    expect(capitalise('')).toBe('');
    expect(pluralise(1, 'move')).toBe('1 move');
    expect(pluralise(2, 'move')).toBe('2 moves');
  });
});
