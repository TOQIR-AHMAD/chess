<div align="center">

# ♟️ Gambit Review

**Review any Chess.com game, move by move — entirely in your browser.**

Search a player, pick a game, get a full Stockfish review: evaluation bar, evaluation graph,
move-by-move classification and an accuracy report.

<img alt="React" src="https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=white">
<img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-6.0-3178C6?logo=typescript&logoColor=white">
<img alt="Vite" src="https://img.shields.io/badge/Vite-8-646CFF?logo=vite&logoColor=white">
<img alt="Stockfish" src="https://img.shields.io/badge/Stockfish-18%20WASM-0F172A">
<img alt="Tests" src="https://img.shields.io/badge/tests-303%20passing-16A34A">

**🔒 No backend · No API key · No account · Nothing uploaded**

</div>

---

## ✨ Features

| | |
| :-- | :-- |
| 🔍 **Player search** | Any Chess.com username — profile, ratings and full public archive |
| 🧠 **Local engine** | Stockfish 18 (WASM) in Web Workers, on your machine |
| 📊 **Evaluation graph** | See exactly where the game turned |
| 🏷️ **Move classification** | Every move labelled, calibrated against Chess.com |
| 🎯 **Accuracy report** | Both sides, with a move-quality breakdown |
| 📖 **Opening detection** | Matched *by position*, so transpositions still resolve |
| ⌨️ **Keyboard driven** | `←` `→` move · `Home`/`End` · `Space` play · `F` flip |
| 🌗 **Light & dark** | Four board themes; the board stays a board in both |

---

## 🚀 Quick start

```bash
npm install     # also copies the Stockfish WASM builds into public/engine
npm run dev     # → http://localhost:5173
npm test        # 303 unit tests
npm run build   # typecheck + production build
```

> `npm install` runs `scripts/copy-engine.mjs`, which copies the engine from
> `node_modules/stockfish` into `public/engine/` (generated, git-ignored).
> Re-run `node scripts/copy-engine.mjs` if it goes missing.

---

## 🏷️ Move classification

Moves are judged on **expected points given away**, not raw centipawn loss — half a pawn
dropped at equality is a real error; the same half pawn dropped while eight pawns down is not.

| | Label | Meaning |
| :-: | :-- | :-- |
| 💎 | **Brilliant** | A sound piece sacrifice the engine endorses |
| ❗ | **Great** | The only move that held the position |
| ⭐ | **Best** | The engine's top choice |
| 🟩 | **Excellent** | Practically as good as the best move |
| ✅ | **Good** | Reasonable — keeps the position |
| 📖 | **Book** | Known opening theory |
| ➡️ | **Forced** | The only legal move |
| ⁉️ | **Inaccuracy** | A small step in the wrong direction |
| ❓ | **Mistake** | Gives away a meaningful part of the advantage |
| 🔻 | **Miss** | A winning continuation was available |
| 💥 | **Blunder** | A serious error that changes the outcome |

<details>
<summary><b>💎 How Brilliant is decided</b></summary>

<br>

Chess.com states four rules for the label, and these are the four implemented:

1. It must be a **good piece sacrifice** — real material, judged after forced recaptures.
2. You must **not be in a bad position after** it.
3. You must **not be completely winning even if you hadn't found it** — a statement about the
   *alternative*, not the position. The evaluation before a move already assumes the best move
   is found, so testing it would reject exactly the sacrifices the label exists for.
4. Criteria are **more lenient for newer players**, scaled by the rating in the PGN.

The thresholds themselves are ours — Chess.com does not publish its cutoffs.

</details>

---

## 🧠 How it works

```
username → profile + archives → game list → PGN → chess.js
        → position list → Stockfish pool → classification → review UI
```

**Single sweep.** Position `i` is searched once and supplies both "evaluation before move `i`"
and, negated, "evaluation after move `i-1`" — so N moves cost N+1 searches, not 2N.

**A review in five seconds, then a better one.** The sweep runs twice. The first pass is bounded
by a *wall-clock budget* rather than a depth — it divides ~5 seconds across the game and adjusts
as it goes — so a complete review, every move labelled and both accuracies computed, is on screen
in about five seconds whatever the machine. The full-depth pass then runs behind it and replaces
what it produced. Only the final review is cached; the provisional one says so on its face.

