import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { extractUsername, isValidUsername } from '@/services/chessComApi';
import { useIsDesktop } from '@/hooks/useMediaQuery';
import { useSettings } from '@/hooks/useSettings';
import { useShell } from '@/hooks/useShell';
import { ChevronLeft, CompressIcon, ExpandIcon, MoonIcon, SearchIcon, SidebarIcon, SunIcon } from './Icons';

/**
 * The navigation bar over the content column, built the way iOS builds one.
 *
 * At the scroll edge it is clear: the page's own large title does the naming and
 * the bar carries only its glass buttons. Once content scrolls under it, it takes
 * the translucent bar material and a hairline, and — when the large title has
 * gone under too — the page's name in its centre.
 *
 * Left to right: the sidebar toggle and a pushed page's back button; the title;
 * then the player search, the page's own controls, full screen and the appearance
 * switch, grouped in one glass capsule. The toggle is there on every screen: from
 * `lg` it puts the docked sidebar away, below that it slides the same sidebar out.
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

/** Whether the window has scrolled away from its top edge. */
function useScrolledPastEdge(): boolean {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    let frame = 0;
    const check = () => {
      frame = 0;
      setScrolled(window.scrollY > 2);
    };
    const onScroll = () => {
      if (!frame) frame = window.requestAnimationFrame(check);
    };
    check();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, []);

  return scrolled;
}

export function Header() {
  const navigate = useNavigate();
  const { resolvedTheme, toggleTheme } = useSettings();
  const { collapsed, toggleCollapsed, drawerOpen, setDrawerOpen, title, back, largeTitle, setActionSlot } =
    useShell();
  const isDesktop = useIsDesktop();
  const sidebarShown = isDesktop ? !collapsed : drawerOpen;
  const [fullscreen, toggleFullscreen] = useFullscreen();
  const scrolled = useScrolledPastEdge();
  const [value, setValue] = useState('');

  // While the page's large title is on screen, the bar leaves the naming to it.
  const titleHidden = largeTitle === 'visible';

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const username = extractUsername(value);
    if (!isValidUsername(username)) return;
    setValue('');
    navigate(`/player/${encodeURIComponent(username)}`);
  };

  return (
    // A query container: the search field shows only when the bar itself has the room.
    <header className="navbar @container" data-material={scrolled ? 'true' : 'false'}>
      <div className="flex min-w-0 items-center gap-2">
        <button
          type="button"
          onClick={() => (isDesktop ? toggleCollapsed() : setDrawerOpen(!drawerOpen))}
          className="navbar-btn glass"
          title={sidebarShown ? 'Hide the sidebar' : 'Show the sidebar'}
          aria-label={sidebarShown ? 'Hide the sidebar' : 'Show the sidebar'}
          aria-expanded={sidebarShown}
        >
          <SidebarIcon size={19} />
        </button>

        {/* On a phone the label gives its room to the title and the button is a bare chevron. */}
        {back && (
          <Link
            to={back.to}
            className="navbar-back glass max-sm:w-9 max-sm:justify-center max-sm:px-0"
            title={`Back to ${back.label}`}
            aria-label={`Back to ${back.label}`}
          >
            <ChevronLeft size={20} strokeWidth={2.4} className="shrink-0" />
            <span className="truncate max-sm:hidden">{back.label}</span>
          </Link>
        )}
      </div>

      <h1 className="navbar-title" data-hidden={titleHidden ? 'true' : 'false'} aria-hidden={titleHidden || undefined}>
        {title}
      </h1>

      <div className="flex min-w-0 items-center justify-end gap-2">
        <form onSubmit={submit} role="search" className="relative hidden w-full max-w-[15rem] @3xl:block">
          <SearchIcon
            size={16}
            className="text-muted pointer-events-none absolute top-1/2 left-3 z-10 -translate-y-1/2"
          />
          <input
            className="input glass h-9 min-h-0 rounded-full pl-9 text-[15px]"
            placeholder="Search players"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            aria-label="Search a Chess.com player"
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
          />
        </form>

        <div className="bar-group glass">
          {/* The current page's own controls land here, via `NavbarActions`. */}
          <div ref={setActionSlot} className="contents" />

          <button
            type="button"
            onClick={toggleFullscreen}
            className="navbar-btn hidden sm:inline-flex"
            title={fullscreen ? 'Exit full screen' : 'Full screen'}
            aria-label={fullscreen ? 'Exit full screen' : 'Enter full screen'}
          >
            {fullscreen ? <CompressIcon size={17} /> : <ExpandIcon size={17} />}
          </button>

          <button
            type="button"
            onClick={toggleTheme}
            className="navbar-btn"
            title={resolvedTheme === 'dark' ? 'Switch to light appearance' : 'Switch to dark appearance'}
            aria-label="Toggle appearance"
          >
            {resolvedTheme === 'dark' ? <SunIcon size={18} /> : <MoonIcon size={18} />}
          </button>
        </div>
      </div>
    </header>
  );
}
