import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/utils/cn';
import { useLocalStorage } from './useLocalStorage';

/**
 * Shell state shared by the sidebar, the navigation bar and the pages.
 *
 * These live here because the chrome and the pages both need them and neither
 * owns the other: whether the sidebar is shown (docked, or slid out on a smaller
 * screen), the title the bar carries, the back button a pushed page asks for,
 * whether the page's own large title is on screen, and the slot in the bar a
 * page can put its own controls into.
 *
 * The title is pushed up by pages via `usePageTitle` rather than derived from the
 * route, so a page can name itself with something the URL does not carry — an
 * opening name, a player's handle — and the bar stays a single source of truth.
 */

/** Where the bar's back button goes, and the name of the screen it returns to. */
export interface BackLink {
  to: string;
  label: string;
}

/**
 * `none`: the page has no large title, so the bar always shows its own.
 * `visible` / `hidden`: the page's large title is on screen, or has scrolled
 * under the bar — which is when the bar takes the title over, as on iOS.
 */
export type LargeTitleState = 'none' | 'visible' | 'hidden';

interface ShellContextValue {
  /** From `lg`: whether the docked sidebar has been put away. Remembered. */
  collapsed: boolean;
  toggleCollapsed: () => void;
  /** Below `lg`: whether the sidebar is slid out over the page. Never remembered. */
  drawerOpen: boolean;
  setDrawerOpen: (open: boolean) => void;
  title: string;
  setTitle: (title: string) => void;
  back: BackLink | null;
  setBack: (back: BackLink | null) => void;
  largeTitle: LargeTitleState;
  setLargeTitle: (state: LargeTitleState) => void;
  /** The bar element page-level controls are portalled into. */
  actionSlot: HTMLElement | null;
  setActionSlot: (node: HTMLElement | null) => void;
}

const ShellContext = createContext<ShellContextValue | null>(null);

const DEFAULT_TITLE = 'Gambit Review';

export function ShellProvider({ children }: { children: ReactNode }) {
  const [collapsed, setCollapsed] = useLocalStorage<boolean>('gambit:rail-collapsed', false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [title, setTitle] = useState(DEFAULT_TITLE);
  const [back, setBack] = useState<BackLink | null>(null);
  const [largeTitle, setLargeTitle] = useState<LargeTitleState>('none');
  const [actionSlot, setActionSlot] = useState<HTMLElement | null>(null);

  const toggleCollapsed = useCallback(() => setCollapsed((prev) => !prev), [setCollapsed]);

  const value = useMemo<ShellContextValue>(
    () => ({
      collapsed,
      toggleCollapsed,
      drawerOpen,
      setDrawerOpen,
      title,
      setTitle,
      back,
      setBack,
      largeTitle,
      setLargeTitle,
      actionSlot,
      setActionSlot,
    }),
    [actionSlot, back, collapsed, drawerOpen, largeTitle, toggleCollapsed, title],
  );

  return <ShellContext.Provider value={value}>{children}</ShellContext.Provider>;
}

export function useShell(): ShellContextValue {
  const context = useContext(ShellContext);
  if (!context) throw new Error('useShell must be used inside a ShellProvider');
  return context;
}

/**
 * Renders a page's own controls into the bar, beside the shell's own buttons.
 *
 * A portal rather than a node passed through the context: the children can hold
 * page state and re-render as often as they like without the shell re-rendering,
 * and nothing is left behind when the page unmounts.
 */
export function NavbarActions({ children }: { children: ReactNode }) {
  const { actionSlot } = useShell();
  if (!actionSlot) return null;
  return createPortal(children, actionSlot);
}

/**
 * Names the current page in the bar, and — for a page pushed on top of another —
 * gives the bar a back button to its parent. Both are restored on unmount, so a
 * route that sets neither never inherits the previous page's.
 */
export function usePageTitle(title: string, back?: BackLink | null): void {
  const { setTitle, setBack } = useShell();
  const backTo = back?.to ?? null;
  const backLabel = back?.label ?? null;

  useEffect(() => {
    setTitle(title);
    return () => setTitle(DEFAULT_TITLE);
  }, [title, setTitle]);

  useEffect(() => {
    setBack(backTo !== null && backLabel !== null ? { to: backTo, label: backLabel } : null);
    return () => setBack(null);
  }, [backLabel, backTo, setBack]);
}

/**
 * Marks an element as the page's large title. While any of it is still below the
 * bar the bar stays clear and untitled; once it has scrolled under, the bar takes
 * the title in its centre. Returns a callback ref.
 */
export function useLargeTitle<T extends HTMLElement>(): (node: T | null) => void {
  const { setLargeTitle } = useShell();
  const [node, setNode] = useState<T | null>(null);

  useEffect(() => {
    if (!node) return;
    setLargeTitle('visible');
    if (typeof IntersectionObserver === 'undefined') return () => setLargeTitle('none');

    // The bar is sticky over the top of the page, so "on screen" starts below it.
    const bar = document.querySelector('.navbar');
    const inset = Math.round(bar?.getBoundingClientRect().height ?? 52);
    const observer = new IntersectionObserver(
      ([entry]) => setLargeTitle(entry.isIntersecting ? 'visible' : 'hidden'),
      { rootMargin: `-${inset}px 0px 0px 0px`, threshold: 0 },
    );
    observer.observe(node);
    return () => {
      observer.disconnect();
      setLargeTitle('none');
    };
  }, [node, setLargeTitle]);

  return setNode;
}

/** A page's large title: iOS's 34-point heading, handed over to the bar on scroll. */
export function LargeTitle({ children, className }: { children: ReactNode; className?: string }) {
  const ref = useLargeTitle<HTMLHeadingElement>();
  return (
    <h1 ref={ref} className={cn('large-title', className)}>
      {children}
    </h1>
  );
}
