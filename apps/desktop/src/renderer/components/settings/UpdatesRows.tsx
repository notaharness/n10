import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import type { UpdateSnapshot } from '../../../host/contract.js';
import { useUpdateActions, useUpdates } from '../../lib/data/updates.js';
import { errorMessage } from '../../lib/utils.js';
import { Button } from '../ui/button.js';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../ui/select.js';
import { Switch } from '../ui/switch.js';
import { RowShell } from './RowShell.js';
import { UpdateAction } from './UpdateAction.js';

export function UpdatesRows() {
  const query = useUpdates();
  const actions = useUpdateActions();
  const update = query.data;
  if (!update)
    return (
      <p className="p-4 text-sm">
        {query.error ? query.error.message : 'Loading update information…'}
      </p>
    );
  const busy = update.checking || actions.check.isPending;
  const error = actions.preferences.error ?? actions.check.error;
  return (
    <>
      <UpdateCheck
        update={update}
        busy={busy}
        error={error}
        checkedAt={query.dataUpdatedAt}
        onCheck={() => actions.check.mutate()}
      />
      {update.lastUpdate && (
        <div className="space-y-2 px-4 py-3 text-sm" role="status">
          <p>{update.lastUpdate.message}</p>
          {update.lastUpdate.status === 'failed' && (
            <p className="select-text text-muted-foreground">
              npm logs: {update.lastUpdate.logPath}
            </p>
          )}
        </div>
      )}
      <UpdateAction update={update} />
      <RowShell
        label="Release channel"
        description={
          update.preferences.channel === 'stable'
            ? 'n10 doesn’t have a non-beta release yet.'
            : undefined
        }
        control={
          <Select
            value={update.preferences.channel}
            onValueChange={(channel) =>
              actions.preferences.mutate({
                channel: channel as 'preview' | 'stable',
              })
            }
          >
            <SelectTrigger aria-label="Release channel" className="w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="preview">Preview</SelectItem>
              <SelectItem value="stable">Stable</SelectItem>
            </SelectContent>
          </Select>
        }
      />
      <RowShell
        label="Check automatically"
        htmlFor="updates-automatic"
        description="Check once a day. You can also check manually."
        control={
          <Switch
            id="updates-automatic"
            checked={update.preferences.automatic}
            onCheckedChange={(automatic) =>
              actions.preferences.mutate({ automatic })
            }
          />
        }
      />
      <p className="px-4 py-3 text-sm text-muted-foreground">
        Checks request public release metadata from npm. No telemetry,
        repository information or credentials are sent.
      </p>
    </>
  );
}

function updateStatus(update: UpdateSnapshot) {
  if (update.availableVersion)
    return `n10 ${update.availableVersion} is available`;
  if (update.installation.kind === 'unknown')
    return 'Identifying installation…';
  if (update.installation.kind === 'development') return 'Development build';
  if (update.installation.kind === 'packaged') return 'Installer updates';
  return update.checkedAt && !update.error
    ? 'You’re up to date'
    : 'Check for a newer version';
}
function UpdateCheck({
  update,
  busy,
  error,
  checkedAt,
  onCheck,
}: {
  update: UpdateSnapshot;
  busy: boolean;
  error: Error | null;
  checkedAt: number;
  onCheck: () => void;
}) {
  const supported =
    update.installation.kind === 'npm-global' ||
    update.installation.kind === 'npm-local';
  const waiting = useRetryWait(update.retryAt, checkedAt);
  return (
    <div className="space-y-3 px-4 py-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="font-medium">{updateStatus(update)}</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Current version: {update.installation.version}
          </p>
        </div>
        <Button
          variant="outline"
          disabled={!supported || busy || waiting}
          onClick={onCheck}
        >
          {busy ? 'Checking…' : 'Check now'}
        </Button>
      </div>
      <UpdateCheckDetails update={update} error={error} waiting={waiting} />
    </div>
  );
}

function UpdateCheckDetails({
  update,
  error,
  waiting,
}: {
  update: UpdateSnapshot;
  error: Error | null;
  waiting: boolean;
}) {
  return (
    <>
      <p className="text-sm text-muted-foreground">
        {update.checkedAt
          ? `Last checked ${new Date(update.checkedAt).toLocaleString()}`
          : 'Not checked yet'}
        {waiting
          ? ` · Retry after ${new Date(update.retryAt!).toLocaleTimeString()}`
          : ''}
      </p>
      {(update.error || error) && (
        <p role="status" className="text-sm text-warning">
          {update.error ?? error?.message}
        </p>
      )}
      {update.releaseNotesUrl && (
        <Button
          variant="link"
          className="h-auto p-0"
          onClick={() =>
            void window.n10
              .openExternal(update.releaseNotesUrl!)
              .catch((e: unknown) => toast.error(errorMessage(e)))
          }
        >
          Release notes
        </Button>
      )}
    </>
  );
}

function useRetryWait(retryAt: number | null, checkedAt: number) {
  const [expired, setExpired] = useState<number | null>(null);
  useEffect(() => {
    if (!retryAt) return;
    const timer = setTimeout(
      () => setExpired(retryAt),
      Math.max(0, retryAt - Date.now())
    );
    return () => clearTimeout(timer);
  }, [retryAt]);
  return !!retryAt && retryAt > checkedAt && expired !== retryAt;
}
