import type { PvLine } from '@/types/analysis';
import type { LiveAnalysis } from '@/hooks/useStockfish';
import { CpuIcon } from '@/components/ui/Icons';
import { Spinner } from '@/components/ui/Feedback';
import { formatCompactNumber } from '@/utils/format';
import { formatEval, toWhitePov } from '@/utils/evaluation';
import { formatSanLine } from '@/utils/chess';
import { sideToMove } from '@/utils/chess';
import { cn } from '@/utils/cn';

/**
 * Live engine readout for the position currently on the board: name, depth,
 * evaluation and the top principal variations. Clicking a variation plays it out
 * on the board via `onPlayLine`.
 */
export function EnginePanel({
  fen,
  live,
  onPlayLine,
  className,
}: {
  fen: string;
  live: LiveAnalysis;
  onPlayLine?: (uciMoves: string[]) => void;
  className?: string;
}) {
  const turn = sideToMove(fen);
  const top = live.lines[0];
  const score = top ? toWhitePov(top.score, turn) : null;

  if (live.status.state === 'error') {
    return (
      <div className={cn('px-4 py-4 text-sm', className)}>
        <p className="text-danger font-medium">The engine could not start</p>
        <p className="text-secondary mt-1 text-xs">{live.status.error}</p>
        <p className="text-muted mt-2 text-xs">
          Move navigation, the move list and the game details all still work — only the evaluation is
          unavailable.
        </p>
      </div>
    );
  }

  if (live.terminal) {
    return (
      <div className={cn('px-4 py-4', className)}>
        <p className="text-sm font-semibold">
          {live.terminal === 'checkmate' ? 'Checkmate' : live.terminal === 'stalemate' ? 'Stalemate' : 'Drawn position'}
        </p>
        <p className="text-secondary mt-1 text-xs">The game is over in this position — nothing left to search.</p>
      </div>
    );
  }

  return (
    <div className={cn('flex flex-col gap-3 px-4 py-3', className)}>
      <div className="flex items-center gap-3">
        <span className="text-accent surface-raised flex h-8 w-8 items-center justify-center rounded-lg">
          <CpuIcon size={16} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{live.status.name}</p>
          <p className="text-muted flex items-center gap-2 text-[11px]">
            <span>Depth {live.depth || '—'}</span>
            {top?.nodes ? <span>{formatCompactNumber(top.nodes)} nodes</span> : null}
            {live.status.multiThreaded && <span>multi-threaded</span>}
          </p>
        </div>
        <div className="text-right">
          <p className={cn('font-mono text-lg leading-none font-bold tabular-nums', evalTone(score?.value, score?.type))}>
            {score ? formatEval(score) : '—'}
          </p>
          {live.running && (
            <span className="text-muted mt-1 inline-flex items-center gap-1 text-[10px]">
              <Spinner size={10} /> searching
            </span>
          )}
        </div>
      </div>

      {live.status.state === 'loading' && live.status.downloadPercent !== null && (
        <p className="text-muted text-xs">Downloading engine — {live.status.downloadPercent}%</p>
      )}

      <ol className="space-y-1">
        {live.lines.slice(0, 3).map((line) => (
          <EngineLine key={line.multipv} fen={fen} line={line} onPlay={onPlayLine} />
        ))}
        {live.lines.length === 0 && (
          <li className="text-muted py-2 text-xs">
            {live.running ? 'Calculating…' : 'No lines yet.'}
          </li>
        )}
      </ol>
    </div>
  );
}

function EngineLine({
  fen,
  line,
  onPlay,
}: {
  fen: string;
  line: PvLine;
  onPlay?: (uciMoves: string[]) => void;
}) {
  const score = toWhitePov(line.score, sideToMove(fen));
  const text = formatSanLine(fen, line.san, 8);

  return (
    <li>
      <button
        type="button"
        onClick={() => onPlay?.(line.pv)}
        disabled={!onPlay || line.pv.length === 0}
        className={cn(
          'group flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left transition-colors',
          onPlay ? 'hover:bg-[var(--surface-hover)]' : 'cursor-default',
        )}
        title={onPlay ? 'Play this line on the board' : undefined}
      >
        <span
          className={cn(
            'surface-raised mt-px shrink-0 rounded px-1.5 py-0.5 font-mono text-[11px] font-bold tabular-nums',
            evalTone(score.value, score.type),
          )}
        >
          {formatEval(score)}
        </span>
        <span className="text-secondary min-w-0 flex-1 truncate font-mono text-xs">{text || '—'}</span>
      </button>
    </li>
  );
}

function evalTone(value: number | undefined, type: string | undefined): string {
  if (value === undefined) return '';
  if (type === 'mate') return value > 0 ? 'text-win' : 'text-loss';
  if (value > 50) return 'text-win';
  if (value < -50) return 'text-loss';
  return '';
}
