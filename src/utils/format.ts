/** Small presentation helpers shared across the UI. */

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  year: 'numeric',
  month: 'short',
  day: '2-digit',
});

const dateTimeFormatter = new Intl.DateTimeFormat(undefined, {
  year: 'numeric',
  month: 'short',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});

const monthFormatter = new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'long' });

/** Unix seconds → localised date. */
export function formatDate(unixSeconds: number | null | undefined): string {
  if (!unixSeconds) return '—';
  return dateFormatter.format(new Date(unixSeconds * 1000));
}

export function formatDateTime(unixSeconds: number | null | undefined): string {
  if (!unixSeconds) return '—';
  return dateTimeFormatter.format(new Date(unixSeconds * 1000));
}

export function formatMonth(year: number, month: number): string {
  return monthFormatter.format(new Date(Date.UTC(year, month - 1, 1)));
}

/** "3 hours ago", "just now", "2 months ago". */
export function formatRelative(unixSeconds: number | null | undefined): string {
  if (!unixSeconds) return '—';
  const deltaSeconds = Math.floor(Date.now() / 1000) - unixSeconds;
  if (deltaSeconds < 60) return 'just now';
  const units: Array<[number, Intl.RelativeTimeFormatUnit]> = [
    [60, 'minute'],
    [3600, 'hour'],
    [86400, 'day'],
    [604800, 'week'],
    [2629800, 'month'],
    [31557600, 'year'],
  ];
  let chosen: [number, Intl.RelativeTimeFormatUnit] = units[0];
  for (const unit of units) {
    if (deltaSeconds >= unit[0]) chosen = unit;
  }
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  return rtf.format(-Math.floor(deltaSeconds / chosen[0]), chosen[1]);
}

/** Seconds → `12:03` or `1:04:22`. */
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds) || seconds < 0) return '—';
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * Render a Chess.com time-control token as a human label.
 * `180+2` → `3+2 min`, `1/259200` → `3 days/move`, `600` → `10 min`.
 */
export function formatTimeControl(timeControl: string | null | undefined, timeClass?: string | null): string {
  if (!timeControl) return timeClass ? capitalise(timeClass) : '—';
  if (timeControl.includes('/')) {
    const perMove = Number.parseInt(timeControl.split('/')[1] ?? '', 10);
    if (Number.isFinite(perMove)) {
      const days = Math.round(perMove / 86400);
      if (days >= 1) return `${days} day${days === 1 ? '' : 's'}/move`;
      const hours = Math.round(perMove / 3600);
      return `${hours}h/move`;
    }
    return timeControl;
  }
  const [baseRaw, incRaw] = timeControl.split('+');
  const base = Number.parseInt(baseRaw ?? '', 10);
  if (!Number.isFinite(base)) return timeControl;
  const minutes = base % 60 === 0 ? String(base / 60) : (base / 60).toFixed(1);
  const inc = Number.parseInt(incRaw ?? '', 10);
  return Number.isFinite(inc) && inc > 0 ? `${minutes}+${inc}` : `${minutes} min`;
}

export function capitalise(value: string): string {
  return value.length === 0 ? value : value[0].toUpperCase() + value.slice(1);
}

/** Country code from a Chess.com country URL (`.../country/US` → `US`). */
export function countryCodeFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const match = /\/country\/([A-Za-z0-9-]+)\/?$/.exec(url);
  return match ? match[1] : null;
}

let regionNames: Intl.DisplayNames | null = null;
export function countryName(code: string | null): string | null {
  if (!code) return null;
  // Chess.com uses a few non-ISO codes (XE = England, XS = Scotland, ...).
  const custom: Record<string, string> = {
    XE: 'England',
    XS: 'Scotland',
    XW: 'Wales',
    XA: 'Catalonia',
    XB: 'Basque Country',
    XP: 'Palestine',
    XK: 'Kosovo',
    XX: 'International',
  };
  if (custom[code]) return custom[code];
  try {
    regionNames ??= new Intl.DisplayNames(undefined, { type: 'region' });
    return regionNames.of(code) ?? code;
  } catch {
    return code;
  }
}

/**
 * Turn a Chess.com opening URL slug into a readable name.
 *
 * Slugs append the moves that define the line, in a few different shapes:
 *   Italian-Game-Giuoco-Piano-4.c3
 *   Kings-Pawn-Opening-Wayward-Queen-Attack-2...Nc6
 *   Reti-Opening-Sicilian-Invitation-2.b3-Nc6-3.Bb2-d6
 *   English-Opening-Anglo-Indian-Defense-Queens-Knight-Variation...7.Nge2-e5
 *
 * Everything from the first move number onwards is notation, not a name, so the
 * slug is cut at the separator (a hyphen, or an ellipsis glued to the last word)
 * that introduces it.
 */
export function openingNameFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const match = /\/openings\/([^/?#]+)/.exec(url);
  if (!match) return null;

  const slug = match[1];
  const notation = /(?:-|\.{2,3})(?=\d+\.)/.exec(slug);
  const nameSlug = notation ? slug.slice(0, notation.index) : slug;

  const name = nameSlug
    .replace(/-/g, ' ')
    .replace(/\.+$/, '')
    .replace(/\s+/g, ' ')
    .trim();
  return name.length > 0 ? name : null;
}

export function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return new Intl.NumberFormat().format(value);
}

/** 1_234_567 → `1.2M`, used for engine node counts. */
export function formatCompactNumber(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(value);
}

export function pluralise(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}
