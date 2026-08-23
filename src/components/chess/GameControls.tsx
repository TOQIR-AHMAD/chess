import type { GameNavigation } from '@/hooks/useGameNavigation';
import { FlipIcon, PauseIcon, PlayIcon, SkipEnd, SkipStart, ChevronLeft, ChevronRight } from '@/components/ui/Icons';
import { cn } from '@/utils/cn';

/**
 * Playback controls under the board. Mirrors the keyboard shortcuts exactly.
 *
 * One row, because every pixel it takes is a pixel off the board above it: the
 * four step buttons stretch across whatever is left once autoplay, flip and the
 * ply counter have taken their fixed widths. On a narrow screen the row wraps
 * rather than crushing the targets.
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
  const step = 'btn btn-subtle h-9 min-w-11 flex-1 p-0';

  return (
    <div className={cn('flex flex-wrap items-stretch gap-1.5', className)}>
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
        className="btn btn-ghost h-9 shrink-0 gap-1.5 px-2.5 text-xs"
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
        className="btn btn-ghost h-9 shrink-0 gap-1.5 px-2.5 text-xs"
        onClick={nav.flip}
        title="Flip board (F)"
        aria-label="Flip board"
      >
        <FlipIcon size={15} />
        Flip
      </button>

      <span className="text-muted shrink-0 self-center pl-1 text-xs tabular-nums">
        {nav.index} / {totalMoves}
      </span>
    </div>
  );
}
