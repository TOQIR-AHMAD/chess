import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parsePgn } from '@/services/pgnParser';
import { useGameNavigation } from './useGameNavigation';

const GAME = parsePgn('1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6 5. O-O Be7 *');

function press(key: string) {
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
  });
}

describe('useGameNavigation', () => {
  it('starts at the initial position', () => {
    const { result } = renderHook(() => useGameNavigation(GAME));
    expect(result.current.index).toBe(0);
    expect(result.current.currentPly).toBeNull();
    expect(result.current.isStart).toBe(true);
    expect(result.current.isEnd).toBe(false);
    expect(result.current.fen).toBe(GAME.positions[0]);
  });

  it('steps forward and back through the game', () => {
    const { result } = renderHook(() => useGameNavigation(GAME));

    act(() => result.current.next());
    expect(result.current.index).toBe(1);
    expect(result.current.currentPly).toBe(0);
    expect(result.current.fen).toBe(GAME.positions[1]);

    act(() => result.current.next());
    act(() => result.current.previous());
    expect(result.current.index).toBe(1);
  });

  it('does not step past either end', () => {
    const { result } = renderHook(() => useGameNavigation(GAME));

    act(() => result.current.previous());
    expect(result.current.index).toBe(0);

    act(() => result.current.last());
    expect(result.current.index).toBe(GAME.moves.length);
    expect(result.current.isEnd).toBe(true);

    act(() => result.current.next());
    expect(result.current.index).toBe(GAME.moves.length);
  });

  it('jumps to first, last and arbitrary positions', () => {
    const { result } = renderHook(() => useGameNavigation(GAME));

    act(() => result.current.goTo(6));
    expect(result.current.index).toBe(6);
    expect(result.current.fen).toBe(GAME.positions[6]);

    act(() => result.current.first());
    expect(result.current.index).toBe(0);

    act(() => result.current.last());
    expect(result.current.index).toBe(GAME.moves.length);
  });

  it('clamps out-of-range jumps', () => {
    const { result } = renderHook(() => useGameNavigation(GAME));

    act(() => result.current.goTo(-5));
    expect(result.current.index).toBe(0);

    act(() => result.current.goTo(9999));
    expect(result.current.index).toBe(GAME.moves.length);
  });

  it('flips the board', () => {
    const { result } = renderHook(() => useGameNavigation(GAME));
    expect(result.current.orientation).toBe('white');
    act(() => result.current.flip());
    expect(result.current.orientation).toBe('black');
    act(() => result.current.setOrientation('white'));
    expect(result.current.orientation).toBe('white');
  });

  it('honours the initial orientation', () => {
    const { result } = renderHook(() => useGameNavigation(GAME, 'black'));
    expect(result.current.orientation).toBe('black');
  });

  it('handles a null game without crashing', () => {
    const { result } = renderHook(() => useGameNavigation(null));
    expect(result.current.index).toBe(0);
    expect(result.current.isEnd).toBe(true);
    expect(result.current.fen).toContain('rnbqkbnr');
    act(() => result.current.next());
    expect(result.current.index).toBe(0);
  });

  it('resets to the start when a different game is loaded', () => {
    const other = parsePgn('1. d4 d5 2. c4 e6 *');
    const { result, rerender } = renderHook(({ game }) => useGameNavigation(game), {
      initialProps: { game: GAME },
    });

    act(() => result.current.last());
    expect(result.current.index).toBe(GAME.moves.length);

    rerender({ game: other });
    expect(result.current.index).toBe(0);
  });

  describe('keyboard shortcuts', () => {
    it('moves with the arrow keys and jumps with Home/End', () => {
      const { result } = renderHook(() => useGameNavigation(GAME));

      press('ArrowRight');
      expect(result.current.index).toBe(1);

      press('ArrowRight');
      expect(result.current.index).toBe(2);

      press('ArrowLeft');
      expect(result.current.index).toBe(1);

      press('End');
      expect(result.current.index).toBe(GAME.moves.length);

      press('Home');
      expect(result.current.index).toBe(0);
    });

    it('flips the board with F', () => {
      const { result } = renderHook(() => useGameNavigation(GAME));
      press('f');
      expect(result.current.orientation).toBe('black');
    });

    it('ignores shortcuts while typing in an input', () => {
      const { result } = renderHook(() => useGameNavigation(GAME));
      const input = document.createElement('input');
      document.body.appendChild(input);
      input.focus();

      act(() => {
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
      });
      expect(result.current.index).toBe(0);

      input.remove();
    });

    it('detaches its listener on unmount', () => {
      const { result, unmount } = renderHook(() => useGameNavigation(GAME));
      unmount();
      press('ArrowRight');
      expect(result.current.index).toBe(0);
    });
  });

  describe('playback', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('advances one move per tick and stops at the end', () => {
      const { result } = renderHook(() => useGameNavigation(GAME));

      act(() => result.current.togglePlay());
      expect(result.current.playing).toBe(true);

      act(() => void vi.advanceTimersByTime(1000));
      expect(result.current.index).toBe(1);

      act(() => void vi.advanceTimersByTime(1000));
      expect(result.current.index).toBe(2);

      act(() => void vi.advanceTimersByTime(20_000));
      expect(result.current.index).toBe(GAME.moves.length);
      expect(result.current.playing).toBe(false);
    });

    it('pauses on a second toggle', () => {
      const { result } = renderHook(() => useGameNavigation(GAME));
      act(() => result.current.togglePlay());
      act(() => void vi.advanceTimersByTime(1000));
      act(() => result.current.togglePlay());
      expect(result.current.playing).toBe(false);

      const frozen = result.current.index;
      act(() => void vi.advanceTimersByTime(5000));
      expect(result.current.index).toBe(frozen);
    });

    it('rewinds when playback starts from the final position', () => {
      const { result } = renderHook(() => useGameNavigation(GAME));
      act(() => result.current.last());
      act(() => result.current.togglePlay());
      expect(result.current.index).toBe(0);
      expect(result.current.playing).toBe(true);
    });

    it('stops playback when the user navigates by keyboard', () => {
      const { result } = renderHook(() => useGameNavigation(GAME));
      act(() => result.current.togglePlay());
      expect(result.current.playing).toBe(true);
      press('ArrowRight');
      expect(result.current.playing).toBe(false);
    });
  });
});
