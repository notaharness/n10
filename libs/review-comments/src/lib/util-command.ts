import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { DiffLine } from '@n10/diff';
import {
  anchorOutsideDiff,
  readAnchor,
  type CommentAnchor,
} from './comment-anchor.js';
import { validateGuide } from './guide.js';
import { guideInstructions } from './guide-instructions.js';
import { writeGuide } from './guide-store.js';
import { resolveComment } from './conventional.js';
import type { CommentSeverity, ReviewComment } from './types.js';

const VALID_SEVERITIES = new Set<CommentSeverity>([
  'critical',
  'major',
  'minor',
  'nit',
]);

const ADD_COMMENT_USAGE =
  'Usage: n10 util add-comment --pr=<id> --severity=<critical|major|minor|nit> --body=<text> ' +
  '[--base=<target branch> --file=<path> [--lineStart=<n> [--lineEnd=<n>] [--side=LEFT|RIGHT]]] [--thread=<id>]';

export function parseArgs(args: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const arg of args) {
    const match = arg.match(/^--(\w+)=(.+)$/s);
    if (match) {
      let value = match[2];
      // Strip surrounding quotes
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      result[match[1]] = value;
    }
  }
  return result;
}

function fail(...lines: string[]): never {
  for (const line of lines) console.error(line);
  process.exit(1);
}

function readRequired(parsed: Record<string, string>) {
  const missing = ['pr', 'severity', 'body'].filter((field) => !parsed[field]);
  if (missing.length > 0)
    fail(`Missing required fields: ${missing.join(', ')}`, ADD_COMMENT_USAGE);
  const severity = parsed.severity as CommentSeverity;
  if (!VALID_SEVERITIES.has(severity))
    fail(
      `Invalid severity "${parsed.severity}". Must be: critical, major, minor, nit`
    );
  const prId = parseInt(parsed.pr, 10);
  if (isNaN(prId)) fail('--pr must be a number');
  return { prId, severity };
}

/**
 * The anchor, checked against the pull request's diff at the commit
 * checked out here, and that commit: the line numbers belong to it.
 * Nothing is stored when the diff cannot take the comment.
 */
function placeComment(
  parsed: Record<string, string>,
  context: UtilContext
): { anchor: CommentAnchor; head: string | undefined } {
  const read = readAnchor(parsed);
  if (!read.ok) fail(read.error, ADD_COMMENT_USAGE);
  const { anchor } = read;
  if (anchor.file === null) return { anchor, head: context.head?.() };
  if (!parsed.base)
    fail(
      '--file needs --base=<branch the pull request merges into>, e.g. --base=main.',
      'Leave out --file to comment on the pull request itself.'
    );
  if (!context.diff) fail('This n10 cannot read the pull request diff.');
  const diff = context.diff(parsed.base, anchor.file);
  if (!diff.ok) fail(diff.error);
  const at = `the diff of ${parsed.base}...HEAD at ${diff.head.slice(0, 7)}`;
  const outside = anchorOutsideDiff(
    { ...anchor, file: anchor.file },
    diff.lines,
    at
  );
  if (outside) fail(outside);
  return { anchor, head: diff.head };
}

function handleAddComment(args: string[], context: UtilContext): void {
  const parsed = parseArgs(args);
  const { prId, severity } = readRequired(parsed);
  const { anchor, head } = placeComment(parsed, context);

  const comment: ReviewComment = {
    id: randomUUID(),
    ...anchor,
    // A body that opens with its own Conventional Comments header is
    // stating a severity too, and the two must not be able to
    // disagree — the louder wins. Settled once, here, so everything
    // that reads the stored draft (the walkthrough order, the rail
    // dot, the TUI chip, the posted body) says the same thing.
    severity: resolveComment(parsed.body, severity).severity,
    body: parsed.body,
    status: 'draft',
    createdAt: new Date().toISOString(),
    ...(head ? { head } : {}),
    // Optional: the provider's id for the review thread this draft
    // answers. Recorded so the reader (and a later agent reading the
    // plan) can see which conversation the draft is about; posting
    // still opens a new thread at the draft's own anchor.
    ...(parsed.thread ? { threadId: parsed.thread } : {}),
  };

  context.appendComment(prId, comment);
  console.log(comment.id);
}

/** The pull request's diff of one file, as the checkout here has it. */
export type CommentDiff =
  | {
      ok: true;
      /** The commit the diff was read at: the one checked out. */
      head: string;
      /** The file's lines in the diff; null when it is not changed. */
      lines: DiffLine[] | null;
    }
  | { ok: false; error: string };

/** What the caller supplies the command: the store it writes to, and
 *  what the agent's checkout tells it, read only when needed. */
export interface UtilContext {
  /** Stores a new draft; the caller owns the store and its locking. */
  appendComment: (prId: number, comment: ReviewComment) => void;
  /** The commit checked out where the command runs. */
  head?: () => string | undefined;
  /** `file`'s diff from where HEAD branched off `base` to HEAD. */
  diff?: (base: string, file: string) => CommentDiff;
}

function readGuideFile(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    console.error(
      `Could not read ${path} as JSON: ${(error as Error).message}`
    );
    process.exit(1);
  }
}

function handleAddGuide(
  args: string[],
  repository: string,
  context: UtilContext
): void {
  const parsed = parseArgs(args);
  const prId = parseInt(parsed.pr ?? '', 10);
  if (isNaN(prId) || !parsed.file) {
    console.error('Usage: n10 util add-guide --pr=<id> --file=<path to JSON>');
    console.error('Run `n10 util guide-help` for the format.');
    process.exit(1);
  }
  const checked = validateGuide(readGuideFile(parsed.file));
  if (!checked.ok) {
    console.error('The guide was not stored. Fix these and run it again:');
    for (const issue of checked.issues) console.error(`- ${issue}`);
    process.exit(1);
  }
  const stored = writeGuide(repository, prId, checked.guide, context.head?.());
  console.log(`Stored the guide for #${prId}: ${stored.slides.length} slides.`);
}

export async function handleUtilCommand(
  args: string[],
  repository: string,
  context: UtilContext
): Promise<void> {
  const subcommand = args[0];

  if (subcommand === 'add-comment') {
    handleAddComment(args.slice(1), context);
    return;
  }
  if (subcommand === 'add-guide') {
    handleAddGuide(args.slice(1), repository, context);
    return;
  }
  if (subcommand === 'guide-help') {
    console.log(guideInstructions(parseArgs(args.slice(1)).pr));
    return;
  }

  console.error(`Unknown util subcommand: ${subcommand}`);
  console.error('Available subcommands: add-comment, add-guide, guide-help');
  process.exit(1);
}
