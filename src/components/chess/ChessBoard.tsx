import { useCallback, useEffect, useMemo, useState } from 'react';
import { Chess } from 'chess.js';
import { Chessboard } from 'react-chessboard';
import type { MoveClassification } from '@/types/analysis';
import type { BoardTheme } from '@/hooks/useSettings';
import { CLASSIFICATION_META } from '@/services/classification';
import { ClassificationIcon } from './ClassificationIcon';
import { isInCheck, kingSquare, legalTargets, sideToMove } from '@/utils/chess';
import { cn } from '@/utils/cn';

/**
 * The analysis board.
 *
 * Rules and legality come from chess.js; rendering, dragging and arrows come from
 * react-chessboard. Everything visual is driven by the CSS custom properties in
 * `index.css`, so board themes and light/dark mode need no JS branching.
 */

export interface BoardMove {
  from: string;
  to: string;
  promotion?: string;
}

interface ChessBoardProps {
  fen: string;
  orientation: 'white' | 'black';
  lastMove?: { from: string; to: string } | null;
  /** Drawn as a translucent arrow when best-move hints are enabled. */
  bestMove?: { from: string; to: string } | null;
  /** Quality badge pinned to the destination square of the last move. */
  badge?: MoveClassification | null;
  onMove?: (move: BoardMove) => boolean;
  interactive?: boolean;
  theme: BoardTheme;
  showCoordinates?: boolean;
  animations?: boolean;
  className?: string;
}

interface PendingPromotion {
  from: string;
  to: string;
  color: 'w' | 'b';
}

const PROMOTION_PIECES: Array<{ piece: string; label: string; glyph: Record<'w' | 'b', string> }> = [
  { piece: 'q', label: 'Queen', glyph: { w: '♕', b: '♛' } },
  { piece: 'r', label: 'Rook', glyph: { w: '♖', b: '♜' } },
  { piece: 'b', label: 'Bishop', glyph: { w: '♗', b: '♝' } },
  { piece: 'n', label: 'Knight', glyph: { w: '♘', b: '♞' } },
];

