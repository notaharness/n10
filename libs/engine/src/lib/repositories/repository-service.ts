import { configureWorktreePath, resolveRepositoryRoot } from '@n10/core';
import { autoDetectProjectConfig } from '@n10/vcs-core';
import { createConfigService } from '../config/config-service.js';
import type {
  ConfigService,
  ConfigServiceOptions,
} from '../config/config-service.js';

export interface RepositoryHandle {
  readonly cwd: string;
  readonly config: ConfigService;
}

/** Selection owns a captured-repo config service; metadata comes from that
 * service's snapshot and changes through its subscription, never a second store. */
export function createRepositoryService(
  options: Omit<ConfigServiceOptions, 'repo'>
) {
  let current: RepositoryHandle | null = null;
  return {
    getSnapshot: () => current,
    open(path: string): RepositoryHandle {
      const cwd = resolveRepositoryRoot(path);
      if (current?.cwd === cwd) {
        try {
          current.config.detect();
        } catch {
          current.config.reload();
        }
      } else {
        try {
          autoDetectProjectConfig(cwd, options.providers);
        } catch {
          // Optional detection must not prevent opening a valid checkout.
        }
        current = {
          cwd,
          config: createConfigService({ ...options, repo: cwd }),
        };
      }
      configureWorktreePath(
        cwd,
        current.config.getSnapshot().config.worktreePath
      );
      return current;
    },
    isActive: (cwd: string) => current?.cwd === cwd,
  };
}
