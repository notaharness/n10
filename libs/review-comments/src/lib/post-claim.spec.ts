import { spawn } from 'node:child_process';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { PostContext } from './comment-poster.js';
import { draftRepoKey } from './comment-store.js';
import type { ReviewComment } from './types.js';

/**
 * Two shells posting the same draft at once — the TUI and the desktop,
 * or two desktop windows — each as its own process, against a fake `gh`
 * that counts the reviews it is asked to file and takes long enough for
 * the two posts to overlap.
 */

const CTX: PostContext = {
  vendor: 'github',
  vendorAuth: {},
  vendorProject: { owner: 'acme', repo: 'widgets' },
  prId: 7,
  headSha: 'abc123',
};

const DRAFT: ReviewComment = {
  id: 'd1',
  file: 'src/a.ts',
  lineStart: 1,
  lineEnd: 1,
  severity: 'minor',
  body: 'This leaks a handle.',
  side: 'RIGHT',
  status: 'draft',
  createdAt: '2026-01-01T00:00:00.000Z',
};

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'n10-post-claim-'));
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

/** A `gh` that logs each call and holds it open for 500ms. */
function installFakeGh(): string {
  const bin = join(home, 'bin');
  mkdirSync(bin);
  const gh = join(bin, 'gh');
  writeFileSync(
    gh,
    `#!/bin/sh\ncat > /dev/null\necho "$*" >> "${join(
      home,
      'gh-calls'
    )}"\nsleep 0.5\necho '{}'\n`
  );
  chmodSync(gh, 0o755);
  return bin;
}

async function bundle(): Promise<string> {
  const outfile = join(home, 'poster.mjs');
  await build({
    entryPoints: [
      fileURLToPath(new URL('./comment-poster.ts', import.meta.url)),
    ],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'esm',
    logLevel: 'silent',
  });
  return outfile;
}

/** One shell: post the draft, and print how many it posted. */
function poster(entry: string, bin: string) {
  const code = `
    const { postReviewComments } = await import(${JSON.stringify(entry)});
    const posted = await postReviewComments(
      [${JSON.stringify(DRAFT)}],
      ${JSON.stringify(CTX)}
    );
    process.stdout.write(String(posted.length));
  `;
  const child = spawn(process.execPath, ['--input-type=module', '-e', code], {
    env: { ...process.env, HOME: home, PATH: `${bin}:${process.env.PATH}` },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (d) => (stdout += d));
  child.stderr.on('data', (d) => (stderr += d));
  return new Promise<{ code: number | null; stdout: string; stderr: string }>(
    (resolve) => child.on('close', (code) => resolve({ code, stdout, stderr }))
  );
}

describe('two shells posting the same draft', () => {
  it('files it once: the second sees the claim and skips it', async () => {
    const bin = installFakeGh();
    const entry = await bundle();
    const repo = draftRepoKey(CTX.vendor, CTX.vendorProject)!;
    const dir = join(home, '.n10', 'reviews', repo, `pr-${CTX.prId}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'comments.json'),
      JSON.stringify({ prId: CTX.prId, comments: [DRAFT] })
    );

    const results = await Promise.all([poster(entry, bin), poster(entry, bin)]);

    for (const r of results) expect(r).toMatchObject({ code: 0, stderr: '' });
    expect(results.map((r) => r.stdout).sort()).toEqual(['0', '1']);
    const calls = readFileSync(join(home, 'gh-calls'), 'utf8')
      .trim()
      .split('\n');
    expect(calls).toHaveLength(1);
    const stored = JSON.parse(
      readFileSync(join(dir, 'comments.json'), 'utf8')
    ) as { comments: ReviewComment[] };
    expect(stored.comments).toEqual([{ ...DRAFT, status: 'posted' }]);
  });
});
