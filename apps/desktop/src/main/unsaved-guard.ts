/**
 * Asked before the window unloads with text that could not be saved.
 *
 * The renderer refuses its `beforeunload` while any draft's save has
 * failed — that text lives only in the page. Electron then emits
 * `will-prevent-unload` here instead of unloading silently, and the
 * reader chooses: stay and copy or retry it, or leave without it.
 * Reload, window close and quit all pass through this.
 */
import { dialog, type BrowserWindow } from 'electron';

export function installUnsavedGuard(win: BrowserWindow): void {
  win.webContents.on('will-prevent-unload', (event) => {
    const choice = dialog.showMessageBoxSync(win, {
      type: 'warning',
      message: "A draft couldn't be saved",
      detail:
        'Its text exists only in this window. Stay to copy it or retry the save, or leave without it.',
      buttons: ['Stay', 'Leave without it'],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    });
    // Preventing the event lets the unload go ahead.
    if (choice === 1) event.preventDefault();
  });
}
