import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { extractUsername, isValidUsername } from '@/services/chessComApi';
import { ClockIcon, SearchIcon } from '@/components/ui/Icons';
import { Spinner } from '@/components/ui/Feedback';
import { useLocalStorage } from '@/hooks/useLocalStorage';
import { cn } from '@/utils/cn';

/**
 * Username entry. Validation happens before the request so an obviously invalid
 * handle never costs a round trip, and recent searches are kept locally — offered
 * back as capsules under the field, the way iOS offers recent searches.
 */
export function PlayerSearch({
  autoFocus = false,
  size = 'lg',
  className,
}: {
  autoFocus?: boolean;
  size?: 'lg' | 'sm';
  className?: string;
}) {
  const navigate = useNavigate();
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [recent, setRecent] = useLocalStorage<string[]>('gambit:recent-players', []);
  const inputRef = useRef<HTMLInputElement>(null);

  // Without scrolling: where the field sits below the board, focusing it must not
  // carry the page past everything above it.
  useEffect(() => {
    if (autoFocus) inputRef.current?.focus({ preventScroll: true });
  }, [autoFocus]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const username = extractUsername(value);

    if (username.length === 0) {
      setError('Enter a Chess.com username to get started.');
      return;
    }
    if (!isValidUsername(username)) {
      setError('Usernames are 3–25 characters and use only letters, numbers, “-” and “_”.');
      return;
    }

    setError(null);
    setSubmitting(true);
    // PlayerPage records the visit, so a deep link and a search both count.
    navigate(`/player/${encodeURIComponent(username)}`);
  };

  const isLarge = size === 'lg';

  return (
    // Its own query container: the field and the button sit side by side whenever
    // the search has the room, wherever it is placed.
    <div className={cn('@container', className)}>
      <form onSubmit={submit} role="search" className="flex flex-col gap-2.5 @md:flex-row">
        <div className="relative flex-1">
          <SearchIcon
            size={isLarge ? 19 : 16}
            className="text-muted pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2"
          />
          <input
            ref={inputRef}
            className={cn('input pl-10', isLarge && 'input-lg h-12 pl-11')}
            placeholder="Chess.com username — e.g. hikaru"
            value={value}
            onChange={(event) => {
              setValue(event.target.value);
              if (error) setError(null);
            }}
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            enterKeyHint="search"
            aria-label="Chess.com username"
            aria-invalid={error !== null}
            aria-describedby={error ? 'player-search-error' : undefined}
          />
        </div>
        <button
          type="submit"
          className={cn('btn btn-primary', isLarge && 'h-12 px-6 text-[17px]')}
          disabled={submitting}
        >
          {submitting ? <Spinner size={16} /> : null}
          Analyse games
        </button>
      </form>

      {error && (
        <p id="player-search-error" className="text-danger mt-2 px-1 text-[13px]" role="alert">
          {error}
        </p>
      )}

      {recent.length > 0 && (
        <div className="mt-5">
          <div className="flex items-center justify-between px-1">
            <span className="text-muted text-[13px]">Recent</span>
            <button type="button" className="text-accent text-[13px] font-medium" onClick={() => setRecent([])}>
              Clear
            </button>
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            {recent.map((entry) => (
              <button
                key={entry}
                type="button"
                className="btn btn-gray h-8 gap-1.5 px-3 text-[14px] font-medium"
                onClick={() => navigate(`/player/${encodeURIComponent(entry)}`)}
              >
                <ClockIcon size={14} className="text-muted" />
                {entry}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
