import type { N10HostApi, UpdatePreferences } from '../../../host/contract.js';
export function createUpdatesHost(): Pick<
  N10HostApi,
  | 'onUpdatesChanged'
  | 'getUpdates'
  | 'checkUpdates'
  | 'setUpdatePreferences'
  | 'quitForUpdate'
  | 'updateAndRestart'
> {
  let preferences: UpdatePreferences = { channel: 'preview', automatic: false };
  return {
    onUpdatesChanged: () => () => undefined,
    getUpdates: async () => ({
      restartSupported: false,
      lastUpdate: null,
      installation: { version: 'demo', kind: 'development' },
      preferences,
      checking: false,
      availableVersion: null,
      checkedAt: null,
      retryAt: null,
      error: null,
      command: null,
      releaseNotesUrl: null,
    }),
    checkUpdates: async () => undefined,
    setUpdatePreferences: async (patch) => {
      preferences = { ...preferences, ...patch };
    },
    quitForUpdate: async () => undefined,
    updateAndRestart: async () => undefined,
  };
}
