import { mkdirSync, readdirSync, symlinkSync } from 'node:fs';
import { delimiter, join } from 'node:path';

/** Whether this run hides tmux from the app (`N10_E2E_NO_TMUX=1`): the
 *  no-tmux CI job runs the `@owner` tests this way. */
export const RUN_WITHOUT_TMUX = process.env.N10_E2E_NO_TMUX === '1';

/**
 * A PATH that finds every program `path` finds except tmux: one
 * directory of links to the first entry of each name, in PATH order.
 * The app then sees no tmux installed and owns its sessions itself.
 * Absolute paths, such as `/bin/sh`, still resolve.
 */
export function pathWithoutTmux(path: string, home: string): string {
  const bin = join(home, '.path-without-tmux');
  mkdirSync(bin, { recursive: true });
  const linked = new Set<string>(['tmux']);
  for (const dir of path.split(delimiter).filter(Boolean)) {
    let names: string[];
    try {
      names = readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of names) {
      if (linked.has(name)) continue;
      linked.add(name);
      symlinkSync(join(dir, name), join(bin, name));
    }
  }
  return bin;
}
