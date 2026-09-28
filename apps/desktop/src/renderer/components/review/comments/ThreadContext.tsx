import type { ThreadAnchor } from '../../../../host/contract.js';
import { cn } from '../../../lib/utils.js';
import { hunkTail, rangeLabel } from '../../../lib/review/thread-anchor.js';

/**
 * Where a thread was written, as the provider kept it: the last lines
 * of the diff hunk it sat on, labelled with the range and commit.
 *
 * This is the original context. An outdated thread's line numbers now
 * point at other code, so its excerpt is the only faithful picture of
 * what the comment was about; a current thread shows the same excerpt
 * so it reads without leaving the overview.
 */
export function ThreadContext({ anchor }: { anchor: ThreadAnchor }) {
  const lines = anchor.diffHunk ? hunkTail(anchor.diffHunk) : [];
  const where = anchor.original ?? anchor.current;
  return (
    <figure className="overflow-hidden rounded-md border border-border">
      <figcaption className="flex flex-wrap items-center gap-x-2 border-b border-border bg-muted/40 px-2.5 py-1 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">
          {anchor.current ? 'Context' : 'Original context'}
        </span>
        {where && <span>{rangeLabel(where)}</span>}
        {anchor.originalCommit && (
          <span className="font-mono">
            at {anchor.originalCommit.slice(0, 7)}
          </span>
        )}
      </figcaption>
      {lines.length > 0 ? (
        <pre className="overflow-x-auto py-1 font-mono text-xs leading-5">
          {lines.map(({ key, text }) => (
            <div
              key={key}
              className={cn(
                'px-2.5 whitespace-pre',
                text.startsWith('+') && 'bg-success/10',
                text.startsWith('-') && 'bg-destructive/10'
              )}
            >
              {text || ' '}
            </div>
          ))}
        </pre>
      ) : (
        <p className="px-2.5 py-1.5 text-xs text-muted-foreground">
          The provider kept no excerpt of the code this was written on.
        </p>
      )}
    </figure>
  );
}
