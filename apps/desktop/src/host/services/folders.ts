import { readdir, realpath, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import type { DirectoryListing } from '../contract.js';

/** Visible names first, each group in the user's collation. */
export function sortDirectoryNames(names: string[]): string[] {
  const collate = new Intl.Collator(undefined, { numeric: true }).compare;
  const hidden = (name: string) => name.startsWith('.');
  return [...names].sort(
    (a, b) => Number(hidden(a)) - Number(hidden(b)) || collate(a, b)
  );
}

/**
 * The directories in `path`, or in the home directory for null, for the
 * app's folder browser (`renderer/lib/folder-browser.ts`). The path
 * comes back real, so a folder chosen through a symlink is the
 * repository it names. Entries that are symlinks to directories count;
 * ones that cannot be read are left out.
 */
export async function listDirectory(
  path: string | null
): Promise<DirectoryListing> {
  const real = await realpath(path ?? homedir());
  const entries = await readdir(real, { withFileTypes: true });
  const dirs = await Promise.all(
    entries.map(async (entry) => {
      if (entry.isDirectory()) return entry.name;
      if (!entry.isSymbolicLink()) return null;
      try {
        const target = await stat(join(real, entry.name));
        return target.isDirectory() ? entry.name : null;
      } catch {
        return null;
      }
    })
  );
  const parent = dirname(real);
  return {
    path: real,
    parent: parent === real ? null : parent,
    dirs: sortDirectoryNames(dirs.filter((d): d is string => d !== null)),
  };
}
