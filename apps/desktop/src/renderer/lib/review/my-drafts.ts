import type { DraftTarget, ReviewDraft } from '../../../host/contract.js';

/**
 * The reviewer's own comments on code: stored drafts, and composers
 * opened on a selection that have nothing stored yet. Both hang in the
 * diff at their anchor; what is stored wins for a key both name.
 */

export type InlineTarget = Extract<DraftTarget, { kind: 'inline' }>;

export function inlineTargets(
  stored: readonly ReviewDraft[],
  fresh: readonly InlineTarget[]
): InlineTarget[] {
  const out = new Map<string, InlineTarget>();
  for (const f of fresh) out.set(f.key, f);
  for (const d of stored) {
    if (d.target.kind === 'inline') out.set(d.target.key, d.target);
  }
  return [...out.values()];
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
