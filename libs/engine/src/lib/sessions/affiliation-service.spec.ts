import type { TaggedSession } from '@n10/core';
import { describe, expect, it, vi } from 'vitest';
import { terminalSessionKey } from '@n10/core';
import { createAffiliationService } from './affiliation-service.js';

const PEER = 'abcdefabcdefabcdefabcdefabcdefab';
const CLAUDE = 'claude:conductor';

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
});
