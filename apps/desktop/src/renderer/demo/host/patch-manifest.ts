import type {
  PrDiffManifestFile,
  ManifestFileKind,
} from '../../../host/contract.js';

/**
 * A pull request's file list read off its patch, the way the host reads
 * it off Git: each file's paths, change, modes and changed lines. The
 * demo has patches, not a repository, so this stands in for
 * `git diff --raw --numstat`.
 */

/** Each file's section of a patch, in order. */
export function patchSections(patch: string): string[] {
  return patch.split(/^(?=diff --git )/m).filter((s) => s.startsWith('diff'));
}

const ZERO = /^0+$/;
const oid = (id: string | undefined) => (!id || ZERO.test(id) ? null : id);

function kindOf(mode: string | null): ManifestFileKind {
  if (mode === '120000') return 'symlink';
  if (mode === '160000') return 'submodule';
  return 'text';
}

type Header = Omit<PrDiffManifestFile, 'additions' | 'deletions' | 'kind'>;

/** What each header line says about the file, by its prefix. */
const HEADERS: [string, (file: Header, value: string) => void][] = [
  [
    'new file mode ',
    (f, v) => Object.assign(f, { status: 'added', newMode: v }),
  ],
  [
    'deleted file mode ',
    (f, v) => Object.assign(f, { status: 'deleted', oldMode: v }),
  ],
  ['old mode ', (f, v) => (f.oldMode = v)],
  ['new mode ', (f, v) => (f.newMode = v)],
  ['similarity index ', (f, v) => (f.similarity = Number.parseInt(v, 10))],
  ['rename from ', (f) => (f.status = 'renamed')],
  ['copy from ', (f) => (f.status = 'copied')],
  [
    'index ',
    (f, v) => {
      const [, from, to] = /^(\w+)\.\.(\w+)/.exec(v) ?? [];
      Object.assign(f, { oldOid: oid(from), newOid: oid(to) });
    },
  ],
];

function applyLine(file: Header, line: string): void {
  for (const [prefix, apply] of HEADERS) {
    if (line.startsWith(prefix)) {
      apply(file, line.slice(prefix.length));
      return;
    }
  }
}

/** A mode on the `index` line holds on both sides. */
function indexMode(file: Header, lines: readonly string[]): void {
  const line = lines.find((l) => l.startsWith('index '));
  const [, mode] = /^index \S+ (\d+)$/.exec(line ?? '') ?? [];
  if (mode) Object.assign(file, { oldMode: mode, newMode: mode });
}

/** One file of the manifest, from its section of the patch. */
export function manifestFile(section: string): PrDiffManifestFile {
  const lines = section.split('\n');
  const [, oldPath = '', newPath = ''] =
    /^diff --git a\/(.+) b\/(.+)$/.exec(lines[0] ?? '') ?? [];
  const file: Header = {
    path: newPath,
    oldPath,
    status: 'modified',
    similarity: null,
    oldMode: null,
    newMode: null,
    oldOid: null,
    newOid: null,
  };
  let body = lines.findIndex((l) => l.startsWith('@@'));
  if (body < 0) body = lines.length;
  const header = lines.slice(1, body);
  indexMode(file, header);
  for (const line of header) applyLine(file, line);
  if (file.status === 'deleted') file.path = oldPath;
  const binary = lines.some((l) => /^Binary files .* differ$/.test(l));
  const changed = lines.slice(body);
  const count = (sign: string) =>
    binary ? null : changed.filter((l) => l.startsWith(sign)).length;
  return {
    ...file,
    kind: binary ? 'binary' : kindOf(file.newMode ?? file.oldMode),
    additions: count('+'),
    deletions: count('-'),
  };
}

/** The sections of `patch` for these paths — a rename by either. */
export function sectionsFor(patch: string, paths?: readonly string[]): string {
  const sections = patchSections(patch);
  if (!paths) return sections.join('');
  const wanted = new Set(paths);
  return sections
    .filter((s) => {
      const f = manifestFile(s);
      return wanted.has(f.path) || wanted.has(f.oldPath);
    })
    .join('');
}
