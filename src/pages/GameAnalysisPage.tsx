import { useCallback, useEffect, useMemo, useState } from 'react';
import { Chess, type Move } from 'chess.js';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import type { Score } from '@/types/analysis';
import type { Color, ParsedMove } from '@/types/game';
import { useGame } from '@/hooks/useGame';
import { useGameAnalysis } from '@/hooks/useGameAnalysis';
import { useGameNavigation } from '@/hooks/useGameNavigation';
import { useElementSize } from '@/hooks/useElementSize';
import { useIsDesktop } from '@/hooks/useMediaQuery';
import { useSettings } from '@/hooks/useSettings';
import { NavbarActions, usePageTitle } from '@/hooks/useShell';
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
import { ErrorState, ProgressBar, RetryButton, Skeleton, Spinner } from '@/components/ui/Feedback';
import { SettingsIcon, CpuIcon, CrownIcon, InfoIcon, ListIcon } from '@/components/ui/Icons';
import { detectOpening } from '@/services/openings';
import { PgnError } from '@/services/pgnParser';
import { toWhitePov } from '@/utils/evaluation';
import { materialSnapshot, sideToMove } from '@/utils/chess';
import { playerPath } from '@/utils/routes';
import { cn } from '@/utils/cn';

/**
 * Width of the evaluation column (42px bar + 6px gap). The name plates are pushed
 * clear of it by a margin, so their outline starts at the board's own left edge.
 */
const EVAL_COLUMN_OFFSET = 'ml-[48px]';
const EVAL_COLUMN_WIDTH = 48;

/** A name plate is `h-9`, border included; the board leaves room for two of them. */
const STRIP_HEIGHT = 36;

/**
 * Turn a chess.js move into the same shape the PGN parser produces, so a move the
 * user played and a move from the game are interchangeable everywhere downstream.
 * The clock fields are null by design: a move that was never played has no clock.
 */
function toParsedMove(result: Move, previousPly: number): ParsedMove {
  return {
    ply: previousPly + 1,
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
  };
}

/**
 * Play one move onto a FEN, accepting either notation. Engine principal
 * variations arrive as UCI and the stored review lines as SAN, and a line worth
 * stepping through can come from either — so both are tried rather than making
 * every caller convert first. Null when the move does not fit the position.
 */
function playMove(fen: string, move: string): Move | null {
  const chess = new Chess();
  try {
    chess.load(fen);
  } catch {
    return null;
  }
  try {
    const san = chess.move(move);
    if (san) return san;
  } catch {
    // Not SAN — fall through and read it as UCI.
  }
  try {
    return (
      chess.move({
        from: move.slice(0, 2),
        to: move.slice(2, 4),
        promotion: move.length > 4 ? move[4] : undefined,
      }) ?? null
    );
  } catch {
    return null;
  }
}

