import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  PullRequestConversation,
  PullRequestRef,
} from '../../../../host/contract.js';
import { usePullRequestConversation } from '../../../lib/data/pr-conversation-query.js';
import { keys } from '../../../lib/data/query-keys.js';
import { useReadState } from '../../../lib/data/use-read-state.js';
import {
  buildActivity,
  filterCounts,
  groupActivity,
  rowContaining,
  selectActivity,
  splitNew,
  type ActivityFilter,
} from '../../../lib/review/activity-model.js';
import { useReviewDrafts } from '../../../lib/review/review-drafts.js';
import { useRepo } from '../../../lib/repo-context.js';
import { Skeleton } from '../../ui/skeleton.js';
import { ToggleGroup, ToggleGroupItem } from '../../ui/toggle-group.js';
import { ReadFailure, StaleNotice } from '../ReadNotice.js';
import { ActivityRowView } from './ActivityEntries.js';
import { EmptyActivity, NewUpdates, SearchBox } from './ActivityControls.js';
import { CoverageNotice } from './CoverageNotice.js';
import { DraftedThreads } from './drafted.js';
import { NewSince } from './new-since.js';

/**
 * The Overview's activity: every review, comment, thread and event on
 * the pull request, oldest first, with filters and a search over all
 * of it. Reading it never moves under the reader — what arrives on a
 * refresh waits behind "N new updates".
 */

const FILTERS: { value: ActivityFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'open', label: 'Open' },
  { value: 'resolved', label: 'Resolved' },
  { value: 'outdated', label: 'Outdated' },
  { value: 'mine', label: 'Mine' },
];

export function PrActivity({
  prRef,
  onOpenThread,
}: {
  prRef: PullRequestRef;
  /** Show a thread in the diff, at its place. */
  onOpenThread: (id: string, path: string | null) => void;
}) {
  const { repo } = useRepo();
  const read = useReadState(
    usePullRequestConversation(repo.cwd, prRef, repo.viewer),
    keys.prConversation(repo.cwd, prRef, repo.viewer)
  );
  const { state } = read;
  const drafts = useReviewDrafts(prRef).data?.drafts;
  const drafted = useMemo(
    () =>
      new Set(
        (drafts ?? []).flatMap((d) =>
          d.target.kind === 'reply' && d.body.trim() ? [d.target.threadId] : []
        )
      ),
    [drafts]
  );
  return (
    <section aria-label="Activity" className="mt-8">
      {state.kind === 'loading' && <ActivitySkeleton />}
      {state.kind === 'failed' && (
        <>
          <ActivityHeading />
          <ReadFailure
            title="Couldn't load the conversation"
            error={state.error}
            retrying={read.retrying}
            onRetry={read.retry}
          />
        </>
      )}
      {state.kind === 'ready' && (
        <>
          {state.stale && (
            <StaleNotice
              what="conversation"
              stale={state.stale}
              retrying={read.retrying}
              onRetry={read.retry}
              className="mb-3"
            />
          )}
          {state.data.conversation.state === 'read' ? (
            <DraftedThreads.Provider value={drafted}>
              <Activity
                conversation={state.data.conversation.value}
                viewer={repo.viewer}
                onOpenThread={onOpenThread}
              />
            </DraftedThreads.Provider>
          ) : (
            <>
              <ActivityHeading />
              <p className="text-sm text-muted-foreground">
                {state.data.conversation.reason}
              </p>
            </>
          )}
        </>
      )}
    </section>
  );
}

function ActivityHeading({ count }: { count?: number }) {
  return (
    <h2 className="mb-3 text-[15px] font-semibold">
      Activity
      {count != null && (
        <>
          {' '}
          <span className="font-normal text-muted-foreground">{count}</span>
        </>
      )}
    </h2>
  );
}

