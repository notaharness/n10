import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

/** The Electron binary, found the way Playwright's `electron.launch` finds it. */
const ELECTRON = createRequire(import.meta.url)('electron') as string;

/**
 * Start the app a second time and wait for that process to exit.
 *
 * With the first instance's userData (the fixture's HOME), the new
 * process loses the single-instance lock, hands the running app its
 * start directory and quits. Resolves on `exit` rather than `close`:
 * a Chromium helper may keep inherited pipes open past the browser
 * process (see app-close.ts), so stdio is not inherited at all.
 */
export function launchAgain(opts: {
  args: string[];
  cwd: string;
  env: Record<string, string>;
}): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(ELECTRON, opts.args, {
      cwd: opts.cwd,
      env: opts.env,
      stdio: 'ignore',
    });
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('The second launch did not quit within 30s'));
    }, 30_000);
    child.once('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.once('exit', (code, signal) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`The second launch exited with ${code ?? signal}`));
    });
  });
}
