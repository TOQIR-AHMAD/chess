import { useEffect, useState } from 'react';
import { fetchProfile } from '@/services/chessComApi';

/**
 * Avatars for the two players of a game, for the board name plates.
 *
 * Profiles are already cached by `chessComApi`, so this usually costs nothing;
 * failures are swallowed because a missing avatar simply falls back to initials.
 */
export function usePlayerAvatars(usernames: Array<string | undefined>): Record<string, string | null> {
  const [avatars, setAvatars] = useState<Record<string, string | null>>({});
  const key = usernames.filter(Boolean).join('|').toLowerCase();

  useEffect(() => {
    if (key.length === 0) return;
    const abort = new AbortController();

    (async () => {
      for (const username of key.split('|')) {
        if (abort.signal.aborted) return;
        try {
          const profile = await fetchProfile(username, abort.signal);
          if (abort.signal.aborted) return;
          setAvatars((prev) => ({ ...prev, [username]: profile.avatar ?? null }));
        } catch {
          setAvatars((prev) => ({ ...prev, [username]: null }));
        }
      }
    })();

    return () => abort.abort();
  }, [key]);

  return avatars;
}
