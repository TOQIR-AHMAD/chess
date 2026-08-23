import type { GameSummary, ParsedGame } from '@/types/game';
import type { OpeningInfo } from '@/services/openings';
import { ExternalIcon } from '@/components/ui/Icons';
import { formatDateTime, formatDuration, pluralise } from '@/utils/format';
import { cn } from '@/utils/cn';

/** Players, result and PGN metadata for the game under analysis. */
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
    <div className={cn('space-y-3 px-4 py-3', className)}>
      <div className="space-y-1.5">
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

      <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
        <Field label="Result" value={`${game.outcome}${game.termination ? ` · ${game.termination}` : ''}`} />
        <Field label="Time control" value={`${game.timeControlLabel}${game.rated ? '' : ' · unrated'}`} />
        <Field label="Date" value={formatDateTime(game.endTime)} />
        <Field
          label="Length"
          value={`${pluralise(parsed?.moves.length ? Math.ceil(parsed.moves.length / 2) : game.moveCount, 'move')}${
            game.durationSeconds ? ` · ${formatDuration(game.durationSeconds)}` : ''
          }`}
        />
        {opening ? (
          <div className="col-span-2">
            <dt className="text-muted text-[10px] font-semibold tracking-wide uppercase">Opening</dt>
            <dd className="mt-0.5 text-sm font-medium">{opening.name}</dd>
            {opening.eco && (
              <dd className="text-muted text-[11px]">
                ECO {opening.eco}
                {opening.source === 'database' && ' · matched from the bundled opening book'}
              </dd>
            )}
          </div>
        ) : (
          <div className="col-span-2">
            <dt className="text-muted text-[10px] font-semibold tracking-wide uppercase">Opening</dt>
            <dd className="text-muted mt-0.5 text-xs">Not identified for this game.</dd>
          </div>
        )}
        {headers.Event && <Field label="Event" value={headers.Event} className="col-span-2" />}
      </dl>

      {game.url && (
        <a
          href={game.url}
          target="_blank"
          rel="noreferrer noopener"
          className="text-muted hover-accent inline-flex items-center gap-1.5 text-xs transition-colors"
        >
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
    <div className="surface-raised flex items-center gap-2.5 rounded-lg px-2.5 py-2">
      <span
        className={cn('h-4 w-4 shrink-0 rounded border', side === 'white' ? 'bg-eval-white' : 'bg-eval-black')}
        aria-label={side}
      />
      <span className="min-w-0 flex-1 truncate text-sm font-medium">{name}</span>
      {accuracy !== null && (
        <span className="text-muted hidden font-mono text-[11px] tabular-nums sm:inline" title="Chess.com accuracy">
          {accuracy.toFixed(1)}%
        </span>
      )}
      {rating !== null && <span className="text-secondary font-mono text-xs tabular-nums">{rating}</span>}
      <span
        className={cn(
          'w-8 shrink-0 rounded px-1 text-center font-mono text-[11px] font-bold',
          won ? 'chip-win' : drawn ? 'chip-draw' : 'chip-loss',
        )}
      >
        {won ? '1' : drawn ? '½' : '0'}
      </span>
    </div>
  );
}

function Field({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className={className}>
      <dt className="text-muted text-[10px] font-semibold tracking-wide uppercase">{label}</dt>
      <dd className="mt-0.5 truncate" title={value}>
        {value}
      </dd>
    </div>
  );
}
