import { useEffect, useRef, useState } from 'react';
import { useLocalStorage } from '@/hooks/useLocalStorage';
import { useSettings } from '@/hooks/useSettings';
import { LargeTitle, usePageTitle } from '@/hooks/useShell';
import { useInsights, type InsightQuery } from '@/hooks/useInsights';
import { DEFAULT_QUERY, InsightsForm, PERIODS } from '@/components/insights/InsightsForm';
import { InsightGameList } from '@/components/insights/InsightGameList';
import { InsightsReport } from '@/components/insights/InsightsReport';
import { Panel } from '@/components/ui/Panel';
import { EmptyState, ErrorState, ProgressBar, RetryButton, Skeleton, Spinner } from '@/components/ui/Feedback';

/**
 * Strengths and weaknesses: pick a player and a time window, and every game in it
 * is reviewed by Stockfish and folded into one report about how that player plays.
 *
 * The last query is remembered, so coming back to the page — say, after opening
 * one of the games it links to — picks the report straight back up. Finished
 * reviews come from the cache, so only games that were still queued cost anything.
 */
export function InsightsPage() {
  usePageTitle('Strengths & Weaknesses');
  const settings = useSettings();
  const [recent] = useLocalStorage<string[]>('gambit:recent-players', []);
  const [saved, setSaved] = useLocalStorage<InsightQuery | null>('gambit:insights-query', null);
  const insights = useInsights(settings.engine, settings.thresholds);

  // Only the query the page opened with matters here; later runs update `saved` themselves.
  const [initial] = useState<InsightQuery>(() => saved ?? { ...DEFAULT_QUERY, username: recent[0] ?? '' });
  const [resumeWith] = useState(saved);

  const submit = (query: InsightQuery) => {
    setSaved(query);
    insights.run(query);
  };

  // Resume the last report on arrival. Mount-only on purpose: `run` restarts
  // cleanly if called twice (as StrictMode does), so no guard is needed.
  const run = useRef(insights.run);
  run.current = insights.run;
  useEffect(() => {
    if (resumeWith) run.current(resumeWith);
  }, [resumeWith]);

  useEffect(() => {
    document.title = 'Strengths & Weaknesses — Gambit Review';
    return () => {
      document.title = 'Gambit Review — Chess Game Analysis';
    };
  }, []);

  const { query, phase, games, report } = insights;
  const pending = games.filter((entry) => entry.status === 'queued' || entry.status === 'analysing').length;
  const analysable = games.filter((entry) => entry.status !== 'failed').length;
  const period = PERIODS.find((entry) => entry.days === query?.days)?.label.toLowerCase();

  return (
    <div className="@container mx-auto w-full max-w-[1200px] space-y-6 pt-1">
      <LargeTitle>Strengths &amp; Weaknesses</LargeTitle>

      <Panel>
        <InsightsForm
          initial={initial}
          running={insights.running}
          onSubmit={submit}
          onCancel={insights.cancel}
        />
      </Panel>

      {phase === 'error' && (
        <Panel>
          <ErrorState
            title="Could not load the games"
            description={insights.error ?? undefined}
            action={query ? <RetryButton onClick={() => insights.run(query)} /> : undefined}
          />
        </Panel>
      )}

      {phase === 'collecting' && (
        <Panel>
          <div className="flex items-center gap-2.5 py-1">
            <Spinner size={18} className="text-muted" />
            <span className="text-secondary text-[15px]">{insights.message}</span>
          </div>
        </Panel>
      )}

      {query && phase !== 'collecting' && phase !== 'error' && games.length === 0 && phase !== 'idle' && (
        <Panel>
          <EmptyState
            title={`No games found for ${query.username}`}
            description={`Nothing ${query.timeClass === 'all' ? '' : `${query.timeClass} `}in the ${period ?? 'selected period'}. Try a longer period or a different time control.`}
          />
        </Panel>
      )}

      {query && games.length > 0 && (
        <div className="grid items-start gap-6 @4xl:grid-cols-[minmax(0,1fr)_360px] @6xl:grid-cols-[minmax(0,1fr)_400px]">
          {/* The report's own layouts follow the width of this column. */}
          <div className="@container min-w-0">
            {report ? (
              <InsightsReport
                report={report}
                username={query.username}
                boardTheme={settings.boardTheme}
              />
            ) : (
              <ReportPlaceholder cancelled={phase === 'cancelled'} />
            )}
          </div>

          <Panel
            flush
            className="@4xl:sticky @4xl:top-[calc(var(--navbar-height)+1rem)]"
            title={
              <div className="min-w-0">
                <h2 className="panel-title">Games</h2>
                <p className="text-muted text-[13px] tabular-nums">
                  {query.username} · {period} · {insights.completed} of {analysable} reviewed
                </p>
              </div>
            }
            actions={
              phase === 'cancelled' && pending > 0 ? (
                <button type="button" className="btn btn-subtle h-8 px-3 text-[13px]" onClick={() => insights.run(query)}>
                  Resume
                </button>
              ) : undefined
            }
          >
            {insights.running && (
              <div className="space-y-2 border-b px-4 py-3">
                <p className="text-secondary text-[13px]">{insights.message}</p>
                <ProgressBar value={analysable > 0 ? (insights.completed / analysable) * 100 : 0} />
              </div>
            )}
            <div className="max-h-[70vh] overflow-y-auto scroll-thin">
              <InsightGameList games={games} username={query.username} />
            </div>
          </Panel>
        </div>
      )}
    </div>
  );
}

function ReportPlaceholder({ cancelled }: { cancelled: boolean }) {
  return (
    <Panel>
      {cancelled ? (
        <EmptyState
          title="Analysis stopped"
          description="No game had finished yet. Resume from the games list to continue where it stopped."
        />
      ) : (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3 @4xl:grid-cols-4">
            {[0, 1, 2, 3].map((key) => (
              <Skeleton key={key} className="h-[8.5rem] rounded-[var(--radius-widget)]" />
            ))}
          </div>
          <Skeleton className="h-48 rounded-[var(--radius-card)]" />
        </div>
      )}
    </Panel>
  );
}
