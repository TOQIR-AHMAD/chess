import type { EngineConfig, SearchResult } from '@/types/analysis';
import { EnginePool } from '@/workers/enginePool';
import { Priority, maxThreads, parallelism, supportsThreads } from '@/workers/stockfishWorker';

/**
 * Process-wide engine singleton — a pool of single-threaded Stockfish workers
 * sharing one priority queue.
 *
 * A review is a batch of independent positions, so throughput comes from searching
 * several of them at once rather than from throwing threads at one of them; see
 * `EnginePool` for why that is the better trade. Interactive searches preempt the
 * background pass, so the position the user is looking at is still answered first.
 *
 * The whole app shares one pool: booting an engine means instantiating a ~7 MB WASM
 * module, and nothing is gained by holding two sets of them.
 */

export interface EngineStatus {
  state: 'idle' | 'loading' | 'ready' | 'error';
  name: string;
  error: string | null;
  /** 0-100 while the WASM binary downloads, null once running. */
  downloadPercent: number | null;
  multiThreaded: boolean;
  maxThreads: number;
  /** Engines running in parallel; 1 until the pool has booted. */
  poolSize: number;
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
  // How many positions are searched at once. Each engine in the pool is
  // single-threaded, so this needs no `SharedArrayBuffer` and applies everywhere —
  // unlike `maxThreads()`, which is 1 on any page that is not cross-origin isolated.
  threads: parallelism(),
  // A *total* budget, divided across the pool (see `EnginePool.setOptions`).
  //
  // Deliberately not raised to give each engine what a single engine used to have.
  // Measured: a three-wide pool at 192 MB total is dramatically slower than at 64,
  // because three WASM heaps of 64 MB apiece cost more in allocation and cache
  // pressure than a bigger table wins back on searches this short.
  hash: 64,
  // Depth-only, deliberately. A time cap would make the review depend on the
  // machine running it: a phone would hit the cap several plies shallower than a
  // desktop and classify the same game differently, which is indefensible for a
  // shared link. What the cap was really working around — positions inside a
  // forced-mate sequence searching for minutes — is now handled at the source, by
  // stopping the engine once it has proved a mate (`stockfishWorker.ts`).
  moveTimeMs: 0,
  multiPv: 2,
  // The depth above buys agreement with Chess.com at the cost of minutes. Almost
  // nobody wants to watch an empty rail for that long before seeing anything, so
  // a time-budgeted sweep goes first and the full pass refines what it produced.
  quickPass: true,
};

/**
 * Wall-clock target for the quick first pass, measured to a **review on screen**
 * rather than to the last search finishing — the searching is only most of the
 * work, and the part the user is waiting for is the whole of it.
 *
 * It is a *budget*, not a depth: the per-position time cap is derived from it, the
 * game's length and the pool width, so the promise holds on a phone and on a
 * workstation, for a 20-move miniature and a 120-move endgame grind. That a slow
 * machine reaches a shallower depth is exactly the trade being made — and it is
 * only defensible because this pass is provisional and gets overwritten.
 */
export const QUICK_PASS_BUDGET_MS = 5_000;

/**
 * Depth ceiling for the quick pass. The time cap is what normally binds; this
 * only stops cheap opening positions from spending their whole allowance.
 */
export const QUICK_PASS_MAX_DEPTH = 14;

export const ENGINE_LIMITS = {
  depth: { min: 8, max: 24 },
  liveDepth: { min: 10, max: 30 },
  hash: { min: 16, max: 256 },
  moveTimeMs: { min: 0, max: 5000 },
  multiPv: { min: 1, max: 4 },
};

