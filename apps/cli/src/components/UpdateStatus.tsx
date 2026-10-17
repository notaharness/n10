import { Text } from 'ink';
import { useKeybindResolve } from '@n10/app-core';
import { useUpdates } from '../hooks/useUpdates.js';

export function UpdateStatus() {
  const version = useUpdates().snapshot.availableVersion;
  const keys = useKeybindResolve().getHintKeys('sidebar.open-settings');
  return version ? (
    <Text color="cyan" wrap="truncate">
      Update available · {keys || 'Settings'} → u
    </Text>
  ) : null;
}
