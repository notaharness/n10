/**
 * Paths as git writes them in patch headers.
 *
 * A path with a byte git considers unusual — a quote, a backslash, a
 * control character, or (with the default `core.quotePath`) anything
 * outside ASCII — is written as a C string: double-quoted, with
 * backslash escapes and each non-ASCII byte as a three-digit octal
 * escape. `päth.txt` arrives as `"p\303\244th.txt"`, which is the file's
 * UTF-8 bytes, not a name anybody could look up.
 */

const SIMPLE_ESCAPES: Record<string, number> = {
  a: 0x07,
  b: 0x08,
  t: 0x09,
  n: 0x0a,
  v: 0x0b,
  f: 0x0c,
  r: 0x0d,
  '"': 0x22,
  '\\': 0x5c,
};

const utf8 = new TextDecoder('utf-8');
const encoder = new TextEncoder();

/**
 * Read one C-quoted string starting at `start` (the opening quote).
 * Returns the decoded text and the index just past the closing quote,
 * or null when the quoting is malformed.
 */
export function readQuoted(
  text: string,
  start: number
): { value: string; end: number } | null {
  if (text[start] !== '"') return null;
  const bytes: number[] = [];
  let i = start + 1;
  while (i < text.length) {
    const ch = text[i]!;
    if (ch === '"')
      return { value: utf8.decode(new Uint8Array(bytes)), end: i + 1 };
    if (ch !== '\\') {
      // By code point, so a character outside the BMP is not split
      // into two lone surrogates.
      const char = String.fromCodePoint(text.codePointAt(i)!);
      bytes.push(...encoder.encode(char));
      i += char.length;
      continue;
    }
    const next = text[i + 1];
    if (next === undefined) return null;
    const octal = /^[0-7]{3}/.exec(text.slice(i + 1, i + 4));
    if (octal) {
      bytes.push(parseInt(octal[0], 8));
      i += 4;
    } else if (next in SIMPLE_ESCAPES) {
      bytes.push(SIMPLE_ESCAPES[next]!);
      i += 2;
    } else {
      return null;
    }
  }
  return null;
}

/** A path from a header line: C-quoted or bare. */
export function unquoteGitPath(raw: string): string {
  const quoted = readQuoted(raw, 0);
  return quoted && quoted.end === raw.length ? quoted.value : raw;
}

/**
 * The path on a `--- a/x` or `+++ b/x` line, without its side prefix.
 *
 * git appends a tab to the name when it contains a space (a GNU diff
 * convention, so `patch` does not read the rest as a timestamp), and
 * writes `/dev/null` for the side of an added or deleted file.
 */
export function markerPath(rest: string, prefix: 'a/' | 'b/'): string | null {
  const value = unquoteGitPath(rest.endsWith('\t') ? rest.slice(0, -1) : rest);
  if (value === '/dev/null') return null;
  return value.startsWith(prefix) ? value.slice(prefix.length) : value;
}

/**
 * The two paths of a `diff --git a/<old> b/<new>` line.
 *
 * Quoted paths are unambiguous. Bare ones are not: a directory named
 * `x b` makes ` b/` appear inside the path itself. The header is only
 * the last resort — the rename, copy and ---/+++ lines name the paths
 * exactly and override it — and it is only ever needed for a change
 * without those lines, where both sides are the same path, so an
 * ambiguous bare header is split into two equal halves when it can be.
 */
export function headerPaths(
  line: string
): { oldPath: string; newPath: string } | null {
  const rest = line.slice('diff --git '.length);
  const first = rest.startsWith('"')
    ? readQuoted(rest, 0)
    : bareUntilSecond(rest);
  if (!first) return null;
  const tail = rest.slice(first.end).replace(/^ /, '');
  const second = tail.startsWith('"') ? readQuoted(tail, 0)?.value : tail;
  if (second == null) return null;
  const oldPath = first.value.replace(/^a\//, '');
  const newPath = second.replace(/^b\//, '');
  return { oldPath, newPath };
}

/** The bare first path of a header: an exact half when both are equal,
 *  otherwise up to the first ` b/` (or ` "b/` for a quoted second). */
function bareUntilSecond(rest: string): { value: string; end: number } | null {
  const half = (rest.length - 1) / 2;
  if (Number.isInteger(half)) {
    const a = rest.slice(0, half);
    const b = rest.slice(half + 1);
    if (a.startsWith('a/') && b === `b/${a.slice(2)}`) {
      return { value: a, end: half };
    }
  }
  const cut = rest.search(/ "?b\//);
  return cut === -1 ? null : { value: rest.slice(0, cut), end: cut };
}