let engine: EnginePool | null = null;
let status: EngineStatus = {
  state: 'idle',
  name: 'Stockfish',
  error: null,
  downloadPercent: null,
  multiThreaded: supportsThreads(),
  maxThreads: maxThreads(),
  poolSize: parallelism(),
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

/**
 * Pool width is a construction-time property, so a change to the setting has to
 * rebuild the pool. Tracked here to detect that.
 */
let poolSize = 0;

function instance(size: number): EnginePool {
  if (engine && poolSize !== size) {
    engine.dispose();
    engine = null;
  }
  if (!engine) {
    poolSize = size;
    engine = new EnginePool({
      size,
      onDownloadProgress: (percent) => publish({ downloadPercent: Math.round(percent) }),
    });
  }
  return engine;
}

/** Boot the engine pool (idempotent) and apply the given configuration. */
export async function ensureEngine(config: EngineConfig = DEFAULT_ENGINE_CONFIG): Promise<EnginePool> {
  const current = instance(Math.max(1, Math.min(parallelism(), config.threads)));
  if (status.state !== 'ready') publish({ state: 'loading', error: null });

  try {
    await current.init();
    await current.setOptions({ hash: config.hash, multiPv: config.multiPv });
    publish({
      state: 'ready',
      name: current.name,
      error: null,
      downloadPercent: null,
      poolSize: current.size,
    });
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

/**
 * Positions already searched at a given depth, for the lifetime of the tab.
 *
 * Openings repeat relentlessly across one player's games — which is exactly how
 * this app is used — so the second review of a Sicilian gets its first fifteen
 * plies for free. Kept in memory rather than in `localStorage`: a few thousand
 * search results would blow the ~5 MB quota that the completed reviews already
 * share, and losing the table on reload costs one re-search.
 *
 * Only complete batch searches are stored. An interrupted result carries a
 * shallower line than it claims, and interactive searches want their progressive
 * `onUpdate` stream rather than an instant answer.
 */
const positionCache = new Map<string, SearchResult>();
/** Bounded so a long session cannot grow it without limit. */
const POSITION_CACHE_LIMIT = 20_000;

/**
 * A time-capped search and a depth-only one are different answers to the same
 * question, so the cap is part of the key: without it the quick pass's shallow,
 * 60ms result would be handed straight back to the full pass asking for depth 18.
 */
function positionKey(fen: string, depth: number, multiPv: number, moveTimeMs: number): string {
  return `${depth}|${multiPv}|${moveTimeMs}|${fen}`;
}

/** Search a single position. Used for both the batch pass and live analysis. */
export async function analysePosition(
  fen: string,
  options: AnalysePositionOptions,
): Promise<SearchResult> {
  const multiPv = options.multiPv ?? 1;
  const priority = options.priority ?? Priority.Batch;
  const cacheable = priority === Priority.Batch && !options.onUpdate;
  const key = positionKey(fen, options.depth, multiPv, options.moveTimeMs ?? 0);

  if (cacheable) {
    const hit = positionCache.get(key);
    if (hit) return hit;
  }

  const current = await ensureEngine({
    ...DEFAULT_ENGINE_CONFIG,
    depth: options.depth,
    multiPv: options.multiPv ?? DEFAULT_ENGINE_CONFIG.multiPv,
  });

  const result = await current.analyse({
    fen,
    depth: options.depth,
    multiPv,
    moveTimeMs: options.moveTimeMs,
    priority,
    signal: options.signal,
    onUpdate: options.onUpdate,
  });

  if (cacheable && !result.interrupted && result.lines.length > 0) {
    if (positionCache.size >= POSITION_CACHE_LIMIT) positionCache.clear();
    positionCache.set(key, result);
  }

  return result;
}

/** Drop the searched-position table (used when the engine settings change). */
export function clearPositionCache(): void {
  positionCache.clear();
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

/** Tear the workers down completely. */
export function disposeEngine(): void {
  engine?.dispose();
  engine = null;
  poolSize = 0;
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
    // Parallel searches, not threads-per-search: valid on every page, isolated or not.
    threads: clamp(config.threads ?? DEFAULT_ENGINE_CONFIG.threads, 1, parallelism(), 1),
    hash: clamp(config.hash ?? DEFAULT_ENGINE_CONFIG.hash, ENGINE_LIMITS.hash.min, ENGINE_LIMITS.hash.max, DEFAULT_ENGINE_CONFIG.hash),
    moveTimeMs: clamp(
      config.moveTimeMs ?? DEFAULT_ENGINE_CONFIG.moveTimeMs,
      ENGINE_LIMITS.moveTimeMs.min,
      ENGINE_LIMITS.moveTimeMs.max,
      DEFAULT_ENGINE_CONFIG.moveTimeMs,
    ),
    multiPv: clamp(config.multiPv ?? DEFAULT_ENGINE_CONFIG.multiPv, ENGINE_LIMITS.multiPv.min, ENGINE_LIMITS.multiPv.max, DEFAULT_ENGINE_CONFIG.multiPv),
    quickPass: config.quickPass ?? DEFAULT_ENGINE_CONFIG.quickPass,
  };
}
