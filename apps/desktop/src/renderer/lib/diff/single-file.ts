/**
 * Single-file mode: the same diff, one section at a time — the pull
 * request's conversation, then each file in order.
 *
 * It is a view of the continuous list's model, not a second one: the
 * list is handed the one section's files, so a file's fold, Viewed and
 * comment state are the same in both modes. Which section is on screen
 * follows where the reader last went — a file picked in the tree, a
 * comment jumped to — so switching modes keeps their place.
 */

export type DiffSection =
  | { kind: 'conversation' }
  | { kind: 'file'; path: string };

/** Where the reader last went. */
export interface DiffPlace {
  file: string | null;
  /** They went to a comment on the pull request as a whole. */
  conversation: boolean;
}

export function diffSections(
  files: readonly (readonly [string, unknown])[],
  hasConversation: boolean
): DiffSection[] {
  const sections: DiffSection[] = hasConversation
    ? [{ kind: 'conversation' }]
    : [];
  for (const [path] of files) sections.push({ kind: 'file', path });
  return sections;
}

function indexOf(
  sections: readonly DiffSection[],
  match: (s: DiffSection) => boolean
): number | null {
  const i = sections.findIndex(match);
  return i >= 0 ? i : null;
}

/**
 * The section to show: the conversation if that is where the reader
 * went, else their file, else the first file — the conversation only
 * when there are no files. -1 when there is nothing at all.
 */
export function sectionIndex(
  sections: readonly DiffSection[],
  place: DiffPlace
): number {
  const conversation = place.conversation
    ? indexOf(sections, (s) => s.kind === 'conversation')
    : null;
  const file = place.file
    ? indexOf(sections, (s) => s.kind === 'file' && s.path === place.file)
    : null;
  const firstFile = indexOf(sections, (s) => s.kind === 'file');
  return conversation ?? file ?? firstFile ?? (sections.length > 0 ? 0 : -1);
}
