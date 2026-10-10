import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import { acceptMuxClient, muxRuntime } from '@n10/core/mux';
import { bash, FIXTURES, MuxProfile, N10_MAIN } from './mux-owner.js';

/**
 * The one-shot mux contract, between separate processes: a foreground
 * owner and the `n10 mux` clients Orchestra's scripts run.
 */

let profile: MuxProfile;
test.beforeEach(() => {
  profile = new MuxProfile();
});
test.afterEach(async () => {
  await profile.dispose();
});

/** What the Bash adapter pastes: a tab, non-ASCII and an ESC. */
const MESSAGE = 'hello\ttab ünïcode \x1b[x';

const lines = (text: string) => text.split('\n').filter(Boolean);

test('without an owner, every verb says so and prints nothing', () => {
  for (const args of [['status'], ['list'], ['inspect', 'x']]) {
    const result = profile.mux(args);
    expect(result).toMatchObject({ status: 3, stdout: '' });
    expect(result.stderr).toMatch(/^HOST_NOT_RUNNING\t/);
  }
  const json = profile.mux(['status', '--json']);
  expect(JSON.parse(json.stdout)).toMatchObject({
    ok: false,
    error: { code: 'HOST_NOT_RUNNING' },
  });
});

test('serve owns the profile until it is ended; a second serve leaves it be', async () => {
  const hostId = await profile.serve();
  expect(profile.mux(['status']).stdout).toBe(
    `1\t${hostId}\theadless\t${process.platform}\t0\toneshot-v1\n`
  );
  const second = spawnSync(process.execPath, [N10_MAIN, 'mux', 'serve'], {
    env: profile.env,
    encoding: 'utf8',
    timeout: 15_000,
  });
  expect(second.status).toBe(5);
  expect(second.stderr).toBe(
    `RUNNING\tAn n10 mux owner is already running as host ${hostId}\n`
  );
  expect(profile.mux(['status']).status).toBe(0);
  await profile.stop();
  expect(profile.mux(['status']).status).toBe(3);
});

test('serve ends cleanly on SIGTERM', async () => {
  test.skip(process.platform === 'win32', 'Windows sends no signals');
  await profile.serve();
  expect(await profile.stop()).toBe(0);
});

test('serve leaves an installed tmux to hold the sessions', () => {
  test.skip(process.platform === 'win32', 'a POSIX fake tmux');
  const bin = join(profile.home, 'tmux-bin');
  mkdirSync(bin);
  writeFileSync(join(bin, 'tmux'), '#!/bin/sh\necho "tmux 3.4"\n', {
    mode: 0o755,
  });
  const serve = spawnSync(process.execPath, [N10_MAIN, 'mux', 'serve'], {
    env: { ...profile.env, PATH: `${bin}:${profile.env['PATH']}` },
    encoding: 'utf8',
    timeout: 15_000,
  });
  expect(serve.status).toBe(1);
  expect(serve.stderr).toMatch(/^UNSUPPORTED\ttmux is installed/);
  expect(profile.mux(['status']).status).toBe(3);
});

test('serve says it cannot bind an endpoint, rather than crash', () => {
  test.skip(process.platform === 'win32', 'a POSIX socket path limit');
  // Past the 104/108-byte limit on a socket path.
  const deep = join(profile.home, 'd'.repeat(120));
  mkdirSync(deep);
  const serve = spawnSync(process.execPath, [N10_MAIN, 'mux', 'serve'], {
    env: { ...profile.env, HOME: deep },
    encoding: 'utf8',
    timeout: 15_000,
  });
  expect(serve.status).toBe(1);
  expect(serve.stderr).toMatch(/^UNSUPPORTED\tCannot serve: /);
  expect(serve.stderr).not.toMatch(/\n\s+at /);
});

test('the Bash adapter drives a player through every verb', async () => {
  await profile.serve();
  const worktree = join(profile.home, 'work tree ü');
  mkdirSync(worktree);
  const run = spawnSync(
    bash(),
    [
      join(FIXTURES, 'orchestra-mux.sh'),
      worktree,
      join(FIXTURES, 'mux-agent.mjs'),
    ],
    {
      cwd: profile.home,
      env: { ...profile.env, N10_NODE: process.execPath, N10_MAIN },
      encoding: 'utf8',
      timeout: 60_000,
    }
  );
  expect(run.stderr).toBe('');
  const steps = Object.fromEntries(
    lines(run.stdout).map((line) => {
      const at = line.indexOf('=');
      return [line.slice(0, at), line.slice(at + 1)];
    })
  );
  expect(steps).toMatchObject({
    status: 'headless,0,oneshot-v1',
    created: 'running,orchestra,worktree',
    duplicate: '5,IDENTITY_MISMATCH',
    title: 'mux-agent',
    sent: `${Buffer.byteLength(`${MESSAGE}\r`)},1`,
    selfclaim: 'claim=0',
    outsideclaim: '5,IDENTITY_MISMATCH',
    claimed: 'claude:abc',
    exited: 'exited,7',
    listed: '0',
  });
  expect(steps['self']).toMatch(/^self=0:[0-9a-f]{16}$/);
  // The agent echoes each line as JSON, so the tab and the ESC show.
  expect(steps['echoed']).toBe(`got:${JSON.stringify(MESSAGE)}`);
});

