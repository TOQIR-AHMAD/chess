import type { ReactNode } from 'react';
import { cn } from '@/utils/cn';

interface PanelProps {
  title?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  /** Removes body padding for lists that manage their own spacing. */
  flush?: boolean;
}

/**
 * A section of the page: its title sits above the card, bold and left-aligned
 * with any actions opposite, the way iOS heads the sections of the App Store or
 * Health — and the content sits in the rounded card beneath.
 */
export function Panel({ title, actions, children, className, bodyClassName, flush }: PanelProps) {
  return (
    <section className={cn('flex min-h-0 flex-col', className)}>
      {(title || actions) && (
        <header className="section-header shrink-0">
          {typeof title === 'string' ? <h2 className="panel-title">{title}</h2> : (title ?? <span />)}
          {actions}
        </header>
      )}
      <div className={cn('panel min-h-0 flex-1', flush ? '' : 'p-4', bodyClassName)}>{children}</div>
    </section>
  );
}
