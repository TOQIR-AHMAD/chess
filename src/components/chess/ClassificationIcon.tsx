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
  // Opening theory is drawn, not typed \u2014 see `BookGlyph` below.
  book: '',
  inaccuracy: '?!',
  mistake: '?',
  blunder: '??',
  missed: '\u2715',
};

/** An open book: the one classification no single character says clearly. */
function BookGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="66%"
      height="66%"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3.5 5.5A1.5 1.5 0 0 1 5 4h4.2A2.8 2.8 0 0 1 12 5.9 2.8 2.8 0 0 1 14.8 4H19a1.5 1.5 0 0 1 1.5 1.5v11A1.5 1.5 0 0 1 19 18h-4.2a2.8 2.8 0 0 0-2.8 1.9A2.8 2.8 0 0 0 9.2 18H5a1.5 1.5 0 0 1-1.5-1.5z" />
      <path d="M12 6v13.9" />
    </svg>
  );
}

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
      {classification === 'book' ? <BookGlyph /> : GLYPH[classification]}
    </span>
  );
}

export { GLYPH as CLASSIFICATION_GLYPH };
