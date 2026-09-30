import { use, useLayoutEffect, useRef } from 'react';
import { refocusAfter } from '../../../lib/focus.js';
import type { DiffReadState } from '../../../lib/data/read-state.js';
import { short } from '../../../lib/review/revision-model.js';
import type { PrDiffView } from '../../../lib/review/use-pr-diff.js';
import type { RevisionControls } from '../../../lib/review/use-pr-revisions.js';
import { Button } from '../../ui/button.js';
import { SelectorFocus } from './selector-focus.js';

/**
 * A comparison with no changes. For a pull request that is only ever a
 * complete file list with nothing in it (`prDiffReadState`): a list Git
 * cut short, or files not read yet, never reads as "no changes". Two
 * revisions with nothing between them say so, and so does a "since"
 * with no revision to start from; both offer every change instead.
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
  const revisions = prDiff?.revisions;
  if (revisions && (revisions.unavailable || revisions.pair)) {
    return <RangeEmpty revisions={revisions} />;
  }
  return (
    <div className="p-6 text-center text-sm text-muted-foreground">
      No changes between{' '}
      <span className="font-mono">{prDiff?.target ?? targetBranch}</span> and{' '}
      <span className="font-mono">{sourceBranch}</span>.
    </div>
  );
}

function RangeEmpty({ revisions }: { revisions: RevisionControls }) {
  const { choice, options, pair, unavailable } = revisions;
  const label = options.find((o) => o.mode === choice.mode)?.label;
  return (
    <div className="flex flex-col items-center gap-3 p-6 text-center text-sm">
      {unavailable ? (
        <div className="flex flex-col gap-1">
          <p className="font-medium">{label}</p>
          <p className="text-muted-foreground">{unavailable}.</p>
        </div>
      ) : (
        pair && (
          <p className="text-muted-foreground">
            No changes between{' '}
            <span className="font-mono">{short(pair.from)}</span> and{' '}
            <span className="font-mono">{short(pair.to)}</span>.
          </p>
        )
      )}
      <div className="flex gap-2">
        {revisions.retryHistory && (
          <RetryHistory retry={revisions.retryHistory} />
        )}
        <ShowAllChanges revisions={revisions} />
      </div>
    </div>
  );
}

/** Read the history again. Once it reads, the notice and this button
 *  go: the keyboard moves to the selector. */
function RetryHistory({ retry }: { retry: () => void }) {
  const selector = use(SelectorFocus);
  const button = useRef<HTMLButtonElement>(null);
  useLayoutEffect(
    () => () => {
      if (document.activeElement === button.current) {
        refocusAfter(() => selector?.current);
      }
    },
    [selector]
  );
  return (
    <Button ref={button} variant="outline" size="sm" onClick={retry}>
      Try again
    </Button>
  );
}

export function ShowAllChanges({ revisions }: { revisions: RevisionControls }) {
  const selector = use(SelectorFocus);
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={() => {
        revisions.setChoice({ mode: 'all' });
        // The button goes with the notice it sat in.
        refocusAfter(() => selector?.current);
      }}
    >
      Show all changes
    </Button>
  );
}
