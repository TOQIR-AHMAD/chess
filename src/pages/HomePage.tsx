import { usePageTitle } from '@/hooks/useShell';
import { PlayerSearch } from '@/components/player/PlayerSearch';
import { ChessBoard } from '@/components/chess/ChessBoard';
import { ChartIcon, CpuIcon, CrownIcon, SearchIcon } from '@/components/ui/Icons';

/**
 * Each step takes one of the console's four dashboard colours, in its order, so
 * the row reads the way that dashboard's counter cards do.
 */
const STEPS = [
  {
    icon: SearchIcon,
    tint: '#1a5dba',
    title: 'Find a player',
    body: 'Enter any Chess.com username to pull their public profile, ratings and full game archive.',
  },
  {
    icon: CpuIcon,
    tint: '#f59e0b',
    title: 'Run the engine',
    body: 'Stockfish 18 runs in a Web Worker in your browser. Nothing is uploaded and no account is needed.',
  },
  {
    icon: ChartIcon,
    tint: '#2d7fb8',
    title: 'See where it turned',
    body: 'An evaluation graph, move-by-move classifications and the engine’s preferred line for every position.',
  },
  {
    icon: CrownIcon,
    tint: '#16a34a',
    title: 'Get the review',
    body: 'Accuracy for both sides, a move-quality breakdown and the opening actually played.',
  },
];

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

/**
 * Decorative start position. It reuses the analysis board rather than drawing its
 * own squares, so the hero shows the same pieces the app actually plays with —
 * with interaction and coordinates off, since there is nothing here to move.
 */
function HeroBoard() {
  return (
    <div aria-hidden="true" className="overflow-hidden rounded-[3px]">
      <ChessBoard
        fen={START_FEN}
        orientation="white"
        theme="classic"
        interactive={false}
        showCoordinates={false}
        animations={false}
      />
    </div>
  );
}

export function HomePage() {
  usePageTitle('Dashboard');

  return (
    <div className="mx-auto w-full max-w-[1200px] py-4 sm:py-8">
      <div className="grid items-center gap-8 lg:grid-cols-[448px_minmax(0,1fr)] lg:gap-12">
        <div className="mx-auto w-full max-w-[448px]">
          <HeroBoard />
        </div>

        <div>
          <span className="chip surface-raised text-brand-500 mb-4">
            Stockfish 18 · runs in your browser
          </span>
          <h1 className="text-3xl font-bold tracking-tight text-balance sm:text-[44px] sm:leading-[1.1]">
            Review any Chess.com game,
            <span className="text-brand-500"> move by move</span>
          </h1>
          <p className="text-secondary mt-4 max-w-xl text-pretty sm:text-base">
            Search a username, pick a game, and get a full engine review — evaluations, blunders,
            brilliancies and accuracy — without leaving the page.
          </p>

          <div className="mt-6 max-w-xl">
            <PlayerSearch autoFocus size="lg" />
          </div>
        </div>
      </div>

      <div className="mt-14 grid gap-3 sm:grid-cols-2">
        {STEPS.map(({ icon: Icon, title, body, tint }) => (
          <div key={title} className="panel flex items-start gap-3 p-4">
            <span
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[5px]"
              style={{ background: `color-mix(in srgb, ${tint} 20%, transparent)`, color: tint }}
            >
              <Icon size={19} />
            </span>
            <div>
              <h2 className="list-row-title">{title}</h2>
              <p className="list-row-sub mt-0.5 leading-relaxed">{body}</p>
            </div>
          </div>
        ))}
      </div>

    </div>
  );
}
