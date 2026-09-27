import { AlertTriangleIcon, Loader2Icon, RotateCcwIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import {
  fetchedAt,
  type ReadState,
  type StaleRead,
} from '../../lib/data/read-state.js';
import { cn } from '../../lib/utils.js';
import { Button } from '../ui/button.js';

/**
 * How a review section says one of its reads went wrong. Two shapes,
 * because the two failures ask different things of the reader: with
 * nothing loaded, the failure *is* the section; with an older copy on
 * screen, it is a caveat above content that is still worth reading.
 */

export function RetryButton({
  retrying,
  onRetry,
  label,
}: {
  retrying: boolean;
  onRetry: () => void;
  label: string;
}) {
  return (
    // aria-disabled rather than disabled: a disabled button drops
    // keyboard focus to the page mid-retry. A press while retrying is
    // ignored by `useRetry`.
    <Button
      variant="outline"
      size="sm"
      onClick={onRetry}
      aria-disabled={retrying}
      aria-label={label}
      className="aria-disabled:pointer-events-none aria-disabled:opacity-50"
    >
      {retrying ? <Loader2Icon className="animate-spin" /> : <RotateCcwIcon />}
      Retry
    </Button>
  );
}

/** Nothing to show: the read failed before it ever succeeded. */
export function ReadFailure({
  title,
  error,
  retrying,
  onRetry,
  stacked = false,
  className,
}: {
  /** What could not be loaded, as a sentence: "Couldn't load the diff". */
  title: string;
  error: string;
  retrying: boolean;
  onRetry: () => void;
  /** Retry under the text rather than beside it, for the narrow rail. */
  stacked?: boolean;
  className?: string;
}) {
  const retry = (
    <RetryButton
      retrying={retrying}
      onRetry={onRetry}
      label={`Retry: ${title}`}
    />
  );
  return (
    <div
      role="alert"
      className={cn(
        'flex items-start gap-2.5 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2.5',
        className
      )}
    >
      <AlertTriangleIcon className="mt-0.5 size-4 shrink-0 text-destructive" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-destructive">{title}</p>
        <p className="mt-0.5 break-words text-sm text-muted-foreground">
          {error}
        </p>
        {stacked && <div className="mt-2">{retry}</div>}
      </div>
      {!stacked && retry}
    </div>
  );
}

/** An older copy is on screen because the latest refresh failed. */
export function StaleNotice({
  what,
  stale,
  retrying,
  onRetry,
  stacked = false,
  className,
}: {
  /** The noun on screen: "description", "diff", "comments". */
  what: string;
  stale: StaleRead;
  retrying: boolean;
  onRetry: () => void;
  stacked?: boolean;
  className?: string;
}) {
  const retry = (
    <RetryButton
      retrying={retrying}
      onRetry={onRetry}
      label={`Retry loading the ${what}`}
    />
  );
  return (
    <div
      role="status"
      className={cn(
        'flex items-start gap-2 rounded-md border border-warning/30 bg-warning/10 px-2.5 py-1.5 text-sm',
        className
      )}
    >
      <AlertTriangleIcon className="mt-0.5 size-3.5 shrink-0 text-warning" />
      <div className="min-w-0 flex-1 self-center">
        <p className="break-words text-muted-foreground">
          <span className="text-foreground">
            Showing the {what} from {fetchedAt(stale.since)}.
          </span>{' '}
          Refreshing failed: {stale.error}
        </p>
        {stacked && <div className="mt-1.5">{retry}</div>}
      </div>
      {!stacked && retry}
    </div>
  );
}

/**
 * The notice for a read shown in the review rail, or nothing when the
 * read is fine. A function rather than a component so a caller can tell
 * "nothing to say" from an element that renders nothing.
 */
export function railReadNotice(
  what: string,
  state: ReadState<unknown>,
  retrying: boolean,
  onRetry: () => void
): ReactNode | undefined {
  if (state.kind === 'failed') {
    return (
      <ReadFailure
        title={`Couldn't load ${what}`}
        error={state.error}
        retrying={retrying}
        onRetry={onRetry}
        stacked
        className="mx-2 mb-2"
      />
    );
  }
  if (state.kind === 'ready' && state.stale) {
    return (
      <StaleNotice
        what={what}
        stale={state.stale}
        retrying={retrying}
        onRetry={onRetry}
        stacked
        className="mx-2 mb-2"
      />
    );
  }
  return undefined;
}
