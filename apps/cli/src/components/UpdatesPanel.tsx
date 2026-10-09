import { Box, Text, useInput } from 'ink';
import type { UpdateSnapshot } from '@n10/engine/contract';
import { useState } from 'react';
import { useUpdates } from '../hooks/useUpdates.js';

export function UpdatesPanel({ onClose }: { onClose: () => void }) {
  const { service, snapshot: update, quit } = useUpdates();
  const [error, setError] = useState<string | null>(null);
  useInput((input, key) => {
    if (key.escape) return onClose();
    try {
      if (input === 'c')
        service.check().catch((e: unknown) => setError(String(e)));
      if (input === 'p')
        service.setPreferences({
          channel:
            update.preferences.channel === 'preview' ? 'stable' : 'preview',
        });
      if (input === 'a')
        service.setPreferences({ automatic: !update.preferences.automatic });
      if (input === 'q' && update.command) quit();
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
      <Box marginTop={1} flexDirection="column">
        <Text bold>
          Release channel:{' '}
          {update.preferences.channel === 'preview' ? 'Preview' : 'Stable'}
        </Text>
        <Text>n10 doesn’t have a non-beta release yet.</Text>
        <Text dimColor>
          Both choices receive Preview builds for now. Your preference is saved.
        </Text>
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
              Quit n10, run the command in your terminal, then open n10 --tui
              again.
            </Text>
            <Text dimColor>Your tmux agents keep running.</Text>
          </>
        ) : (
          <Text dimColor>
            {update.installation.kind === 'development'
              ? 'Development build: update your checkout.'
              : 'Update using the package manager and location you installed with.'}
          </Text>
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
      <Box marginTop={1}>
        <Text>
          <Text color="cyan">c</Text> Check now · <Text color="cyan">p</Text>{' '}
          channel · <Text color="cyan">a</Text> automatic
          {update.command ? ' · q Quit to update' : ''} · Esc back
        </Text>
      </Box>
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
      {update.retryAt && (
        <Text dimColor>
          Retry after {new Date(update.retryAt).toLocaleTimeString()}
        </Text>
      )}
    </>
  );
}
