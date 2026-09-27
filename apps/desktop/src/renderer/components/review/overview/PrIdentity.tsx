import { ArrowRightIcon } from 'lucide-react';
import type { PullRequestInfo } from '@n10/vcs-core/types';
import { cn } from '../../../lib/utils.js';
import { Avatar } from '../../ui/avatar.js';
import { CopyChip, LifecycleBadge } from './parts.js';

/**
 * What the pull request is: its whole title and number, its state, who
 * opened it, and the branches and commit it stands for — each value in
 * full and copyable, since the header cuts them short.
 */
export function PrIdentity({
  pr,
  className,
}: {
  pr: PullRequestInfo;
  className?: string;
}) {
  return (
    <header className={cn('min-w-0', className)}>
      <h1 className="text-xl leading-snug font-semibold break-words">
        {pr.title}{' '}
        <span className="font-normal text-muted-foreground">#{pr.id}</span>
      </h1>
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
    </header>
  );
}
