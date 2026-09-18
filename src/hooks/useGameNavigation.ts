import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ParsedGame } from '@/types/game';

/**
 * Move navigation for the analysis board.
 *
 * `index` is a *position* index: 0 is the starting position, 1 is after White's
 * first move, and so on — which is exactly how the evaluation array is indexed too.
 */

export interface GameNavigation {
  /** Current position index (0 … moves.length). */
  index: number;
  /** Ply of the move that produced the current position, or null at the start. */
  currentPly: number | null;
  fen: string;
  isStart: boolean;
  isEnd: boolean;
  playing: boolean;
  goTo: (index: number) => void;
  next: () => void;
  previous: () => void;
  first: () => void;
  last: () => void;
  togglePlay: () => void;
  stop: () => void;
  orientation: 'white' | 'black';
  flip: () => void;
  setOrientation: (orientation: 'white' | 'black') => void;
}

const PLAYBACK_INTERVAL_MS = 900;

export function useGameNavigation(
  parsed: ParsedGame | null,
  initialOrientation: 'white' | 'black' = 'white',
  /** Where a newly loaded game opens, e.g. a position linked to from elsewhere. */
  initialIndex = 0,
): GameNavigation {
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [orientation, setOrientation] = useState<'white' | 'black'>(initialOrientation);
  const timer = useRef<number | null>(null);

  const maxIndex = parsed ? parsed.moves.length : 0;

  // A new game resets the cursor.
  useEffect(() => {
    setIndex(parsed ? Math.max(0, Math.min(parsed.moves.length, initialIndex)) : 0);
    setPlaying(false);
  }, [parsed, initialIndex]);

  useEffect(() => setOrientation(initialOrientation), [initialOrientation]);

  const goTo = useCallback(
    (next: number) => {
      setIndex(Math.max(0, Math.min(maxIndex, next)));
    },
    [maxIndex],
  );

  const next = useCallback(() => setIndex((value) => Math.min(maxIndex, value + 1)), [maxIndex]);
  const previous = useCallback(() => setIndex((value) => Math.max(0, value - 1)), []);
  const first = useCallback(() => setIndex(0), []);
  const last = useCallback(() => setIndex(maxIndex), [maxIndex]);

  const stop = useCallback(() => setPlaying(false), []);
  const togglePlay = useCallback(() => {
    setPlaying((value) => {
      if (value) return false;
      // Starting playback from the end rewinds to the beginning.
      setIndex((current) => (current >= maxIndex ? 0 : current));
      return true;
    });
  }, [maxIndex]);

  // Autoplay.
  useEffect(() => {
    if (!playing) {
      if (timer.current !== null) {
        window.clearInterval(timer.current);
        timer.current = null;
      }
      return;
    }

    timer.current = window.setInterval(() => {
      setIndex((value) => {
        if (value >= maxIndex) {
          setPlaying(false);
          return value;
        }
        return value + 1;
      });
    }, PLAYBACK_INTERVAL_MS);

    return () => {
      if (timer.current !== null) window.clearInterval(timer.current);
      timer.current = null;
    };
  }, [playing, maxIndex]);

  // Keyboard shortcuts, ignored while typing in an input.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
        return;
      }
      switch (event.key) {
        case 'ArrowLeft':
          event.preventDefault();
          setPlaying(false);
          previous();
          break;
        case 'ArrowRight':
          event.preventDefault();
          setPlaying(false);
          next();
          break;
        case 'Home':
          event.preventDefault();
          setPlaying(false);
          first();
          break;
        case 'End':
          event.preventDefault();
          setPlaying(false);
          last();
          break;
        case ' ':
        case 'Spacebar':
          event.preventDefault();
          togglePlay();
          break;
        case 'f':
        case 'F':
          setOrientation((value) => (value === 'white' ? 'black' : 'white'));
          break;
        default:
          break;
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [first, last, next, previous, togglePlay]);

  const fen = useMemo(() => {
    if (!parsed) return 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
    return parsed.positions[Math.min(index, parsed.positions.length - 1)];
  }, [parsed, index]);

  const flip = useCallback(() => setOrientation((value) => (value === 'white' ? 'black' : 'white')), []);

  return {
    index,
    currentPly: index > 0 ? index - 1 : null,
    fen,
    isStart: index === 0,
    isEnd: index >= maxIndex,
    playing,
    goTo,
    next,
    previous,
    first,
    last,
    togglePlay,
    stop,
    orientation,
    flip,
    setOrientation,
  };
}
