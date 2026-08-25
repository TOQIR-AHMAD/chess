import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EngineAbortError, EngineLoadError, Priority, UciEngine } from './stockfishWorker';
import { START_FEN } from '@/utils/chess';

/**
 * Exercises the UCI conversation without the real WASM engine: a fake Worker
 * plays the engine's side of the protocol so queueing, preemption, cancellation
 * and result assembly can be verified deterministically.
 */

interface ScriptedSearch {
  infos: string[];
  bestMove: string;
}

class FakeEngineWorker implements Partial<Worker> {
  static instances: FakeEngineWorker[] = [];
  static script: ScriptedSearch = {
    infos: [
      'info depth 4 multipv 1 score cp 20 nodes 1000 nps 50000 time 20 pv e2e4 e7e5',
      'info depth 10 multipv 1 score cp 35 nodes 90000 nps 90000 time 200 pv e2e4 e7e5 g1f3',
      'info depth 10 multipv 2 score cp 12 nodes 90000 pv d2d4 d7d5',
    ],
    bestMove: 'bestmove e2e4 ponder e7e5',
  };
  /** When true the worker reports a load failure instead of answering `uci`. */
  static failToLoad = false;
  /**
   * How long a search runs before finishing on its own, in ms. `null` means it
   * runs until `stop` arrives — which is what the cancellation tests need, since
   * a self-terminating search races the abort.
   */
  static autoFinishMs: number | null = 5;
  /** Simulates a build that never answers `isready`. */
  static swallowIsReady = false;

  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  readonly sent: string[] = [];
  terminated = false;
  readonly url: string;
  private searching = false;

  constructor(url: string) {
    this.url = url;
    FakeEngineWorker.instances.push(this);
    if (FakeEngineWorker.failToLoad) {
      queueMicrotask(() => this.onerror?.({ message: 'wasm missing' } as ErrorEvent));
    }
  }

  postMessage(data: unknown): void {
    // The progress MessagePort handshake sends an object, not a string.
    if (typeof data !== 'string') return;
    this.sent.push(data);

    if (data === 'uci') {
      this.emit('id name Stockfish 18 lite');
      this.emit('uciok');
      return;
    }
    if (data === 'isready') {
      if (!FakeEngineWorker.swallowIsReady) this.emit('readyok');
      return;
    }
    if (data.startsWith('go')) {
      this.searching = true;
      for (const info of FakeEngineWorker.script.infos) this.emit(info);
      if (FakeEngineWorker.autoFinishMs !== null) {
        setTimeout(() => {
          if (this.searching) {
            this.searching = false;
            this.emit(FakeEngineWorker.script.bestMove);
          }
        }, FakeEngineWorker.autoFinishMs);
      }
      return;
    }
    if (data === 'stop' && this.searching) {
      this.searching = false;
      this.emit(FakeEngineWorker.script.bestMove);
    }
  }

  terminate(): void {
    this.terminated = true;
  }

  private emit(line: string): void {
    queueMicrotask(() => this.onmessage?.({ data: line } as MessageEvent));
  }
}

const OriginalWorker = globalThis.Worker;

beforeEach(() => {
  FakeEngineWorker.instances = [];
  FakeEngineWorker.failToLoad = false;
  FakeEngineWorker.swallowIsReady = false;
  FakeEngineWorker.autoFinishMs = 5;
  UciEngine.readyTimeoutMs = 30_000;
  vi.stubGlobal('Worker', FakeEngineWorker as unknown as typeof Worker);
});

afterEach(() => {
  vi.unstubAllGlobals();
  globalThis.Worker = OriginalWorker;
});

describe('UciEngine — startup', () => {
  it('completes the uci handshake and reads the engine name', async () => {
    const engine = new UciEngine();
    await engine.init();

    const worker = FakeEngineWorker.instances[0];
    expect(worker.sent).toContain('uci');
    expect(worker.sent).toContain('isready');
    expect(engine.name).toBe('Stockfish 18 lite');
    engine.dispose();
  });

  it('points the worker at the matching wasm binary', async () => {
    const engine = new UciEngine();
    await engine.init();
    const worker = FakeEngineWorker.instances[0];
    expect(worker.url).toContain('/engine/stockfish-18-lite');
    expect(decodeURIComponent(worker.url.split('#')[1] ?? '')).toContain('.wasm');
    engine.dispose();
  });

  it('surfaces a load failure as a typed error', async () => {
    FakeEngineWorker.failToLoad = true;
    const engine = new UciEngine();
    await expect(engine.init()).rejects.toBeInstanceOf(EngineLoadError);
  });

  it('only starts one worker no matter how often init is called', async () => {
    const engine = new UciEngine();
    await Promise.all([engine.init(), engine.init(), engine.init()]);
    expect(FakeEngineWorker.instances).toHaveLength(1);
    engine.dispose();
  });
});

