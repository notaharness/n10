import { exec as execCb, type ExecOptions } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(execCb);

/** Default timeout for git commands (30s). */
const GIT_TIMEOUT_MS = 30_000;

/**
 * Environment variables that prevent git and SSH from prompting for
 * credentials interactively. Without these, a locked SSH agent (e.g.
 * 1Password) can cause SSH to open /dev/tty for a passphrase prompt,
 * which steals stdin from n10's TUI.
 */
export const GIT_NO_PROMPT_ENV = {
  GIT_TERMINAL_PROMPT: '0', // git: never prompt for credentials
  GIT_SSH_COMMAND: 'ssh -o BatchMode=yes', // ssh: never prompt on TTY
};

/**
 * n10's git calls run beside the user's and the agents' own git. A read
 * such as `git status` refreshes stale stat data in the
 * index and, when it can take `index.lock`, writes the index back as a
 * side effect, so a `git commit` that starts meanwhile fails with
 * "index.lock: File exists". `GIT_OPTIONAL_LOCKS=0` skips that optional
 * write. A lock an operation needs is still taken.
 */
const GIT_NO_OPTIONAL_LOCKS_ENV = {
  GIT_OPTIONAL_LOCKS: '0',
};

export function exec(
  command: string,
  options?: { encoding: BufferEncoding } & ExecOptions
): Promise<{ stdout: string; stderr: string }> {
  return execAsync(command, {
    timeout: GIT_TIMEOUT_MS,
    ...options,
    env: {
      ...process.env,
      ...GIT_NO_PROMPT_ENV,
      ...GIT_NO_OPTIONAL_LOCKS_ENV,
      ...options?.env,
    },
  });
}

/**
 * Options for a git call made on behalf of a specific repository.
 * `cwd` is added only when given, so a caller that passes none runs
 * against the process's directory exactly as before.
 */
export function gitOptions(cwd?: string): {
  encoding: BufferEncoding;
  cwd?: string;
} {
  return cwd ? { encoding: 'utf8', cwd } : { encoding: 'utf8' };
}
