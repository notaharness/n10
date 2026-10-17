import { spawn, spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { hostname, tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest';
import {
  commentDirPath,
  commentFilePath,
  readComments,
  type ReviewComment,
} from '@n10/review-comments';
import {
  appendAgentComment,
  changeAgentComments,
  claimAgentPost,
  isAgentPostClaimed,
} from './agent-comment-store.js';

/**
 * The agent appends through `n10 util add-comment` while the TUI and the
 * desktop edit and post the same findings, each its own process.
 */

const REPO = '/repo/.git';
const PR = 42;

let home: string;
let originalHome: string | undefined;

function comment(id: string, body = `body ${id}`): ReviewComment {
  return {
    id,
    file: 'src/a.ts',
    lineStart: 1,
    lineEnd: 1,
    severity: 'minor',
    body,
    side: 'RIGHT',
    status: 'draft',
    createdAt: '2026-01-01T00:00:00.000Z',
  };
}

const ids = () => readComments(REPO, PR).map((c) => c.id);

beforeEach(() => {
  originalHome = process.env.HOME;
  home = mkdtempSync(join(tmpdir(), 'n10-agent-store-'));
  process.env.HOME = home;
});

afterEach(() => {
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  rmSync(home, { recursive: true, force: true });
});

describe('changeAgentComments', () => {
  it('creates the directory on the first comment', () => {
    appendAgentComment(REPO, PR, comment('first'));
    expect(ids()).toEqual(['first']);
  });

  it('keeps an edit made between two appends', () => {
    appendAgentComment(REPO, PR, comment('one'));
    changeAgentComments(REPO, PR, (cs) =>
      cs.map((c) => ({ ...c, body: 'edited by hand' }))
    );
    appendAgentComment(REPO, PR, comment('two'));
    expect(readComments(REPO, PR).map((c) => c.body)).toEqual([
      'edited by hand',
      'body two',
    ]);
  });

  it('writes nothing when the change throws', () => {
    appendAgentComment(REPO, PR, comment('one'));
    expect(() =>
      changeAgentComments(REPO, PR, () => {
        throw new Error('refused');
      })
    ).toThrow('refused');
    expect(ids()).toEqual(['one']);
  });

  it('leaves only the file behind: no temporary file, no lock', () => {
    appendAgentComment(REPO, PR, comment('one'));
    expect(readdirSync(commentDirPath(REPO, PR))).toEqual(['comments.json']);
    const raw = JSON.parse(readFileSync(commentFilePath(REPO, PR), 'utf8'));
    expect(raw).toMatchObject({ prId: PR, comments: [{ id: 'one' }] });
  });
});

describe('claimAgentPost', () => {
  it('refuses a second post while the first holds the claim', () => {
    const release = claimAgentPost(REPO, PR);
    expect(release).not.toBeNull();
    expect(isAgentPostClaimed(REPO, PR)).toBe(true);
    expect(claimAgentPost(REPO, PR)).toBeNull();
    release?.();
    expect(isAgentPostClaimed(REPO, PR)).toBe(false);
  });
});

describe('across processes', () => {
  let bundleDir: string;
  let worker: string;

  beforeAll(async () => {
    bundleDir = mkdtempSync(join(tmpdir(), 'n10-agent-store-worker-'));
    worker = join(bundleDir, 'worker.mjs');
    const store = fileURLToPath(
      new URL('./agent-comment-store.ts', import.meta.url)
    );
    await build({
      stdin: {
        contents: WORKER.replace('STORE', JSON.stringify(store)),
        resolveDir: bundleDir,
        loader: 'ts',
      },
      outfile: worker,
      bundle: true,
      platform: 'node',
      format: 'esm',
      logLevel: 'silent',
    });
  });

  afterAll(() => {
    rmSync(bundleDir, { recursive: true, force: true });
  });

  /** Each worker waits for `startAt`, so their sections overlap. */
  function run(args: string[]) {
    const child = spawn(process.execPath, [worker, ...args], {
      env: { ...process.env, HOME: home },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    return new Promise<{ code: number | null; stdout: string; stderr: string }>(
      (resolve) =>
        child.on('close', (code) => resolve({ code, stdout, stderr }))
    );
  }

  async function appendFrom(writers: number, each: number) {
    const startAt = String(Date.now() + 500);
    const results = await Promise.all(
      Array.from({ length: writers }, (_, w) =>
        run(['append', REPO, String(PR), `w${w}`, String(each), startAt])
      )
    );
    for (const r of results) expect(r).toMatchObject({ code: 0, stderr: '' });
    const expected = Array.from({ length: writers }, (_, w) =>
      Array.from({ length: each }, (_, i) => `w${w}-${i}`)
    ).flat();
    return { stored: ids().sort(), expected: expected.sort() };
  }

  it('keeps every append when several processes write at once', async () => {
    const { stored, expected } = await appendFrom(4, 40);
    expect(stored).toEqual(expected);
  });

  it('keeps every append after breaking a lock its writer died holding', async () => {
    mkdirSync(commentDirPath(REPO, PR), { recursive: true });
    const dead = spawnSync(
      process.execPath,
      ['-e', 'process.stdout.write(String(process.pid))'],
      { encoding: 'utf8' }
    );
    const lock = `${commentFilePath(REPO, PR)}.lock`;
    writeFileSync(
      lock,
      JSON.stringify({ host: hostname(), pid: Number(dead.stdout), id: 'x' })
    );
    const { stored, expected } = await appendFrom(4, 10);
    expect(stored).toEqual(expected);
    expect(existsSync(lock)).toBe(false);
  });

  it('lets exactly one process claim a post', async () => {
    const startAt = String(Date.now() + 500);
    const results = await Promise.all(
      Array.from({ length: 4 }, () =>
        run(['claim', REPO, String(PR), '', '', startAt])
      )
    );
    for (const r of results) expect(r).toMatchObject({ code: 0, stderr: '' });
    expect(results.map((r) => r.stdout).sort()).toEqual([
      'claimed',
      'refused',
      'refused',
      'refused',
    ]);
    expect(isAgentPostClaimed(REPO, PR)).toBe(false);
  });
});

const WORKER = `
import { appendAgentComment, claimAgentPost } from STORE;
const [mode, repo, pr, name, count, startAt] = process.argv.slice(2);
while (Date.now() < Number(startAt)) await new Promise((r) => setTimeout(r, 1));
if (mode === 'append') {
  for (let i = 0; i < Number(count); i++) {
    appendAgentComment(repo, Number(pr), {
      id: name + '-' + i,
      file: 'a.ts',
      lineStart: 1,
      lineEnd: 1,
      severity: 'minor',
      body: 'b',
      side: 'RIGHT',
      status: 'draft',
      createdAt: '2026-01-01T00:00:00.000Z',
    });
  }
} else {
  const release = claimAgentPost(repo, Number(pr));
  process.stdout.write(release ? 'claimed' : 'refused');
  // Held across awaits, as a post holds it over the network.
  await new Promise((r) => setTimeout(r, 500));
  release?.();
}
`;
