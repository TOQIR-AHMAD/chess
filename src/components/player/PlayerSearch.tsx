import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { extractUsername, isValidUsername } from '@/services/chessComApi';
import { SearchIcon } from '@/components/ui/Icons';
import { Spinner } from '@/components/ui/Feedback';
import { useLocalStorage } from '@/hooks/useLocalStorage';
import { cn } from '@/utils/cn';

/**
 * Username entry. Validation happens before the request so an obviously invalid
 * handle never costs a round trip, and recent searches are kept locally.
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

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
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
    <div className={className}>
      <form onSubmit={submit} className="flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <SearchIcon
            size={isLarge ? 19 : 16}
            className="text-muted pointer-events-none absolute top-1/2 left-3 -translate-y-1/2"
          />
          <input
            ref={inputRef}
            className={cn('input pl-10', isLarge && 'input-lg h-12')}
            placeholder="Chess.com username — e.g. hikaru"
            value={value}
            onChange={(event) => {
              setValue(event.target.value);
              if (error) setError(null);
            }}
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            aria-label="Chess.com username"
            aria-invalid={error !== null}
            aria-describedby={error ? 'player-search-error' : undefined}
          />
        </div>
        <button type="submit" className={cn('btn btn-primary', isLarge && 'h-12 px-6 text-base')} disabled={submitting}>
          {submitting ? <Spinner size={16} /> : null}
          Analyse games
        </button>
      </form>

      {error && (
        <p id="player-search-error" className="text-danger mt-2 text-sm" role="alert">
          {error}
        </p>
      )}

      {recent.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <span className="text-muted text-xs">Recent:</span>
          {recent.map((entry) => (
            <button
              key={entry}
              type="button"
              className="chip surface-raised hover-accent transition-colors"
              onClick={() => navigate(`/player/${encodeURIComponent(entry)}`)}
            >
              {entry}
            </button>
          ))}
          <button
            type="button"
            className="text-muted ml-1 text-xs hover:underline"
            onClick={() => setRecent([])}
          >
            clear
          </button>
        </div>
      )}
    </div>
  );
}
