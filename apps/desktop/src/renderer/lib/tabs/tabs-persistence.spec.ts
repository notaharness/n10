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

it('rejects corrupted resume metadata before displaying a saved tab', () => {
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
      tmuxName: 'old',
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
