import type { CSSProperties, ReactNode } from 'react';
import { ENGINE_LIMITS, QUICK_PASS_BUDGET_MS } from '@/services/stockfish';
import { useSettings, type BoardTheme } from '@/hooks/useSettings';
import { parallelism } from '@/workers/stockfishWorker';
import { FormSection, Switch } from '@/components/ui/Controls';
import { CheckIcon } from '@/components/ui/Icons';
import { cn } from '@/utils/cn';

const BOARD_THEMES: Array<{ key: BoardTheme; label: string }> = [
  { key: 'classic', label: 'Classic' },
  { key: 'slate', label: 'Slate' },
  { key: 'walnut', label: 'Walnut' },
  { key: 'ocean', label: 'Ocean' },
];

/**
 * Engine, classification and board settings, as an inset-grouped iOS form: a
 * section per subject, a row per setting, the explanation under the row it
 * explains, and the destructive reset on its own at the foot.
 *
 * Changing depth / MultiPV / move time invalidates the analysis cache key, so the
 * caller re-runs the pass.
 */
export function EngineSettings({ onConfigChange }: { onConfigChange?: () => void }) {
  const settings = useSettings();

  return (
    <div className="space-y-6">
      <FormSection title="Engine">
        <SliderRow
          label="Analysis depth"
          hint="Depth used for the full-game pass. Higher is more accurate and slower."
          value={settings.engine.depth}
          min={ENGINE_LIMITS.depth.min}
          max={ENGINE_LIMITS.depth.max}
          onChange={(depth) => {
            settings.updateEngine({ depth });
            onConfigChange?.();
          }}
        />
        <SliderRow
          label="Live depth"
          hint="Depth for the position you are looking at right now."
          value={settings.engine.liveDepth}
          min={ENGINE_LIMITS.liveDepth.min}
          max={ENGINE_LIMITS.liveDepth.max}
          onChange={(liveDepth) => settings.updateEngine({ liveDepth })}
        />
        <SliderRow
          label="Parallel searches"
          hint={`Positions reviewed at once. Up to ${parallelism()} on this device.`}
          value={settings.engine.threads}
          min={1}
          max={parallelism()}
          onChange={(threads) => settings.updateEngine({ threads })}
        />
        <SliderRow
          label="Hash"
          hint="Total transposition table, shared out across the parallel searches."
          value={settings.engine.hash}
          min={ENGINE_LIMITS.hash.min}
          max={ENGINE_LIMITS.hash.max}
          step={16}
          format={(v) => `${v} MB`}
          onChange={(hash) => settings.updateEngine({ hash })}
        />
        <SliderRow
          label="Time per move"
          hint="0 means search to the target depth with no time cap."
          value={settings.engine.moveTimeMs}
          min={ENGINE_LIMITS.moveTimeMs.min}
          max={ENGINE_LIMITS.moveTimeMs.max}
          step={100}
          format={(v) => (v === 0 ? 'No cap' : `${v} ms`)}
          onChange={(moveTimeMs) => {
            settings.updateEngine({ moveTimeMs });
            onConfigChange?.();
          }}
        />
        <SliderRow
          label="Lines (MultiPV)"
          hint="Alternative lines to calculate. 2 or more enables sharper brilliant-move detection."
          value={settings.engine.multiPv}
          min={ENGINE_LIMITS.multiPv.min}
          max={ENGINE_LIMITS.multiPv.max}
          onChange={(multiPv) => {
            settings.updateEngine({ multiPv });
            onConfigChange?.();
          }}
        />
        <SwitchRow
          label="Quick first pass"
          hint={`A complete review in about ${Math.round(QUICK_PASS_BUDGET_MS / 1000)}s, then refined at the depth above. Off: nothing appears until the full pass finishes.`}
          checked={settings.engine.quickPass}
          onChange={(quickPass) => settings.updateEngine({ quickPass })}
        />
        <SwitchRow
          label="Analyse automatically"
          checked={settings.autoAnalyse}
          onChange={(autoAnalyse) => settings.update({ autoAnalyse })}
        />
      </FormSection>

      <FormSection
        title="Move classification"
        footer={
          <>
            Thresholds are in expected points given away, not pawns — so the same evaluation drop
            counts for more in a close game than in a decided one. The defaults are tuned to match how
            Chess.com labels the same game.
          </>
        }
      >
        <SliderRow
          label="Inaccuracy at"
          value={settings.thresholds.inaccuracy}
          min={1}
          max={15}
          step={0.5}
          format={(v) => `${v.toFixed(1)} pts`}
          onChange={(inaccuracy) => {
            settings.updateThresholds({ inaccuracy });
            onConfigChange?.();
          }}
        />
        <SliderRow
          label="Mistake at"
          value={settings.thresholds.mistake}
          min={5}
          max={25}
          step={0.5}
          format={(v) => `${v.toFixed(1)} pts`}
          onChange={(mistake) => {
            settings.updateThresholds({ mistake });
            onConfigChange?.();
          }}
        />
        <SliderRow
          label="Blunder at"
          value={settings.thresholds.blunder}
          min={10}
          max={45}
          step={1}
          format={(v) => `${v.toFixed(0)} pts`}
          onChange={(blunder) => {
            settings.updateThresholds({ blunder });
            onConfigChange?.();
          }}
        />
        <SliderRow
          label="Miss at"
          hint="Expected points thrown away from a winning position before a move counts as a miss."
          value={settings.thresholds.missedWin}
          min={5}
          max={30}
          step={1}
          format={(v) => `${v.toFixed(0)} pts`}
          onChange={(missedWin) => {
            settings.updateThresholds({ missedWin });
            onConfigChange?.();
          }}
        />
        <SliderRow
          label="Brilliant sacrifice"
          hint="Minimum material given up for a move to qualify as brilliant."
          value={settings.thresholds.brilliantSacrifice}
          min={0.5}
          max={5}
          step={0.25}
          format={(v) => v.toFixed(2)}
          onChange={(brilliantSacrifice) => {
            settings.updateThresholds({ brilliantSacrifice });
            onConfigChange?.();
          }}
        />
        <SliderRow
          label="Book depth"
          value={settings.thresholds.bookDepth}
          min={0}
          max={30}
          format={(v) => `${v} plies`}
          onChange={(bookDepth) => {
            settings.updateThresholds({ bookDepth });
            onConfigChange?.();
          }}
        />
      </FormSection>

      <FormSection title="Board">
        <div className="cell flex-col items-stretch gap-2.5 py-3">
          <span className="text-[15px]">Theme</span>
          <div className="grid max-w-[24rem] grid-cols-4 gap-2.5" role="radiogroup" aria-label="Board theme">
            {BOARD_THEMES.map(({ key, label }) => {
              const selected = settings.boardTheme === key;
              return (
                <button
                  key={key}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  data-board={key}
                  onClick={() => settings.update({ boardTheme: key })}
                  className="flex min-w-0 cursor-pointer flex-col items-center gap-1.5"
                >
                  <span
                    className={cn(
                      'relative grid aspect-[4/3] w-full grid-cols-2 grid-rows-2 overflow-hidden rounded-[10px] transition-shadow',
                      selected
                        ? 'shadow-[0_0_0_2px_var(--surface-panel),0_0_0_4px_var(--tint)]'
                        : 'shadow-[0_0_0_1px_var(--border-subtle)]',
                    )}
                    aria-hidden="true"
                  >
                    <span style={{ background: 'var(--board-light)' }} />
                    <span style={{ background: 'var(--board-dark)' }} />
                    <span style={{ background: 'var(--board-dark)' }} />
                    <span style={{ background: 'var(--board-light)' }} />
                    {selected && (
                      <span className="bg-brand-500 absolute right-1 bottom-1 flex h-4.5 w-4.5 items-center justify-center rounded-full text-white">
                        <CheckIcon size={11} strokeWidth={3} />
                      </span>
                    )}
                  </span>
                  <span className={cn('text-[12px]', selected ? 'text-accent font-semibold' : 'text-muted')}>
                    {label}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
        <SwitchRow
          label="Coordinates"
          checked={settings.showCoordinates}
          onChange={(showCoordinates) => settings.update({ showCoordinates })}
        />
        <SwitchRow
          label="Best-move arrow"
          checked={settings.showBestMoveArrow}
          onChange={(showBestMoveArrow) => settings.update({ showBestMoveArrow })}
        />
        <SwitchRow
          label="Animations"
          checked={settings.animations}
          onChange={(animations) => settings.update({ animations })}
        />
      </FormSection>

      <div className="list-group">
        <button type="button" className="cell text-danger justify-center text-[15px]" onClick={settings.reset}>
          Reset All Settings
        </button>
      </div>
    </div>
  );
}

function SliderRow({
  label,
  hint,
  value,
  min,
  max,
  step = 1,
  disabled,
  format,
  onChange,
}: {
  label: string;
  hint?: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  disabled?: boolean;
  format?: (value: number) => string;
  onChange: (value: number) => void;
}) {
  // The tint runs to the knob's centre, which travels the track less its own width.
  const ratio = max > min ? Math.max(0, Math.min(1, (value - min) / (max - min))) : 0;
  const fill = { '--fill': `calc(14px + (100% - 28px) * ${ratio})` } as CSSProperties;

  return (
    <label className={cn('cell flex-col items-stretch gap-1 py-3', disabled && 'opacity-55')}>
      <span className="flex items-center justify-between gap-3 text-[15px]">
        {label}
        <span className="text-muted tabular-nums">{format ? format(value) : value}</span>
      </span>
      <input
        type="range"
        className="slider"
        style={fill}
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      {hint && <span className="text-muted block text-[13px] leading-snug">{hint}</span>}
    </label>
  );
}

function SwitchRow({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: ReactNode;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="cell">
      <span className="min-w-0 flex-1">
        <span className="block text-[15px]">{label}</span>
        {hint && <span className="text-muted mt-0.5 block text-[13px] leading-snug">{hint}</span>}
      </span>
      <Switch checked={checked} onChange={onChange} label={label} />
    </div>
  );
}
