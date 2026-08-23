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

export function Panel({ title, actions, children, className, bodyClassName, flush }: PanelProps) {
  return (
    <section className={cn('panel flex min-h-0 flex-col', className)}>
      {(title || actions) && (
        <header className="panel-header shrink-0">
          {typeof title === 'string' ? <h2 className="panel-title">{title}</h2> : title}
          {actions}
        </header>
      )}
      <div className={cn('min-h-0 flex-1', flush ? '' : 'p-4', bodyClassName)}>{children}</div>
    </section>
  );
}
