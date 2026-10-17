import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/** Runs the real launcher's handoff; Playwright owns the Electron child. */
export async function npmUpdateParent(
  root: string,
  env: Record<string, string>
) {
  const source = pathToFileURL(
    resolve(import.meta.dirname, '../../../cli/src/commands/desktop-update.ts')
  ).href;
  const script = `
    import { desktopUpdateHandoff } from ${JSON.stringify(source)};
    const handoff = desktopUpdateHandoff(${JSON.stringify(root)});
    process.send({ request: handoff.request });
    process.once('message', async code => process.exit(await handoff.finish(code)));
  `;
  const child = spawn(
    process.execPath,
    ['--import', 'tsx', '--input-type=module', '--eval', script],
    {
      cwd: resolve(import.meta.dirname, '../../../..'),
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    }
  );
  let output = '';
  child.stdout!.on('data', (chunk) => {
    output += String(chunk);
  });
  child.stderr!.on('data', (chunk) => {
    output += String(chunk);
  });
  const exit = once(child, 'exit');
  const ready = once(child, 'message');
  const [message] = await Promise.race([
    ready,
    exit.then(() => {
      throw new Error(`npm parent exited before ready: ${output}`);
    }),
  ]);
  return {
    request: (message as { request: string }).request,
    async finish(code: number) {
      child.send(code);
      const [status] = await exit;
      if (status !== 0)
        throw new Error(`npm update parent exited ${status}: ${output}`);
    },
    async close() {
      if (child.exitCode === null && child.signalCode === null) child.kill();
      await exit;
    },
  };
}
