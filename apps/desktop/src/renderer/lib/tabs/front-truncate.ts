/**
 * Cutting a label from the front to fit a width, so its end stays in
 * view: a branch name's last word is what tells it from its
 * neighbours. CSS cuts only from the end in Chromium (`text-overflow`
 * on the start side is Firefox's alone), so the cut is measured here.
 */

export const ELLIPSIS = '…';

/**
 * How many leading characters of `text` to drop so that `…` and what
 * is left fit in `width`, given a `measure` of a string's width: 0 when
 * the whole of it fits, all of it when not even one character does.
 * Counts code points, so a character is never split in two.
 */
export function frontCut(
  text: string,
  width: number,
  measure: (s: string) => number
): number {
  const chars = [...text];
  if (measure(text) <= width) return 0;
  const fits = (kept: number) =>
    measure(ELLIPSIS + chars.slice(chars.length - kept).join('')) <= width;
  // The most trailing characters that fit after the ellipsis.
  let lo = 0;
  let hi = chars.length - 1;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (fits(mid)) lo = mid;
    else hi = mid - 1;
  }
  return chars.length - lo;
}

/** A run of label text in one style, keyed by what it is. */
export interface LabelPart {
  key: string;
  text: string;
  className?: string;
}

/** `parts` without their first `cut` characters, the ellipsis leading
 *  whatever remains. */
export function dropLeading(parts: LabelPart[], cut: number): LabelPart[] {
  if (cut <= 0) return parts;
  let left = cut;
  const out: LabelPart[] = [];
  for (const part of parts) {
    const chars = [...part.text];
    if (left >= chars.length) {
      left -= chars.length;
      continue;
    }
    out.push({ ...part, text: chars.slice(left).join('') });
    left = 0;
  }
  return [{ key: 'ellipsis', text: ELLIPSIS }, ...out];
}
