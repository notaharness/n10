// A stand-in agent for mux sessions: sets its title, asks the owner
// which session it is through `n10 mux self`, then echoes each line of
// input it is sent. Node, so it runs the same on Windows.
import { spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline';

const [main] = process.argv.slice(2);
process.stdout.write('\x1b]2;mux-agent\x07');
const self = spawnSync(process.execPath, [main, 'mux', 'self'], {
  encoding: 'utf8',
});
const sessionId = self.stdout.split('\t')[0] ?? '';
process.stdout.write(`self=${self.status}:${sessionId}\r\nready\r\n`);
createInterface({ input: process.stdin }).on('line', (line) => {
  process.stdout.write(`got:${line}\r\n`);
  if (line === 'exit') process.exit(7);
});