**An engine pool, not one threaded engine.** A review is a batch of *independent* positions, so
throughput comes from searching several at once rather than throwing threads at one of them.
Lazy SMP scales well under linear; K single-threaded engines scale close to linear. Measured
**~3.3× faster**, and since single-threaded workers need no `SharedArrayBuffer`, it works
without cross-origin isolation too.

**Interactive beats batch.** The position you're looking at preempts the background pass, and a
preempted batch search is *requeued* rather than returned — so where you happened to click can
never fold a shallower evaluation into the review.

**Layering.** Components render; they never fetch, parse or evaluate. Every network call, PGN
parse, engine command and scoring decision lives in `services/`, `workers/` or `utils/` — which
is why nearly all of it is unit-tested without a DOM.

<details>
<summary><b>⚙️ Engine defaults & tuning</b></summary>

<br>

| Setting | Default | Notes |
| :-- | :-- | :-- |
| Batch depth | 18 | Shallowest depth whose labels line up with Chess.com |
| Live depth | 20 | The position on screen |
| Quick first pass | on | ~5 s to a complete provisional review, then refined |
| Parallel searches | cores − 1 | Each engine single-threaded |
| MultiPV | 2 | Needed for *Great* and *Brilliant* |
| Hash | 64 MB | A **total** budget, divided across the pool |

On a 4-core laptop a 51-move game shows its **first review in ~4.5 seconds**; the full depth-18
pass behind it takes ~90 seconds and then replaces it. Turning the quick pass off means waiting
the full 90 for anything at all. Dropping the depth to 14 is roughly 3× faster at some cost in
agreement with Chess.com's labels. All adjustable in the settings panel.

Searched positions are cached in memory for the session, so re-analysis is instant and repeated
openings across a player's games come free.

</details>

<details>
<summary><b>💾 Caching</b></summary>

<br>

Two tiers — an in-memory map plus `localStorage`, namespaced and version-stamped so bumping a
version invalidates old entries. If storage is full it evicts the oldest entries and retries; if
storage is unavailable the memory tier keeps working.

| Store | TTL |
| :-- | :-- |
| `profile`, `stats` | 6 h |
| `archives`, `months` | 3 h (10 min for the month in progress) |
| `analysis` | 30 days — keyed by PGN hash + engine settings + thresholds |

</details>

---

## 🧪 Testing

```bash
npm test
```

303 tests covering PGN parsing (castling, en passant, promotion, clock comments, malformed
input), evaluation and mate handling, classification and accuracy, the Chess.com parsers,
opening detection and transpositions, cache TTL/versioning/eviction, move navigation, the
two-pass review and its time budget — and the UCI protocol, via a scripted fake engine
exercising queueing, preemption and cancellation.

---

## ⚠️ Limitations

- **📡 Public data only** — Chess.com publishes finished games; a new account can legitimately
  return an empty archive.
- **🪶 `lite` NNUE network** — the full network is ~110 MB and inappropriate to ship to a
  browser. Evaluations are a little weaker than Chess.com's server-side full-NNUE review, so the
  two won't agree on every move.
- **♟️ Standard chess** — Chess960 and bughouse are listed but not analysed.
- **🔗 Deep links** — without the `?m=YYYY-MM` hint a game id is resolved by walking monthly
  archives newest-first, capped at 36 months.

---

## 📄 Licence notes

> [!IMPORTANT]
> This is an independent project, **not affiliated with or endorsed by Chess.com**. No Chess.com
> code or data is used. The classification thresholds are deliberately calibrated so a game
> reviewed here carries the same labels as it does there, but evaluations come from a different
> Stockfish build at a different depth — the two will not agree on every move. The accuracy model
> is this project's own and does not reproduce Chess.com's numbers.

Stockfish is **GPL-3.0**, shipped unmodified as a static asset with its licence intact.
Chess.com data is used through their documented [public API](https://www.chess.com/news/view/published-data-api).
Application code, design and the opening table are original to this project.

The move-quality badges in `src/components/chess/classificationArt.ts` are redrawn from
Chess.com's public icon set, used for familiarity rather than to imply association. **If you fork
this for anything public-facing, replace them with your own** — everything else is yours to use.
