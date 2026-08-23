import type { MoveClassification } from '@/types/analysis';
import { CLASSIFICATION_META } from '@/services/classification';
import { cn } from '@/utils/cn';

/**
 * The round quality badge used on the board and in the review breakdown.
 *
 * Original artwork: a filled circle plus a text glyph, so it scales cleanly at any
 * size and ships no image assets.
 */
const GLYPH: Record<MoveClassification, string> = {
  brilliant: '!!',
  best: '\u2605',
  excellent: '\u2713',
  good: '\u2713',
  book: '\u265E',
  inaccuracy: '?!',
  mistake: '?',
  blunder: '??',
  missed: '\u2715',
};

/** Solid fills, so the badge stays legible on a board square. */
const TONE: Record<MoveClassification, string> = {
  brilliant: 'tone-brilliant',
  best: 'tone-best',
  excellent: 'tone-excellent',
  good: 'tone-good',
  book: 'tone-book',
  inaccuracy: 'tone-inaccuracy',
  mistake: 'tone-mistake',
  blunder: 'tone-blunder',
  missed: 'tone-missed',
};

export function ClassificationIcon({
  classification,
  size = 20,
  className,
  title,
}: {
  classification: MoveClassification;
  /** Pixel size, or 'square' to scale with the board square it sits on. */
  size?: number | 'square';
  className?: string;
  title?: string;
}) {
  const meta = CLASSIFICATION_META[classification];
  const scaled = size === 'square';

  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-full font-bold leading-none',
        TONE[classification],
        // Square-relative sizing needs the square to be a query container.
        scaled && 'h-[36cqw] w-[36cqw] text-[max(8px,15cqw)] shadow-md',
        className,
      )}
      style={
        scaled
          ? undefined
          : { width: size, height: size, fontSize: Math.max(8, Math.round(size * 0.46)) }
      }
      title={title ?? `${meta.label} — ${meta.description}`}
      aria-label={meta.label}
    >
      {GLYPH[classification]}
    </span>
  );
}

export { GLYPH as CLASSIFICATION_GLYPH };
