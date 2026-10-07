import { webContents } from 'electron';

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
