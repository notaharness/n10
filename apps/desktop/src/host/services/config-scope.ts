import { createConfigService, type ConfigService } from '@n10/engine';
import { NoActiveRepoError } from '../contract.js';
import { PROVIDERS } from './repo.js';
import { pullRequests } from './pull-requests.js';
import { startRemoteSyncLoop } from './remote-sync.js';

let current: ConfigService | null = null;

/** Called after repository detection, before its background services start. */
export function openConfigService(repo: string): void {
  if (current?.repo === repo) {
    current.reload();
    return;
  }
  current = createConfigService({
    repo,
    providers: PROVIDERS,
    pullRequests,
    restartSync: startRemoteSyncLoop,
  });
}

/** Resolving settings state is a read: it never initiates effects. */
export function activeConfigService(): ConfigService {
  if (!current) throw new NoActiveRepoError();
  return current;
}
