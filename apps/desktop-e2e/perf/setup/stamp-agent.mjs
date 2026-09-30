#!/usr/bin/env node
//
// stamp-agent.mjs — a benchmark agent whose output says when it was
// written.
//
// Streams `tick <epoch ms> <n> @<checkout>` forever, so a benchmark can
// tell from a terminal's text alone whose output it shows and whether
// that is what the agent printed just now or something older. A checkout whose path contains
// `--backlog-match` first prints `--backlog-kb` of filler, which is the
// agent that has been running for a while and filled its scrollback.
//
// Flags:
//   --interval-ms=<n>      tick interval (default 250)
//   --backlog-kb=<n>       filler to print before the first tick
//   --backlog-match=<str>  only a cwd containing this prints the filler
//   --burst-kb=<n>         the backlog agent also prints this much at once
//   --burst-every-ms=<n>   …this often (default 3000): a build log, a
//                          file dumped to the screen
//   --redraw-fps=<n>       instead of a line per interval, repaint every
//                          cell of the screen n times a second, ending
//                          on the tick line

import { basename } from 'node:path';

const args = Object.fromEntries(
  process.argv
    .slice(2)
    .filter((a) => a.startsWith('--'))
    .map((a) => {
      const eq = a.indexOf('=');
      return eq === -1 ? [a.slice(2), true] : [a.slice(2, eq), a.slice(eq + 1)];
    })
);

const intervalMs = parseInt(args['interval-ms'] ?? '250', 10);
const backlogKb = parseInt(args['backlog-kb'] ?? '0', 10);
const match = args['backlog-match'];

process.stdout.write('n10-perf-agent-ready\r\n');

const filler = (kb) => {
  const line = `${'backlog '.repeat(9)}`;
  const lines = Math.ceil((kb * 1024) / (line.length + 10));
  let out = '';
  for (let i = 0; i < lines; i++) out += `${line}${i}\r\n`;
  return out;
};
const isBacklogAgent = !match || process.cwd().includes(match);
if (backlogKb > 0 && isBacklogAgent) process.stdout.write(filler(backlogKb));
const burstKb = parseInt(args['burst-kb'] ?? '0', 10);
if (burstKb > 0 && isBacklogAgent) {
  const burst = filler(burstKb);
  setInterval(
    () => process.stdout.write(burst),
    parseInt(args['burst-every-ms'] ?? '3000', 10)
  );
}

const checkout = basename(process.cwd());
const redrawFps = parseInt(args['redraw-fps'] ?? '0', 10);
let n = 0;
const frame = () => {
  const rows = Math.max(5, (process.stdout.rows ?? 24) - 1);
  const cols = Math.max(20, process.stdout.columns ?? 80);
  let out = '\x1b[H';
  // Every cell changes every frame, so tmux, which forwards only what
  // changed, has to send the whole screen: the worst case for the host.
  for (let r = 0; r < rows - 1; r++) {
    let line = '';
    for (let c = 0; c < cols - 1; c++) {
      line += String.fromCharCode(33 + ((n + r + c) % 90));
    }
    out += `\x1b[2K${line}\r\n`;
  }
  return `${out}\x1b[2Ktick ${Date.now()} ${n} @${checkout}\x1b[J`;
};
const ticker = setInterval(
  () => {
    n += 1;
    process.stdout.write(
      redrawFps > 0 ? frame() : `tick ${Date.now()} ${n} @${checkout}\r\n`
    );
  },
  redrawFps > 0 ? Math.round(1000 / redrawFps) : intervalMs
);

const shutdown = () => {
  clearInterval(ticker);
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
process.on('SIGHUP', shutdown);
