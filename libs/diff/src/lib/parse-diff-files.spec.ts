import { describe, expect, it } from 'vitest';
import { parseDiffFiles, parseUnifiedDiff } from './diff-parser.js';
import { unquoteGitPath } from './git-path.js';

/**
 * What a file's header says, not only its lines.
 *
 * The patches below are real `git diff -M -C` output (git 2.4x), cut
 * down. A pure rename, a copy, a mode change and a binary change carry
 * no lines at all: the header is the only record that the file changed,
 * and a parser that keeps only lines makes them look unchanged.
 */

function file(patch: string, path: string) {
  const found = parseDiffFiles(patch).find((f) => f.path === path);
  if (!found) throw new Error(`no ${path} in patch`);
  return found;
}

const SPECIAL = `diff --git a/bin.dat b/bin.dat
index bdc955b..8835708 100644
Binary files a/bin.dat and b/bin.dat differ
diff --git a/copysrc.txt b/copied.txt
similarity index 100%
copy from copysrc.txt
copy to copied.txt
diff --git a/deleted.txt b/deleted.txt
deleted file mode 100644
index 3367afd..0000000
--- a/deleted.txt
+++ /dev/null
@@ -1 +0,0 @@
-old
diff --git a/link b/link
index 12a8d8a..3b7781e 120000
--- a/link
+++ b/link
@@ -1 +1 @@
-target1
\\ No newline at end of file
+target2
\\ No newline at end of file
diff --git a/mode.sh b/mode.sh
old mode 100644
new mode 100755
diff --git a/nonl.txt b/nonl.txt
index 587be6b..c1b0730 100644
--- a/nonl.txt
+++ b/nonl.txt
@@ -1 +1 @@
-x
+x
\\ No newline at end of file
diff --git "a/p\\303\\244th.txt" "b/p\\303\\244th.txt"
new file mode 100644
index 0000000..90d2ee6
--- /dev/null
+++ "b/p\\303\\244th.txt"
@@ -0,0 +1 @@
+uni
diff --git a/renamed-edit.txt b/renamed2.txt
similarity index 94%
rename from renamed-edit.txt
rename to renamed2.txt
index e8823e1..a86ab4f 100644
--- a/renamed-edit.txt
+++ b/renamed2.txt
@@ -4,3 +4,3 @@
 4
-5
+five
 6
diff --git a/moved.txt b/sub dir/moved.txt
similarity index 100%
rename from moved.txt
rename to sub dir/moved.txt
diff --git "a/tab\\tname.txt" "b/tab\\tname.txt"
new file mode 100644
index 0000000..3e75765
--- /dev/null
+++ "b/tab\\tname.txt"
@@ -0,0 +1 @@
+new
`;

