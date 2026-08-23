import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Chess } from 'chess.js';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import type { Score } from '@/types/analysis';
import type { Color, ParsedMove } from '@/types/game';
import { useGame } from '@/hooks/useGame';
import { useGameAnalysis } from '@/hooks/useGameAnalysis';
import { useGameNavigation } from '@/hooks/useGameNavigation';
import { useSettings } from '@/hooks/useSettings';
import { usePageTitle } from '@/hooks/useShell';
import { useStockfish } from '@/hooks/useStockfish';
import { usePlayerAvatars } from '@/hooks/usePlayerAvatars';
import { ChessBoard, type BoardMove } from '@/components/chess/ChessBoard';
import { PlayerStrip } from '@/components/chess/PlayerStrip';
import { EvaluationBar } from '@/components/chess/EvaluationBar';
import { GameControls } from '@/components/chess/GameControls';
import { MoveList } from '@/components/chess/MoveList';
import { AnalysisPanel } from '@/components/chess/AnalysisPanel';
import { EnginePanel } from '@/components/chess/EnginePanel';
import { GameInfo } from '@/components/chess/GameInfo';
import { GameReviewPanel } from '@/components/chess/GameReviewPanel';
import { EngineSettings } from '@/components/chess/EngineSettings';
import { Panel } from '@/components/ui/Panel';
import { ErrorState, ProgressBar, RetryButton, Skeleton, Spinner } from '@/components/ui/Feedback';
import {
  ChevronLeft,
  ChevronRight,
  SettingsIcon,
  StopIcon,
  CpuIcon,
  CrownIcon,
  InfoIcon,
  ListIcon,
} from '@/components/ui/Icons';
import { detectOpening } from '@/services/openings';
import { PgnError } from '@/services/pgnParser';
import { toWhitePov } from '@/utils/evaluation';
import { materialSnapshot, sideToMove } from '@/utils/chess';
import { analysisPath, playerPath } from '@/utils/routes';
import { cn } from '@/utils/cn';

/**
 * Width of the evaluation column (22px bar + 6px gap). The name plates are indented
 * by it so they line up with the board's edges rather than the bar's.
 */
const EVAL_COLUMN_OFFSET = 'pl-[28px]';

type RailTab = 'moves' | 'review' | 'engine' | 'info';

const RAIL_TABS: Array<{ key: RailTab; label: string; icon: typeof ListIcon }> = [
  { key: 'moves', label: 'Moves', icon: ListIcon },
  { key: 'review', label: 'Review', icon: CrownIcon },
  { key: 'engine', label: 'Engine', icon: CpuIcon },
  { key: 'info', label: 'Game', icon: InfoIcon },
];

/**
 * Analysis workspace.
 *
 * Three sources of evaluation feed the UI and they are deliberately layered:
 *   1. the completed full-game review (authoritative, cached),
 *   2. partial evaluations streaming in while that pass runs,
 *   3. the live search of the position on screen, which always wins for the
 *      board itself because it is the deepest look at *this* position.
 */
