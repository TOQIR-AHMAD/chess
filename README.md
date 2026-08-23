# Gambit Review

A chess game-review platform: search any Chess.com player, browse their public game
archive, and get a full Stockfish review of any game — evaluation bar, evaluation
graph, move-by-move classification and an accuracy report — entirely in the browser.

No backend, no API key, no account. Game data comes from the public
[Chess.com Published-Data API](https://www.chess.com/news/view/published-data-api) and the
engine is Stockfish 18 compiled to WebAssembly, running in a Web Worker on the user's machine.

> This is an independent project. It is not affiliated with, endorsed by, or derived from
> Chess.com's source code, assets or branding, and its accuracy and move-classification
> algorithms are its own (documented below) rather than reproductions of theirs.

---

## Quick start

```bash
npm install     # also copies the Stockfish WASM builds into public/engine
npm run dev     # http://localhost:5173
npm run build   # typecheck + production build
npm run preview # serve the production build
npm test        # 250+ unit tests
```

`npm install` runs `scripts/copy-engine.mjs`, which copies the engine out of
`node_modules/stockfish` into `public/engine/`. That directory is generated and
git-ignored; re-run `node scripts/copy-engine.mjs` if it goes missing.

---

## The flow

```
username → profile + stats → monthly archives → game list → PGN
       → chess.js parse → position list → Stockfish → classification → review UI
```

1. **Search** a Chess.com username (`/`).
2. **Player page** (`/player/:username`) shows the profile, ratings and game history,
   loading one monthly archive at a time.
3. **Analysis page** (`/analyze/:username/:gameId?m=YYYY-MM`) loads the PGN, replays it,
   runs the engine over every position and renders the review.

The `?m=YYYY-MM` hint lets a shared link resolve a game in a single API request instead of
scanning back through a player's archives.

---

## Architecture

```
src/
  components/
    chess/    ChessBoard EvaluationBar EvaluationGraph MoveList
              AnalysisPanel EnginePanel GameControls GameInfo
              GameReviewPanel EngineSettings
    player/   PlayerSearch PlayerProfile GameList GameFilters
    ui/       Panel Feedback Header Icons ErrorBoundary
  pages/      HomePage PlayerPage GameAnalysisPage NotFoundPage
  services/   chessComApi http cache playerService gameService
              pgnParser openings stockfish gameAnalysis classification
  workers/    stockfishWorker      (UCI client + search queue)
  hooks/      usePlayer usePlayerGames useGame useGameNavigation
              useStockfish useGameAnalysis useSettings useLocalStorage
  utils/      chess evaluation uci format routes cn
  types/      chesscom player game analysis
  data/       eco  (bundled opening book)
```

React components render; they do not fetch, parse or evaluate. Every network call,
PGN parse, engine command and scoring decision lives in `services/`, `workers/` or
`utils/`, which is why almost all of it is unit-tested without a DOM.

### Chess.com API layer

Endpoints used (all public, all `GET`):

| Purpose | Endpoint |
| --- | --- |
| Profile | `/pub/player/{username}` |
| Ratings & records | `/pub/player/{username}/stats` |
| Archive index | `/pub/player/{username}/games/archives` |
| Monthly games (incl. PGN) | `/pub/player/{username}/games/{YYYY}/{MM}` |
| Monthly PGN bundle | `/pub/player/{username}/games/{YYYY}/{MM}/pgn` |

The API documents that *serial* access is unlimited while parallel bursts may be answered
with `429`. `services/http.ts` therefore funnels every request through a concurrency limiter
(3 at a time) with exponential backoff on `429`/`5xx`, a hard timeout, and `AbortSignal`
support. Every response is validated before it reaches the UI; malformed payloads raise a
typed `ApiError` rather than crashing a component.

Monthly archives already embed each game's PGN, so opening a game needs no extra request.

### Engine layer

`workers/stockfishWorker.ts` owns the engine worker and speaks UCI. The Stockfish build is
itself a Web Worker, so all search work is off the main thread.

- **Build selection.** `stockfish-18-lite` (multi-threaded) when the page is cross-origin
  isolated, otherwise `stockfish-18-lite-single`. Vite serves `Cross-Origin-Opener-Policy:
  same-origin` and `Cross-Origin-Embedder-Policy: credentialless`, which buys isolation
  without blocking Chess.com avatars. Browsers without `credentialless` fall back cleanly to
  the single-threaded build.
- **One engine, prioritised queue.** A single instance serves both the background full-game
  pass (`Priority.Batch`) and the position the user is looking at (`Priority.Interactive`).
  An interactive request preempts the batch search with `stop`; the interrupted position is
  simply re-queued. One engine means one transposition table and one 7 MB module.
- **`isready` discipline.** Every option change is followed by an `isready`/`readyok` round
  trip before any `position`/`go`. This is not politeness: raising `Threads` makes the WASM
  build spawn pthreads, which it can only finish once its own event loop runs, and firing a
  search in the same tick deadlocks the engine before it emits a single line.
- **Cancellation.** Searches take an `AbortSignal`; changing move, game or page stops the
  engine immediately.

### Analysis pass

`services/gameAnalysis.ts` runs a **single sweep**: position `i` is searched once and its
result supplies both "evaluation before move `i`" and, negated into White's point of view,
"evaluation after move `i-1`". Analysing N moves costs N+1 searches rather than 2N.

- Terminal positions are scored without the engine (engines answer `bestmove (none)`).
- Positions still inside the opening book are searched shallower — their evaluation is not
  in doubt and the user's time is better spent elsewhere.
- Progress and partial evaluations are published as they arrive, so the graph and bar fill
  in live; the loop yields to the event loop between positions.

---

## Scoring model

Everything below is this project's own model. It is documented so it can be judged — and
tuned — on its merits. **It is not Chess.com's algorithm and will not reproduce their numbers.**

### Evaluation conventions

UCI reports scores relative to the side to move. Everything in application state is stored
relative to **White**, because that is what a human reads on a bar or a graph.
`utils/evaluation.ts` converts between the two and is the only place that knows the rule.

Mate scores are kept as `{ type: 'mate', value: n }`. For loss arithmetic they are projected
onto a centipawn axis and clamped to ±1000 cp, so a forced mate cannot make one move
dominate a whole game's statistics.

### Win probability

```
winPct(cp) = 50 + 50 * (2 / (1 + exp(-0.00368208 * cp)) - 1)
```

This logistic model is the one published by the Lichess project, fitted against a large
corpus of real games. Win probability — not raw centipawns — drives the evaluation bar, the
graph's vertical axis and the accuracy model, because it matches how players actually
experience an advantage: very responsive around equality, saturating once a game is decided.

### Per-move accuracy

```
accuracy = clamp(103.1668 * exp(-0.04354 * winProbabilityLost) - 3.1669, 0, 100)
```

An exponential decay in the win probability the move gave away: a 0-point drop scores 100,
a ~10-point drop about 65.

### Game accuracy

Per-move accuracies are combined two ways and averaged:

- a **volatility-weighted mean**, where moves played in sharp positions (a large swing in
  the evaluations around them) count for more — a hard move earns more credit and costs
  more when missed; and
- a **harmonic mean**, which refuses to let one catastrophic move be averaged away by a
  long tail of easy ones.

### Move classification

Thresholds are expressed in **pawns** and every one is editable in the settings panel.

```js
const thresholds = {
  best: 0.05,               // loss at or below this is the engine's move
  excellent: 0.15,
  good: 0.35,
  inaccuracy: 0.5,
  mistake: 1.0,
  blunder: 2.0,
  missedWin: 2.0,           // advantage thrown away to count as a missed win
  brilliantSacrifice: 1.5,  // material that must be offered for a brilliancy
  bookDepth: 16,            // plies of theory to treat as book
  hopeless: 6.0,            // below this the game is already lost
};
```

Decision order — first match wins:

1. **Book** — the position is still inside a known ECO line.
2. **Brilliant** — a genuine material sacrifice the engine endorses (see below).
3. **Missed win** — a forced mate or decisive advantage thrown away, while the resulting
   position is still playable. Throwing away a win *and* ending up lost is a blunder.
4. **Blunder / Mistake / Inaccuracy** — by centipawn loss.
5. **Best / Excellent / Good** — by how close the move is to the engine's choice.

**Hopeless damping.** Once a side is worse than `hopeless` pawns, further drops can no
longer be blunders. Losing a lost game more thoroughly is not a new error.

**Brilliant** is deliberately hard to earn. All of these must hold: real material is
offered (≥ `brilliantSacrifice`), the engine still rates the move within the `excellent`
band, the position stays at least balanced afterwards, the side was not already completely
winning, the move is not forced, and — when MultiPV ≥ 2 — the second-best move is clearly
worse, so the sacrifice was actually necessary.

Material offered is measured two ways and the larger is taken:

- a **static exchange evaluation** on the destination square (what the move captured minus
  what the opponent wins back by starting captures there). An even trade nets zero; `Rxf7`
  answered by `Kxf7` nets four. This also catches *declined* sacrifices, because the offer
  is measured whether or not the engine's line accepts it; and
- the **worst material balance along the engine's principal variation**, which catches
  material given up somewhere other than the square just moved to.

### Explanations

The prose in the move panel is assembled from engine output only — the evaluations, the
centipawn loss, the best move and its principal variation. Nothing is invented and no claim
is made that the engine cannot support.

---

## Opening detection

Two sources, in order of trust:

1. The `ECO`, `ECOUrl` and `Opening` tag pairs Chess.com ships in the PGN. These come from
   their opening database and are authoritative.
2. The bundled ECO table (`src/data/eco.ts`, ~140 mainline openings).

The bundled table is matched **by position, not by move order**. Openings transpose
constantly — `1.c4 g6 2.d4 Bg7 3.Nc3 Nf6` reaches the King's Indian without ever starting
`1.d4` — so every book line is replayed once and indexed by the positions it passes through.
Any move order that reaches a known position is recognised.

If neither source yields a name, the UI says the opening is unknown. It never guesses.

---

## Caching

`services/cache.ts` is a two-tier store: an in-memory map plus `localStorage`, namespaced
and version-stamped so bumping a version invalidates old entries. Writes degrade gracefully —
if storage is full it evicts the oldest entries in that namespace and retries; if storage is
unavailable the memory tier keeps working.

| Store | TTL | Notes |
| --- | --- | --- |
| `profile`, `stats` | 6 h | The API refreshes at most every 12 h |
| `archives` | 3 h | |
| `months` | 3 h | 10 min for the month currently in progress |
| `analysis` | 30 days | Keyed by PGN hash + engine settings + thresholds |

Because the analysis key includes the engine configuration, revisiting a game is instant
while changing the depth correctly triggers a fresh pass.

---

## Performance

- Search runs in a Web Worker; the main thread never blocks.
- One position at a time, with a yield to the event loop between positions.
- Partial evaluations stream into the graph and bar while the pass runs.
- Interactive searches preempt the batch pass, so the board always feels responsive.
- Engine work is cancelled on navigation; completed reviews are cached.
- The game list loads one month at a time and paginates client-side.
- React, chess.js and the app are split into separate chunks; the 7 MB engine is a static
  asset that is never bundled.

Defaults are browser-friendly: depth 14 for the full-game pass, depth 20 for the position on
screen, MultiPV 2, 64 MB hash, and as many threads as the browser allows. A 50-move game
takes roughly 45–60 seconds on a modern laptop with threads available. All of it is
adjustable in the settings panel.

---

## Interface

The analysis page follows the layout conventions players already know, implemented
from scratch — no third-party CSS, icon art, piece sets or brand assets:

- **Name plates above and below the board** carrying avatar, title, rating, captured
  material, material advantage, the clock read from the PGN's `[%clk]` comments, and
  a dot marking whose turn it is. They follow the board when it is flipped.
- **Evaluation bar flush to the board's left edge**, filling from the side that is
  winning and matching the board's height exactly.
- **A classic green-and-cream board** by default (slate, walnut and ocean also ship).
  The board keeps its colours in both light and dark mode, because a board should
  look like a board.
- **A single tabbed side rail** — Moves, Review, Engine, Game — with the selected
  move's feedback pinned above the tabs. The whole workspace fits one desktop screen
  and the move list scrolls inside itself instead of the page growing under it.
- **Round move-quality badges** drawn as a filled circle plus a glyph, used both on
  the board square and in the review breakdown.
- **A review breakdown laid out as two player columns**, so accuracy and every
  move-quality count can be compared by reading across a row.
- A warm charcoal dark theme, chosen because a cool blue-grey washes a green board out.

Plus:

- Full keyboard navigation: `←` `→` previous/next move, `Home`/`End` first/last,
  `Space` play/pause, `F` flip board.
- Click-to-move and drag-and-drop with legal-move highlighting, a promotion picker,
  last-move and check highlighting, and coordinates inside the squares.
- Playing a move that is not the game's own move opens a side line the engine analyses live;
  one click returns to the game.
- On mobile the two columns collapse via `display: contents` and reorder into
  board → controls → analysis → moves → evaluation, with no horizontal overflow.
- Skeletons for every loading state, and typed, human-readable messages for player-not-found,
  empty archives, rate limits, network failures, invalid PGNs and engine start-up failures.
  A render error anywhere is caught by an error boundary rather than blanking the page.

---

## Testing

```bash
npm test
```

250+ tests covering PGN parsing (castling, en passant, promotion, custom `FEN` start,
empty/invalid/incomplete input, clock comments, durations), evaluation conversion and mate
handling, move classification and accuracy, the Chess.com profile/stats/game parsers,
filtering and search, opening detection and transpositions, the ECO table's legality, cache
TTL/versioning/eviction, move navigation and keyboard control, and the UCI protocol —
including a scripted fake engine that exercises queueing, preemption, cancellation and the
`readyok` handshake that the thread-spawn deadlock made necessary.

---

## Limitations

- **Public data only.** Chess.com publishes finished games; games in progress and private
  data are not available. A brand-new account can legitimately return an empty archive.
- **Deep links scan archives.** Without the `?m=YYYY-MM` hint a game id is resolved by
  walking a player's monthly archives newest-first, capped at 36 months.
- **`lite` NNUE network.** The full Stockfish network is ~110 MB and inappropriate to ship
  to a browser; the lite build is a few dozen Elo weaker and far more practical.
- **Single-threaded fallback.** Browsers without `credentialless` COEP support (Safari at
  time of writing) run the single-threaded build, roughly 2–3× slower.
- **Standard chess.** Variants such as Chess960 and bughouse are listed but not analysed.

---

## Licence notes

Stockfish is GPL-3.0; it is shipped unmodified as a static asset and its licence travels
with it. Chess.com data is used through their documented public API. Application code,
design, icons and the opening table are original to this project.
