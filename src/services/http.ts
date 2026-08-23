/**
 * Thin fetch wrapper for the Chess.com public API.
 *
 * The published-data API documents that *serial* access is unlimited while
 * parallel bursts may be answered with `429 Too Many Requests`. Requests are
 * therefore funnelled through a small concurrency limiter and retried with
 * exponential backoff on 429/5xx.
 */

export type ApiErrorKind =
  | 'not-found'
  | 'rate-limited'
  | 'network'
  | 'server'
  | 'timeout'
  | 'aborted'
  | 'invalid-response'
  | 'unknown';

export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  readonly status?: number;

  constructor(kind: ApiErrorKind, message: string, status?: number) {
    super(message);
    this.name = 'ApiError';
    this.kind = kind;
    this.status = status;
  }

  /** Message safe to show directly to a user. */
  get userMessage(): string {
    switch (this.kind) {
      case 'not-found':
        return 'No Chess.com account matches that username.';
      case 'rate-limited':
        return 'Chess.com is rate limiting requests right now. Give it a moment and try again.';
      case 'timeout':
        return 'Chess.com took too long to respond. Check your connection and try again.';
      case 'network':
        return 'Could not reach Chess.com. Check your internet connection.';
      case 'server':
        return 'Chess.com returned an error. Their API may be temporarily unavailable.';
      case 'invalid-response':
        return 'Chess.com returned data in an unexpected format.';
      case 'aborted':
        return 'Request cancelled.';
      default:
        return this.message || 'Something went wrong talking to Chess.com.';
    }
  }
}

const MAX_CONCURRENCY = 3;
const DEFAULT_TIMEOUT_MS = 20_000;
const MAX_RETRIES = 3;

let active = 0;
const waiting: Array<() => void> = [];

async function acquire(): Promise<void> {
  if (active < MAX_CONCURRENCY) {
    active += 1;
    return;
  }
  await new Promise<void>((resolve) => waiting.push(resolve));
  active += 1;
}

function release(): void {
  active -= 1;
  const next = waiting.shift();
  if (next) next();
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(new ApiError('aborted', 'Request cancelled'));
      },
      { once: true },
    );
  });
}

export interface RequestOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  /** Response type. `json` validates + parses, `text` returns the raw body. */
  as?: 'json' | 'text';
}

/**
 * Fetch a URL with retries, backoff and a hard timeout.
 * Throws `ApiError` for every failure mode so callers can branch on `kind`.
 */
export async function request<T>(url: string, options: RequestOptions = {}): Promise<T> {
  const { signal, timeoutMs = DEFAULT_TIMEOUT_MS, as = 'json' } = options;

  await acquire();
  try {
    let lastError: ApiError = new ApiError('unknown', 'Request failed');

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
      if (signal?.aborted) throw new ApiError('aborted', 'Request cancelled');

      const timeoutController = new AbortController();
      const timer = setTimeout(() => timeoutController.abort(), timeoutMs);
      const onAbort = () => timeoutController.abort();
      signal?.addEventListener('abort', onAbort, { once: true });

      try {
        const response = await fetch(url, {
          signal: timeoutController.signal,
          headers: { Accept: as === 'json' ? 'application/json' : 'text/plain, */*' },
        });

        if (response.status === 404) {
          throw new ApiError('not-found', 'Resource not found', 404);
        }
        if (response.status === 429) {
          lastError = new ApiError('rate-limited', 'Rate limited by Chess.com', 429);
          const retryAfter = Number.parseInt(response.headers.get('retry-after') ?? '', 10);
          const waitMs = Number.isFinite(retryAfter)
            ? Math.min(retryAfter * 1000, 8000)
            : 600 * 2 ** attempt;
          if (attempt < MAX_RETRIES) {
            await delay(waitMs, signal);
            continue;
          }
          throw lastError;
        }
        if (response.status >= 500) {
          lastError = new ApiError('server', `Chess.com responded with ${response.status}`, response.status);
          if (attempt < MAX_RETRIES) {
            await delay(500 * 2 ** attempt, signal);
            continue;
          }
          throw lastError;
        }
        if (!response.ok) {
          throw new ApiError('unknown', `Chess.com responded with ${response.status}`, response.status);
        }

        if (as === 'text') return (await response.text()) as T;

        const text = await response.text();
        if (text.trim().length === 0) throw new ApiError('invalid-response', 'Empty response body');
        try {
          return JSON.parse(text) as T;
        } catch {
          throw new ApiError('invalid-response', 'Response was not valid JSON');
        }
      } catch (error) {
        if (error instanceof ApiError) {
          if (error.kind === 'not-found' || error.kind === 'invalid-response' || error.kind === 'aborted') {
            throw error;
          }
          lastError = error;
        } else if (error instanceof DOMException && error.name === 'AbortError') {
          if (signal?.aborted) throw new ApiError('aborted', 'Request cancelled');
          lastError = new ApiError('timeout', 'Request timed out');
        } else {
          lastError = new ApiError('network', 'Network request failed');
        }

        if (attempt >= MAX_RETRIES) throw lastError;
        await delay(400 * 2 ** attempt, signal);
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
      }
    }

    throw lastError;
  } finally {
    release();
  }
}

/** Normalise any thrown value into an `ApiError`. */
export function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  if (error instanceof Error) return new ApiError('unknown', error.message);
  return new ApiError('unknown', 'Unexpected error');
}
