import { AlertCircleIcon, FileWarningIcon } from 'lucide-react';
import type {
  Coverage,
  CoverageBucket,
  Unavailable,
} from '../../../lib/diff/coverage.js';
import { cn } from '../../../lib/utils.js';
import { formatBytes } from './FileBodyNotice.js';

/**
 * The files the diff cannot show as it stands, under the Files header:
 * how many, why, and a way to the first of each kind. The tree marks
 * each such file too, so none has to be found by scrolling.
 */

const KINDS: readonly Unavailable[] = ['large', 'too-large', 'error'];

const MARK: Record<Unavailable, { title: string; tone: string }> = {
  large: { title: 'Not loaded: large file', tone: 'text-muted-foreground' },
  'too-large': { title: 'Too large to show', tone: 'text-destructive' },
  error: { title: 'Couldn’t load this file', tone: 'text-destructive' },
};

function label(kind: Unavailable, bucket: CoverageBucket): string {
  if (kind === 'large') {
    return `${bucket.count} large (${formatBytes(bucket.bytes)})`;
  }
  return `${bucket.count} ${kind === 'error' ? 'failed' : 'too large'}`;
}

function KindIcon({
  kind,
  className,
}: {
  kind: Unavailable;
  className?: string;
}) {
  const Icon = kind === 'large' ? FileWarningIcon : AlertCircleIcon;
  return <Icon className={cn('size-3 shrink-0', MARK[kind].tone, className)} />;
}

/** A tree row's mark for a file the diff does not show. */
export function UnavailableMark({ kind }: { kind: Unavailable }) {
  return (
    <span role="img" aria-label={MARK[kind].title} title={MARK[kind].title}>
      <KindIcon kind={kind} />
    </span>
  );
}

export function FileCoverage({
  coverage,
  onSelect,
}: {
  coverage: Coverage;
  onSelect: (path: string) => void;
}) {
  const kinds = KINDS.filter((k) => coverage.unavailable[k]);
  if (kinds.length === 0) return null;
  const count = kinds.reduce(
    (n, k) => n + (coverage.unavailable[k]?.count ?? 0),
    0
  );
  return (
    <div
      role="group"
      aria-label="Files not shown"
      className="flex flex-wrap items-center gap-1 px-2 pb-1.5 text-xs text-muted-foreground"
    >
      <span>
        {count} of {coverage.textFiles} not shown:
      </span>
      {kinds.map((kind) => {
        const bucket = coverage.unavailable[kind]!;
        return (
          <button
            key={kind}
            type="button"
            onClick={() => onSelect(bucket.first)}
            title={`Go to ${bucket.first}`}
            className="flex h-5 items-center gap-1 rounded border border-border px-1.5 hover:bg-accent hover:text-foreground"
          >
            <KindIcon kind={kind} />
            {label(kind, bucket)}
          </button>
        );
      })}
    </div>
  );
}
