import { AlertTriangleIcon } from 'lucide-react';
import type {
  Coverage,
  PullRequestConversation,
} from '../../../../host/contract.js';

const PARTS: [keyof PullRequestConversation['coverage'], string][] = [
  ['threads', 'threads'],
  ['threadComments', 'comments in threads'],
  ['comments', 'conversation comments'],
  ['reviews', 'reviews'],
  ['events', 'events'],
];

function partText(c: Coverage, noun: string): string {
  return c.total != null
    ? `${c.loaded.toLocaleString()} of ${c.total.toLocaleString()} ${noun}`
    : `${c.loaded.toLocaleString()} ${noun}`;
}

/**
 * Said when only part of the conversation loaded. The
 * counts and filters above it describe what loaded, so an empty "Open"
 * here is not the same as nothing left to answer.
 */
export function CoverageNotice({
  coverage,
}: {
  coverage: PullRequestConversation['coverage'];
}) {
  const missing = PARTS.filter(([key]) => !coverage[key].complete);
  if (missing.length === 0) return null;
  return (
    <div
      role="status"
      className="mb-3 flex items-start gap-2 rounded-md border border-warning/30 bg-warning/10 px-2.5 py-1.5 text-sm"
    >
      <AlertTriangleIcon className="mt-0.5 size-3.5 shrink-0 text-warning" />
      <p className="text-muted-foreground">
        <span className="text-foreground">
          Not all of the conversation loaded.
        </span>{' '}
        Showing{' '}
        {missing.map(([key, noun]) => partText(coverage[key], noun)).join(', ')}
        . Counts and filters leave out the rest.
      </p>
    </div>
  );
}
