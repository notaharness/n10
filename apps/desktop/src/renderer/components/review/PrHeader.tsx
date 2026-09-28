import {
  CheckCircle2Icon,
  CircleDotIcon,
  CodeIcon,
  CopyIcon,
  EllipsisIcon,
  ExternalLinkIcon,
  GitBranchIcon,
  GitPullRequestIcon,
  MessageSquareIcon,
  RefreshCwIcon,
  XCircleIcon,
} from 'lucide-react';
import { toast } from 'sonner';
import type { PullRequestInfo } from '@n10/vcs-core';
import { copyText } from '../../lib/copy-text.js';
import { useOpenInEditor } from '../../lib/data/mutations.js';
import { providerName } from '../../lib/provider-name.js';
import { useRepo } from '../../lib/repo-context.js';
import { useRefreshPullRequest } from '../../lib/review/use-refresh-pull-request.js';
import { unresolvedCommentsLabel } from '../../lib/sidebar/sidebar-model.js';
import { cn, errorMessage } from '../../lib/utils.js';
import { Avatar } from '../ui/avatar.js';
import { Badge } from '../ui/badge.js';
import { Button } from '../ui/button.js';
import { Tip } from '../ui/tooltip.js';
import { LifecycleBadge } from './overview/parts.js';
import { ReviewerDots, ReviewerSummary } from './PrHeaderReviewers.js';

/** Launch the configured external editor on the branch's worktree. */
export function OpenInEditorButton({ branch }: { branch: string }) {
  const open = useOpenInEditor();
  return (
    <Tip label="Open worktree in editor">
      <Button
        variant="ghost"
        size="sm"
        aria-label="Open worktree in editor"
        disabled={open.isPending}
        onClick={() =>
          open.mutate(branch, {
            onSuccess: ({ editor }) => toast.success(`Opened in ${editor}`),
            onError: (e) => toast.error(errorMessage(e)),
          })
        }
      >
        <CodeIcon />
        <span className="hidden @min-[900px]:inline">Editor</span>
      </Button>
    </Tip>
  );
}

/** CI verdict, or nothing at all when no build has reported. */
function CiBadge({ ci }: { ci: PullRequestInfo['buildStatus'] }) {
  if (!ci || ci === 'none') return null;
  const variant =
    ci === 'succeeded'
      ? 'success'
      : ci === 'failed'
      ? 'destructive'
      : 'warning';
  return (
    <Badge variant={variant}>
      {ci === 'succeeded' && <CheckCircle2Icon />}
      {ci === 'failed' && <XCircleIcon />}
      {ci === 'pending' && <CircleDotIcon />}
      CI {ci}
    </Badge>
  );
}

/** The unresolved-thread count, which opens the rail's comments at the
 *  first of them. */
function UnresolvedButton({
  count,
  onClick,
}: {
  count: number;
  onClick: () => void;
}) {
  const label = `Show ${unresolvedCommentsLabel(count)}`;
  return (
    <Tip label={label}>
      <button
        type="button"
        aria-label={label}
        onClick={onClick}
        className="flex shrink-0 items-center gap-1 whitespace-nowrap rounded px-1 text-muted-foreground hover:bg-accent hover:text-foreground"
      >
        <MessageSquareIcon className="size-3.5" />
        {count} unresolved
      </button>
    </Tip>
  );
}

/** Copy what names this pull request, through the native menu. */
async function runMoreMenu(pr: PullRequestInfo): Promise<void> {
  const chosen = await window.n10.showContextMenu([
    { id: 'copy-link', label: 'Copy Link' },
    { id: 'copy-branch', label: 'Copy Branch Name' },
    { id: 'copy-head', label: 'Copy Head Commit', enabled: !!pr.headSha },
  ]);
  if (chosen === 'copy-link') copyText(pr.url, 'Link copied');
  else if (chosen === 'copy-branch') {
    copyText(pr.sourceBranch, 'Branch name copied');
  } else if (chosen === 'copy-head' && pr.headSha) {
    copyText(pr.headSha, 'Commit id copied');
  }
}

/**
 * The compact identity of a pull request tab, sized by its own width:
 * the title truncates first, then the branches go, the reviewer avatars
 * become a count and the button labels become icons. The number and
 * the state always stay; the Overview carries every value in full.
 */