/** Below this the board stops shrinking and the stage scrolls instead. */
const MIN_BOARD_SIZE = 220;

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
  const settings = useSettings();

  const { game, parsed, loading, error, reload, scanned } = useGame(
    username,
    gameId,
    searchParams.get('m'),
  );

  const viewerColor: Color = game?.playerColor ?? 'white';
  // `?ply=` opens the game at a given position, e.g. a mistake linked from the insights report.
  const plyParam = Number.parseInt(searchParams.get('ply') ?? '', 10);
  const nav = useGameNavigation(parsed, viewerColor, Number.isFinite(plyParam) ? plyParam : 0);

  const analysis = useGameAnalysis(
    parsed,
    game?.pgn ?? null,
    settings.engine,
    settings.thresholds,
    settings.autoAnalyse,
  );

  // Moves the user plays on the board that are not part of the game.
  const [exploration, setExploration] = useState<ParsedMove[]>([]);
  /** An engine line being walked one move at a time, and how deep the side line already was. */
  const [stepper, setStepper] = useState<{ line: string[]; base: number } | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [tab, setTab] = useState<RailTab>('moves');

  /*
   * The board is sized from the box it sits in rather than from the width alone:
   * on a desktop screen the workspace is locked to the viewport, so the square
   * has to take the smaller of the room left across and the room left down.
   */
  const [stageRef, stage] = useElementSize<HTMLDivElement>();
  // The playback controls sit in the stage, directly under the board and exactly
  // as wide, so they move with it; the board leaves room for them — measured,
  // not assumed.
  const [controlsRef, controlsBox] = useElementSize<HTMLDivElement>();
  const fitViewport = useIsDesktop();

  const boardSize = useMemo(() => {
    if (stage.width === 0) return null;
    const byWidth = stage.width - EVAL_COLUMN_WIDTH;
    // Stacked layout: the page scrolls, so only the width constrains the board.
    if (!fitViewport) return Math.max(MIN_BOARD_SIZE, byWidth);
    const byHeight = stage.height - 2 * STRIP_HEIGHT - controlsBox.height;
    return Math.max(MIN_BOARD_SIZE, Math.min(byWidth, byHeight));
  }, [controlsBox.height, fitViewport, stage.height, stage.width]);

  // Leaving the position resets any side line, and the walk through it.
  useEffect(() => {
    setExploration([]);
    setStepper(null);
  }, [nav.index, parsed]);

  const displayFen = exploration.length > 0 ? exploration[exploration.length - 1].fenAfter : nav.fen;
  const exploring = exploration.length > 0;

  const live = useStockfish(displayFen, settings.engine, true);

  // The bar names the page and offers the way back to the player's games; the
  // tab title carries the two players as well.
  usePageTitle(game ? `${game.white.username} vs ${game.black.username}` : 'Game Analysis', {
    to: playerPath(username),
    label: username,
  });

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

      // A move of the user's own ends any line they were stepping through.
      setStepper(null);
      setExploration((prev) => [...prev, toParsedMove(result, prev[prev.length - 1]?.ply ?? nav.index - 1)]);
      return true;
    },
    [displayFen, exploring, nav, parsed],
  );

  /** Play an engine principal variation out on the board, all at once. */
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
        added.push(toParsedMove(result, added[added.length - 1]?.ply ?? nav.index - 1));
      }
      if (added.length > 0) {
        setStepper(null);
        setExploration((prev) => [...prev, ...added]);
      }
    },
    [displayFen, nav.index],
  );

  /** Append one move of a line to the side variation on the board. */
  const applyMove = useCallback(
    (move: string) => {
      setExploration((prev) => {
        const from = prev.length > 0 ? prev[prev.length - 1].fenAfter : nav.fen;
        const result = playMove(from, move);
        if (!result) return prev;
        return [...prev, toParsedMove(result, prev[prev.length - 1]?.ply ?? nav.index - 1)];
      });
    },
    [nav.fen, nav.index],
  );

  /**
   * Begin walking a line one move at a time. `base` remembers how deep the side
   * variation already was, so the counter reads as the line's own move numbers
   * even when the walk starts from a position the user had explored to.
   */
  const stepEngineLine = useCallback(
    (moves: string[]) => {
      if (moves.length === 0) return;
      setStepper({ line: moves, base: exploration.length });
      applyMove(moves[0]);
    },
    [applyMove, exploration.length],
  );

  const stepsTaken = stepper ? exploration.length - stepper.base : 0;
  const stepsLeft = stepper ? stepper.line.length - stepsTaken : 0;

  /**
   * A forced mate in the position on the board, from the live search. Drives the
   * banner above the board: a mate is the one thing worth interrupting the page
   * to announce, and the one line worth reading move by move to the end.
   */
  const mate = useMemo(() => {
    // The live search first: it is looking at the position actually on the board.
    const top = live.lines[0];
    if (top && top.score.type === 'mate' && top.score.value !== 0 && top.pv.length > 0) {
      const white = toWhitePov(top.score, sideToMove(displayFen));
      return { moves: Math.abs(top.score.value), winner: white.value > 0 ? 'White' : 'Black', line: top.pv };
    }

    // Otherwise the completed review, which searched this position with the whole
    // game's transposition table behind it and so often proved a mate the live
    // search has not reached. Only valid on a game position, not a side line.
    if (exploring) return null;
    const stored = analysis.evaluations[nav.index];
    if (!stored || stored.type !== 'mate' || stored.value === 0) return null;
    // The move played *from* this position carries the engine's line out of it.
    const line = analysis.review?.moves[nav.index]?.bestLine ?? [];
    if (line.length === 0) return null;
    return { moves: Math.abs(stored.value), winner: stored.value > 0 ? 'White' : 'Black', line };
  }, [analysis.evaluations, analysis.review, displayFen, exploring, live.lines, nav.index]);

  const stepForward = useCallback(() => {
    if (!stepper) return;
    const next = stepper.line[exploration.length - stepper.base];
    if (next) applyMove(next);
  }, [applyMove, exploration.length, stepper]);

  const stepBack = useCallback(() => {
    setExploration((prev) => (prev.length > 0 ? prev.slice(0, -1) : prev));
  }, []);

  /** Leave the side line entirely and return to the game. */
  const exitExploration = useCallback(() => {
    setExploration([]);
    setStepper(null);
  }, []);

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
  // Whether the per-move card above the tabs has anything to show (it renders nothing otherwise).
  const feedbackShown = (!exploring && currentMoveAnalysis !== null) || analysing;

  return (
    /*
      Flush: the workspace runs edge to edge, without the console's side inset.
      Fit: from `lg` up the whole page is exactly one viewport tall — nothing here
      scrolls the window, the move list and the rail scroll inside themselves.
    */
    <div className="page-flush page-fit flex w-full flex-col lg:h-full lg:min-h-0">
      {/* Engine and board settings live in the bar, beside the shell's own buttons. */}
      <NavbarActions>
        <button
          type="button"
          className="navbar-btn"
          data-active={showSettings ? 'true' : 'false'}
          onClick={() => setShowSettings((value) => !value)}
          title="Engine and board settings"
          aria-label="Engine and board settings"
          aria-expanded={showSettings}
        >
          <SettingsIcon size={19} />
        </button>
      </NavbarActions>

      {/* Analysis progress, as an inline banner above the workspace. */}
      {(analysing || progress.phase === 'error') && (
        <div className="panel mb-2 flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1.5 py-2 pr-2 pl-4">
          {analysing ? <Spinner size={16} className="text-muted" /> : <CpuIcon size={16} className="text-danger" />}
          {/*
            Once the quick pass has landed, the rail is already full of labels and
            accuracy. Say so, or the running bar reads as "nothing is ready yet".
          */}
          {analysis.preliminary && analysing && (
            <span className="chip bg-accent-soft text-accent shrink-0">Quick review ready</span>
          )}
          <span className="text-[14px]">
            {progress.phase === 'error' ? (progress.error ?? 'Analysis failed') : progress.message || 'Preparing…'}
          </span>
          {analysing && (
            <>
              <ProgressBar value={progress.percent} className="max-w-64 min-w-16 flex-1" />
              <span className="text-muted text-[13px] tabular-nums">{progress.percent}%</span>
              <button type="button" className="btn btn-ghost h-8 px-3 text-[14px]" onClick={analysis.cancel}>
                Stop
              </button>
            </>
          )}
          {progress.phase === 'error' && (
            <button type="button" className="btn btn-subtle h-8 px-3 text-[13px]" onClick={analysis.start}>
              Try again
            </button>
          )}
        </div>
      )}

      {!analysing && !analysis.review && progress.phase !== 'error' && (
        <div className="panel mb-2 flex shrink-0 flex-wrap items-center gap-3 py-2 pr-2 pl-3">
          <span className="cell-icon h-7 w-7 rounded-[7px] bg-[linear-gradient(180deg,#47a6ff_0%,#0a6cff_100%)]">
            <CpuIcon size={15} />
          </span>
          <span className="text-secondary text-[14px]">This game has not been reviewed yet.</span>
          <button type="button" className="btn btn-primary ml-auto h-8 px-4 text-[14px]" onClick={analysis.start}>
            Analyse game
          </button>
        </div>
      )}

      {/*
        On mobile the two columns collapse with `display: contents`, so every panel
        becomes a direct flex item and `order-*` can interleave them into the
        reading order a phone wants: board and controls, then the analysis rail.
        From `lg` up the wrappers become real columns again and order is ignored.
      */}
      {/*
        The board is bounded by the viewport's height, not by this column, so on a
        wide screen there is width it cannot use. The rail takes it: it grows with
        the viewport between 360px and 520px instead of leaving bare slate.
      */}
      <div className="flex flex-col gap-2 lg:grid lg:min-h-0 lg:flex-1 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-stretch xl:grid-cols-[minmax(0,1fr)_clamp(360px,24vw,520px)]">
        {/* ---------------- Board column ---------------- */}
        <div className="contents lg:flex lg:min-h-0 lg:w-full lg:min-w-0 lg:flex-col">
          {/*
            The board's card: the name plates, the board and the controls on one
            surface, running the column's full height level with the analysis card
            beside it. The board itself stays square and unframed on it.
          */}
          <div className="panel order-1 flex min-h-0 flex-col p-2 sm:p-3 lg:flex-1">
            {/*
              The stage is the room the board is allowed to take — the whole card,
              inside its padding. The square is measured from it, the smaller of its
              width and of its height less the name plates and the controls, so
              neither the bottom name plate nor the controls can fall off the screen.
            */}
            <div
              ref={stageRef}
              className="flex w-full min-h-0 flex-1 items-center justify-center overflow-hidden"
            >
              <div
                className="w-full max-w-full"
                style={boardSize !== null ? { width: boardSize + EVAL_COLUMN_WIDTH } : undefined}
              >
                {topStrip && (
                  <PlayerStrip
                    {...topStrip}
                    avatar={topStrip.avatar}
                    clockSeconds={topStrip.clockSeconds}
                    className={EVAL_COLUMN_OFFSET}
                  />
                )}

                <div
                  className="flex items-stretch gap-1.5"
                  style={boardSize !== null ? { height: boardSize } : undefined}
                >
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

                {/* A flex column, so the bar's margin is inside what is measured. */}
                <div ref={controlsRef} className="flex flex-col">
                  <div className="mt-2 rounded-xl bg-[var(--fill-4)] p-1">
                    <GameControls
                      nav={nav}
                      totalMoves={parsed.moves.length}
                      action={
                        exploring ? (
                          <button
                            type="button"
                            className="btn btn-subtle h-8 min-h-0 self-center px-3 text-[13px] whitespace-nowrap"
                            onClick={exitExploration}
                            title="Leave this line and return to the game"
                          >
                            Back to game
                          </button>
                        ) : null
                      }
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/*
            Nothing is added to this column while a side line is being explored.
            A banner here would appear and disappear under the board, and the board
            is measured from the room this column has left — so it would resize the
            board every time the user stepped into or out of a variation. The rail
            carries the state and the way back instead, where it costs no layout.
          */}

        </div>

        {/*
          Side rail. One card with a segmented control rather than five stacked
          cards: on a desktop screen the whole workspace fits without scrolling, and
          the move list keeps its own scroll instead of the page growing under it.
        */}
        <div className="panel order-4 flex min-h-0 flex-col lg:order-none lg:h-full">
          {showSettings ? (
            <>
              {/* Settings open over the rail like a sheet: title centred, Done to the right. */}
              <div className="panel-header shrink-0">
                <span />
                <h2 className="panel-title">Settings</h2>
                <button
                  type="button"
                  className="btn btn-ghost h-8 justify-self-end px-3 text-[15px] font-semibold"
                  onClick={() => setShowSettings(false)}
                >
                  Done
                </button>
              </div>
              <div className="scroll-thin min-h-0 flex-1 overflow-y-auto bg-[var(--surface-app)] px-3 pt-4 pb-6">
                <EngineSettings onConfigChange={analysis.reset} />
              </div>
            </>
          ) : (
            <>
              {/*
                Forced mate, at the top of the rail where the eye already is. It
                carries its own walk-through controls, so following a mating
                sequence never means hunting for them in the engine tab.
              */}
              {(mate || stepper || exploring) && (
                <div className="bg-accent-soft mx-3 mt-3 shrink-0 rounded-xl px-3 py-2.5">
                  <div className="flex items-center gap-2">
                    <CrownIcon size={15} className="text-accent shrink-0" />
                    <span className="truncate text-[14px] font-semibold">
                      {live.terminal === 'checkmate'
                        ? 'Checkmate'
                        : mate
                          ? `Mate in ${mate.moves} for ${mate.winner}`
                          : stepper
                            ? 'Mating line'
                            : 'Exploring a variation'}
                    </span>
                    {stepper ? (
                      <span className="text-muted ml-auto shrink-0 text-[12px] tabular-nums">
                        {stepsTaken}/{stepper.line.length}
                      </span>
                    ) : exploring ? (
                      <span className="text-muted ml-auto shrink-0 text-[12px] tabular-nums">
                        +{exploration.length}
                      </span>
                    ) : null}
                  </div>

                  {stepper ? (
                    <div className="mt-2 flex items-center gap-1.5">
                      <button
                        type="button"
                        className="btn btn-gray h-8 flex-1 px-2 text-[13px]"
                        onClick={stepBack}
                        disabled={stepsTaken <= 1}
                      >
                        Back
                      </button>
                      <button
                        type="button"
                        className="btn btn-primary h-8 flex-1 px-2 text-[13px]"
                        onClick={stepForward}
                        disabled={stepsLeft <= 0}
                      >
                        {stepsLeft > 0 ? 'Next' : 'End'}
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost h-8 shrink-0 px-3 text-[13px]"
                        onClick={exitExploration}
                      >
                        Exit
                      </button>
                    </div>
                  ) : (
                    <div className="mt-2 flex items-center gap-1.5">
                      {mate && (
                        <button
                          type="button"
                          className="btn btn-primary h-8 flex-1 px-3 text-[13px]"
                          onClick={() => stepEngineLine(mate.line)}
                        >
                          Step through the mate
                        </button>
                      )}
                      {exploring && (
                        <button
                          type="button"
                          className={cn('btn btn-gray h-8 px-3 text-[13px]', !mate && 'flex-1')}
                          onClick={exitExploration}
                        >
                          Back to the game
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/*
                Feedback on the selected move stays visible above every tab, but
                it is capped at a share of the rail so a long comment cannot push
                the tabs and the move list off the bottom.
              */}
              <div className="scroll-thin shrink-0 lg:max-h-[55%] lg:overflow-y-auto">
                <AnalysisPanel
                  move={exploring ? null : currentMoveAnalysis}
                  fenBefore={nav.index > 0 ? parsed.positions[nav.index - 1] : null}
                  analysing={analysing}
                />
              </div>

              <div className={cn('shrink-0 px-3 py-2.5', feedbackShown && 'border-t')}>
                <div role="tablist" aria-label="Analysis panels" className="segmented">
                  {RAIL_TABS.map((entry) => (
                    <button
                      key={entry.key}
                      type="button"
                      role="tab"
                      aria-selected={tab === entry.key}
                      onClick={() => setTab(entry.key)}
                    >
                      <entry.icon size={14} aria-hidden="true" className="hidden shrink-0 sm:block" />
                      {entry.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="scroll-thin min-h-0 flex-1 overflow-y-auto" role="tabpanel">
                {tab === 'moves' && (
                  <MoveList
                    moves={parsed.moves}
                    analysis={analysis.review?.moves ?? null}
                    index={nav.index}
                    onSelect={(index) => {
                      nav.stop();
                      exitExploration();
                      nav.goTo(index);
                    }}
                    exploration={exploration}
                    onExitExploration={exitExploration}
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
                    <p className="text-muted px-4 py-8 text-center text-[14px]">
                      {analysing
                        ? 'The first pass takes a few seconds; the review appears as soon as it lands.'
                        : 'This game has not been reviewed yet.'}
                    </p>
                  ))}

                {tab === 'engine' && (
                  <EnginePanel
                    fen={displayFen}
                    live={live}
                    onPlayLine={playEngineLine}
                    onStepLine={stepEngineLine}
                  />
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
    /* Same flush, viewport-locked frame as the workspace, so nothing shifts when
       the game arrives and the real layout takes over. */
    <div className="page-flush page-fit w-full lg:h-full lg:min-h-0 lg:overflow-hidden">
      <div className="mb-3 flex items-center gap-2">
        <Skeleton className="h-11 w-full rounded-[var(--radius-card)]" />
      </div>
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_380px] xl:grid-cols-[minmax(0,1fr)_420px]">
        <div className="panel space-y-2 p-3">
          <div className="flex justify-center gap-2">
            <Skeleton className="h-[min(60vh,700px)] w-[42px] rounded-[14px]" />
            <Skeleton className="aspect-square w-full max-w-[min(60vh,700px)] rounded-none" />
          </div>
          <Skeleton className="h-11 rounded-xl" />
        </div>
        <div className="space-y-3">
          <Skeleton className="h-40 rounded-[var(--radius-card)]" />
          <Skeleton className="h-9 rounded-[0.5625rem]" />
          <Skeleton className="h-72 rounded-[var(--radius-card)]" />
        </div>
      </div>
      <p className="text-muted mt-4 flex items-center justify-center gap-2 text-center text-[13px]">
        <Spinner size={14} />
        {scanned > 1 ? `Searching monthly archives (${scanned} checked)…` : 'Loading the game…'}
      </p>
    </div>
  );
}
