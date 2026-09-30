import type { DiffReadState } from '../../../lib/data/read-state.js';
import type { PrDiffView } from '../../../lib/review/use-pr-diff.js';

/**
 * A comparison with no changes. For a pull request that is only ever a
 * complete file list with nothing in it (`prDiffReadState`): a list Git
 * cut short, or files not read yet, never reads as "no changes".
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
  return (
    <div className="p-6 text-center text-sm text-muted-foreground">
      No changes between{' '}
      <span className="font-mono">{prDiff?.target ?? targetBranch}</span> and{' '}
      <span className="font-mono">{sourceBranch}</span>.
    </div>
  );
}
