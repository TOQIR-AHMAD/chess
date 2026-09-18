import { createContext, useCallback, useContext, useEffect, useMemo, type ReactNode } from 'react';
import type { ClassificationThresholds, EngineConfig } from '@/types/analysis';
import { DEFAULT_THRESHOLDS } from '@/services/classification';
import { DEFAULT_ENGINE_CONFIG, sanitiseEngineConfig } from '@/services/stockfish';
import { useLocalStorage } from './useLocalStorage';
import { useMediaQuery } from './useMediaQuery';

export type BoardTheme = 'classic' | 'slate' | 'walnut' | 'ocean';
/** `system` follows the device's appearance; light is the default, so every screen starts alike. */
export type ThemeMode = 'system' | 'dark' | 'light';
export type ResolvedTheme = 'dark' | 'light';

const THEME_MODES: ThemeMode[] = ['system', 'dark', 'light'];

/** The bar colour the browser paints around the page, per appearance. */
const THEME_COLOR: Record<ResolvedTheme, string> = { light: '#f2f2f7', dark: '#000000' };

/**
 * Bumped when the *meaning* of the scoring settings changes, not merely their
 * defaults. A stored engine/threshold pair from an older build is then dropped
 * rather than merged: the thresholds changed units between versions, and a depth
 * carried over from an old default would silently pin the review shallower than
 * the thresholds are calibrated for. Presentation settings — theme, board, the
 * toggles — are untouched by a bump.
 */
const SCORING_SETTINGS_VERSION = 2;

export interface Settings {
  /** See `SCORING_SETTINGS_VERSION`. */
  scoringVersion?: number;
  theme: ThemeMode;
  boardTheme: BoardTheme;
  showCoordinates: boolean;
  showBestMoveArrow: boolean;
  animations: boolean;
  autoAnalyse: boolean;
  engine: EngineConfig;
  thresholds: ClassificationThresholds;
}

const DEFAULT_SETTINGS: Settings = {
  scoringVersion: SCORING_SETTINGS_VERSION,
  theme: 'light',
  boardTheme: 'classic',
  showCoordinates: true,
  showBestMoveArrow: true,
  animations: true,
  autoAnalyse: true,
  engine: DEFAULT_ENGINE_CONFIG,
  thresholds: DEFAULT_THRESHOLDS,
};

interface SettingsContextValue extends Settings {
  /** The appearance actually on screen once `system` is resolved against the device. */
  resolvedTheme: ResolvedTheme;
  update: (patch: Partial<Settings>) => void;
  updateEngine: (patch: Partial<EngineConfig>) => void;
  updateThresholds: (patch: Partial<ClassificationThresholds>) => void;
  reset: () => void;
  toggleTheme: () => void;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

/** Read the appearance the pre-paint script in index.html worked from. */
function initialTheme(): ThemeMode {
  try {
    const stored = window.localStorage.getItem('gambit:theme');
    if (THEME_MODES.includes(stored as ThemeMode)) return stored as ThemeMode;
  } catch {
    // Storage unavailable — fall through to the default.
  }
  return 'light';
}

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [stored, setStored] = useLocalStorage<Settings>('gambit:settings', {
    ...DEFAULT_SETTINGS,
    theme: initialTheme(),
  });
  const systemDark = useMediaQuery('(prefers-color-scheme: dark)');

  // Merge with defaults so a settings object written by an older build still works.
  const settings = useMemo<Settings>(() => {
    const scoringIsCurrent = stored.scoringVersion === SCORING_SETTINGS_VERSION;
    return {
      ...DEFAULT_SETTINGS,
      ...stored,
      theme: THEME_MODES.includes(stored.theme) ? stored.theme : DEFAULT_SETTINGS.theme,
      scoringVersion: SCORING_SETTINGS_VERSION,
      engine: scoringIsCurrent
        ? sanitiseEngineConfig({ ...DEFAULT_ENGINE_CONFIG, ...stored.engine })
        : DEFAULT_ENGINE_CONFIG,
      thresholds: scoringIsCurrent
        ? { ...DEFAULT_THRESHOLDS, ...stored.thresholds }
        : DEFAULT_THRESHOLDS,
    };
  }, [stored]);

  const resolvedTheme: ResolvedTheme =
    settings.theme === 'system' ? (systemDark ? 'dark' : 'light') : settings.theme;

  useEffect(() => {
    document.documentElement.classList.toggle('dark', resolvedTheme === 'dark');
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLOR[resolvedTheme]);
    try {
      window.localStorage.setItem('gambit:theme', settings.theme);
    } catch {
      // Ignore storage failures; the class on <html> is what matters.
    }
  }, [resolvedTheme, settings.theme]);

  // Every writer starts from the *merged* settings, never from the raw stored blob.
  // Writing `{ ...stored, ...patch }` would resurrect values that the version check
  // above had just discarded, and leave the object unversioned for the next load.
  const update = useCallback(
    (patch: Partial<Settings>) => setStored({ ...settings, ...patch }),
    [setStored, settings],
  );

  const updateEngine = useCallback(
    (patch: Partial<EngineConfig>) =>
      setStored({ ...settings, engine: sanitiseEngineConfig({ ...settings.engine, ...patch }) }),
    [setStored, settings],
  );

  const updateThresholds = useCallback(
    (patch: Partial<ClassificationThresholds>) =>
      setStored({ ...settings, thresholds: { ...settings.thresholds, ...patch } }),
    [setStored, settings],
  );

  const reset = useCallback(() => setStored({ ...DEFAULT_SETTINGS, theme: settings.theme }), [setStored, settings.theme]);

  // The quick switch in the bar always lands on an explicit appearance: the
  // opposite of whatever is on screen, even when that came from the device.
  const toggleTheme = useCallback(
    () => setStored({ ...settings, theme: resolvedTheme === 'dark' ? 'light' : 'dark' }),
    [resolvedTheme, setStored, settings],
  );

  const value = useMemo<SettingsContextValue>(
    () => ({ ...settings, resolvedTheme, update, updateEngine, updateThresholds, reset, toggleTheme }),
    [settings, resolvedTheme, update, updateEngine, updateThresholds, reset, toggleTheme],
  );

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings(): SettingsContextValue {
  const context = useContext(SettingsContext);
  if (!context) throw new Error('useSettings must be used inside a SettingsProvider');
  return context;
}

export { DEFAULT_SETTINGS };
