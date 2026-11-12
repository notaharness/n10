import type { TaggedSession } from '@n10/core';
import { describe, expect, it, vi } from 'vitest';
import { terminalSessionKey } from '@n10/core';
import { createAffiliationService } from './affiliation-service.js';

const PEER = 'abcdefabcdefabcdefabcdefabcdefab';
const CLAUDE = 'claude:conductor';
const SELF = '0123456789abcdef0123456789abcdef';

function shell(name: string, tags: Partial<TaggedSession> = {}): TaggedSession {
  return {
    name,
    created: 1,
    paneDead: false,
    path: `/dirs/${name}`,
    spawner: 'orchestra',
    repo: `/dirs/${name}`,
    type: 'shell',
    branch: '',
    worktreePath: '',
    machine: 'local',
    identityTags: {},
    ...tags,
  };
}

describe('affiliation service', () => {
  it('derives over every machine’s last listing together', () => {
    const service = createAffiliationService({ placeOf: (dir) => dir });
    const remote = shell('far', {
      machine: PEER,
      orchestrator: `beam:${PEER}/${CLAUDE}`,
    });
    service.observe(PEER, [remote]);
    expect(service.of(terminalSessionKey('far', PEER))).toMatchObject({
      key: CLAUDE,
      label: 'Claude · far',
    });
    service.observe('local', [shell('conductor', { target: CLAUDE })]);
    expect(service.of(terminalSessionKey('far', PEER))).toMatchObject({
      key: CLAUDE,
      label: 'conductor',
      home: { key: terminalSessionKey('conductor') },
    });
  });

  it('notifies only when an answer changes', () => {
    const service = createAffiliationService({ placeOf: (dir) => dir });
    const changed = vi.fn();
    service.subscribe(changed);
    service.observe('local', [shell('a')]);
    const first = service.getSnapshot();
    service.observe('local', [shell('a')]);
    expect(changed).toHaveBeenCalledTimes(1);
    expect(service.getSnapshot()).toBe(first);
  });

  it('places a local directory outside any repository as itself', () => {
    const service = createAffiliationService();
    service.observe('local', [shell('root', { path: '/' })]);
    expect(service.of(terminalSessionKey('root'))).toMatchObject({
      kind: 'place',
      key: 'place:/',
    });
  });

  it('reads a tmux: target qualified with this machine’s peerId as here', () => {
    const service = createAffiliationService({ placeOf: (dir) => dir });
    service.observe('local', [shell('boss')]);
    service.observe(PEER, [
      shell('far', { machine: PEER, orchestrator: `beam:${SELF}/tmux:boss` }),
    ]);
    const far = terminalSessionKey('far', PEER);
    expect(service.of(far)?.key).toBe(`beam:${SELF}/tmux:boss`);
    service.observeFleet([
      { peerId: SELF, isLocal: true, state: 'connected' },
      { peerId: PEER, isLocal: false, state: 'connected' },
    ]);
    expect(service.of(far)).toMatchObject({
      key: 'tmux:boss',
      home: { key: terminalSessionKey('boss') },
    });
  });

  it('forgets a peer that leaves the fleet, and keeps one that is only unreachable', () => {
    const service = createAffiliationService({ placeOf: (dir) => dir });
    const far = terminalSessionKey('far', PEER);
    service.observe(PEER, [shell('far', { machine: PEER })]);
    const fleet = (state: string) =>
      service.observeFleet([
        { peerId: SELF, isLocal: true, state: 'connected' },
        { peerId: PEER, isLocal: false, state },
      ]);
    fleet('offline');
    service.observeFleet([]);
    expect(service.of(far)).toBeDefined();
    fleet('revoked');
    expect(service.of(far)).toBeUndefined();
    service.observe(PEER, [shell('far', { machine: PEER })]);
    service.observeFleet([{ peerId: SELF, isLocal: true, state: 'connected' }]);
    expect(service.of(far)).toBeUndefined();
  });

  it('places a session no listing names yet by the listings’ own rule', () => {
    const service = createAffiliationService({
      placeOf: (dir) => (dir.startsWith('/repo/') ? '/repo' : dir),
    });
    expect(service.ofOrPlace('new', '/repo/apps/x')).toEqual({
      kind: 'place',
      key: 'place:/repo',
      label: 'repo',
    });
    service.observe('local', [shell('new', { target: CLAUDE })]);
    expect(
      service.ofOrPlace(terminalSessionKey('new'), '/repo/apps/x').key
    ).toBe(CLAUDE);
  });

  it('gives a session no listing names yet its checkout’s player’s parent', () => {
    const service = createAffiliationService({ placeOf: () => '/repo' });
    const checkout = '/repo/.claude/worktrees/a';
    service.observe('local', [
      shell('conductor', { target: CLAUDE }),
      shell('repo-a', {
        type: 'worktree',
        path: checkout,
        worktreePath: checkout,
        orchestrator: CLAUDE,
      }),
    ]);
    expect(service.ofOrPlace('new', `${checkout}/apps/x`).key).toBe(CLAUDE);
    expect(service.ofOrPlace('new', '/repo/apps/x').key).toBe('place:/repo');
  });
});
