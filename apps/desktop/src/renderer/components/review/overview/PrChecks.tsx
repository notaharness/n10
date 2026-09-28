import {
  ArrowLeftIcon,
  CheckCircle2Icon,
  CircleDashedIcon,
  CircleDotIcon,
  CircleIcon,
  ExternalLinkIcon,
  TriangleAlertIcon,
  XCircleIcon,
} from 'lucide-react';
import { useEffect, useRef } from 'react';
import type {
  CheckList,
  CheckRow,
  CheckStanding,
  PullRequestChecksAnswer,
} from '../../../../host/contract.js';
import type { ReadState } from '../../../lib/data/read-state.js';
import { openLink } from '../../../lib/open-link.js';
import {
  duration,
  failureText,
  outcomeText,
  REQUIREMENT_LABEL,
  requiredFrom,
  shortOid,
  waitsFor,
} from '../../../lib/review/readiness-model.js';
import { cn, relativeTime } from '../../../lib/utils.js';
import { Badge } from '../../ui/badge.js';
import { Button } from '../../ui/button.js';
import { Skeleton } from '../../ui/skeleton.js';
import { ReadFailure, StaleNotice } from '../ReadNotice.js';
import { RefreshButton } from './ReadinessParts.js';

/** Each standing's icon and colour; the words beside it carry it too. */
const STANDING: Record<
  CheckStanding,
  { icon: typeof CheckCircle2Icon; className: string }
> = {
  blocking: { icon: XCircleIcon, className: 'text-destructive' },
  waiting: { icon: CircleDotIcon, className: 'text-warning' },
  unknown: { icon: CircleDashedIcon, className: 'text-muted-foreground' },
  advisory: { icon: TriangleAlertIcon, className: 'text-warning' },
  passed: { icon: CheckCircle2Icon, className: 'text-success' },
  neutral: { icon: CircleIcon, className: 'text-muted-foreground' },
};

/** Where it reported, when that is not the head, and what it ran on. */
function Provenance({ row }: { row: CheckRow }) {
  const { check, stale } = row;
  if (!check.revision) return null;
  return (
    <span
      className={cn('font-mono', stale && 'text-warning')}
      title={stale ? 'Reported on an older revision than the head' : undefined}
    >
      {shortOid(check.revision)}
      {stale && <span className="font-sans"> · older revision</span>}
      {check.ranOn === 'merge' && (
        <span className="font-sans"> · test merge</span>
      )}
    </span>
  );
}

function Facts({ row }: { row: CheckRow }) {
  const { check } = row;
  const took = duration(check);
  const from = requiredFrom(check);
  const facts = [
    check.group,
    check.source,
    check.attempt && check.attempt > 1 ? `attempt ${check.attempt}` : null,
    took,
    from,
    waitsFor(check),
  ].filter((f): f is string => Boolean(f));
  return (
    <p className="flex flex-wrap gap-x-1 text-xs text-muted-foreground [&>*+*]:before:mr-1 [&>*+*]:before:content-['·']">
      {facts.map((f) => (
        <span key={f}>{f}</span>
      ))}
      <Provenance row={row} />
    </p>
  );
}

function Row({ row }: { row: CheckRow }) {
  const { check, standing } = row;
  const { icon: Icon, className: tone } = STANDING[standing];
  // A pass on an older push says nothing about the head: not green.
  const className =
    row.stale && standing === 'passed' ? 'text-muted-foreground' : tone;
  return (
    <li
      data-check={check.key}
      data-check-standing={standing}
      className="flex items-start gap-3 border-b border-border py-2 last:border-b-0"
    >
      <Icon aria-hidden className={cn('mt-0.5 size-4 shrink-0', className)} />
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-baseline gap-x-2">
          <span className="break-words font-medium">{check.name}</span>
          <span className={cn('text-sm', className)}>{outcomeText(check)}</span>
          {check.kind === 'policy' && (
            <span className="text-xs text-muted-foreground">policy</span>
          )}
        </p>
        <Facts row={row} />
      </div>
      <Badge
        variant={check.requirement === 'required' ? 'secondary' : 'outline'}
        className="shrink-0"
      >
        {REQUIREMENT_LABEL[check.requirement]}
      </Badge>
      {/* A slot of one width, so every badge lines up. */}
      <div className="flex w-20 shrink-0 justify-end">
        {check.url && (
          <Button
            variant="ghost"
            size="sm"
            aria-label={`Open ${check.name}`}
            title={check.url}
            onClick={() => openLink(check.url!)}
          >
            Open
            <ExternalLinkIcon />
          </Button>
        )}
      </div>
    </li>
  );
}

