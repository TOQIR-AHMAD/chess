import type { PvLine, SearchResult } from '@/types/analysis';
import { collectPvLines, mergePvLine, parseBestMove, parseInfoLine } from '@/utils/uci';
import { uciLineToSan } from '@/utils/chess';

/**
 * Owns the Stockfish WebAssembly worker and speaks UCI to it.
 *
 * The engine build itself *is* a Web Worker (an Emscripten module that installs
 * its own `onmessage` handler), so all search work happens off the main thread.
 * This class adds:
 *   - lifecycle + option management,
 *   - a single-flight search queue with **priority preemption**, so the position
 *     the user is looking at always jumps ahead of the background full-game pass,
 *   - progressive updates while a search is still running,
 *   - cancellation via `AbortSignal`.
 */

/** Engine builds copied into `public/engine` by `scripts/copy-engine.mjs`. */
const SINGLE_THREADED = 'stockfish-18-lite-single.js';
const MULTI_THREADED = 'stockfish-18-lite.js';

export interface AnalyseJob {
  fen: string;
  depth: number;
  multiPv: number;
  /** Optional hard time cap in ms. 0 or undefined = search to `depth`. */
  moveTimeMs?: number;
  /** Higher wins. Interactive requests use `Priority.Interactive`. */
  priority: number;
  signal?: AbortSignal;
  /** Called with progressively deeper partial results. */
  onUpdate?: (partial: SearchResult) => void;
}

export const Priority = {
  Batch: 0,
  Interactive: 10,
} as const;

export class EngineAbortError extends Error {
  constructor() {
    super('Engine search cancelled');
    this.name = 'EngineAbortError';
  }
}

export class EngineLoadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EngineLoadError';
  }
}

interface QueueEntry {
  job: AnalyseJob;
  seq: number;
  resolve: (result: SearchResult) => void;
  reject: (error: unknown) => void;
}

interface ActiveSearch extends QueueEntry {
  lines: Map<number, PvLine>;
  depth: number;
  nodes: number | null;
  nps: number | null;
  timeMs: number | null;
  stopRequested: boolean;
  preempted: boolean;
  lastEmit: number;
  onAbort: (() => void) | null;
}

/** True when the page can host a multi-threaded WASM engine. */
export function supportsThreads(): boolean {
  return (
    typeof SharedArrayBuffer !== 'undefined' &&
    typeof globalThis.crossOriginIsolated === 'boolean' &&
    globalThis.crossOriginIsolated
  );
}

export function maxThreads(): number {
  if (!supportsThreads()) return 1;
  const cores = typeof navigator !== 'undefined' ? (navigator.hardwareConcurrency ?? 2) : 2;
  // Leave a core for the UI; the engine gets the rest, capped for sanity.
  return Math.max(1, Math.min(8, cores - 1));
}

export class UciEngine {
  /** How long to wait for `readyok` before giving up on the handshake. */
  static readyTimeoutMs = 30_000;

  private worker: Worker | null = null;
  private readyPromise: Promise<void> | null = null;
  private queue: QueueEntry[] = [];
  private active: ActiveSearch | null = null;
  private seq = 0;
  private pumping = false;
  private appliedOptions = { threads: 0, hash: 0, multiPv: 0 };
  private disposed = false;
  private engineName = 'Stockfish';
  private readonly onDownloadProgress?: (percent: number) => void;
  private onUciOk: (() => void) | null = null;
  /** Pending `isready` round trips, resolved in order by each `readyok`. */
  private readyWaiters: Array<{ resolve: () => void; timer: ReturnType<typeof setTimeout> }> = [];

  constructor(onDownloadProgress?: (percent: number) => void) {
    this.onDownloadProgress = onDownloadProgress;
  }

  get name(): string {
    return this.engineName;
  }

  get multiThreaded(): boolean {
    return supportsThreads();
  }

