/**
 * Copies the Stockfish WASM builds out of node_modules into `public/engine/`
 * so they are served as static assets (and never bundled).
 *
 * Two builds are shipped:
 *   - `lite-single`  : single-threaded, works everywhere, no special headers.
 *   - `lite`         : multi-threaded, requires cross-origin isolation
 *                      (SharedArrayBuffer). Used only when `crossOriginIsolated`.
 *
 * The full (non-lite) builds embed a ~110 MB network and are intentionally skipped.
 */
import { existsSync, mkdirSync, copyFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const from = join(root, 'node_modules', 'stockfish', 'bin');
const to = join(root, 'public', 'engine');

const FILES = [
  'stockfish-18-lite-single.js',
  'stockfish-18-lite-single.wasm',
  'stockfish-18-lite.js',
  'stockfish-18-lite.wasm',
];

if (!existsSync(from)) {
  console.error(`[copy-engine] stockfish package not found at ${from}. Run "npm install" first.`);
  process.exit(1);
}

mkdirSync(to, { recursive: true });

let copied = 0;
for (const file of FILES) {
  const src = join(from, file);
  const dest = join(to, file);
  if (!existsSync(src)) {
    console.warn(`[copy-engine] missing ${file} — skipping`);
    continue;
  }
  // Skip if an identically sized copy is already in place.
  if (existsSync(dest) && statSync(dest).size === statSync(src).size) continue;
  copyFileSync(src, dest);
  copied += 1;
}

console.log(`[copy-engine] engine assets ready in public/engine (${copied} file(s) copied)`);
