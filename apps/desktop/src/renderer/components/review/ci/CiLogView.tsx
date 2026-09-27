import { useLayoutEffect, useRef } from 'react';
import type { CiLog } from '@n10/vcs-core/ci';
import {
  ciLogLineKind,
  type CiLogLineKind,
} from '../../../lib/review/ci-model.js';
import { cn, errorMessage } from '../../../lib/utils.js';
import { Button } from '../../ui/button.js';
import { Skeleton } from '../../ui/skeleton.js';

const LINE_TONE: Record<CiLogLineKind, string> = {
  error: 'text-destructive',
  warning: 'text-warning',
  section: 'font-semibold text-foreground',
  plain: 'text-foreground/85',
};

function LogLines({ log }: { log: CiLog }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  // A tail is read from the bottom: that is where a failure is.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [log]);
  const lines = (log.text === '' ? [] : log.text.split('\n')).map(
    (text, i) => ({ number: log.firstLine + i, text })
  );
  const width = String(log.firstLine + lines.length).length;
  return (
    <div
      ref={scrollRef}
      role="log"
      aria-label="Log"
      className="min-h-0 flex-1 overflow-auto bg-muted/30 py-2 font-mono text-xs leading-5"
    >
      {lines.map((line) => (
        <div key={line.number} className="flex whitespace-pre">
          <span
            aria-hidden
            className="shrink-0 select-none px-3 text-right text-muted-foreground/70 tabular-nums"
            style={{ width: `${width + 3}ch` }}
          >
            {line.number}
          </span>
          <span className={cn('pr-4', LINE_TONE[ciLogLineKind(line.text)])}>
            {line.text}
          </span>
        </div>
      ))}
    </div>
  );
}

/** The tail of a log, or why there is none. */
export function CiLogView({
  title,
  log,
  isLoading,
  error,
  onRetry,
  missing,
}: {
  title: string;
  log: CiLog | undefined;
  isLoading: boolean;
  error: unknown;
  onRetry: () => void;
  /** Set when there is no log to read, saying why. */
  missing: string | null;
}) {
  const range =
    log && log.totalLines > 0
      ? `Lines ${log.firstLine}–${
          log.firstLine + log.text.split('\n').length - 1
        } of ${log.totalLines}`
      : null;
  return (
    <section
      aria-label={`${title} log`}
      className="flex min-h-0 min-w-0 flex-1 flex-col"
    >
      <header className="flex h-8 shrink-0 items-center gap-2 border-b border-border px-3 text-xs">
        <span className="truncate font-semibold">{title}</span>
        {range && <span className="text-muted-foreground">{range}</span>}
        {log?.truncated && (
          <span className="text-muted-foreground">· last lines only</span>
        )}
      </header>
      {missing ? (
        <p className="p-3 text-sm text-muted-foreground">{missing}</p>
      ) : error ? (
        <div role="alert" className="flex items-center gap-3 p-3 text-sm">
          <span className="text-destructive">
            Couldn&apos;t load the log: {errorMessage(error)}
          </span>
          <Button size="sm" variant="outline" onClick={onRetry}>
            Retry
          </Button>
        </div>
      ) : isLoading || !log ? (
        <div className="space-y-2 p-3" aria-label="Loading the log">
          <Skeleton className="h-3 w-2/3" />
          <Skeleton className="h-3 w-1/2" />
          <Skeleton className="h-3 w-3/4" />
        </div>
      ) : (
        <LogLines log={log} />
      )}
    </section>
  );
}
