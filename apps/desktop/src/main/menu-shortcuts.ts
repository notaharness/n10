import { webContents, type WebContents } from 'electron';

/**
 * While held, the window `viewer` ignores the application menu's
 * accelerators, so a shortcut being recorded reaches the page (to be
 * refused there) instead of closing a tab or opening a dialog.
 */
export async function holdMenuShortcuts(
  viewer: number,
  held: boolean
): Promise<void> {
  webContents.fromId(viewer)?.setIgnoreMenuShortcuts(held);
}

/**
 * The hold belongs to the page that asked for it, but Electron keeps it
 * on the webContents, which a reload keeps too. A page that starts
 * loading has recorded nothing, so the menu gets its accelerators back
 * — or a host restart or crash mid-recording would leave them dead.
 */
export function releaseMenuShortcutsOnLoad(
  contents: Pick<WebContents, 'on' | 'setIgnoreMenuShortcuts'>
): void {
  contents.on('did-start-loading', () =>
    contents.setIgnoreMenuShortcuts(false)
  );
}
