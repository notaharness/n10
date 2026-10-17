import { readFileSync } from 'node:fs';

/** Clock ticks per second for `/proc/<pid>/stat` (`getconf CLK_TCK`);
 *  100 on every Linux this runs on. */
const CLK_TCK = 100;

/** CPU time a process has used so far, in ms (user + system), from
 *  `/proc`; 0 once it is gone. Linux only, like the benchmark. */
export function cpuMs(pid: number): number {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
    // Fields after the command name, which may itself hold spaces.
    const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
    const ticks = Number(fields[11]) + Number(fields[12]);
    return (ticks * 1000) / CLK_TCK;
  } catch {
    return 0;
  }
}
