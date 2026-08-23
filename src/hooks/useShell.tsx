import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useLocalStorage } from './useLocalStorage';

/**
 * Shell state shared by the left rail and the top navbar.
 *
 * Three things live here because the chrome and the pages both need them and
 * neither owns the other: whether the rail is collapsed to its icon width, the
 * title the navbar shows, and the slot in the navbar a page can put its own
 * controls into.
 *
 * The title is pushed up by pages via `usePageTitle` rather than derived from the
 * route, so a page can name itself with something the URL does not carry — an
 * opening name, a player's handle — and the navbar stays a single source of truth.
 */

interface ShellContextValue {
  collapsed: boolean;
  toggleCollapsed: () => void;
  title: string;
  setTitle: (title: string) => void;
  /** The navbar element page-level controls are portalled into. */
  actionSlot: HTMLElement | null;
  setActionSlot: (node: HTMLElement | null) => void;
}

const ShellContext = createContext<ShellContextValue | null>(null);

const DEFAULT_TITLE = 'Dashboard';

export function ShellProvider({ children }: { children: ReactNode }) {
  const [collapsed, setCollapsed] = useLocalStorage<boolean>('gambit:rail-collapsed', false);
  const [title, setTitle] = useState(DEFAULT_TITLE);
  const [actionSlot, setActionSlot] = useState<HTMLElement | null>(null);

  const toggleCollapsed = useCallback(() => setCollapsed((prev) => !prev), [setCollapsed]);

  const value = useMemo<ShellContextValue>(
    () => ({ collapsed, toggleCollapsed, title, setTitle, actionSlot, setActionSlot }),
    [actionSlot, collapsed, toggleCollapsed, title],
  );

  return <ShellContext.Provider value={value}>{children}</ShellContext.Provider>;
}

export function useShell(): ShellContextValue {
  const context = useContext(ShellContext);
  if (!context) throw new Error('useShell must be used inside a ShellProvider');
  return context;
}

/**
 * Renders a page's own controls into the navbar, beside the shell's own buttons.
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
 * Names the current page in the navbar. Restores the default on unmount so a
 * route that does not set one never inherits the previous page's title.
 */
export function usePageTitle(title: string): void {
  const { setTitle } = useShell();

  useEffect(() => {
    setTitle(title);
    return () => setTitle(DEFAULT_TITLE);
  }, [title, setTitle]);
}
