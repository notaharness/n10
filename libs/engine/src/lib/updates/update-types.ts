import type {
  UpdateCache,
  UpdateInstallation,
  UpdatePreferences,
} from '@n10/core';
export type { UpdateInstallation, UpdatePreferences } from '@n10/core';

export interface UpdateSnapshot {
  installation: UpdateInstallation;
  preferences: UpdatePreferences;
  checking: boolean;
  availableVersion: string | null;
  checkedAt: number | null;
  retryAt: number | null;
  error: string | null;
  command: string | null;
  releaseNotesUrl: string | null;
}
export interface UpdateService {
  getSnapshot(): UpdateSnapshot;
  subscribe(listener: () => void): () => void;
  check(): Promise<void>;
  setPreferences(patch: Partial<UpdatePreferences>): void;
  reloadPreferences(): void;
  start(): void;
  stop(): void;
}
export interface UpdateStore {
  readPreferences(): UpdatePreferences;
  writePreferences(value: UpdatePreferences): void;
  readCache(): UpdateCache;
  writeCache(value: UpdateCache): void;
}
