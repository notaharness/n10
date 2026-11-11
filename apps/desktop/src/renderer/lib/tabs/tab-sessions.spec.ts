import type { Affiliation } from '@n10/core/ui';
import type { PullRequestInfo } from '@n10/vcs-core';
import { describe, expect, it } from 'vitest';
import type { SidebarItem } from '../../../host/contract.js';
import { itemKey } from '../sidebar/sidebar-model.js';
import { affiliationIndex, tabFacts } from './tab-affiliation.js';
import { itemTabId, type Tab } from './tab-identity.js';
import { indexItems } from './tab-item.js';
import { listedSessions, tabSessions } from './tab-sessions.js';

const PARENT: Affiliation = { kind: 'parent', key: 'codex:x', label: 'Codex' };
const pr = {
  id: 7,
  title: 'Review me',
  sourceBranch: 'feature/x',
  targetBranch: 'main',
} as PullRequestInfo;

describe('a review’s tab', () => {
  // The sidebar folds the review checkout's worktree row into the pull
  // request's: only the engine's listing says what its agent is.
  const review: SidebarItem = {
    kind: 'review-pr',
    pr,
    category: 'needs-review',
    sessionName: 'reviewer',
  };
  const items = [review];
  const tab: Tab = {
    id: itemTabId('/repo', itemKey(review)),
    kind: 'item',
    repo: '/repo',
    itemKey: itemKey(review),
    preview: false,
  };
  const { sessionOf, ownSession } = tabSessions(
    items,
    indexItems('/repo', items)
  );

  it('counts its checkout’s agent as its own', () => {
    expect(ownSession(tab)).toBe('reviewer');
    expect(sessionOf(tab)).toBe('reviewer');
  });

  it('joins the group the agent reports to', () => {
    const index = affiliationIndex({
      repo: '/repo',
      sessions: listedSessions(items, [
        { name: 'reviewer', path: '/repo/wt/x', affiliation: PARENT },
      ]),
      terminals: [],
      foreign: [],
    });
    expect(tabFacts(tab, sessionOf(tab), index).affiliation).toEqual(PARENT);
  });
});
