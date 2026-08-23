import { useEffect, useMemo, useRef } from 'react';
import type { MoveAnalysis } from '@/types/analysis';
import type { ParsedMove } from '@/types/game';
import { CLASSIFICATION_META } from '@/services/classification';
import { formatEval } from '@/utils/evaluation';
import { formatThinkTime, splitSan } from '@/utils/notation';
import { cn } from '@/utils/cn';

/**
 * Two-column move list in figurine notation, with the time each player spent on
 * the move and a bar scaled against the longest think in the game — which makes the
 * moments someone actually stopped to calculate jump straight out of the list.
 *
 * The current ply is highlighted and scrolled into view.
 */

interface MoveListProps {
  moves: ParsedMove[];
  analysis: MoveAnalysis[] | null;
  /** Position index: 0 = start, n = after ply n-1. */
  index: number;
  onSelect: (index: number) => void;
  /** Moves played by the user beyond the game itself. */
  exploration?: ParsedMove[];
  onExitExploration?: () => void;
  /** Shown as a header above the list when the opening is known. */
  openingName?: string | null;
  /** Set false to show plain letters instead of piece symbols. */
  figurine?: boolean;
  className?: string;
}

interface Row {
  moveNumber: number;
  white: ParsedMove | null;
  black: ParsedMove | null;
}

function buildRows(moves: ParsedMove[]): Row[] {
  const rows: Row[] = [];
  for (const move of moves) {
    const last = rows[rows.length - 1];
    if (move.color === 'white' || !last || last.black || last.moveNumber !== move.moveNumber) {
      rows.push({
        moveNumber: move.moveNumber,
        white: move.color === 'white' ? move : null,
        black: move.color === 'black' ? move : null,
      });
    } else {
      last.black = move;
    }
  }
  return rows;
}

