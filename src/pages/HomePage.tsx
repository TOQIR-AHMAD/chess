import { useLargeTitle, usePageTitle } from '@/hooks/useShell';
import { PlayerSearch } from '@/components/player/PlayerSearch';
import { ChessBoard } from '@/components/chess/ChessBoard';
import { ChartIcon, CpuIcon, CrownIcon, SearchIcon } from '@/components/ui/Icons';

/**
 * Each step wears a Settings-style icon: a rounded square in one of the iOS
 * system colours, lighter at the top, with the glyph in white.
 */
const STEPS = [
  {
    icon: SearchIcon,
    tint: 'linear-gradient(180deg, #47a6ff 0%, #0a6cff 100%)',
    title: 'Find a player',
    body: 'Enter any Chess.com username to pull their public profile, ratings and full game archive.',
  },
  {
    icon: CpuIcon,
    tint: 'linear-gradient(180deg, #ffb340 0%, #ff8a00 100%)',
    title: 'Run the engine',
    body: 'Stockfish 18 runs in a Web Worker in your browser. Nothing is uploaded and no account is needed.',
  },
  {
    icon: ChartIcon,
    tint: 'linear-gradient(180deg, #7d7bf2 0%, #4f4dd6 100%)',
    title: 'See where it turned',
    body: 'An evaluation graph, move-by-move classifications and the engine’s preferred line for every position.',
  },
  {
    icon: CrownIcon,
    tint: 'linear-gradient(180deg, #4cd964 0%, #25a244 100%)',
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
    <div aria-hidden="true">
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

/*
 * The layout follows the room the page has (container queries on the content
 * column), not the size of the window, so it reads the same whether the sidebar
 * is open or not, and on a phone, a laptop or a wide monitor.
 */
export function HomePage() {
  usePageTitle('Gambit Review');
  // The headline is this page's large title: the bar takes the name over once it scrolls away.
  const titleRef = useLargeTitle<HTMLHeadingElement>();

  return (
    <div className="@container mx-auto w-full max-w-[1100px] space-y-10 pt-1 pb-6 sm:pt-6">
      <div className="grid items-center gap-8 @2xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] @2xl:gap-10 @5xl:gap-14">
        <div className="mx-auto w-full max-w-[420px]">
          <HeroBoard />
        </div>

        <div>
          <p className="eyebrow">Stockfish 18 · runs in your browser</p>
          <h1
            ref={titleRef}
            className="mt-2 text-[34px] leading-[1.08] font-bold tracking-[-0.03em] text-balance @2xl:text-[40px] @5xl:text-[48px]"
          >
            Review any Chess.com game, <span className="text-accent">move by move</span>
          </h1>
          <p className="text-secondary mt-4 max-w-xl text-[17px] leading-relaxed text-pretty">
            Search a username, pick a game, and get a full engine review — evaluations, blunders,
            brilliancies and accuracy — without leaving the page.
          </p>

          <div className="mt-6 max-w-xl">
            <PlayerSearch autoFocus size="lg" />
          </div>
        </div>
      </div>

      <div className="grid gap-3 @2xl:grid-cols-2">
        {STEPS.map(({ icon: Icon, title, body, tint }) => (
          <div key={title} className="panel flex items-start gap-3.5 p-4">
            <span className="cell-icon h-10 w-10 rounded-[10px]" style={{ background: tint }}>
              <Icon size={21} />
            </span>
            <div className="min-w-0">
              <h2 className="text-[17px] font-semibold tracking-[-0.02em]">{title}</h2>
              <p className="text-muted mt-0.5 text-[15px] leading-snug">{body}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
