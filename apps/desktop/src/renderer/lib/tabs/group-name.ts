/**
 * What a group may be renamed to (ux-workspace.md §2): plain text,
 * control characters stripped, outer whitespace trimmed and inner runs
 * collapsed, at most 64 grapheme clusters, never blank.
 */

export const GROUP_NAME_MAX = 64;

/** `raw` as it would be saved. */
export function normalizeGroupName(raw: string): string {
  return (
    raw
      // eslint-disable-next-line no-control-regex -- stripping control characters is the point
      .replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  );
}

function graphemes(text: string): number {
  const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
  return [...segmenter.segment(text)].length;
}

/** Why `raw` cannot be saved, or `null` when it can. */
export function groupNameError(raw: string): string | null {
  const name = normalizeGroupName(raw);
  if (!name) return 'Enter a name';
  if (graphemes(name) > GROUP_NAME_MAX) return 'Use 64 characters or fewer';
  return null;
}

/**
 * What saving `raw` writes over a group named `current` whose own name
 * is `derived`: `undefined` for nothing to write, `null` to drop the
 * override — the derived name typed back in — else the name.
 */
export function groupNameChange(
  raw: string,
  current: string,
  derived: string
): string | null | undefined {
  const name = normalizeGroupName(raw);
  if (name === current) return undefined;
  return name === derived ? null : name;
}
