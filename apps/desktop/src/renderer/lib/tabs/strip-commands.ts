import type { DesktopActionId } from '@n10/core/ui';

/** The strip supplies commands while mounted; shortcuts and the palette
 * call the same actions from outside its repository-scoped component. */
export interface StripCommands {
  attention(): void;
  collapseOthers(): void;
  /** Pin the active tab, or unpin it. */
  togglePin(): void;
  /** Rename the active tab's group (the dialog). */
  renameGroup(): void;
  /** Tile or follow the active tab's group (`use-supervise.ts`). */
  tileGroup(): void;
  followGroup(): void;
}

/** The strip's commands with a shortcut, and the palette's own: rename,
 *  tile and follow. */
export type StripCommand =
  | 'desktop.tabs.attention'
  | 'desktop.groups.collapse-others'
  | 'desktop.tabs.toggle-pin'
  | 'rename-group'
  | 'tile-group'
  | 'follow-group';

const RUN: Record<StripCommand, (c: StripCommands) => void> = {
  'desktop.tabs.attention': (c) => c.attention(),
  'desktop.groups.collapse-others': (c) => c.collapseOthers(),
  'desktop.tabs.toggle-pin': (c) => c.togglePin(),
  'rename-group': (c) => c.renameGroup(),
  'tile-group': (c) => c.tileGroup(),
  'follow-group': (c) => c.followGroup(),
};

let commands: StripCommands | null = null;

export function hasStripCommands(): boolean {
  return commands !== null;
}

export function setStripCommands(next: StripCommands | null): void {
  commands = next;
}

/** Whether a shortcut is one of the strip's commands. */
export function isStripCommand(
  action: DesktopActionId
): action is DesktopActionId & StripCommand {
  return action in RUN;
}

export function runStripCommand(action: StripCommand): boolean {
  if (!commands) return false;
  RUN[action](commands);
  return true;
}
