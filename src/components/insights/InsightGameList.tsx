import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { MoveClassification } from '@/types/analysis';
import type { ParsedGame } from '@/types/game';
import type { InsightGameEntry } from '@/hooks/useInsights';
import { useSettings } from '@/hooks/useSettings';
import { CLASSIFICATION_META } from '@/services/classification';
import { opponentOf } from '@/services/gameService';
import { ChessBoard } from '@/components/chess/ChessBoard';
import { ClassificationIcon } from '@/components/chess/ClassificationIcon';
import { ProgressBar, Spinner } from '@/components/ui/Feedback';
import { ChevronDown, ChevronLeft, ChevronRight, ExternalIcon, SkipEnd, SkipStart } from '@/components/ui/Icons';
import { formatEval } from '@/utils/evaluation';
import { formatDate } from '@/utils/format';
import { analysisPath } from '@/utils/routes';
import { cn } from '@/utils/cn';

/** Labels worth flagging inline in a move list; everything else reads as plain text. */
const NOTABLE: MoveClassification[] = ['brilliant', 'great', 'inaccuracy', 'mistake', 'missed', 'blunder'];

/**
 * The games an insights pass picked, each with its review status. A row opens to
 * a small board and the full move list, with the player's own notable moves
 * marked; clicking a move shows that position right there, and the full review
 * is one link away.
 */
export function InsightGameList({ games, username }: { games: InsightGameEntry[]; username: string }) {
  const [open, setOpen] = useState<string | null>(null);

  return (
    <ul>
      {games.map((entry) => (
        <li key={entry.summary.id} className="tbl-row px-0 py-0">
          <GameRow
            entry={entry}
            username={username}
            expanded={open === entry.summary.id}
            onToggle={() => setOpen((prev) => (prev === entry.summary.id ? null : entry.summary.id))}
          />
        </li>
      ))}
    </ul>
  );
}

function GameRow({
  entry,
  username,
  expanded,
  onToggle,
}: {
  entry: InsightGameEntry;
  username: string;
  expanded: boolean;
  onToggle: () => void;
}) {
  const { summary, review, parsed } = entry;
  const color = summary.playerColor ?? 'white';
  const opponent = opponentOf(summary);
  const result = summary.playerResult;
  const side = review?.[color];

  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className="grid w-full grid-cols-[auto_1fr_auto] items-center gap-3 px-4 py-2.5 text-left"
      >
        <span
          className={cn(
            'chip w-7 justify-center',
            result === 'win' ? 'chip-win' : result === 'loss' ? 'chip-loss' : 'chip-draw',
          )}
          title={result ? `${result[0].toUpperCase()}${result.slice(1)}` : 'Result unknown'}
        >
          {result === 'win' ? 'W' : result === 'loss' ? 'L' : 'D'}
        </span>

        <span className="min-w-0">
          <span className="flex items-center gap-1.5">
            <span
              className={cn(
                'h-2.5 w-2.5 shrink-0 rounded-[3px] border',
                color === 'white' ? 'bg-eval-white' : 'bg-eval-black',
              )}
              title={`You played ${color}`}
            />
            <span className="list-row-title truncate">
              vs {opponent?.username ?? 'Unknown'}
              {opponent?.rating ? <span className="text-muted font-normal"> ({opponent.rating})</span> : null}
            </span>
          </span>
          <span className="list-row-sub block truncate">
            {summary.timeControlLabel} · {formatDate(summary.endTime)}
            {summary.openingName ? ` · ${summary.openingName}` : ''}
          </span>
        </span>

        <span className="flex items-center gap-2">
          <Status entry={entry} accuracy={side?.accuracy ?? null} blunders={side?.counts.blunder ?? 0} />
          {expanded ? <ChevronDown size={15} className="text-muted" /> : <ChevronRight size={15} className="text-muted" />}
        </span>
      </button>

      {expanded &&
        (parsed ? (
          <GameViewer entry={entry} parsed={parsed} username={username} />
        ) : (
          <p className="text-muted px-4 pb-3 text-xs">{entry.error ?? 'No moves to show.'}</p>
        ))}
    </div>
  );
}

function Status({
  entry,
  accuracy,
  blunders,
}: {
  entry: InsightGameEntry;
  accuracy: number | null;
  blunders: number;
}) {
  switch (entry.status) {
    case 'queued':
      return <span className="text-muted text-xs">Queued</span>;
    case 'analysing':
      return (
        <span className="flex w-24 items-center gap-1.5">
          <Spinner size={12} className="text-accent shrink-0" />
          <ProgressBar value={entry.percent} />
        </span>
      );
    case 'failed':
      return (
        <span className="text-danger text-xs" title={entry.error ?? undefined}>
          Failed
        </span>
      );
    default:
      return (
        <span className="text-right text-xs leading-tight">
          <span className="block font-mono font-semibold tabular-nums">
            {accuracy !== null ? `${accuracy.toFixed(1)}%` : '—'}
          </span>
          <span className={cn('block', blunders > 0 ? 'cls-blunder' : 'text-muted')}>
            {blunders === 0 ? 'no blunders' : `${blunders} blunder${blunders === 1 ? '' : 's'}`}
          </span>
        </span>
      );
  }
}

/**
 * A compact replay of one game, in place: the board, step controls, what the
 * engine made of the move on screen, and the move list to jump around in.
 */
