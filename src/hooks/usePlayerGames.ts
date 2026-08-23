import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ArchiveRef } from '@/types/chesscom';
import type { GameSummary } from '@/types/game';
import type { GameFilterState } from '@/types/player';
import { fetchArchives } from '@/services/chessComApi';
import { EMPTY_FILTERS, filterGames, loadArchive } from '@/services/gameService';
import { ApiError, toApiError } from '@/services/http';

/**
 * Incremental game loading.
 *
 * Chess.com only exposes games one month at a time, and an active player can have
 * hundreds of months. Rather than downloading everything, this hook walks the
 * archive list newest-first and pulls one month at a time — serially, because the
 * API answers parallel bursts with 429 — until the current page is filled.
 */

const PAGE_SIZE = 20;
/** Stop auto-walking backwards through empty months after this many in a row. */
const MAX_AUTO_MONTHS = 6;

export interface PlayerGamesState {
  games: GameSummary[];
  filtered: GameSummary[];
  page: GameSummary[];
  pageIndex: number;
  pageCount: number;
  pageSize: number;
  filters: GameFilterState;
  setFilters: (filters: GameFilterState | ((prev: GameFilterState) => GameFilterState)) => void;
  setPageIndex: (index: number) => void;
  loading: boolean;
  loadingMore: boolean;
  error: ApiError | null;
  hasMore: boolean;
  loadMore: () => void;
  reload: () => void;
  loadedMonths: number;
  totalMonths: number;
  /** Label of the oldest month pulled in so far. */
  oldestLoaded: ArchiveRef | null;
}

export function usePlayerGames(username: string | undefined): PlayerGamesState {
  const [archives, setArchives] = useState<ArchiveRef[]>([]);
  const [games, setGames] = useState<GameSummary[]>([]);
  const [cursor, setCursor] = useState(0);
  const [loading, setLoading] = useState(Boolean(username));
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [filters, setFilters] = useState<GameFilterState>(EMPTY_FILTERS);
  const [pageIndex, setPageIndex] = useState(0);
  const [nonce, setNonce] = useState(0);

  const abortRef = useRef<AbortController | null>(null);
  const busyRef = useRef(false);

  // Reset everything when the player changes.
  useEffect(() => {
    setArchives([]);
    setGames([]);
    setCursor(0);
    setPageIndex(0);
    setFilters(EMPTY_FILTERS);
    setError(null);
  }, [username]);

  /** Pull `count` more months, oldest-direction, one request at a time. */
  const pullMonths = useCallback(
    async (refs: ArchiveRef[], from: number, count: number, signal: AbortSignal) => {
      let index = from;
      let pulled = 0;
      const collected: GameSummary[] = [];

      while (index < refs.length && pulled < count) {
        if (signal.aborted) return { collected, index };
        const monthGames = await loadArchive(username as string, refs[index], signal);
        collected.push(...monthGames);
        index += 1;
        pulled += 1;
        // A month with games is enough for one step; empty months keep walking.
        if (monthGames.length > 0) break;
        if (pulled >= MAX_AUTO_MONTHS) break;
      }

      return { collected, index };
    },
    [username],
  );

  // Initial load: archive list + the most recent month(s).
  useEffect(() => {
    if (!username) {
      setLoading(false);
      return;
    }

    abortRef.current?.abort();
    const abort = new AbortController();
    abortRef.current = abort;

    setLoading(true);
    setError(null);

    (async () => {
      try {
        const refs = await fetchArchives(username, abort.signal);
        if (abort.signal.aborted) return;
        setArchives(refs);

        if (refs.length === 0) {
          setGames([]);
          setCursor(0);
          return;
        }

        const { collected, index } = await pullMonths(refs, 0, 2, abort.signal);
        if (abort.signal.aborted) return;
        setGames(collected);
        setCursor(index);
      } catch (cause) {
        if (abort.signal.aborted) return;
        const apiError = toApiError(cause);
        if (apiError.kind === 'aborted') return;
        setError(apiError);
      } finally {
        if (!abort.signal.aborted) setLoading(false);
      }
    })();

    return () => abort.abort();
  }, [username, nonce, pullMonths]);

  const hasMore = cursor < archives.length;

  const loadMore = useCallback(() => {
    if (!username || busyRef.current || cursor >= archives.length) return;
    const abort = abortRef.current ?? new AbortController();
    busyRef.current = true;
    setLoadingMore(true);

    pullMonths(archives, cursor, MAX_AUTO_MONTHS, abort.signal)
      .then(({ collected, index }) => {
        if (abort.signal.aborted) return;
        setGames((prev) => {
          // De-duplicate: a game can appear in two months around a month boundary.
          const seen = new Set(prev.map((game) => game.id));
          return [...prev, ...collected.filter((game) => !seen.has(game.id))];
        });
        setCursor(index);
      })
      .catch((cause) => {
        if (abort.signal.aborted) return;
        const apiError = toApiError(cause);
        if (apiError.kind !== 'aborted') setError(apiError);
      })
      .finally(() => {
        busyRef.current = false;
        if (!abort.signal.aborted) setLoadingMore(false);
      });
  }, [archives, cursor, pullMonths, username]);

  const filtered = useMemo(() => filterGames(games, filters), [games, filters]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePageIndex = Math.min(pageIndex, pageCount - 1);

  const page = useMemo(
    () => filtered.slice(safePageIndex * PAGE_SIZE, safePageIndex * PAGE_SIZE + PAGE_SIZE),
    [filtered, safePageIndex],
  );

  // Filtering can leave the user past the end of the list.
  useEffect(() => {
    if (pageIndex > pageCount - 1) setPageIndex(pageCount - 1);
  }, [pageCount, pageIndex]);

  // When a filter leaves too few results, quietly reach further back in time.
  useEffect(() => {
    if (loading || loadingMore || !hasMore) return;
    if (filtered.length < PAGE_SIZE && games.length > 0) loadMore();
  }, [filtered.length, games.length, hasMore, loading, loadingMore, loadMore]);

  const reload = useCallback(() => setNonce((value) => value + 1), []);

  const updateFilters = useCallback(
    (next: GameFilterState | ((prev: GameFilterState) => GameFilterState)) => {
      setFilters((prev) => (typeof next === 'function' ? next(prev) : next));
      setPageIndex(0);
    },
    [],
  );

  return {
    games,
    filtered,
    page,
    pageIndex: safePageIndex,
    pageCount,
    pageSize: PAGE_SIZE,
    filters,
    setFilters: updateFilters,
    setPageIndex,
    loading,
    loadingMore,
    error,
    hasMore,
    loadMore,
    reload,
    loadedMonths: cursor,
    totalMonths: archives.length,
    oldestLoaded: cursor > 0 ? (archives[cursor - 1] ?? null) : null,
  };
}
