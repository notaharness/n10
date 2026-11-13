import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import type { HostTargetView } from '../../../host/contract.js';
import { FolderBrowserDialog } from '../../components/FolderBrowserDialog.js';

let target: Promise<HostTargetView> | null = null;

/** Where the host runs, asked once per page: it is fixed at launch. */
function hostTarget(): Promise<HostTargetView> {
  target ??= window.n10.getHostTarget().catch((err: unknown) => {
    target = null;
    throw err;
  });
  return target;
}

/** The app's folder browser over the host's `listDirectory`, mounted
 *  for as long as it is open. */
function browse(title: string, where: string): Promise<string | null> {
  return new Promise((resolve) => {
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    const onDone = (path: string | null) => {
      root.unmount();
      container.remove();
      resolve(path);
    };
    root.render(
      createElement(FolderBrowserDialog, {
        title,
        where,
        list: (path) => window.n10.listDirectory(path),
        onDone,
      })
    );
  });
}

/**
 * A folder on the host: the OS dialog where it can see the host's files
 * (the host's `selectRepoDirectory`/`selectFolder`), else the app's own
 * browser. Resolves to the path, or null when cancelled.
 */
export async function pickHostFolder(
  kind: 'repository' | 'folder'
): Promise<string | null> {
  const where = await hostTarget();
  if (where.folders === 'native') {
    return kind === 'repository'
      ? window.n10.selectRepoDirectory()
      : window.n10.selectFolder();
  }
  return browse(
    kind === 'repository' ? 'Open repository' : 'Open folder',
    where.label
  );
}
