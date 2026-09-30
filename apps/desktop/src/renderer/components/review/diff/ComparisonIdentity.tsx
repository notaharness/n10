import { AlertTriangleIcon, GitCompareArrowsIcon } from 'lucide-react';
import type { PrComparison } from '../../../../host/contract.js';
import type { Ref } from 'react';
import { copyText } from '../../../lib/copy-text.js';
import type { PrDiffTruncation } from '../../../lib/review/use-pr-diff.js';
import { Banner } from '../../ui/banner.js';
import { Tooltip, TooltipContent, TooltipTrigger } from '../../ui/tooltip.js';

/**
 * Which commits the diff on screen is between, and what has happened
 * to the pull request since it was read.
 */

const short = (oid: string) => oid.slice(0, 7);

function IdentityRow({
  label,
  oid,
  note,
}: {
  label: string;
  oid: string;
  note: string;
}) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-mono">
        {short(oid)}{' '}
        <span className="font-sans text-muted-foreground">{note}</span>
      </dd>
    </>
  );
}

/**
 * The comparison as `merge-base → head`, short ids, in the diff
 * toolbar. The tooltip names every commit and where it came from;
 * clicking copies the range for `git diff` or `git log`.
 */
export function ComparisonIdentity({
  comparison,
  ref,
}: {
  comparison: PrComparison;
  ref?: Ref<HTMLButtonElement>;
}) {
  const { mergeBaseOid, headOid, targetOid } = comparison;
  const headNote = comparison.headVerified
    ? comparison.sourceRef ?? 'the pull request’s head'
    : `${
        comparison.sourceRef ?? 'local branch'
      }, not confirmed by the provider`;
  const targetNote = comparison.targetVerified
    ? `${comparison.targetRef}, as the provider reports it`
    : `${comparison.targetRef} as this clone last fetched it`;
  const unverified = comparison.headVerified
    ? ''
    : ' The head is not confirmed by the provider.';
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          ref={ref}
          type="button"
          data-testid="diff-comparison"
          aria-label={`Comparing ${short(mergeBaseOid)} to ${short(
            headOid
          )}.${unverified} Copy the range`}
          onClick={() =>
            copyText(`${mergeBaseOid}..${headOid}`, 'Comparison range copied')
          }
          className="flex min-w-0 items-center gap-1 rounded px-1 font-mono text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <GitCompareArrowsIcon className="size-3.5 shrink-0" />
          <span className="truncate">
            {short(mergeBaseOid)} → {short(headOid)}
          </span>
          {!comparison.headVerified && (
            <AlertTriangleIcon
              className="size-3 shrink-0 text-warning"
              aria-hidden
            />
          )}
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="max-w-sm">
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
          <IdentityRow label="Head" oid={headOid} note={headNote} />
          <IdentityRow
            label="Base"
            oid={mergeBaseOid}
            note={`where it left ${comparison.targetRef}`}
          />
          <IdentityRow label="Target" oid={targetOid} note={targetNote} />
        </dl>
        <p className="mt-1 text-xs text-muted-foreground">
          Click to copy the range.
        </p>
      </TooltipContent>
    </Tooltip>
  );
}

export function megabytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** The patch passed its ceiling: say how much of the pull request the
 *  diff below holds, from the manifest's count of every file. */
export function TruncationBanner({
  truncation,
  shownFiles,
}: {
  truncation: PrDiffTruncation;
  shownFiles: number;
}) {
  return (
    <Banner aria-label="Diff cut short">
      Showing {shownFiles} of {truncation.manifestComplete ? '' : 'at least '}
      {truncation.manifestFiles} files: the diff passed{' '}
      {megabytes(truncation.limitBytes)} and was cut at a file boundary.
    </Banner>
  );
}
