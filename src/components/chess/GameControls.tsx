import type { GameNavigation } from '@/hooks/useGameNavigation';
import { FlipIcon, PauseIcon, PlayIcon, SkipEnd, SkipStart, ChevronLeft, ChevronRight } from '@/components/ui/Icons';
import { cn } from '@/utils/cn';

/**
 * Playback controls under the board. Mirrors the keyboard shortcuts exactly.
 *
 * Stepping through the game is the one thing done constantly here, so the four
 * step buttons get the full width of the board as one row of large targets, and
 * everything occasional — autoplay, flip, the ply counter — drops to a quieter
 * second row.
 */
export function GameControls({
  nav,
  totalMoves,
  className,
}: {
  nav: GameNavigation;
  totalMoves: number;
  className?: string;
}) {
  const step = 'btn btn-subtle h-11 flex-1 p-0';

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <div className="flex items-stretch gap-1.5">
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
          <ChevronLeft size={20} />
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
          <ChevronRight size={20} />
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
      </div>

      <div className="flex items-center gap-1.5">
        <button
          type="button"
          className="btn btn-ghost h-9 gap-1.5 px-2.5 text-xs"
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
          className="btn btn-ghost h-9 gap-1.5 px-2.5 text-xs"
          onClick={nav.flip}
          title="Flip board (F)"
          aria-label="Flip board"
        >
          <FlipIcon size={15} />
          Flip
        </button>

        <span className="text-muted ml-auto text-xs tabular-nums">
          {nav.index} / {totalMoves}
        </span>
      </div>
    </div>
  );
}
