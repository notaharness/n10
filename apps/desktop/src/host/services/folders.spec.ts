import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { listDirectory, sortDirectoryNames } from './folders.js';

const made: string[] = [];
afterEach(() => {
  for (const dir of made.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

describe('listDirectory', () => {
  it('lists directories only, through symlinks, from the real path', async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'n10-folders-')));
    made.push(root);
    mkdirSync(join(root, 'repo'));
    mkdirSync(join(root, '.cache'));
    writeFileSync(join(root, 'file.txt'), '');
    let linked = false;
    try {
      symlinkSync(join(root, 'repo'), join(root, 'link'), 'junction');
      linked = true;
    } catch {
      // no symlinks here
    }
    const listing = await listDirectory(join(root, 'repo', '..'));
    expect(listing.path).toBe(root);
    expect(listing.dirs).toEqual(
      linked ? ['link', 'repo', '.cache'] : ['repo', '.cache']
    );
    expect(listing.parent).not.toBeNull();
  });

  it('fails for a path that is not there', async () => {
    await expect(
      listDirectory(join(tmpdir(), 'n10-nope-xyz'))
    ).rejects.toThrow();
  });
});

describe('sortDirectoryNames', () => {
  it('puts hidden folders last and numbers in order', () => {
    expect(sortDirectoryNames(['.git', 'b10', 'b2', 'A'])).toEqual([
      'A',
      'b2',
      'b10',
      '.git',
    ]);
  });
});
