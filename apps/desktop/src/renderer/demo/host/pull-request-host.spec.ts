import { describe, expect, it } from 'vitest';
import { N10 } from '../data/n10.js';
import { createPullRequestHost } from './pull-request-host.js';
import { DemoState } from './state.js';

/** The demo answers the reads by identity from its own rows, the way a
 *  provider would, so the Overview has something real to show. */
describe('the demo pull request host', () => {
  const state = new DemoState();
  state.open(N10);
  const host = createPullRequestHost(state);
  const ref = (number: number) => ({
    provider: 'github',
    host: 'github.com',
    repository: 'notaharness/n10',
    number,
  });

  it('reads a demo pull request’s detail, with its head', async () => {
    const snapshot = await host.getPullRequestSnapshot({ ref: ref(177) });
    expect(snapshot.detail).toMatchObject({
      state: 'read',
      value: {
        title: "fix(desktop): keep a worktree's tab when its branch switches",
        source: { branch: 'fix/tab-branch-switch' },
      },
    });
    expect(snapshot.head).toEqual({
      oid: '905bbcb2036a4f1e8c2d7b9a5e3f6c1d8b4a2e7f',
      from: 'detail',
    });
  });

  it('says a number the demo does not have is not found', async () => {
    const snapshot = await host.getPullRequestSnapshot({ ref: ref(1) });
    expect(snapshot.summary).toEqual({ kind: 'gone' });
    expect(snapshot.detail).toMatchObject({
      state: 'failed',
      kind: 'not-found',
    });
  });
});