function GameViewer({ entry, parsed, username }: { entry: InsightGameEntry; parsed: ParsedGame; username: string }) {
  const { boardTheme } = useSettings();
  const { summary, review } = entry;
  const last = parsed.moves.length;
  // Counts plies played, so 0 is the starting position. Opens on the final one.
  const [index, setIndex] = useState(last);
  const go = (next: number) => setIndex(Math.max(0, Math.min(last, next)));

  const move = index > 0 ? parsed.moves[index - 1] : null;
  const analysis = index > 0 ? (review?.moves[index - 1] ?? null) : null;
  const meta = analysis ? CLASSIFICATION_META[analysis.classification] : null;

  return (
    <div className="space-y-2.5 px-4 pb-3">
      {/*
        Pinned to the top of the scrolling games list while this game is open, so
        the board stays in sight while the moves below it are scrolled and clicked.
      */}
      <div className="sticky top-0 z-10 -mx-4 space-y-1.5 border-b border-[var(--border-subtle)] bg-[var(--surface-panel)] px-4 pt-1 pb-2">
        <div className="mx-auto w-full max-w-[300px]">
          <ChessBoard
            fen={parsed.positions[index]}
            orientation={summary.playerColor ?? 'white'}
            lastMove={move ? { from: move.from, to: move.to } : null}
            badge={analysis?.classification ?? null}
            interactive={false}
            theme={boardTheme}
            showCoordinates={false}
          />
        </div>

        <div className="mx-auto grid w-full max-w-[300px] grid-cols-4 gap-1">
          <StepButton label="First move" onClick={() => go(0)} disabled={index === 0}>
            <SkipStart size={15} />
          </StepButton>
          <StepButton label="Previous move" onClick={() => go(index - 1)} disabled={index === 0}>
            <ChevronLeft size={15} />
          </StepButton>
          <StepButton label="Next move" onClick={() => go(index + 1)} disabled={index === last}>
            <ChevronRight size={15} />
          </StepButton>
          <StepButton label="Last move" onClick={() => go(last)} disabled={index === last}>
            <SkipEnd size={15} />
          </StepButton>
        </div>
      </div>

      <div className="surface-sunken min-h-[3.25rem] px-3 py-2 text-xs">
        {!move ? (
          <p className="text-muted">Starting position — step forward, or click a move below.</p>
        ) : (
          <>
            <p className="flex flex-wrap items-center gap-1.5">
              <span className="font-mono font-semibold">
                {move.moveNumber}
                {move.color === 'white' ? '.' : '…'} {move.san}
              </span>
              {analysis && meta && (
                <>
                  <ClassificationIcon classification={analysis.classification} size={14} />
                  <span className={cn('font-semibold', meta.color)}>{meta.label}</span>
                  <span className="text-muted ml-auto font-mono tabular-nums">
                    {formatEval(analysis.evalBefore)} → {formatEval(analysis.evalAfter)}
                  </span>
                </>
              )}
            </p>
            <p className="text-secondary mt-1 leading-relaxed">
              {analysis
                ? analysis.explanation
                : entry.status === 'failed'
                  ? 'This game could not be reviewed.'
                  : 'Waiting for Stockfish — the verdict on each move appears once this game is reviewed.'}
            </p>
          </>
        )}
      </div>

      <MoveText entry={entry} parsed={parsed} current={index} onSelect={go} />

      <Link to={analysisPath(username, summary, index)} className="btn btn-subtle h-8 px-2.5 text-xs">
        <ExternalIcon size={13} />
        Open in full review
      </Link>
    </div>
  );
}

function StepButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className="btn btn-ghost h-8 px-0"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
    >
      {children}
    </button>
  );
}

/** The game's moves as numbered text: the player's notable moves badged, the one on the board lit. */
function MoveText({
  entry,
  parsed,
  current,
  onSelect,
}: {
  entry: InsightGameEntry;
  parsed: ParsedGame;
  current: number;
  onSelect: (index: number) => void;
}) {
  const { summary, review } = entry;
  const color = summary.playerColor;

  // No scroll box of its own: the games list is the one thing that scrolls, with
  // the board pinned above these moves.
  return (
    <p className="surface-sunken px-3 py-2 font-mono text-xs leading-6">
      {parsed.moves.map((move, index) => {
        const analysis = review?.moves[index];
        const notable =
          analysis && move.color === color && NOTABLE.includes(analysis.classification) ? analysis.classification : null;
        const meta = notable ? CLASSIFICATION_META[notable] : null;
        const active = current === move.ply + 1;

        return (
          <span key={move.ply} className="inline-flex items-center">
            {move.color === 'white' && <span className="text-muted mr-1">{move.moveNumber}.</span>}
            {move.color === 'black' && index === 0 && <span className="text-muted mr-1">{move.moveNumber}…</span>}
            <button
              type="button"
              onClick={() => onSelect(move.ply + 1)}
              aria-current={active ? 'true' : undefined}
              className={cn(
                'mr-2 inline-flex items-center gap-0.5 px-0.5',
                active ? 'bg-brand-500 text-white' : 'hover:bg-[var(--surface-hover)]',
                !active && (meta ? `${meta.color} font-semibold` : 'text-secondary'),
              )}
              title={meta ? `${meta.label} — show this position` : 'Show this position'}
            >
              {move.san}
              {notable && <ClassificationIcon classification={notable} size={12} />}
            </button>
          </span>
        );
      })}
    </p>
  );
}
