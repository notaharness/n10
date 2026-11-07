import { describe, expect, it } from 'vitest';
import {
  sanitizeLabelPart,
  terminalSessionLabel,
  worktreeSessionLabel,
} from './session-label.js';

/**
 * Names are labels, tags are identity. The label builder is the half
 * of the convention both programs implement independently (Orchestra
 * in bash), so its outputs are pinned as literals — Orchestra pins the
 * same cases in `orchestra/tests/test_port.py` — rather than derived
 * from the function under test.
 */
describe('session labels', () => {
  // The cases Orchestra's test_port.py pins: repo, type, branch →
  // label. `/`, `.` and `:` become `-`; the repo's
  // basename keeps its case; on overflow the first 195 characters, `-`
  // and four hex digits of the SHA-256 of the *unsanitized*
  // `<basename>-<branch>`.
  it.each([
    ['/home/u/n10', 'worktree', 'feature/x', 'n10-feature-x'],
    [
      '/srv/agent-plugins',
      'worktree',
      'fix/typo.v1.2:rc',
      'agent-plugins-fix-typo-v1-2-rc',
    ],
    ['/x/my.repo', 'worktree', 'main', 'my-repo-main'],
    ['/home/u/n10', 'shell', '', 'n10-shell'],
    ['/home/u/n10', 'agent', '', 'n10-agent'],
    ['/x/r', 'worktree', 'a'.repeat(250), `r-${'a'.repeat(193)}-0a22`],
    // Same first 195 characters, different tails: only a hash over the
    // raw `<basename>-<branch>` tells `a/` from `a.` past the cut.
    ['/x/r', 'worktree', 'a/'.repeat(125), `r-${'a-'.repeat(96)}a-6e0f`],
    ['/x/r', 'worktree', 'a.'.repeat(125), `r-${'a-'.repeat(96)}a-b373`],
    // Terminal labels hash `<basename>-shell` / `<basename>-agent`.
    [`/x/${'b'.repeat(220)}`, 'shell', '', `${'b'.repeat(195)}-930d`],
    [`/x/${'b'.repeat(220)}`, 'agent', '', `${'b'.repeat(195)}-9fb6`],
    [
      '/x/agent-plugins',
      'worktree',
      'a'.repeat(250),
      `agent-plugins-${'a'.repeat(181)}-1fad`,
    ],
  ] as const)('%s %s %s → %s', (repo, type, branch, label) => {
    const built =
      type === 'worktree'
        ? worktreeSessionLabel(repo, branch)
        : terminalSessionLabel(repo, type);
    expect(built).toBe(label);
    expect(built.length).toBeLessThanOrEqual(200);
  });

  // The hash is over the raw string, before replacement: a branch that
  // differs only in a `/` versus a `-` past the cut must still get a
  // different tail, and a rule that hashed the replaced string would
  // give both the same one.
  it('hashes the unsanitized name on overflow', () => {
    const slashed = worktreeSessionLabel('/x/r', `${'a'.repeat(250)}/b`);
    const dashed = worktreeSessionLabel('/x/r', `${'a'.repeat(250)}-b`);
    expect(slashed.slice(0, 195)).toBe(dashed.slice(0, 195));
    expect(slashed).not.toBe(dashed);
  });

  it('sanitizes one part without capping it', () => {
    expect(sanitizeLabelPart('a/b.c:d')).toBe('a-b-c-d');
    expect(sanitizeLabelPart('x'.repeat(300))).toHaveLength(300);
  });
});
