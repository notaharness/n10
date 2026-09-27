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
  Popover,
  PopoverClose,
  PopoverContent,
  PopoverTrigger,
} from './ui/popover.js';
import { Tip } from './ui/tooltip.js';

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
  const seconds = Math.max(1, Math.round(ms / 1000));
  return seconds === 1 ? 'second' : `${seconds} seconds`;
}

function statusText(sync: SyncState, syncing: boolean): string {
  if (syncing) return 'Syncing…';
  if (sync.remoteError) return 'Sync failed';
  return sync.lastRemoteSyncAt
    ? `Last synced ${relativeTime(sync.lastRemoteSyncAt)}`
    : 'Not synced yet';
}

const triggerClass = 'h-full gap-1.5 rounded-none px-1.5 text-xs font-normal';

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
      <UnconfiguredProvider
        providerId={sync.providerId}
        onOpenSettings={onOpenSettings}
      />
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
    <Popover>
      <Tip label="View pull request sync details">
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className={cn(
              triggerClass,
              sync.remoteError && 'text-destructive hover:text-destructive'
            )}
            aria-label={`${name} PR sync: ${statusText(sync, syncing)}`}
          >
            <Icon className={cn('size-3', syncing && 'animate-spin')} />
            {name} PRs
            <span className={cn(!sync.remoteError && 'text-muted-foreground')}>
              · {statusText(sync, syncing)}
            </span>
          </Button>
        </PopoverTrigger>
      </Tip>
      <SyncDetails
        sync={sync}
        name={name}
        syncing={syncing}
        onRefresh={onRefresh}
        onOpenSettings={onOpenSettings}
      />
    </Popover>
  );
}

function SyncDetails({
  sync,
  name,
  syncing,
  onRefresh,
  onOpenSettings,
}: {
  sync: SyncState;
  name: string;
  syncing: boolean;
  onRefresh: () => void;
  onOpenSettings: () => void;
}) {
  return (
    <PopoverContent
      side="top"
      aria-label={`${name} pull request sync`}
      className="space-y-3"
    >
      <div className="space-y-1">
        <h2 className="text-lg font-semibold">{name} pull request sync</h2>
        <p className="text-base text-muted-foreground">
          Open pull requests, review status and checks update automatically,
          about every {cadence(sync.remoteIntervalMs)} while this repository is
          open and the window is visible.
        </p>
      </div>
      <div className="space-y-3 text-base">
        <div className="rounded-md border border-border bg-muted/30 p-3">
          <p className="font-medium">Last successful PR refresh</p>
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
              Automatic retries continue when the window is visible.
            </p>
          </div>
        )}
        <p className="text-muted-foreground">
          This refresh reads pull request data. It does not push commits or
          publish draft comments.
        </p>
        <p className="text-sm text-muted-foreground">
          Merged badges and automatic worktree cleanup run on a separate
          schedule, about every {cadence(sync.maintenanceIntervalMs)}. Refresh
          now does not run those checks, and their errors are not shown here.
          Git fetch and local branch updates also run separately.
        </p>
      </div>
      <div className="flex flex-wrap justify-end gap-2">
        {sync.remoteError && (
          <PopoverClose asChild>
            <Button variant="outline" onClick={onOpenSettings}>
              Open Settings
            </Button>
          </PopoverClose>
        )}
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
      </div>
    </PopoverContent>
  );
}

function UnconfiguredProvider({
  providerId,
  onOpenSettings,
}: {
  providerId: string | null;
  onOpenSettings: () => void;
}) {
  const Icon = providerId ? AlertCircleIcon : CloudOffIcon;
  return (
    <Tip
      label={
        providerId
          ? `${providerName(providerId)} needs credentials — open Settings`
          : 'No VCS provider configured — open Settings'
      }
    >
      <Button
        variant="ghost"
        size="sm"
        onClick={onOpenSettings}
        className={cn(
          triggerClass,
          providerId && 'text-warning hover:text-warning'
        )}
      >
        <Icon className="size-3" />
        {providerId
          ? `${providerName(providerId)} not configured`
          : 'No provider'}
      </Button>
    </Tip>
  );
}
