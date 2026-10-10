import { afterEach, describe, expect, it } from 'vitest';
import type { SessionBackend, SessionSpec } from '@n10/terminal';
import { ManagedCatalog } from './managed-catalog.js';
import type { ManagedIncarnation } from './session-catalog.js';

/** Real processes in real PTYs, owned by one catalog. */

const TAGS = ['@orchestra-spawner', '@orchestra-agent'];

function spec(script: string): SessionSpec {
  return {
    cmd: '/bin/sh',
    args: ['-c', script],
    cwd: process.cwd(),
    cols: 80,
    rows: 24,
  };
}

function output(backend: SessionBackend): { text: () => string } {
  let text = '';
  backend.onData((data) => (text += data));
  return { text: () => text };
}

async function until(check: () => boolean, ms = 5_000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!check()) {
    if (Date.now() > deadline) throw new Error('timed out');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

let catalog: ManagedCatalog;
afterEach(() => catalog.close());

describe.skipIf(process.platform === 'win32')('a managed catalog', () => {
  it('lists a created session by its tags and runs it', async () => {
    catalog = new ManagedCatalog('host-a');
    const handle = await catalog.open(spec('echo ready; exec sleep 30'), {
      mode: 'create',
      label: 'repo-shell',
      tags: { '@orchestra-spawner': 'n10', '@other': 'x' },
    });
    const seen = output(handle);
    await until(() => seen.text().includes('ready'));
    const [listed] = catalog.list(TAGS);
    expect(listed).toMatchObject({
      target: { kind: 'mux', hostId: 'host-a', name: 'repo-shell' },
      exited: false,
      path: process.cwd(),
      tags: { '@orchestra-spawner': 'n10' },
    });
    expect(handle.target).toEqual(listed.target);
    expect(catalog.snapshot(listed.target)?.pid).toBe(handle.pid);
  });

  it('gives a second session with the same label the next free one', async () => {
    catalog = new ManagedCatalog('host-a');
    const plan = { mode: 'create', label: 'repo-shell', tags: {} } as const;
    await catalog.open(spec('exec sleep 30'), plan);
    await catalog.open(spec('exec sleep 30'), {
      ...plan,
      excludedNames: ['repo-shell-2'],
    });
    // Two records created within a second list in session-ID order.
    expect(
      catalog
        .list([])
        .map((s) => s.target.name)
        .sort()
    ).toEqual(['repo-shell', 'repo-shell-3']);
  });

  it('keeps a session running after its handle is released, and replays it to the next', async () => {
    catalog = new ManagedCatalog('host-a');
    const first = await catalog.open(spec('echo first-frame; exec sleep 30'), {
      mode: 'create',
      label: 'agent',
      tags: {},
    });
    const seen = output(first);
    await until(() => seen.text().includes('first-frame'));
    first.dispose();
    const [listed] = catalog.list([]);
    expect(listed.exited).toBe(false);
    const second = await catalog.open(spec(''), {
      mode: 'attach',
      target: listed.target,
    });
    const replayed = output(second);
    await until(() => replayed.text().includes('first-frame'));
  });

  it('retains an exited agent for restart in a new generation', async () => {
    catalog = new ManagedCatalog('host-a');
    const handle = await catalog.open(spec('exit 3'), {
      mode: 'create',
      label: 'agent',
      tags: { '@orchestra-agent': 'codex' },
      retainOnExit: true,
    });
    let code: number | undefined;
    handle.onExit((exitCode) => (code = exitCode));
    await until(() => code !== undefined);
    const [listed] = catalog.list(TAGS);
    expect(listed).toMatchObject({ exited: true, exitCode: 3 });
    expect(handle.processState).toMatchObject({ running: false, exitCode: 3 });
    const before = catalog.snapshot(listed.target)!.incarnation;
    const restarted = await catalog.open(spec('exec sleep 30'), {
      mode: 'restart',
      target: listed.target,
      tags: { '@orchestra-agent': 'claude' },
      retainOnExit: true,
    });
    expect(restarted.processState?.running).toBe(true);
    const after = catalog.snapshot(listed.target, TAGS)!;
    expect(after.tags['@orchestra-agent']).toBe('claude');
    expect((after.incarnation as ManagedIncarnation).generation).toBe(
      (before as ManagedIncarnation).generation + 1
    );
  });

  it('never restarts a running session', async () => {
    catalog = new ManagedCatalog('host-a');
    const handle = await catalog.open(spec('exec sleep 30'), {
      mode: 'create',
      label: 'agent',
      tags: {},
      retainOnExit: true,
    });
    await expect(
      catalog.open(spec('exec sleep 30'), {
        mode: 'restart',
        target: handle.target!,
      })
    ).rejects.toThrow('Cannot restart a running session');
  });

  it('replaces a live process only for the generation it was approved for', async () => {
    catalog = new ManagedCatalog('host-a');
    const handle = await catalog.open(spec('exec sleep 30'), {
      mode: 'create',
      label: 'agent',
      tags: { '@orchestra-agent': 'codex' },
      retainOnExit: true,
    });
    const target = handle.target!;
    const approved = catalog.snapshot(target)!.incarnation;
    const stale = { ...approved, generation: 0 } as ManagedIncarnation;
    await expect(
      catalog.open(spec('exec sleep 30'), {
        mode: 'replace',
        target,
        expected: stale,
      })
    ).rejects.toThrow('Session changed');
    const oldPid = handle.pid;
    const replaced = await catalog.open(spec('exec sleep 30'), {
      mode: 'replace',
      target,
      expected: approved,
      expectedTags: { '@orchestra-agent': 'codex' },
    });
    expect(replaced.pid).not.toBe(oldPid);
    expect(catalog.list([])).toHaveLength(1);
  });

  it('refuses an approval whose identity tags changed since', async () => {
    catalog = new ManagedCatalog('host-a');
    const handle = await catalog.open(spec('exec sleep 30'), {
      mode: 'create',
      label: 'agent',
      tags: { '@orchestra-agent': 'claude' },
      retainOnExit: true,
    });
    const target = handle.target!;
    const approved = catalog.snapshot(target)!.incarnation;
    const pid = handle.pid;
    await expect(
      catalog.open(spec('exec sleep 30'), {
        mode: 'replace',
        target,
        expected: approved,
        expectedTags: { '@orchestra-agent': 'codex' },
      })
    ).rejects.toThrow('Session changed');
    expect(catalog.snapshot(target)!.pid).toBe(pid);
  });

  it('replaces an exited agent it was approved for, as a fresh launch', async () => {
    catalog = new ManagedCatalog('host-a');
    const handle = await catalog.open(spec('exit 0'), {
      mode: 'create',
      label: 'agent',
      tags: {},
      retainOnExit: true,
    });
    let exited = false;
    handle.onExit(() => (exited = true));
    await until(() => exited);
    const target = handle.target!;
    const replaced = await catalog.open(spec('exec sleep 30'), {
      mode: 'replace',
      target,
      expected: catalog.snapshot(target)!.incarnation,
      retainOnExit: true,
    });
    expect(replaced.processState?.running).toBe(true);
  });

  it('removes a shell when it exits, and a killed session at once', async () => {
    catalog = new ManagedCatalog('host-a');
    const shell = await catalog.open(spec('exit 0'), {
      mode: 'create',
      label: 'shell',
      tags: {},
    });
    let exited = false;
    shell.onExit(() => (exited = true));
    await until(() => exited);
    expect(catalog.list([])).toEqual([]);
    expect(shell.processState?.gone).toBe(true);
    const agent = await catalog.open(spec('exec sleep 30'), {
      mode: 'create',
      label: 'agent',
      tags: {},
      retainOnExit: true,
    });
    agent.kill();
    expect(catalog.list([])).toEqual([]);
    expect(agent.processState).toMatchObject({ running: false, gone: true });
  });

  it('answers only for its own host', async () => {
    catalog = new ManagedCatalog('host-a');
    const handle = await catalog.open(spec('exec sleep 30'), {
      mode: 'create',
      label: 'agent',
      tags: {},
    });
    const elsewhere = { ...handle.target!, hostId: 'host-b' } as const;
    expect(catalog.snapshot(elsewhere)).toBeNull();
    catalog.kill(elsewhere);
    expect(catalog.list([])).toHaveLength(1);
  });

  it('tells each process its own session and generation, never an inherited one', async () => {
    catalog = new ManagedCatalog('host-a', '/run/n10');
    const identity =
      'echo "id=$N10_MUX_HOST_ID/$N10_MUX_SESSION_ID/$N10_MUX_GENERATION/$N10_MUX_RUNTIME/${TMUX:-none}"';
    const inherited = {
      ...spec(identity),
      env: {
        PATH: process.env['PATH'] ?? '',
        TMUX: '/tmp/tmux-1/default,1,0',
        N10_MUX_SESSION_ID: 'parent',
      },
    };
    const record = catalog.create(inherited, {
      label: 'agent',
      tags: {},
      retainOnExit: true,
    });
    await until(() => !record.pty.running);
    const first = `id=host-a/${record.sessionId}/1//run/n10/none`;
    expect((await record.screen.capture(0)).text).toContain(first);
    catalog.relaunch(record, inherited, { retainOnExit: true });
    await until(() => !record.pty.running);
    expect((await record.screen.capture(0)).text).toContain(
      `id=host-a/${record.sessionId}/2//run/n10/none`
    );
  });

  it('keeps a screen to capture while nobody watches', async () => {
    catalog = new ManagedCatalog('host-a');
    const record = catalog.create(
      { ...spec('printf "\\033]2;busy\\007ready"; exec sleep 30'), cols: 40 },
      { label: 'agent', tags: {} }
    );
    await until(() => record.screen.title === 'busy');
    const captured = await record.screen.capture(0);
    expect(captured.text).toBe('ready\n');
    expect(captured.seq).toBeGreaterThan(0);
    expect(record.launch).toEqual({ kind: 'unknown' });
  });
});
