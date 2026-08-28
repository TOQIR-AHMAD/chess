import type { SearchResult } from '@/types/analysis';
import { type AnalyseJob, EngineAbortError, UciEngine, parallelism } from './stockfishWorker';

/**
 * A pool of single-threaded engines sharing one priority queue.
 *
 * ## Why a pool instead of one multi-threaded engine
 *
 * A full-game review is *throughput*-bound: the N+1 positions are independent, and
 * nothing waits on any one of them individually. Lazy SMP — handing several threads
 * to a single search — solves the opposite problem (latency for one position) and
 * scales well under linear while doing it. Running K independent searches on K
 * single-threaded engines instead scales close to linear, because there is nothing
 * to share and nothing to synchronise.
 *
 * The pool is therefore K single-threaded engines, not one engine with K threads.
 *
 * A single-threaded search is also far more *stable* than a Lazy SMP one, whose
 * thread timing changes which nodes get searched. It is not fully reproducible even
 * so, and it is worth being precise about why: each engine keeps its transposition
 * table between the positions it handles, and which engine handles which position
 * depends on when slots free up. So a position can still come back a few centipawns
 * apart across runs. Making the batch bit-for-bit reproducible would mean clearing
 * the table between positions, which costs more than the property is worth — but
 * classification thresholds should not be set so tight that a few centipawns of
 * drift flips a label.
 *
 * ## Scheduling
 *
 * One queue, ordered by priority then submission. Any idle engine takes the front of
 * it, so the position the user just clicked is picked up by whichever engine frees up
 * first. When nothing is idle, an interactive job **preempts** the lowest-priority
 * running search.
 *
 * A preempted batch search is *requeued*, not returned. This matters for correctness:
 * returning its partial result would silently fold a shallower evaluation into the
 * review, so a game would be classified differently depending on where the user
 * happened to click while it ran.
 */

interface PoolEntry {
  job: AnalyseJob;
  seq: number;
  resolve: (result: SearchResult) => void;
  reject: (error: unknown) => void;
}

interface Slot {
  engine: UciEngine;
  entry: PoolEntry | null;
  /** Set when the pool stopped this slot to free it for higher-priority work. */
  preempted: boolean;
}

/** Per-engine transposition table floor, in MB. */
const MIN_HASH_MB = 16;

export interface EnginePoolOptions {
  size: number;
  onDownloadProgress?: (percent: number) => void;
}

export class EnginePool {
  private slots: Slot[] = [];
  private queue: PoolEntry[] = [];
  private seq = 0;
  private readonly requestedSize: number;
  private readonly onDownloadProgress?: (percent: number) => void;
  private initPromise: Promise<void> | null = null;
  private disposed = false;

  constructor(options: EnginePoolOptions) {
    this.requestedSize = Math.max(1, Math.min(parallelism(), Math.round(options.size)));
    this.onDownloadProgress = options.onDownloadProgress;
  }

  get size(): number {
    return this.slots.length || this.requestedSize;
  }

  get name(): string {
    return this.slots[0]?.engine.name ?? 'Stockfish';
  }

  /**
   * Boot every engine.
   *
   * The first one is booted alone. All K workers fetch the same ~7 MB WASM binary,
   * and starting them together races K cache misses against each other; letting the
   * first finish puts the binary in the HTTP cache for the rest.
   */
  init(): Promise<void> {
    if (this.initPromise) return this.initPromise;

    this.initPromise = (async () => {
      const first = this.spawn(true);
      this.slots.push(first);
      await first.engine.init();
      if (this.disposed) return;

      const rest: Slot[] = [];
      for (let i = 1; i < this.requestedSize; i += 1) rest.push(this.spawn(false));
      this.slots.push(...rest);
      await Promise.all(rest.map((slot) => slot.engine.init()));
    })();

    return this.initPromise;
  }

  private spawn(reportProgress: boolean): Slot {
    // Only the first engine reports download progress; the others are served from
    // cache and would otherwise drive the same bar back to zero.
    const engine = new UciEngine(
      reportProgress && this.onDownloadProgress ? (percent) => this.onDownloadProgress?.(percent) : undefined,
      { forceSingleThreaded: true },
    );
    return { engine, entry: null, preempted: false };
  }

