import {
  CheckCircle2Icon,
  CircleDashedIcon,
  CircleDotIcon,
  CircleIcon,
  RefreshCwIcon,
  TriangleAlertIcon,
  XCircleIcon,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import type {
  AspectState,
  PullRequestReadiness,
} from '../../../../host/contract.js';
import { cn, relativeTime } from '../../../lib/utils.js';
import { Button } from '../../ui/button.js';

/** What Completion and the check list share: the state icons, and a
 *  Refresh the reader can press again without losing their place. */

/** Each state's icon, colour and the words a screen reader hears — the
 *  colour is never the only signal. */
const STATE: Record<
  AspectState,
  { icon: typeof CheckCircle2Icon; className: string; label: string }
> = {
  met: { icon: CheckCircle2Icon, className: 'text-success', label: 'Met' },
  blocked: {
    icon: XCircleIcon,
    className: 'text-destructive',
    label: 'Blocking',
  },
  waiting: {
    icon: CircleDotIcon,
    className: 'text-warning',
    label: 'Waiting',
  },
  advisory: {
    icon: TriangleAlertIcon,
    className: 'text-warning',
    label: 'Needs attention, not blocking',
  },
  observed: {
    icon: CircleIcon,
    className: 'text-muted-foreground',
    label: 'Observed',
  },
  unknown: {
    icon: CircleDashedIcon,
    className: 'text-muted-foreground',
    label: 'Not known',
  },
};

/** The whole's state, drawn like the row it most resembles, and heard in
 *  its own words; merged and closed say everything in their text. */
export const HEADLINE_STATE: Record<
  PullRequestReadiness['state'],
  { state: AspectState; label: string | null }
> = {
  ready: { state: 'met', label: 'Ready' },
  blocked: { state: 'blocked', label: 'Blocked' },
  unknown: { state: 'unknown', label: 'Not fully known' },
  merged: { state: 'met', label: null },
  closed: { state: 'observed', label: null },
};

export function StateIcon({
  state,
  label = STATE[state].label,
  severe = false,
  className,
}: {
  state: AspectState;
  /** What a screen reader hears before the text; null for nothing. */
  label?: string | null;
  severe?: boolean;
  className?: string;
}) {
  const { icon: Icon, className: tone } = STATE[state];
  return (
    <>
      <Icon
        aria-hidden
        className={cn(
          'shrink-0',
          severe ? 'text-destructive' : tone,
          className
        )}
      />
      {label && <span className="sr-only">{label}: </span>}
    </>
  );
}

export function RefreshButton({
  retrying,
  onRefresh,
  variant = 'ghost',
}: {
  retrying: boolean;
  onRefresh: () => void;
  variant?: 'ghost' | 'outline';
}) {
  return (
    // aria-disabled rather than disabled: a disabled button drops
    // keyboard focus mid-refresh. A press while one runs is ignored.
    <Button
      variant={variant}
      size="sm"
      aria-disabled={retrying}
      onClick={onRefresh}
      className="aria-disabled:pointer-events-none aria-disabled:opacity-50"
    >
      <RefreshCwIcon className={cn(retrying && 'animate-spin')} />
      Refresh
    </Button>
  );
}

/** "read 2 min ago", kept honest while it stays on screen. */
export function ReadAgo({ at }: { at: number }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick((t) => t + 1), 15_000);
    return () => clearInterval(id);
  }, []);
  return <>read {relativeTime(at)}</>;
}
