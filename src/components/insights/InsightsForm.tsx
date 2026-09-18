import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import type { TimeClass } from '@/types/chesscom';
import type { InsightQuery } from '@/hooks/useInsights';
import { extractUsername, isValidUsername } from '@/services/chessComApi';
import { SearchIcon, StopIcon, TargetIcon } from '@/components/ui/Icons';

export const PERIODS: Array<{ days: number; label: string }> = [
  { days: 7, label: 'Last 7 days' },
  { days: 30, label: 'Last 30 days' },
  { days: 90, label: 'Last 3 months' },
  { days: 180, label: 'Last 6 months' },
  { days: 365, label: 'Last year' },
];

const TIME_CLASSES: Array<{ key: TimeClass | 'all'; label: string }> = [
  { key: 'all', label: 'All time controls' },
  { key: 'bullet', label: 'Bullet' },
  { key: 'blitz', label: 'Blitz' },
  { key: 'rapid', label: 'Rapid' },
  { key: 'daily', label: 'Daily' },
];

const GAME_COUNTS = [10, 20, 30, 50];

export const DEPTHS: Array<{ depth: number; label: string }> = [
  { depth: 12, label: 'Fast · depth 12' },
  { depth: 14, label: 'Balanced · depth 14' },
  { depth: 18, label: 'Thorough · depth 18 (slow)' },
];

export const DEFAULT_QUERY: Omit<InsightQuery, 'username'> = {
  days: 30,
  timeClass: 'all',
  maxGames: 20,
  depth: 14,
};

/**
 * Search bar for the insights pass — whose games, from when, how many and how
 * deep — laid out as one row of captioned fields, like the game-history filters,
 * and stacking into a form on a phone.
 */
export function InsightsForm({
  initial,
  running,
  onSubmit,
  onCancel,
}: {
  initial: InsightQuery;
  running: boolean;
  onSubmit: (query: InsightQuery) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<InsightQuery>(initial);
  const [touched, setTouched] = useState(false);

  // A new starting point resets the draft.
  useEffect(() => setDraft(initial), [initial]);

  const username = extractUsername(draft.username);
  const valid = isValidUsername(username);
  const set = <K extends keyof InsightQuery>(key: K, value: InsightQuery[K]) =>
    setDraft((prev) => ({ ...prev, [key]: value }));

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setTouched(true);
    if (!valid || running) return;
    onSubmit({ ...draft, username });
  };

  return (
    <form
      onSubmit={submit}
      className="grid items-start gap-3 @xl:grid-cols-2 @3xl:grid-cols-3 @7xl:grid-cols-[minmax(0,1.4fr)_repeat(4,minmax(0,1fr))_auto]"
    >
      <Field label="Chess.com username" htmlFor="insights-username">
        <div className="relative">
          <SearchIcon
            size={16}
            className="text-muted pointer-events-none absolute top-1/2 left-3 -translate-y-1/2"
          />
          <input
            id="insights-username"
            className="input pl-9"
            placeholder="e.g. hikaru"
            value={draft.username}
            onChange={(event) => set('username', event.target.value)}
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            aria-invalid={touched && !valid}
          />
        </div>
        {touched && !valid && (
          <p className="text-danger mt-1.5 px-1 text-[13px]">Enter a valid Chess.com username.</p>
        )}
      </Field>

      <Field label="Games from" htmlFor="insights-period">
        <select
          id="insights-period"
          className="input"
          value={draft.days}
          onChange={(event) => set('days', Number(event.target.value))}
        >
          {PERIODS.map((entry) => (
            <option key={entry.days} value={entry.days}>
              {entry.label}
            </option>
          ))}
        </select>
      </Field>

      <Field label="Time control" htmlFor="insights-time-class">
        <select
          id="insights-time-class"
          className="input"
          value={draft.timeClass}
          onChange={(event) => set('timeClass', event.target.value as InsightQuery['timeClass'])}
        >
          {TIME_CLASSES.map((entry) => (
            <option key={entry.key} value={entry.key}>
              {entry.label}
            </option>
          ))}
        </select>
      </Field>

      <Field label="Up to" htmlFor="insights-count">
        <select
          id="insights-count"
          className="input"
          value={draft.maxGames}
          onChange={(event) => set('maxGames', Number(event.target.value))}
        >
          {GAME_COUNTS.map((count) => (
            <option key={count} value={count}>
              {count} games
            </option>
          ))}
        </select>
      </Field>

      <Field label="Engine depth" htmlFor="insights-depth">
        <select
          id="insights-depth"
          className="input"
          value={draft.depth}
          onChange={(event) => set('depth', Number(event.target.value))}
        >
          {DEPTHS.map((entry) => (
            <option key={entry.depth} value={entry.depth}>
              {entry.label}
            </option>
          ))}
        </select>
      </Field>

      {/* The label-sized spacer keeps the button level with the fields beside it. */}
      <div>
        <span className="field-label invisible hidden @xl:block" aria-hidden="true">
          &nbsp;
        </span>
        {running ? (
          <button type="button" className="btn btn-danger min-h-[2.25rem] w-full" onClick={onCancel}>
            <StopIcon size={14} fill="currentColor" />
            Stop
          </button>
        ) : (
          <button type="submit" className="btn btn-primary min-h-[2.25rem] w-full">
            <TargetIcon size={16} />
            Analyse games
          </button>
        )}
      </div>
    </form>
  );
}

function Field({ label, htmlFor, children }: { label: string; htmlFor: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <label htmlFor={htmlFor} className="field-label">
        {label}
      </label>
      {children}
    </div>
  );
}
