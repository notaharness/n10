import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { superviseChild } from './child-supervision.js';

/** Keep the terminal owned until the replacement closes. It shares the
 * foreground group, so absorb tty INT/HUP and forward only TERM. */
export async function relaunchNpmApp(root: string, mode: 'desktop' | 'tui') {
  const entry = join(root, 'main.js');
  if (!existsSync(entry))
    throw new Error(
      'The n10 installation is incomplete. Reinstall it with npm.'
    );
  const env = { ...process.env };
  delete env.N10_UPDATE_HANDOFF;
  const child = spawn(
    process.execPath,
    [entry, ...(mode === 'tui' ? ['--tui', process.cwd()] : [])],
    { stdio: 'inherit', env }
  );
  return superviseChild(child, process, true);
}
