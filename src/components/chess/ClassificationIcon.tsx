import type { MoveClassification } from '@/types/analysis';
import { CLASSIFICATION_META } from '@/services/classification';
import {
  BADGE_FACE,
  BADGE_RIM,
  BADGE_SHEEN,
  BADGE_SHEEN_SOFT,
  CLASSIFICATION_ART,
} from './classificationArt';
import { cn } from '@/utils/cn';

/**
 * The round quality badge used on the board, in the move list and in the review
 * breakdown.
 *
 * One inline SVG per badge — no image requests, and it stays sharp from the 13px
 * mark beside a move up to the full-size badge on a board square. See
 * `classificationArt.ts` for how a badge is built.
 */
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
  const art = CLASSIFICATION_ART[classification];
  const scaled = size === 'square';

  return (
    <svg
      viewBox="0 0 90 90"
      role="img"
      aria-label={meta.label}
      // Square-relative sizing needs the square to be a query container.
      className={cn('block shrink-0', scaled && 'h-[36cqw] w-[36cqw]', className)}
      style={scaled ? undefined : { width: size, height: size }}
    >
      <title>{title ?? `${meta.label} — ${meta.description}`}</title>
      <path d={BADGE_RIM} fill={art.rim} />
      <path d={BADGE_FACE} fill={art.face} />
      <path d={BADGE_SHEEN_SOFT} fill={art.sheenSoft} opacity={0.2} />
      <path d={BADGE_SHEEN} fill={art.sheen} />
      <path d={art.glyph} fill={art.ink} transform={`translate(0 ${art.drop})`} />
      <path d={art.glyph} fill="#ffffff" />
    </svg>
  );
}
