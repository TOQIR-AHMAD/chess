import type { GameReview, MoveClassification } from '@/types/analysis';
import { CLASSIFICATION_META, CLASSIFICATION_ORDER } from '@/services/classification';
import { ClassificationIcon } from './ClassificationIcon';
import { cn } from '@/utils/cn';

/**
 * Game review breakdown.
 *
 * Laid out the way review tools conventionally present it: the two players as
 * columns, accuracy as the headline figure, and one row per move quality with each
 * side's count flanking the badge. Reading across a row compares the two players
 * directly, which a pair of separate bar lists never quite manages.
 */
export function GameReviewPanel({
  review,
  whiteName,
  blackName,
  onSelectPly,
  moves,
  className,
}: {
  review: GameReview;
  whiteName: string;
  blackName: string;
  onSelectPly?: (index: number) => void;
  moves: GameReview['moves'];
  className?: string;
}) {
  const rows = CLASSIFICATION_ORDER.filter(
    (key) => review.white.counts[key] > 0 || review.black.counts[key] > 0,
  );

  return (
    <div className={cn('space-y-4 px-4 py-4', className)}>
      {/* Player columns + headline accuracy. */}
      <div className="grid grid-cols-[auto_1fr_1fr] items-center gap-x-2 gap-y-2">
        <span />
        <PlayerHeading name={whiteName} side="white" />
        <PlayerHeading name={blackName} side="black" />

        <span className="text-muted text-[11px] font-semibold tracking-wide uppercase">Accuracy</span>
        <AccuracyBox value={review.white.accuracy} />
        <AccuracyBox value={review.black.accuracy} />
      </div>

      <div className="grid grid-cols-[auto_1fr_1fr] items-center gap-x-2 gap-y-1 pt-3">
        <span />
        <span />
        <span />
        {rows.map((key) => (
          <QualityRow
            key={key}
            classification={key}
            white={review.white.counts[key]}
            black={review.black.counts[key]}
            onSelect={
              onSelectPly
                ? () => {
                    const first = moves.find((move) => move.classification === key);
                    if (first) onSelectPly(first.ply + 1);
                  }
                : undefined
            }
          />
        ))}
        {rows.length === 0 && (
          <span className="text-muted col-span-3 py-2 text-xs">No moves classified.</span>
        )}
      </div>

      <div className="grid grid-cols-[auto_1fr_1fr] items-center gap-x-2 gap-y-1 pt-3">
        <span className="text-muted text-[11px] font-semibold tracking-wide uppercase">Avg loss</span>
        <LossBox centipawns={review.white.averageCentipawnLoss} />
        <LossBox centipawns={review.black.averageCentipawnLoss} />
      </div>

      {review.opening && (
        <div className="surface-sunken rounded-md px-3 py-2">
          <p className="text-muted text-[10px] font-semibold tracking-wide uppercase">Opening</p>
          <p className="text-sm font-medium">{review.opening.name}</p>
          {review.opening.eco && <p className="text-muted text-xs">ECO {review.opening.eco}</p>}
        </div>
      )}

    </div>
  );
}

function PlayerHeading({ name, side }: { name: string; side: 'white' | 'black' }) {
  return (
    <div className="flex min-w-0 items-center justify-center gap-1.5">
      <span
        className={cn(
          'h-2.5 w-2.5 shrink-0 rounded-[3px] border',
          side === 'white' ? 'bg-eval-white' : 'bg-eval-black',
        )}
      />
      <span className="truncate text-xs font-semibold" title={name}>
        {name}
      </span>
    </div>
  );
}

function AccuracyBox({ value }: { value: number }) {
  return (
    <div
      className={cn(
        'rounded-md py-1.5 text-center font-mono text-lg font-bold tabular-nums',
        accuracyTone(value),
      )}
    >
      {value.toFixed(1)}
    </div>
  );
}

function LossBox({ centipawns }: { centipawns: number }) {
  return (
    <div className="surface-sunken text-secondary rounded-md py-1 text-center font-mono text-xs tabular-nums">
      {(centipawns / 100).toFixed(2)}
    </div>
  );
}

function QualityRow({
  classification,
  white,
  black,
  onSelect,
}: {
  classification: MoveClassification;
  white: number;
  black: number;
  onSelect?: () => void;
}) {
  const meta = CLASSIFICATION_META[classification];

  const Cell = ({ count }: { count: number }) => (
    <span
      className={cn(
        'text-center font-mono text-sm font-semibold tabular-nums',
        count === 0 ? 'text-muted' : meta.color,
      )}
    >
      {count}
    </span>
  );

  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={!onSelect}
      className={cn(
        'col-span-3 grid grid-cols-subgrid items-center rounded px-1 py-1 text-left transition-colors',
        onSelect ? 'hover:bg-[var(--surface-hover)]' : 'cursor-default',
      )}
      title={onSelect ? `Jump to the first ${meta.label.toLowerCase()}` : undefined}
    >
      <span className="flex items-center gap-2">
        <ClassificationIcon classification={classification} size={18} />
        <span className={cn('text-xs font-medium', meta.color)}>{meta.label}</span>
      </span>
      <Cell count={white} />
      <Cell count={black} />
    </button>
  );
}

function accuracyTone(accuracy: number): string {
  if (accuracy >= 90) return 'chip-win';
  if (accuracy >= 80) return 'bg-accent-soft text-accent';
  if (accuracy >= 65) return 'chip-warning';
  return 'chip-loss';
}
