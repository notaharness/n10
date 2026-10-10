import { expect, it } from 'vitest';
import {
  retainRuntime,
  sameSavedTarget,
  type SavedTarget,
} from './tab-restore.js';

const saved: SavedTarget = {
  target: { kind: 'tmux', name: 'old' },
  tags: {
    '@orchestra-spawner': 'n10',
    '@orchestra-repo': '/repo',
    '@orchestra-session-type': 'agent',
    '@orchestra-agent': 'claude',
  },
  env: { CLAUDE_CONFIG_DIR: '/original' },
  conversationId: '123e4567-e89b-12d3-a456-426614174000',
};

it('retains captured runtime facts when a dead pane cannot be sampled', () => {
  expect(
    retainRuntime({ target: saved.target, tags: saved.tags }, saved)
  ).toMatchObject({ env: saved.env, conversationId: saved.conversationId });
});

it('does not transfer a Claude tab to a Codex session with the same name and directory', () => {
  const codex = {
    ...saved,
    tags: { ...saved.tags, '@orchestra-agent': 'codex' },
  };
  expect(sameSavedTarget(saved, codex)).toBe(false);
  expect(
    retainRuntime({ target: codex.target, tags: codex.tags }, saved).env
  ).toBeUndefined();
});
