import { assertSelected } from '../kernel/selection.js';
import { isDeepStrictEqual } from 'node:util';
import {
  readConfig,
  isVcsConfigured,
  autoDetectProjectConfig,
  configuredRepository,
  configuredViewer,
} from '@n10/vcs-core';
import type { AppConfig, VcsProvider, RepositoryRef } from '@n10/vcs-core';
import { persistConfigField, persistKeybindFields } from '@n10/core';
import type { KeybindFields, SettingsField } from '@n10/core';
import type { PullRequestList } from '../pull-requests/api.js';
import { configEffects } from './config-effects.js';

export interface ConfigSnapshot {
  config: AppConfig;
  provider: VcsProvider | null;
  vcsConfigured: boolean;
  repository: RepositoryRef | null;
  viewer: string | null;
  revision: number;
  /** Consumed by the engine sync service to replace its schedule. */
  syncRevision: number;
}

export interface ConfigService {
  readonly repo: string;
  getSnapshot(): ConfigSnapshot;
  subscribe(listener: () => void): () => void;
  reload(): void;
  detect(): ReturnType<typeof autoDetectProjectConfig>;
  updateField(field: SettingsField, value: string | undefined): void;
  updateKeybindFields(updater: (prev: KeybindFields) => KeybindFields): void;
}

export interface ConfigServiceOptions {
  repo: string;
  providers: VcsProvider[];
  pullRequests: Pick<PullRequestList, 'credentialsChanged' | 'read'>;
  /** Whether the repository is the selected one: only it takes writes. */
  isCurrent?(): boolean;
}

/** One repository's config. No timers, ambient cwd, or React-owned writes. */
export function createConfigService(
  options: ConfigServiceOptions
): ConfigService {
  const { repo, providers, pullRequests } = options;
  const listeners = new Set<() => void>();
  function describe(
    config: AppConfig,
    revision = 0,
    syncRevision = 0
  ): ConfigSnapshot {
    const provider = providers.find((p) => p.id === config.vendor) ?? null;
    return {
      config,
      provider,
      vcsConfigured: isVcsConfigured(config, provider),
      repository: configuredRepository(config, providers),
      viewer: configuredViewer(config),
      revision,
      syncRevision,
    };
  }
  let snapshot = describe(readConfig(repo));

  function reload(): void {
    const config = readConfig(repo);
    if (isDeepStrictEqual(config, snapshot.config)) return;
    const effects = configEffects(snapshot.config, config);
    snapshot = describe(
      config,
      snapshot.revision + 1,
      snapshot.syncRevision + Number(effects.sync)
    );
    // The write has landed. Invalidate before any subscriber can start a read.
    if (effects.credentials) pullRequests.credentialsChanged();
    if (effects.refresh) void pullRequests.read(repo, { force: true });
    for (const listener of listeners) listener();
  }

  return {
    repo,
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    reload,
    detect() {
      const result = autoDetectProjectConfig(repo, providers);
      reload();
      return result;
    },
    updateField(field, value) {
      assertSelected(options.isCurrent);
      // Read current disk state so a second field write preserves other edits.
      // Re-read after persistence to apply provider selection and global fallbacks.
      persistConfigField(field, value, readConfig(repo).vendor, repo);
      reload();
    },
    updateKeybindFields(updater) {
      assertSelected(options.isCurrent);
      const current = readConfig(repo);
      persistKeybindFields(
        updater({
          keybindPreset: current.keybindPreset,
          keybindOverrides: current.keybindOverrides,
        })
      );
      reload();
    },
  };
}
