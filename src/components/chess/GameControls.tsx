import type { ReactNode } from 'react';
import type { GameNavigation } from '@/hooks/useGameNavigation';
import { FlipIcon, PauseIcon, PlayIcon, SkipEnd, SkipStart, ChevronLeft, ChevronRight } from '@/components/ui/Icons';
import { cn } from '@/utils/cn';

/**
 * Playback controls under the board. Mirrors the keyboard shortcuts exactly.
 *
 * One row of six equal columns — first, back, forward, last, play, flip — all cut
 * from the same outlined face, with the ply counter hugging the right edge in a
 * seventh column of its own width. One row, because every pixel it takes is a
 * pixel off the board above it.
 */
export function GameControls({
  nav,
  totalMoves,
  action,
  className,
}: {
  nav: GameNavigation;
  totalMoves: number;
  action?: ReactNode;
  className?: string;
}) {
  const step = 'btn btn-subtle h-8 min-h-0 min-w-0 p-0';

  return (
    <div
      className={cn(
        'grid items-stretch gap-1.5',
        action
          ? 'grid-cols-[repeat(6,minmax(0,1fr))_auto_auto]'
          : 'grid-cols-[repeat(6,minmax(0,1fr))_auto]',
        className,
      )}
    >
      <button
        type="button"
        className={step}
        onClick={() => {
          nav.stop();
          nav.first();
        }}
        disabled={nav.isStart}
        title="First move (Home)"
        aria-label="Go to first move"
      >
        <SkipStart size={17} />
      </button>
      <button
        type="button"
        className={step}
        onClick={() => {
          nav.stop();
          nav.previous();
        }}
        disabled={nav.isStart}
        title="Previous move (←)"
        aria-label="Previous move"
      >
        <ChevronLeft size={19} />
      </button>
      <button
        type="button"
        className={step}
        onClick={() => {
          nav.stop();
          nav.next();
        }}
        disabled={nav.isEnd}
        title="Next move (→)"
        aria-label="Next move"
      >
        <ChevronRight size={19} />
      </button>
      <button
        type="button"
        className={step}
        onClick={() => {
          nav.stop();
          nav.last();
        }}
        disabled={nav.isEnd}
        title="Last move (End)"
        aria-label="Go to last move"
      >
        <SkipEnd size={17} />
      </button>

      <button
        type="button"
        className={cn(step, 'gap-1.5 text-xs')}
        onClick={nav.togglePlay}
        disabled={totalMoves === 0}
        title={nav.playing ? 'Pause (Space)' : 'Play (Space)'}
        aria-label={nav.playing ? 'Pause playback' : 'Start playback'}
      >
        {nav.playing ? <PauseIcon size={15} /> : <PlayIcon size={15} />}
        {nav.playing ? 'Pause' : 'Play'}
      </button>

      <button
        type="button"
        className={cn(step, 'gap-1.5 text-xs')}
        onClick={nav.flip}
        title="Flip board (F)"
        aria-label="Flip board"
      >
        <FlipIcon size={15} />
        Flip
      </button>

      <span className="text-muted self-center pl-1 text-xs whitespace-nowrap tabular-nums">
        {nav.index} / {totalMoves}
      </span>

      {action}
    </div>
  );
}
