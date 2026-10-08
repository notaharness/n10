#!/usr/bin/env node
//
// fake-agent.mjs — scriptable stand-in for an AI agent, spawned through
// the desktop's normal `aiCommand` path.
//
// The desktop only needs two shapes of agent, so this is deliberately
// smaller than the CLI suite's harness (apps/cli-e2e/src/fixtures):
//
//   idle    — prints a banner, then sits at a prompt forever. Session is
//             alive but `active` is false, so closing its tab must kill
//             it without a confirmation.
//   working — never stops producing output, which keeps the activity
//             registry's `active` flag set and makes the close
//             confirmation appear.
//
// Flags:
//   --banner=<str>       first line (default "n10-fake-agent-ready")
//   --stream             emit a line every --interval-ms, forever
//   --interval-ms=<n>    stream interval (default 150)
//   --tag                end each streamed line with `@<checkout>`, the
//                        name of the directory it runs in, so a test can
//                        tell whose output a terminal shows
//   --stream-ms=<n>      stop streaming after N ms but stay alive — an
//                        agent that finished a piece of work and is now
//                        waiting at its prompt
//   --exit-after-ms=<n>  self-exit after N ms (default never)
//   --print-seed         print the seed prompt the launcher handed it
//                        (N10_SEED_PROMPT), one marked line per line, so
//                        a test can prove what the agent was actually
//                        started with rather than what the UI claimed.
//   --print-size         print the PTY's grid as `size:<cols>x<rows>#<pid>`,
//                        on start and again on every SIGWINCH. A real
//                        agent draws itself to whatever size it is given,
//                        so this is the only way a test can see the size
//                        the renderer actually asked for. The pid is what
//                        tells one agent's lines from the next one's: a
//                        restart under tmux repaints the screen, so
//                        counting lines cannot say whose they are.
//   --echo               echo each completed line of stdin back, so a test
//                        can prove input travelled renderer → IPC → PTY →
//                        agent → back. Line-buffered on purpose: a PTY in
//                        raw mode delivers one keystroke at a time, so an
//                        immediate echo would answer "hello" with five
//                        separate lines.
//   --mouse=<mode>       turn on mouse tracking mode <mode> (1000 clicks,
//                        1002 drags, 1003 any motion) with SGR encoding,
//                        and print each mouse report it receives as
//                        `mouse:<code>;<col>;<row><M|m>`, so a test can see
//                        which pointer events the terminal forwarded.
//   --keys               ask for modifyOtherKeys (`CSI >4;2m`), as Claude
//                        Code does, so tmux passes modified keys on, and
//                        print each chunk of input as `key:<bytes>`, with
//                        ESC as `ESC` and CR as `CR`, so a test can see the
//                        exact sequence a key sent.

const args = Object.fromEntries(
  process.argv
    .slice(2)
    .filter((a) => a.startsWith('--'))
    .map((a) => {
      const eq = a.indexOf('=');
      return eq === -1 ? [a.slice(2), true] : [a.slice(2, eq), a.slice(eq + 1)];
    })
);

const banner = args.banner ?? 'n10-fake-agent-ready';
const intervalMs = parseInt(args['interval-ms'] ?? '150', 10);
const exitAfterMs = args['exit-after-ms']
  ? parseInt(args['exit-after-ms'], 10)
  : null;

process.stdout.write(banner + '\r\n');

if (args['print-seed']) {
  for (const line of (process.env.N10_SEED_PROMPT ?? '').split('\n')) {
    process.stdout.write(`seed:${line}\r\n`);
  }
}

if (args['print-size']) {
  const report = () => {
    const { columns, rows } = process.stdout;
    process.stdout.write(
      `size:${columns ?? 0}x${rows ?? 0}#${process.pid}\r\n`
    );
  };
  report();
  process.stdout.on('resize', report);
}

const timers = new Set();
const shutdown = () => {
  for (const t of timers) clearInterval(t);
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
process.on('SIGHUP', shutdown);

if (args.echo) {
  if (process.stdin.isTTY) process.stdin.setRawMode(true);
  let line = '';
  process.stdin.on('data', (chunk) => {
    for (const ch of chunk.toString()) {
      if (ch === '\r' || ch === '\n') {
        process.stdout.write(`echo:${line}\r\n`);
        line = '';
      } else {
        line += ch;
      }
    }
  });
  process.stdin.resume();
}

if (args.mouse) {
  if (process.stdin.isTTY) process.stdin.setRawMode(true);
  process.stdout.write(`\x1b[?${args.mouse}h\x1b[?1006h`);
  process.stdout.write(`mouse-ready:${args.mouse}\r\n`);
  let pending = '';
  process.stdin.on('data', (chunk) => {
    pending += chunk.toString();
    // eslint-disable-next-line no-control-regex -- mouse reports are escape sequences
    for (const m of pending.matchAll(/\x1b\[<(\d+;\d+;\d+[Mm])/g)) {
      process.stdout.write(`mouse:${m[1]}\r\n`);
    }
    // Keep only a report still arriving in pieces.
    // eslint-disable-next-line no-control-regex -- mouse reports are escape sequences
    pending = pending.match(/\x1b(\[(<[\d;]*)?)?$/)?.[0] ?? '';
  });
  process.stdin.resume();
}

if (args.keys) {
  if (process.stdin.isTTY) process.stdin.setRawMode(true);
  process.stdout.write('\x1b[>4;2m');
  process.stdout.write('keys-ready\r\n');
  process.stdin.on('data', (chunk) => {
    const shown = chunk
      .toString()
      .replaceAll('\x1b', 'ESC')
      .replaceAll('\r', 'CR');
    process.stdout.write(`key:${shown}\r\n`);
  });
  process.stdin.resume();
}

if (args.stream) {
  let n = 0;
  const ticker = setInterval(() => {
    n += 1;
    const tag = args.tag ? ` @${process.cwd().split('/').pop()}` : '';
    process.stdout.write(`working ${n}${tag}\r\n`);
  }, intervalMs);
  timers.add(ticker);
  if (args['stream-ms']) {
    setTimeout(() => {
      clearInterval(ticker);
      timers.delete(ticker);
      process.stdout.write('done\r\n');
      // Stay alive, quiet, as an agent waiting for its next instruction.
      timers.add(setInterval(() => undefined, 60_000));
    }, parseInt(args['stream-ms'], 10));
  }
} else {
  // Keep the PTY open without producing output — a real agent waiting
  // at its prompt. Node would otherwise exit on an empty event loop.
  timers.add(setInterval(() => undefined, 60_000));
}

if (exitAfterMs != null) setTimeout(shutdown, exitAfterMs);
