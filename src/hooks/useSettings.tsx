import { createContext, useCallback, useContext, useEffect, useMemo, type ReactNode } from 'react';
import type { ClassificationThresholds, EngineConfig } from '@/types/analysis';
import { DEFAULT_THRESHOLDS } from '@/services/classification';
import { DEFAULT_ENGINE_CONFIG, sanitiseEngineConfig } from '@/services/stockfish';
import { useLocalStorage } from './useLocalStorage';

export type BoardTheme = 'classic' | 'slate' | 'walnut' | 'ocean';
export type ThemeMode = 'dark' | 'light';

export interface Settings {
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
  update: (patch: Partial<Settings>) => void;
  updateEngine: (patch: Partial<EngineConfig>) => void;
  updateThresholds: (patch: Partial<ClassificationThresholds>) => void;
  reset: () => void;
  toggleTheme: () => void;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

/** Read the theme the pre-paint script in index.html settled on. */
function initialTheme(): ThemeMode {
  if (typeof document === 'undefined') return 'light';
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light';
}

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [stored, setStored] = useLocalStorage<Settings>('gambit:settings', {
    ...DEFAULT_SETTINGS,
    theme: initialTheme(),
  });

  // Merge with defaults so a settings object written by an older build still works.
  const settings = useMemo<Settings>(
    () => ({
      ...DEFAULT_SETTINGS,
      ...stored,
      engine: sanitiseEngineConfig({ ...DEFAULT_ENGINE_CONFIG, ...stored.engine }),
      thresholds: { ...DEFAULT_THRESHOLDS, ...stored.thresholds },
    }),
    [stored],
  );

  useEffect(() => {
    document.documentElement.classList.toggle('dark', settings.theme === 'dark');
    try {
      window.localStorage.setItem('gambit:theme', settings.theme);
    } catch {
      // Ignore storage failures; the class on <html> is what matters.
    }
  }, [settings.theme]);

  const update = useCallback(
    (patch: Partial<Settings>) => setStored((prev) => ({ ...prev, ...patch })),
    [setStored],
  );

  const updateEngine = useCallback(
    (patch: Partial<EngineConfig>) =>
      setStored((prev) => ({ ...prev, engine: sanitiseEngineConfig({ ...prev.engine, ...patch }) })),
    [setStored],
  );

  const updateThresholds = useCallback(
    (patch: Partial<ClassificationThresholds>) =>
      setStored((prev) => ({ ...prev, thresholds: { ...prev.thresholds, ...patch } })),
    [setStored],
  );

  const reset = useCallback(() => setStored({ ...DEFAULT_SETTINGS, theme: settings.theme }), [setStored, settings.theme]);

  const toggleTheme = useCallback(
    () => setStored((prev) => ({ ...prev, theme: prev.theme === 'dark' ? 'light' : 'dark' })),
    [setStored],
  );

  const value = useMemo<SettingsContextValue>(
    () => ({ ...settings, update, updateEngine, updateThresholds, reset, toggleTheme }),
    [settings, update, updateEngine, updateThresholds, reset, toggleTheme],
  );

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings(): SettingsContextValue {
  const context = useContext(SettingsContext);
  if (!context) throw new Error('useSettings must be used inside a SettingsProvider');
  return context;
}

export { DEFAULT_SETTINGS };