describe('parseDiffFiles: file metadata', () => {
  it('keeps a pure rename, with both paths and no lines', () => {
    expect(file(SPECIAL, 'sub dir/moved.txt')).toEqual({
      path: 'sub dir/moved.txt',
      oldPath: 'moved.txt',
      status: 'renamed',
      similarity: 100,
      binary: false,
      lines: [],
    });
  });

  it('keeps the edit of a renamed file under its new path', () => {
    const f = file(SPECIAL, 'renamed2.txt');
    expect(f).toMatchObject({
      oldPath: 'renamed-edit.txt',
      status: 'renamed',
      similarity: 94,
    });
    expect(f.lines.filter((l) => l.type === 'add')).toEqual([
      { type: 'add', content: 'five', newLine: 5 },
    ]);
  });

  it('keeps a copy, with its source', () => {
    expect(file(SPECIAL, 'copied.txt')).toMatchObject({
      oldPath: 'copysrc.txt',
      status: 'copied',
      similarity: 100,
      lines: [],
    });
  });

  it('marks a binary change, which has no lines to show', () => {
    expect(file(SPECIAL, 'bin.dat')).toMatchObject({
      status: 'modified',
      binary: true,
      lines: [],
    });
  });

  it('keeps a mode-only change', () => {
    expect(file(SPECIAL, 'mode.sh')).toMatchObject({
      status: 'modified',
      oldMode: '100644',
      newMode: '100755',
      lines: [],
    });
  });

  it('reads a symlink mode from the index line', () => {
    expect(file(SPECIAL, 'link')).toMatchObject({
      oldMode: '120000',
      newMode: '120000',
    });
  });

  it('files a deleted file under its old path, with only an old mode', () => {
    const f = file(SPECIAL, 'deleted.txt');
    expect(f).toMatchObject({
      oldPath: 'deleted.txt',
      status: 'deleted',
      oldMode: '100644',
    });
    expect(f.newMode).toBeUndefined();
    expect(f.lines[1]).toEqual({ type: 'remove', content: 'old', oldLine: 1 });
  });

  it('decodes quoted paths: non-ASCII bytes and escaped tabs', () => {
    expect(file(SPECIAL, 'päth.txt')).toMatchObject({ status: 'added' });
    expect(file(SPECIAL, 'tab\tname.txt').newMode).toBe('100644');
  });

  it('lists every file in patch order', () => {
    expect(parseDiffFiles(SPECIAL).map((f) => f.path)).toEqual([
      'bin.dat',
      'copied.txt',
      'deleted.txt',
      'link',
      'mode.sh',
      'nonl.txt',
      'päth.txt',
      'renamed2.txt',
      'sub dir/moved.txt',
      'tab\tname.txt',
    ]);
  });
});

describe('parseDiffFiles: type changes', () => {
  // A file replaced by a symlink to it, as `git diff` writes it.
  const TYPE_CHANGE = `diff --git a/conf b/conf
deleted file mode 100644
index 1111111..0000000
--- a/conf
+++ /dev/null
@@ -1,2 +0,0 @@
-key=value
-other=1
diff --git a/conf b/conf
new file mode 120000
index 0000000..2222222
--- /dev/null
+++ b/conf
@@ -0,0 +1 @@
+conf.real
\\ No newline at end of file
`;

  it('reads the two sections of one path as one type change', () => {
    const files = parseDiffFiles(TYPE_CHANGE);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatchObject({
      path: 'conf',
      status: 'type-changed',
      oldMode: '100644',
      newMode: '120000',
    });
    // The removed lines survive, before the added target.
    expect(files[0]!.lines.filter((l) => l.type !== 'hunk-header')).toEqual([
      { type: 'remove', content: 'key=value', oldLine: 1 },
      { type: 'remove', content: 'other=1', oldLine: 2 },
      { type: 'add', content: 'conf.real', newLine: 1, noNewline: true },
    ]);
  });

  it('keeps a deleted file and an unrelated added one apart', () => {
    const files = parseDiffFiles(`diff --git a/old b/old
deleted file mode 100644
--- a/old
+++ /dev/null
@@ -1 +0,0 @@
-x
diff --git a/new b/new
new file mode 100644
--- /dev/null
+++ b/new
@@ -0,0 +1 @@
+y
`);
    expect(files.map((f) => [f.path, f.status])).toEqual([
      ['old', 'deleted'],
      ['new', 'added'],
    ]);
  });
});

describe('parseDiffFiles: missing final newline', () => {
  it('marks the line the marker follows, on its own side', () => {
    const lines = file(SPECIAL, 'nonl.txt').lines;
    // The only change is the newline: without the mark the two rows
    // read as the same line removed and added back.
    expect(lines.slice(1)).toEqual([
      { type: 'remove', content: 'x', oldLine: 1 },
      { type: 'add', content: 'x', newLine: 1, noNewline: true },
    ]);
  });

  it('marks both sides when neither ends in a newline', () => {
    const lines = file(SPECIAL, 'link').lines;
    expect(lines.filter((l) => l.noNewline).map((l) => l.type)).toEqual([
      'remove',
      'add',
    ]);
  });
});

