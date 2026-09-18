import { useState } from 'react';
import type { Color } from '@/types/game';
import { formatDuration } from '@/utils/format';
import { cn } from '@/utils/cn';

/**
 * The name plate that sits directly above and below the board.
 *
 * This is the element that makes an analysis page read as a chess board rather
 * than a dashboard: who is playing, which way round, what they have captured and
 * how much time they had left at this point in the game.
 *
 * Captured pieces are drawn with the standard Unicode chess characters, so the
 * strip carries no image assets of its own.
 */

const PIECE_GLYPH: Record<string, string> = {
  p: '♟',
  n: '♞',
  b: '♝',
  r: '♜',
  q: '♛',
};

/** Captured pieces read best in descending value, pawns last. */
const PIECE_ORDER = ['q', 'r', 'b', 'n', 'p'];

export interface PlayerStripProps {
  side: Color;
  name: string;
  rating: number | null;
  title?: string | null;
  avatar?: string | null;
  /** Pieces this player has captured, as lowercase piece letters. */
  captured: string[];
  /** Material advantage in pawns; only shown when positive for this side. */
  advantage: number;
  /** Remaining clock at the current position, in seconds. */
  clockSeconds?: number | null;
  /** Highlights the strip while it is this player's turn. */
  toMove?: boolean;
  result?: '1' | '0' | '½' | null;
  className?: string;
}

export function PlayerStrip({
  side,
  name,
  rating,
  title,
  avatar,
  captured,
  advantage,
  clockSeconds,
  toMove,
  result,
  className,
}: PlayerStripProps) {
  const grouped = PIECE_ORDER.flatMap((piece) => captured.filter((entry) => entry === piece));

  return (
    <div className={cn('flex h-9 min-w-0 items-center gap-2 px-0.5', className)}>
      <Avatar name={name} avatar={avatar} />

      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-1.5">
          {title && (
            <span className="chip chip-warning shrink-0 px-1.5 py-0 text-[10px] leading-4 font-bold">{title}</span>
          )}
          <span className="truncate text-[14px] leading-tight font-semibold">{name}</span>
          {rating !== null && <span className="text-muted shrink-0 text-[13px] tabular-nums">{rating}</span>}
          {toMove && <span className="bg-brand-500 ml-0.5 h-1.5 w-1.5 shrink-0 rounded-full" aria-label="to move" />}
        </div>

        {/*
          Only drawn once there is something to draw: an always-present second
          line would hold the name off the strip's vertical centre for the whole
          opening, when nothing has been captured yet.
        */}
        {(grouped.length > 0 || advantage > 0) && (
          <div className="flex h-4 items-center gap-1">
            {grouped.length > 0 && (
              <span
                className={cn(
                  'font-serif text-[15px] leading-none tracking-[-0.18em]',
                  // White has taken black pieces, and black white ones.
                  side === 'white' ? 'captured-black' : 'captured-white',
                )}
                aria-label={`captured: ${grouped.length} pieces`}
              >
                {grouped.map((piece) => PIECE_GLYPH[piece] ?? '').join('')}
              </span>
            )}
            {advantage > 0 && (
              <span className="text-muted ml-1 text-[11px] font-semibold tabular-nums">+{advantage}</span>
            )}
          </div>
        )}
      </div>

      {result && (
        <span
          className={cn(
            'flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[12px] font-bold',
            result === '1' ? 'chip-win' : result === '½' ? 'chip-draw' : 'chip-loss',
          )}
        >
          {result}
        </span>
      )}

      {clockSeconds !== null && clockSeconds !== undefined && (
        // The running side's clock is the inverted one, as on a chess app's clock face.
        <span
          className={cn(
            'shrink-0 rounded-lg px-2 py-0.5 text-[15px] font-semibold tabular-nums transition-colors',
            toMove ? 'bg-[var(--text-primary)] text-[var(--surface-panel)]' : 'text-muted bg-[var(--fill-3)]',
          )}
        >
          {formatDuration(clockSeconds)}
        </span>
      )}
    </div>
  );
}

function Avatar({ name, avatar }: { name: string; avatar?: string | null }) {
  const [failed, setFailed] = useState(false);

  if (!avatar || failed) {
    return (
      <span className="monogram h-7 w-7 text-[11px]" aria-hidden="true">
        {name.slice(0, 2).toUpperCase()}
      </span>
    );
  }

  return (
    <img
      src={avatar}
      alt=""
      width={28}
      height={28}
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className="surface-raised h-7 w-7 shrink-0 rounded-full object-cover"
    />
  );
}
