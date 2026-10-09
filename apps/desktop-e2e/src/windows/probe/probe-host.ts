/**
 * The Windows viability probe's session host: an Electron utility
 * process that joins its own kill-on-close job before it starts
 * anything, then runs PowerShell in a ConPTY through the product's
 * node-pty wrapper and starts one descendant of every kind the job
 * must end with it:
 *
 * - attached: a console process sharing the pseudoconsole,
 * - detached: a console process with a console of its own, started by
 *   the shell and by the host itself,
 * - GUI: a windowed process, started by the shell and by the host.
 *
 * It proves the pseudoconsole answers (computed output, a resize the
 * shell sees), records every process id with the job's own process
 * list, and tells main it is ready.
 */
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { joinKillOnCloseJob, PtySession } from '@n10/terminal-pty';

const stateDir = process.env['N10_PROBE_DIR'];
if (!stateDir) throw new Error('N10_PROBE_DIR is not set');
const parent = (
  process as unknown as { parentPort: { postMessage(message: unknown): void } }
).parentPort;

let output = '';

async function until<T>(what: string, check: () => T | undefined): Promise<T> {
  const deadline = Date.now() + 30_000;
  for (;;) {
    const value = check();
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

const seen = (text: string) => (output.includes(text) ? true : undefined);

function detached(command: string, args: string[]): number {
  const child = spawn(command, args, {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });
  child.unref();
  if (!child.pid) throw new Error(`${command} did not start`);
  return child.pid;
}

async function run(): Promise<void> {
  // First, before this process starts anything.
  const job = joinKillOnCloseJob();
  if (!job) throw new Error('No job off Windows');
  const pty = new PtySession(
    'powershell.exe',
    ['-NoLogo', '-NoProfile', '-NoExit'],
    { cols: 80, rows: 24, cwd: stateDir }
  );
  pty.onData((data) => {
    output += data;
  });

  // Computed by the shell, so an echo of the input cannot pass.
  pty.write('Write-Output ("n10-" + (20 + 22))\r');
  await until('shell output', () => seen('n10-42'));
  pty.resize(100, 30);
  pty.write('Write-Output ("cols=" + [Console]::WindowWidth)\r');
  await until('resized shell', () => seen('cols=100'));

  const childrenFile = join(stateDir!, 'pty-children.txt');
  pty.write(
    [
      "$a = Start-Process ping.exe -ArgumentList '-t','127.0.0.1' -NoNewWindow -PassThru",
      "$d = Start-Process ping.exe -ArgumentList '-t','127.0.0.1' -WindowStyle Hidden -PassThru",
      '$g = Start-Process notepad.exe -PassThru',
      `Set-Content -LiteralPath '${childrenFile}' -Value "$($a.Id) $($d.Id) $($g.Id)"`,
    ].join('; ') + '\r'
  );
  const [attached, shellDetached, shellGui] = await until(
    'shell descendants',
    () =>
      existsSync(childrenFile)
        ? readFileSync(childrenFile, 'utf8').trim().split(' ').map(Number)
        : undefined
  );

  const descendants = {
    shell: pty.pid,
    attached,
    shellDetached,
    shellGui,
    hostDetached: detached('ping.exe', ['-t', '127.0.0.1']),
    hostGui: detached('notepad.exe', []),
  };
  writeFileSync(
    join(stateDir!, 'descendants.json'),
    JSON.stringify({ descendants, job: job.processIds() })
  );
  parent.postMessage({ t: 'ready' });
}

run().catch((err: unknown) => {
  writeFileSync(
    join(stateDir, 'host-error.txt'),
    `${err instanceof Error ? err.stack : String(err)}\n\n${output}`
  );
  process.exit(1);
});
