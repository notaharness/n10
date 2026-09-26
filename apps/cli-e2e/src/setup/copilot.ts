// Keep the Copilot contract aligned with apps/desktop-e2e/src/setup/copilot.ts.
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

/** Install before launching n10; the real Copilot executable is never invoked. */
export function installCopilot(home: string): Record<string, string> {
  const bin = join(home, 'copilot-bin');
  mkdirSync(bin, { recursive: true });
  const target = join(bin, 'copilot');
  copyFileSync(
    new URL('../fixtures/fake-copilot.mjs', import.meta.url),
    target
  );
  chmodSync(target, 0o755);
  return {
    PATH: `${bin}:${process.env.PATH ?? ''}`,
    COPILOT_HOME: join(home, '.copilot'),
  };
}

export function copilotCalls(
  cwd: string
): { args: string[]; cwd: string; pid: number }[] {
  try {
    return readFileSync(join(cwd, '.fake-copilot.jsonl'), 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}

export function controlCopilot(
  cwd: string,
  mode: 'busy' | 'idle' | 'exit'
): void {
  writeFileSync(join(cwd, '.fake-copilot-control'), mode);
}

/** Enough output for n10's minimum active streak before asserting idle. */
export function copilotWorked(cwd: string): boolean {
  return existsSync(join(cwd, '.fake-copilot-worked'));
}
