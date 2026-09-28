import { ArrowRightIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import type { PullRequestInfo } from '@n10/vcs-core/types';
import { cn } from '../../../lib/utils.js';
import { Avatar } from '../../ui/avatar.js';
import { CopyChip, LifecycleBadge } from './parts.js';

/**
 * What the pull request is: its whole title and number, its state, who
 * opened it, and the branches and commit it stands for — each value in
 * full and copyable. The Overview has no header bar, so this heading is
 * its identity, with the pull request's actions beside the title.
 */
export function PrIdentity({
  pr,
  actions,
  className,
}: {
  pr: PullRequestInfo;
  /** Beside the title: open, refresh, copy. */
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('min-w-0', className)}>
      <div className="flex items-start gap-3">
        <h1
          data-overview-heading
          tabIndex={-1}
          className="min-w-0 flex-1 text-xl leading-snug font-semibold break-words outline-none"
        >
          {pr.title}{' '}
          <span className="font-normal text-muted-foreground">#{pr.id}</span>
        </h1>
        {actions && (
          <div className="-mr-2 flex shrink-0 items-center gap-1">
            {actions}
          </div>
        )}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm text-muted-foreground">
        <LifecycleBadge isDraft={pr.isDraft} />
        <span className="flex items-center gap-1.5">
          <Avatar name={pr.createdByDisplayName} size="xs" />
          {pr.createdByDisplayName}
        </span>
        <span className="flex min-w-0 flex-wrap items-center gap-0.5">
          <CopyChip
            label="Copy source branch"
            copy={pr.sourceBranch}
            copied="Branch name copied"
          >
            {pr.sourceBranch}
          </CopyChip>
          <ArrowRightIcon aria-label="into" className="size-3.5 shrink-0" />
          <CopyChip
            label="Copy target branch"
            copy={pr.targetBranch}
            copied="Branch name copied"
          >
            {pr.targetBranch}
          </CopyChip>
        </span>
        {pr.headSha && (
          <CopyChip
            label="Copy head commit"
            copy={pr.headSha}
            copied="Commit id copied"
          >
            {pr.headSha.slice(0, 8)}
          </CopyChip>
        )}
      </div>
    </div>
  );
}
