import type { Score } from '@/types/analysis';
import { evalBarPercent, formatEvalBarLabel } from '@/utils/evaluation';
import { cn } from '@/utils/cn';

/**
 * Vertical evaluation bar beside the board.
 *
 * The fill uses win probability rather than raw centipawns, so it behaves the way
 * players expect: very responsive around equality, saturating once a game is won.
 *
 * Drawn like the brightness and volume sliders in iOS Control Center: a rounded
 * track, the fill rising from the bottom with a soft, spring-like ease, and the
 * reading set in the larger of the two bands.
 */
interface EvaluationBarProps {
  score: Score | null;
  orientation: 'white' | 'black';
  /** Hides the number while the first search is still running. */
  pending?: boolean;
  className?: string;
}

export function EvaluationBar({ score, orientation, pending, className }: EvaluationBarProps) {
  const whitePercent = evalBarPercent(score);
  const label = score ? formatEvalBarLabel(score) : '';

  // The bar mirrors the board: the side at the bottom of the board fills from below.
  const flipped = orientation === 'black';
  const bottomShare = flipped ? 100 - whitePercent : whitePercent;

  // Put the number inside whichever band is larger so it always has room, and pick
  // a text colour that contrasts with that band.
  const labelAtBottom = bottomShare >= 50;
  const bandIsLight = labelAtBottom ? !flipped : flipped;

  return (
    <div
      // `self-stretch` rather than `h-full`: a percentage height would resolve
      // against a parent whose own height is content-driven, collapsing the bar.
      className={cn('relative w-[42px] shrink-0 self-stretch overflow-hidden rounded-[14px]', className)}
      role="img"
      aria-label={score ? `Evaluation ${label}` : 'Evaluation not available yet'}
      title={score ? `Evaluation ${label}` : undefined}
    >
      {/* Top half = the side shown at the top of the board. */}
      <div className={cn('absolute inset-0', flipped ? 'bg-eval-white' : 'bg-eval-black')} />
      <div
        className={cn(
          'absolute inset-x-0 bottom-0 transition-[height] duration-500 ease-[cubic-bezier(0.32,0.72,0,1)]',
          flipped ? 'bg-eval-black' : 'bg-eval-white',
        )}
        style={{ height: `${bottomShare}%` }}
      />

      {/* Midpoint marker: a short centred tick rather than a rule across the track. */}
      <div className="absolute top-1/2 left-1/2 h-px w-3 -translate-x-1/2 rounded-full bg-[var(--text-muted)] opacity-60" />

      {!pending && label && (
        <span
          className={cn(
            'absolute inset-x-0 text-center text-[12px] font-bold tabular-nums',
            labelAtBottom ? 'bottom-2.5' : 'top-2.5',
            bandIsLight ? 'text-eval-black' : 'text-eval-white',
          )}
        >
          {label}
        </span>
      )}

      {pending && (
        <span className="absolute inset-0 flex items-center justify-center">
          <span className="bg-brand-500 h-1.5 w-1.5 animate-ping rounded-full" />
        </span>
      )}

      {/*
        The track's edge, laid over both bands — last, so it paints on top of
        them — so the white end still reads as part of the bar on a white card.
      */}
      <span className="pointer-events-none absolute inset-0 rounded-[inherit] shadow-[inset_0_0_0_1px_var(--eval-edge)]" />
    </div>
  );
}
