import { useState } from 'react';
import { toast } from 'sonner';
import type { UpdateSnapshot } from '../../../host/contract.js';
import { Button } from '../ui/button.js';
import { errorMessage } from '../../lib/utils.js';

export function UpdateAction({ update }: { update: UpdateSnapshot }) {
  const [copied, setCopied] = useState(false);
  const command = update.command;
  if (
    update.installation.kind === 'unknown' ||
    (['npm-global', 'npm-local'].includes(update.installation.kind) &&
      !update.availableVersion)
  )
    return null;
  if (!command)
    return (
      <p className="px-4 py-3 text-sm text-muted-foreground">
        {update.installation.kind === 'development'
          ? 'Development build. Update your checkout to get the latest changes.'
          : update.installation.kind === 'packaged'
          ? 'Download the latest version from n10.is/download.'
          : 'Update n10 the same way you installed it.'}
      </p>
    );
  if (!update.availableVersion) return null;
  const copy = () =>
    navigator.clipboard
      .writeText(command)
      .then(() => setCopied(true))
      .catch((error: unknown) => toast.error(errorMessage(error)));
  const quit = () =>
    window.n10
      .quitForUpdate()
      .catch((error: unknown) => toast.error(errorMessage(error)));
  return (
    <div className="space-y-3 px-4 py-4">
      <div>
        <p className="font-medium">Update with npm</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Copy the command, quit n10, then run it in your terminal. Open n10
          again when it finishes.
        </p>
      </div>
      <div className="flex items-center gap-3 rounded-md border border-border bg-background p-3">
        <code className="min-w-0 flex-1 select-text break-all text-sm">
          {command}
        </code>
        <Button variant="outline" onClick={() => void copy()}>
          {copied ? 'Copied' : 'Copy command'}
        </Button>
      </div>
      <div className="flex items-center justify-between gap-4">
        <p className="text-sm text-muted-foreground">
          Your tmux agents keep running. Save any unfinished review text before
          quitting.
        </p>
        <Button onClick={() => void quit()}>Quit to update</Button>
      </div>
    </div>
  );
}
