import type { DiffReadState } from '../../../lib/data/read-state.js';
import type { PrDiffView } from '../../../lib/review/use-pr-diff.js';
import { megabytes } from './ComparisonIdentity.js';

/**
 * A diff with no files to show. Either the comparison really has no
 * changes, or the patch was cut before its first file ended — which is
 * not an empty comparison, and must never read as one.
 */
export function DiffEmpty({
  read,
  prDiff,
  sourceBranch,
  targetBranch,
}: {
  read: DiffReadState;
  prDiff?: PrDiffView;
  sourceBranch: string;
  targetBranch: string;
}) {
  if (read.kind !== 'empty') return null;
  const cut = prDiff?.truncated;
  return (
    <div className="p-6 text-center text-sm text-muted-foreground">
      {cut ? (
        <>
          No file can be shown: the first file&apos;s diff alone passes{' '}
          {megabytes(cut.limitBytes)}.
        </>
      ) : (
        <>
          No changes between{' '}
          <span className="font-mono">{prDiff?.target ?? targetBranch}</span>{' '}
          and <span className="font-mono">{sourceBranch}</span>.
        </>
      )}
    </div>
  );
}
