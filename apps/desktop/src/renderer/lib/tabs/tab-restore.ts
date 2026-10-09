/** Identity tags that must agree before a saved tab can adopt a session target. */

import { sameSessionTarget } from '@n10/core/ui';
import type { SessionTarget } from '../../../host/contract.js';

const IDENTITY_TAGS = [
  '@orchestra-spawner',
  '@orchestra-repo',
  '@orchestra-session-type',
  '@orchestra-branch',
  '@orchestra-worktree-path',
  '@orchestra-agent',
];

export interface SavedTarget {
  target: SessionTarget;
  tags: Record<string, string>;
  env?: Record<string, string>;
  conversationId?: string;
}

export function sameSavedTarget(a: SavedTarget, b: SavedTarget): boolean {
  return (
    sameSessionTarget(a.target, b.target) &&
    IDENTITY_TAGS.every((tag) => a.tags[tag] === b.tags[tag])
  );
}

function sameValues(a: object, b: object): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].every((key) => {
    const left = (a as Record<string, unknown>)[key];
    const right = (b as Record<string, unknown>)[key];
    if (left === right) return true;
    if (
      !left ||
      !right ||
      typeof left !== 'object' ||
      typeof right !== 'object'
    ) {
      return false;
    }
    return sameValues(left, right);
  });
}

/** A dead pane cannot be sampled; keep the last verified runtime facts. */
export function retainRuntime<T extends SavedTarget>(
  observed: T,
  previous: SavedTarget | undefined
): T & SavedTarget {
  if (!previous || !sameSavedTarget(previous, observed)) return observed;
  const next = {
    ...observed,
    env: observed.env ?? previous.env,
    conversationId: observed.conversationId ?? previous.conversationId,
  };
  return sameValues(next, previous) ? (previous as T & SavedTarget) : next;
}
