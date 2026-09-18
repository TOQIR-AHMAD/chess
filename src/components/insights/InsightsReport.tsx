import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { BoardTheme } from '@/hooks/useSettings';
import { opponentOf } from '@/services/gameService';
import { PHASE_LABELS, type Insight, type InsightReport, type TrendPoint } from '@/services/insights';
import { Panel } from '@/components/ui/Panel';
import { ProgressBar } from '@/components/ui/Feedback';
import { AlertIcon, ChartIcon, CheckIcon, CrownIcon, ListIcon } from '@/components/ui/Icons';
import { formatDate } from '@/utils/format';
import { analysisPath } from '@/utils/routes';
import { cn } from '@/utils/cn';
import { CriticalMoments } from './CriticalMoments';

/**
 * The insights report: what a batch of reviewed games says about a player.
 *
 * Read top to bottom it goes from the verdict to the evidence — headline numbers,
 * then what to work on and what is already working, then the breakdowns those
 * conclusions were drawn from, and finally the individual positions to study.
 */
export function InsightsReport({
  report,
  username,
  boardTheme,
}: {
  report: InsightReport;
  username: string;
  boardTheme: BoardTheme;
}) {
  return (
    <div className="space-y-6">
      <SummaryTiles report={report} />

      <div className="grid items-start gap-6 @4xl:grid-cols-2">
        <InsightPanel
          title="What to work on"
          subtitle="Most important first"
          insights={report.weaknesses}
          empty="No clear weakness stands out in these games. Analyse more games, or a longer period, for a sharper picture."
        />
        <InsightPanel
          title="What you do well"
          insights={report.strengths}
          empty="No clear strength stands out yet — it usually takes ten or more games for one to show."
        />
      </div>

      <div className="grid items-start gap-6 @4xl:grid-cols-2">
        <PhasePanel report={report} />
        <HabitsPanel report={report} />
      </div>

      {report.critical.length > 0 && (
        <Panel title="Positions to learn from">
          <CriticalMoments moments={report.critical} username={username} theme={boardTheme} />
        </Panel>
      )}

      <OpeningsPanel report={report} />

      <div className="grid items-start gap-6 @4xl:grid-cols-2">
        <ColorsPanel report={report} />
        <PiecesPanel report={report} />
      </div>

      {report.trend.length > 1 && <TrendPanel points={report.trend} username={username} average={report.accuracy} />}
    </div>
  );
}

/* ------------------------------------------------------------------------- */

function SummaryTiles({ report }: { report: InsightReport }) {
  const { record, perGame } = report;
  return (
    <div className="grid grid-cols-2 gap-3 @4xl:grid-cols-4">
      <Tile
        tone="stat-primary"
        icon={<ListIcon className="stat-card-glyph" />}
        value={String(report.games)}
        label="Games analysed"
        sub={`${record.wins}W · ${record.draws}D · ${record.losses}L · ${record.score}% score`}
      />
      <Tile
        tone="stat-info"
        icon={<ChartIcon className="stat-card-glyph" />}
        value={`${report.accuracy.toFixed(1)}%`}
        label="Average accuracy"
        sub={`${(report.averageCentipawnLoss / 100).toFixed(2)} pawns lost per move`}
      />
      <Tile
        tone="stat-warning"
        icon={<AlertIcon className="stat-card-glyph" />}
        value={perGame.blunders.toFixed(1)}
        label="Blunders per game"
        sub={`${perGame.mistakes.toFixed(1)} mistakes · ${perGame.missed.toFixed(1)} misses per game`}
      />
      <Tile
        tone="stat-success"
        icon={<CrownIcon className="stat-card-glyph" />}
        value={`${report.topMoveShare}%`}
        label="Best or excellent moves"
        sub={`Over ${report.moves} moves out of the opening book`}
      />
    </div>
  );
}

function Tile({ tone, icon, value, label, sub }: { tone: string; icon: ReactNode; value: string; label: string; sub: string }) {
  return (
    <div className={cn('stat-card', tone)}>
      <div className="stat-card-top">
        <p className="stat-card-label">{label}</p>
        {icon}
      </div>
      <p className="stat-card-value">{value}</p>
      <p className="stat-card-sub">{sub}</p>
    </div>
  );
}

/* ------------------------------------------------------------------------- */

