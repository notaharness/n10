import { describe, expect, it } from 'vitest';
import { manifestFile, patchSections, sectionsFor } from './patch-manifest.js';

/** A patch as Git prints it: an edit, a new file, a rename, a binary. */
const PATCH = [
  'diff --git a/src/a.ts b/src/a.ts',
  'index 1111111..2222222 100644',
  '--- a/src/a.ts',
  '+++ b/src/a.ts',
  '@@ -1,2 +1,2 @@',
  '-old',
  '+new',
  ' same',
  'diff --git a/src/b.ts b/src/b.ts',
  'new file mode 100644',
  'index 0000000..3333333',
  '--- /dev/null',
  '+++ b/src/b.ts',
  '@@ -0,0 +1,2 @@',
  '+one',
  '+two',
  'diff --git a/old.md b/docs/new.md',
  'similarity index 100%',
  'rename from old.md',
  'rename to docs/new.md',
  'diff --git a/logo.png b/logo.png',
  'index 4444444..5555555 100644',
  'Binary files a/logo.png and b/logo.png differ',
  '',
].join('\n');

describe('the demo manifest read off a patch', () => {
  const files = patchSections(PATCH).map(manifestFile);

  it('lists each file with its change and counts', () => {
    expect(
      files.map((f) => [f.path, f.status, f.additions, f.deletions])
    ).toEqual([
      ['src/a.ts', 'modified', 1, 1],
      ['src/b.ts', 'added', 2, 0],
      ['docs/new.md', 'renamed', 0, 0],
      ['logo.png', 'modified', null, null],
    ]);
  });

  it('keeps what the headers say: paths, modes, blobs, kind', () => {
    expect(files[1]).toMatchObject({
      oldMode: null,
      newMode: '100644',
      oldOid: null,
    });
    expect(files[2]).toMatchObject({ oldPath: 'old.md', similarity: 100 });
    expect(files[3]!.kind).toBe('binary');
    // Sizes from the lines shown, and none for a side with no blob.
    expect([files[1]!.oldSize, files[1]!.newSize]).toEqual([null, 8]);
  });

  it('reads the sections for the paths asked for, a rename by either', () => {
    expect(sectionsFor(PATCH, ['old.md'])).toContain('rename to docs/new.md');
    expect(sectionsFor(PATCH, ['src/b.ts'])).not.toContain('src/a.ts');
  });
});
