import { createHash } from 'node:crypto';
import { basename } from 'node:path';

// Session labels: what a tmux session is *called*, for a human reading
// `tmux ls`. Never parsed; identity lives in the tags
// (`session-identity.ts`).
//
// The rule both programs implement (Orchestra in bash, pinned as a
// table in Orchestra's tests/test_port.py and in session-label.spec.ts):
// the preferred label is `<basename(repo)>-<branch>` (or `-shell` /
// `-agent`) with every `/`, `.` and `:` replaced by `-`, capped at 200
// characters. On overflow the label is the first 195 characters, `-`,
// and the first four hex digits of the SHA-256 of the *unsanitized*
// `<basename>-<branch>` string — the same "hash what you were given"
// rule the tmux lib's own sanitizer follows for the raw names it caps.

/** Every character tmux refuses in a name, plus `/`, which it accepts
 *  but which reads as a target separator to a human. */
const REPLACED = /[/.:]/g;
const MAX_LABEL = 200;
const HASH_TAIL = 4;

/** `sanitize(x)` from the shared convention, without the cap: the cap
 *  applies to the assembled name, not to each part. */
export function sanitizeLabelPart(part: string): string {
  return part.replace(REPLACED, '-');
}

/** `<basename>-<rest>`, sanitized and capped. */
function sessionLabel(repoRoot: string, rest: string): string {
  const raw = `${basename(repoRoot)}-${rest}`;
  const replaced = sanitizeLabelPart(raw);
  if (replaced.length <= MAX_LABEL) return replaced;
  const hash = createHash('sha256').update(raw).digest('hex');
  return `${replaced.slice(0, MAX_LABEL - HASH_TAIL - 1)}-${hash.slice(
    0,
    HASH_TAIL
  )}`;
}

/** `<repo basename>-<branch>` — e.g. `n10-feature-x`. */
export function worktreeSessionLabel(repoRoot: string, branch: string): string {
  return sessionLabel(repoRoot, branch);
}

/** `<directory basename>-shell` or `<directory basename>-agent`. */
export function terminalSessionLabel(
  directory: string,
  kind: 'shell' | 'agent'
): string {
  return sessionLabel(directory, kind);
}