export function PrHeader({
  pr,
  onShowUnresolved,
}: {
  pr: PullRequestInfo;
  onShowUnresolved: () => void;
}) {
  const { repo } = useRepo();
  const refresh = useRefreshPullRequest();
  const provider = providerName(repo.providerId);
  const reviewers = pr.reviewers ?? [];
  return (
    <header className="@container flex h-10 shrink-0 items-center gap-3 border-b border-border px-3">
      <GitPullRequestIcon className="size-4 shrink-0 text-info" />
      <span className="flex min-w-0 shrink items-center gap-2">
        <Tip label={pr.title}>
          <span className="truncate font-medium">{pr.title}</span>
        </Tip>
        <span className="shrink-0 text-sm text-muted-foreground">#{pr.id}</span>
        <LifecycleBadge isDraft={pr.isDraft} />
        <Tip label="Copy branch name">
          <button
            type="button"
            onClick={() => copyText(pr.sourceBranch, 'Branch name copied')}
            className="hidden min-w-0 items-center gap-1 rounded px-1 font-mono text-xs text-muted-foreground hover:bg-accent hover:text-foreground @min-[1200px]:flex"
          >
            <span className="truncate">{pr.sourceBranch}</span>
            <span className="shrink-0">→ {pr.targetBranch}</span>
            <CopyIcon className="size-3 shrink-0" />
          </button>
        </Tip>
      </span>

      <span className="mx-1 h-4 w-px shrink-0 bg-border" />

      {/* Never squeezed: the title truncates instead, and what does not
          fit at this width is said more briefly or left to the Overview. */}
      <span className="flex shrink-0 items-center gap-2 text-sm whitespace-nowrap">
        <Tip label={`Opened by ${pr.createdByDisplayName}`}>
          <span className="flex items-center gap-1.5">
            <Avatar name={pr.createdByDisplayName} size="xs" />
            <span className="hidden truncate text-muted-foreground @min-[1200px]:inline">
              {pr.createdByDisplayName}
            </span>
          </span>
        </Tip>
        <span className="hidden @min-[720px]:contents">
          <CiBadge ci={pr.buildStatus} />
        </span>
        <ReviewerDots
          reviewers={reviewers}
          className="hidden @min-[1000px]:flex"
        />
        <ReviewerSummary
          reviewers={reviewers}
          className="hidden @min-[720px]:flex"
        />
        {(pr.activeCommentCount ?? 0) > 0 && (
          <UnresolvedButton
            count={pr.activeCommentCount ?? 0}
            onClick={onShowUnresolved}
          />
        )}
      </span>

      <div className="flex-1" />

      <OpenInEditorButton branch={pr.sourceBranch} />
      <Tip label={`Open on ${provider}`}>
        <Button
          variant="ghost"
          size="sm"
          aria-label={`Open on ${provider}`}
          onClick={() => void window.n10.openExternal(pr.url)}
        >
          <ExternalLinkIcon />
          <span className="hidden @min-[900px]:inline">{provider}</span>
        </Button>
      </Tip>
      <Tip label="Refresh this pull request">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Refresh this pull request"
          // aria-disabled rather than disabled: a disabled button drops
          // keyboard focus mid-refresh. A press while one runs is ignored.
          aria-disabled={refresh.pending}
          onClick={() => refresh.run(pr)}
          className="aria-disabled:pointer-events-none aria-disabled:opacity-50"
        >
          <RefreshCwIcon className={cn(refresh.pending && 'animate-spin')} />
        </Button>
      </Tip>
      <Tip label="More actions">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="More actions"
          onClick={() =>
            runMoreMenu(pr).catch((e: unknown) => toast.error(errorMessage(e)))
          }
        >
          <EllipsisIcon />
        </Button>
      </Tip>
    </header>
  );
}

/** Header for a worktree tab without a PR: branch → base + files count. */
export function BranchHeader({
  branch,
  baseBranch,
  fileCount,
}: {
  branch: string;
  baseBranch: string;
  fileCount: number;
}) {
  return (
    <header className="@container flex h-10 shrink-0 items-center gap-3 border-b border-border px-3">
      <GitBranchIcon className="size-4 shrink-0 text-muted-foreground" />
      <span className="flex min-w-0 shrink items-center gap-2">
        <span className="truncate font-medium">{branch}</span>
        <span className="hidden truncate font-mono text-xs text-muted-foreground sm:inline">
          diff vs {baseBranch}
        </span>
      </span>
      <div className="flex-1" />
      <span className="hidden shrink-0 text-xs text-muted-foreground lg:inline">
        {fileCount} file{fileCount === 1 ? '' : 's'} changed
      </span>
      <OpenInEditorButton branch={branch} />
    </header>
  );
}