export function ChessBoard({
  fen,
  orientation,
  lastMove,
  bestMove,
  badge,
  onMove,
  interactive = true,
  theme,
  showCoordinates = true,
  animations = true,
  className,
}: ChessBoardProps) {
  const [selected, setSelected] = useState<string | null>(null);
  const [promotion, setPromotion] = useState<PendingPromotion | null>(null);

  // Any position change invalidates a half-finished interaction.
  useEffect(() => {
    setSelected(null);
    setPromotion(null);
  }, [fen]);

  const targets = useMemo(() => (selected ? legalTargets(fen, selected) : []), [fen, selected]);

  const inCheck = isInCheck(fen);
  const checkedKing = inCheck ? kingSquare(fen, sideToMove(fen)) : null;

  /** Whether a move needs a promotion choice before it can be played. */
  const needsPromotion = useCallback(
    (from: string, to: string): boolean => {
      const chess = new Chess();
      try {
        chess.load(fen);
      } catch {
        return false;
      }
      const piece = chess.get(from as never);
      if (!piece || piece.type !== 'p') return false;
      const rank = to[1];
      return (piece.color === 'w' && rank === '8') || (piece.color === 'b' && rank === '1');
    },
    [fen],
  );

  const tryMove = useCallback(
    (from: string, to: string, promotionPiece?: string): boolean => {
      if (!onMove || !interactive) return false;
      if (!promotionPiece && needsPromotion(from, to)) {
        setPromotion({ from, to, color: sideToMove(fen) });
        return false;
      }
      const accepted = onMove({ from, to, promotion: promotionPiece });
      if (accepted) {
        setSelected(null);
        setPromotion(null);
      }
      return accepted;
    },
    [fen, interactive, needsPromotion, onMove],
  );

  const onSquareClick = useCallback(
    ({ square }: { square: string }) => {
      if (!interactive) return;
      if (promotion) return;

      if (selected && square !== selected) {
        if (targets.includes(square)) {
          tryMove(selected, square);
          return;
        }
      }

      // Selecting one of your own pieces starts (or restarts) a move.
      const chess = new Chess();
      try {
        chess.load(fen);
      } catch {
        return;
      }
      const piece = chess.get(square as never);
      if (piece && piece.color === sideToMove(fen)) {
        setSelected((current) => (current === square ? null : square));
      } else {
        setSelected(null);
      }
    },
    [fen, interactive, promotion, selected, targets, tryMove],
  );

  const onPieceDrop = useCallback(
    ({ sourceSquare, targetSquare }: { sourceSquare: string; targetSquare: string | null }) => {
      if (!targetSquare) return false;
      return tryMove(sourceSquare, targetSquare);
    },
    [tryMove],
  );

  const squareStyles = useMemo(() => {
    const styles: Record<string, React.CSSProperties> = {};

    if (lastMove) {
      styles[lastMove.from] = { background: 'var(--board-lastmove)' };
      styles[lastMove.to] = { background: 'var(--board-lastmove)' };
    }
    if (checkedKing) {
      styles[checkedKing] = {
        background: 'radial-gradient(circle, var(--board-check) 22%, transparent 72%)',
      };
    }
    if (selected) {
      styles[selected] = { ...styles[selected], background: 'var(--board-highlight)' };
    }
    for (const target of targets) {
      const occupied = styles[target];
      styles[target] = {
        ...occupied,
        // Empty squares get a dot; capturable squares get a ring.
        backgroundImage: 'radial-gradient(circle, var(--board-highlight) 19%, transparent 21%)',
      };
    }
    return styles;
  }, [checkedKing, lastMove, selected, targets]);

  // Amber rather than a plain yellow, and carried at a higher alpha than a green
  // would need: yellow is the lighter colour of the two, so on the cream square it
  // needs the extra weight to stay as legible as it is against the dark one.
  const arrows = useMemo(
    () =>
      bestMove
        ? [{ startSquare: bestMove.from, endSquare: bestMove.to, color: 'rgba(247, 191, 34, 0.85)' }]
        : [],
    [bestMove],
  );

  const badgeSquare = badge && lastMove ? lastMove.to : null;
  const badgeMeta = badge ? CLASSIFICATION_META[badge] : null;

  // `container-type: inline-size` is set on the square itself so the badge scales
  // with one square rather than with the whole board.
  const squareRenderer = useCallback(
    ({ square, children }: { square: string; children?: React.ReactNode }) => (
      <div className="relative h-full w-full [container-type:inline-size]">
        {children}
        {square === badgeSquare && badgeMeta && badge && (
          <ClassificationIcon
            classification={badge}
            size="square"
            className="pointer-events-none absolute -top-[8%] -right-[8%] z-20 drop-shadow-md"
          />
        )}
      </div>
    ),
    [badge, badgeMeta, badgeSquare],
  );

  return (
    <div data-board={theme} className={cn('relative w-full', className)}>
      <Chessboard
        options={{
          id: 'analysis-board',
          position: fen,
          boardOrientation: orientation,
          showNotation: showCoordinates,
          showAnimations: animations,
          animationDurationInMs: animations ? 180 : 0,
          allowDragging: interactive,
          allowDrawingArrows: true,
          arrows,
          squareStyles,
          squareRenderer,
          onSquareClick,
          onPieceDrop,
          darkSquareStyle: { backgroundColor: 'var(--board-dark)' },
          lightSquareStyle: { backgroundColor: 'var(--board-light)' },
          darkSquareNotationStyle: { color: 'var(--board-light)', fontSize: '10px', fontWeight: 600 },
          lightSquareNotationStyle: { color: 'var(--board-dark)', fontSize: '10px', fontWeight: 600 },
          boardStyle: {
            borderRadius: '3px',
            overflow: 'hidden',
            boxShadow: 'var(--shadow-panel)',
          },
          dropSquareStyle: { boxShadow: 'inset 0 0 0 4px var(--board-highlight)' },
        }}
      />

      {promotion && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/45 backdrop-blur-[2px]">
          <div className="panel flex gap-1 p-2">
            {PROMOTION_PIECES.map(({ piece, label, glyph }) => (
              <button
                key={piece}
                type="button"
                className="btn btn-ghost h-12 w-12 text-2xl leading-none"
                title={`Promote to ${label}`}
                onClick={() => tryMove(promotion.from, promotion.to, piece)}
              >
                {glyph[promotion.color]}
              </button>
            ))}
            <button
              type="button"
              className="btn btn-ghost h-12 px-3 text-xs"
              onClick={() => setPromotion(null)}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
