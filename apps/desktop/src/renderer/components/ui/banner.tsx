import { AlertTriangleIcon } from 'lucide-react';
import type { ComponentProps, ReactNode } from 'react';
import { cn } from '../../lib/utils.js';

/**
 * A full-width status line at the top of a pane: something about what
 * the pane shows that the reader should know before trusting it — a
 * switched branch, a dropped connection, a pull request that moved.
 * Warning-toned with its icon, so the state never rests on colour
 * alone; `actions` sit at the end.
 */
export function Banner({
  children,
  actions,
  className,
  ...props
}: Omit<ComponentProps<'div'>, 'role'> & { actions?: ReactNode }) {
  return (
    <div
      role="status"
      className={cn(
        'flex shrink-0 items-center gap-2 border-b border-warning/30 bg-warning/10 px-3 py-1.5 text-sm text-warning',
        className
      )}
      {...props}
    >
      <AlertTriangleIcon className="size-4 shrink-0" />
      {/* Wraps rather than truncates: the state is the point, and a
          narrow or zoomed window must still show all of it. */}
      <span className="min-w-0 flex-1 text-pretty">{children}</span>
      {actions}
    </div>
  );
}
