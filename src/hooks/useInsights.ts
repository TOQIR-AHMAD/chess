import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ClassificationThresholds, EngineConfig, GameReview } from '@/types/analysis';
import type { TimeClass } from '@/types/chesscom';
import type { GameSummary, ParsedGame } from '@/types/game';
import { fetchArchives } from '@/services/chessComApi';
import { loadArchive } from '@/services/gameService';
import { AnalysisCancelled, analyseGame, analysisKey, cacheReview, getCachedReview } from '@/services/gameAnalysis';
import { archiveOverlaps, buildInsights, cutoffFor, isInsightCandidate, type InsightReport } from '@/services/insights';
import { cancelEngineWork } from '@/services/stockfish';
import { toApiError } from '@/services/http';
import { tryParsePgn } from '@/services/pgnParser';
import { formatMonth } from '@/utils/format';

/**
 * Runs the insights pass: find a player's games in a time window, review each
 * one with Stockfish, and aggregate the reviews into a report.
 *
 * Games are reviewed one at a time — `analyseGame` already spreads a single game
 * across the whole engine pool, so running two at once would only split the same
 * workers between them. The report is rebuilt as each game lands, so it fills in
 * while the rest are still queued.
 *
 * Every review is cached under the same key the analysis page uses, so a game
 * reviewed here opens instantly there (at the same depth), a game already
 * reviewed there at full depth is reused here, and re-running a query only
 * searches the games that are new.
 */

export interface InsightQuery {
  username: string;
  /** Look-back window, in days. */
  days: number;
  timeClass: TimeClass | 'all';
  maxGames: number;
  /** Engine depth for the per-game reviews. */
  depth: number;
}

export type InsightGameStatus = 'queued' | 'analysing' | 'done' | 'failed';

export interface InsightGameEntry {
  summary: GameSummary;
  parsed: ParsedGame | null;
  status: InsightGameStatus;
  /** Progress of this game's review, 0-100. */
  percent: number;
  review: GameReview | null;
  fromCache: boolean;
  error: string | null;
}

export type InsightRunPhase = 'idle' | 'collecting' | 'analysing' | 'done' | 'cancelled' | 'error';

export interface InsightsState {
  query: InsightQuery | null;
  phase: InsightRunPhase;
  message: string;
  games: InsightGameEntry[];
  /** Games with a finished review. */
  completed: number;
  error: string | null;
  report: InsightReport | null;
  running: boolean;
  run: (query: InsightQuery) => void;
  cancel: () => void;
}

/** The review settings for an insights pass: the user's engine, at the chosen depth. */
export function insightEngine(base: EngineConfig, depth: number): EngineConfig {
  // No quick pass: its preliminary review is never cached, and here nothing is
  // shown until a game is finished anyway.
  return { ...base, depth, quickPass: false };
}

/**
 * A cached review for this game, if one exists that is at least as deep as the
 * one being asked for — preferring the analysis page's own full-depth review.
 */
function cachedReviewFor(
  pgn: string,
  parsed: ParsedGame,
  settings: EngineConfig,
  engine: EngineConfig,
  thresholds: ClassificationThresholds,
): GameReview | null {
  const keys = [analysisKey(pgn, engine, thresholds)];
  if (settings.depth >= engine.depth) keys.unshift(analysisKey(pgn, settings, thresholds));
  for (const key of keys) {
    const cached = getCachedReview(key);
    if (cached && cached.moves.length === parsed.moves.length) return cached;
  }
  return null;
}

/** The player's most recent games that match the query, newest first. */
async function collectGames(
  query: InsightQuery,
  signal: AbortSignal,
  onProgress: (message: string) => void,
): Promise<GameSummary[]> {
  const cutoff = cutoffFor(query.days);
  const refs = await fetchArchives(query.username, signal);
  const months = refs.filter((ref) => archiveOverlaps(ref, cutoff));
  const picked = new Map<string, GameSummary>();

  // Newest month first, one request at a time (the API answers bursts with 429),
  // stopping as soon as enough games are in hand.
  for (const ref of months) {
    if (signal.aborted) break;
    onProgress(`Looking through ${formatMonth(ref.year, ref.month)}…`);
    const monthGames = await loadArchive(query.username, ref, signal);
    for (const game of monthGames) {
      if (isInsightCandidate(game, { cutoff, timeClass: query.timeClass })) picked.set(game.id, game);
    }
    if (picked.size >= query.maxGames) break;
  }

  return [...picked.values()]
    .sort((a, b) => (b.endTime ?? 0) - (a.endTime ?? 0))
    .slice(0, query.maxGames);
}

