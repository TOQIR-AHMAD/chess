import { useEffect, useState, type MouseEvent } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useLocalStorage } from '@/hooks/useLocalStorage';
import { useIsDesktop } from '@/hooks/useMediaQuery';
import { useShell } from '@/hooks/useShell';
import { fetchProfile } from '@/services/chessComApi';
import { INSIGHTS_PATH, SETTINGS_PATH, playerPath } from '@/utils/routes';
import { ChevronRight, CpuIcon, ExternalIcon, LogoMark, SearchIcon, SettingsIcon, TargetIcon } from './Icons';

/**
 * The sidebar, as iPadOS draws it: a floating glass panel down the left edge,
 * with the app's name, the player last viewed in the account row that heads
 * Settings, the destinations, and the recent players under their own heading.
 * The selected row is filled with the tint.
 *
 * It is the same panel on every screen. From `lg` it is docked beside the page,
 * and the toggle in the navigation bar slides it away entirely. Below `lg` the
 * same toggle slides it out over the page instead; choosing a destination,
 * tapping the dimmed page or pressing Escape puts it back.
 */

/** The player whose page was last opened, with their avatar once it resolves. */
function useRecentPlayer(): { username: string; avatar: string | null } | null {
  const [recent] = useLocalStorage<string[]>('gambit:recent-players', []);
  const username = recent[0] ?? '';
  const [avatar, setAvatar] = useState<string | null>(null);

  useEffect(() => {
    if (!username) {
      setAvatar(null);
      return;
    }
    const abort = new AbortController();
    // Profiles are already cached by `chessComApi`, so this usually costs nothing;
    // a failure just leaves the monogram in place.
    fetchProfile(username, abort.signal)
      .then((profile) => setAvatar(profile.avatar ?? null))
      .catch(() => setAvatar(null));
    return () => abort.abort();
  }, [username]);

  return username ? { username, avatar } : null;
}

/**
 * The row that stands for the current route. A player's page, and the review of
 * one of their games, select that player's row in Recent when it is there, and
 * fall back to Search — where a player is found — when it is not.
 */
function selectionFor(pathname: string, recent: string[]): string {
  if (pathname === '/') return 'search';
  if (pathname.startsWith(INSIGHTS_PATH)) return 'insights';
  if (pathname.startsWith(SETTINGS_PATH)) return 'settings';
  const match = /^\/(?:player|analyze)\/([^/]+)/.exec(pathname);
  if (!match) return '';
  const username = decodeURIComponent(match[1]).toLowerCase();
  const entry = recent.slice(0, 6).find((name) => name.toLowerCase() === username);
  return entry ? `player:${entry}` : 'search';
}

export function Sidebar() {
  const { collapsed, drawerOpen, setDrawerOpen } = useShell();
  const isDesktop = useIsDesktop();
  const { pathname } = useLocation();
  const [recent] = useLocalStorage<string[]>('gambit:recent-players', []);
  const player = useRecentPlayer();
  const selected = selectionFor(pathname, recent);
  const current = (key: string) => (selected === key ? ('page' as const) : undefined);
  const hidden = isDesktop ? collapsed : !drawerOpen;

  // A new page puts the slid-out sidebar away.
  useEffect(() => setDrawerOpen(false), [pathname, setDrawerOpen]);

  useEffect(() => {
    if (!drawerOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setDrawerOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [drawerOpen, setDrawerOpen]);

  // Choosing the page already on screen changes no route, so close on the click itself.
  const closeOnLink = (event: MouseEvent<HTMLElement>) => {
    if (!isDesktop && (event.target as HTMLElement).closest('a')) setDrawerOpen(false);
  };

  return (
    <>
      <div
        className="sidebar-backdrop"
        data-open={drawerOpen ? 'true' : 'false'}
        onClick={() => setDrawerOpen(false)}
        aria-hidden="true"
      />
      <aside
        className="sidebar glass"
        data-collapsed={collapsed ? 'true' : 'false'}
        data-open={drawerOpen ? 'true' : 'false'}
        aria-label="Sidebar"
        inert={hidden}
        onClick={closeOnLink}
      >
        <div className="sidebar-inner">
          <Link to="/" className="sidebar-brand" aria-label="Gambit Review home">
            <LogoMark size={30} />
            <span className="sidebar-brand-name">Gambit Review</span>
          </Link>

          <div className="sidebar-body scroll-thin">
            {player && (
              <Link to={playerPath(player.username)} className="sidebar-account">
                <Avatar username={player.username} src={player.avatar} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-semibold">{player.username}</span>
                  <span className="text-muted block text-[13px]">Last viewed</span>
                </span>
                <ChevronRight size={15} strokeWidth={2.2} className="cell-chevron" />
              </Link>
            )}

            <nav aria-label="Main">
              <Link to="/" className="sidebar-item" aria-current={current('search')}>
                <SearchIcon size={19} className="nav-icon" />
                Search
              </Link>
              <Link to={INSIGHTS_PATH} className="sidebar-item" aria-current={current('insights')}>
                <TargetIcon size={19} className="nav-icon" />
                Strengths &amp; Weaknesses
              </Link>
              <Link to={SETTINGS_PATH} className="sidebar-item" aria-current={current('settings')}>
                <SettingsIcon size={19} className="nav-icon" />
                Settings
              </Link>
              <a
                className="sidebar-item"
                href="https://www.chess.com/news/view/published-data-api"
                target="_blank"
                rel="noreferrer noopener"
              >
                <CpuIcon size={19} className="nav-icon" />
                API docs
                <ExternalIcon size={13} className="text-tertiary ml-auto" />
              </a>
            </nav>

            {recent.length > 0 && (
              <>
                <p className="sidebar-heading">Recent</p>
                {recent.slice(0, 6).map((username) => (
                  <Link
                    key={username}
                    to={playerPath(username)}
                    className="sidebar-item"
                    aria-current={current(`player:${username}`)}
                    title={username}
                  >
                    <span className="monogram h-6 w-6 text-[10px]" aria-hidden="true">
                      {username.slice(0, 2).toUpperCase()}
                    </span>
                    <span className="truncate">{username}</span>
                  </Link>
                ))}
              </>
            )}
          </div>
        </div>
      </aside>
    </>
  );
}

function Avatar({ username, src }: { username: string; src: string | null }) {
  const [failed, setFailed] = useState(false);

  // A new player, or a new picture, deserves a fresh attempt.
  useEffect(() => setFailed(false), [src]);

  if (!src || failed) {
    return (
      <span className="monogram h-10 w-10 text-[15px]" aria-hidden="true">
        {username.slice(0, 2).toUpperCase()}
      </span>
    );
  }
  return (
    <img
      src={src}
      alt=""
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className="h-10 w-10 shrink-0 rounded-full object-cover"
    />
  );
}
