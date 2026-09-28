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
} from '../../../../host/contract.js';
import { openLink } from '../../../lib/open-link.js';
import {
  duration,
  outcomeText,
  REQUIREMENT_LABEL,
  requiredFrom,
  shortOid,
  waitsFor,
} from '../../../lib/review/readiness-model.js';
import { cn, relativeTime } from '../../../lib/utils.js';
import { Badge } from '../../ui/badge.js';
import { Button } from '../../ui/button.js';

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
  const { icon: Icon, className } = STANDING[standing];
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

/**
 * The pull request's checks and policies, nested in the Overview: what
 * blocks first, each with its requirement, outcome, the revision it
 * reported on and where its details are. Back returns to the Overview
 * where the reader left it.
 */
export function PrChecks({
  list,
  head,
  fetchedAt,
  onBack,
}: {
  list: CheckList;
  head: string | null;
  fetchedAt: number;
  onBack: () => void;
}) {
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
      <p className="mb-3 text-sm text-muted-foreground">
        {head && (
          <>
            On <span className="font-mono">{shortOid(head)}</span> ·{' '}
          </>
        )}
        read {relativeTime(fetchedAt)}
      </p>
      <Partial list={list} />
      <ul aria-label="Checks and policies">
        {list.rows.map((row) => (
          <Row key={row.check.key} row={row} />
        ))}
      </ul>
    </div>
  );
}
