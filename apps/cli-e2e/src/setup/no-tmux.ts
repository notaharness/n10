import { mkdirSync, readdirSync, readFileSync, symlinkSync } from 'node:fs';
import { delimiter, join } from 'node:path';

/**
 * A PATH that finds every program `path` finds except tmux: one
 * directory of links to the first entry of each name, in PATH order.
 * n10 then sees no tmux installed and owns its sessions itself.
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

function read(path: string): string {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return '';
  }
}

/** PIDs of the processes running `script` with this HOME: how a test
 *  finds the agents n10 started without tmux to ask. Linux `/proc`. */
export function processesRunning(script: string, home: string): number[] {
  return readdirSync('/proc')
    .filter((entry) => /^\d+$/.test(entry))
    .filter(
      (pid) =>
        read(`/proc/${pid}/cmdline`).split('\0').includes(script) &&
        read(`/proc/${pid}/environ`).split('\0').includes(`HOME=${home}`)
    )
    .map(Number);
}
