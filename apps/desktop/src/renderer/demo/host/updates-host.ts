import type { N10HostApi, UpdatePreferences } from '../../../host/contract.js';
export function createUpdatesHost(): Pick<
  N10HostApi,
  | 'onUpdatesChanged'
  | 'getUpdates'
  | 'checkUpdates'
  | 'setUpdatePreferences'
  | 'quitForUpdate'
> {
  let preferences: UpdatePreferences = { channel: 'preview', automatic: false };
  return {
    onUpdatesChanged: () => () => undefined,
    getUpdates: async () => ({
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
  };
}