export function MoveList({
  moves,
  analysis,
  index,
  onSelect,
  exploration = [],
  onExitExploration,
  openingName,
  figurine = true,
  className,
}: MoveListProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<HTMLButtonElement>(null);

  const rows = useMemo(() => buildRows(moves), [moves]);
  const analysisByPly = useMemo(() => {
    const map = new Map<number, MoveAnalysis>();
    for (const entry of analysis ?? []) map.set(entry.ply, entry);
    return map;
  }, [analysis]);

  /** Longest think in the game, used to scale the time bars. */
  const maxThink = useMemo(() => {
    let max = 0;
    for (const move of moves) {
      if (move.secondsSpent !== null && move.secondsSpent > max) max = move.secondsSpent;
    }
    return max;
  }, [moves]);

  const showTimes = maxThink > 0;

  // Keep the highlighted move visible without yanking the whole page.
  useEffect(() => {
    const node = activeRef.current;
    const container = containerRef.current;
    if (!node || !container) return;
    const nodeTop = node.offsetTop;
    const nodeBottom = nodeTop + node.offsetHeight;
    if (nodeTop < container.scrollTop || nodeBottom > container.scrollTop + container.clientHeight) {
      container.scrollTo({ top: nodeTop - container.clientHeight / 2, behavior: 'smooth' });
    }
  }, [index]);

  if (moves.length === 0) {
    return (
      <div className={cn('text-muted px-4 py-8 text-center text-sm', className)}>
        This game has no moves to show.
      </div>
    );
  }

  const activePly = index > 0 ? index - 1 : -1;

  return (
    <div className={cn('flex min-h-0 flex-col', className)}>
      {openingName && (
        <div className="surface-raised flex shrink-0 items-center gap-2 px-3 py-2">
          <span className="text-muted shrink-0 font-serif text-base leading-none" aria-hidden="true">
            &#9822;
          </span>
          <span className="truncate text-xs font-semibold" title={openingName}>
            {openingName}
          </span>
        </div>
      )}

      <div ref={containerRef} className="scroll-thin min-h-0 flex-1 overflow-y-auto">
        <ol className="text-sm">
          <li>
            <button
              type="button"
              ref={index === 0 ? activeRef : undefined}
              onClick={() => onSelect(0)}
              className={cn(
                'flex w-full items-center px-3 py-1.5 text-left text-xs transition-colors',
                index === 0
                  ? 'bg-accent-soft text-accent font-semibold'
                  : 'text-muted hover:bg-[var(--surface-hover)]',
              )}
            >
              Starting position
            </button>
          </li>

          {rows.map((row, rowIndex) => (
            <li
              key={`${row.moveNumber}-${row.white?.ply ?? row.black?.ply}`}
              className={cn('flex items-stretch', rowIndex % 2 === 1 && 'bg-black/[0.06] dark:bg-white/[0.03]')}
            >
              <span className="text-muted flex w-9 shrink-0 items-center justify-end px-1.5 py-1 text-xs tabular-nums">
                {row.moveNumber}.
              </span>
              <MoveCell
                move={row.white}
                analysis={row.white ? analysisByPly.get(row.white.ply) : undefined}
                active={row.white?.ply === activePly}
                activeRef={row.white?.ply === activePly ? activeRef : undefined}
                onSelect={onSelect}
                figurine={figurine}
              />
              <MoveCell
                move={row.black}
                analysis={row.black ? analysisByPly.get(row.black.ply) : undefined}
                active={row.black?.ply === activePly}
                activeRef={row.black?.ply === activePly ? activeRef : undefined}
                onSelect={onSelect}
                figurine={figurine}
              />
              {showTimes && <TimeColumn white={row.white} black={row.black} maxThink={maxThink} />}
            </li>
          ))}
        </ol>

        {exploration.length > 0 && (
          <div className="px-3 py-2">
            <div className="mb-1 flex items-center justify-between">
              <span className="text-accent text-[11px] font-semibold tracking-wide uppercase">
                Your line
              </span>
              {onExitExploration && (
                <button
                  type="button"
                  className="text-muted text-[11px] hover:underline"
                  onClick={onExitExploration}
                >
                  Return to game
                </button>
              )}
            </div>
            <p className="font-mono text-xs leading-relaxed">
              {exploration.map((move, i) => {
                const { figurine: glyph, rest } = splitSan(move.san);
                return (
                  <span key={`${move.ply}-${i}`} className="mr-1.5">
                    {move.color === 'white' && <span className="text-muted">{move.moveNumber}.</span>}
                    {move.color === 'black' && i === 0 && (
                      <span className="text-muted">{move.moveNumber}&hellip;</span>
                    )}{' '}
                    {figurine && glyph ? `${glyph}${rest}` : move.san}
                  </span>
                );
              })}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function MoveCell({
  move,
  analysis,
  active,
  activeRef,
  onSelect,
  figurine,
}: {
  move: ParsedMove | null;
  analysis: MoveAnalysis | undefined;
  active: boolean;
  activeRef?: React.RefObject<HTMLButtonElement | null>;
  onSelect: (index: number) => void;
  figurine: boolean;
}) {
  if (!move) return <span className="flex-1" />;

  const meta = analysis ? CLASSIFICATION_META[analysis.classification] : null;
  const notable =
    analysis &&
    ['brilliant', 'inaccuracy', 'mistake', 'blunder', 'missed'].includes(analysis.classification);
  const { figurine: glyph, rest } = splitSan(move.san);

  return (
    <button
      type="button"
      ref={activeRef}
      onClick={() => onSelect(move.ply + 1)}
      title={analysis ? `${meta?.label} - ${formatEval(analysis.evalAfter)}` : undefined}
      className={cn(
        'flex flex-1 items-center gap-1.5 px-2 py-1 text-left transition-colors',
        active
          ? 'bg-brand-500/18 ring-brand-500/40 font-semibold ring-1 ring-inset'
          : 'hover:bg-[var(--surface-hover)]',
      )}
    >
      <span
        className={cn(
          'flex min-w-0 flex-1 items-baseline gap-0.5 font-mono text-[13px]',
          notable && meta ? meta.color : '',
        )}
      >
        {figurine && glyph && (
          <span className="font-serif text-[15px] leading-none" aria-hidden="true">
            {glyph}
          </span>
        )}
        <span className="truncate">{figurine && glyph ? rest : move.san}</span>
        {meta?.glyph && <span className={cn('text-[11px] font-bold', meta.color)}>{meta.glyph}</span>}
      </span>

    </button>
  );
}

/**
 * Both players' think times for one move, stacked in a single column at the end of
 * the row. Each carries a bar scaled against the longest think in the game, which
 * makes the moments someone actually stopped to calculate jump out of the list.
 */
function TimeColumn({
  white,
  black,
  maxThink,
}: {
  white: ParsedMove | null;
  black: ParsedMove | null;
  maxThink: number;
}) {
  return (
    <span className="flex w-12 shrink-0 flex-col justify-center gap-0.5 py-1 pr-2">
      <ThinkTime move={white} maxThink={maxThink} />
      <ThinkTime move={black} maxThink={maxThink} />
    </span>
  );
}

function ThinkTime({ move, maxThink }: { move: ParsedMove | null; maxThink: number }) {
  const think = move?.secondsSpent ?? null;
  const share = think !== null && maxThink > 0 ? Math.min(1, think / maxThink) : 0;

  return (
    <span className="flex items-center gap-1">
      <span className="surface-sunken is-pill h-[3px] w-2.5 shrink-0 overflow-hidden">
        <span
          className="is-pill block h-full"
          style={{ width: `${Math.round(share * 100)}%`, background: 'var(--text-muted)' }}
        />
      </span>
      <span className="text-muted text-[10px] leading-none tabular-nums">
        {think !== null ? formatThinkTime(think) : ''}
      </span>
    </span>
  );
}
