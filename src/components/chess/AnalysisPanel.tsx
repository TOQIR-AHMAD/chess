import type { MoveAnalysis } from '@/types/analysis';
import { CLASSIFICATION_META } from '@/services/classification';
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
        <p className="text-secondary text-sm">Analysing the game…</p>
        <p className="text-muted mt-1 text-xs">
          Move quality appears here as each position is evaluated.
        </p>
      </div>
    );
  }

  const meta = CLASSIFICATION_META[move.classification];
  const playedByLabel = move.color === 'white' ? 'White' : 'Black';
  const bestLine = fenBefore && move.bestLine.length > 0 ? formatSanLine(fenBefore, move.bestLine, 8) : null;
  const isEngineChoice = move.isTopEngineMove;

  return (
    <div className={cn('animate-fade-in space-y-3 px-4 py-3', className)}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-muted text-[11px] font-semibold tracking-wide uppercase">
            Move {move.moveNumber} · {playedByLabel}
          </p>
          <p className="mt-0.5 flex items-baseline gap-1.5 font-mono text-xl font-bold">
            {move.san}
            {meta.glyph && <span className={meta.color}>{meta.glyph}</span>}
          </p>
        </div>
        <span className={cn('chip ring-1', meta.badge)}>{meta.label}</span>
      </div>

      <div className="surface-sunken flex items-center justify-between rounded-lg px-3 py-2">
        <div className="flex items-center gap-2 font-mono text-sm tabular-nums">
          <span className="text-secondary">{formatEval(move.evalBefore)}</span>
          <span className="text-muted">→</span>
          <span className="font-semibold">{formatEval(move.evalAfter)}</span>
        </div>
        <div className="text-right">
          <p className="text-muted text-[10px] tracking-wide uppercase">Accuracy</p>
          <p className="font-mono text-sm font-semibold tabular-nums">{move.accuracy.toFixed(0)}%</p>
        </div>
      </div>

      <p className="text-secondary text-sm leading-relaxed">{move.explanation}</p>

      {!isEngineChoice && move.bestMoveSan && (
        <div className="surface-raised rounded-lg px-3 py-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-muted text-[10px] font-semibold tracking-wide uppercase">Best move</span>
            <span className="text-accent font-mono text-sm font-bold">{move.bestMoveSan}</span>
          </div>
          {bestLine && <p className="text-secondary mt-1.5 font-mono text-xs leading-relaxed">{bestLine}</p>}
        </div>
      )}

      {isEngineChoice && bestLine && (
        <div className="surface-raised rounded-lg px-3 py-2">
          <span className="text-muted text-[10px] font-semibold tracking-wide uppercase">Engine line</span>
          <p className="text-secondary mt-1 font-mono text-xs leading-relaxed">{bestLine}</p>
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
    <div className="surface-sunken rounded-lg px-2 py-1.5">
      <dt className="text-muted text-[10px] tracking-wide uppercase">{label}</dt>
      <dd className="font-mono text-sm font-semibold tabular-nums">{value}</dd>
      <dd className="text-muted text-[10px]">{suffix}</dd>
    </div>
  );
}
