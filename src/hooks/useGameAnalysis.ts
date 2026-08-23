import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AnalysisProgress, ClassificationThresholds, EngineConfig, GameReview, Score } from '@/types/analysis';
import type { ParsedGame } from '@/types/game';
import {
  AnalysisCancelled,
  analyseGame,
  analysisKey,
  cacheReview,
  getCachedReview,
} from '@/services/gameAnalysis';
import { cancelEngineWork } from '@/services/stockfish';

/**
 * Runs (or restores) the full-game review.
 *
 * A completed review is cached under a key derived from the PGN *and* the engine
 * settings, so revisiting a game is instant while changing the depth correctly
 * triggers a fresh pass. Partial evaluations are published as they arrive so the
 * graph and evaluation bar fill in while the engine works.
 */

const IDLE_PROGRESS: AnalysisProgress = {
  phase: 'idle',
  completed: 0,
  total: 0,
  percent: 0,
  message: '',
  enginePercent: null,
  error: null,
};

export interface GameAnalysisState {
  review: GameReview | null;
  /** Evaluations available so far — complete once `review` exists. */
  evaluations: Array<Score | null>;
  progress: AnalysisProgress;
  running: boolean;
  fromCache: boolean;
  start: () => void;
  cancel: () => void;
  reset: () => void;
}

export function useGameAnalysis(
  parsed: ParsedGame | null,
  pgn: string | null,
  engine: EngineConfig,
  thresholds: ClassificationThresholds,
  autoStart: boolean,
): GameAnalysisState {
  const [review, setReview] = useState<GameReview | null>(null);
  const [evaluations, setEvaluations] = useState<Array<Score | null>>([]);
  const [progress, setProgress] = useState<AnalysisProgress>(IDLE_PROGRESS);
  const [running, setRunning] = useState(false);
  const [fromCache, setFromCache] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const startedFor = useRef<string | null>(null);

  const key = useMemo(
    () => (pgn ? analysisKey(pgn, engine, thresholds) : null),
    [pgn, engine, thresholds],
  );

  // Restore a cached review whenever the game or engine settings change.
  useEffect(() => {
    abortRef.current?.abort();
    setRunning(false);
    setReview(null);
    setFromCache(false);
    setProgress(IDLE_PROGRESS);
    setEvaluations(parsed ? new Array(parsed.positions.length).fill(null) : []);
    startedFor.current = null;

    if (!key || !parsed) return;

    const cached = getCachedReview(key);
    if (cached && cached.moves.length === parsed.moves.length) {
      setReview(cached);
      setEvaluations(cached.evaluations);
      setFromCache(true);
      setProgress({
        phase: 'done',
        completed: parsed.positions.length,
        total: parsed.positions.length,
        percent: 100,
        message: 'Loaded from cache',
        enginePercent: null,
        error: null,
      });
      startedFor.current = key;
    }
  }, [key, parsed]);

  const start = useCallback(() => {
    if (!parsed || !key) return;
    if (startedFor.current === key && (review || running)) return;

    abortRef.current?.abort();
    const abort = new AbortController();
    abortRef.current = abort;
    startedFor.current = key;

    setRunning(true);
    setFromCache(false);
    setReview(null);
    setProgress({ ...IDLE_PROGRESS, phase: 'loading-engine', total: parsed.positions.length });

    analyseGame({
      parsed,
      engine,
      thresholds,
      signal: abort.signal,
      onProgress: (next) => {
        if (!abort.signal.aborted) setProgress(next);
      },
      onPartial: (partial) => {
        if (!abort.signal.aborted) setEvaluations(partial);
      },
    })
      .then((result) => {
        if (abort.signal.aborted) return;
        const stored: GameReview = { ...result, key };
        cacheReview(key, stored);
        setReview(stored);
        setEvaluations(stored.evaluations);
      })
      .catch((error) => {
        if (abort.signal.aborted || error instanceof AnalysisCancelled) {
          setProgress((prev) => ({ ...prev, phase: 'cancelled', message: 'Analysis cancelled' }));
          startedFor.current = null;
          return;
        }
        const message = error instanceof Error ? error.message : 'Analysis failed.';
        setProgress((prev) => ({ ...prev, phase: 'error', error: message, message }));
        startedFor.current = null;
      })
      .finally(() => {
        if (!abort.signal.aborted) setRunning(false);
      });
  }, [parsed, key, engine, thresholds, review, running]);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    cancelEngineWork();
    setRunning(false);
    startedFor.current = null;
    setProgress((prev) => ({ ...prev, phase: 'cancelled', message: 'Analysis cancelled' }));
  }, []);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    startedFor.current = null;
    setReview(null);
    setEvaluations(parsed ? new Array(parsed.positions.length).fill(null) : []);
    setProgress(IDLE_PROGRESS);
  }, [parsed]);

  // Kick off automatically once a game is loaded, unless the user opted out.
  useEffect(() => {
    if (!autoStart || !parsed || !key) return;
    if (startedFor.current === key) return;
    start();
  }, [autoStart, parsed, key, start]);

  // Never leave engine work running behind a closed page.
  useEffect(
    () => () => {
      abortRef.current?.abort();
      cancelEngineWork();
    },
    [],
  );

  return { review, evaluations, progress, running, fromCache, start, cancel, reset };
}
