import type { TimeClass } from '@/types/chesscom';
import type { GameFilterState } from '@/types/player';
import { EMPTY_FILTERS, hasActiveFilters } from '@/services/gameService';
import { CloseIcon, SearchIcon } from '@/components/ui/Icons';
import { cn } from '@/utils/cn';

const TIME_CLASSES: Array<{ key: TimeClass | 'all'; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'blitz', label: 'Blitz' },
  { key: 'rapid', label: 'Rapid' },
  { key: 'bullet', label: 'Bullet' },
  { key: 'daily', label: 'Daily' },
];

const RESULTS: Array<{ key: GameFilterState['result']; label: string }> = [
  { key: 'all', label: 'Any result' },
  { key: 'win', label: 'Wins' },
  { key: 'loss', label: 'Losses' },
  { key: 'draw', label: 'Draws' },
];

const COLORS: Array<{ key: GameFilterState['color']; label: string }> = [
  { key: 'all', label: 'Both colours' },
  { key: 'white', label: 'As White' },
  { key: 'black', label: 'As Black' },
];

/** Filter bar above the game history. */
export function GameFilters({
  filters,
  onChange,
  resultCount,
  totalCount,
}: {
  filters: GameFilterState;
  onChange: (filters: GameFilterState) => void;
  resultCount: number;
  totalCount: number;
}) {
  const set = <K extends keyof GameFilterState>(key: K, value: GameFilterState[K]) =>
    onChange({ ...filters, [key]: value });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-1.5">
        {TIME_CLASSES.map((entry) => (
          <button
            key={entry.key}
            type="button"
            onClick={() => set('timeClass', entry.key)}
            className={cn(
              'btn h-8 px-3 text-xs',
              filters.timeClass === entry.key ? 'btn-primary' : 'btn-ghost',
            )}
          >
            {entry.label}
          </button>
        ))}

        <div className="ml-auto flex items-center gap-2">
          <span className="text-muted text-xs tabular-nums">
            {resultCount === totalCount
              ? `${totalCount} loaded`
              : `${resultCount} of ${totalCount} loaded`}
          </span>
          {hasActiveFilters(filters) && (
            <button
              type="button"
              className="btn btn-ghost h-8 px-2.5 text-xs"
              onClick={() => onChange(EMPTY_FILTERS)}
            >
              <CloseIcon size={13} />
              Clear
            </button>
          )}
        </div>
      </div>

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <div className="relative min-w-0">
          <SearchIcon size={15} className="text-muted pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2" />
          <input
            className="input pl-8"
            placeholder="Search opponent, opening, event…"
            value={filters.query}
            onChange={(event) => set('query', event.target.value)}
            aria-label="Search games"
          />
        </div>

        <select
          className="input"
          value={filters.result}
          onChange={(event) => set('result', event.target.value as GameFilterState['result'])}
          aria-label="Filter by result"
        >
          {RESULTS.map((entry) => (
            <option key={entry.key} value={entry.key}>
              {entry.label}
            </option>
          ))}
        </select>

        <select
          className="input"
          value={filters.color}
          onChange={(event) => set('color', event.target.value as GameFilterState['color'])}
          aria-label="Filter by colour"
        >
          {COLORS.map((entry) => (
            <option key={entry.key} value={entry.key}>
              {entry.label}
            </option>
          ))}
        </select>

        <div className="flex min-w-0 items-center gap-1.5">
          <input
            type="date"
            className="input min-w-0"
            value={filters.from ?? ''}
            max={filters.to ?? undefined}
            onChange={(event) => set('from', event.target.value || null)}
            aria-label="From date"
          />
          <span className="text-muted text-xs">–</span>
          <input
            type="date"
            className="input min-w-0"
            value={filters.to ?? ''}
            min={filters.from ?? undefined}
            onChange={(event) => set('to', event.target.value || null)}
            aria-label="To date"
          />
        </div>
      </div>
    </div>
  );
}
