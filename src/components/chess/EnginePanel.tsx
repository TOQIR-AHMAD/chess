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
 * on the board via `onPlayLine`. A line that ends in forced mate also gets a
 * walk-through button (`onStepLine`), which is the only way to actually read a
 * long mating sequence — those are the lines worth following to the end.
 */
export function EnginePanel({
  fen,
  live,
  onPlayLine,
  onStepLine,
  className,
}: {
  fen: string;
  live: LiveAnalysis;
  onPlayLine?: (uciMoves: string[]) => void;
  onStepLine?: (uciMoves: string[]) => void;
  className?: string;
}) {
  const turn = sideToMove(fen);
  const top = live.lines[0];
  const score = top ? toWhitePov(top.score, turn) : null;

  if (live.status.state === 'error') {
    return (
      <div className={cn('px-4 py-4', className)}>
        <p className="text-danger text-[15px] font-semibold">The engine could not start</p>
        <p className="text-secondary mt-1 text-[13px]">{live.status.error}</p>
        <p className="text-muted mt-2 text-[13px]">
          Move navigation, the move list and the game details all still work — only the evaluation is
          unavailable.
        </p>
      </div>
    );
  }

  if (live.terminal) {
    return (
      <div className={cn('px-4 py-4', className)}>
        <p className="text-[15px] font-semibold">
          {live.terminal === 'checkmate' ? 'Checkmate' : live.terminal === 'stalemate' ? 'Stalemate' : 'Drawn position'}
        </p>
        <p className="text-muted mt-1 text-[13px]">The game is over in this position — nothing left to search.</p>
      </div>
    );
  }

  return (
    <div className={cn('flex flex-col gap-3 px-4 py-3.5', className)}>
      <div className="flex items-center gap-3">
        <span className="cell-icon bg-[linear-gradient(180deg,#8e8e93_0%,#636366_100%)]">
          <CpuIcon size={17} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-semibold">{live.status.name}</p>
          <p className="text-muted flex items-center gap-2 text-[12px] tabular-nums">
            <span>Depth {live.depth || '—'}</span>
            {top?.nodes ? <span>{formatCompactNumber(top.nodes)} nodes</span> : null}
            {live.status.poolSize > 1 && <span>{live.status.poolSize} engines</span>}
          </p>
        </div>
        <div className="text-right">
          <p className={cn('text-[20px] leading-none font-bold tabular-nums', evalTone(score?.value, score?.type))}>
            {score ? formatEval(score) : '—'}
          </p>
          {live.running && (
            <span className="text-muted mt-1 inline-flex items-center gap-1 text-[11px]">
              <Spinner size={11} /> searching
            </span>
          )}
        </div>
      </div>

      {live.status.state === 'loading' && live.status.downloadPercent !== null && (
        <p className="text-muted text-[13px]">Downloading engine — {live.status.downloadPercent}%</p>
      )}

      <ol className="-mx-1.5 space-y-0.5">
        {live.lines.slice(0, 3).map((line) => (
          <EngineLine key={line.multipv} fen={fen} line={line} onPlay={onPlayLine} onStep={onStepLine} />
        ))}
        {live.lines.length === 0 && (
          <li className="text-muted px-1.5 py-2 text-[13px]">{live.running ? 'Calculating…' : 'No lines yet.'}</li>
        )}
      </ol>
    </div>
  );
}

function EngineLine({
  fen,
  line,
  onPlay,
  onStep,
}: {
  fen: string;
  line: PvLine;
  onPlay?: (uciMoves: string[]) => void;
  onStep?: (uciMoves: string[]) => void;
}) {
  const score = toWhitePov(line.score, sideToMove(fen));
  const text = formatSanLine(fen, line.san, 8);
  // Only a forced mate gets the walk-through control. Any line can be stepped
  // through in principle, but on an ordinary line the next move is a suggestion
  // that stops meaning much a few plies in — a mate is a sequence worth reading
  // to the end, and putting the button on every line just makes it noise.
  const mateIn = line.score.type === 'mate' && line.score.value !== 0 ? Math.abs(line.score.value) : null;

  return (
    <li className="flex items-center gap-1">
      <button
        type="button"
        onClick={() => onPlay?.(line.pv)}
        disabled={!onPlay || line.pv.length === 0}
        className={cn(
          'group flex min-w-0 flex-1 items-center gap-2.5 rounded-lg px-1.5 py-1.5 text-left transition-colors',
          onPlay ? 'hover:bg-[var(--fill-4)]' : 'cursor-default',
        )}
        title={onPlay ? 'Play this line out on the board' : undefined}
      >
        <span
          className={cn(
            'min-w-[3.25rem] shrink-0 rounded-md bg-[var(--fill-3)] px-1.5 py-0.5 text-center text-[12px] font-bold tabular-nums',
            evalTone(score.value, score.type),
          )}
        >
          {formatEval(score)}
        </span>
        <span className="text-secondary min-w-0 flex-1 truncate text-[13px] tabular-nums">{text || '—'}</span>
      </button>

      {onStep && mateIn !== null && line.pv.length > 0 && (
        <button
          type="button"
          onClick={() => onStep(line.pv)}
          className="btn btn-subtle h-7 min-h-0 shrink-0 px-2.5 text-[12px]"
          title={`Walk through the mate in ${mateIn}, one move at a time`}
        >
          Step mate
        </button>
      )}
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