/** A list that stopped short says so, with how much it read. */
function Partial({ list }: { list: CheckList }) {
  if (list.complete) return null;
  const total =
    list.total != null ? `${list.rows.length} of ${list.total}` : 'Not all';
  return (
    <p role="status" className="mb-2 text-sm text-warning">
      {total} checks read: the rest could not be, so none of this is an
      all-clear.
    </p>
  );
}

/** Which head the list is about and when it was read. */
function Source({
  answer,
  reading,
}: {
  answer: PullRequestChecksAnswer;
  reading: boolean;
}) {
  const { checks, fetchedAt } = answer;
  return (
    <p className="mb-3 text-sm text-muted-foreground">
      {checks.state === 'read' && (
        <>
          On <span className="font-mono">{shortOid(checks.value.head)}</span>
          {' · '}
        </>
      )}
      {reading ? (
        <span className="text-warning">
          before the latest push · reading again
        </span>
      ) : (
        <>read {relativeTime(fetchedAt)}</>
      )}
    </p>
  );
}

/** The list went away under the reader: a re-read at a new head that
 *  could not read the checks. Back is still where it was. */
function NotRead({
  answer,
  retrying,
  onRetry,
}: {
  answer: PullRequestChecksAnswer;
  retrying: boolean;
  onRetry: () => void;
}) {
  const { checks } = answer;
  const why =
    checks.state === 'failed'
      ? failureText(checks)
      : checks.state === 'unsupported'
      ? checks.reason
      : null;
  return (
    <div role="status" className="space-y-2 text-sm">
      <p>The checks could not be read{why ? `: ${why}` : '.'}</p>
      <RefreshButton
        variant="outline"
        retrying={retrying}
        onRefresh={onRetry}
      />
    </div>
  );
}

export interface ChecksProps {
  read: ReadState<PullRequestChecksAnswer>;
  /** The answer on screen is the last head's while the new one reads. */
  reading: boolean;
  retrying: boolean;
  onRetry: () => void;
  onBack: () => void;
}

function Body({
  read,
  reading,
  retrying,
  onRetry,
}: Omit<ChecksProps, 'onBack'>) {
  if (read.kind === 'failed') {
    return (
      <ReadFailure
        title="Couldn't read the checks"
        error={read.error}
        retrying={retrying}
        onRetry={onRetry}
        stacked
      />
    );
  }
  if (read.kind === 'loading') {
    return (
      <div aria-busy className="space-y-2">
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-full" />
      </div>
    );
  }
  const { data, stale } = read;
  return (
    <>
      <Source answer={data} reading={reading} />
      {stale && (
        <StaleNotice
          what="checks"
          stale={stale}
          retrying={retrying}
          onRetry={onRetry}
          stacked
          className="mb-3"
        />
      )}
      {data.list ? (
        <>
          <Partial list={data.list} />
          <ul aria-label="Checks and policies">
            {data.list.rows.map((row) => (
              <Row key={row.check.key} row={row} />
            ))}
          </ul>
        </>
      ) : (
        <NotRead answer={data} retrying={retrying} onRetry={onRetry} />
      )}
    </>
  );
}

/**
 * The pull request's checks and policies, nested in the Overview: what
 * blocks first, each with its requirement, outcome, the revision it
 * reported on and where its details are. It stays until the reader goes
 * Back, whatever a re-read brings, and Back returns to the Overview
 * where they left it.
 */
export function PrChecks({ onBack, ...body }: ChecksProps) {
  const heading = useRef<HTMLHeadingElement>(null);
  // The keyboard lands on the view it opened, not back at the top.
  useEffect(() => heading.current?.focus(), []);
  return (
    <div className="mx-auto max-w-[900px] px-6 py-6">
      <Button
        variant="ghost"
        size="sm"
        aria-label="Back to the Overview"
        onClick={onBack}
        className="-ml-2"
      >
        <ArrowLeftIcon />
        Overview
      </Button>
      <h2
        ref={heading}
        tabIndex={-1}
        className="mt-2 text-lg font-semibold outline-none"
      >
        Checks and policies
      </h2>
      <Body {...body} />
    </div>
  );
}