describe('UciEngine — searching', () => {
  it('sends position and go, then assembles the result', async () => {
    const engine = new UciEngine();
    const result = await engine.analyse({ fen: START_FEN, depth: 10, multiPv: 2, priority: Priority.Batch });

    const worker = FakeEngineWorker.instances[0];
    expect(worker.sent).toContain(`position fen ${START_FEN}`);
    expect(worker.sent).toContain('go depth 10');
    expect(worker.sent).toContain('setoption name MultiPV value 2');

    expect(result.bestMove).toBe('e2e4');
    expect(result.ponder).toBe('e7e5');
    expect(result.depth).toBe(10);
    expect(result.lines).toHaveLength(2);
    expect(result.lines[0].score).toEqual({ type: 'cp', value: 35 });
    expect(result.lines[1].score).toEqual({ type: 'cp', value: 12 });
    expect(result.interrupted).toBe(false);
    engine.dispose();
  });

  it('converts the principal variation to SAN', async () => {
    const engine = new UciEngine();
    const result = await engine.analyse({ fen: START_FEN, depth: 10, multiPv: 1, priority: Priority.Batch });
    expect(result.lines[0].san).toEqual(['e4', 'e5', 'Nf3']);
    engine.dispose();
  });

  it('adds a movetime limit when one is configured', async () => {
    const engine = new UciEngine();
    await engine.analyse({ fen: START_FEN, depth: 12, multiPv: 1, moveTimeMs: 500, priority: Priority.Batch });
    expect(FakeEngineWorker.instances[0].sent).toContain('go depth 12 movetime 500');
    engine.dispose();
  });

  it('reports progressive updates while searching', async () => {
    const engine = new UciEngine();
    const updates: number[] = [];
    await engine.analyse({
      fen: START_FEN,
      depth: 10,
      multiPv: 1,
      priority: Priority.Batch,
      onUpdate: (partial) => updates.push(partial.depth),
    });
    expect(updates.length).toBeGreaterThan(0);
    engine.dispose();
  });

  it('runs queued searches one at a time', async () => {
    const engine = new UciEngine();
    const results = await Promise.all([
      engine.analyse({ fen: START_FEN, depth: 8, multiPv: 1, priority: Priority.Batch }),
      engine.analyse({ fen: START_FEN, depth: 8, multiPv: 1, priority: Priority.Batch }),
    ]);
    expect(results).toHaveLength(2);
    const goCount = FakeEngineWorker.instances[0].sent.filter((line) => line.startsWith('go')).length;
    expect(goCount).toBe(2);
    engine.dispose();
  });

  it('reports terminal positions as having no best move', async () => {
    FakeEngineWorker.script = { infos: [], bestMove: 'bestmove (none)' };
    const engine = new UciEngine();
    const result = await engine.analyse({
      fen: 'rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3',
      depth: 8,
      multiPv: 1,
      priority: Priority.Batch,
    });
    expect(result.bestMove).toBeNull();
    expect(result.lines).toHaveLength(0);
    engine.dispose();

    FakeEngineWorker.script = {
      infos: ['info depth 10 multipv 1 score cp 35 pv e2e4 e7e5 g1f3'],
      bestMove: 'bestmove e2e4',
    };
  });
});

