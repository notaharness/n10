import { createContext } from 'react';
import type { StripBlocks } from './strip-drag.js';

/** The sortable id of a block: a group dragged by its chip, or a tab
 *  standing alone. Distinct from every tab id, which a member keeps. */
export function blockId(key: string): string {
  return `block:${key}`;
}

/** A chipped group's block id in `pane`: one group can show in two
 *  panes, and every sortable id in the drag context must differ. */
export function chipBlockId(pane: string, key: string): string {
  return blockId(`${pane}:${key}`);
}

/** A group's block id: its chip's when it shows one, else its one
 *  tab's, which `TabButton` answers to as a block. */
export function groupBlockId(
  group: {
    key: string;
    chipped: boolean;
    tabs: readonly { id: string }[];
  },
  pane: string
): string {
  return group.chipped
    ? chipBlockId(pane, group.key)
    : blockId(group.tabs[0]?.id ?? group.key);
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

/** Where each pane's strip tells the drag what its blocks are, as
 *  presented: a block's drop arranges them. */
export const StripBlocksReport = createContext<
  (pane: string, blocks: StripBlocks) => void
>(() => undefined);
