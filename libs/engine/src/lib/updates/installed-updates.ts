import {
  createUpdateStore,
  detectUpdateInstallation,
  inspectUpdateInstallation,
  readRegistryVersion,
  updateSource,
} from '@n10/core';
import { createUpdateService } from './update-service.js';

export function createInstalledUpdates(root: string, packaged = false) {
  const source = updateSource(inspectUpdateInstallation(root, packaged));
  return createUpdateService({
    installation: source.installation,
    resolveInstallation:
      source.installation.kind === 'unknown'
        ? () => detectUpdateInstallation(root, packaged)
        : undefined,
    store: createUpdateStore(source.source),
    read: (previous, signal) =>
      readRegistryVersion(source.url, previous, signal),
  });
}
