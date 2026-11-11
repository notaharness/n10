/** The strip supplies commands while mounted; shortcuts and the palette
 * call the same actions from outside its repository-scoped component. */
export interface StripCommands {
  attention(): void;
  collapseOthers(): void;
}

let commands: StripCommands | null = null;

export function hasStripCommands(): boolean {
  return commands !== null;
}

export function setStripCommands(next: StripCommands | null): void {
  commands = next;
}

export function runStripCommand(
  action: 'desktop.tabs.attention' | 'desktop.groups.collapse-others'
): boolean {
  if (!commands) return false;
  if (action === 'desktop.tabs.attention') commands.attention();
  else commands.collapseOthers();
  return true;
}
