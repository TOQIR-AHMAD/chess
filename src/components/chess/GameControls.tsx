import type { ReactNode } from 'react';
import type { GameNavigation } from '@/hooks/useGameNavigation';
import { FlipIcon, PauseIcon, PlayIcon, SkipEnd, SkipStart, ChevronLeft, ChevronRight } from '@/components/ui/Icons';
import { cn } from '@/utils/cn';

/**
 * Playback controls under the board. Mirrors the keyboard shortcuts exactly.
 *
 * A media-player toolbar: tinted glyphs on nothing, in one row of six equal
 * columns — first, back, forward, last, play, flip — with the ply counter hugging
 * the right edge in a seventh column of its own width. One row, because every
 * pixel it takes is a pixel off the board above it.
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
  const step = 'toolbar-btn';

  return (
    <div
      className={cn(
        'grid items-center gap-1',
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
        <SkipStart size={18} />
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
        <ChevronLeft size={22} strokeWidth={2.3} />
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
        <ChevronRight size={22} strokeWidth={2.3} />
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
        <SkipEnd size={18} />
      </button>

      <button
        type="button"
        className={step}
        onClick={nav.togglePlay}
        disabled={totalMoves === 0}
        title={nav.playing ? 'Pause (Space)' : 'Play (Space)'}
        aria-label={nav.playing ? 'Pause playback' : 'Start playback'}
      >
        {nav.playing ? <PauseIcon size={16} /> : <PlayIcon size={16} />}
        {nav.playing ? 'Pause' : 'Play'}
      </button>

      <button type="button" className={step} onClick={nav.flip} title="Flip board (F)" aria-label="Flip board">
        <FlipIcon size={16} />
        Flip
      </button>

      <span className="text-muted self-center pr-1 pl-1.5 text-[13px] whitespace-nowrap tabular-nums">
        {nav.index} / {totalMoves}
      </span>

      {action}
    </div>
  );
}
