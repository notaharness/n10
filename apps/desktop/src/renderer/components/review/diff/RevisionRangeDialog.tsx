import { useId, useState } from 'react';
import {
  short,
  type RevisionEntry,
  type RevisionPair,
} from '../../../lib/review/revision-model.js';
import { relativeTime } from '../../../lib/utils.js';
import { Button } from '../../ui/button.js';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../ui/dialog.js';
import { Label } from '../../ui/label.js';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../ui/select.js';

/**
 * Two revisions of the pull request to compare, from those its history
 * names (`revisionEntries`): each with what it was — a push, a
 * force-push, the reader's last visit or review — and when.
 */

function defaultsOf(
  entries: readonly RevisionEntry[],
  initial: RevisionPair | null
): RevisionPair {
  if (initial) return initial;
  const shown = entries.find((e) => e.labels.includes('On screen'));
  const to = shown?.oid ?? entries[0]?.oid ?? '';
  const from = entries.find((e) => e.oid !== to)?.oid ?? '';
  return { from, to };
}

function RevisionField({
  label,
  value,
  entries,
  onChange,
}: {
  label: string;
  value: string;
  entries: readonly RevisionEntry[];
  onChange: (oid: string) => void;
}) {
  const id = useId();
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger id={id} className="w-full text-sm">
          <SelectValue />
        </SelectTrigger>
        <SelectContent className="max-h-72">
          {entries.map((e) => (
            <SelectItem
              key={e.oid}
              value={e.oid}
              description={e.at === null ? undefined : relativeTime(e.at)}
            >
              <span className="flex gap-2">
                <span className="font-mono">{short(e.oid)}</span>
                <span>{e.labels.join(' · ')}</span>
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

export function RevisionRangeDialog({
  entries,
  initial,
  onChoose,
  onClose,
  returnFocus,
}: {
  entries: readonly RevisionEntry[];
  initial: RevisionPair | null;
  onChoose: (pair: RevisionPair) => void;
  onClose: () => void;
  /** Where the keyboard goes once the dialog closes, however it does. */
  returnFocus: () => void;
}) {
  const [pair, setPair] = useState(() => defaultsOf(entries, initial));
  const same = pair.from === pair.to;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        // The dialog itself, not the first field: opened by Enter on
        // the selector's option, that Enter's click would open the
        // From list over it.
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          if (e.currentTarget instanceof HTMLElement) e.currentTarget.focus();
        }}
        onCloseAutoFocus={(e) => {
          e.preventDefault();
          returnFocus();
        }}
      >
        <DialogHeader>
          <DialogTitle>Compare two revisions</DialogTitle>
          <DialogDescription>
            The diff shows every change from the first to the second.
          </DialogDescription>
        </DialogHeader>
        <RevisionField
          label="From"
          value={pair.from}
          entries={entries}
          onChange={(from) => setPair((p) => ({ ...p, from }))}
        />
        <RevisionField
          label="To"
          value={pair.to}
          entries={entries}
          onChange={(to) => setPair((p) => ({ ...p, to }))}
        />
        {same && (
          <p className="text-sm text-muted-foreground" role="status">
            Choose two different revisions.
          </p>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={same} onClick={() => onChoose(pair)}>
            Compare
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
