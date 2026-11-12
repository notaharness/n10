import { describe, expect, it, vi } from 'vitest';
import type { LoadedWorkspace } from '../../../host/contract.js';
import { startFrom } from './workspace-persistence.js';

vi.mock('sonner', () => ({ toast: { error: vi.fn() } }));

/**
 * What a launch starts from, by what the host found: changes are saved
 * only after a load that answered, so a file the host could neither
 * read nor set aside is never written over.
 */
describe('startFrom', () => {
  it.each<[LoadedWorkspace, boolean]>([
    [{ status: 'none' }, true],
    [{ status: 'restored', workspace: {}, goneRepos: [] }, true],
    [{ status: 'set-aside', path: '/x' }, true],
    [{ status: 'unreadable' }, false],
  ])('saves after %j: %s', (loaded, canSave) => {
    expect(startFrom(loaded).canSave).toBe(canSave);
  });
});
