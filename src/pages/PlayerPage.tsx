import { useEffect } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useLocalStorage } from '@/hooks/useLocalStorage';
import { usePageTitle } from '@/hooks/useShell';
import { usePlayer } from '@/hooks/usePlayer';
import { usePlayerGames } from '@/hooks/usePlayerGames';
import { PlayerProfile, PlayerProfileSkeleton } from '@/components/player/PlayerProfile';
import { GameFilters } from '@/components/player/GameFilters';
import { GameList, GameListSkeleton } from '@/components/player/GameList';
import { EmptyState, ErrorState, ProgressBar, RetryButton, Spinner } from '@/components/ui/Feedback';
import { Panel } from '@/components/ui/Panel';
import { ChevronLeft, ChevronRight } from '@/components/ui/Icons';
import { hasActiveFilters, summariseGames } from '@/services/gameService';
import { formatMonth } from '@/utils/format';

/** Profile + game history for one player. */
export function PlayerPage() {
  const { username = '' } = useParams<{ username: string }>();
  const player = usePlayer(username);
  const games = usePlayerGames(username);

  // Pushed from Search, so the bar offers the way back to it.
  usePageTitle(username || 'Player', { to: '/', label: 'Search' });

  // Recording the visit here rather than in the search form means a deep link,
  // the navbar search and the hero search all feed the rail's recent list.
  const [, setRecent] = useLocalStorage<string[]>('gambit:recent-players', []);
  useEffect(() => {
    if (!username) return;
    setRecent((prev) => [username, ...prev.filter((entry) => entry !== username)].slice(0, 6));
  }, [username, setRecent]);

  useEffect(() => {
    document.title = username ? `${username} — Gambit Review` : 'Gambit Review';
    return () => {
      document.title = 'Gambit Review — Chess Game Analysis';
    };
  }, [username]);

  if (player.error) {
    return (
      <div className="mx-auto max-w-xl py-12">
        <ErrorState
          title={player.error.kind === 'not-found' ? `No player called “${username}”` : 'Could not load this player'}
          description={player.error.userMessage}
          action={
            <div className="flex gap-2">
              <RetryButton onClick={player.reload} />
              <Link to="/" className="btn btn-ghost">
                Search again
              </Link>
            </div>
          }
        />
      </div>
    );
  }

  const stats = summariseGames(games.filtered);

  return (
    <div className="@container mx-auto w-full max-w-[1200px] space-y-6 pt-1">
      {/* The profile card and the widget row sit as one group, a tighter step apart. */}
      <div className="space-y-3">
        {player.loading || !player.player ? <PlayerProfileSkeleton /> : <PlayerProfile player={player.player} />}
      </div>

      <Panel
        flush
        title={
          <div className="min-w-0">
            <h2 className="panel-title">Games</h2>
            {games.filtered.length > 0 && (
              <p className="text-muted text-[13px] tabular-nums">
                {stats.wins}W · {stats.losses}L · {stats.draws}D · {stats.winRate}% win rate
              </p>
            )}
          </div>
        }
        actions={
          games.loadedMonths > 0 && (
            <span className="text-muted hidden text-right text-[13px] sm:block">
              {games.loadedMonths} of {games.totalMonths} months
              {games.oldestLoaded && ` · back to ${formatMonth(games.oldestLoaded.year, games.oldestLoaded.month)}`}
            </span>
          )
        }
      >
        <div className="border-b px-4 py-3">
          <GameFilters
            filters={games.filters}
            onChange={games.setFilters}
            resultCount={games.filtered.length}
            totalCount={games.games.length}
          />
        </div>

        {games.loading && <GameListSkeleton />}

        {!games.loading && games.error && (
          <ErrorState
            title="Could not load this player’s games"
            description={games.error.userMessage}
            action={<RetryButton onClick={games.reload} />}
          />
        )}

        {!games.loading && !games.error && games.filtered.length === 0 && (
          <EmptyState
            title={
              games.games.length === 0
                ? 'No games in this player’s public archive'
                : 'No games match these filters'
            }
            description={
              games.games.length === 0
                ? 'Chess.com only publishes finished games. New accounts, or accounts that have only played unrated games, can come back empty.'
                : 'Try widening the date range or clearing the search box.'
            }
            action={
              hasActiveFilters(games.filters) ? (
                <button type="button" className="btn btn-subtle" onClick={() => games.setFilters(games.filters)}>
                  Adjust filters above
                </button>
              ) : games.hasMore ? (
                <button type="button" className="btn btn-subtle" onClick={games.loadMore}>
                  Load older months
                </button>
              ) : undefined
            }
          />
        )}

        {!games.loading && games.page.length > 0 && <GameList games={games.page} viewer={username} />}

        {games.loadingMore && (
          <div className="flex items-center gap-2 border-t px-4 py-3">
            <Spinner size={14} className="text-muted" />
            <span className="text-muted text-[13px]">Loading older games…</span>
            <ProgressBar
              value={games.totalMonths > 0 ? (games.loadedMonths / games.totalMonths) * 100 : 0}
              className="ml-2 max-w-32"
            />
          </div>
        )}

        {!games.loading && games.filtered.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-2 border-t px-4 py-2.5">
            <span className="text-muted text-[13px] tabular-nums">
              Page {games.pageIndex + 1} of {games.pageCount}
            </span>

            <div className="flex items-center gap-1">
              <button
                type="button"
                className="btn btn-ghost h-8 gap-0.5 pr-3 pl-2 text-[14px]"
                onClick={() => games.setPageIndex(games.pageIndex - 1)}
                disabled={games.pageIndex === 0}
              >
                <ChevronLeft size={16} strokeWidth={2.2} />
                Previous
              </button>
              <button
                type="button"
                className="btn btn-ghost h-8 gap-0.5 pr-2 pl-3 text-[14px]"
                onClick={() => games.setPageIndex(games.pageIndex + 1)}
                disabled={games.pageIndex >= games.pageCount - 1}
              >
                Next
                <ChevronRight size={16} strokeWidth={2.2} />
              </button>
              {games.hasMore && (
                <button
                  type="button"
                  className="btn btn-subtle h-8 px-3 text-[13px]"
                  onClick={games.loadMore}
                  disabled={games.loadingMore}
                >
                  Load older months
                </button>
              )}
            </div>
          </div>
        )}
      </Panel>
    </div>
  );
}
