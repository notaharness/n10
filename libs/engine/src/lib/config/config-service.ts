import { isDeepStrictEqual } from 'node:util';
import { readConfig, isVcsConfigured } from '@n10/vcs-core';
import type { AppConfig, VcsProvider } from '@n10/vcs-core';
import { persistConfigField, persistKeybindFields } from '@n10/core';
import type { KeybindFields, SettingsField } from '@n10/core';
import type { PullRequestList } from '../pull-requests/pull-request-list.js';
import { configEffects } from './config-effects.js';

export interface ConfigSnapshot {
  config: AppConfig;
  provider: VcsProvider | null;
  vcsConfigured: boolean;
  revision: number;
  /** Consumed by the TUI's sync adapter to replace its polling schedule. */
  syncRevision: number;
}

export interface ConfigService {
  readonly repo: string;
  readonly providers: VcsProvider[];
  getSnapshot(): ConfigSnapshot;
  subscribe(listener: () => void): () => void;
  reload(): void;
  updateField(field: SettingsField, value: string | undefined): void;
  updateKeybindFields(updater: (prev: KeybindFields) => KeybindFields): void;
}

export interface ConfigServiceOptions {
  repo: string;
  providers: VcsProvider[];
  pullRequests: Pick<PullRequestList, 'credentialsChanged' | 'read'>;
  /** Adapter for the desktop's sync loop, until sync is an engine domain. */
  restartSync?: (repo: string) => void;
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
    if (effects.sync) options.restartSync?.(repo);
    for (const listener of listeners) listener();
  }

  return {
    repo,
    providers,
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    reload,
    updateField(field, value) {
      // Read current disk state so a second field write preserves other edits.
      // Re-read after persistence to apply provider selection and global fallbacks.
      persistConfigField(field, value, readConfig(repo).vendor, repo);
      reload();
    },
    updateKeybindFields(updater) {
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
