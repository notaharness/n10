import type { KeyDescriptor } from '@n10/core';

/**
 * The app's fixed shortcuts, each on the platform modifier (Cmd on
 * macOS, Ctrl elsewhere): the one list the native menu takes its
 * accelerators from, the shortcuts dialog shows, and recording a tab
 * shortcut refuses to take over.
 *
 * Browser-safe and Electron-free, like `menu-template.ts`.
 */
export type AppShortcutId =
  | 'search'
  | 'command-palette'
  | 'toggle-sidebar'
  | 'new-worktree'
  | 'new-terminal'
  | 'open-repo'
  | 'switch-repo'
  | 'settings'
  | 'close-tab'
  | 'refresh-remote'
  | 'send-reply';

export interface AppShortcut {
  id: AppShortcutId;
  label: string;
  /** The key as an Electron accelerator names it. */
  key: string;
  shift?: true;
  /** Heard by the page itself, on Ctrl as well as Cmd, rather than
   *  being a menu accelerator on the platform modifier alone. */
  page?: true;
}

export const APP_SHORTCUTS: readonly AppShortcut[] = [
  { id: 'search', label: 'Search & commands', key: 'K', page: true },
  { id: 'command-palette', label: 'Command palette', key: 'P', shift: true },
  { id: 'toggle-sidebar', label: 'Toggle sidebar', key: 'B' },
  { id: 'new-worktree', label: 'New worktree', key: 'N' },
  { id: 'new-terminal', label: 'New terminal', key: 'T', shift: true },
  { id: 'open-repo', label: 'Open repository', key: 'O' },
  { id: 'switch-repo', label: 'Switch repository', key: 'O', shift: true },
  { id: 'settings', label: 'Settings', key: ',' },
  { id: 'close-tab', label: 'Close tab', key: 'W' },
  { id: 'refresh-remote', label: 'Refresh pull requests', key: 'R' },
  {
    id: 'send-reply',
    label: 'Send reply (in a comment box)',
    key: 'Enter',
    page: true,
  },
];

function shortcut(id: AppShortcutId): AppShortcut {
  const found = APP_SHORTCUTS.find((s) => s.id === id);
  if (!found) throw new Error(`Unknown app shortcut ${id}`);
  return found;
}

/** The platform modifier the menu's accelerators hold. */
export function menuModifier(isMac: boolean): 'Cmd' | 'Ctrl' {
  return isMac ? 'Cmd' : 'Ctrl';
}

/** The menu accelerator for `id` on `mod` ('Cmd' or 'Ctrl'). */
export function appAccelerator(id: AppShortcutId, mod: 'Cmd' | 'Ctrl'): string {
  const { key, shift } = shortcut(id);
  return [mod, ...(shift ? ['Shift'] : []), key].join('+');
}

/**
 * The Ctrl chord a tab shortcut bound to it would take from `s`, on a
 * platform whose menu modifier is `mod`; null when there is none. Tab
 * shortcuts never hold Cmd, so on macOS only the page's own shortcuts,
 * which answer to Ctrl too, can be taken.
 */
export function appShortcutDescriptor(
  s: AppShortcut,
  mod: 'Cmd' | 'Ctrl'
): KeyDescriptor | null {
  if (mod === 'Cmd' && !s.page) return null;
  const desc: KeyDescriptor =
    s.key === 'Enter'
      ? { flags: { return: true } }
      : { input: s.key.toLowerCase() };
  desc.ctrl = true;
  if (s.shift) desc.shift = true;
  return desc;
}
