import { useCallback, useEffect, useRef, useState } from 'react';
import type { PlayerSummary } from '@/types/player';
import { ApiError, toApiError } from '@/services/http';
import { loadPlayer } from '@/services/playerService';

export interface PlayerState {
  player: PlayerSummary | null;
  loading: boolean;
  error: ApiError | null;
  reload: () => void;
}

/** Fetch a Chess.com player profile + stats, cancelling in-flight work on change. */
export function usePlayer(username: string | undefined): PlayerState {
  const [player, setPlayer] = useState<PlayerSummary | null>(null);
  const [loading, setLoading] = useState(Boolean(username));
  const [error, setError] = useState<ApiError | null>(null);
  const [nonce, setNonce] = useState(0);
  const controller = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!username) {
      setPlayer(null);
      setLoading(false);
      setError(null);
      return;
    }

    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;

    setLoading(true);
    setError(null);

    loadPlayer(username, abort.signal)
      .then((result) => {
        if (abort.signal.aborted) return;
        setPlayer(result);
        setError(null);
      })
      .catch((cause) => {
        if (abort.signal.aborted) return;
        const apiError = toApiError(cause);
        if (apiError.kind === 'aborted') return;
        setPlayer(null);
        setError(apiError);
      })
      .finally(() => {
        if (!abort.signal.aborted) setLoading(false);
      });

    return () => abort.abort();
  }, [username, nonce]);

  const reload = useCallback(() => setNonce((value) => value + 1), []);

  return { player, loading, error, reload };
}
