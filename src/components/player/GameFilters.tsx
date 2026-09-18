import type { TimeClass } from '@/types/chesscom';
import type { GameFilterState } from '@/types/player';
import { EMPTY_FILTERS, hasActiveFilters } from '@/services/gameService';
import { SegmentedControl } from '@/components/ui/Controls';
import { SearchIcon } from '@/components/ui/Icons';

const TIME_CLASSES: Array<{ value: TimeClass | 'all'; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'blitz', label: 'Blitz' },
  { value: 'rapid', label: 'Rapid' },
  { value: 'bullet', label: 'Bullet' },
  { value: 'daily', label: 'Daily' },
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

/**
 * Filter bar above the game history: the time control as a segmented control,
 * then a search field and pop-up menus for the rest.
 */
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
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <SegmentedControl
          label="Time control"
          className="w-full @xl:w-auto @xl:min-w-[22rem]"
          options={TIME_CLASSES}
          value={filters.timeClass}
          onChange={(timeClass) => set('timeClass', timeClass)}
        />

        <div className="ml-auto flex items-center gap-2">
          <span className="text-muted text-[13px] tabular-nums">
            {resultCount === totalCount
              ? `${totalCount} loaded`
              : `${resultCount} of ${totalCount} loaded`}
          </span>
          {hasActiveFilters(filters) && (
            <button type="button" className="btn btn-ghost h-8 px-2.5 text-[14px]" onClick={() => onChange(EMPTY_FILTERS)}>
              Clear
            </button>
          )}
        </div>
      </div>

      <div className="grid gap-2 @xl:grid-cols-2 @5xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.7fr)]">
        <div className="relative min-w-0">
          <SearchIcon size={16} className="text-muted pointer-events-none absolute top-1/2 left-3 -translate-y-1/2" />
          <input
            className="input pl-9"
            placeholder="Opponent, opening, event"
            value={filters.query}
            onChange={(event) => set('query', event.target.value)}
            aria-label="Search games"
            enterKeyHint="search"
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
          <span className="text-muted text-[13px]">–</span>
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
