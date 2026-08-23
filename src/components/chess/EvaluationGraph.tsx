import { useCallback, useMemo, useRef, useState } from 'react';
import type { MoveAnalysis, Score } from '@/types/analysis';
import { CLASSIFICATION_META } from '@/services/classification';
import { formatEval, winProbability } from '@/utils/evaluation';
import { cn } from '@/utils/cn';

/**
 * Evaluation graph, drawn as inline SVG.
 *
 * The vertical axis is win probability rather than raw centipawns: an axis that
 * ran to ±10 pawns would flatten every ordinary game into a line at zero. Clicking
 * jumps to a move; hovering shows the move number and its evaluation.
 */

interface EvaluationGraphProps {
  /** Index 0 = starting position, i = after ply i-1. */
  evaluations: Array<Score | null>;
  moves: MoveAnalysis[] | null;
  /** Current position index. */
  index: number;
  onSelect: (index: number) => void;
  className?: string;
  height?: number;
}

const VIEW_W = 1000;

export function EvaluationGraph({
  evaluations,
  moves,
  index,
  onSelect,
  className,
  height = 132,
}: EvaluationGraphProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<number | null>(null);

  const points = useMemo(() => {
    return evaluations.map((score, i) => ({
      i,
      score,
      // 0 (black winning) … 100 (white winning)
      y: score ? winProbability(score) : 50,
      known: score !== null,
    }));
  }, [evaluations]);

  const count = points.length;
  const xFor = useCallback(
    (i: number) => (count <= 1 ? 0 : (i / (count - 1)) * VIEW_W),
    [count],
  );
  const yFor = useCallback((probability: number) => height - (probability / 100) * height, [height]);

  const { whiteArea, blackArea, line } = useMemo(() => {
    if (count === 0) return { whiteArea: '', blackArea: '', line: '' };

    const coords = points.map((point) => ({ x: xFor(point.i), y: yFor(point.y) }));
    const path = coords
      .map((point, i) => `${i === 0 ? 'M' : 'L'}${point.x.toFixed(2)},${point.y.toFixed(2)}`)
      .join(' ');

    // The line's height *is* White's win probability, so White's fill rises from
    // the bottom to meet it and Black's hangs from the top — the same reading as
    // the evaluation bar beside the board, laid on its side.
    return {
      whiteArea: `${path} L${VIEW_W},${height} L0,${height} Z`,
      blackArea: `${path} L${VIEW_W},0 L0,0 Z`,
      line: path,
    };
  }, [count, height, points, xFor, yFor]);

  const analysisByPly = useMemo(() => {
    const map = new Map<number, MoveAnalysis>();
    for (const move of moves ?? []) map.set(move.ply, move);
    return map;
  }, [moves]);

  const indexFromEvent = useCallback(
    (clientX: number): number => {
      const svg = svgRef.current;
      if (!svg || count <= 1) return 0;
      const rect = svg.getBoundingClientRect();
      const ratio = (clientX - rect.left) / rect.width;
      return Math.max(0, Math.min(count - 1, Math.round(ratio * (count - 1))));
    },
    [count],
  );

  const markers = useMemo(() => {
    if (!moves) return [];
    return moves
      .filter((move) => ['brilliant', 'blunder', 'mistake', 'missed'].includes(move.classification))
      .map((move) => ({
        move,
        x: xFor(move.ply + 1),
        y: yFor(evaluations[move.ply + 1] ? winProbability(evaluations[move.ply + 1] as Score) : 50),
      }));
  }, [evaluations, moves, xFor, yFor]);

  if (count === 0) {
    return (
      <div className={cn('text-muted flex items-center justify-center py-8 text-xs', className)} style={{ height }}>
        No evaluations yet
      </div>
    );
  }

  const hoverIndex = hover ?? index;
  const hoverScore = evaluations[hoverIndex] ?? null;
  const hoverMove = hoverIndex > 0 ? analysisByPly.get(hoverIndex - 1) : undefined;
  const hoverMeta = hoverMove ? CLASSIFICATION_META[hoverMove.classification] : null;

  return (
    <div className={cn('relative select-none', className)}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${VIEW_W} ${height}`}
        preserveAspectRatio="none"
        className="block h-full w-full cursor-pointer"
        style={{ height }}
        role="img"
        aria-label="Evaluation over the course of the game"
        onMouseMove={(event) => setHover(indexFromEvent(event.clientX))}
        onMouseLeave={() => setHover(null)}
        onClick={(event) => onSelect(indexFromEvent(event.clientX))}
        onTouchStart={(event) => {
          const touch = event.touches[0];
          if (touch) onSelect(indexFromEvent(touch.clientX));
        }}
      >
        <rect x="0" y="0" width={VIEW_W} height={height} fill="var(--surface-sunken)" />

        {/* Quarter gridlines. */}
        {[25, 50, 75].map((value) => (
          <line
            key={value}
            x1="0"
            x2={VIEW_W}
            y1={yFor(value)}
            y2={yFor(value)}
            stroke="var(--border-subtle)"
            strokeWidth={value === 50 ? 1.5 : 1}
            strokeDasharray={value === 50 ? undefined : '4 6'}
            vectorEffect="non-scaling-stroke"
          />
        ))}

        <path d={blackArea} fill="color-mix(in srgb, var(--eval-black) 88%, transparent)" />
        <path d={whiteArea} fill="color-mix(in srgb, var(--eval-white) 95%, transparent)" />
        <path
          d={line}
          fill="none"
          stroke="var(--color-brand-400)"
          strokeWidth="2"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />

        {markers.map(({ move, x, y }) => (
          <circle
            key={move.ply}
            cx={x}
            cy={y}
            r="4"
            className={CLASSIFICATION_META[move.classification].color}
            fill="currentColor"
            stroke="var(--surface-panel)"
            strokeWidth="1.5"
            vectorEffect="non-scaling-stroke"
          />
        ))}

        {/* Current position marker. */}
        <line
          x1={xFor(index)}
          x2={xFor(index)}
          y1="0"
          y2={height}
          stroke="var(--color-brand-500)"
          strokeWidth="1.5"
          vectorEffect="non-scaling-stroke"
        />
        <circle
          cx={xFor(index)}
          cy={yFor(evaluations[index] ? winProbability(evaluations[index] as Score) : 50)}
          r="4.5"
          fill="var(--color-brand-400)"
          stroke="var(--surface-panel)"
          strokeWidth="2"
          vectorEffect="non-scaling-stroke"
        />
      </svg>

      {hover !== null && (
        <div
          className="panel pointer-events-none absolute z-10 -translate-x-1/2 px-2.5 py-1.5 text-xs whitespace-nowrap"
          style={{
            left: `${(xFor(hoverIndex) / VIEW_W) * 100}%`,
            top: -4,
            transform: 'translate(-50%, -100%)',
          }}
        >
          <div className="font-semibold">
            {hoverIndex === 0
              ? 'Starting position'
              : `Move ${hoverMove?.moveNumber ?? Math.ceil(hoverIndex / 2)}${
                  hoverMove?.color === 'black' ? '…' : '.'
                } ${hoverMove?.san ?? ''}`}
          </div>
          <div className="text-secondary flex items-center gap-2">
            <span className="tabular-nums">{hoverScore ? formatEval(hoverScore) : 'not analysed'}</span>
            {hoverMeta && <span className={hoverMeta.color}>{hoverMeta.label}</span>}
          </div>
        </div>
      )}
    </div>
  );
}
