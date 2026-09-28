import {
  CopyIcon,
  GitPullRequestDraftIcon,
  GitPullRequestIcon,
} from 'lucide-react';
import { useId, type ReactNode } from 'react';
import { copyText } from '../../../lib/copy-text.js';
import { cn } from '../../../lib/utils.js';
import { Badge } from '../../ui/badge.js';
import { Tip } from '../../ui/tooltip.js';

/**
 * Small pieces the pull request header and Overview share, so the two
 * name a pull request's state and copy its identity the same way.
 */

/** A titled block of the Overview, headed like the review rail's own
 *  sections so the two columns read as one surface. */
export function Section({
  title,
  children,
  className,
}: {
  title: string;
  children: ReactNode;
  className?: string;
}) {
  const id = useId();
  return (
    <section aria-labelledby={id} className={className}>
      <h2
        id={id}
        className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground"
      >
        {title}
      </h2>
      {children}
    </section>
  );
}

/** Open or Draft, in words and an icon — never colour alone. */
export function LifecycleBadge({ isDraft }: { isDraft?: boolean }) {
  return isDraft ? (
    <Badge variant="outline">
      <GitPullRequestDraftIcon />
      Draft
    </Badge>
  ) : (
    <Badge variant="success">
      <GitPullRequestIcon />
      Open
    </Badge>
  );
}

/** A monospace value that copies itself (or `copy`, when that differs
 *  from what is shown) when clicked. It wraps rather than truncates:
 *  the header is where long names are cut short, not here. */
export function CopyChip({
  label,
  copy,
  copied,
  children,
  className,
}: {
  /** What the button does, for its tooltip and accessible name. */
  label: string;
  copy: string;
  /** The toast once it is on the clipboard. */
  copied: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Tip label={label}>
      <button
        type="button"
        aria-label={`${label}: ${copy}`}
        onClick={() => copyText(copy, copied)}
        className={cn(
          'inline-flex min-w-0 items-center gap-1 rounded px-1 text-left font-mono text-xs text-muted-foreground hover:bg-accent hover:text-foreground [&_svg]:size-3 [&_svg]:shrink-0',
          className
        )}
      >
        <span className="min-w-0 break-all">{children}</span>
        <CopyIcon />
      </button>
    </Tip>
  );
}