describe('UciEngine — settled positions', () => {
  const DEFAULT_SCRIPT = FakeEngineWorker.script;

  afterEach(() => {
    FakeEngineWorker.script = DEFAULT_SCRIPT;
  });

  /** Runs one search and hands back the result plus what the engine was told. */
  async function search(infos: string[], autoFinishMs: number | null) {
    FakeEngineWorker.script = { infos, bestMove: 'bestmove d8d2 ponder e1f1' };
    FakeEngineWorker.autoFinishMs = autoFinishMs;
    const engine = new UciEngine();
    const result = await engine.analyse({ fen: START_FEN, depth: 30, multiPv: 2, priority: Priority.Batch });
    const sent = [...FakeEngineWorker.instances[0].sent];
    engine.dispose();
    return { result, sent };
  }

  it('stops as soon as a forced mate is proved', async () => {
    // autoFinishMs null: the fake engine answers only when told to stop, so this
    // resolving at all is the assertion that we stopped it.
    const { result, sent } = await search(
      [
        'info depth 12 multipv 1 score cp 640 pv d8d2 e1f1',
        'info depth 14 multipv 1 score mate 5 pv d8d2 e1f1 d2d1',
      ],
      null,
    );
    expect(sent).toContain('stop');
    expect(result.lines[0].score).toEqual({ type: 'mate', value: 5 });
  });

  it('does not report a settled search as interrupted', async () => {
    // The distinction matters: gameAnalysis retries interrupted searches, and a
    // position we stopped deliberately has nothing to retry.
    const { result } = await search(['info depth 14 multipv 1 score mate 3 pv d8d2 e1f1'], null);
    expect(result.interrupted).toBe(false);
    expect(result.bestMove).toBe('d8d2');
  });

  it('stops on a mate against the side to move too', async () => {
    const { sent } = await search(['info depth 14 multipv 1 score mate -4 pv e1f1 d8d2'], null);
    expect(sent).toContain('stop');
  });

  it('keeps searching while the score is still centipawns', async () => {
    const { sent } = await search(['info depth 14 multipv 1 score cp 900 pv d8d2 e1f1'], 5);
    expect(sent).not.toContain('stop');
  });

  it('ignores a bounded mate score', async () => {
    // A lowerbound score is the aspiration window talking, not a proof.
    const { sent } = await search(['info depth 14 multipv 1 score mate 5 lowerbound pv d8d2'], 5);
    expect(sent).not.toContain('stop');
  });

  it('ignores a mate found only in a secondary line', async () => {
    const { sent } = await search(
      [
        'info depth 14 multipv 1 score cp 120 pv e1f1 d8d2',
        'info depth 14 multipv 2 score mate 6 pv d8d2 e1f1',
      ],
      5,
    );
    expect(sent).not.toContain('stop');
  });

  it('asks the engine to stop exactly once', async () => {
    const { sent } = await search(
      [
        'info depth 14 multipv 1 score mate 5 pv d8d2 e1f1',
        'info depth 15 multipv 1 score mate 5 pv d8d2 e1f1 d2d1',
        'info depth 16 multipv 1 score mate 4 pv d8d2 e1f1 d2d1',
      ],
      null,
    );
    expect(sent.filter((line) => line === 'stop')).toHaveLength(1);
  });
});

describe('UciEngine — preemption and cancellation', () => {
  // These searches must stay running until something stops them.
  beforeEach(() => {
    FakeEngineWorker.autoFinishMs = null;
  });

  it('interrupts a batch search when an interactive one arrives', async () => {
    const engine = new UciEngine();
    await engine.init();

    const batch = engine.analyse({ fen: START_FEN, depth: 20, multiPv: 1, priority: Priority.Batch });
    // Give the batch search a tick to actually start.
    await new Promise((resolve) => setTimeout(resolve, 1));
    const interactive = engine.analyse({ fen: START_FEN, depth: 20, multiPv: 1, priority: Priority.Interactive });

    const batchResult = await batch;
    expect(batchResult.interrupted).toBe(true);
    expect(FakeEngineWorker.instances[0].sent).toContain('stop');

    // The interactive search took over and runs until it is stopped in turn.
    await new Promise((resolve) => setTimeout(resolve, 1));
    engine.stop();
    await expect(interactive).resolves.toBeDefined();
    engine.dispose();
  });

  it('rejects with EngineAbortError when the signal fires before the search starts', async () => {
    const engine = new UciEngine();
    const controller = new AbortController();
    controller.abort();
    await expect(
      engine.analyse({ fen: START_FEN, depth: 8, multiPv: 1, priority: Priority.Batch, signal: controller.signal }),
    ).rejects.toBeInstanceOf(EngineAbortError);
    engine.dispose();
  });

  it('stops the engine and rejects when a running search is aborted', async () => {
    const engine = new UciEngine();
    await engine.init();
    const controller = new AbortController();
    const pending = engine.analyse({
      fen: START_FEN,
      depth: 30,
      multiPv: 1,
      priority: Priority.Batch,
      signal: controller.signal,
    });
    await new Promise((resolve) => setTimeout(resolve, 1));
    controller.abort();

    await expect(pending).rejects.toBeInstanceOf(EngineAbortError);
    expect(FakeEngineWorker.instances[0].sent).toContain('stop');
    engine.dispose();
  });

  it('cancelAll rejects everything still queued', async () => {
    const engine = new UciEngine();
    await engine.init();
    const first = engine.analyse({ fen: START_FEN, depth: 30, multiPv: 1, priority: Priority.Batch });
    await new Promise((resolve) => setTimeout(resolve, 1));
    const queued = engine.analyse({ fen: START_FEN, depth: 30, multiPv: 1, priority: Priority.Batch });

    engine.cancelAll();
    await expect(queued).rejects.toBeInstanceOf(EngineAbortError);
    await expect(first).resolves.toBeDefined();
    engine.dispose();
  });

  it('terminates the worker on dispose', async () => {
    const engine = new UciEngine();
    await engine.init();
    engine.dispose();
    expect(FakeEngineWorker.instances[0].terminated).toBe(true);
    expect(FakeEngineWorker.instances[0].sent).toContain('quit');
  });
});

