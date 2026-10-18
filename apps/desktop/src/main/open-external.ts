import { shell } from 'electron';
import {
  isWebUrl,
  nodeOpenerContext,
  openUrl,
  windowsOpener,
} from '@n10/core/open-url';

/**
 * Opens a web link in the user's browser through Electron, except inside
 * WSL: there Electron's Linux opener looks for a browser in the distro,
 * and links go to the Windows browser instead (`@n10/core/open-url`).
 */
export function openExternal(url: string): Promise<void> {
  if (!isWebUrl(url)) {
    return Promise.reject(new Error(`Refusing to open ${url}`));
  }
  const context = nodeOpenerContext();
  return windowsOpener(context)
    ? openUrl(url, context)
    : shell.openExternal(url);
}

/** {@link openExternal} for a link the page asked for, which nothing
 *  awaits: a failure is logged. */
export function openLinkFromPage(url: string): void {
  if (!isWebUrl(url)) return;
  openExternal(url).catch((error: unknown) => {
    console.warn(`[desktop] could not open ${url}:`, error);
  });
}
