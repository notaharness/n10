/** The sortable id of a block: a group dragged by its chip, or a tab
 *  standing alone. Distinct from every tab id, which a member keeps. */
export function blockId(key: string): string {
  return `block:${key}`;
}

/** A group's block id: its key's when it shows a chip, else its one
 *  tab's, which `TabButton` answers to as a block. */
export function groupBlockId(group: {
  key: string;
  chipped: boolean;
  tabs: readonly { id: string }[];
}): string {
  return blockId(group.chipped ? group.key : group.tabs[0]?.id ?? group.key);
}

/** A block on the strip: a group (or a lone tab), with the groups shown
 *  behind it (`TabGroup.behind`), which move with it. */
export interface StripRun<G> {
  lead: G;
  followers: G[];
  /** Every tab it carries, in strip order. */
  ids: string[];
}

/** The strip's blocks, in order: each group, its followers folded into
 *  the block of the group they follow. */
export function stripRuns<
  G extends { behind?: string; tabs: readonly { id: string }[] }
>(groups: readonly G[]): StripRun<G>[] {
  const runs: StripRun<G>[] = [];
  for (const group of groups) {
    const ids = group.tabs.map((t) => t.id);
    const last = runs.at(-1);
    if (group.behind !== undefined && last) {
      last.followers.push(group);
      last.ids.push(...ids);
    } else runs.push({ lead: group, followers: [], ids });
  }
  return runs;
}
