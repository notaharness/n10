import { worktreeSessionKey, terminalSessionKey } from './session-key.js';
import { describe, expect, it } from 'vitest';
import {
  isTerminalSession,
  isWorktreeSessionFor,
  registryNameOf,
} from './session-identity.js';
import { taggedSession } from './session-identity-read.js';
import {
  listed,
  n10Terminal,
  n10Worktree,
  WT,
} from '../../tests/session-tags.js';

describe('matching', () => {
  const worktree = taggedSession(listed('n', n10Worktree()))!;
  const shell = taggedSession(listed('alpha-shell', n10Terminal('shell')))!;

  it('matches a worktree session on repo and canonical checkout path, never its branch', () => {
    expect(isWorktreeSessionFor(worktree, '/repos/alpha', WT)).toBe(true);
    expect(isWorktreeSessionFor(worktree, '/repos/alpha', `${WT}/`)).toBe(true);
    expect(isWorktreeSessionFor(worktree, '/repos/alpha', `${WT}-other`)).toBe(
      false
    );
    expect(isWorktreeSessionFor(worktree, '/repos/alpha', 'feat/a')).toBe(
      false
    );
    expect(isWorktreeSessionFor(worktree, '/repos/alpha/', WT)).toBe(false);
    expect(isWorktreeSessionFor(worktree, '/repos/beta', WT)).toBe(false);
    expect(isWorktreeSessionFor(shell, '/repos/alpha', WT)).toBe(false);
  });

  it('tells a terminal tab from a worktree session by type', () => {
    expect(isTerminalSession(shell)).toBe(true);
    expect(isTerminalSession(worktree)).toBe(false);
  });

  // The registry keys a worktree session by its checkout, and a
  // terminal by its tmux name.
  it('keys a session the way the PTY registry does', () => {
    expect(registryNameOf(worktree)).toBe(
      worktreeSessionKey(WT, '/repos/alpha')
    );
    expect(registryNameOf(shell)).toBe(terminalSessionKey('alpha-shell'));
  });
});
