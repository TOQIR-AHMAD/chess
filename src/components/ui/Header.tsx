import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { extractUsername, isValidUsername } from '@/services/chessComApi';
import { useSettings } from '@/hooks/useSettings';
import { useShell } from '@/hooks/useShell';
import {
  CompressIcon,
  ExpandIcon,
  LogoMark,
  MenuIcon,
  MoonIcon,
  SearchIcon,
  SunIcon,
} from './Icons';

/**
 * Top navbar for the content column: 4rem tall, translucent over the page, and the
 * same height as the rail's brand block so the two line up across the seam.
 *
 * Left to right it carries the rail's collapse toggle, the current page's name,
 * then the player search and the icon buttons — full screen and the theme switch.
 * Below `lg` the rail is hidden, so the wordmark appears here instead of the
 * hamburger, which would have nothing to collapse.
 */

/** Tracks whether the document is currently presented full screen. */
function useFullscreen(): [boolean, () => void] {
  const [active, setActive] = useState(false);

  useEffect(() => {
    const sync = () => setActive(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', sync);
    return () => document.removeEventListener('fullscreenchange', sync);
  }, []);

  const toggle = useCallback(() => {
    // Rejections are swallowed: browsers refuse the request outside a user
    // gesture or when the embedding page disallows it, and neither is an error
    // worth surfacing — the button simply does nothing.
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => {});
    } else {
      void document.documentElement.requestFullscreen().catch(() => {});
    }
  }, []);

  return [active, toggle];
}

export function Header() {
  const navigate = useNavigate();
  const { theme, toggleTheme } = useSettings();
  const { collapsed, toggleCollapsed, title } = useShell();
  const [fullscreen, toggleFullscreen] = useFullscreen();
  const [value, setValue] = useState('');

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const username = extractUsername(value);
    if (!isValidUsername(username)) return;
    setValue('');
    navigate(`/player/${encodeURIComponent(username)}`);
  };

  return (
    <header className="navbar">
      <button
        type="button"
        onClick={toggleCollapsed}
        className="navbar-btn hidden lg:inline-flex"
        title={collapsed ? 'Expand the sidebar' : 'Collapse the sidebar'}
        aria-label={collapsed ? 'Expand the sidebar' : 'Collapse the sidebar'}
        aria-expanded={!collapsed}
      >
        <MenuIcon size={18} />
      </button>

      <Link to="/" className="flex shrink-0 items-center gap-2 lg:hidden" aria-label="Gambit Review home">
        <LogoMark size={26} />
      </Link>

      <h1 className="navbar-title">{title}</h1>

      <form onSubmit={submit} className="relative ml-auto hidden w-full max-w-xs sm:block">
        <SearchIcon
          size={15}
          className="text-muted pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2"
        />
        <input
          className="input pl-8"
          placeholder="Search another player…"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          aria-label="Search a Chess.com player"
          autoComplete="off"
          spellCheck={false}
        />
      </form>

      <button
        type="button"
        onClick={toggleFullscreen}
        className="navbar-btn ml-auto hidden sm:ml-0 sm:inline-flex"
        title={fullscreen ? 'Exit full screen' : 'Full screen'}
        aria-label={fullscreen ? 'Exit full screen' : 'Enter full screen'}
      >
        {fullscreen ? <CompressIcon size={18} /> : <ExpandIcon size={18} />}
      </button>

      <button
        type="button"
        onClick={toggleTheme}
        className="navbar-btn ml-auto sm:ml-0"
        title={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
        aria-label="Toggle colour theme"
      >
        {theme === 'dark' ? <SunIcon size={18} /> : <MoonIcon size={18} />}
      </button>
    </header>
  );
}
