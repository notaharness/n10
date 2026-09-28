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
  isResolved,
  pruneHidden,
  resolvedIds,
  rowContaining,
  selectActivity,
  splitNew,
  withoutHidden,
  withoutResolved,
  type ActivityEntry,
  type ActivityFilter,
} from '../../../lib/review/activity-model.js';
import { useRepo } from '../../../lib/repo-context.js';
import { Skeleton } from '../../ui/skeleton.js';
import { ToggleGroup, ToggleGroupItem } from '../../ui/toggle-group.js';
import { ReadFailure, StaleNotice } from '../ReadNotice.js';
import { ActivityRowView } from './ActivityEntries.js';
import {
  EmptyActivity,
  NewUpdates,
  SearchBox,
  ShowResolved,
} from './ActivityControls.js';
import { focusAfter } from '../../../lib/focus.js';
import { ActivityActionsProvider } from './activity-actions.js';
import { CoverageNotice } from './CoverageNotice.js';
import { NewSince } from './new-since.js';

/**
 * The Overview's activity: every review, comment, thread and event on
 * the pull request, oldest first, with filters and a search over all
 * of it. Reading it never moves under the reader — what arrives on a
 * refresh waits behind "N new updates". Resolved threads stay out of
 * view until the reader shows them: the provider's own resolved state,
 * so an Azure DevOps thread closed as "won't fix" is resolved too.
 */

const FILTERS: { value: ActivityFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'open', label: 'Open' },
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
            <ActivityActionsProvider prId={prRef.number}>
              <Activity
                conversation={state.data.conversation.value}
                viewer={repo.viewer}
                onOpenThread={onOpenThread}
              />
            </ActivityActionsProvider>
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
  const [showResolved, setShowResolved] = useState(false);
  const entries = useMemo(() => buildActivity(conversation), [conversation]);
  // Resolved threads out of view: those resolved on arrival, or when
  // the reader last hid them.
  const [hidden, setHidden] = useState<ReadonlySet<string>>(() =>
    resolvedIds(entries)
  );
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

  const kept = pruneHidden(hidden, shown);
  if (kept !== hidden) setHidden(kept);
  const visible = showResolved ? shown : withoutHidden(shown, kept);
  const out = outOfView(shown, visible);
  const resolvedCount = shown.filter(isResolved).length;
  const switchRef = useRef<HTMLButtonElement>(null);
  const showOrHide = (on: boolean) => {
    if (!on) setHidden(resolvedIds(shown));
    setShowResolved(on);
  };
  const counts = filterCounts(visible, viewer);
  const selected = selectActivity(visible, filter, query, viewer);
  // New updates are counted against what the reader is looking at; the
  // rest wait until the filter, search or resolved switch would show
  // them. A thread that arrives resolved is out of view with the rest.
  const arrived = selectActivity(
    showResolved ? held : withoutResolved(held),
    filter,
    query,
    viewer
  );
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
        <ActivityHeading count={visible.length} />
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
        {(resolvedCount > 0 || showResolved) && (
          <ShowResolved
            ref={switchRef}
            checked={showResolved}
            // What the switch changes: the threads it would show, or
            // every resolved one it would hide.
            count={showResolved ? resolvedCount : out.length}
            onChange={showOrHide}
          />
        )}
        <SearchBox query={query} onChange={setQuery} />
      </div>
      <CoverageNotice coverage={conversation.coverage} />
      {rows.length === 0 ? (
        <EmptyActivity
          narrowed={narrowed}
          hiddenMatches={selectActivity(out, filter, query, viewer).length}
          onClear={() => {
            setFilter('all');
            setQuery('');
          }}
          onShowResolved={() => {
            showOrHide(true);
            focusAfter(() => switchRef.current);
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

/** The entries the resolved switch keeps out of view. */
function outOfView(
  shown: readonly ActivityEntry[],
  visible: readonly ActivityEntry[]
): ActivityEntry[] {
  const inView = new Set(visible);
  return shown.filter((e) => !inView.has(e));
}

function commentIds(c: PullRequestConversation): string[] {
  return [
    ...c.comments.map((x) => x.id),
    ...c.threads.flatMap((t) => t.comments.map((x) => x.id)),
  ];
}