describe('parseDiffFiles: hunk bodies read by count', () => {
  it('keeps an added line that reads like a +++ header', () => {
    // The file's own text is "++ plus"; the diff writes it "+++ plus".
    const lines = parseUnifiedDiff(`diff --git a/q.sql b/q.sql
new file mode 100644
index 0000000..f4f8630
--- /dev/null
+++ b/q.sql
@@ -0,0 +1,2 @@
+keep
+++ plus
`).get('q.sql')!;
    expect(lines.slice(1)).toEqual([
      { type: 'add', content: 'keep', newLine: 1 },
      { type: 'add', content: '++ plus', newLine: 2 },
    ]);
  });

  it('keeps a removed line that reads like a --- header', () => {
    // A removed SQL comment, "-- sql". Dropping it shifts every old
    // line number after it by one.
    const lines = parseUnifiedDiff(`diff --git a/q.sql b/q.sql
index 1111111..2222222 100644
--- a/q.sql
+++ b/q.sql
@@ -1,3 +1,2 @@
--- sql
 keep
 last
`).get('q.sql')!;
    expect(lines.slice(1)).toEqual([
      { type: 'remove', content: '-- sql', oldLine: 1 },
      { type: 'context', content: 'keep', oldLine: 2, newLine: 1 },
      { type: 'context', content: 'last', oldLine: 3, newLine: 2 },
    ]);
  });

  it('keys a path whose directory contains " b/" correctly', () => {
    const files = parseUnifiedDiff(`diff --git a/x b/y b.txt b/x b/y b.txt
new file mode 100644
index 0000000..7cc3903
--- /dev/null
+++ b/x b/y b.txt\t
@@ -0,0 +1 @@
+hi
`);
    expect([...files.keys()]).toEqual(['x b/y b.txt']);
  });

  it('takes a pure rename’s paths from its rename lines, not the header', () => {
    // No ---/+++ lines, and a header that splits at the wrong " b/".
    const [f] = parseDiffFiles(`diff --git a/x b/old.txt b/x b/new.txt
similarity index 100%
rename from x b/old.txt
rename to x b/new.txt
`);
    expect(f).toMatchObject({
      path: 'x b/new.txt',
      oldPath: 'x b/old.txt',
      status: 'renamed',
    });
  });

  it('splits an ambiguous bare header in half when nothing else names it', () => {
    // A mode-only change has no ---/+++ lines: the header is all there is.
    const [f] = parseDiffFiles(`diff --git a/x b/run.sh b/x b/run.sh
old mode 100644
new mode 100755
`);
    expect(f).toMatchObject({ path: 'x b/run.sh', oldPath: 'x b/run.sh' });
  });

  it('reads a hunk whose header does not parse up to the next file', () => {
    const files = parseDiffFiles(`diff --git a/x b/x
@@ garbage @@
+kept
diff --git a/y b/y
@@ -1 +1 @@
-a
+b
`);
    expect(files.map((f) => [f.path, f.lines.length])).toEqual([
      ['x', 2],
      ['y', 3],
    ]);
  });
});

describe('unquoteGitPath', () => {
  it('leaves a bare path alone', () => {
    expect(unquoteGitPath('src/a b.ts')).toBe('src/a b.ts');
  });

  it('decodes escaped quotes and backslashes', () => {
    expect(unquoteGitPath('"quote\\"d\\\\.txt"')).toBe('quote"d\\.txt');
  });

  it('decodes a multi-byte character outside the BMP', () => {
    // 😀 is F0 9F 98 80 in UTF-8.
    expect(unquoteGitPath('"\\360\\237\\230\\200.txt"')).toBe('😀.txt');
  });

  it('keeps malformed quoting as written rather than guessing', () => {
    expect(unquoteGitPath('"unterminated')).toBe('"unterminated');
  });
});
