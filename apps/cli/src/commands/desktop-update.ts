import type { NpmUpdatePlan } from '@n10/core';
/** Node-only handoff owned by the existing npm desktop launcher. */
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export function desktopUpdateHandoff(root: string) {
  const base = join(homedir(), '.n10');
  mkdirSync(base, { recursive: true });
  const dir = mkdtempSync(join(base, 'update-handoff-'));
  const request = join(dir, 'request.json');
  return {
    request,
    async finish(code: number): Promise<number> {
      let command = 'npm i -g @notaharness/n10@beta';
      try {
        if (code !== 42) return code;
        // Load all update/relaunch code before npm can replace the package.
        const { runNpmUpdate, relaunchNpmApp } = await import(
          './desktop-update-runtime.js'
        );
        const plan = JSON.parse(readFileSync(request, 'utf8')) as NpmUpdatePlan;
        if (plan.root !== realpathSync(root))
          throw new Error(
            'Update request belongs to a different installation.'
          );
        command = `npm i -g @notaharness/n10@${plan.version}`;
        const result = await runNpmUpdate(plan);
        console.log(result.message);
        if (result.status === 'failed')
          console.error(`npm logs: ${result.logPath}`);
        return await relaunchNpmApp(root, 'desktop');
      } catch (error) {
        console.error('n10: update failed:', error);
        console.error(`Run ${command}, then open n10 again.`);
        return 1;
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
  };
}
