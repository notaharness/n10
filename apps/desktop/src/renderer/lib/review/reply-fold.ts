/**
 * Which replies of a long thread show, and which fold into "Show N
 * more". The first and the last few always show; so does every reply
 * the reader is searching for, however deep, so a match in a thread of
 * a hundred replies is on screen without unfolding the other ninety.
 */

export type ReplySlot =
  | { kind: 'reply'; index: number }
  | { kind: 'gap'; from: number; count: number };

export const FOLD_AFTER = 4;
const KEEP_FIRST = 1;
const KEEP_LAST = 2;

export function foldReplies(
  count: number,
  keep: ReadonlySet<number>
): ReplySlot[] {
  const shown = (i: number) =>
    count <= FOLD_AFTER ||
    i < KEEP_FIRST ||
    i >= count - KEEP_LAST ||
    keep.has(i);
  const slots: ReplySlot[] = [];
  for (let i = 0; i < count; i++) {
    if (shown(i)) {
      slots.push({ kind: 'reply', index: i });
      continue;
    }
    const last = slots.at(-1);
    if (last?.kind === 'gap') last.count += 1;
    else slots.push({ kind: 'gap', from: i, count: 1 });
  }
  return slots;
}
