import {
  createPullRequestList,
  createRepositoryService,
  providerResolver,
} from '@n10/engine';
import { PROVIDERS } from './providers.js';

export const pullRequests = createPullRequestList({ providers: PROVIDERS });
export const resolveProvider = providerResolver(PROVIDERS);
let restartSync: ((repo: string) => void) | null = null;

/** The host supplies its sync adapter until that domain is engine-owned. */
export function setSyncRestarter(restart: (repo: string) => void): void {
  restartSync = restart;
}

export const repositories = createRepositoryService({
  providers: PROVIDERS,
  pullRequests,
  restartSync: (repo) => restartSync?.(repo),
});
