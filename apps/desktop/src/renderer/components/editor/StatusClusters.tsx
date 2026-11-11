import {
  BellIcon,
  CircleAlertIcon,
  CircleCheckIcon,
  CircleXIcon,
  LoaderCircleIcon,
  type LucideIcon,
} from 'lucide-react';
import { statusCounts, type TabStatus } from '../../lib/tabs/tab-groups.js';
import { cn } from '../../lib/utils.js';

/** Each state's icon and colour token; idle has none. */
export const STATUS_MARK: Partial<
  Record<TabStatus, { Icon: LucideIcon; className: string }>
> = {
  blocked: { Icon: CircleAlertIcon, className: 'text-warning' },
  error: { Icon: CircleXIcon, className: 'text-destructive' },
  'done-unseen': { Icon: CircleCheckIcon, className: 'text-success' },
  'new-output': { Icon: BellIcon, className: 'text-info' },
  working: { Icon: LoaderCircleIcon, className: 'text-muted-foreground' },
};

/** A group's states, one icon and count per state present, worst
 *  first. Static: the chip never animates. The summary is the
 *  enclosing control's to say. */
export function StatusClusters({
  statuses,
}: {
  statuses: readonly TabStatus[];
}) {
  return (
    <>
      {statusCounts(statuses).map(({ status, count }) => {
        const mark = STATUS_MARK[status];
        if (!mark) return null;
        return (
          <span
            key={status}
            aria-hidden
            data-status={status}
            className={cn(
              'flex items-center gap-[3px] text-[11px] leading-4 tabular-nums',
              mark.className
            )}
          >
            <mark.Icon className="size-3" />
            {count}
          </span>
        );
      })}
    </>
  );
}
