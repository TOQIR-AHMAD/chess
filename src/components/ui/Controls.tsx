import type { ReactNode } from 'react';
import { cn } from '@/utils/cn';

/**
 * The iOS form controls, built on the `.switch`, `.segmented` and `.list-group`
 * styles in index.css. They carry no state of their own.
 */

/** An iOS switch. Give it a name with `label`, or wrap it in a `<label>`. */
export function Switch({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      className="switch"
      onClick={() => onChange(!checked)}
    />
  );
}

export interface SegmentOption<T extends string | number> {
  value: T;
  label: ReactNode;
  /** Accessible name when `label` is not plain text. */
  title?: string;
}

/** A segmented control choosing one value — a radio group, drawn the iOS way. */
export function SegmentedControl<T extends string | number>({
  options,
  value,
  onChange,
  label,
  className,
}: {
  options: Array<SegmentOption<T>>;
  value: T;
  onChange: (value: T) => void;
  /** Accessible name for the group. */
  label: string;
  className?: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className={cn('segmented', className)}>
      {options.map((option) => (
        <button
          key={String(option.value)}
          type="button"
          role="radio"
          aria-checked={option.value === value}
          title={option.title}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/**
 * One section of an inset-grouped form: the small gray header, the white card of
 * rows, and an optional footer note beneath it.
 */
export function FormSection({
  title,
  footer,
  children,
  className,
}: {
  title?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={className}>
      {title && <h2 className="group-header">{title}</h2>}
      <div className="list-group">{children}</div>
      {footer && <p className="group-footer">{footer}</p>}
    </section>
  );
}
