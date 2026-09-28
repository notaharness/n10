import { ArrowDownIcon, SearchIcon, XIcon } from 'lucide-react';
import { useId, type Ref } from 'react';
import { cn } from '../../../lib/utils.js';
import { Button } from '../../ui/button.js';
import { Input } from '../../ui/input.js';
import { Switch } from '../../ui/switch.js';

/** The activity's search, its empty states and its new-updates button. */

export function SearchBox({
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

/** Resolved threads are out of view until this is on. */
export function ShowResolved({
  ref,
  checked,
  count,
  onChange,
}: {
  ref?: Ref<HTMLButtonElement>;
  checked: boolean;
  count: number;
  onChange: (on: boolean) => void;
}) {
  const id = useId();
  return (
    <div className="mb-3 flex items-center gap-1.5 text-xs text-muted-foreground">
      <Switch ref={ref} id={id} checked={checked} onCheckedChange={onChange} />
      <label htmlFor={id} className="flex items-center gap-1">
        Show resolved
        <span className="tabular-nums opacity-70">{count}</span>
      </label>
    </div>
  );
}

export function EmptyActivity({
  narrowed,
  hiddenMatches,
  onClear,
  onShowResolved,
}: {
  narrowed: boolean;
  /** Resolved threads out of view that the filter and search would
   *  show: all there is to show, when nothing else is. */
  hiddenMatches: number;
  onClear: () => void;
  onShowResolved: () => void;
}) {
  if (hiddenMatches > 0) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        {narrowed
          ? `Only resolved threads match (${hiddenMatches}).`
          : 'Every thread is resolved.'}
        <Button
          variant="link"
          size="sm"
          className="h-auto p-0"
          onClick={onShowResolved}
        >
          Show resolved
        </Button>
      </p>
    );
  }
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

export function NewUpdates({
  count,
  onShow,
}: {
  count: number;
  onShow: () => void;
}) {
  return (
    <div
      aria-live="polite"
      className={cn(
        count > 0 &&
          'pointer-events-none sticky bottom-4 mt-4 flex justify-center'
      )}
    >
      {count > 0 && (
        <Button
          variant="outline"
          size="sm"
          onClick={onShow}
          className="pointer-events-auto bg-background shadow-md"
        >
          <ArrowDownIcon />
          {count} new update{count === 1 ? '' : 's'}
        </Button>
      )}
    </div>
  );
}
