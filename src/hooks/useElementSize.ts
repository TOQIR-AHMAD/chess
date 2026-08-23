import { useLayoutEffect, useState } from 'react';

export interface ElementSize {
  width: number;
  height: number;
}

/**
 * Track an element's content-box size.
 *
 * Used where a square has to fit a box constrained on both axes — the board,
 * which CSS alone cannot size from the smaller of the available width and the
 * available height without distorting one of them.
 *
 * The element is held in state and attached through a callback ref rather than a
 * ref object, so the observer also picks up a node that appears later — after a
 * loading state, or when a branch of the tree is switched in.
 */
export function useElementSize<T extends HTMLElement>(): [(node: T | null) => void, ElementSize] {
  const [node, setNode] = useState<T | null>(null);
  const [size, setSize] = useState<ElementSize>({ width: 0, height: 0 });

  useLayoutEffect(() => {
    if (!node) {
      setSize({ width: 0, height: 0 });
      return;
    }

    // Whole pixels only: a fractional size fed back into the layout would keep
    // the observer firing on sub-pixel differences.
    const apply = (width: number, height: number) => {
      const next = { width: Math.floor(width), height: Math.floor(height) };
      setSize((prev) => (prev.width === next.width && prev.height === next.height ? prev : next));
    };

    const rect = node.getBoundingClientRect();
    apply(rect.width, rect.height);

    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect;
      if (box) apply(box.width, box.height);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [node]);

  return [setNode, size];
}
