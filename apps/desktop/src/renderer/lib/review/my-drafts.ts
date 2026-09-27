import type { DraftTarget } from '../../../host/contract.js';

/**
 * The reviewer's own comments on code: stored drafts a card can show,
 * and composers opened on a selection that have nothing stored yet.
 * Both hang in the diff at their anchor; what is stored wins for a key
 * both name.
 */

export type InlineTarget = Extract<DraftTarget, { kind: 'inline' }>;

export function inlineTargets(
  stored: readonly InlineTarget[],
  fresh: readonly InlineTarget[]
): InlineTarget[] {
  const out = new Map<string, InlineTarget>();
  for (const f of fresh) out.set(f.key, f);
  for (const t of stored) out.set(t.key, t);
  return [...out.values()];
}

/** `fresh` without what is now stored, the same array when nothing is. */
export function unstored(
  fresh: readonly InlineTarget[],
  stored: readonly InlineTarget[]
): readonly InlineTarget[] {
  const keys = new Set(stored.map((t) => t.key));
  return fresh.some((f) => keys.has(f.key))
    ? fresh.filter((f) => !keys.has(f.key))
    : fresh;
}

export function byFile(
  targets: readonly InlineTarget[]
): Map<string, InlineTarget[]> {
  const out = new Map<string, InlineTarget[]>();
  for (const t of targets) {
    const list = out.get(t.anchor.path) ?? [];
    list.push(t);
    out.set(t.anchor.path, list);
  }
  return out;
}
