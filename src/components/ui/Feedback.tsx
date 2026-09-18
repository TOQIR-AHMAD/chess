import type { ReactNode } from 'react';
import { cn } from '@/utils/cn';
import { AlertIcon, InboxIcon, RefreshIcon } from './Icons';

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('skeleton', className)} aria-hidden="true" />;
}

/** The eight spokes of the iOS activity indicator, brightest at the leading edge. */
const SPOKES = Array.from({ length: 8 }, (_, index) => index);

/**
 * The iOS activity indicator. The spokes fade from the leading one backwards, and
 * the whole wheel steps round a spoke at a time rather than spinning smoothly.
 */
export function Spinner({ className, size = 16 }: { className?: string; size?: number }) {
  return (
    <svg
      className={cn('ios-spinner shrink-0', className)}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      role="status"
      aria-label="Loading"
    >
      {SPOKES.map((index) => (
        <line
          key={index}
          x1="12"
          y1="2.5"
          x2="12"
          y2="7"
          stroke="currentColor"
          strokeWidth="2.4"
          strokeLinecap="round"
          opacity={0.2 + (0.8 * index) / 7}
          transform={`rotate(${index * 45} 12 12)`}
        />
      ))}
    </svg>
  );
}

interface StateProps {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}

/** Laid out like iOS's ContentUnavailableView: a large glyph, a bold title, a gray line. */
function UnavailableView({
  icon,
  title,
  description,
  action,
  className,
  role,
}: StateProps & { icon: ReactNode; role?: 'alert' }) {
  return (
    <div className={cn('flex flex-col items-center gap-3 px-6 py-12 text-center', className)} role={role}>
      {icon}
      <div className="space-y-1">
        <p className="text-[20px] leading-tight font-bold tracking-[-0.015em]">{title}</p>
        {description && <p className="text-muted mx-auto max-w-sm text-[15px] leading-snug">{description}</p>}
      </div>
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}

export function ErrorState(props: StateProps) {
  return (
    <UnavailableView
      {...props}
      role="alert"
      icon={<AlertIcon size={44} strokeWidth={1.5} className="text-danger" />}
    />
  );
}

export function EmptyState(props: StateProps) {
  return <UnavailableView {...props} icon={<InboxIcon size={44} strokeWidth={1.5} className="text-tertiary" />} />;
}

export function RetryButton({ onClick, label = 'Try again' }: { onClick: () => void; label?: string }) {
  return (
    <button type="button" className="btn btn-subtle" onClick={onClick}>
      <RefreshIcon size={15} />
      {label}
    </button>
  );
}

/** Determinate progress bar used for engine loading and analysis. */
export function ProgressBar({
  value,
  className,
  tone = 'brand',
}: {
  value: number;
  className?: string;
  tone?: 'brand' | 'neutral';
}) {
  const clamped = Math.max(0, Math.min(100, value));
  return (
    <div
      className={cn('ios-progress', className)}
      role="progressbar"
      aria-valuenow={Math.round(clamped)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <span
        style={{ width: `${clamped}%`, background: tone === 'neutral' ? 'var(--text-muted)' : undefined }}
      />
    </div>
  );
}