describe('UciEngine — options', () => {
  it('sends each option once and skips unchanged values', async () => {
    const engine = new UciEngine();
    await engine.setOptions({ threads: 1, hash: 64, multiPv: 2 });
    await engine.setOptions({ threads: 1, hash: 64, multiPv: 2 });

    const sent = FakeEngineWorker.instances[0].sent;
    expect(sent.filter((line) => line === 'setoption name Hash value 64')).toHaveLength(1);
    expect(sent.filter((line) => line === 'setoption name MultiPV value 2')).toHaveLength(1);
    engine.dispose();
  });

  it('clamps options into supported ranges', async () => {
    const engine = new UciEngine();
    await engine.setOptions({ hash: 99_999, multiPv: 99 });
    const sent = FakeEngineWorker.instances[0].sent;
    expect(sent).toContain('setoption name Hash value 512');
    expect(sent).toContain('setoption name MultiPV value 5');
    engine.dispose();
  });

  it('resets search state for a new game', async () => {
    const engine = new UciEngine();
    await engine.newGame();
    expect(FakeEngineWorker.instances[0].sent).toContain('ucinewgame');
    engine.dispose();
  });

  /**
   * Regression: raising `Threads` makes the WASM build spawn pthreads, and it can
   * only finish that once its event loop runs. Sending `position`/`go` in the same
   * tick deadlocked the engine before it produced a single line, so every option
   * change must be followed by an `isready`/`readyok` round trip.
   */
  it('waits for readyok after changing options before searching', async () => {
    const engine = new UciEngine();
    await engine.analyse({ fen: START_FEN, depth: 8, multiPv: 2, priority: Priority.Batch });

    const sent = FakeEngineWorker.instances[0].sent;
    const lastOption = Math.max(
      sent.lastIndexOf('setoption name MultiPV value 2'),
      sent.lastIndexOf('setoption name Threads value 1'),
    );
    const readyAfterOption = sent.indexOf('isready', lastOption);
    const goIndex = sent.findIndex((line) => line.startsWith('go'));

    expect(lastOption).toBeGreaterThan(-1);
    expect(readyAfterOption).toBeGreaterThan(lastOption);
    expect(goIndex).toBeGreaterThan(readyAfterOption);
    engine.dispose();
  });

  it('does not wait on readyok when no option actually changed', async () => {
    const engine = new UciEngine();
    await engine.setOptions({ hash: 64, multiPv: 2 });
    const before = FakeEngineWorker.instances[0].sent.filter((l) => l === 'isready').length;

    await engine.setOptions({ hash: 64, multiPv: 2 });
    const after = FakeEngineWorker.instances[0].sent.filter((l) => l === 'isready').length;

    expect(after).toBe(before);
    engine.dispose();
  });

  it('does not hang when the engine never answers readyok', async () => {
    // A build that swallows `isready` must degrade to a slow start, not a hang.
    FakeEngineWorker.swallowIsReady = true;
    UciEngine.readyTimeoutMs = 40;

    const engine = new UciEngine();
    await expect(
      Promise.race([
        engine.setOptions({ hash: 128 }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('hung')), 2000)),
      ]),
    ).resolves.toBeUndefined();
    engine.dispose();
  });
});
