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
      {/*
        The quick pass produces every number here from a time-capped search. They
        are worth reading, but a few of them will move when the full pass lands —
        so the panel says which review this is rather than quietly changing later.
      */}
      {review.preliminary && (
        <p className="bg-accent-soft text-secondary rounded-xl px-3 py-2 text-[13px] leading-snug">
          <span className="text-accent font-semibold">Quick review.</span> Still refining at full depth —
          accuracy and a few labels may change.
        </p>
      )}

      {/* Player columns + headline accuracy. */}
      <div className="grid grid-cols-[auto_1fr_1fr] items-center gap-x-2 gap-y-2">
        <span />
        <PlayerHeading name={whiteName} side="white" />
        <PlayerHeading name={blackName} side="black" />

        <span className="text-muted text-[13px]">Accuracy</span>
        <AccuracyBox value={review.white.accuracy} />
        <AccuracyBox value={review.black.accuracy} />
      </div>

      <div className="grid grid-cols-[auto_1fr_1fr] items-center gap-x-2 gap-y-0.5 border-t pt-3">
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
        {rows.length === 0 && <span className="text-muted col-span-3 py-2 text-[13px]">No moves classified.</span>}
      </div>

      <div className="grid grid-cols-[auto_1fr_1fr] items-center gap-x-2 border-t pt-3">
        <span className="text-muted text-[13px]">Avg loss</span>
        <LossBox centipawns={review.white.averageCentipawnLoss} />
        <LossBox centipawns={review.black.averageCentipawnLoss} />
      </div>

      {review.opening && (
        <div className="rounded-xl bg-[var(--fill-4)] px-3 py-2">
          <p className="text-muted text-[12px]">Opening</p>
          <p className="text-[15px] font-semibold">{review.opening.name}</p>
          {review.opening.eco && <p className="text-muted text-[13px]">ECO {review.opening.eco}</p>}
        </div>
      )}
    </div>
  );
}

function PlayerHeading({ name, side }: { name: string; side: 'white' | 'black' }) {
  return (
    <div className="flex min-w-0 items-center justify-center gap-1.5">
      <span
        className={cn('h-2.5 w-2.5 shrink-0 rounded-full border', side === 'white' ? 'bg-eval-white' : 'bg-eval-black')}
      />
      <span className="truncate text-[13px] font-semibold" title={name}>
        {name}
      </span>
    </div>
  );
}

function AccuracyBox({ value }: { value: number }) {
  return (
    <div
      className={cn(
        'rounded-xl py-1.5 text-center text-[22px] font-bold tabular-nums',
        accuracyTone(value),
      )}
    >
      {value.toFixed(1)}
    </div>
  );
}

function LossBox({ centipawns }: { centipawns: number }) {
  return (
    <div className="text-secondary rounded-lg bg-[var(--fill-4)] py-1 text-center text-[13px] tabular-nums">
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
    <span className={cn('text-center text-[15px] font-semibold tabular-nums', count === 0 ? 'text-tertiary' : meta.color)}>
      {count}
    </span>
  );

  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={!onSelect}
      className={cn(
        'col-span-3 grid grid-cols-subgrid items-center rounded-lg px-1.5 py-1 text-left transition-colors',
        onSelect ? 'hover:bg-[var(--fill-4)]' : 'cursor-default',
      )}
      title={onSelect ? `Jump to the first ${meta.label.toLowerCase()}` : undefined}
    >
      <span className="flex items-center gap-2">
        <ClassificationIcon classification={classification} size={20} />
        <span className={cn('text-[13px] font-semibold', meta.color)}>{meta.label}</span>
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
