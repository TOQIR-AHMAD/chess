import type { PvLine, Score } from '@/types/analysis';

/**
 * Pure parsers for the subset of the UCI protocol the analysis engine speaks.
 * Keeping them free of worker/DOM concerns makes the protocol layer testable.
 */

export interface InfoLine {
  depth: number | null;
  selDepth: number | null;
  multipv: number;
  score: Score | null;
  /** True when the engine reports the score as a lower/upper bound (partial). */
  bound: 'lower' | 'upper' | null;
  pv: string[];
  nodes: number | null;
  nps: number | null;
  timeMs: number | null;
  /** Present on `info currmove ...` progress lines. */
  currMove: string | null;
  hashFull: number | null;
}

const UCI_MOVE = /^[a-h][1-8][a-h][1-8][qrbn]?$/;

export function isUciMove(token: string): boolean {
  return UCI_MOVE.test(token);
}

/**
 * Parse an `info ...` line. Returns null when the line carries nothing we track
 * (e.g. `info string ...` diagnostics).
 */
export function parseInfoLine(line: string): InfoLine | null {
  if (!line.startsWith('info ')) return null;
  if (line.startsWith('info string')) return null;

  const tokens = line.split(/\s+/);
  const result: InfoLine = {
    depth: null,
    selDepth: null,
    multipv: 1,
    score: null,
    bound: null,
    pv: [],
    nodes: null,
    nps: null,
    timeMs: null,
    currMove: null,
    hashFull: null,
  };

  let sawField = false;
  for (let i = 1; i < tokens.length; i += 1) {
    const token = tokens[i];
    switch (token) {
      case 'depth':
        result.depth = toInt(tokens[++i]);
        sawField = true;
        break;
      case 'seldepth':
        result.selDepth = toInt(tokens[++i]);
        break;
      case 'multipv':
        result.multipv = toInt(tokens[++i]) ?? 1;
        break;
      case 'nodes':
        result.nodes = toInt(tokens[++i]);
        break;
      case 'nps':
        result.nps = toInt(tokens[++i]);
        break;
      case 'time':
        result.timeMs = toInt(tokens[++i]);
        break;
      case 'hashfull':
        result.hashFull = toInt(tokens[++i]);
        break;
      case 'currmove':
        result.currMove = tokens[++i] ?? null;
        sawField = true;
        break;
      case 'score': {
        const kind = tokens[++i];
        const value = toInt(tokens[++i]);
        if ((kind === 'cp' || kind === 'mate') && value !== null) {
          result.score = { type: kind, value };
          sawField = true;
        }
        // An optional bound token may follow the score.
        const next = tokens[i + 1];
        if (next === 'lowerbound' || next === 'upperbound') {
          result.bound = next === 'lowerbound' ? 'lower' : 'upper';
          i += 1;
        }
        break;
      }
      case 'pv': {
        for (let j = i + 1; j < tokens.length; j += 1) {
          const move = tokens[j];
          if (!move || !isUciMove(move)) break;
          result.pv.push(move);
        }
        i = tokens.length;
        sawField = true;
        break;
      }
      default:
        break;
    }
  }

  return sawField ? result : null;
}

/** Parse `bestmove e2e4 [ponder e7e5]`. */
export function parseBestMove(line: string): { bestMove: string | null; ponder: string | null } | null {
  if (!line.startsWith('bestmove')) return null;
  const tokens = line.split(/\s+/);
  const best = tokens[1] ?? null;
  const ponderIdx = tokens.indexOf('ponder');
  return {
    // Stockfish emits `bestmove (none)` for terminal positions.
    bestMove: best && best !== '(none)' && best !== 'NULL' ? best : null,
    ponder: ponderIdx > -1 ? (tokens[ponderIdx + 1] ?? null) : null,
  };
}

/**
 * Fold a stream of info lines into the current best set of principal variations,
 * keyed by multipv index. Later, deeper lines replace earlier ones.
 */
export function mergePvLine(
  lines: Map<number, PvLine>,
  info: InfoLine,
  toSan: (pv: string[]) => string[],
): void {
  if (!info.score || info.pv.length === 0 || info.depth === null) return;
  // Bounded scores are provisional: they would make the bar jitter mid-search.
  if (info.bound) return;

  const existing = lines.get(info.multipv);
  if (existing && existing.depth > info.depth) return;

  lines.set(info.multipv, {
    multipv: info.multipv,
    score: info.score,
    depth: info.depth,
    selDepth: info.selDepth,
    pv: info.pv,
    san: toSan(info.pv),
    nodes: info.nodes,
    nps: info.nps,
    timeMs: info.timeMs,
  });
}

/** Sort the multipv map into a stable, ranked array. */
export function collectPvLines(lines: Map<number, PvLine>): PvLine[] {
  return [...lines.values()].sort((a, b) => a.multipv - b.multipv);
}

function toInt(token: string | undefined): number | null {
  if (token === undefined) return null;
  const value = Number.parseInt(token, 10);
  return Number.isFinite(value) ? value : null;
}
