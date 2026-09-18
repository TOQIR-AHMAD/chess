import { useEffect } from 'react';
import { LargeTitle, usePageTitle } from '@/hooks/useShell';
import { useSettings, type ThemeMode } from '@/hooks/useSettings';
import { EngineSettings } from '@/components/chess/EngineSettings';
import { FormSection, SegmentedControl } from '@/components/ui/Controls';

const APPEARANCES: Array<{ value: ThemeMode; label: string }> = [
  { value: 'system', label: 'Automatic' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

/**
 * The app's Settings screen: appearance, then the same engine, classification
 * and board settings the review workspace opens beside the board. Everything is
 * saved in this browser as it changes — there is nothing to confirm.
 */
export function SettingsPage() {
  usePageTitle('Settings');
  const settings = useSettings();

  useEffect(() => {
    document.title = 'Settings — Gambit Review';
    return () => {
      document.title = 'Gambit Review — Chess Game Analysis';
    };
  }, []);

  return (
    <div className="mx-auto w-full max-w-[42rem] space-y-6 pt-1 pb-4">
      <LargeTitle>Settings</LargeTitle>

      <FormSection title="Appearance">
        <div className="cell">
          <SegmentedControl
            label="Appearance"
            className="w-full"
            options={APPEARANCES}
            value={settings.theme}
            onChange={(theme) => settings.update({ theme })}
          />
        </div>
      </FormSection>

      <EngineSettings />
    </div>
  );
}
