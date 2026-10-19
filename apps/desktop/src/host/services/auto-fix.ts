import { createAutoFixerService } from '@n10/engine';
import type { AutoFixChangedEvent } from '../contract.js';
import { activeRepository, activeRepoIs, requireRepo } from './repo.js';
import { defaultPaneSize, isForeignSession } from './sessions.js';
import { adoptSession } from './session-registry.js';
import { pullRequests } from './program.js';

const autoFixers = createAutoFixerService({
  config: (repo) => {
    const active = activeRepository();
    if (active.cwd !== repo)
      throw new Error('Auto-fixer read a parked repository');
    const snapshot = active.config.getSnapshot();
    return {
      ...snapshot,
      provider: snapshot.vcsConfigured ? snapshot.provider : null,
    };
  },
  pullRequests,
  isCurrent: activeRepoIs,
  paneSize: defaultPaneSize,
  isForeignSession,
  spawned: adoptSession,
});
let unsubscribe: (() => void) | undefined;

export function setAutoFixNotifier(
  fn: ((event: AutoFixChangedEvent) => void) | null
): void {
  unsubscribe?.();
  unsubscribe = fn
    ? autoFixers.subscribe((event) => {
        if (event.type === 'spawned')
          fn({ spawned: { prId: event.prId, name: event.name } });
        else if (event.type === 'ended')
          fn({ ended: { prId: event.prId, sourceBranch: event.sourceBranch } });
      })
    : undefined;
}

export function startAutoFix(prId: number) {
  return autoFixers.start(requireRepo(), prId);
}
export const startAutoFixForRepo = autoFixers.start;
export function stopAutoFix(prId: number): void {
  autoFixers.stop(requireRepo(), prId);
}
export const stopAutoFixForBranch = autoFixers.stopBranch;
export const autoFixStatuses = autoFixers.getSnapshot;
export const stopAllAutoFixers = autoFixers.dispose;
