import type { ReactNode } from 'react';
import { cn } from '@/utils/cn';
import { AlertIcon, InboxIcon, RefreshIcon } from './Icons';

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('skeleton', className)} aria-hidden="true" />;
}

export function Spinner({ className, size = 16 }: { className?: string; size?: number }) {
  return (
    <svg
      className={cn('animate-spin', className)}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      role="status"
      aria-label="Loading"
    >
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.2" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

interface StateProps {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}

export function ErrorState({ title, description, action, className }: StateProps) {
  return (
    <div className={cn('flex flex-col items-center gap-3 px-6 py-12 text-center', className)} role="alert">
      <span className="flex h-11 w-11 items-center justify-center rounded-full chip-danger">
        <AlertIcon size={20} />
      </span>
      <div className="space-y-1">
        <p className="text-sm font-semibold">{title}</p>
        {description && <p className="text-secondary mx-auto max-w-sm text-sm">{description}</p>}
      </div>
      {action}
    </div>
  );
}

export function EmptyState({ title, description, action, className }: StateProps) {
  return (
    <div className={cn('flex flex-col items-center gap-3 px-6 py-12 text-center', className)}>
      <span className="text-muted surface-raised flex h-11 w-11 items-center justify-center rounded-full">
        <InboxIcon size={20} />
      </span>
      <div className="space-y-1">
        <p className="text-sm font-semibold">{title}</p>
        {description && <p className="text-secondary mx-auto max-w-sm text-sm">{description}</p>}
      </div>
      {action}
    </div>
  );
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
      className={cn('surface-sunken is-pill h-1.5 w-full overflow-hidden', className)}
      role="progressbar"
      aria-valuenow={Math.round(clamped)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div
        className={cn(
          'is-pill h-full transition-[width] duration-300 ease-out',
          tone === 'brand' ? 'bg-brand-500' : 'surface-raised',
        )}
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}
