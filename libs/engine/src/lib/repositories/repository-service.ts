import { isDeepStrictEqual } from 'node:util';
import { canonicalRepoPath, configureWorktreePath, isGitRepo } from '@n10/core';
import {
  autoDetectProjectConfig,
  isVcsConfigured,
  readConfig,
} from '@n10/vcs-core';
import type { AppConfig, RepositoryRef, VcsProvider } from '@n10/vcs-core';

export interface RepositorySnapshot {
  cwd: string;
  providerId: string | null;
  vcsConfigured: boolean;
  repository: RepositoryRef | null;
  viewer: string | null;
}

export function configuredViewer(config: AppConfig): string | null {
  const identifier =
    config.vendor === 'github' ? config.vendorProject.username : config.email;
  return identifier || null;
}

export function configuredRepository(
  config: AppConfig,
  providers: VcsProvider[]
): RepositoryRef | null {
  const provider = providers.find((p) => p.id === config.vendor) ?? null;
  if (!provider || !isVcsConfigured(config, provider)) return null;
  return provider.repositoryRef?.(config.vendorProject) ?? null;
}

/** Repository identity and opening policy, independent of shell navigation. */
export function createRepositoryService(providers: VcsProvider[]) {
  let snapshot: RepositorySnapshot | null = null;
  const listeners = new Set<() => void>();

  function describe(cwd: string): RepositorySnapshot {
    const config = readConfig(cwd);
    const provider = providers.find((p) => p.id === config.vendor) ?? null;
    return {
      cwd,
      providerId: provider?.id ?? null,
      vcsConfigured: isVcsConfigured(config, provider),
      repository: configuredRepository(config, providers),
      viewer: configuredViewer(config),
    };
  }

  function publish(next: RepositorySnapshot): RepositorySnapshot {
    if (!isDeepStrictEqual(snapshot, next)) {
      snapshot = next;
      for (const listener of listeners) listener();
    }
    return snapshot ?? next;
  }

  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    open(path: string): RepositorySnapshot {
      const cwd = canonicalRepoPath(path);
      if (!isGitRepo(cwd)) throw new Error(`Not a git repository: ${path}`);
      try {
        autoDetectProjectConfig(cwd, providers);
      } catch {
        // Detection fills optional fields; a failed probe must not block opening.
      }
      configureWorktreePath(cwd, readConfig(cwd).worktreePath);
      return publish(describe(cwd));
    },
    reload(): RepositorySnapshot | null {
      return snapshot ? publish(describe(snapshot.cwd)) : null;
    },
    isActive: (cwd: string) => snapshot?.cwd === cwd,
  };
}
