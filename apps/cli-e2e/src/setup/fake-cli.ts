import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

type Vendor = 'codex' | 'gemini' | 'copilot';
interface Call {
  args: string[];
  cwd: string;
  pid: number;
}

/** Shared vendor fixture; HOME isolation comes from the owning e2e shell. */
export function fakeCli(vendor: Vendor) {
  const path = (cwd: string, suffix: string) =>
    join(cwd, `.fake-${vendor}${suffix}`);
  return {
    install(home: string): Record<string, string> {
      const bin = join(home, `${vendor}-bin`);
      mkdirSync(bin, { recursive: true });
      const target = join(bin, vendor);
      copyFileSync(
        new URL(
          '../../../../libs/core/tests/fixtures/fake-vendor-cli.mjs',
          import.meta.url
        ),
        target
      );
      chmodSync(target, 0o755);
      return { PATH: `${bin}:${process.env.PATH ?? ''}` };
    },
    calls(cwd: string): Call[] {
      const log = path(cwd, '.jsonl');
      if (!existsSync(log)) return [];
      return readFileSync(log, 'utf8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));
    },
    control(cwd: string, mode: 'busy' | 'idle' | 'exit'): void {
      writeFileSync(path(cwd, '-control'), mode);
    },
    /** Enough output for n10's minimum active streak before asserting idle. */
    worked(cwd: string): boolean {
      return existsSync(path(cwd, '-worked'));
    },
  };
}