  /** Boot the worker, hand it the WASM URL and wait for `uciok` + `readyok`. */
  init(): Promise<void> {
    if (this.readyPromise) return this.readyPromise;

    this.readyPromise = new Promise<void>((resolve, reject) => {
      let settled = false;
      const timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(new EngineLoadError('The chess engine took too long to start.'));
      }, 90_000);

      try {
        const base = import.meta.env.BASE_URL ?? '/';
        const file = supportsThreads() ? MULTI_THREADED : SINGLE_THREADED;
        const jsUrl = new URL(`${base}engine/${file}`, window.location.href);
        const wasmUrl = new URL(`${base}engine/${file.replace(/\.js$/, '.wasm')}`, window.location.href);
        // The build reads its WASM location from the URL fragment.
        jsUrl.hash = encodeURIComponent(wasmUrl.href);

        const worker = new Worker(jsUrl.href);
        this.worker = worker;

        worker.onerror = (event) => {
          const message = event.message || 'The chess engine failed to load.';
          if (!settled) {
            settled = true;
            clearTimeout(timeout);
            reject(new EngineLoadError(message));
          }
          this.failActive(new EngineLoadError(message));
        };

        // `uciok` only means the engine has listed its options. Wait for a full
        // `isready`/`readyok` round trip before declaring it usable.
        this.onUciOk = () => {
          void this.isReady().then(() => {
            if (settled) return;
            settled = true;
            clearTimeout(timeout);
            resolve();
          });
        };

        worker.onmessage = (event: MessageEvent) => {
          const data = event.data;
          if (typeof data !== 'string') return;
          this.handleLine(data);
        };

        this.subscribeToDownloadProgress(worker);

        worker.postMessage('uci');
      } catch (error) {
        clearTimeout(timeout);
        settled = true;
        reject(
          new EngineLoadError(
            error instanceof Error ? error.message : 'The chess engine could not be started.',
          ),
        );
      }
    });

    return this.readyPromise;
  }

  /**
   * The engine streams WASM download progress over a dedicated MessagePort as
   * `{ percent: 0..1 }`, and closes the port once it reaches 1.
   */
  private subscribeToDownloadProgress(worker: Worker): void {
    if (!this.onDownloadProgress || typeof MessageChannel === 'undefined') return;
    try {
      const channel = new MessageChannel();
      channel.port1.onmessage = (event: MessageEvent) => {
        const payload = event.data as { percent?: number } | undefined;
        if (payload && typeof payload.percent === 'number') {
          this.onDownloadProgress?.(Math.max(0, Math.min(1, payload.percent)) * 100);
        }
      };
      worker.postMessage({ progressPort: channel.port2 }, [channel.port2]);
    } catch {
      // Progress reporting is a nicety; ignore environments that lack it.
    }
  }

  private post(command: string): void {
    this.worker?.postMessage(command);
  }

  /**
   * `isready` / `readyok` round trip.
   *
   * This is not optional politeness. Raising `Threads` makes the WASM build spawn
   * pthreads, which it can only finish once its own event loop runs; firing
   * `position`/`go` in the same tick deadlocks the engine before it emits a single
   * line. Every option change is therefore followed by this handshake.
   *
   * Resolves (rather than rejecting) on timeout so a missed `readyok` degrades to
   * a slow start instead of a permanently stuck engine.
   */
  private isReady(timeoutMs = UciEngine.readyTimeoutMs): Promise<void> {
    return new Promise<void>((resolve) => {
      const waiter = {
        resolve,
        timer: setTimeout(() => {
          const index = this.readyWaiters.indexOf(waiter);
          if (index > -1) this.readyWaiters.splice(index, 1);
          resolve();
        }, timeoutMs),
      };
      this.readyWaiters.push(waiter);
      this.post('isready');
    });
  }

  private resolveReadyWaiter(): void {
    const waiter = this.readyWaiters.shift();
    if (!waiter) return;
    clearTimeout(waiter.timer);
    waiter.resolve();
  }

  /**
   * Apply engine options. Only changed values are sent, and the engine is given a
   * chance to settle afterwards before any search is started.
   */
  async setOptions(options: { threads?: number; hash?: number; multiPv?: number }): Promise<void> {
    await this.init();
    const threads = options.threads !== undefined ? Math.max(1, Math.min(maxThreads(), options.threads)) : undefined;
    let changed = false;

    if (threads !== undefined && threads !== this.appliedOptions.threads) {
      this.post(`setoption name Threads value ${threads}`);
      this.appliedOptions.threads = threads;
      changed = true;
    }
    if (options.hash !== undefined && options.hash !== this.appliedOptions.hash) {
      const hash = Math.max(1, Math.min(512, options.hash));
      this.post(`setoption name Hash value ${hash}`);
      this.appliedOptions.hash = hash;
      changed = true;
    }
    if (options.multiPv !== undefined && options.multiPv !== this.appliedOptions.multiPv) {
      const multiPv = Math.max(1, Math.min(5, options.multiPv));
      this.post(`setoption name MultiPV value ${multiPv}`);
      this.appliedOptions.multiPv = multiPv;
      changed = true;
    }

    if (changed) await this.isReady();
  }

  /** Reset the engine's internal state between games. */
  async newGame(): Promise<void> {
    await this.init();
    this.post('ucinewgame');
    await this.isReady();
  }

  /** Queue a search. Resolves when the engine reports `bestmove`. */
  analyse(job: AnalyseJob): Promise<SearchResult> {
    if (this.disposed) return Promise.reject(new EngineAbortError());
    if (job.signal?.aborted) return Promise.reject(new EngineAbortError());

    return new Promise<SearchResult>((resolve, reject) => {
      const entry: QueueEntry = { job, seq: this.seq++, resolve, reject };
      this.queue.push(entry);
      // Highest priority first; ties keep submission order.
      this.queue.sort((a, b) => b.job.priority - a.job.priority || a.seq - b.seq);
      this.maybePreempt();
      void this.pump();
    });
  }

  /**
   * Interrupt the running search when something more urgent is waiting — this is
   * what lets the position the user just clicked jump ahead of the batch pass.
   */
  private maybePreempt(): void {
    const active = this.active;
    const next = this.queue[0];
    if (!active || !next) return;
    if (next.job.priority > active.job.priority && !active.stopRequested) {
      active.stopRequested = true;
      active.preempted = true;
      this.post('stop');
    }
  }

  /** Stop the running search (its promise still resolves, flagged `interrupted`). */
  stop(): void {
    if (this.active && !this.active.stopRequested) {
      this.active.stopRequested = true;
      this.post('stop');
    }
  }

  /** Drop every queued search and stop the running one. */
  cancelAll(): void {
    const queued = this.queue.splice(0, this.queue.length);
    for (const entry of queued) entry.reject(new EngineAbortError());
    this.stop();
  }

  dispose(): void {
    this.disposed = true;
    this.cancelAll();
    this.failActive(new EngineAbortError());
    // Release anyone still waiting on a `readyok` that will never come.
    for (const waiter of this.readyWaiters.splice(0)) {
      clearTimeout(waiter.timer);
      waiter.resolve();
    }
    try {
      this.post('quit');
      this.worker?.terminate();
    } catch {
      // Worker may already be gone.
    }
    this.worker = null;
    this.readyPromise = null;
    this.onUciOk = null;
    this.appliedOptions = { threads: 0, hash: 0, multiPv: 0 };
  }

  /**
   * Start queued searches, one at a time.
   *
   * The `pumping` guard matters: starting a search awaits `init()` and
   * `setOptions()`, and without it two calls made before those resolve would both
   * reach the "start a search" step and the first job's promise would be orphaned.
   */
  private async pump(): Promise<void> {
    if (this.pumping) return;
    this.pumping = true;

    try {
      while (!this.disposed && !this.active && this.queue.length > 0) {
        const entry = this.queue.shift();
        if (!entry) break;

        if (entry.job.signal?.aborted) {
          entry.reject(new EngineAbortError());
          continue;
        }

        try {
          await this.init();
          await this.setOptions({ multiPv: entry.job.multiPv });
        } catch (error) {
          entry.reject(error);
          continue;
        }

        // Re-check: the job may have been cancelled while the engine booted.
        if (entry.job.signal?.aborted) {
          entry.reject(new EngineAbortError());
          continue;
        }

        this.startSearch(entry);
      }
    } finally {
      this.pumping = false;
    }

    this.maybePreempt();
  }

  private startSearch(entry: QueueEntry): void {
    const search: ActiveSearch = {
      ...entry,
      lines: new Map(),
      depth: 0,
      nodes: null,
      nps: null,
      timeMs: null,
      stopRequested: false,
      preempted: false,
      lastEmit: 0,
      onAbort: null,
    };
    this.active = search;

    if (entry.job.signal) {
      const onAbort = () => {
        if (this.active === search && !search.stopRequested) {
          search.stopRequested = true;
          this.post('stop');
        }
      };
      search.onAbort = onAbort;
      entry.job.signal.addEventListener('abort', onAbort, { once: true });
    }

    this.post(`position fen ${entry.job.fen}`);
    const limits = entry.job.moveTimeMs
      ? `depth ${entry.job.depth} movetime ${entry.job.moveTimeMs}`
      : `depth ${entry.job.depth}`;
    this.post(`go ${limits}`);
  }

  private handleLine(line: string): void {
    if (line.startsWith('id name')) {
      this.engineName = line.slice('id name'.length).trim() || this.engineName;
      return;
    }
    if (line === 'uciok') {
      this.onUciOk?.();
      return;
    }
    if (line === 'readyok') {
      this.resolveReadyWaiter();
      return;
    }

    const search = this.active;
    if (!search) return;

    if (line.startsWith('bestmove')) {
      this.finishSearch(search, line);
      return;
    }

    const info = parseInfoLine(line);
    if (!info) return;

    if (info.depth !== null) search.depth = Math.max(search.depth, info.depth);
    if (info.nodes !== null) search.nodes = info.nodes;
    if (info.nps !== null) search.nps = info.nps;
    if (info.timeMs !== null) search.timeMs = info.timeMs;

    // SAN conversion is deferred to result-building; it is far too costly to run
    // for every `info` line the engine emits.
    mergePvLine(search.lines, info, () => []);

    if (search.job.onUpdate && info.pv.length > 0) {
      const now = performance.now();
      // Throttle progressive updates so React does not re-render per info line.
      if (now - search.lastEmit > 120) {
        search.lastEmit = now;
        search.job.onUpdate(this.buildResult(search, false));
      }
    }
  }

  private finishSearch(search: ActiveSearch, bestMoveLine: string): void {
    const parsed = parseBestMove(bestMoveLine);
    const result = this.buildResult(search, search.preempted || search.stopRequested);
    result.bestMove = parsed?.bestMove ?? result.bestMove;
    result.ponder = parsed?.ponder ?? null;

    if (search.job.signal && search.onAbort) {
      search.job.signal.removeEventListener('abort', search.onAbort);
    }

    this.active = null;

    if (search.job.signal?.aborted) {
      search.reject(new EngineAbortError());
    } else {
      search.resolve(result);
    }

    void this.pump();
  }

  private buildResult(search: ActiveSearch, interrupted: boolean): SearchResult {
    const lines = collectPvLines(search.lines).map((line) => ({
      ...line,
      san: uciLineToSan(search.job.fen, line.pv, 12),
    }));

    return {
      fen: search.job.fen,
      depth: search.depth,
      bestMove: lines[0]?.pv[0] ?? null,
      ponder: null,
      lines,
      interrupted,
      nodes: search.nodes,
      nps: search.nps,
      timeMs: search.timeMs,
    };
  }

  private failActive(error: unknown): void {
    const search = this.active;
    if (!search) return;
    this.active = null;
    if (search.job.signal && search.onAbort) {
      search.job.signal.removeEventListener('abort', search.onAbort);
    }
    search.reject(error);
  }
}
