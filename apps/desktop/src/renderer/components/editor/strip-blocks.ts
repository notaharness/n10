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
