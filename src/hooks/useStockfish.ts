import { useCallback, useEffect, useRef, useState } from 'react';
import type { EngineConfig, PvLine, SearchResult } from '@/types/analysis';
import {
  Priority,
  analysePosition,
  getEngineStatus,
  subscribeToEngine,
  type EngineStatus,
} from '@/services/stockfish';
import { EngineAbortError } from '@/workers/stockfishWorker';
import { terminalState } from '@/utils/chess';

/**
 * Live engine analysis of whatever position the user is looking at.
 *
 * These searches run at `Priority.Interactive`, so they cut in front of the
 * background full-game pass. Results stream in as the search deepens, and moving
 * to another position cancels the previous search immediately.
 */

export interface LiveAnalysis {
  result: SearchResult | null;
  lines: PvLine[];
  depth: number;
  running: boolean;
  status: EngineStatus;
  error: string | null;
  /** Terminal positions are reported without asking the engine. */
  terminal: 'checkmate' | 'stalemate' | 'draw' | null;
}

export function useStockfish(fen: string | null, config: EngineConfig, enabled = true): LiveAnalysis {
  const [result, setResult] = useState<SearchResult | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<EngineStatus>(getEngineStatus);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => subscribeToEngine(setStatus), []);

  const terminal = fen ? terminalState(fen) : null;

  useEffect(() => {
    abortRef.current?.abort();
    setResult(null);
    setError(null);

    if (!fen || !enabled || terminal) {
      setRunning(false);
      return;
    }

    const abort = new AbortController();
    abortRef.current = abort;
    setRunning(true);

    analysePosition(fen, {
      depth: config.liveDepth,
      multiPv: Math.max(config.multiPv, 2),
      priority: Priority.Interactive,
      signal: abort.signal,
      onUpdate: (partial) => {
        if (!abort.signal.aborted) setResult(partial);
      },
    })
      .then((final) => {
        if (abort.signal.aborted) return;
        // A preempted search can come back empty; keep the last good partial.
        if (final.lines.length > 0) setResult(final);
      })
      .catch((cause) => {
        if (abort.signal.aborted || cause instanceof EngineAbortError) return;
        setError(cause instanceof Error ? cause.message : 'Engine analysis failed.');
      })
      .finally(() => {
        if (!abort.signal.aborted) setRunning(false);
      });

    return () => abort.abort();
  }, [fen, enabled, terminal, config.liveDepth, config.multiPv]);

  useEffect(() => () => abortRef.current?.abort(), []);

  return {
    result,
    lines: result?.lines ?? [],
    depth: result?.depth ?? 0,
    running,
    status,
    error,
    terminal,
  };
}

/** Boot the engine ahead of time so the first search is not spent downloading. */
export function useEngineStatus(): EngineStatus & { refresh: () => void } {
  const [status, setStatus] = useState<EngineStatus>(getEngineStatus);
  useEffect(() => subscribeToEngine(setStatus), []);
  const refresh = useCallback(() => setStatus(getEngineStatus()), []);
  return { ...status, refresh };
}