  /**
   * Apply options to every engine.
   *
   * `Threads` is deliberately not exposed: each engine in the pool is single-threaded
   * by construction, and the parallelism comes from the pool's width instead.
   *
   * `hash` is treated as a **total** budget and divided across the pool, so widening
   * the pool cannot multiply memory use. Each engine keeps at least `MIN_HASH_MB`,
   * which is ample for the few-second searches a fixed-depth review runs.
   */
  async setOptions(options: { hash?: number; multiPv?: number }): Promise<void> {
    await this.init();

    const perEngineHash =
      options.hash === undefined
        ? undefined
        : Math.max(MIN_HASH_MB, Math.floor(options.hash / this.slots.length));

    await Promise.all(
      this.slots.map((slot) =>
        slot.engine.setOptions({ threads: 1, hash: perEngineHash, multiPv: options.multiPv }),
      ),
    );
  }

  async newGame(): Promise<void> {
    await this.init();
    await Promise.all(this.slots.map((slot) => slot.engine.newGame()));
  }

  /** Queue a search. Resolves when some engine reports `bestmove` for it. */
  analyse(job: AnalyseJob): Promise<SearchResult> {
    if (this.disposed) return Promise.reject(new EngineAbortError());
    if (job.signal?.aborted) return Promise.reject(new EngineAbortError());

    return new Promise<SearchResult>((resolve, reject) => {
      this.enqueue({ job, seq: this.seq++, resolve, reject });
      void this.dispatch();
    });
  }

  private enqueue(entry: PoolEntry): void {
    this.queue.push(entry);
    // Highest priority first; ties keep submission order.
    this.queue.sort((a, b) => b.job.priority - a.job.priority || a.seq - b.seq);
  }

  private async dispatch(): Promise<void> {
    if (this.disposed) return;
    await this.init();
    if (this.disposed) return;

    while (this.queue.length > 0) {
      const slot = this.slots.find((candidate) => candidate.entry === null);
      if (!slot) break;

      const entry = this.queue.shift();
      if (!entry) break;

      if (entry.job.signal?.aborted) {
        entry.reject(new EngineAbortError());
        continue;
      }

      this.run(slot, entry);
    }

    this.maybePreempt();
  }

  private run(slot: Slot, entry: PoolEntry): void {
    slot.entry = entry;
    slot.preempted = false;

    slot.engine
      .analyse(entry.job)
      .then((result) => {
        const wasPreempted = slot.preempted;
        slot.entry = null;
        slot.preempted = false;

        if (wasPreempted && this.shouldRequeue(entry, result)) {
          this.enqueue(entry);
        } else {
          entry.resolve(result);
        }
      })
      .catch((error) => {
        slot.entry = null;
        slot.preempted = false;
        entry.reject(error);
      })
      .finally(() => {
        void this.dispatch();
      });
  }

  /**
   * A preempted search is worth redoing only if it was actually cut short of the
   * answer. A search that already reached its target depth, or that stopped early
   * because it proved a forced mate, is complete — re-running it would burn a slot
   * to arrive at the same result.
   */
  private shouldRequeue(entry: PoolEntry, result: SearchResult): boolean {
    if (entry.job.signal?.aborted) return false;
    if (!result.interrupted) return false;
    if (result.depth >= entry.job.depth) return false;
    return result.lines[0]?.score.type !== 'mate';
  }

  /**
   * Free a slot for a waiting higher-priority job by stopping the least important
   * search currently running.
   */
  private maybePreempt(): void {
    const next = this.queue[0];
    if (!next) return;

    let victim: Slot | null = null;
    for (const slot of this.slots) {
      if (!slot.entry || slot.preempted) continue;
      if (slot.entry.job.priority >= next.job.priority) continue;
      if (!victim || slot.entry.job.priority < (victim.entry?.job.priority ?? Infinity)) {
        victim = slot;
      }
    }

    if (!victim) return;
    victim.preempted = true;
    victim.engine.stop();
  }

  /** Stop every running search but keep the engines warm. */
  stop(): void {
    for (const slot of this.slots) slot.engine.stop();
  }

  /** Drop every queued search and stop the running ones. */
  cancelAll(): void {
    const queued = this.queue.splice(0, this.queue.length);
    for (const entry of queued) entry.reject(new EngineAbortError());
    for (const slot of this.slots) {
      slot.preempted = false;
      slot.engine.cancelAll();
    }
  }

  dispose(): void {
    this.disposed = true;
    this.cancelAll();
    for (const slot of this.slots) slot.engine.dispose();
    this.slots = [];
    this.initPromise = null;
  }
}
