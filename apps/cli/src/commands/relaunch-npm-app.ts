import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { superviseChild } from './child-supervision.js';

/** Keep the terminal owned until the replacement closes. It shares the
 * foreground group, so absorb tty INT/HUP and forward only TERM. */
export function relaunchNpmApp(root: string, mode: 'desktop' | 'tui') {
  const env = { ...process.env };
  delete env.N10_UPDATE_HANDOFF;
  const child = spawn(
    process.execPath,
    [
      join(root, 'main.js'),
      ...(mode === 'tui' ? ['--tui', process.cwd()] : []),
    ],
    { stdio: 'inherit', env }
  );
  return superviseChild(child, process, true);
}
