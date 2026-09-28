import {
  CheckCircle2Icon,
  ChevronRightIcon,
  CircleDashedIcon,
  CircleDotIcon,
  CircleIcon,
  RefreshCwIcon,
  TriangleAlertIcon,
  XCircleIcon,
} from 'lucide-react';
import type { Ref } from 'react';
import type {
  AspectState,
  CheckList,
  PullRequestChecksAnswer,
  PullRequestReadiness,
} from '../../../../host/contract.js';
import type { ReadState } from '../../../lib/data/read-state.js';
import {
  ASPECT_LABEL,
  checksLabel,
  headline,
  RESOLVER_TEXT,
} from '../../../lib/review/readiness-model.js';
import { cn } from '../../../lib/utils.js';
import { Button } from '../../ui/button.js';
import { Skeleton } from '../../ui/skeleton.js';
import { ReadFailure, StaleNotice } from '../ReadNotice.js';
import { Section } from './parts.js';

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
    label: 'Not known if required',
  },
  unknown: {
    icon: CircleDashedIcon,
    className: 'text-muted-foreground',
    label: 'Not known',
  },
};

/** The whole's state, drawn like the row it most resembles. */
const HEADLINE_STATE: Record<PullRequestReadiness['state'], AspectState> = {
  ready: 'met',
  blocked: 'blocked',
  unknown: 'unknown',
  merged: 'met',
  closed: 'observed',
};

function StateIcon({
  state,
  severe = false,
  className,
}: {
  state: AspectState;
  severe?: boolean;
  className?: string;
}) {
  const { icon: Icon, className: tone, label } = STATE[state];
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
      <span className="sr-only">{label}: </span>
    </>
  );
}

function Headline({
  readiness,
  provider,
}: {
  readiness: PullRequestReadiness;
  provider: string | null;
}) {
  const { text, detail } = headline(readiness, provider);
  const first = readiness.state === 'blocked' ? readiness.blockers[0] : null;
  // Blocked by something under way reads as waiting, not as a failure.
  const state = first?.pending ? 'waiting' : HEADLINE_STATE[readiness.state];
  return (
    <div data-readiness-headline={readiness.state} className="flex gap-2">
      <StateIcon state={state} className="mt-0.5 size-4" />
      <div className="min-w-0">
        <p className="font-medium">{text}</p>
        {first && (
          <p className="text-sm text-muted-foreground">
            {RESOLVER_TEXT[first.resolvedBy]}
          </p>
        )}
        {detail && <p className="text-sm text-muted-foreground">{detail}</p>}
      </div>
    </div>
  );
}

/** The blockers after the first, each with who can clear it. */
function MoreBlockers({ readiness }: { readiness: PullRequestReadiness }) {
  const rest = readiness.blockers.slice(1);
  if (readiness.state !== 'blocked' || rest.length === 0) return null;
  return (
    <ul aria-label="Also blocking" className="mt-2 space-y-1 pl-6 text-sm">
      {rest.map((b) => (
        <li key={`${b.kind}:${b.text}`} data-readiness-blocker={b.kind}>
          {b.text}
          <span className="text-muted-foreground">
            {' '}
            · {RESOLVER_TEXT[b.resolvedBy]}
          </span>
        </li>
      ))}
    </ul>
  );
}

function Aspects({ readiness }: { readiness: PullRequestReadiness }) {
  return (
    <ul className="mt-3 space-y-1.5 text-sm">
      {readiness.aspects.map((a) => (
        <li
          key={a.id}
          data-readiness-row={a.id}
          className="flex items-start gap-2"
        >
          <StateIcon
            state={a.state}
            severe={a.severe}
            className="mt-0.5 size-3.5"
          />
          <span className="w-20 shrink-0 text-muted-foreground">
            {ASPECT_LABEL[a.id]}
          </span>
          <span className="min-w-0 break-words">{a.text}</span>
        </li>
      ))}
    </ul>
  );
}

export interface ReadinessProps {
  /** Core's readiness and check list, as far as they were read. */
  read: ReadState<PullRequestChecksAnswer>;
  provider: string | null;
  refreshing: boolean;
  onRefresh: () => void;
  onViewChecks: () => void;
  /** The View checks button, which Back returns the keyboard to. */
  checksRef?: Ref<HTMLButtonElement>;
}

function Actions({
  readiness,
  list,
  refreshing,
  onRefresh,
  onViewChecks,
  checksRef,
}: {
  readiness: PullRequestReadiness;
  list: CheckList | null;
} & Omit<ReadinessProps, 'read' | 'provider'>) {
  return (
    <div className="mt-3 flex flex-wrap gap-2">
      {list && (
        <Button
          ref={checksRef}
          variant="outline"
          size="sm"
          disabled={list.rows.length === 0}
          onClick={onViewChecks}
        >
          {checksLabel(list)}
          <ChevronRightIcon />
        </Button>
      )}
      {readiness.state === 'unknown' && (
        <Button
          variant="ghost"
          size="sm"
          aria-busy={refreshing}
          disabled={refreshing}
          onClick={onRefresh}
        >
          <RefreshCwIcon className={cn(refreshing && 'animate-spin')} />
          Refresh
        </Button>
      )}
    </div>
  );
}

/**
 * What stands between the pull request and completion, as core decided
 * it: the verdict in one sentence with who can act, then one row per
 * fact. It is never "ready" unless the provider says so; where not
 * everything was read it says so, with Refresh.
 */
export function PrReadiness(props: ReadinessProps) {
  const { read, provider, refreshing, onRefresh } = props;
  return (
    <Section title="Completion">
      {read.kind === 'failed' ? (
        <ReadFailure
          title="Couldn't read what completion needs"
          error={read.error}
          retrying={refreshing}
          onRetry={onRefresh}
          stacked
        />
      ) : read.kind === 'loading' ? (
        <div aria-busy className="space-y-2">
          <Skeleton className="h-5 w-48" />
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-4 w-36" />
        </div>
      ) : (
        <>
          {read.stale && (
            <StaleNotice
              what="completion"
              stale={read.stale}
              retrying={refreshing}
              onRetry={onRefresh}
              stacked
              className="mb-2"
            />
          )}
          <Headline readiness={read.data.readiness} provider={provider} />
          <MoreBlockers readiness={read.data.readiness} />
          <Aspects readiness={read.data.readiness} />
          <Actions
            {...props}
            readiness={read.data.readiness}
            list={read.data.list}
          />
        </>
      )}
    </Section>
  );
}
