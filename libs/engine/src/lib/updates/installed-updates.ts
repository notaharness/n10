import {
  createUpdateStore,
  prepareNpmUpdate,
  readNpmUpdateResult,
  detectUpdateInstallation,
  inspectUpdateInstallation,
  readRegistryVersion,
  updateSource,
} from '@n10/core';
import { createUpdateService } from './update-service.js';

export function createInstalledUpdates(
  root: string,
  packaged = false,
  shell: 'desktop' | 'tui' = 'desktop'
) {
  const source = updateSource(inspectUpdateInstallation(root, packaged));
  const installRoot =
    source.source === 'fixture'
      ? process.env.N10_UPDATE_TEST_INSTALL ?? root
      : root;
  if (installRoot !== root)
    source.installation = inspectUpdateInstallation(installRoot);
  const supported =
    process.platform !== 'win32' &&
    (shell === 'tui' || !!process.env.N10_UPDATE_HANDOFF);
  return createUpdateService({
    prepare: supported
      ? (version) => prepareNpmUpdate(installRoot, version)
      : undefined,
    lastUpdate: readNpmUpdateResult(installRoot),
    installation: source.installation,
    resolveInstallation:
      source.installation.kind === 'unknown'
        ? () => detectUpdateInstallation(installRoot, packaged)
        : undefined,
    store: createUpdateStore(source.source),
    read: (previous, signal) =>
      readRegistryVersion(source.url, previous, signal),
  });
}
