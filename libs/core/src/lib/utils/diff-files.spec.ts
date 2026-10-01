import { beforeEach, describe, it, expect, vi } from 'vitest';
import { readDiffFiles } from './diff-files.js';

const output = vi.hoisted(() => ({
  numstat: '',
  status: '',
  truncated: false,
}));
vi.mock('./git-run.js', () => ({
  runGit: (args: string[], opts: { cwd: string }) => {
    if (opts.cwd !== '/repo') throw new Error('Wrong repository');
    if (args[0] !== 'diff' || args[2] !== '-z' || args[3] !== 'target...source')
      throw new Error('Wrong Git comparison');
    return Promise.resolve({
      text: args[1] === '--numstat' ? output.numstat : output.status,
      truncated: output.truncated,
    });
  },
}));
beforeEach(() => {
  output.truncated = false;
});
describe('diff file metadata', () => {
  it('rejects truncated metadata rather than showing an incomplete file list', async () => {
    output.truncated = true;
    await expect(readDiffFiles('/repo', 'source', 'target')).rejects.toThrow(
      'too large to read'
    );
  });
  async function parseWith(numstat: string, status: string) {
    output.numstat = numstat;
    output.status = status;
    return { files: await readDiffFiles('/repo', 'source', 'target') };
  }
  // Both git calls use `-z`, so a record is NUL-terminated and a rename
  // carries its two paths as their own records instead of one combined
  // display string. That removes the whole class of parsing this used to
  // need: git compacts `src/old.ts -> src/new.ts` into
  // `src/{old.ts => new.ts}` for humans, and never does under `-z`.
  it('reads a rename, whose two paths arrive as separate records', async () => {
    const { files } = await parseWith(
      '3\t1\t\0old.ts\0new.ts\0',
      'R096\0old.ts\0new.ts\0'
    );

    expect(files).toHaveLength(1);
    expect(files[0]).toMatchObject({
      filename: 'new.ts',
      previousFilename: 'old.ts',
      status: 'renamed',
      additions: 3,
      deletions: 1,
    });
  });

  // The case that used to report +0 -0: a file moved within its own
  // directory is exactly when git compacts the paths in the human format.
  it('reads a rename that stays inside its own directory', async () => {
    const { files } = await parseWith(
      '3\t1\t\0src/old.ts\0src/new.ts\0',
      'R096\0src/old.ts\0src/new.ts\0'
    );

    expect(files[0]).toMatchObject({
      filename: 'src/new.ts',
      previousFilename: 'src/old.ts',
      additions: 3,
      deletions: 1,
    });
  });

  it('reads a copy the same way as a rename', async () => {
    const { files } = await parseWith(
      '2\t0\t\0a.ts\0b.ts\0',
      'C075\0a.ts\0b.ts\0'
    );

    expect(files[0]).toMatchObject({
      filename: 'b.ts',
      previousFilename: 'a.ts',
      status: 'copied',
      additions: 2,
      deletions: 0,
    });
  });

  // `-z` also turns off path quoting, so a path with a tab in it arrives
  // raw. numstat still separates its counts with tabs, so the path is
  // everything past the second one — and name-status gives it a record of
  // its own, where it cannot be confused with the status letter.
  it('reads a path containing a tab', async () => {
    const { files } = await parseWith(
      '1\t0\tsrc/we\tird.ts\0',
      'M\0src/we\tird.ts\0'
    );

    expect(files).toHaveLength(1);
    expect(files[0]).toMatchObject({
      filename: 'src/we\tird.ts',
      additions: 1,
      deletions: 0,
    });
  });

  it('reports a binary file as zero changes rather than NaN', async () => {
    // numstat writes "-" for both counts on a binary file, and Number('-')
    // is NaN — which would reach the UI as a blank count.
    const { files } = await parseWith(
      '-\t-\tassets/logo.png\0',
      'M\0assets/logo.png\0'
    );

    expect(files[0]).toMatchObject({
      filename: 'assets/logo.png',
      binary: true,
      additions: 0,
      deletions: 0,
    });
  });

  it('defaults counts to zero when numstat has no entry for the file', async () => {
    const { files } = await parseWith('', 'A\0src/only.ts\0');

    expect(files).toHaveLength(1);
    expect(files[0]).toMatchObject({
      filename: 'src/only.ts',
      status: 'added',
      additions: 0,
      deletions: 0,
      binary: false,
    });
  });

  it('maps each name-status letter to its status', async () => {
    const { files } = await parseWith(
      '1\t0\ta.ts\0' + '0\t1\tb.ts\0' + '1\t1\tc.ts\0' + '1\t1\td.ts\0',
      'A\0a.ts\0' + 'D\0b.ts\0' + 'T\0c.ts\0' + 'M\0d.ts\0'
    );

    expect(files.map((f) => f.status)).toEqual([
      'added',
      'removed',
      'changed',
      'modified',
    ]);
  });
});
