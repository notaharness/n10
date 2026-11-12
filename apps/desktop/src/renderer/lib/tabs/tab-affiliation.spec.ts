import { placeAffiliation, type Affiliation } from '@n10/core/ui';
import { describe, expect, it } from 'vitest';
import { affiliationIndex, tabFacts } from './tab-affiliation.js';
import { itemTabId, terminalTabId, type Tab } from './tab-identity.js';

const PARENT: Affiliation = { kind: 'parent', key: 'codex:x', label: 'Codex' };
const index = affiliationIndex({
  repo: '/repo',
  sessions: [{ name: 'wt-a', path: '/repo/wt/a', affiliation: PARENT }],
  terminals: [{ name: 'shell-1', affiliation: placeAffiliation('/repo') }],
  foreign: [
    {
      sessionName: 'far',
      repo: '/other',
      worktree: '/other/wt/b',
      affiliation: PARENT,
    },
  ],
});
const item = (repo: string, worktree?: string): Tab => ({
  id: itemTabId(repo, 'branch:x'),
  kind: 'item',
  repo,
  itemKey: 'branch:x',
  preview: false,
  ...(worktree ? { worktree } : {}),
});
const terminal = (name: string, cwd: string, repo: string | null): Tab => ({
  id: terminalTabId(name),
  kind: 'terminal',
  name,
  terminalKind: 'shell',
  cwd,
  displayPath: cwd,
  repo,
  preview: false,
  listed: true,
});

describe('tabFacts', () => {
  it('takes its session’s affiliation', () => {
    expect(tabFacts(item('/repo'), 'wt-a', index).affiliation).toBe(PARENT);
  });
  it('takes its checkout’s, another repository’s included', () => {
    expect(tabFacts(item('/other', '/other/wt/b'), undefined, index)).toEqual({
      affiliation: PARENT,
    });
  });
  it('falls back to its repository, or a terminal’s directory', () => {
    expect(tabFacts(item('/repo'), undefined, index).affiliation).toEqual(
      placeAffiliation('/repo')
    );
    expect(
      tabFacts(terminal('t', '/tmp/notes', null), 't', index).affiliation
    ).toEqual(placeAffiliation('/tmp/notes'));
  });
  it('gives settings none', () => {
    expect(
      tabFacts(
        { id: 'settings', kind: 'settings', preview: false },
        undefined,
        index
      )
    ).toEqual({ affiliation: null });
  });
});
