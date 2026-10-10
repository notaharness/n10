// A stand-in agent for mux sessions: sets its title, asks the owner
// which session it is through `n10 mux self`, claims MUX_AGENT_CLAIM
// for itself when asked, then echoes each line of input it is sent as
// JSON, so control characters show. Node, so it runs on Windows too.
import { spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline';

const [main] = process.argv.slice(2);
const n10 = (args, input) =>
  spawnSync(process.execPath, [main, 'mux', ...args], {
    encoding: 'utf8',
    ...(input === undefined ? {} : { input: JSON.stringify(input) }),
  });

process.stdout.write('\x1b]2;mux-agent\x07');
const self = n10(['self']);
const [sessionId = '', hostId = ''] = self.stdout.split('\t');
process.stdout.write(`self=${self.status}:${sessionId}\r\n`);
const claimTarget = process.env.MUX_AGENT_CLAIM;
if (claimTarget) {
  const claim = n10(['metadata', sessionId, '--request', '-'], {
    expectedHostId: hostId,
    claimTarget,
  });
  process.stdout.write(`claim=${claim.status}\r\n`);
}
process.stdout.write('ready\r\n');
createInterface({ input: process.stdin }).on('line', (line) => {
  process.stdout.write(`got:${JSON.stringify(line)}\r\n`);
  if (line === 'exit') process.exit(7);
});
