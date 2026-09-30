import type { RefObject } from 'react';
import type { RevisionRange } from '../../../../host/contract.js';
import {
  short,
  type RevisionChoice,
} from '../../../lib/review/revision-model.js';
import type { PrDiffView } from '../../../lib/review/use-pr-diff.js';
import { Badge } from '../../ui/badge.js';
import { ComparisonIdentity } from './ComparisonIdentity.js';
import { RevisionSelector } from './RevisionSelector.js';

/**
 * Which changes of the pull request are on screen, above the diff's
 * view controls: the selector, the exact commits compared, and — for
 * two revisions — how many of the pull request's files changed between
 * them and what else came in: the target's own changes, or a rewrite.
 */

const NOTES: Record<RevisionChoice['mode'], string> = {
  all: '',
  'since-visit': 'your last visit',
  'since-review': 'your last review',
  range: 'a revision you chose',
};

function FileCount({
  shown,
  total,
  incomplete,
}: {
  shown: number;
  total: number | null;
  incomplete: boolean;
}) {
  const files = `${incomplete ? 'at least ' : ''}${shown}`;
  return (
    <span className="shrink-0 tabular-nums text-muted-foreground">
      {total === null
        ? `${files} ${shown === 1 ? 'file' : 'files'}`
        : `${files} of ${total} files`}
    </span>
  );
}

/** One fact about the range: it gives way to the commits and the
 *  count when the bar is narrow, and its tooltip keeps it whole. */
function Fact({
  variant,
  text,
  detail = text,
}: {
  variant: 'info' | 'outline';
  text: string;
  /** The whole of it, on hover. */
  detail?: string;
}) {
  return (
    <Badge variant={variant} className="min-w-0 shrink" title={detail}>
      <span className="truncate">{text}</span>
    </Badge>
  );
}

/** What came in between the two revisions besides the branch's work. */
function RangeFacts({
  range,
  from,
  target,
}: {
  range: RevisionRange;
  from: string;
  target: string;
}) {
  const { base } = range;
  return (
    <>
      {base.state === 'moved' && (
        <Fact variant="info" text={`Includes changes from ${target}`} />
      )}
      {base.state === 'unknown' && (
        <Fact
          variant="outline"
          text={`Couldn’t check for changes from ${target}`}
        />
      )}
      {range.backwards && (
        <Fact
          variant="outline"
          text="Runs backwards"
          detail={`${short(range.toOid)} is older than ${short(
            from
          )}: the diff undoes the commits between them`}
        />
      )}
      {!range.linear && !range.backwards && (
        <Fact
          variant="outline"
          text="Rewritten"
          detail={`Rewritten since ${short(
            from
          )}: the two trees are compared, not a list of new commits`}
        />
      )}
    </>
  );
}

export function ComparisonBar({
  prDiff,
  comparisonRef,
}: {
  /** Absent for a bare worktree, which has no revisions to choose. */
  prDiff: PrDiffView | undefined;
  /** Where the moved banner's load hands focus: the commits compared. */
  comparisonRef: RefObject<HTMLButtonElement | null>;
}) {
  if (!prDiff?.comparison) return null;
  const { revisions, comparison } = prDiff;
  const { pair, range, choice } = revisions;
  // A "since" with no revision yet names no commits: the pull request's
  // own would pass for the ones it compares.
  const bounded = choice.mode === 'all' || pair !== null;
  return (
    <div
      data-testid="comparison-bar"
      className="flex h-9 shrink-0 items-center gap-2 overflow-hidden border-b border-border px-2 text-xs"
    >
      <RevisionSelector controls={revisions} />
      {bounded && (
        <ComparisonIdentity
          comparison={comparison}
          range={pair && { ...pair, note: NOTES[choice.mode] }}
          ref={comparisonRef}
        />
      )}
      {pair && range && (
        <>
          <FileCount
            shown={prDiff.manifestFiles.length}
            total={revisions.total}
            incomplete={prDiff.incomplete}
          />
          <RangeFacts range={range} from={pair.from} target={prDiff.target} />
        </>
      )}
    </div>
  );
}
