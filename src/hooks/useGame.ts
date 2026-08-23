import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ArchiveRef } from '@/types/chesscom';
import type { GameSummary, ParsedGame } from '@/types/game';
import { fetchArchives } from '@/services/chessComApi';
import { loadArchive } from '@/services/gameService';
import { ApiError, toApiError } from '@/services/http';
import { PgnError, parsePgn } from '@/services/pgnParser';

/**
 * Loads one game for the analysis page.
 *
 * Deep links have to work on a cold reload, which means finding a game id inside a
 * player's monthly archives. When the user arrives from the game list the month is
 * carried in the URL (`?m=YYYY-MM`) so exactly one request is needed; otherwise the
 * archives are walked newest-first, serially, up to `MAX_SCAN_MONTHS`.
 */

const MAX_SCAN_MONTHS = 36;

export interface GameState {
  game: GameSummary | null;
  parsed: ParsedGame | null;
  /** Every game from the same month, for previous/next navigation. */
  siblings: GameSummary[];
  loading: boolean;
  error: ApiError | PgnError | null;
  reload: () => void;
  scanned: number;
}

function parseMonthParam(value: string | null): { year: number; month: number } | null {
  if (!value) return null;
  const match = /^(\d{4})-(\d{1,2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12) return null;
  return { year, month };
}

export function useGame(
  username: string | undefined,
  gameId: string | undefined,
  monthParam: string | null,
): GameState {
  const [game, setGame] = useState<GameSummary | null>(null);
  const [siblings, setSiblings] = useState<GameSummary[]>([]);
  const [loading, setLoading] = useState(Boolean(username && gameId));
  const [error, setError] = useState<ApiError | PgnError | null>(null);
  const [scanned, setScanned] = useState(0);
  const [nonce, setNonce] = useState(0);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!username || !gameId) {
      setLoading(false);
      return;
    }

    abortRef.current?.abort();
    const abort = new AbortController();
    abortRef.current = abort;

    setLoading(true);
    setError(null);
    setScanned(0);

    (async () => {
      try {
        const hinted = parseMonthParam(monthParam);
        const refs = await fetchArchives(username, abort.signal);
        if (abort.signal.aborted) return;

        // Try the hinted month first, then walk backwards from the newest.
        const ordered: ArchiveRef[] = [];
        if (hinted) {
          const match = refs.find((ref) => ref.year === hinted.year && ref.month === hinted.month);
          if (match) ordered.push(match);
        }
        for (const ref of refs) {
          if (!ordered.includes(ref)) ordered.push(ref);
        }

        for (let i = 0; i < Math.min(ordered.length, MAX_SCAN_MONTHS); i += 1) {
          if (abort.signal.aborted) return;
          setScanned(i + 1);
          const monthGames = await loadArchive(username, ordered[i], abort.signal);
          const found = monthGames.find((entry) => entry.id === gameId);
          if (found) {
            setGame(found);
            setSiblings(monthGames);
            return;
          }
        }

        setGame(null);
        setSiblings([]);
        setError(new ApiError('not-found', 'That game was not found in this player’s archives.'));
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
  }, [username, gameId, monthParam, nonce]);

  const parsed = useMemo(() => {
    if (!game) return null;
    try {
      return parsePgn(game.pgn);
    } catch (cause) {
      return cause instanceof PgnError ? null : null;
    }
  }, [game]);

  // Surface PGN problems as an error state rather than an empty board.
  const parseError = useMemo(() => {
    if (!game || parsed) return null;
    try {
      parsePgn(game.pgn);
      return null;
    } catch (cause) {
      return cause instanceof PgnError ? cause : new PgnError('Unreadable PGN');
    }
  }, [game, parsed]);

  const reload = useCallback(() => setNonce((value) => value + 1), []);

  return {
    game,
    parsed,
    siblings,
    loading,
    error: error ?? parseError,
    reload,
    scanned,
  };
}
