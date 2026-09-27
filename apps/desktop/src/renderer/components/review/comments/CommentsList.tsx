import {
  BotIcon,
  CheckCircle2Icon,
  ChevronDownIcon,
  ChevronRightIcon,
  MessageSquareIcon,
} from 'lucide-react';
import type { ReactNode } from 'react';
import type { CommentSeverity } from '../../../../host/contract.js';
import type { ReadState } from '../../../lib/data/read-state.js';
import { cn } from '../../../lib/utils.js';
import { Avatar } from '../../ui/avatar.js';
import { SEVERITY_DOT } from '../../../lib/review/severity.js';

const OPEN_COUNT_LABEL: Partial<Record<ReadState<unknown>['kind'], string>> = {
  loading: 'loading…',
  failed: 'not loaded',
};

export interface CommentListItem {
  id: string;
  /** 'thread' = a real (remote) comment; 'draft' = an agent draft. */
  kind: 'thread' | 'draft';
  author: string;
  /** "file:line" or "Conversation" for general PR comments. */
  where: string;
  preview: string;
  resolved: boolean;
  /** Whether it can be resolved at all: a general comment on GitHub
   *  cannot, and is never counted as open. */
  resolvable: boolean;
  severity?: CommentSeverity;
}

/**
 * Jump list of every comment on the PR — remote threads (inline +
 * general) and the agent's drafts — under the file tree. Click to
 * scroll the diff to it. Open items first; drafts flagged.
 */
export function CommentsList({
  items,
  activeId,
  open,
  onOpenChange,
  onJump,
  onContextMenu,
  notice,
  threads = 'ready',
}: {
  items: CommentListItem[];
  activeId: string | null;
  /** Expanded. Owned by the workspace, which opens it from the header's
   *  unresolved count. */
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onJump: (item: CommentListItem) => void;
  /** Right-click a row: queue it for the agent (see PrWorkspace). */
  onContextMenu?: (item: CommentListItem) => void;
  /** Why the remote threads are missing or out of date, shown above
   *  the rows. */
  notice?: ReactNode;
  /** How far the remote threads got. Until they are `ready` the open
   *  count is unknown, not zero. */
  threads?: ReadState<unknown>['kind'];
}) {
  if (items.length === 0 && !notice) return null;
  // The same count as the header's and the Overview's: threads that can
  // be resolved and are not. Drafts are counted apart.
  const openCount = items.filter(
    (i) => i.kind === 'thread' && i.resolvable && !i.resolved
  ).length;
  const draftCount = items.filter((i) => i.kind === 'draft').length;

  return (
    <div className="flex min-h-0 flex-col border-t border-border">
      <button
        type="button"
        onClick={() => onOpenChange(!open)}
        className="flex h-8 shrink-0 items-center gap-1.5 px-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground"
      >
        {open ? (
          <ChevronDownIcon className="size-3.5" />
        ) : (
          <ChevronRightIcon className="size-3.5" />
        )}
        <MessageSquareIcon className="size-3.5" />
        Comments
        <span className="ml-auto rounded-full bg-muted px-1.5 text-[10px] font-medium tabular-nums">
          {draftCount > 0 && `${draftCount} draft · `}
          {OPEN_COUNT_LABEL[threads] ?? `${openCount} open`}
        </span>
      </button>
      {open && notice}
      {open && (
        <div className="min-h-0 flex-1 overflow-y-auto pb-2">
          {items.map((item) => (
            <button
              type="button"
              key={item.id}
              data-comment-row={item.id}
              aria-current={activeId === item.id || undefined}
              onClick={() => onJump(item)}
              onContextMenu={(e) => {
                if (!onContextMenu) return;
                e.preventDefault();
                onContextMenu(item);
              }}
              className={cn(
                'flex w-full items-start gap-2 px-3 py-1.5 text-left hover:bg-accent',
                activeId === item.id && 'bg-sidebar-active',
                item.resolved && 'opacity-60'
              )}
            >
              {item.kind === 'draft' ? (
                <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center">
                  <span
                    className={cn(
                      'size-2.5 rounded-full',
                      item.severity ? SEVERITY_DOT[item.severity] : 'bg-primary'
                    )}
                  />
                </span>
              ) : (
                <Avatar name={item.author} size="xs" className="mt-0.5" />
              )}
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  {item.kind === 'draft' ? (
                    <span className="flex items-center gap-1 font-medium text-foreground">
                      <BotIcon className="size-3" /> Draft
                    </span>
                  ) : (
                    <span className="font-medium text-foreground">
                      {item.author}
                    </span>
                  )}
                  <span className="truncate font-mono">{item.where}</span>
                  {item.resolved && (
                    <CheckCircle2Icon className="ml-auto size-3 shrink-0 text-success" />
                  )}
                </span>
                <span className="line-clamp-2 text-sm leading-snug">
                  {item.preview}
                </span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
