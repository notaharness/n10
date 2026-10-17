import { describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import { createTemplateResolver, worktreeScope } from './worktree-resolver.js';

describe('captured worktree path policy', () => {
  it('uses the conventional directory and sanitizes session placeholders', () => {
    const scope = worktreeScope('/repo');
    expect(scope.resolver.dir('feature/auth')).toBe(
      '.claude/worktrees/feature-auth'
    );
    expect(scope.resolver.base()).toBe(resolve('/repo/.claude/worktrees'));
  });
  it('preserves slashes in branch placeholders', () => {
    expect(
      createTemplateResolver('trees/{branch}', '/repo').dir('feature/auth')
    ).toBe('trees/feature/auth');
  });
  it('owns its base and descendants, excluding similarly named siblings', () => {
    const resolver = worktreeScope('/repo').resolver;
    const base = resolver.base();
    expect(resolver.owns(base)).toBe(true);
    expect(resolver.owns(base + '/feature-auth')).toBe(true);
    expect(resolver.owns(base + '-old/stale')).toBe(false);
  });
  it('keeps two different repository templates independent', () => {
    const a = worktreeScope('/repos/a', { template: '../a-trees/{session}' });
    const b = worktreeScope('/elsewhere/b', { template: 'b-trees/{session}' });
    expect(a.resolver.base()).toBe(resolve('/repos/a-trees'));
    expect(b.resolver.base()).toBe(resolve('/elsewhere/b/b-trees'));
    expect(a.resolver.owns(b.resolver.base() + '/topic')).toBe(false);
    expect(a.resolver.dir('topic')).toBe('../a-trees/topic');
  });
  it('keeps absolute templates independent of the repository root', () => {
    const shared = resolve('/shared/trees');
    const a = worktreeScope('/repos/a', { template: shared + '/{session}' });
    const b = worktreeScope('/repos/b', { template: shared + '/{session}' });
    expect(a.resolver.base()).toBe(shared);
    expect(b.resolver.base()).toBe(shared);
  });
  it('accepts the forward slashes emitted by Git on every platform', () => {
    const resolver = worktreeScope(process.cwd()).resolver;
    expect(
      resolver.owns(resolver.base().replace(/\\/g, '/') + '/feature')
    ).toBe(true);
  });
  it('folds path case only on Windows', () => {
    const resolver = worktreeScope(process.cwd()).resolver;
    expect(resolver.owns(resolver.base().toUpperCase() + '/FEATURE')).toBe(
      process.platform === 'win32'
    );
  });
});
