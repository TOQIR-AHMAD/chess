import type { MoveAnalysis } from '@/types/analysis';
import { CLASSIFICATION_META } from '@/services/classification';
import { ClassificationIcon } from './ClassificationIcon';
import { formatEval } from '@/utils/evaluation';
import { formatSanLine } from '@/utils/chess';
import { cn } from '@/utils/cn';

/**
 * Per-move analysis card.
 *
 * Everything here comes from the engine pass: the evaluations, the loss, the best
 * move and its principal variation. No commentary is generated beyond what those
 * numbers support.
 */
export function AnalysisPanel({
  move,
  fenBefore,
  analysing,
  className,
}: {
  move: MoveAnalysis | null;
  fenBefore: string | null;
  analysing: boolean;
  className?: string;
}) {
  // With no move selected there is nothing to say: the card stays out of the way
  // entirely, and only the running review announces itself.
  if (!move) {
    if (!analysing) return null;
    return (
      <div className={cn('px-4 py-6 text-center', className)}>
        <p className="text-[15px] font-semibold">Analysing the game…</p>
        <p className="text-muted mt-1 text-[13px]">Move quality appears here as each position is evaluated.</p>
      </div>
    );
  }

  const meta = CLASSIFICATION_META[move.classification];
  const playedByLabel = move.color === 'white' ? 'White' : 'Black';
  const bestLine = fenBefore && move.bestLine.length > 0 ? formatSanLine(fenBefore, move.bestLine, 8) : null;
  const isEngineChoice = move.isTopEngineMove;

  return (
    <div className={cn('animate-fade-in space-y-2.5 px-4 py-3', className)}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-muted text-[13px]">
            Move {move.moveNumber} · {playedByLabel}
          </p>
          <p className="mt-0.5 flex items-center gap-2 text-[22px] leading-tight font-bold tracking-[-0.02em] tabular-nums">
            <ClassificationIcon classification={move.classification} size={24} />
            {move.san}
          </p>
        </div>
        <span className={cn('chip mt-0.5', meta.badge)}>{meta.label}</span>
      </div>

      <div className="flex items-center justify-between rounded-xl bg-[var(--fill-4)] px-3 py-2">
        <div className="flex items-center gap-2 text-[15px] tabular-nums">
          <span className="text-secondary">{formatEval(move.evalBefore)}</span>
          <span className="text-muted">→</span>
          <span className="font-semibold">{formatEval(move.evalAfter)}</span>
        </div>
        <div className="text-right">
          <p className="text-muted text-[11px]">Accuracy</p>
          <p className="text-[15px] leading-tight font-semibold tabular-nums">{move.accuracy.toFixed(0)}%</p>
        </div>
      </div>

      <p className="text-secondary text-[14px] leading-relaxed">{move.explanation}</p>

      {!isEngineChoice && move.bestMoveSan && (
        <div className="bg-accent-soft rounded-xl px-3 py-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-accent text-[12px] font-semibold">Best move</span>
            <span className="text-accent text-[15px] font-bold tabular-nums">{move.bestMoveSan}</span>
          </div>
          {bestLine && <p className="text-secondary mt-1 text-[13px] leading-relaxed tabular-nums">{bestLine}</p>}
        </div>
      )}

      {isEngineChoice && bestLine && (
        <div className="rounded-xl bg-[var(--fill-4)] px-3 py-2">
          <span className="text-muted text-[12px] font-semibold">Engine line</span>
          <p className="text-secondary mt-0.5 text-[13px] leading-relaxed tabular-nums">{bestLine}</p>
        </div>
      )}

      <dl className="grid grid-cols-3 gap-2 text-center">
        <Stat label="Lost" value={`${(move.centipawnLoss / 100).toFixed(2)}`} suffix="pawns" />
        <Stat label="Win %" value={`−${move.winProbLoss.toFixed(1)}`} suffix="points" />
        <Stat label="Depth" value={String(move.depth || '—')} suffix="plies" />
      </dl>
    </div>
  );
}

function Stat({ label, value, suffix }: { label: string; value: string; suffix: string }) {
  return (
    <div className="rounded-xl bg-[var(--fill-4)] px-2 py-1.5">
      <dt className="text-muted text-[11px]">{label}</dt>
      <dd className="text-[15px] leading-tight font-semibold tabular-nums">
        {value} <span className="text-muted text-[11px] font-normal">{suffix}</span>
      </dd>
    </div>
  );
}