function ActivitySkeleton() {
  return (
    <div className="space-y-3" aria-busy="true" aria-label="Loading activity">
      <Skeleton className="h-5 w-24" />
      <Skeleton className="h-16 w-full" />
      <Skeleton className="h-16 w-full" />
    </div>
  );
}

function Activity({
  conversation,
  viewer,
  onOpenThread,
}: {
  conversation: PullRequestConversation;
  viewer: string | null;
  onOpenThread: (id: string, path: string | null) => void;
}) {
  const [filter, setFilter] = useState<ActivityFilter>('all');
  const [query, setQuery] = useState('');
  const entries = useMemo(() => buildActivity(conversation), [conversation]);
  // What the reader has been shown: the first answer, and later ones
  // only when the reader asks to see them.
  const [seen, setSeen] = useState<ReadonlySet<string>>(
    () => new Set(entries.map((e) => e.id))
  );
  // Every comment there was when the reader arrived; the rest are new.
  const [known] = useState<ReadonlySet<string>>(
    () => new Set(commentIds(conversation))
  );
  const isNew = useCallback((id: string) => !known.has(id), [known]);
  const { shown, held } = splitNew(entries, seen, viewer);
  const list = useRef<HTMLOListElement>(null);
  // Showing new updates moves the reader to the first of them, so focus
  // does not fall back to the page when the button goes.
  const reveal = useRef<string | null>(null);

  const counts = filterCounts(shown, viewer);
  const selected = selectActivity(shown, filter, query, viewer);
  // New updates are counted against what the reader is looking at; the
  // rest wait until the filter or search would show them.
  const arrived = selectActivity(held, filter, query, viewer);
  const narrowed = filter !== 'all' || query.trim() !== '';
  // Grouping folds noise; a filtered or searched list shows each match.
  const rows = narrowed ? selected : groupActivity(selected);
  useEffect(() => {
    const id = reveal.current;
    if (!id) return;
    reveal.current = null;
    const row = rowContaining(rows, id);
    if (!row) return;
    list.current
      ?.querySelector<HTMLElement>(`[data-entry="${CSS.escape(row)}"]`)
      ?.focus();
  });

  return (
    <NewSince.Provider value={isNew}>
      <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2">
        <ActivityHeading count={shown.length} />
        <ToggleGroup
          type="single"
          value={filter}
          onValueChange={(v) => v && setFilter(v as ActivityFilter)}
          aria-label="Show"
          className="mb-3 items-center rounded-md border border-border p-0.5"
        >
          {FILTERS.map((f) => (
            <ToggleGroupItem
              key={f.value}
              value={f.value}
              className="flex h-5 items-center gap-1 rounded px-1.5 text-xs text-muted-foreground hover:text-foreground data-[state=on]:bg-accent data-[state=on]:text-foreground"
            >
              {f.label}
              <span className="tabular-nums opacity-70">{counts[f.value]}</span>
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <SearchBox query={query} onChange={setQuery} />
      </div>
      <CoverageNotice coverage={conversation.coverage} />
      {rows.length === 0 ? (
        <EmptyActivity
          narrowed={narrowed}
          onClear={() => {
            setFilter('all');
            setQuery('');
          }}
        />
      ) : (
        <ol ref={list} className="space-y-3">
          {rows.map((row) => (
            <li
              key={row.id}
              data-entry={row.id}
              tabIndex={-1}
              className="rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <ActivityRowView
                row={row}
                query={query}
                onOpenThread={onOpenThread}
              />
            </li>
          ))}
        </ol>
      )}
      <NewUpdates
        count={arrived.length}
        onShow={() => {
          setSeen(new Set([...seen, ...arrived.map((e) => e.id)]));
          reveal.current = arrived[0]?.id ?? null;
        }}
      />
    </NewSince.Provider>
  );
}

function commentIds(c: PullRequestConversation): string[] {
  return [
    ...c.comments.map((x) => x.id),
    ...c.threads.flatMap((t) => t.comments.map((x) => x.id)),
  ];
}
