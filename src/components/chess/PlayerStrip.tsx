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
  p: '\u265F',
  n: '\u265E',
  b: '\u265D',
  r: '\u265C',
  q: '\u265B',
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
  result?: '1' | '0' | '\u00BD' | null;
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
    <div
      className={cn(
        'flex h-9 min-w-0 items-center gap-2 border bg-[var(--surface-panel)] px-2',
        className,
      )}
    >
      <Avatar name={name} avatar={avatar} side={side} />

      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-1.5">
          {title && (
            <span className="chip-warning shrink-0 rounded-sm px-1 text-[10px] leading-4 font-bold">
              {title}
            </span>
          )}
          <span className="truncate text-sm leading-tight font-semibold">{name}</span>
          {rating !== null && (
            <span className="text-muted shrink-0 font-mono text-xs tabular-nums">({rating})</span>
          )}
          {toMove && (
            <span
              className="bg-brand-500 is-pill ml-0.5 h-1.5 w-1.5 shrink-0"
              aria-label="to move"
            />
          )}
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
                  side === 'white' ? 'text-eval-black' : 'text-eval-white',
                )}
                aria-label={`captured: ${grouped.length} pieces`}
              >
                {grouped.map((piece) => PIECE_GLYPH[piece] ?? '').join('')}
              </span>
            )}
            {advantage > 0 && (
              <span className="text-muted ml-1 text-[11px] font-semibold tabular-nums">
                +{advantage}
              </span>
            )}
          </div>
        )}
      </div>

      {result && (
        // The playback buttons' own face — outlined white tile, slate rules — with
        // only the figure itself carrying the win/draw/loss colour.
        <span
          className={cn(
            'btn btn-subtle h-6 w-6 min-h-0 shrink-0 p-0 font-mono text-xs font-bold',
            result === '1'
              ? 'text-win'
              : result === '\u00BD'
                ? 'text-draw'
                : 'text-loss',
          )}
        >
          {result}
        </span>
      )}

      {clockSeconds !== null && clockSeconds !== undefined && (
        <span
          className={cn(
            'shrink-0 rounded px-2 py-1 font-mono text-sm font-semibold tabular-nums',
            toMove ? 'bg-[var(--surface-hover)] text-[var(--text-primary)]' : 'surface-sunken text-muted',
          )}
        >
          {formatDuration(clockSeconds)}
        </span>
      )}
    </div>
  );
}

function Avatar({ name, avatar, side }: { name: string; avatar?: string | null; side: Color }) {
  const [failed, setFailed] = useState(false);

  if (!avatar || failed) {
    return (
      <span
        className={cn(
          'flex h-8 w-8 shrink-0 items-center justify-center rounded text-[11px] font-bold',
          side === 'white' ? 'bg-eval-white text-eval-black' : 'bg-eval-black text-eval-white',
        )}
        aria-hidden="true"
      >
        {name.slice(0, 2).toUpperCase()}
      </span>
    );
  }

  return (
    <img
      src={avatar}
      alt=""
      width={32}
      height={32}
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className="surface-raised h-8 w-8 shrink-0 rounded object-cover"
    />
  );
}
