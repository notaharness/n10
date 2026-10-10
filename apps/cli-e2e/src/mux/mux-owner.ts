import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pathWithoutTmux } from '../setup/no-tmux.js';

/**
 * Separate processes against one profile: a foreground `n10 mux serve`
 * owner, and one-shot `n10 mux` clients, as Orchestra's scripts run
 * them. No tmux on PATH; on Windows there is none to hide.
 */

export const N10_MAIN = fileURLToPath(
  new URL('../../../cli/dist/main.js', import.meta.url)
);
export const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));

export interface Result {
  status: number | null;
  stdout: string;
  stderr: string;
}

/** What the test runner's own environment must not pass on: its tmux,
 *  a mux session it may itself run in, and CI's no-paint switch. */
const UNINHERITED = new Set(['TMUX', 'TMUX_PANE', 'CI', 'N10_MUX_RUNTIME']);

export class MuxProfile {
  /** Short, so a POSIX socket path inside it stays within its limit. */
  readonly home = mkdtempSync(join(tmpdir(), 'n10-mux-'));
  readonly env: NodeJS.ProcessEnv;
  private owner: ChildProcess | null = null;

  constructor() {
    const inherited = Object.entries(process.env).filter(
      ([name]) => !UNINHERITED.has(name)
    );
    const env: NodeJS.ProcessEnv = {
      ...Object.fromEntries(inherited),
      HOME: this.home,
      USERPROFILE: this.home,
      LOCALAPPDATA: join(this.home, 'AppData', 'Local'),
    };
    if (process.platform !== 'win32')
      env['PATH'] = pathWithoutTmux(process.env['PATH'] ?? '', this.home);
    this.env = env;
  }

  /** `n10 mux ARGS`, with `input` on stdin. */
  mux(args: string[], input?: unknown): Result {
    const result = spawnSync(process.execPath, [N10_MAIN, 'mux', ...args], {
      env: this.env,
      encoding: 'utf8',
      timeout: 30_000,
      ...(input === undefined
        ? {}
        : { input: typeof input === 'string' ? input : JSON.stringify(input) }),
    });
    return {
      status: result.status,
      stdout: result.stdout,
      stderr: result.stderr,
    };
  }

  /** `n10 mux ARGS` without blocking this process: for an owner that
   *  runs in this process, and for concurrent clients. */
  muxAsync(args: string[], input?: unknown): Promise<Result> {
    return new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [N10_MAIN, 'mux', ...args], {
        env: this.env,
      });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
      child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
      child.once('error', reject);
      child.once('close', (status) => resolve({ status, stdout, stderr }));
      child.stdin.end(
        input === undefined
          ? ''
          : typeof input === 'string'
          ? input
          : JSON.stringify(input)
      );
    });
  }

  /** Start `n10 mux serve` and wait until it says it is serving. */
  async serve(): Promise<string> {
    const owner = spawn(process.execPath, [N10_MAIN, 'mux', 'serve'], {
      env: this.env,
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    this.owner = owner;
    let stderr = '';
    return new Promise((resolve, reject) => {
      owner.stderr!.on('data', (chunk: Buffer) => {
        stderr += chunk.toString('utf8');
        const serving = /serving as host ([0-9a-f]+)/.exec(stderr);
        if (serving) resolve(serving[1]!);
      });
      owner.once('exit', (code) =>
        reject(new Error(`serve exited ${code}: ${stderr}`))
      );
    });
  }

  /** End the owner and wait for it: SIGTERM on POSIX, which it
   *  handles; on Windows, where only a console can send Ctrl+C, the
   *  process is terminated. */
  async stop(): Promise<number | null> {
    const owner = this.owner;
    if (!owner || owner.exitCode !== null) return owner?.exitCode ?? null;
    const exited = new Promise<number | null>((resolve) =>
      owner.once('exit', (code) => resolve(code))
    );
    owner.kill('SIGTERM');
    return exited;
  }

  async dispose(): Promise<void> {
    await this.stop();
    rmSync(this.home, { recursive: true, force: true });
  }
}

/** Git for Windows' Bash, never WSL's; plain `bash` elsewhere. */
export function bash(): string {
  if (process.platform !== 'win32') return 'bash';
  const execPath = spawnSync('git', ['--exec-path'], {
    encoding: 'utf8',
  }).stdout.trim();
  // <Git>/mingw64/libexec/git-core → <Git>/bin/bash.exe
  return join(dirname(dirname(dirname(execPath))), 'bin', 'bash.exe');
}
