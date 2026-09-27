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

/**
 * `fresh` without what is now stored and not open, the same array when
 * nothing is. An open composer keeps its own entry, so emptying its text
 * (which removes the stored draft) never takes the composer away.
 */
export function unstored(
  fresh: readonly InlineTarget[],
  stored: readonly InlineTarget[],
  open: ReadonlySet<string>
): readonly InlineTarget[] {
  const keys = new Set(stored.map((t) => t.key));
  const spent = (f: InlineTarget) => keys.has(f.key) && !open.has(f.key);
  return fresh.some(spent) ? fresh.filter((f) => !spent(f)) : fresh;
}

/** How many of the reviewer's drafts each file holds. */
export function countByFile(
  targets: readonly InlineTarget[]
): Map<string, number> {
  const out = new Map<string, number>();
  for (const t of targets) {
    out.set(t.anchor.path, (out.get(t.anchor.path) ?? 0) + 1);
  }
  return out;
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
