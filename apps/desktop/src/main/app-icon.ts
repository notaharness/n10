import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { app } from 'electron';

function iconDirectory(dist: string): string {
  const packaged = join(dist, 'build');
  return existsSync(join(packaged, 'icon.png'))
    ? packaged
    : join(dist, '..', 'build');
}

/** Electron's native window icon; Windows benefits from the multi-size ICO. */
export function windowIcon(dist: string): string | undefined {
  if (process.platform === 'linux')
    return join(iconDirectory(dist), 'icon.png');
  if (process.platform === 'win32')
    return join(iconDirectory(dist), 'icon.ico');
  return undefined;
}

/** npm installs have no app bundle resource to supply a macOS Dock icon. */
export function installDockIcon(dist: string): void {
  if (process.platform === 'darwin' && !app.isPackaged) {
    app.dock?.setIcon(join(iconDirectory(dist), 'icon.png'));
  }
}
