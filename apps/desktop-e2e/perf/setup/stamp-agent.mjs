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

if (backlogKb > 0 && (!match || process.cwd().includes(match))) {
  const line = `${'backlog '.repeat(9)}`;
  const lines = Math.ceil((backlogKb * 1024) / (line.length + 10));
  let out = '';
  for (let i = 0; i < lines; i++) out += `${line}${i}\r\n`;
  process.stdout.write(out);
}

const checkout = basename(process.cwd());
let n = 0;
const ticker = setInterval(() => {
  n += 1;
  process.stdout.write(`tick ${Date.now()} ${n} @${checkout}\r\n`);
}, intervalMs);

const shutdown = () => {
  clearInterval(ticker);
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
process.on('SIGHUP', shutdown);