export function GameAnalysisPage() {
  const { username = '', gameId = '' } = useParams<{ username: string; gameId: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const settings = useSettings();

  const { game, parsed, siblings, loading, error, reload, scanned } = useGame(
    username,
    gameId,
    searchParams.get('m'),
  );

  const viewerColor: Color = game?.playerColor ?? 'white';
  const nav = useGameNavigation(parsed, viewerColor);

  const analysis = useGameAnalysis(
    parsed,
    game?.pgn ?? null,
    settings.engine,
    settings.thresholds,
    settings.autoAnalyse,
  );

  // Moves the user plays on the board that are not part of the game.
  const [exploration, setExploration] = useState<ParsedMove[]>([]);
  const [showSettings, setShowSettings] = useState(false);
  const [tab, setTab] = useState<RailTab>('moves');
  const boardWrapRef = useRef<HTMLDivElement>(null);

  // Leaving the position resets any side line.
  useEffect(() => setExploration([]), [nav.index, parsed]);

  const displayFen = exploration.length > 0 ? exploration[exploration.length - 1].fenAfter : nav.fen;
  const exploring = exploration.length > 0;

  const live = useStockfish(displayFen, settings.engine, true);

  // The navbar names the page; the tab title carries the two players as well.
  usePageTitle(game ? `${game.white.username} vs ${game.black.username}` : 'Game Analysis');

  useEffect(() => {
    document.title = game ? `${game.white.username} vs ${game.black.username} — Gambit Review` : 'Analysis — Gambit Review';
    return () => {
      document.title = 'Gambit Review — Chess Game Analysis';
    };
  }, [game]);

  const opening = useMemo(
    () => (parsed ? detectOpening(parsed.moves.map((move) => move.san), parsed.headers) : null),
    [parsed],
  );

  const currentMoveAnalysis = useMemo(() => {
    if (!analysis.review || nav.index === 0) return null;
    return analysis.review.moves[nav.index - 1] ?? null;
  }, [analysis.review, nav.index]);

  /** Score shown on the bar: the live search when exploring, else the review pass. */
  const barScore: Score | null = useMemo(() => {
    if (exploring || !analysis.review) {
      const top = live.lines[0];
      if (top) return toWhitePov(top.score, sideToMove(displayFen));
    }
    if (analysis.evaluations.length > nav.index) return analysis.evaluations[nav.index];
    return null;
  }, [analysis.evaluations, analysis.review, displayFen, exploring, live.lines, nav.index]);

  const lastMove = useMemo(() => {
    if (exploring) {
      const move = exploration[exploration.length - 1];
      return { from: move.from, to: move.to };
    }
    if (!parsed || nav.index === 0) return null;
    const move = parsed.moves[nav.index - 1];
    return move ? { from: move.from, to: move.to } : null;
  }, [exploration, exploring, nav.index, parsed]);

  const bestMoveArrow = useMemo(() => {
    if (!settings.showBestMoveArrow) return null;
    const uci = live.lines[0]?.pv[0];
    if (!uci) return null;
    return { from: uci.slice(0, 2), to: uci.slice(2, 4) };
  }, [live.lines, settings.showBestMoveArrow]);

  /** Apply a legal move played on the board. */
  const handleBoardMove = useCallback(
    (move: BoardMove): boolean => {
      const chess = new Chess();
      try {
        chess.load(displayFen);
      } catch {
        return false;
      }

      let result;
      try {
        result = chess.move({ from: move.from, to: move.to, promotion: move.promotion });
      } catch {
        return false;
      }
      if (!result) return false;

      // Replaying the game's own next move just advances the board.
      if (!exploring && parsed && nav.index < parsed.moves.length && parsed.moves[nav.index].san === result.san) {
        nav.stop();
        nav.next();
        return true;
      }

      setExploration((prev) => [
        ...prev,
        {
          ply: (prev[prev.length - 1]?.ply ?? nav.index - 1) + 1,
          moveNumber: Number.parseInt(result.before.split(' ')[5] ?? '1', 10) || 1,
          color: result.color === 'w' ? 'white' : 'black',
          san: result.san,
          uci: result.lan,
          from: result.from,
          to: result.to,
          piece: result.piece,
          captured: result.captured,
          promotion: result.promotion,
          fenBefore: result.before,
          fenAfter: result.after,
          clockSeconds: null,
          secondsSpent: null,
          check: result.san.includes('+'),
          mate: result.san.includes('#'),
        },
      ]);
      return true;
    },
    [displayFen, exploring, nav, parsed],
  );

  /** Play an engine principal variation out on the board. */
  const playEngineLine = useCallback(
    (uciMoves: string[]) => {
      const chess = new Chess();
      try {
        chess.load(displayFen);
      } catch {
        return;
      }
      const added: ParsedMove[] = [];
      for (const uci of uciMoves.slice(0, 6)) {
        let result;
        try {
          result = chess.move({
            from: uci.slice(0, 2),
            to: uci.slice(2, 4),
            promotion: uci.length > 4 ? uci[4] : undefined,
          });
        } catch {
          break;
        }
        if (!result) break;
        added.push({
          ply: (added[added.length - 1]?.ply ?? nav.index - 1) + 1,
          moveNumber: Number.parseInt(result.before.split(' ')[5] ?? '1', 10) || 1,
          color: result.color === 'w' ? 'white' : 'black',
          san: result.san,
          uci: result.lan,
          from: result.from,
          to: result.to,
          piece: result.piece,
          captured: result.captured,
          promotion: result.promotion,
          fenBefore: result.before,
          fenAfter: result.after,
          clockSeconds: null,
          secondsSpent: null,
          check: result.san.includes('+'),
          mate: result.san.includes('#'),
        });
      }
      if (added.length > 0) setExploration((prev) => [...prev, ...added]);
    },
    [displayFen, nav.index],
  );

  const avatars = usePlayerAvatars([game?.white.username, game?.black.username]);

  /** Material captured by each side in the position on the board. */
  const material = useMemo(() => materialSnapshot(displayFen), [displayFen]);

  /** Each side's clock as of the current position, from the PGN clock comments. */
  const clocks = useMemo(() => {
    const latest: Record<Color, number | null> = { white: null, black: null };
    if (!parsed) return latest;
    for (let i = 0; i < Math.min(nav.index, parsed.moves.length); i += 1) {
      const move = parsed.moves[i];
      if (move?.clockSeconds !== null && move?.clockSeconds !== undefined) {
        latest[move.color] = move.clockSeconds;
      }
    }
    return latest;
  }, [parsed, nav.index]);

  const turn = sideToMove(displayFen) === 'w' ? 'white' : 'black';

  /** Name plate for one side, resolved from the game and the current position. */
  const stripFor = useCallback(
    (side: Color) => {
      if (!game) return null;
      const player = side === 'white' ? game.white : game.black;
      const outcome = game.outcome;
      const result =
        outcome === '1/2-1/2'
          ? ('½' as const)
          : outcome === '*'
            ? null
            : (outcome === '1-0') === (side === 'white')
              ? ('1' as const)
              : ('0' as const);

      return {
        side,
        name: player.username,
        rating: player.rating,
        avatar: avatars[player.username.toLowerCase()] ?? null,
        captured: side === 'white' ? material.capturedByWhite : material.capturedByBlack,
        advantage: side === 'white' ? material.diff : -material.diff,
        clockSeconds: clocks[side],
        toMove: turn === side,
        result,
      };
    },
    [avatars, clocks, game, material, turn],
  );

  // The board's orientation decides which plate goes above and which below.
  const bottomStrip = stripFor(nav.orientation);
  const topStrip = stripFor(nav.orientation === 'white' ? 'black' : 'white');

  // Previous / next game within the same month.
  const { previousGame, nextGame } = useMemo(() => {
    const index = siblings.findIndex((entry) => entry.id === gameId);
    if (index === -1) return { previousGame: null, nextGame: null };
    return {
      previousGame: index > 0 ? siblings[index - 1] : null,
      nextGame: index < siblings.length - 1 ? siblings[index + 1] : null,
    };
  }, [gameId, siblings]);

  if (loading) return <AnalysisSkeleton scanned={scanned} />;

  if (error || !game || !parsed) {
    const isPgnError = error instanceof PgnError;
    return (
      <div className="mx-auto max-w-xl py-12">
        <ErrorState
          title={isPgnError ? 'This game cannot be analysed' : 'Could not load this game'}
          description={
            error && 'userMessage' in error
              ? error.userMessage
              : 'The game could not be found in this player’s archives.'
          }
          action={
            <div className="flex gap-2">
              <RetryButton onClick={reload} />
              <Link to={playerPath(username)} className="btn btn-ghost">
                Back to games
              </Link>
            </div>
          }
        />
      </div>
    );
  }

  const analysing = analysis.running;
  const progress = analysis.progress;

  return (
    /* Flush: the workspace runs edge to edge, without the console's side inset. */
    <div className="page-flush w-full">
      {/* Sub-header: navigation between games. */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Link to={playerPath(username)} className="btn btn-ghost h-8 px-2.5 text-xs">
          <ChevronLeft size={14} />
          {username}’s games
        </Link>

        <div className="ml-auto flex items-center gap-1.5">
          <button
            type="button"
            className="btn btn-ghost h-8 px-2.5 text-xs"
            disabled={!previousGame}
            onClick={() => previousGame && navigate(analysisPath(username, previousGame))}
            title="Newer game"
          >
            <ChevronLeft size={14} />
            Newer
          </button>
          <button
            type="button"
            className="btn btn-ghost h-8 px-2.5 text-xs"
            disabled={!nextGame}
            onClick={() => nextGame && navigate(analysisPath(username, nextGame))}
            title="Older game"
          >
            Older
            <ChevronRight size={14} />
          </button>
          <button
            type="button"
            className={cn('btn h-8 w-8 p-0', showSettings ? 'btn-primary' : 'btn-ghost')}
            onClick={() => setShowSettings((value) => !value)}
            title="Engine and board settings"
            aria-label="Settings"
            aria-expanded={showSettings}
          >
            <SettingsIcon size={15} />
          </button>
        </div>
      </div>

      {/* Analysis progress. */}
      {(analysing || progress.phase === 'error') && (
        <div className="panel mb-3 flex flex-wrap items-center gap-3 px-4 py-2.5">
          {analysing ? <Spinner size={14} className="text-accent" /> : <CpuIcon size={15} className="text-danger" />}
          <span className="text-sm">
            {progress.phase === 'error' ? (progress.error ?? 'Analysis failed') : progress.message || 'Preparing…'}
          </span>
          {analysing && (
            <>
              <ProgressBar value={progress.percent} className="max-w-64 flex-1" />
              <span className="text-muted font-mono text-xs tabular-nums">{progress.percent}%</span>
              <button type="button" className="btn btn-ghost h-7 px-2 text-xs" onClick={analysis.cancel}>
                <StopIcon size={12} />
                Stop
              </button>
            </>
          )}
          {progress.phase === 'error' && (
            <button type="button" className="btn btn-subtle h-7 px-2 text-xs" onClick={analysis.start}>
              Try again
            </button>
          )}
        </div>
      )}

      {!analysing && !analysis.review && progress.phase !== 'error' && (
        <div className="panel mb-3 flex flex-wrap items-center gap-3 px-4 py-2.5">
          <CpuIcon size={15} className="text-accent" />
          <span className="text-secondary text-sm">
            This game has not been reviewed yet.
          </span>
          <button type="button" className="btn btn-primary ml-auto h-7 px-3 text-xs" onClick={analysis.start}>
            Analyse game
          </button>
        </div>
      )}

      {/*
        On mobile the two columns collapse with `display: contents`, so every panel
        becomes a direct flex item and `order-*` can interleave them into the
        reading order a phone wants: board, controls, evaluation, moves, analysis.
        From `lg` up the wrappers become real columns again and order is ignored.
      */}
      <div className="flex flex-col gap-3 lg:grid lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start xl:grid-cols-[minmax(0,1fr)_400px]">
        {/* ---------------- Board column ---------------- */}
        <div className="contents lg:block lg:w-full lg:min-w-0 lg:space-y-3">
          {/*
            The board takes the whole column. From `lg` up it also has to fit the
            viewport height — it sits beside the rail there, and being square, an
            unbounded width would push the bottom name plate off the screen. In
            the stacked layout below `lg` the page scrolls anyway, so the board
            simply takes the full width.
          */}
          <div ref={boardWrapRef} className="order-1 w-full lg:max-w-[min(calc(100dvh-12rem),1100px)]">
            {topStrip && (
              <PlayerStrip
                {...topStrip}
                avatar={topStrip.avatar}
                clockSeconds={topStrip.clockSeconds}
                className={EVAL_COLUMN_OFFSET}
              />
            )}

            <div className="flex items-stretch gap-1.5">
              <EvaluationBar
                score={barScore}
                orientation={nav.orientation}
                pending={barScore === null && live.running}
              />
              <div className="min-w-0 flex-1">
                <ChessBoard
                  fen={displayFen}
                  orientation={nav.orientation}
                  lastMove={lastMove}
                  bestMove={bestMoveArrow}
                  badge={!exploring && currentMoveAnalysis ? currentMoveAnalysis.classification : null}
                  onMove={handleBoardMove}
                  theme={settings.boardTheme}
                  showCoordinates={settings.showCoordinates}
                  animations={settings.animations}
                />
              </div>
            </div>

            {bottomStrip && (
              <PlayerStrip
                {...bottomStrip}
                avatar={bottomStrip.avatar}
                clockSeconds={bottomStrip.clockSeconds}
                className={EVAL_COLUMN_OFFSET}
              />
            )}
          </div>

          {exploring && (
            <div className="panel border-brand-500/40 order-2 flex items-center gap-2 px-3 py-2 text-xs">
              <span className="text-accent font-semibold">Exploring a variation</span>
              <span className="text-muted">
                {exploration.length} move{exploration.length === 1 ? '' : 's'} from the game position
              </span>
              <button
                type="button"
                className="btn btn-ghost ml-auto h-7 px-2 text-xs"
                onClick={() => setExploration([])}
              >
                Back to the game
              </button>
            </div>
          )}

          <Panel flush className="order-3">
            <div className="px-3 py-2.5">
              <GameControls nav={nav} totalMoves={parsed.moves.length} />
            </div>
          </Panel>
        </div>

        {/*
          Side rail. One panel with a tab bar rather than five stacked cards: on a
          desktop screen the whole workspace now fits without scrolling, and the
          move list keeps its own scroll instead of the page growing under it.
        */}
        <div className="panel order-4 flex min-h-0 flex-col lg:sticky lg:top-[4.25rem] lg:order-none lg:max-h-[calc(100dvh-5.25rem)]">
          {showSettings ? (
            <>
              <div className="panel-header shrink-0">
                <h2 className="panel-title">Settings</h2>
                <button
                  type="button"
                  className="btn btn-ghost h-7 px-2 text-xs"
                  onClick={() => setShowSettings(false)}
                >
                  Done
                </button>
              </div>
              <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
                <EngineSettings onConfigChange={analysis.reset} />
              </div>
            </>
          ) : (
            <>
              {/* Feedback on the selected move stays visible above every tab. */}
              <div className="shrink-0">
                <AnalysisPanel
                  move={exploring ? null : currentMoveAnalysis}
                  fenBefore={nav.index > 0 ? parsed.positions[nav.index - 1] : null}
                  analysing={analysing}
                />
              </div>

              <div className="panel-header shrink-0 justify-center">
                <h2 className="panel-title flex items-center gap-2 normal-case">
                  <CpuIcon size={17} className="text-brand-500" />
                  Analysis
                </h2>
              </div>

              <div role="tablist" aria-label="Analysis panels" className="flex shrink-0">
                {RAIL_TABS.map((entry) => (
                  <button
                    key={entry.key}
                    type="button"
                    role="tab"
                    aria-selected={tab === entry.key}
                    className="tab tab-stacked"
                    onClick={() => setTab(entry.key)}
                  >
                    <entry.icon size={17} aria-hidden="true" />
                    {entry.label}
                  </button>
                ))}
              </div>

              <div className="scroll-thin min-h-0 flex-1 overflow-y-auto" role="tabpanel">
                {tab === 'moves' && (
                  <MoveList
                    moves={parsed.moves}
                    analysis={analysis.review?.moves ?? null}
                    index={nav.index}
                    onSelect={(index) => {
                      nav.stop();
                      setExploration([]);
                      nav.goTo(index);
                    }}
                    exploration={exploration}
                    onExitExploration={() => setExploration([])}
                    openingName={opening?.name ?? null}
                    className="h-full"
                  />
                )}

                {tab === 'review' &&
                  (analysis.review ? (
                    <GameReviewPanel
                      review={analysis.review}
                      moves={analysis.review.moves}
                      whiteName={game.white.username}
                      blackName={game.black.username}
                      onSelectPly={(index) => {
                        nav.stop();
                        nav.goTo(index);
                      }}
                    />
                  ) : (
                    <p className="text-muted px-4 py-8 text-center text-sm">
                      {analysing ? 'The review appears here once the pass finishes.' : 'This game has not been reviewed yet.'}
                    </p>
                  ))}

                {tab === 'engine' && (
                  <EnginePanel fen={displayFen} live={live} onPlayLine={playEngineLine} />
                )}

                {tab === 'info' && <GameInfo game={game} parsed={parsed} opening={opening} />}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function AnalysisSkeleton({ scanned }: { scanned: number }) {
  return (
    <div className="w-full">
      <div className="mb-3 flex items-center gap-2">
        <Skeleton className="h-8 w-32" />
        <Skeleton className="ml-auto h-8 w-40" />
      </div>
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_380px] xl:grid-cols-[minmax(0,1fr)_420px]">
        <div className="space-y-3">
          <div className="flex justify-center gap-3">
            <Skeleton className="h-[min(72vh,780px)] w-7" />
            <Skeleton className="aspect-square w-full max-w-[min(72vh,780px)]" />
          </div>
          <Skeleton className="h-14" />
          <Skeleton className="h-36" />
        </div>
        <div className="space-y-3">
          <Skeleton className="h-40" />
          <Skeleton className="h-32" />
          <Skeleton className="h-64" />
        </div>
      </div>
      <p className="text-muted mt-4 text-center text-xs">
        {scanned > 1 ? `Searching monthly archives (${scanned} checked)…` : 'Loading the game…'}
      </p>
    </div>
  );
}
