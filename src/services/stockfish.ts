import type { EngineConfig, SearchResult } from '@/types/analysis';
import { Priority, UciEngine, maxThreads, supportsThreads } from '@/workers/stockfishWorker';

/**
 * Process-wide engine singleton.
 *
 * Booting Stockfish means downloading and instantiating a ~7 MB WASM module, so
 * exactly one instance is shared by the whole app. Interactive searches preempt
 * the background full-game pass inside `UciEngine`, which is why a single engine
 * is enough — and keeps peak memory to one transposition table.
 */

export interface EngineStatus {
  state: 'idle' | 'loading' | 'ready' | 'error';
  name: string;
  error: string | null;
  /** 0-100 while the WASM binary downloads, null once running. */
  downloadPercent: number | null;
  multiThreaded: boolean;
  maxThreads: number;
}

export const DEFAULT_ENGINE_CONFIG: EngineConfig = {
  // Depth 18 is the shallowest setting whose evaluations line up with the review
  // sites players compare against; below it the engine's "best move" starts to
  // disagree with theirs often enough to change the labels. It is not cheap — a
  // full pass runs into minutes, and positions inside a forced-mate sequence are
  // the slowest of all — so the setting is prominent in the panel for anyone who
  // would rather have the old depth-14 speed.
  depth: 18,
  liveDepth: 20,
  // Use the cores the browser actually allows. `maxThreads()` returns 1 unless the
  // page is cross-origin isolated, so this is safe everywhere.
  threads: maxThreads(),
  hash: 64,
  // Depth alone is not a usable limit at 18. Most positions reach it in well under
  // a second, but a position inside a forced-mate sequence — a king being walked
  // down, where every line transposes — can search for minutes without the depth
  // counter moving, and a single such position stalls the whole pass. The cap
  // bounds the worst case; ordinary positions never reach it, so it costs nothing
  // where it is not needed. 0 restores pure depth-only search.
  moveTimeMs: 2500,
  multiPv: 2,
};

export const ENGINE_LIMITS = {
  depth: { min: 8, max: 24 },
  liveDepth: { min: 10, max: 30 },
  hash: { min: 16, max: 256 },
  moveTimeMs: { min: 0, max: 5000 },
  multiPv: { min: 1, max: 4 },
};

let engine: UciEngine | null = null;
let status: EngineStatus = {
  state: 'idle',
  name: 'Stockfish',
  error: null,
  downloadPercent: null,
  multiThreaded: supportsThreads(),
  maxThreads: maxThreads(),
};

const listeners = new Set<(status: EngineStatus) => void>();

function publish(patch: Partial<EngineStatus>): void {
  status = { ...status, ...patch };
  for (const listener of listeners) listener(status);
}

export function getEngineStatus(): EngineStatus {
  return status;
}

export function subscribeToEngine(listener: (status: EngineStatus) => void): () => void {
  listeners.add(listener);
  listener(status);
  return () => listeners.delete(listener);
}

function instance(): UciEngine {
  if (!engine) {
    engine = new UciEngine((percent) => {
      publish({ downloadPercent: Math.round(percent) });
    });
  }
  return engine;
}

/** Boot the engine (idempotent) and apply the given configuration. */
export async function ensureEngine(config: EngineConfig = DEFAULT_ENGINE_CONFIG): Promise<UciEngine> {
  const current = instance();
  if (status.state !== 'ready') publish({ state: 'loading', error: null });

  try {
    await current.init();
    await current.setOptions({
      threads: supportsThreads() ? config.threads : 1,
      hash: config.hash,
      multiPv: config.multiPv,
    });
    publish({ state: 'ready', name: current.name, error: null, downloadPercent: null });
    return current;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'The chess engine failed to start.';
    publish({ state: 'error', error: message, downloadPercent: null });
    throw error;
  }
}

export interface AnalysePositionOptions {
  depth: number;
  multiPv?: number;
  moveTimeMs?: number;
  priority?: number;
  signal?: AbortSignal;
  onUpdate?: (partial: SearchResult) => void;
}

/** Search a single position. Used for both the batch pass and live analysis. */
export async function analysePosition(
  fen: string,
  options: AnalysePositionOptions,
): Promise<SearchResult> {
  const current = await ensureEngine({
    ...DEFAULT_ENGINE_CONFIG,
    depth: options.depth,
    multiPv: options.multiPv ?? DEFAULT_ENGINE_CONFIG.multiPv,
  });

  return current.analyse({
    fen,
    depth: options.depth,
    multiPv: options.multiPv ?? 1,
    moveTimeMs: options.moveTimeMs,
    priority: options.priority ?? Priority.Batch,
    signal: options.signal,
    onUpdate: options.onUpdate,
  });
}

/** Stop the running search but keep the engine warm. */
export function stopEngine(): void {
  engine?.stop();
}

/** Drop every queued and running search — used when the user changes games. */
export function cancelEngineWork(): void {
  engine?.cancelAll();
}

/** Reset the engine's search state before analysing a different game. */
export async function resetEngineForNewGame(): Promise<void> {
  if (!engine) return;
  await engine.newGame();
}

/** Tear the worker down completely. */
export function disposeEngine(): void {
  engine?.dispose();
  engine = null;
  publish({ state: 'idle', error: null, downloadPercent: null });
}

export { Priority };

/** Clamp a user-supplied engine configuration into supported bounds. */
export function sanitiseEngineConfig(config: Partial<EngineConfig>): EngineConfig {
  const clamp = (value: number, min: number, max: number, fallback: number) =>
    Number.isFinite(value) ? Math.max(min, Math.min(max, Math.round(value))) : fallback;

  return {
    depth: clamp(config.depth ?? DEFAULT_ENGINE_CONFIG.depth, ENGINE_LIMITS.depth.min, ENGINE_LIMITS.depth.max, DEFAULT_ENGINE_CONFIG.depth),
    liveDepth: clamp(
      config.liveDepth ?? DEFAULT_ENGINE_CONFIG.liveDepth,
      ENGINE_LIMITS.liveDepth.min,
      ENGINE_LIMITS.liveDepth.max,
      DEFAULT_ENGINE_CONFIG.liveDepth,
    ),
    threads: supportsThreads()
      ? clamp(config.threads ?? DEFAULT_ENGINE_CONFIG.threads, 1, maxThreads(), 1)
      : 1,
    hash: clamp(config.hash ?? DEFAULT_ENGINE_CONFIG.hash, ENGINE_LIMITS.hash.min, ENGINE_LIMITS.hash.max, DEFAULT_ENGINE_CONFIG.hash),
    moveTimeMs: clamp(
      config.moveTimeMs ?? DEFAULT_ENGINE_CONFIG.moveTimeMs,
      ENGINE_LIMITS.moveTimeMs.min,
      ENGINE_LIMITS.moveTimeMs.max,
      DEFAULT_ENGINE_CONFIG.moveTimeMs,
    ),
    multiPv: clamp(config.multiPv ?? DEFAULT_ENGINE_CONFIG.multiPv, ENGINE_LIMITS.multiPv.min, ENGINE_LIMITS.multiPv.max, DEFAULT_ENGINE_CONFIG.multiPv),
  };
}
