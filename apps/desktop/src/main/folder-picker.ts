import { dirname } from 'node:path';
import { app, dialog } from 'electron';
import type { HostTargetView } from '../host/contract.js';
import {
  hostLabel,
  windowsPathInWsl,
  wslPath,
  type HostTarget,
} from './host-target.js';

let lastPickedParent: string | undefined;

/**
 * Native folder picker. Without a defaultPath Electron opens dialogs in
 * Downloads, so it starts beside the last pick, or at `home`.
 */
export async function pickFolderWithDialog(
  title: string,
  home: string = app.getPath('home')
): Promise<string | null> {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory'],
    title,
    defaultPath: lastPickedParent ?? home,
  });
  const [picked] = result.filePaths;
  if (result.canceled || !picked) return null;
  lastPickedParent = dirname(picked);
  return picked;
}

/** What the host said of itself, once it has. */
export interface HostIdentity {
  distro?: string;
  home: string;
}

/**
 * How folders on `target` are chosen. Locally and in WSL it is the OS
 * dialog: Windows sees a distro's files under `\\wsl.localhost\<distro>`,
 * and the path it returns is translated to the distro's own. A host over
 * SSH has no files Windows can see: the renderer browses them in the
 * app (`HostTargetView.folders`), never through here.
 */
export function folderPickerFor(
  target: HostTarget,
  identity: () => HostIdentity | null
): (title: string) => Promise<string | null> {
  if (target.kind === 'local') return (title) => pickFolderWithDialog(title);
  if (target.kind === 'ssh') {
    return () =>
      Promise.reject(
        new Error(`Folders on ${target.destination} are chosen in the app.`)
      );
  }
  return async (title) => {
    const known = identity();
    const distro = target.distro ?? known?.distro;
    if (!distro) throw new Error('n10 has not reached WSL yet. Try again.');
    const picked = await pickFolderWithDialog(
      title,
      windowsPathInWsl(distro, known?.home ?? '/')
    );
    if (picked === null) return null;
    const path = wslPath(picked, distro);
    if (path === null) throw new Error(`Choose a folder in ${distro}.`);
    return path;
  };
}

export function hostTargetView(
  target: HostTarget,
  identity: HostIdentity | null
): HostTargetView {
  return {
    kind: target.kind,
    label: hostLabel(target, identity?.distro),
    folders: target.kind === 'ssh' ? 'in-app' : 'native',
  };
}
