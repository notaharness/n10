// Keep the Codex contract aligned with apps/desktop-e2e/src/setup/codex.ts.
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

/** Install before launching n10; the real Codex executable is never invoked. */
export function installCodex(home: string): Record<string, string> {
  const bin = join(home, 'codex-bin');
  mkdirSync(bin, { recursive: true });
  const target = join(bin, 'codex');
  copyFileSync(new URL('../fixtures/fake-codex.mjs', import.meta.url), target);
  chmodSync(target, 0o755);
  return {
    PATH: `${bin}:${process.env.PATH ?? ''}`,
    CODEX_HOME: join(home, '.codex'),
  };
}

export function codexCalls(
  cwd: string
): { args: string[]; cwd: string; pid: number }[] {
  try {
    return readFileSync(join(cwd, '.fake-codex.jsonl'), 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}

export function controlCodex(
  cwd: string,
  mode: 'busy' | 'idle' | 'exit'
): void {
  writeFileSync(join(cwd, '.fake-codex-control'), mode);
}

/** Enough output for n10's minimum active streak before asserting idle. */
export function codexWorked(cwd: string): boolean {
  return existsSync(join(cwd, '.fake-codex-worked'));
}
