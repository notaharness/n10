import { dialog } from 'electron';

export function showAbout(appVersion: string): Promise<void> {
  return dialog
    .showMessageBox({
      type: 'info',
      title: 'About n10 Desktop',
      message: 'n10 Desktop',
      detail: [
        `Version ${appVersion}`,
        `Electron ${process.versions.electron} · Chromium ${process.versions.chrome} · Node ${process.versions.node}`,
        '',
        'Worktrees, agents and reviews for one repository.',
      ].join('\n'),
      buttons: ['OK'],
    })
    .then(() => undefined);
}
