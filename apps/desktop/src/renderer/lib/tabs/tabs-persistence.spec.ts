import { expect, it } from 'vitest';
import { decodeTabs, encodeTabs } from './tabs-persistence.js';
import { EMPTY_TABS, reduce } from './tabs-model.js';

it('round trips tab order, focus and terminal identity across launches', () => {
  const state = reduce(EMPTY_TABS, {
    type: 'open-terminal',
    terminal: {
      name: 'terminal:peer:old',
      kind: 'agent',
      cwd: '/repo',
      displayPath: '~/repo',
      repo: '/repo',
    },
  });
  const loaded = decodeTabs(encodeTabs(state));
  expect(loaded).toEqual(state);
});

it('rejects incomplete saved tab data before the reducer sees it', () => {
  expect(
    decodeTabs({ version: 1, state: { tabs: [{ kind: 'terminal' }] } })
  ).toBeNull();
});

const terminal = {
  id: 'terminal:old',
  kind: 'terminal',
  name: 'old',
  terminalKind: 'agent',
  cwd: '/repo',
  displayPath: '/repo',
  repo: '/repo',
  preview: false,
  listed: true,
  resumeRequired: true,
  restore: {
    target: { kind: 'tmux', name: 'old' },
    tags: {
      '@orchestra-spawner': 'n10',
      '@orchestra-repo': '/repo',
      '@orchestra-session-type': 'agent',
    },
    env: { CLAUDE_CONFIG_DIR: '/old' },
  },
};
const snapshot = (tab: unknown) => ({
  version: 1,
  state: {
    tabs: [tab],
    activeId: null,
    autoOpened: [],
    unseen: [],
    lastActiveByRepo: {},
  },
});

it('rejects corrupted resume metadata before displaying a saved tab', () => {
  expect(decodeTabs(snapshot(terminal))).not.toBeNull();
  expect(
    decodeTabs(
      snapshot({
        ...terminal,
        restore: {
          ...terminal.restore,
          tags: {
            '@orchestra-spawner': 'orchestra',
            '@orchestra-session-type': 'agent',
          },
        },
      })
    )
  ).not.toBeNull();
  expect(
    decodeTabs(snapshot({ ...terminal, id: 'terminal:another' }))
  ).toBeNull();
  expect(
    decodeTabs(
      snapshot({
        ...terminal,
        restore: { ...terminal.restore, tags: { '@orchestra-repo': 1 } },
      })
    )
  ).toBeNull();
  expect(
    decodeTabs(
      snapshot({
        ...terminal,
        restore: { ...terminal.restore, env: { CLAUDE_CONFIG_DIR: 1 } },
      })
    )
  ).toBeNull();
  expect(
    decodeTabs(snapshot({ ...terminal, resumeRequired: 'true' }))
  ).toBeNull();
});

it('rejects a saved session target it cannot address', () => {
  const withTarget = (restore: Record<string, unknown>) =>
    snapshot({ ...terminal, restore: { ...terminal.restore, ...restore } });
  expect(decodeTabs(withTarget({}))).not.toBeNull();
  const managed = { kind: 'mux', hostId: 'h', sessionId: 's', name: 'old' };
  expect(decodeTabs(withTarget({ target: managed }))).not.toBeNull();
  expect(
    decodeTabs(withTarget({ target: { ...managed, sessionId: '' } }))
  ).toBeNull();
  expect(
    decodeTabs(withTarget({ target: { kind: 'screen', name: 'old' } }))
  ).toBeNull();
  expect(
    decodeTabs(withTarget({ target: { kind: 'tmux', name: '' } }))
  ).toBeNull();
  // The shape before targets were discriminated.
  expect(
    decodeTabs(withTarget({ target: undefined, tmuxName: 'old' }))
  ).toBeNull();
});
