import { expect, it, vi } from 'vitest';
import { installHostPushes } from './host-pushes.js';

const state = vi.hoisted(() => ({
  restart: vi.fn(),
  opened: vi.fn(),
  discover: vi.fn(),
}));
vi.mock('./services/repo.js', () => ({ setRepoOpenedListener: state.opened }));
vi.mock('./services/remote-sync.js', () => ({
  startRemoteSyncLoop: state.restart,
  setSyncNotifier: vi.fn(),
}));
vi.mock('./services/pull-requests.js', () => ({
  setRemoteUpdatedNotifier: vi.fn(),
}));
vi.mock('./services/discovery.js', () => ({
  startDiscoveryForRepo: state.discover,
  setDiscoveryNotifier: vi.fn(),
}));
vi.mock('./services/sessions.js', () => ({ setSessionBroadcaster: vi.fn() }));
vi.mock('./services/babysit.js', () => ({ setBabysitNotifier: vi.fn() }));
vi.mock('./services/machines.js', () => ({
  setBeamStatusNotifier: vi.fn(),
  setCeremonyProgressNotifier: vi.fn(),
  setDirectoryPublishedNotifier: vi.fn(),
  setMachinesNotifier: vi.fn(),
}));

it('installs repository opening to start the engine sync and discovery adapters', () => {
  installHostPushes({ broadcast: vi.fn(), sendTo: vi.fn() });
  const opened = state.opened.mock.calls[0][0] as (repo: string) => void;
  opened('/repo');
  expect(state.restart).toHaveBeenCalledExactlyOnceWith('/repo');
  expect(state.discover).toHaveBeenCalledExactlyOnceWith('/repo');
});
