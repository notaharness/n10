import { Box, Text, useInput } from 'ink';
import type { UpdateSnapshot } from '@n10/engine/contract';
import { useEffect, useState } from 'react';
import { useUpdates } from '../hooks/useUpdates.js';

export function UpdatesPanel({ onClose }: { onClose: () => void }) {
  const { service, snapshot: update, quit, restart } = useUpdates();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const beginUpdate = () => {
    setBusy(true);
    service
      .prepareNpmUpdate()
      .then(restart)
      .catch((e: unknown) => {
        setError(String(e));
        setBusy(false);
      });
  };
  const canRestart = update.restartSupported && !!update.command;
  const shortcuts: Record<string, () => void> = {
    c: () => {
      service.check().catch((e: unknown) => setError(String(e)));
    },
    p: () =>
      service.setPreferences({
        channel:
          update.preferences.channel === 'preview' ? 'stable' : 'preview',
      }),
    a: () =>
      service.setPreferences({ automatic: !update.preferences.automatic }),
    q: () => {
      if (update.command) quit(update.command);
    },
  };
  useInput((input, key) => {
    if (busy) return;
    if (input === 'u' && canRestart) return beginUpdate();
    if (key.escape) return onClose();
    try {
      shortcuts[input]?.();
    } catch (e) {
      setError(String(e));
    }
  });
  return (
    <Box flexDirection="column" paddingX={1}>
      <Text bold color="magenta">
        Settings › Updates
      </Text>
      <UpdateDetails update={update} error={error} />
      {busy && <Text color="cyan">Preparing update…</Text>}
      <UpdateResult update={update} />
      <Box marginTop={1} flexDirection="column">
        <Text bold>
          Release channel:{' '}
          {update.preferences.channel === 'preview' ? 'Preview' : 'Stable'}
        </Text>
        {update.preferences.channel === 'stable' && (
          <Text>n10 doesn’t have a non-beta release yet.</Text>
        )}
        <Text>
          Check automatically: {update.preferences.automatic ? 'On' : 'Off'}
        </Text>
      </Box>
      <Box marginTop={1} flexDirection="column">
        {update.command ? (
          <>
            <Text bold>Update with npm</Text>
            <Text color="cyan">{update.command}</Text>
            <Text>
              {update.restartSupported
                ? 'Press u to close n10, install with npm, and reopen. Or copy the command to update manually.'
                : 'Quit n10, run the command in your terminal, then open n10 --tui again.'}
            </Text>
            <Text dimColor>Your tmux agents keep running.</Text>
          </>
        ) : (
          <UpdateFallback update={update} />
        )}
        {update.releaseNotesUrl && (
          <Text dimColor>Release notes: {update.releaseNotesUrl}</Text>
        )}
      </Box>
      <Box marginTop={1}>
        <Text dimColor>
          No telemetry. Checks send no repository information or credentials.
        </Text>
      </Box>
      <UpdateShortcuts update={update} />
    </Box>
  );
}

function UpdateDetails({
  update,
  error,
}: {
  update: UpdateSnapshot;
  error: string | null;
}) {
  const [expired, setExpired] = useState<number | null>(null);
  useEffect(() => {
    const retryAt = update.retryAt;
    if (!retryAt) return;
    const timer = setTimeout(
      () => setExpired(retryAt),
      Math.max(0, retryAt - Date.now())
    );
    return () => clearTimeout(timer);
  }, [update.retryAt]);
  return (
    <>
      <Text>Current version: {update.installation.version}</Text>
      <Text color={update.availableVersion ? 'green' : undefined}>
        {update.availableVersion
          ? `n10 ${update.availableVersion} is available`
          : update.checkedAt && !update.error
          ? 'You’re up to date'
          : 'Not checked yet'}
      </Text>
      <Text dimColor>
        {update.checking
          ? 'Checking…'
          : update.checkedAt
          ? `Last checked: ${new Date(update.checkedAt).toLocaleString()}`
          : 'Checks run once a day.'}
      </Text>
      {(error || update.error) && (
        <Text color="yellow">{error ?? update.error}</Text>
      )}
      {update.retryAt && update.retryAt !== expired && (
        <Text dimColor>
          Retry after {new Date(update.retryAt).toLocaleTimeString()}
        </Text>
      )}
    </>
  );
}

function UpdateFallback({ update }: { update: UpdateSnapshot }) {
  if (
    ['npm-global', 'npm-local'].includes(update.installation.kind) &&
    !update.availableVersion
  )
    return null;
  return (
    <Text dimColor>
      {update.installation.kind === 'unknown'
        ? 'Identifying installation…'
        : update.installation.kind === 'development'
        ? 'Development build: update your checkout.'
        : 'Update n10 the same way you installed it.'}
    </Text>
  );
}

function UpdateResult({ update }: { update: UpdateSnapshot }) {
  return (
    <>
      {update.lastUpdate && (
        <Text
          color={update.lastUpdate.status === 'failed' ? 'yellow' : 'green'}
        >
          {update.lastUpdate.message}
        </Text>
      )}
      {update.lastUpdate?.status === 'failed' && (
        <Text>npm logs: {update.lastUpdate.logPath}</Text>
      )}
    </>
  );
}

function UpdateShortcuts({ update }: { update: UpdateSnapshot }) {
  return (
    <Box marginTop={1}>
      <Text>
        <Text color="cyan">c</Text> Check now · <Text color="cyan">p</Text>{' '}
        channel · <Text color="cyan">a</Text> automatic
        {update.command && update.restartSupported && (
          <>
            {' '}
            · <Text color="cyan">u</Text> Update and restart
          </>
        )}
        {update.command && (
          <>
            {' '}
            · <Text color="cyan">q</Text> Quit to update
          </>
        )}{' '}
        · Esc back
      </Text>
    </Box>
  );
}