function InsightPanel({
  title,
  subtitle,
  insights,
  empty,
}: {
  title: string;
  subtitle?: string;
  insights: Insight[];
  empty: string;
}) {
  return (
    <Panel
      flush
      title={
        <div>
          <h2 className="panel-title">{title}</h2>
          {subtitle && <p className="text-muted text-[13px]">{subtitle}</p>}
        </div>
      }
    >
      {insights.length === 0 ? (
        <p className="text-muted px-4 py-6 text-[15px]">{empty}</p>
      ) : (
        <ol className="list-inset [--cell-inset:3.75rem]">
          {insights.map((insight, index) => (
            <InsightItem key={insight.id} insight={insight} rank={index + 1} />
          ))}
        </ol>
      )}
    </Panel>
  );
}

function InsightItem({ insight, rank }: { insight: Insight; rank: number }) {
  const weakness = insight.tone === 'weakness';
  return (
    <li className="flex gap-3 px-4 py-3">
      <span
        className={cn(
          'flex h-8 w-8 shrink-0 items-center justify-center rounded-full',
          weakness ? 'chip-loss' : 'chip-win',
        )}
        aria-label={weakness ? `Weakness ${rank}` : 'Strength'}
      >
        {weakness ? <AlertIcon size={16} strokeWidth={2} /> : <CheckIcon size={16} strokeWidth={2.4} />}
      </span>
      <div className="min-w-0 space-y-1.5">
        <h3 className="list-row-title">
          {weakness && rank <= 3 && <span className="text-muted mr-1.5 text-[12px] font-semibold">#{rank}</span>}
          {insight.title}
        </h3>
        <p className="text-secondary text-[14px] leading-relaxed">{insight.evidence}</p>
        {insight.advice && (
          <p className="bg-accent-soft text-secondary rounded-xl px-3 py-2 text-[14px] leading-relaxed">
            <span className="text-accent font-semibold">How to improve: </span>
            {insight.advice}
          </p>
        )}
      </div>
    </li>
  );
}

/* ------------------------------------------------------------------------- */

function PhasePanel({ report }: { report: InsightReport }) {
  const weakest = report.weaknesses.find((entry) => entry.id.startsWith('phase-weak-'))?.id.slice('phase-weak-'.length);
  const strongest = report.strengths.find((entry) => entry.id.startsWith('phase-strong-'))?.id.slice('phase-strong-'.length);

  return (
    <Panel
      title={
        <div>
          <h2 className="panel-title">By phase of the game</h2>
          <p className="text-muted text-[13px]">Opening: first 10 moves or book · Endgame: six or fewer pieces left</p>
        </div>
      }
    >
      <div className="space-y-4">
        {report.phases.map((phase) => (
          <div key={phase.phase} className="space-y-1.5">
            <div className="flex items-baseline justify-between gap-2">
              <span className="flex items-center gap-2 text-[15px] font-semibold">
                {PHASE_LABELS[phase.phase]}
                {weakest === phase.phase && <span className="chip chip-loss">Weakest</span>}
                {strongest === phase.phase && <span className="chip chip-win">Strongest</span>}
              </span>
              <span className="text-[15px] font-semibold tabular-nums">
                {phase.moves > 0 ? `${phase.accuracy.toFixed(1)}%` : '—'}
              </span>
            </div>
            <ProgressBar value={phase.moves > 0 ? phase.accuracy : 0} />
            <p className="text-muted text-[13px]">
              {phase.moves === 0
                ? 'No moves in this phase yet.'
                : `${phase.errorsPer10} errors per 10 moves · ${phase.blunders} ${
                    phase.blunders === 1 ? 'blunder' : 'blunders'
                  } · ${phase.moves} moves`}
            </p>
          </div>
        ))}
      </div>
    </Panel>
  );
}

/* ------------------------------------------------------------------------- */

interface HabitRow {
  label: string;
  hint: string;
  part: number;
  whole: number;
  /** Which way is good, shown so a bare percentage cannot be misread. */
  better: 'higher' | 'lower';
  extra?: string;
}

function HabitsPanel({ report }: { report: InsightReport }) {
  const { punishing, conversion, resilience, tactics, time, timeouts, record } = report;
  const rows: HabitRow[] = [
    {
      label: 'Punishing mistakes',
      hint: 'Opponent mistakes and blunders you answered with the strongest reply',
      part: punishing.punished,
      whole: punishing.chances,
      better: 'higher',
    },
    {
      label: 'Converting winning positions',
      hint: 'Games where you reached +3 that you went on to win',
      part: conversion.won,
      whole: conversion.winning,
      better: 'higher',
    },
    {
      label: 'Saving lost positions',
      hint: 'Games where you were at −3 that you did not lose',
      part: resilience.saved,
      whole: resilience.losing,
      better: 'higher',
    },
    {
      label: 'Missed forcing moves',
      hint: 'Your errors where the best move was a check or a capture',
      part: tactics.missedForcing,
      whole: tactics.errors,
      better: 'lower',
    },
    {
      label: 'Allowed a check or capture',
      hint: 'Your mistakes and blunders the opponent could answer with a check or capture',
      part: tactics.overlookedThreats,
      whole: tactics.threatErrors,
      better: 'lower',
    },
  ];
  if (time) {
    rows.push({
      label: 'Errors in time trouble',
      hint: 'Moves played with little time left that were errors',
      part: time.troubleErrors,
      whole: time.troubleMoves,
      better: 'lower',
      extra:
        time.normalMoves > 0
          ? `vs ${Math.round((time.normalErrors / time.normalMoves) * 100)}% with time on the clock`
          : undefined,
    });
    if (time.measuredErrors > 0) {
      rows.push({
        label: 'Hasty errors',
        hint: 'Errors played in 3 seconds or less while you had plenty of time',
        part: time.hastyErrors,
        whole: time.measuredErrors,
        better: 'lower',
      });
    }
  }
  rows.push({
    label: 'Losses on time',
    hint: 'Games you lost because the clock ran out',
    part: timeouts.losses,
    whole: record.losses,
    better: 'lower',
  });

  return (
    <Panel title="Habits" flush>
      <ul className="list-inset">
        {rows.map((row) => (
          <li key={row.label} className="grid grid-cols-[1fr_auto] items-center gap-3 px-4 py-2.5">
            <div className="min-w-0">
              <p className="text-[15px] font-semibold">{row.label}</p>
              <p className="text-muted text-[13px] leading-snug">
                {row.hint} · {row.better} is better
              </p>
            </div>
            <div className="text-right">
              <p className="text-[15px] font-semibold tabular-nums">
                {row.whole > 0 ? `${Math.round((row.part / row.whole) * 100)}%` : '—'}
              </p>
              <p className="text-muted text-[12px] tabular-nums">
                {row.whole > 0 ? `${row.part} of ${row.whole}` : 'no cases yet'}
              </p>
              {row.extra && row.whole > 0 && <p className="text-muted text-[12px]">{row.extra}</p>}
            </div>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

/* ------------------------------------------------------------------------- */

function OpeningsPanel({ report }: { report: InsightReport }) {
  const openings = report.openings.slice(0, 10);
  return (
    <Panel title="Openings" flush>
      {openings.length === 0 ? (
        <p className="text-muted px-4 py-6 text-[15px]">No openings recognised yet.</p>
      ) : (
        <div className="min-w-0 overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="tbl-head">
                <th className="px-4 py-2 font-[inherit]">Opening</th>
                <th className="px-2 py-2 text-center font-[inherit]">Games</th>
                <th className="px-2 py-2 text-center font-[inherit]">W / D / L</th>
                <th className="px-2 py-2 text-right font-[inherit]">Score</th>
                <th className="px-4 py-2 text-right font-[inherit]">Accuracy</th>
              </tr>
            </thead>
            <tbody>
              {openings.map((opening) => (
                <tr key={`${opening.color}-${opening.name}`} className="tbl-row">
                  <td className="px-4 py-2">
                    <span className="flex items-center gap-2">
                      <span
                        className={cn(
                          'h-2.5 w-2.5 shrink-0 rounded-full border',
                          opening.color === 'white' ? 'bg-eval-white' : 'bg-eval-black',
                        )}
                        title={`As ${opening.color}`}
                      />
                      <span className="text-[14px] font-medium whitespace-nowrap">{opening.name}</span>
                    </span>
                  </td>
                  <td className="px-2 py-2 text-center tabular-nums">{opening.games}</td>
                  <td className="px-2 py-2 text-center text-[13px] tabular-nums">
                    <span className="text-win">{opening.wins}</span> / <span className="text-draw">{opening.draws}</span> /{' '}
                    <span className="text-loss">{opening.losses}</span>
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums">{opening.score}%</td>
                  <td className="px-4 py-2 text-right font-semibold tabular-nums">{opening.accuracy.toFixed(1)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

function ColorsPanel({ report }: { report: InsightReport }) {
  return (
    <Panel title="White and Black" flush>
      <ul className="list-inset">
        {report.colors.map((entry) => (
          <li key={entry.color} className="grid grid-cols-[1fr_auto_auto] items-center gap-4 px-4 py-2.5">
            <span className="flex flex-wrap items-center gap-x-2">
              <span
                className={cn(
                  'h-3 w-3 shrink-0 rounded-full border',
                  entry.color === 'white' ? 'bg-eval-white' : 'bg-eval-black',
                )}
              />
              <span className="text-[15px] font-semibold capitalize">{entry.color}</span>
              <span className="text-muted text-[13px]">
                {entry.games} {entry.games === 1 ? 'game' : 'games'} · {entry.wins}W {entry.draws}D {entry.losses}L
              </span>
            </span>
            <span className="text-right">
              <span className="block text-[15px] font-semibold tabular-nums">{entry.score}%</span>
              <span className="text-muted block text-[12px]">score</span>
            </span>
            <span className="text-right">
              <span className="block text-[15px] font-semibold tabular-nums">{entry.accuracy.toFixed(1)}%</span>
              <span className="text-muted block text-[12px]">accuracy</span>
            </span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function PiecesPanel({ report }: { report: InsightReport }) {
  const overall = report.moves > 0 ? Math.round((report.tactics.errors / report.moves) * 1000) / 10 : 0;
  return (
    <Panel
      flush
      title={
        <div>
          <h2 className="panel-title">Errors by piece moved</h2>
          <p className="text-muted text-[13px]">Share of your moves with each piece that were errors · {overall}% overall</p>
        </div>
      }
    >
      <ul className="grid grid-cols-3 @md:grid-cols-6">
        {report.pieces.map((piece) => (
          <li key={piece.piece} className="px-3 py-3 text-center">
            <p className="text-muted text-[12px] font-medium capitalize">{piece.label}</p>
            <p
              className={cn(
                'text-[20px] font-bold tabular-nums',
                piece.errors >= 4 && piece.errorRate >= overall * 1.75 && 'text-loss',
              )}
            >
              {piece.errorRate}%
            </p>
            <p className="text-muted text-[12px] tabular-nums">
              {piece.errors}/{piece.moves}
            </p>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

/* ------------------------------------------------------------------------- */

const RESULT_FILL: Record<'win' | 'draw' | 'loss', string> = {
  win: 'var(--result-win)',
  draw: 'var(--result-draw)',
  loss: 'var(--result-loss)',
};

/**
 * One bar per game, oldest on the left, height = the player's accuracy and colour =
 * the result. Colour never carries the result alone: the legend names it, and each
 * bar's tooltip spells out the game.
 */
function TrendPanel({ points, username, average }: { points: TrendPoint[]; username: string; average: number }) {
  return (
    <Panel
      title={
        <div>
          <h2 className="panel-title">Accuracy by game</h2>
          <p className="text-muted text-[13px]">Oldest to newest · click a bar to open that game</p>
        </div>
      }
      actions={
        <div className="text-muted flex items-center gap-3 text-[12px]">
          {(['win', 'draw', 'loss'] as const).map((result) => (
            <span key={result} className="flex items-center gap-1.5 capitalize">
              <span className="h-2 w-2 rounded-full" style={{ background: RESULT_FILL[result] }} />
              {result}
            </span>
          ))}
        </div>
      }
    >
      <div className="relative flex h-36 items-end gap-[3px] border-b border-[var(--border-strong)]">
        <div
          className="pointer-events-none absolute inset-x-0 z-10 border-t border-dashed border-[var(--border-strong)]"
          style={{ bottom: `${average}%` }}
        >
          <span className="text-muted absolute -top-2.5 right-0 rounded-full bg-[var(--surface-panel)] px-1.5 text-[11px] font-medium tabular-nums shadow-[0_0_0_1px_var(--border-subtle)]">
            avg {average.toFixed(1)}%
          </span>
        </div>
        {points.map((point) => {
          const opponent = opponentOf(point.summary);
          const result = point.result ?? 'draw';
          return (
            <Link
              key={point.gameId}
              to={analysisPath(username, point.summary)}
              className="group relative flex h-full min-w-[6px] flex-1 items-end"
              title={`${formatDate(point.summary.endTime)} · vs ${opponent?.username ?? 'Unknown'} · ${result} · ${point.accuracy.toFixed(1)}% accuracy`}
              aria-label={`${formatDate(point.summary.endTime)}, ${result} against ${opponent?.username ?? 'unknown'}, ${point.accuracy.toFixed(1)} percent accuracy`}
            >
              <span
                className="w-full rounded-t-[3px] transition-opacity group-hover:opacity-75"
                style={{ height: `${Math.max(2, point.accuracy)}%`, background: RESULT_FILL[result] }}
              />
            </Link>
          );
        })}
      </div>
    </Panel>
  );
}
