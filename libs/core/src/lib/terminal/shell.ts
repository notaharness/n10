import { execFile } from 'node:child_process';
import type { MachineExecutor } from '@n10/worktree-manager';
import { SHELL_CHOICES, type ShellChoice } from './shell-choices.js';

const FALLBACK_SHELL = '/bin/sh';

/**
 * Runs on the machine the terminal opens on, so a remote terminal gets
 * that machine's shells and its own `$SHELL`. `$1` is the chosen shell
 * name, empty for `auto`. A named shell that is not installed, and a
 * `$SHELL` that is unset or not an executable file, fall through to the
 * next answer, ending at sh.
 */
const PROBE = `
if [ -n "$1" ]; then
  path=$(command -v "$1" 2>/dev/null)
  if [ -f "$path" ] && [ -x "$path" ]; then printf %s "$path"; exit 0; fi
fi
if [ -f "$SHELL" ] && [ -x "$SHELL" ]; then printf %s "$SHELL"; exit 0; fi
printf %s ${FALLBACK_SHELL}
`;

function isChoice(value: string | undefined): value is ShellChoice {
  return (SHELL_CHOICES as readonly string[]).includes(value ?? '');
}

function probeLocally(want: string): Promise<string> {
  return new Promise((resolve) => {
    execFile(
      'sh',
      ['-c', PROBE, 'sh', want],
      { encoding: 'utf8', timeout: 5000 },
      (error, stdout) => resolve(error ? '' : stdout)
    );
  });
}

/**
 * The absolute path of the shell a new terminal runs. `setting` is the
 * stored Shell value (unset or `auto`: the login shell). Local when
 * `executor` is omitted; otherwise asked of that machine.
 */
export async function resolveShell(
  setting: string | undefined,
  executor?: MachineExecutor
): Promise<string> {
  const want = isChoice(setting) ? setting : '';
  const stdout = executor
    ? (await executor.run(['sh', '-c', PROBE, 'sh', want], { cwd: '~' })).stdout
    : await probeLocally(want);
  const path = stdout.trim();
  return path.startsWith('/') ? path : FALLBACK_SHELL;
}
