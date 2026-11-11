import type { TabStatus } from './tab-groups.js';

type Pending = 'blocked' | 'error' | 'done-unseen' | 'new-output';
const TIERS: readonly Pending[] = [
  'blocked',
  'error',
  'done-unseen',
  'new-output',
];
export interface AttentionTab {
  id: string;
  status: TabStatus;
}
export interface AttentionRound {
  ids: string[];
  visited: string[];
}
export interface AttentionStep {
  round: AttentionRound | null;
  target: string | null;
  index: number;
  total: number;
  feedback: 'empty' | 'current' | null;
}

/** One stable traversal. New activity waits until the next round. */
export function nextAttention(
  current: AttentionRound | null,
  tabs: readonly AttentionTab[],
  activeId: string | null
): AttentionStep {
  const byId = new Map(tabs.map((tab) => [tab.id, tab.status]));
  const pending = (status: TabStatus | undefined): status is Pending =>
    status !== undefined && TIERS.includes(status as Pending);
  const build = (): AttentionRound => ({
    ids: TIERS.flatMap((tier) =>
      tabs
        .filter((tab) => tab.status === tier && tab.id !== activeId)
        .map((tab) => tab.id)
    ),
    visited: [],
  });
  let round = current ?? build();
  let target = round.ids.find(
    (id) => !round.visited.includes(id) && pending(byId.get(id))
  );
  if (!target && current) {
    round = build();
    target = round.ids.find((id) => pending(byId.get(id)));
  }
  if (!target) {
    return {
      round: null,
      target: null,
      index: 0,
      total: 0,
      feedback: tabs.some((tab) => tab.id === activeId && pending(tab.status))
        ? 'current'
        : 'empty',
    };
  }
  round = { ...round, visited: [...round.visited, target] };
  return {
    round,
    target,
    index: round.visited.length,
    total: round.ids.length,
    feedback: null,
  };
}
