import { ArrowUpIcon, FolderIcon } from 'lucide-react';
import { useEffect, useState, type SyntheticEvent } from 'react';
import type { DirectoryListing } from '../../host/contract.js';
import { errorMessage } from '../lib/utils.js';
import { Button } from './ui/button.js';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog.js';
import { Input } from './ui/input.js';

interface Props {
  title: string;
  /** Where the host is, for the description. */
  where: string;
  list: (path: string | null) => Promise<DirectoryListing>;
  onDone: (path: string | null) => void;
}

/**
 * The app's folder browser, for a host whose files the OS dialog cannot
 * see (`HostTargetView.folders`). A row opens its folder; Open chooses
 * the folder in the path field, shown or typed outright.
 */
export function FolderBrowserDialog({ title, where, list, onDone }: Props) {
  const [listing, setListing] = useState<DirectoryListing | null>(null);
  const [typed, setTyped] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);

  const load = (path: string | null) =>
    list(path)
      .then((next) => {
        setListing(next);
        setTyped(next.path);
        setError(null);
      })
      .catch((err: unknown) => setError(errorMessage(err)))
      .finally(() => setBusy(false));
  const go = (path: string | null) => {
    setBusy(true);
    void load(path);
  };

  // The home directory, once; `busy` starts true for it.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `load` is per render; the first listing is read once
  useEffect(() => void load(null), []);

  const submit = (event: SyntheticEvent) => {
    event.preventDefault();
    if (typed.trim()) go(typed.trim());
  };

  // Open chooses what the path field says: the folder shown, or one
  // typed and not yet gone to, once the host has resolved it.
  const choose = () => {
    const path = typed.trim();
    if (listing && (!path || path === listing.path)) {
      return onDone(listing.path);
    }
    if (!path) return;
    setBusy(true);
    void list(path)
      .then((next) => onDone(next.path))
      .catch((err: unknown) => {
        setError(errorMessage(err));
        setBusy(false);
      });
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onDone(null)}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>On {where}</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="flex gap-2">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Up"
            disabled={busy || !listing?.parent}
            onClick={() => listing?.parent && go(listing.parent)}
          >
            <ArrowUpIcon />
          </Button>
          <Input
            aria-label="Folder path"
            className="font-mono text-xs"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
          />
        </form>
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
        <div
          role="list"
          aria-busy={busy}
          className="max-h-72 min-h-32 overflow-y-auto rounded-md border border-border p-1"
        >
          {listing?.dirs.map((name) => (
            <button
              key={name}
              type="button"
              role="listitem"
              disabled={busy}
              className="flex w-full items-center gap-2 rounded-sm px-2 py-1 text-left text-sm outline-none hover:bg-accent focus-visible:bg-accent"
              onClick={() => go(`${listing.path.replace(/\/$/, '')}/${name}`)}
            >
              <FolderIcon className="size-4 shrink-0 text-muted-foreground" />
              <span className="truncate">{name}</span>
            </button>
          ))}
          {listing && listing.dirs.length === 0 ? (
            <p className="px-2 py-1 text-sm text-muted-foreground">
              No folders here.
            </p>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onDone(null)}>
            Cancel
          </Button>
          <Button
            disabled={busy || (!listing && !typed.trim())}
            onClick={choose}
          >
            Open
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
