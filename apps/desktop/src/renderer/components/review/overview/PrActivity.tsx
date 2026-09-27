import { ArrowDownIcon, SearchIcon, XIcon } from 'lucide-react';
import { useMemo, useState } from 'react';
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
  selectActivity,
  splitNew,
  type ActivityFilter,
} from '../../../lib/review/activity-model.js';
import { useRepo } from '../../../lib/repo-context.js';
import { cn } from '../../../lib/utils.js';
import { Button } from '../../ui/button.js';
import { Input } from '../../ui/input.js';
import { Skeleton } from '../../ui/skeleton.js';
import { ToggleGroup, ToggleGroupItem } from '../../ui/toggle-group.js';
import { ReadFailure, StaleNotice } from '../ReadNotice.js';
import { ActivityRowView } from './ActivityEntries.js';
import { CoverageNotice } from './CoverageNotice.js';

/**
 * The Overview's activity: every review, comment, thread and event on
 * the pull request, oldest first, with filters and a search over all
 * of it. Reading it never moves under the reader — what arrives on a
 * refresh waits behind "N new updates".
 */

const FILTERS: { value: ActivityFilter; label: string; github?: true }[] = [
  { value: 'all', label: 'All' },
  { value: 'open', label: 'Open' },
  { value: 'resolved', label: 'Resolved' },
  { value: 'outdated', label: 'Outdated' },
  { value: 'mine', label: 'Mine' },
  // Azure encodes a mention as the person's id, which the renderer
  // does not know for the viewer; GitHub's is their login.
  { value: 'mentions', label: 'Mentions', github: true },
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
    <section aria-labelledby="pr-activity" className="mt-8">
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
            <Activity
              conversation={state.data.conversation.value}
              viewer={repo.viewer}
              isGitHub={repo.providerId === 'github'}
              onOpenThread={onOpenThread}
            />
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
    <h2 id="pr-activity" className="mb-3 text-[15px] font-semibold">
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
  isGitHub,
  onOpenThread,
}: {
  conversation: PullRequestConversation;
  viewer: string | null;
  isGitHub: boolean;
  onOpenThread: (id: string, path: string | null) => void;
}) {
  const [filter, setFilter] = useState<ActivityFilter>('all');
  const [query, setQuery] = useState('');
  const entries = useMemo(() => buildActivity(conversation), [conversation]);
  // What the reader has been shown. Set once, from the first answer;
  // later answers add to it only when the reader asks to see them.
  const [seen, setSeen] = useState<ReadonlySet<string> | null>(null);
  if (seen === null) setSeen(new Set(entries.map((e) => e.id)));
  const { shown, held } = splitNew(entries, seen);

  const counts = filterCounts(shown, viewer);
  const selected = selectActivity(shown, filter, query, viewer);
  const narrowed = filter !== 'all' || query.trim() !== '';
  // Grouping folds noise; a filtered or searched list shows each match.
  const rows = narrowed ? selected : groupActivity(selected);
  const filters = FILTERS.filter((f) => isGitHub || !f.github);

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2">
        <ActivityHeading count={shown.length} />
        <ToggleGroup
          type="single"
          value={filter}
          onValueChange={(v) => v && setFilter(v as ActivityFilter)}
          aria-label="Show"
          className="mb-3 items-center rounded-md border border-border p-0.5"
        >
          {filters.map((f) => (
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
        <ol className="space-y-3">
          {rows.map((row) => (
            <li key={row.id}>
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
        count={held.length}
        onShow={() => setSeen(new Set(entries.map((e) => e.id)))}
      />
    </>
  );
}

function SearchBox({
  query,
  onChange,
}: {
  query: string;
  onChange: (q: string) => void;
}) {
  return (
    <div className="relative mb-3 ml-auto w-56 min-w-40">
      <SearchIcon className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
      <Input
        type="search"
        value={query}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && query) {
            e.stopPropagation();
            onChange('');
          }
        }}
        placeholder="Search activity"
        aria-label="Search activity"
        className="h-6 pl-7 pr-6 text-sm [&::-webkit-search-cancel-button]:hidden"
      />
      {query && (
        <button
          type="button"
          aria-label="Clear search"
          onClick={() => onChange('')}
          className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded text-muted-foreground hover:text-foreground"
        >
          <XIcon className="size-3.5" />
        </button>
      )}
    </div>
  );
}

function EmptyActivity({
  narrowed,
  onClear,
}: {
  narrowed: boolean;
  onClear: () => void;
}) {
  if (!narrowed) {
    return (
      <p className="text-sm text-muted-foreground">
        No comments, reviews or activity yet.
      </p>
    );
  }
  return (
    <p className="flex items-center gap-2 text-sm text-muted-foreground">
      Nothing matches.
      <Button variant="link" size="sm" className="h-auto p-0" onClick={onClear}>
        Clear filters
      </Button>
    </p>
  );
}

function NewUpdates({ count, onShow }: { count: number; onShow: () => void }) {
  return (
    <div
      aria-live="polite"
      className={cn(count > 0 && 'mt-4 flex justify-center')}
    >
      {count > 0 && (
        <Button variant="outline" size="sm" onClick={onShow}>
          <ArrowDownIcon />
          {count} new update{count === 1 ? '' : 's'}
        </Button>
      )}
    </div>
  );
}
