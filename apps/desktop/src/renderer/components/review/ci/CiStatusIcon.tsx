import {
  BanIcon,
  CheckCircle2Icon,
  CircleDashedIcon,
  CircleHelpIcon,
  CircleMinusIcon,
  ClockIcon,
  Loader2Icon,
  PauseCircleIcon,
  TriangleAlertIcon,
  XCircleIcon,
  type LucideIcon,
} from 'lucide-react';
import type { CiStatus } from '@n10/vcs-core/ci';
import { CI_STATUS_LABEL } from '../../../lib/review/ci-model.js';
import { cn } from '../../../lib/utils.js';

const ICONS: Record<CiStatus, { icon: LucideIcon; className: string }> = {
  queued: { icon: ClockIcon, className: 'text-muted-foreground' },
  waiting: { icon: PauseCircleIcon, className: 'text-warning' },
  running: { icon: Loader2Icon, className: 'animate-spin text-info' },
  succeeded: { icon: CheckCircle2Icon, className: 'text-success' },
  warning: { icon: TriangleAlertIcon, className: 'text-warning' },
  failed: { icon: XCircleIcon, className: 'text-destructive' },
  cancelled: { icon: BanIcon, className: 'text-muted-foreground' },
  skipped: { icon: CircleMinusIcon, className: 'text-muted-foreground' },
  neutral: { icon: CircleDashedIcon, className: 'text-muted-foreground' },
  unknown: { icon: CircleHelpIcon, className: 'text-muted-foreground' },
};

/** A status as an icon with its name, never as colour alone. */
export function CiStatusIcon({
  status,
  className,
}: {
  status: CiStatus;
  className?: string;
}) {
  const { icon: Icon, className: tone } = ICONS[status];
  return (
    <Icon
      role="img"
      aria-label={CI_STATUS_LABEL[status]}
      data-ci-status={status}
      className={cn('size-3.5 shrink-0', tone, className)}
    />
  );
}
