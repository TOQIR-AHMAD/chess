import type { GameSummary, ParsedGame } from '@/types/game';
import type { OpeningInfo } from '@/services/openings';
import { ExternalIcon } from '@/components/ui/Icons';
import { formatDateTime, formatDuration, pluralise } from '@/utils/format';
import { cn } from '@/utils/cn';

/**
 * Players, result and PGN metadata for the game under analysis — set out like
 * an iOS "About" list: the name on the left, the value in gray on the right.
 */
export function GameInfo({
  game,
  parsed,
  opening,
  className,
}: {
  game: GameSummary;
  parsed: ParsedGame | null;
  opening: OpeningInfo | null;
  className?: string;
}) {
  const headers = parsed?.headers ?? {};

  return (
    <div className={cn('space-y-4 px-4 py-4', className)}>
      <div className="list-inset overflow-hidden rounded-xl bg-[var(--fill-4)] [--cell-inset:2.25rem]">
        <PlayerRow
          side="white"
          name={game.white.username}
          rating={game.white.rating}
          won={game.outcome === '1-0'}
          drawn={game.outcome === '1/2-1/2'}
          accuracy={game.white.accuracy}
        />
        <PlayerRow
          side="black"
          name={game.black.username}
          rating={game.black.rating}
          won={game.outcome === '0-1'}
          drawn={game.outcome === '1/2-1/2'}
          accuracy={game.black.accuracy}
        />
      </div>

      <dl className="list-inset text-[14px] [--cell-inset:0px]">
        <Field label="Result" value={`${game.outcome}${game.termination ? ` · ${game.termination}` : ''}`} />
        <Field label="Time control" value={`${game.timeControlLabel}${game.rated ? '' : ' · unrated'}`} />
        <Field label="Date" value={formatDateTime(game.endTime)} />
        <Field
          label="Length"
          value={`${pluralise(parsed?.moves.length ? Math.ceil(parsed.moves.length / 2) : game.moveCount, 'move')}${
            game.durationSeconds ? ` · ${formatDuration(game.durationSeconds)}` : ''
          }`}
        />
        <div className="py-2.5">
          <dt className="text-muted">Opening</dt>
          {opening ? (
            <>
              <dd className="mt-0.5 text-[15px] font-semibold">{opening.name}</dd>
              {opening.eco && (
                <dd className="text-muted text-[13px]">
                  ECO {opening.eco}
                  {opening.source === 'database' && ' · matched from the bundled opening book'}
                </dd>
              )}
            </>
          ) : (
            <dd className="text-muted mt-0.5 text-[13px]">Not identified for this game.</dd>
          )}
        </div>
        {headers.Event && <Field label="Event" value={headers.Event} />}
      </dl>

      {game.url && (
        <a href={game.url} target="_blank" rel="noreferrer noopener" className="btn btn-subtle h-8 px-3.5 text-[13px]">
          <ExternalIcon size={13} />
          View on Chess.com
        </a>
      )}
    </div>
  );
}

function PlayerRow({
  side,
  name,
  rating,
  won,
  drawn,
  accuracy,
}: {
  side: 'white' | 'black';
  name: string;
  rating: number | null;
  won: boolean;
  drawn: boolean;
  accuracy: number | null;
}) {
  return (
    <div className="flex items-center gap-2.5 px-3 py-2">
      <span
        className={cn('h-3.5 w-3.5 shrink-0 rounded-full border', side === 'white' ? 'bg-eval-white' : 'bg-eval-black')}
        aria-label={side}
      />
      <span className="min-w-0 flex-1 truncate text-[15px] font-medium">{name}</span>
      {accuracy !== null && (
        <span className="text-muted hidden text-[12px] tabular-nums sm:inline" title="Chess.com accuracy">
          {accuracy.toFixed(1)}%
        </span>
      )}
      {rating !== null && <span className="text-secondary text-[13px] tabular-nums">{rating}</span>}
      <span
        className={cn(
          'flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[12px] font-bold',
          won ? 'chip-win' : drawn ? 'chip-draw' : 'chip-loss',
        )}
      >
        {won ? '1' : drawn ? '½' : '0'}
      </span>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2.5">
      <dt className="text-muted shrink-0">{label}</dt>
      <dd className="min-w-0 truncate text-right" title={value}>
        {value}
      </dd>
    </div>
  );
}
