import { Link } from 'react-router-dom';
import type { GameSummary } from '@/types/game';
import { Skeleton } from '@/components/ui/Feedback';
import { ClockIcon } from '@/components/ui/Icons';
import { formatDate, formatDuration } from '@/utils/format';
import { analysisPath } from '@/utils/routes';
import { cn } from '@/utils/cn';

/**
 * Game history table. Rows are links so middle-click and "open in new tab" work,
 * and the layout collapses to a stacked card on narrow screens.
 */
export function GameList({ games, viewer }: { games: GameSummary[]; viewer: string }) {
  return (
    <div className="min-w-0">
      <div className="tbl-head hidden grid-cols-[1fr_auto_auto_auto_auto] gap-3 px-4 lg:grid">
        <span>Players</span>
        <span className="w-16 text-center">Result</span>
        <span className="w-24">Time</span>
        <span className="w-40">Opening</span>
        <span className="w-28 text-right">Date</span>
      </div>

      <ul>
        {games.map((game) => (
          <li key={game.id} className="tbl-row px-0">
            <GameRow game={game} viewer={viewer} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function GameRow({ game, viewer }: { game: GameSummary; viewer: string }) {
  const resultTone =
    game.playerResult === 'win'
      ? 'chip-win'
      : game.playerResult === 'loss'
        ? 'chip-loss'
        : 'chip-draw';

  return (
    <Link
      to={analysisPath(viewer, game)}
      className="grid gap-2 px-4 lg:grid-cols-[1fr_auto_auto_auto_auto] lg:items-center lg:gap-3"
    >
      <div className="min-w-0">
        <PlayerLine
          side="white"
          name={game.white.username}
          rating={game.white.rating}
          isViewer={game.playerColor === 'white'}
          won={game.outcome === '1-0'}
        />
        <PlayerLine
          side="black"
          name={game.black.username}
          rating={game.black.rating}
          isViewer={game.playerColor === 'black'}
          won={game.outcome === '0-1'}
        />
      </div>

      <span
        className={cn(
          'w-16 shrink-0 rounded-md px-2 py-1 text-center font-mono text-xs font-bold',
          resultTone,
        )}
        title={game.termination ?? undefined}
      >
        {game.outcome === '1/2-1/2' ? '½–½' : game.outcome}
      </span>

      <div className="w-24 shrink-0">
        <p className="text-xs font-medium">{game.timeControlLabel}</p>
        <p className="text-muted text-[11px] capitalize">{game.timeClass ?? game.rules}</p>
      </div>

      <div className="w-40 shrink-0 lg:block">
        <p className="truncate text-xs" title={game.openingName ?? undefined}>
          {game.openingName ?? <span className="text-muted">Unknown opening</span>}
        </p>
        {game.eco && <p className="text-muted text-[11px]">{game.eco}</p>}
      </div>

      <div className="w-28 shrink-0 text-left lg:text-right">
        <p className="text-xs">{formatDate(game.endTime)}</p>
        <p className="text-muted flex items-center gap-1 text-[11px] lg:justify-end">
          {game.moveCount} moves
          {game.durationSeconds !== null && (
            <>
              <ClockIcon size={10} />
              {formatDuration(game.durationSeconds)}
            </>
          )}
        </p>
      </div>
    </Link>
  );
}

function PlayerLine({
  side,
  name,
  rating,
  isViewer,
  won,
}: {
  side: 'white' | 'black';
  name: string;
  rating: number | null;
  isViewer: boolean;
  won: boolean;
}) {
  return (
    <div className="flex items-center gap-1.5 text-sm">
      <span
        className={cn(
          'h-2.5 w-2.5 shrink-0 rounded-[3px] border',
          side === 'white' ? 'bg-eval-white' : 'bg-eval-black',
        )}
        aria-label={side}
      />
      <span className={cn('truncate', isViewer && 'font-semibold', won && 'text-win')}>{name}</span>
      {rating !== null && <span className="text-muted shrink-0 font-mono text-[11px] tabular-nums">{rating}</span>}
    </div>
  );
}

export function GameListSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <ul>
      {Array.from({ length: rows }).map((_, index) => (
        <li key={index} className="flex items-center gap-3 px-4 py-3">
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-3.5 w-40" />
            <Skeleton className="h-3.5 w-32" />
          </div>
          <Skeleton className="h-6 w-16" />
          <Skeleton className="hidden h-8 w-20 lg:block" />
          <Skeleton className="hidden h-8 w-36 lg:block" />
          <Skeleton className="hidden h-8 w-24 lg:block" />
        </li>
      ))}
    </ul>
  );
}
