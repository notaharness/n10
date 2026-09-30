import type { PrDiffManifestFile } from '../../../../host/contract.js';
import { cn } from '../../../lib/utils.js';

export type ChangeStatus = PrDiffManifestFile['status'];

const KINDS: Record<
  ChangeStatus,
  { letter: string; label: string; tone: string }
> = {
  added: { letter: 'A', label: 'Added', tone: 'text-success' },
  deleted: { letter: 'D', label: 'Deleted', tone: 'text-destructive' },
  modified: { letter: 'M', label: 'Modified', tone: 'text-warning' },
  renamed: { letter: 'R', label: 'Renamed', tone: 'text-info' },
  copied: { letter: 'C', label: 'Copied', tone: 'text-info' },
  'type-changed': { letter: 'T', label: 'Type changed', tone: 'text-info' },
};

/** What happened to a file, in words: "Renamed from src/old.ts". */
export function changeLabel(status: ChangeStatus, oldPath?: string): string {
  const { label } = KINDS[status];
  const moved = status === 'renamed' || status === 'copied';
  return moved && oldPath ? `${label} from ${oldPath}` : label;
}

/**
 * A file's change kind as git's one-letter code, the way source control
 * views write it. The letter is a glance; its label says it in full
 * for a screen reader and on hover.
 */
export function ChangeKind({
  status,
  oldPath,
  className,
}: {
  status: ChangeStatus;
  oldPath?: string;
  className?: string;
}) {
  const kind = KINDS[status];
  const label = changeLabel(status, oldPath);
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className={cn(
        'w-3 shrink-0 text-center font-mono text-xs font-semibold',
        kind.tone,
        className
      )}
    >
      {kind.letter}
    </span>
  );
}
