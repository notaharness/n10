import type { ConversationThread, LineRange } from '../../../host/contract.js';

/**
 * How a thread's place is said in words. Sides are named for the file
 * they belong to — `old` is the removed side, `new` the added — rather
 * than LEFT/RIGHT, which only mean something in a split view.
 */

const SIDE: Record<LineRange['side'], string> = { LEFT: 'old', RIGHT: 'new' };

/** "new 41", "old 18–20", or "old 40 → new 42" for a range that
 *  starts on a removed line and ends on an added one. */
export function rangeLabel(r: LineRange): string {
  if (r.startSide !== r.side) {
    return `${SIDE[r.startSide]} ${r.start} → ${SIDE[r.side]} ${r.end}`;
  }
  const lines = r.start === r.end ? `${r.end}` : `${r.start}–${r.end}`;
  return `${SIDE[r.side]} ${lines}`;
}

/** "src/request.ts · new 41", "logo.png · file", or null for a thread
 *  about the pull request as a whole. The current place when the
 *  provider still maps one, else where it was written. */
export function threadPlace(t: ConversationThread): string | null {
  const a = t.anchor;
  if (!a) return null;
  if (t.scope === 'file') return `${a.path} · file`;
  const r = a.current ?? a.original;
  return r ? `${a.path} · ${rangeLabel(r)}` : a.path;
}

/** Lines of the hunk excerpt shown with a thread. GitHub ends the
 *  excerpt on the commented line; the last four lines are what its own
 *  page shows, and enough to recognise the code. */
export function hunkTail(
  hunk: string,
  count = 4
): { key: string; text: string }[] {
  const lines = hunk.split('\n').filter((l) => !l.startsWith('@@'));
  const from = Math.max(0, lines.length - count);
  // The key is the line's place in the excerpt: lines repeat, places don't.
  return lines.slice(from).map((text, i) => ({ key: String(from + i), text }));
}

/** Azure's thread statuses, in its own words; GitHub's two need none
 *  beyond the resolved badge. */
const NATIVE_STATUS: Record<string, string> = {
  active: 'Active',
  pending: 'Pending',
  fixed: 'Fixed',
  wontFix: "Won't fix",
  byDesign: 'By design',
  closed: 'Closed',
};

/** The status word to show beside the resolved/open reading, when the
 *  provider's word says more than that. */
export function nativeStatus(t: ConversationThread): string | null {
  return NATIVE_STATUS[t.status.native] ?? null;
}
