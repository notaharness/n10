import { createBabysitterService } from '@n10/engine';
import type { BabysitChangedEvent } from '../contract.js';
import { activeRepository, activeRepoIs, requireRepo } from './repo.js';
import { defaultPaneSize, isForeignSession } from './sessions.js';
import { adoptSession } from './session-registry.js';
import { pullRequests } from './program.js';

const babysitters = createBabysitterService({
  config: (repo) => {
    const active = activeRepository();
    if (active.cwd !== repo)
      throw new Error('Babysitter read a parked repository');
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

export function setBabysitNotifier(
  fn: ((event: BabysitChangedEvent) => void) | null
): void {
  unsubscribe?.();
  unsubscribe = fn
    ? babysitters.subscribe((event) => {
        if (event.type === 'spawned')
          fn({ spawned: { prId: event.prId, name: event.name } });
        else if (event.type === 'ended')
          fn({ ended: { prId: event.prId, sourceBranch: event.sourceBranch } });
      })
    : undefined;
}

export function startBabysit(prId: number) {
  return babysitters.start(requireRepo(), prId);
}
export const startBabysitForRepo = babysitters.start;
export function stopBabysit(prId: number): void {
  babysitters.stop(requireRepo(), prId);
}
export const stopBabysitForBranch = babysitters.stopBranch;
export const babysatStatuses = babysitters.getSnapshot;
export const stopAllBabysitters = babysitters.dispose;
