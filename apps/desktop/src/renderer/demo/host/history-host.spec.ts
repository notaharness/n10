import { describe, expect, it } from 'vitest';
import { N10 } from '../data/n10.js';
import { createHistoryHost } from './history-host.js';
import { DemoState } from './state.js';

/** The demo keeps visits as the app does: a visit's "last visit" holds
 *  for as long as it lasts, and recording one needs its history read. */
describe('the demo history host', () => {
  const ref = {
    provider: 'github',
    host: 'github.com',
    repository: 'notaharness/n10',
    number: 175,
  };
  const setup = () => {
    const state = new DemoState();
    state.open(N10);
    return createHistoryHost(state);
  };
  const visit = {
    head: 'a'.repeat(40),
    target: 'b'.repeat(40),
    mergeBase: 'c'.repeat(40),
  };

  it('gives someone else’s pull request a last review and an older last visit', async () => {
    const history = await setup().getPullRequestHistory(N10, {
      ref,
      viewer: null,
      visitId: 'v1',
    });
    const review =
      history.lastReview.state === 'read' ? history.lastReview.value : null;
    const last =
      history.lastVisit.state === 'read' ? history.lastVisit.value : null;
    expect(review?.head).toBeTruthy();
    expect(last?.head).toBeTruthy();
    expect(last?.head).not.toBe(review?.head);
  });

  it('keeps a visit’s baseline while it records, and moves it for the next visit', async () => {
    const host = setup();
    const first = await host.getPullRequestHistory(N10, {
      ref,
      viewer: null,
      visitId: 'v1',
    });
    await host.recordPullRequestVisit(N10, {
      ref,
      viewer: null,
      visitId: 'v1',
      visit,
    });
    const again = await host.getPullRequestHistory(N10, {
      ref,
      viewer: null,
      visitId: 'v1',
    });
    expect(again.lastVisit).toEqual(first.lastVisit);
    const next = await host.getPullRequestHistory(N10, {
      ref,
      viewer: null,
      visitId: 'v2',
    });
    expect(next.lastVisit).toMatchObject({
      state: 'read',
      value: { head: visit.head },
    });
  });

  it('refuses to record a visit whose history was never read', async () => {
    await expect(
      setup().recordPullRequestVisit(N10, {
        ref,
        viewer: null,
        visitId: 'v9',
        visit,
      })
    ).rejects.toThrow();
  });
});
