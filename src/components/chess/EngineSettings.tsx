import { useState } from 'react';
import { ENGINE_LIMITS, QUICK_PASS_BUDGET_MS } from '@/services/stockfish';
import { useSettings, type BoardTheme } from '@/hooks/useSettings';
import { parallelism } from '@/workers/stockfishWorker';
import { ChevronDown } from '@/components/ui/Icons';
import { cn } from '@/utils/cn';

/**
 * Engine and classification settings.
 *
 * Changing depth / MultiPV / move time invalidates the analysis cache key, so the
 * caller re-runs the pass; the copy says so rather than letting it look like a
 * silent no-op.
 */
export function EngineSettings({ onConfigChange }: { onConfigChange?: () => void }) {
  const settings = useSettings();
  const [open, setOpen] = useState<'engine' | 'thresholds' | 'board' | null>('engine');

  const section = (key: 'engine' | 'thresholds' | 'board', label: string) => (
    <button
      type="button"
      onClick={() => setOpen((current) => (current === key ? null : key))}
      className="flex w-full items-center justify-between px-4 py-2.5 text-left transition-colors hover:bg-[var(--surface-hover)]"
      aria-expanded={open === key}
    >
      <span className="text-xs font-semibold">{label}</span>
      <ChevronDown size={15} className={cn('text-muted transition-transform', open === key && 'rotate-180')} />
    </button>
  );

  return (
    <div>
      {section('engine', 'Engine')}
      {open === 'engine' && (
        <div className="space-y-3 px-4 py-3">
          <Slider
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
          <Slider
            label="Live depth"
            hint="Depth for the position you are looking at right now."
            value={settings.engine.liveDepth}
            min={ENGINE_LIMITS.liveDepth.min}
            max={ENGINE_LIMITS.liveDepth.max}
            onChange={(liveDepth) => settings.updateEngine({ liveDepth })}
          />
          <Slider
            label="Parallel searches"
            hint={`Positions reviewed at once. Up to ${parallelism()} on this device.`}
            value={settings.engine.threads}
            min={1}
            max={parallelism()}
            onChange={(threads) => settings.updateEngine({ threads })}
          />
          <Slider
            label="Hash (MB)"
            hint="Total transposition table, shared out across the parallel searches."
            value={settings.engine.hash}
            min={ENGINE_LIMITS.hash.min}
            max={ENGINE_LIMITS.hash.max}
            step={16}
            onChange={(hash) => settings.updateEngine({ hash })}
          />
          <Slider
            label="Time per move (ms)"
            hint="0 means search to the target depth with no time cap."
            value={settings.engine.moveTimeMs}
            min={ENGINE_LIMITS.moveTimeMs.min}
            max={ENGINE_LIMITS.moveTimeMs.max}
            step={100}
            onChange={(moveTimeMs) => {
              settings.updateEngine({ moveTimeMs });
              onConfigChange?.();
            }}
          />
          <Slider
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
          <Toggle
            label="Quick first pass"
            hint={`A complete review in about ${Math.round(QUICK_PASS_BUDGET_MS / 1000)}s, then refined at the depth above. Off: nothing appears until the full pass finishes.`}
            checked={settings.engine.quickPass}
            onChange={(quickPass) => settings.updateEngine({ quickPass })}
          />
          <Toggle
            label="Analyse automatically"
            checked={settings.autoAnalyse}
            onChange={(autoAnalyse) => settings.update({ autoAnalyse })}
          />
        </div>
      )}

      {section('thresholds', 'Move classification')}
      {open === 'thresholds' && (
        <div className="space-y-3 px-4 py-3">
          <p className="text-muted text-[11px] leading-relaxed">
            Thresholds are in <strong>expected points</strong> given away, not pawns — so the same
            evaluation drop counts for more in a close game than in a decided one. The defaults are
            tuned to match how Chess.com labels the same game.
          </p>
          <Slider
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
          <Slider
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
          <Slider
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
          <Slider
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
          <Slider
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
          <Slider
            label="Book depth (plies)"
            value={settings.thresholds.bookDepth}
            min={0}
            max={30}
            onChange={(bookDepth) => {
              settings.updateThresholds({ bookDepth });
              onConfigChange?.();
            }}
          />
          <button type="button" className="btn btn-ghost w-full" onClick={settings.reset}>
            Reset all settings
          </button>
        </div>
      )}

      {section('board', 'Board')}
      {open === 'board' && (
        <div className="space-y-3 px-4 py-3">
          <div>
            <p className="mb-1.5 text-xs font-medium">Theme</p>
            <div className="grid grid-cols-4 gap-1.5">
              {(['classic', 'slate', 'walnut', 'ocean'] as BoardTheme[]).map((theme) => (
                <button
                  key={theme}
                  type="button"
                  onClick={() => settings.update({ boardTheme: theme })}
                  data-board={theme}
                  className={cn(
                    'flex h-9 overflow-hidden rounded-md border-2 transition-colors',
                    settings.boardTheme === theme ? 'border-brand-500' : 'border-transparent',
                  )}
                  title={theme}
                  aria-label={`${theme} board theme`}
                >
                  <span className="flex-1" style={{ background: 'var(--board-light)' }} />
                  <span className="flex-1" style={{ background: 'var(--board-dark)' }} />
                </button>
              ))}
            </div>
          </div>
          <Toggle
            label="Coordinates"
            checked={settings.showCoordinates}
            onChange={(showCoordinates) => settings.update({ showCoordinates })}
          />
          <Toggle
            label="Best-move arrow"
            checked={settings.showBestMoveArrow}
            onChange={(showBestMoveArrow) => settings.update({ showBestMoveArrow })}
          />
          <Toggle
            label="Animations"
            checked={settings.animations}
            onChange={(animations) => settings.update({ animations })}
          />
        </div>
      )}
    </div>
  );
}

function Slider({
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
  return (
    <label className={cn('block', disabled && 'opacity-55')}>
      <span className="flex items-center justify-between text-xs font-medium">
        {label}
        <span className="text-muted font-mono tabular-nums">{format ? format(value) : value}</span>
      </span>
      <input
        type="range"
        className="accent-brand-500 mt-1.5 w-full"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      {hint && <span className="text-muted mt-0.5 block text-[11px] leading-snug">{hint}</span>}
    </label>
  );
}

function Toggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="block cursor-pointer">
      <span className="flex items-center justify-between gap-3 text-xs font-medium">
        {label}
        <button
          type="button"
          role="switch"
          aria-checked={checked}
          onClick={() => onChange(!checked)}
          className={cn(
            'is-pill relative h-5 w-9 shrink-0 transition-colors',
            checked ? 'bg-brand-500' : 'bg-[var(--surface-sunken)] ring-1 ring-[var(--border-strong)] ring-inset',
          )}
        >
          <span
            className={cn(
              'is-pill absolute top-0.5 h-4 w-4 bg-white shadow transition-[left]',
              checked ? 'left-[1.125rem]' : 'left-0.5',
            )}
          />
        </button>
      </span>
      {hint && <span className="text-muted mt-0.5 block text-[11px] leading-snug">{hint}</span>}
    </label>
  );
}
