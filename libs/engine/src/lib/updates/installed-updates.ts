import {
  createUpdateStore,
  detectUpdateInstallation,
  readRegistryVersion,
  updateSource,
} from '@n10/core';
import { createUpdateService } from './update-service.js';

export async function createInstalledUpdates(root: string, packaged = false) {
  const source = updateSource(await detectUpdateInstallation(root, packaged));
  return createUpdateService({
    installation: source.installation,
    store: createUpdateStore(source.source),
    read: (previous, signal) =>
      readRegistryVersion(source.url, previous, signal),
  });
}
