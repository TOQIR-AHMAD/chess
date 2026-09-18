import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { BoardTheme } from '@/hooks/useSettings';
import { CLASSIFICATION_META } from '@/services/classification';
import { opponentOf } from '@/services/gameService';
import { PHASE_LABELS, type CriticalMoment } from '@/services/insights';
import { ChessBoard } from '@/components/chess/ChessBoard';
import { ClassificationIcon } from '@/components/chess/ClassificationIcon';
import { ExternalIcon } from '@/components/ui/Icons';
import { formatSanLine } from '@/utils/chess';
import { formatDate } from '@/utils/format';
import { formatEval } from '@/utils/evaluation';
import { analysisPath } from '@/utils/routes';
import { cn } from '@/utils/cn';

/**
 * The player's costliest moves across every analysed game, as positions to learn
 * from. Each board shows the position *before* the mistake, from the player's
 * side, with the better move hidden until asked for — so the card works as a
 * puzzle first and an explanation second.
 */
export function CriticalMoments({
  moments,
  username,
  theme,
}: {
  moments: CriticalMoment[];
  username: string;
  theme: BoardTheme;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {moments.map((moment) => (
        <MomentCard key={`${moment.gameId}-${moment.ply}`} moment={moment} username={username} theme={theme} />
      ))}
    </div>
  );
}

function MomentCard({ moment, username, theme }: { moment: CriticalMoment; username: string; theme: BoardTheme }) {
  const [revealed, setRevealed] = useState(false);
  const meta = CLASSIFICATION_META[moment.classification];
  const opponent = opponentOf(moment.summary);
  const number = `${moment.moveNumber}${moment.color === 'white' ? '.' : '…'}`;
  const arrow =
    revealed && moment.bestMove ? { from: moment.bestMove.slice(0, 2), to: moment.bestMove.slice(2, 4) } : null;
  const line = moment.bestLine.length > 1 ? formatSanLine(moment.fenBefore, moment.bestLine, 6) : '';

  return (
    <article className="surface-raised flex flex-col border border-[var(--border-subtle)]">
      <div className="p-3 pb-0">
        <ChessBoard
          fen={moment.fenBefore}
          orientation={moment.color}
          bestMove={arrow}
          interactive={false}
          theme={theme}
          showCoordinates={false}
          animations={false}
        />
      </div>

      <div className="flex flex-1 flex-col gap-2 p-3 text-xs">
        <p className="flex items-center gap-1.5">
          <ClassificationIcon classification={moment.classification} size={16} />
          <span className={cn('font-semibold', meta.color)}>{meta.label}</span>
          <span className="text-muted">
            · move {moment.moveNumber} · {PHASE_LABELS[moment.phase]}
          </span>
        </p>

        <p className="text-secondary">
          You played <span className="font-mono font-semibold">{number} {moment.san}</span>, taking the evaluation
          from <span className="font-mono">{formatEval(moment.evalBefore)}</span> to{' '}
          <span className="font-mono">{formatEval(moment.evalAfter)}</span>.
        </p>

        {revealed ? (
          <p className="text-secondary">
            Better was <span className="text-accent font-mono font-semibold">{moment.bestMoveSan ?? '—'}</span>
            {line && <span className="text-muted font-mono"> ({line})</span>}
          </p>
        ) : (
          <button type="button" className="btn btn-subtle h-8 self-start px-2.5 text-xs" onClick={() => setRevealed(true)}>
            Find the better move — then show it
          </button>
        )}

        <div className="text-muted mt-auto flex items-center justify-between gap-2 pt-1">
          <span className="truncate">
            vs {opponent?.username ?? 'Unknown'} · {formatDate(moment.summary.endTime)}
          </span>
          <Link to={analysisPath(username, moment.summary, moment.ply)} className="hover-accent inline-flex shrink-0 items-center gap-1 font-semibold">
            <ExternalIcon size={12} />
            Review
          </Link>
        </div>
      </div>
    </article>
  );
}
