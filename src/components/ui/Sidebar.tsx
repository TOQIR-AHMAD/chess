import { useEffect, useState } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import { useLocalStorage } from '@/hooks/useLocalStorage';
import { useShell } from '@/hooks/useShell';
import { fetchProfile } from '@/services/chessComApi';
import { playerPath } from '@/utils/routes';
import { cn } from '@/utils/cn';
import { ChartIcon, ClockIcon, CpuIcon, LogoMark, SearchIcon } from './Icons';

/**
 * Persistent left rail: 16rem wide, collapsing to a 4.6rem icon rail. It keeps its
 * dark treatment in both themes so the page always reads board-first — one dark
 * column of navigation, everything else is content.
 *
 * The structure follows the admin-console shell it shares a design language with:
 * a bordered brand block of the same height as the navbar, then a panel naming the
 * player currently in view, then the navigation itself. Icons are monochrome and
 * inherit the link colour, so the active row is the only thing that stands out.
 *
 * Hidden below `lg`, where the header takes the same duties over.
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
    // a failure just leaves the initial-letter fallback in place.
    fetchProfile(username, abort.signal)
      .then((profile) => setAvatar(profile.avatar ?? null))
      .catch(() => setAvatar(null));
    return () => abort.abort();
  }, [username]);

  return username ? { username, avatar } : null;
}

export function Sidebar() {
  const navigate = useNavigate();
  const { collapsed } = useShell();
  const [recent] = useLocalStorage<string[]>('gambit:recent-players', []);
  const player = useRecentPlayer();

  return (
    <aside
      className={cn('rail hidden lg:flex', collapsed && 'rail-collapsed')}
      data-collapsed={collapsed ? 'true' : 'false'}
    >
      {/* Brand block — same height as the navbar, so the two line up across the seam. */}
      <Link to="/" className="rail-brand" aria-label="Gambit Review home">
        <span className="rail-brand-mark">
          <LogoMark size={26} />
        </span>
        {!collapsed && (
          <span className="rail-brand-copy">
            <span>
              Gambit<span className="text-brand-300">Review</span>
            </span>
            <small>Game Analysis</small>
          </span>
        )}
      </Link>

      <div className="rail-body scroll-thin">
        {player && (
          <div className={cn('rail-user', collapsed && 'justify-center')}>
            {player.avatar ? (
              <img src={player.avatar} alt="" className="rail-avatar" />
            ) : (
              <span className="rail-avatar rail-avatar-fallback">
                {player.username.charAt(0).toUpperCase()}
              </span>
            )}
            {!collapsed && (
              <span className="min-w-0">
                <Link to={playerPath(player.username)} className="rail-user-name">
                  {player.username}
                </Link>
                <small>Last viewed</small>
              </span>
            )}
          </div>
        )}

        <button
          type="button"
          className={cn('btn btn-primary mb-3 w-full', collapsed && 'px-0')}
          onClick={() => navigate('/')}
          title="Start a new review"
        >
          <SearchIcon size={16} />
          {!collapsed && 'New review'}
        </button>

        <NavLink to="/" end className="nav-item" title="Analyse">
          <ChartIcon size={18} className="nav-icon" />
          {!collapsed && 'Analyse'}
        </NavLink>

        <a
          className="nav-item"
          href="https://www.chess.com/news/view/published-data-api"
          target="_blank"
          rel="noreferrer noopener"
          title="API docs"
        >
          <CpuIcon size={18} className="nav-icon" />
          {!collapsed && 'API docs'}
        </a>

        {recent.length > 0 && (
          <>
            {!collapsed && <p className="rail-heading">Recent</p>}
            {collapsed && <hr className="rail-divider" />}
            {recent.slice(0, 6).map((username) => (
              <NavLink
                key={username}
                to={playerPath(username)}
                className="nav-item"
                title={username}
              >
                <ClockIcon size={18} className="nav-icon" />
                {!collapsed && <span className="truncate">{username}</span>}
              </NavLink>
            ))}
          </>
        )}
      </div>
    </aside>
  );
}
