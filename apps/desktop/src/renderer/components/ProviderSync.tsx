import {
  AlertCircleIcon,
  CloudOffIcon,
  Loader2Icon,
  RefreshCwIcon,
} from 'lucide-react';
import type { SyncState } from '../../host/contract.js';
import { cn, relativeTime } from '../lib/utils.js';
import { Button } from './ui/button.js';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from './ui/dialog.js';

function providerName(id: string): string {
  if (id === 'github') return 'GitHub';
  if (id === 'azure-devops') return 'Azure DevOps';
  return id;
}

function cadence(ms: number): string {
  if (ms >= 3_600_000 && ms % 3_600_000 === 0) {
    const hours = ms / 3_600_000;
    return hours === 1 ? 'hour' : `${hours} hours`;
  }
  if (ms >= 60_000 && ms % 60_000 === 0) {
    const minutes = ms / 60_000;
    return minutes === 1 ? 'minute' : `${minutes} minutes`;
  }
  return `${Math.max(1, Math.round(ms / 1000))} seconds`;
}

function statusText(sync: SyncState, syncing: boolean): string {
  if (syncing) return 'Syncing…';
  if (sync.remoteError) return 'Sync failed';
  return sync.lastRemoteSyncAt
    ? `Last synced ${relativeTime(sync.lastRemoteSyncAt)}`
    : 'Not synced yet';
}

const triggerClass = 'h-full rounded-none px-1.5 text-xs font-normal';

export function ProviderSync({
  sync,
  refreshing,
  onRefresh,
  onOpenSettings,
}: {
  sync: SyncState;
  refreshing: boolean;
  onRefresh: () => void;
  onOpenSettings: () => void;
}) {
  if (!sync.providerId || !sync.providerConfigured) {
    return (
      <Button
        variant="ghost"
        size="sm"
        onClick={onOpenSettings}
        className={cn(triggerClass, sync.providerId && 'text-warning')}
        title="Configure pull request sync in Settings"
      >
        <CloudOffIcon className="size-3" />
        {sync.providerId
          ? `${providerName(sync.providerId)} not configured`
          : 'No provider'}
      </Button>
    );
  }
  const name = providerName(sync.providerId);
  const syncing = refreshing || sync.remoteSyncing;
  const Icon = syncing
    ? Loader2Icon
    : sync.remoteError
    ? AlertCircleIcon
    : RefreshCwIcon;
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className={cn(triggerClass, sync.remoteError && 'text-destructive')}
          aria-label={`${name} PR sync: ${statusText(sync, syncing)}`}
        >
          <Icon className={cn('size-3', syncing && 'animate-spin')} />
          {name} PRs
          <span className={cn(!sync.remoteError && 'text-muted-foreground')}>
            · {statusText(sync, syncing)}
          </span>
        </Button>
      </DialogTrigger>
      <SyncDetails
        sync={sync}
        name={name}
        syncing={syncing}
        onRefresh={onRefresh}
      />
    </Dialog>
  );
}

function SyncDetails({
  sync,
  name,
  syncing,
  onRefresh,
}: {
  sync: SyncState;
  name: string;
  syncing: boolean;
  onRefresh: () => void;
}) {
  return (
    <DialogContent className="max-h-[calc(100vh-2rem)] overflow-y-auto">
      <DialogHeader>
        <DialogTitle>{name} pull request sync</DialogTitle>
        <DialogDescription>
          Pull requests, review status and checks update automatically, about
          every {cadence(sync.remoteIntervalMs)} while this repository is open.
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-3 text-base">
        <div className="rounded-md border border-border bg-muted/30 p-3">
          <p className="font-medium">Last successful sync</p>
          {sync.lastRemoteSyncAt ? (
            <time
              dateTime={new Date(sync.lastRemoteSyncAt).toISOString()}
              className="text-muted-foreground"
            >
              {new Date(sync.lastRemoteSyncAt).toLocaleString()}
            </time>
          ) : (
            <p className="text-muted-foreground">Not synced yet</p>
          )}
        </div>
        {sync.remoteError && (
          <div
            role="alert"
            className="space-y-1 rounded-md border border-destructive/30 bg-destructive/5 p-3"
          >
            <p className="font-medium text-destructive">
              Could not refresh {name}
            </p>
            <p className="break-words whitespace-pre-wrap text-sm">
              {sync.remoteError}
            </p>
            <p className="text-sm text-muted-foreground">
              {sync.lastRemoteSyncAt
                ? 'Showing the last successful data; it may be out of date.'
                : 'Pull request data is not available yet.'}{' '}
              Automatic retries continue.
            </p>
          </div>
        )}
        <p className="text-muted-foreground">
          This refresh reads pull request data. It does not push commits or
          publish draft comments. Git fetch and local branch updates run
          separately.
        </p>
      </div>
      <DialogFooter>
        <Button onClick={onRefresh} disabled={syncing}>
          <RefreshCwIcon
            className={cn('size-3.5', syncing && 'animate-spin')}
          />
          {syncing
            ? 'Refreshing…'
            : sync.remoteError
            ? 'Retry now'
            : 'Refresh now'}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
