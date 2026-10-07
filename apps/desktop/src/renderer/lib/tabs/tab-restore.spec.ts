import { expect, it } from 'vitest';
import { retainRuntime, sameSavedTarget } from './tab-restore.js';

const saved = {
  tmuxName: 'old',
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
    retainRuntime({ tmuxName: saved.tmuxName, tags: saved.tags }, saved)
  ).toMatchObject({ env: saved.env, conversationId: saved.conversationId });
});

it('does not transfer a Claude tab to a Codex session with the same name and directory', () => {
  const codex = {
    ...saved,
    tags: { ...saved.tags, '@orchestra-agent': 'codex' },
  };
  expect(sameSavedTarget(saved, codex)).toBe(false);
  expect(
    retainRuntime({ tmuxName: codex.tmuxName, tags: codex.tags }, saved).env
  ).toBeUndefined();
});