test('one of two restarts of an exited session wins', async () => {
  const hostId = await profile.serve();
  const created = profile.mux(['create', '--request', '-'], {
    label: 'agent',
    cwd: profile.home,
    argv: [process.execPath, '-e', 'process.exit(2)'],
    retainOnExit: true,
  });
  const [id] = created.stdout.split('\t');
  await expect
    .poll(() => profile.mux(['inspect', id!]).stdout.split('\t')[6])
    .toBe('exited');
  const restart = {
    expectedHostId: hostId,
    generation: 1,
    cwd: profile.home,
    argv: [process.execPath, '-e', 'setTimeout(() => {}, 30000)'],
    retainOnExit: true,
  };
  const results = await Promise.all(
    [0, 1].map(() =>
      profile.muxAsync(['restart', id!, '--request', '-'], restart)
    )
  );
  expect(results.map((result) => result.status).sort()).toEqual([0, 5]);
  expect(results.find((result) => result.status === 5)?.stderr).toMatch(
    /^STALE_GENERATION\t/
  );
  expect(profile.mux(['inspect', id!]).stdout.split('\t')[2]).toBe('2');
});

test('a malformed or oversized request is refused before it reaches the owner', async () => {
  await profile.serve();
  const refused = (args: string[], input: unknown) => {
    const result = profile.mux(args, input);
    return [result.status, result.stdout, result.stderr.split('\t')[0]];
  };
  expect(refused(['create', '--request', '-'], 'not json')).toEqual([
    2,
    '',
    'INVALID_REQUEST',
  ]);
  expect(
    refused(['create', '--request', '-'], {
      label: 'a\tb',
      cwd: profile.home,
    })
  ).toEqual([2, '', 'INVALID_REQUEST']);
  expect(
    refused(['create', '--request', '-'], 'x'.repeat(1024 * 1024 + 1))
  ).toEqual([2, '', 'INVALID_REQUEST']);
  expect(
    refused(['create', '--request', '-'], {
      label: 'p',
      cwd: profile.home,
      cols: 1,
    })
  ).toEqual([2, '', 'INVALID_REQUEST']);
  expect(profile.mux(['status']).stdout.split('\t')[4]).toBe('0');
});

test('a change the owner never answered is reported as unknown, not retried', async () => {
  // An owner that authenticates, reads one request and goes away.
  const runtime = muxRuntime(profile.env);
  mkdirSync(runtime.dir, { recursive: true, mode: 0o700 });
  const owner = await startSilentOwner(runtime);
  try {
    const send = await profile.muxAsync(['send', 'abc', '--request', '-'], {
      expectedHostId: owner.hostId,
      generation: 1,
      mode: 'literal',
      text: 'once',
    });
    expect(send).toMatchObject({ status: 1, stdout: '' });
    expect(send.stderr).toMatch(/^OUTCOME_UNKNOWN\t/);
    expect(owner.requests()).toBe(1);
    const list = await profile.muxAsync(['list']);
    expect(list.stderr).toMatch(/^HOST_NOT_RUNNING\t/);
  } finally {
    await owner.close();
  }
});

/** Publishes real credentials, completes the handshake, then closes
 *  each connection after its first request line. */
async function startSilentOwner(runtime: ReturnType<typeof muxRuntime>) {
  const credentials = {
    hostId: randomBytes(16).toString('hex'),
    secret: randomBytes(32),
  };
  writeFileSync(
    join(runtime.dir, 'mux.json'),
    JSON.stringify({
      v: 1,
      hostId: credentials.hostId,
      secret: credentials.secret.toString('base64'),
    }),
    { mode: 0o600 }
  );
  let requests = 0;
  const server = createServer((socket) => {
    socket.on('error', () => socket.destroy());
    acceptMuxClient(socket, credentials).then(
      (rest) => {
        const close = () => {
          requests += 1;
          socket.destroy();
        };
        if (rest.includes(0x0a)) return close();
        socket.on('data', (chunk: Buffer) => {
          if (chunk.includes(0x0a)) close();
        });
        socket.resume();
      },
      () => undefined
    );
  });
  await new Promise<void>((resolve) =>
    server.listen(runtime.endpoint, resolve)
  );
  return {
    hostId: credentials.hostId,
    requests: () => requests,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

test.describe('a session inside the owner', () => {
  test('runs with its own identity, and ends with the owner', async () => {
    await profile.serve();
    const created = profile.mux(['create', '--request', '-'], {
      label: 'agent',
      cwd: profile.home,
      argv: [
        process.execPath,
        '-e',
        `require('fs').writeFileSync('identity.txt', ['N10_MUX_SESSION_ID','N10_MUX_GENERATION','ORCHESTRA_SESSION'].map(n => process.env[n] ?? '-').join(' ')); setInterval(() => {}, 1000)`,
      ],
      envSet: { ORCHESTRA_SESSION: 'player' },
    });
    const [id] = created.stdout.split('\t');
    const pid = Number(created.stdout.split('\t')[7]);
    await expect
      .poll(() => {
        try {
          return readFileSync(join(profile.home, 'identity.txt'), 'utf8');
        } catch {
          return '';
        }
      })
      .toBe(`${id} 1 player`);
    await profile.stop();
    await expect.poll(() => alive(pid)).toBe(false);
  });
});

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
