import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { build } from 'esbuild';

const require = createRequire(import.meta.url);
const SOURCES = resolve(import.meta.dirname, '..', 'probe');
const BUNDLE = resolve(
  import.meta.dirname,
  '..',
  '..',
  '..',
  'test-output',
  'windows',
  'probe'
);

/** Bundle the probe's main and host where Node finds the workspace's
 *  node_modules: electron, node-pty and koffi stay external, exactly as
 *  the desktop build leaves them. */
export async function bundleProbe(): Promise<string> {
  await build({
    entryPoints: {
      'probe-main': join(SOURCES, 'probe-main.ts'),
      'probe-host': join(SOURCES, 'probe-host.ts'),
    },
    outdir: BUNDLE,
    outExtension: { '.js': '.cjs' },
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    conditions: ['@n10/source'],
    external: ['electron', 'node-pty', 'koffi'],
    logLevel: 'warning',
  });
  return join(BUNDLE, 'probe-main.cjs');
}

export interface ProbeRun {
  electron: ChildProcess;
  stateDir: string;
  main: number;
  host: number;
  descendants: Record<string, number>;
  job: number[];
  log: () => string;
}

export type Scenario = 'main-crash' | 'main-exit' | 'host-crash';

export async function launchProbe(
  probeMain: string,
  scenario: Scenario
): Promise<ProbeRun> {
  const stateDir = mkdtempSync(join(tmpdir(), 'n10-probe-'));
  const electron = spawn(require('electron') as string, [probeMain], {
    env: {
      ...process.env,
      N10_PROBE_DIR: stateDir,
      N10_PROBE_SCENARIO: scenario,
      ELECTRON_ENABLE_LOGGING: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  electron.stdout?.on('data', (chunk: Buffer) => (log += chunk.toString()));
  electron.stderr?.on('data', (chunk: Buffer) => (log += chunk.toString()));
  const ready = join(stateDir, 'descendants.json');
  const failed = join(stateDir, 'host-error.txt');
  await waitFor('the probe host', () => {
    if (existsSync(failed))
      throw new Error(`Probe host failed:\n${readFileSync(failed, 'utf8')}`);
    if (electron.exitCode !== null)
      throw new Error(`Electron exited ${electron.exitCode}:\n${log}`);
    return existsSync(ready) || undefined;
  });
  const processes = JSON.parse(
    readFileSync(join(stateDir, 'processes.json'), 'utf8')
  ) as { main: number; host: number };
  const { descendants, job } = JSON.parse(readFileSync(ready, 'utf8')) as {
    descendants: Record<string, number>;
    job: number[];
  };
  return {
    electron,
    stateDir,
    ...processes,
    descendants,
    job,
    log: () => log,
  };
}

export function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** Poll until `check` returns a value, or throw after `timeoutMs`. */
export async function waitFor<T>(
  what: string,
  check: () => T | undefined,
  timeoutMs = 60_000
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = check();
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

/** The processes still running once every one of `pids` has exited,
 *  or `timeoutMs` has passed. */
export async function survivorsAfter(
  pids: number[],
  timeoutMs = 20_000
): Promise<number[]> {
  const deadline = Date.now() + timeoutMs;
  while (pids.some(alive) && Date.now() < deadline)
    await new Promise((r) => setTimeout(r, 100));
  return pids.filter(alive);
}

/** End whatever a failed run left behind, and say what that was. */
export function reap(run: ProbeRun): number[] {
  const pids = [run.main, run.host, ...Object.values(run.descendants)];
  const survivors = pids.filter(alive);
  for (const pid of survivors)
    spawnSync('taskkill', ['/F', '/T', '/PID', String(pid)], {
      stdio: 'ignore',
    });
  rmSync(run.stateDir, { recursive: true, force: true });
  return survivors;
}
