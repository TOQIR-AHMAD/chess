import { Link } from 'react-router-dom';
import type { GameSummary } from '@/types/game';
import { Skeleton } from '@/components/ui/Feedback';
import { ChevronRight, ClockIcon } from '@/components/ui/Icons';
import { formatDate, formatDuration } from '@/utils/format';
import { analysisPath } from '@/utils/routes';
import { cn } from '@/utils/cn';

/**
 * Game history, as an iOS list: each row is a link with a disclosure chevron, so
 * middle-click and "open in new tab" work. In a narrow column a row is the two
 * players over one gray line of details; given the room, the details spread into
 * columns.
 */
export function GameList({ games, viewer }: { games: GameSummary[]; viewer: string }) {
  return (
    <div className="min-w-0">
      <div className="tbl-head hidden items-center gap-3 @4xl:flex">
        <span className="min-w-0 flex-1">Players</span>
        <span className="w-14 text-center">Result</span>
        <span className="w-24">Time</span>
        <span className="w-40">Opening</span>
        <span className="w-28 text-right">Date</span>
        <span className="w-[15px]" aria-hidden="true" />
      </div>

      <ul>
        {games.map((game) => (
          <li key={game.id} className="tbl-row p-0">
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

  const details = [
    `${game.timeControlLabel} ${game.timeClass ?? game.rules}`,
    game.openingName,
    formatDate(game.endTime),
  ].filter(Boolean);

  return (
    <Link to={analysisPath(viewer, game)} className="flex items-center gap-3 px-4 py-2.5">
      <div className="min-w-0 flex-1">
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
        <p className="text-muted mt-0.5 truncate text-[13px] @4xl:hidden">{details.join(' · ')}</p>
      </div>

      <span
        className={cn('chip w-14 shrink-0 justify-center tabular-nums', resultTone)}
        title={game.termination ?? undefined}
      >
        {game.outcome === '1/2-1/2' ? '½–½' : game.outcome}
      </span>

      <div className="hidden w-24 shrink-0 @4xl:block">
        <p className="text-[14px]">{game.timeControlLabel}</p>
        <p className="text-muted text-[12px] capitalize">{game.timeClass ?? game.rules}</p>
      </div>

      <div className="hidden w-40 shrink-0 @4xl:block">
        <p className="truncate text-[14px]" title={game.openingName ?? undefined}>
          {game.openingName ?? <span className="text-muted">Unknown opening</span>}
        </p>
        {game.eco && <p className="text-muted text-[12px]">{game.eco}</p>}
      </div>

      <div className="hidden w-28 shrink-0 text-right @4xl:block">
        <p className="text-[14px]">{formatDate(game.endTime)}</p>
        <p className="text-muted flex items-center justify-end gap-1 text-[12px]">
          {game.moveCount} moves
          {game.durationSeconds !== null && (
            <>
              <ClockIcon size={11} />
              {formatDuration(game.durationSeconds)}
            </>
          )}
        </p>
      </div>

      <ChevronRight size={15} strokeWidth={2.2} className="cell-chevron" />
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
    <div className="flex items-center gap-2 text-[15px] leading-snug">
      <span
        className={cn('h-2.5 w-2.5 shrink-0 rounded-full border', side === 'white' ? 'bg-eval-white' : 'bg-eval-black')}
        aria-label={side}
      />
      <span className={cn('truncate', isViewer && 'font-semibold', won && 'text-win')}>{name}</span>
      {rating !== null && <span className="text-muted shrink-0 text-[13px] tabular-nums">{rating}</span>}
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
          <Skeleton className="h-6 w-14 rounded-full" />
          <Skeleton className="hidden h-8 w-24 @4xl:block" />
          <Skeleton className="hidden h-8 w-40 @4xl:block" />
          <Skeleton className="hidden h-8 w-28 @4xl:block" />
        </li>
      ))}
    </ul>
  );
}