export function useInsights(settings: EngineConfig, thresholds: ClassificationThresholds): InsightsState {
  const [query, setQuery] = useState<InsightQuery | null>(null);
  const [phase, setPhase] = useState<InsightRunPhase>('idle');
  const [message, setMessage] = useState('');
  const [games, setGames] = useState<InsightGameEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const runningRef = useRef(false);

  const patch = useCallback((index: number, update: Partial<InsightGameEntry>) => {
    setGames((prev) => prev.map((entry, i) => (i === index ? { ...entry, ...update } : entry)));
  }, []);

  const run = useCallback(
    (next: InsightQuery) => {
      abortRef.current?.abort();
      if (runningRef.current) cancelEngineWork();
      const abort = new AbortController();
      abortRef.current = abort;
      runningRef.current = true;

      setQuery(next);
      setPhase('collecting');
      setMessage('Finding games…');
      setGames([]);
      setError(null);

      const engine = insightEngine(settings, next.depth);

      (async () => {
        try {
          const summaries = await collectGames(next, abort.signal, (text) => {
            if (!abort.signal.aborted) setMessage(text);
          });
          if (abort.signal.aborted) return;

          const entries: InsightGameEntry[] = summaries.map((summary) => {
            const parsed = tryParsePgn(summary.pgn);
            return {
              summary,
              parsed,
              status: parsed ? 'queued' : 'failed',
              percent: 0,
              review: null,
              fromCache: false,
              error: parsed ? null : 'This game’s PGN could not be read.',
            };
          });
          setGames(entries);

          if (entries.length === 0) {
            setPhase('done');
            setMessage('');
            return;
          }

          setPhase('analysing');
          for (let index = 0; index < entries.length; index += 1) {
            if (abort.signal.aborted) return;
            const { summary, parsed } = entries[index];
            if (!parsed || !summary.pgn) continue;

            setMessage(`Reviewing game ${index + 1} of ${entries.length}…`);
            const cached = cachedReviewFor(summary.pgn, parsed, settings, engine, thresholds);
            if (cached) {
              patch(index, { status: 'done', review: cached, fromCache: true, percent: 100 });
              continue;
            }

            patch(index, { status: 'analysing', percent: 0 });
            try {
              const review = await analyseGame({
                parsed,
                engine,
                thresholds,
                signal: abort.signal,
                onProgress: (progress) => {
                  if (!abort.signal.aborted && progress.phase === 'analyzing') {
                    patch(index, { percent: progress.percent });
                  }
                },
              });
              if (abort.signal.aborted) return;
              const key = analysisKey(summary.pgn, engine, thresholds);
              const stored: GameReview = { ...review, key };
              cacheReview(key, stored);
              patch(index, { status: 'done', review: stored, percent: 100 });
            } catch (cause) {
              if (abort.signal.aborted || cause instanceof AnalysisCancelled) return;
              // One unreadable game should not sink the whole report.
              patch(index, {
                status: 'failed',
                error: cause instanceof Error ? cause.message : 'Analysis failed.',
              });
            }
          }

          if (abort.signal.aborted) return;
          setPhase('done');
          setMessage('');
        } catch (cause) {
          if (abort.signal.aborted) return;
          const apiError = toApiError(cause);
          if (apiError.kind === 'aborted') return;
          setError(apiError.userMessage);
          setPhase('error');
        } finally {
          if (abortRef.current === abort) runningRef.current = false;
        }
      })();
    },
    [patch, settings, thresholds],
  );

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    if (runningRef.current) cancelEngineWork();
    runningRef.current = false;
    setPhase('cancelled');
    setMessage('');
    setGames((prev) =>
      prev.map((entry) => (entry.status === 'analysing' ? { ...entry, status: 'queued', percent: 0 } : entry)),
    );
  }, []);

  // Never leave engine work running behind a closed page.
  useEffect(
    () => () => {
      abortRef.current?.abort();
      if (runningRef.current) cancelEngineWork();
    },
    [],
  );

  const finished = games.filter((entry) => entry.status === 'done' && entry.review && entry.parsed);
  // Changes only when a game finishes, not on every progress tick of the one running.
  const finishedKey = finished.map((entry) => entry.summary.id).join(',');

  const report = useMemo(
    () =>
      finished.length > 0
        ? buildInsights(
            finished.map((entry) => ({
              summary: entry.summary,
              parsed: entry.parsed as ParsedGame,
              review: entry.review as GameReview,
            })),
          )
        : null,
    // `finished` is rebuilt every render; its ids are what actually matter.
    [finishedKey],
  );

  return {
    query,
    phase,
    message,
    games,
    completed: finished.length,
    error,
    report,
    running: phase === 'collecting' || phase === 'analysing',
    run,
    cancel,
  };
}
