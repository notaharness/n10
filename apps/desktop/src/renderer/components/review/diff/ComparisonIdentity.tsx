import { AlertTriangleIcon, GitCompareArrowsIcon } from 'lucide-react';
import type { PrComparison } from '../../../../host/contract.js';
import type { Ref } from 'react';
import { copyText } from '../../../lib/copy-text.js';
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

/** Two revisions shown in place of the pull request's own comparison,
 *  and what the earlier one is: "your last review"… */
export interface ShownRange {
  from: string;
  to: string;
  note: string;
}

function boundsOf(comparison: PrComparison, range: ShownRange | null) {
  return {
    mergeBaseOid: range?.from ?? comparison.mergeBaseOid,
    headOid: range?.to ?? comparison.headOid,
    targetOid: comparison.targetOid,
  };
}

/** Where each commit came from, as the tooltip says it. */
function notesOf(comparison: PrComparison, headOid: string) {
  const pullHead = comparison.headVerified
    ? comparison.sourceRef ?? 'the pull request’s head'
    : `${
        comparison.sourceRef ?? 'local branch'
      }, not confirmed by the provider`;
  return {
    headNote:
      headOid === comparison.headOid ? pullHead : 'a revision you chose',
    targetNote: comparison.targetVerified
      ? `${comparison.targetRef}, as the provider reports it`
      : `${comparison.targetRef} as this clone last fetched it`,
    unverified: comparison.headVerified
      ? ''
      : ' The head is not confirmed by the provider.',
  };
}

/**
 * The comparison as `merge-base → head`, short ids — or `from → to`
 * when two of the pull request's revisions are shown. The tooltip names
 * every commit and where it came from; clicking copies the range for
 * `git diff` or `git log`.
 */
export function ComparisonIdentity({
  comparison,
  range = null,
  ref,
}: {
  comparison: PrComparison;
  range?: ShownRange | null;
  ref?: Ref<HTMLButtonElement>;
}) {
  const { mergeBaseOid, headOid, targetOid } = boundsOf(comparison, range);
  const { headNote, targetNote, unverified } = notesOf(comparison, headOid);
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
          className="flex shrink-0 items-center gap-1 rounded px-1 font-mono text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <GitCompareArrowsIcon className="size-3.5 shrink-0" />
          <span>
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
          <IdentityRow
            label={range ? 'To' : 'Head'}
            oid={headOid}
            note={headNote}
          />
          <IdentityRow
            label={range ? 'From' : 'Base'}
            oid={mergeBaseOid}
            note={range?.note ?? `where it left ${comparison.targetRef}`}
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

/** Git's listing of the files was cut: the list below is not the whole
 *  pull request, and nothing may read as if it were. */
export function IncompleteManifestBanner({ listed }: { listed: number }) {
  return (
    <Banner aria-label="File list incomplete">
      The file list is incomplete: Git’s listing was cut after {listed}{' '}
      {listed === 1 ? 'file' : 'files'}, and more may have changed.
    </Banner>
  );
}
