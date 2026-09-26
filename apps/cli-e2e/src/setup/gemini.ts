// Keep the Gemini contract aligned with apps/desktop-e2e/src/setup/gemini.ts.
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

/** Install before launching n10; the real Gemini executable is never invoked. */
export function installGemini(home: string): Record<string, string> {
  const bin = join(home, 'gemini-bin');
  mkdirSync(bin, { recursive: true });
  const target = join(bin, 'gemini');
  copyFileSync(new URL('../fixtures/fake-gemini.mjs', import.meta.url), target);
  chmodSync(target, 0o755);
  return {
    PATH: `${bin}:${process.env.PATH ?? ''}`,
    GEMINI_CLI_HOME: join(home, '.gemini'),
  };
}

export function geminiCalls(
  cwd: string
): { args: string[]; cwd: string; pid: number }[] {
  try {
    return readFileSync(join(cwd, '.fake-gemini.jsonl'), 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}

export function controlGemini(
  cwd: string,
  mode: 'busy' | 'idle' | 'exit'
): void {
  writeFileSync(join(cwd, '.fake-gemini-control'), mode);
}

/** Enough output for n10's minimum active streak before asserting idle. */
export function geminiWorked(cwd: string): boolean {
  return existsSync(join(cwd, '.fake-gemini-worked'));
}
