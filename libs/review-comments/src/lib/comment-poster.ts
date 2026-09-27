import { spawn } from 'node:child_process';
import { authHeaders, baseUrl } from '@n10/vcs-azure-devops';
import type { ReviewComment } from './types.js';
import {
  formatConventionalComment,
  resolveComment,
  withAgentFooter,
} from './conventional.js';
import { updateComment } from './comment-store.js';

function execWithStdin(
  cmd: string,
  args: string[],
  input: string
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('close', (code) => {
      if (code !== 0) reject(new Error(`${cmd} exited ${code}: ${stderr}`));
      else resolve(stdout);
    });
    child.stdin.write(input);
    child.stdin.end();
  });
}

/**
 * The body a draft is posted with.
 *
 * The severity and the body's own header are settled against each
 * other first (see `resolveComment`), so what a reviewer reads and what
 * every severity-driven surface in n10 shows cannot disagree.
 *
 * The attribution goes at the end, not the front. A comment's opening
 * words are the ones a reviewer sees in a notification and in a
 * collapsed thread, and spending them on provenance buries the finding
 * behind a disclaimer. The claim is still made — where a signature
 * goes.
 */
export function renderCommentBody(comment: ReviewComment): string {
  const { header } = resolveComment(comment.body, comment.severity);
  return withAgentFooter(formatConventionalComment(header));
}

/**
 * A draft with nothing in it cannot be posted.
 *
 * Without this the header is emitted with no subject — `issue
 * (blocking):` and nothing else — which is a comment that says
 * nothing, and which the app's own parser then refuses to read back as
 * a header, so it renders as literal prose. Checked for the whole batch
 * before anything is sent, because a mid-batch failure leaves some
 * comments live and some not.
 */
function assertPostable(comments: ReviewComment[]): void {
  const empty = comments.filter(
    (c) => resolveComment(c.body, c.severity).header.subject.length === 0
  );
  if (empty.length > 0) {
    throw new Error(
      `Cannot post ${empty.length === 1 ? 'a comment' : 'comments'} with an ` +
        `empty body: ${empty.map((c) => c.id).join(', ')}`
    );
  }
}

export interface PostContext {
  vendor: 'github' | 'azure-devops';
  vendorAuth: Record<string, string>;
  vendorProject: Record<string, string>;
  prId: number;
  headSha?: string;
}

export async function postReviewComments(
  comments: ReviewComment[],
  ctx: PostContext,
  event: 'COMMENT' | 'APPROVE' | 'REQUEST_CHANGES' = 'COMMENT'
): Promise<void> {
  assertPostable(comments);
  if (ctx.vendor === 'github') {
    await postGitHub(comments, ctx, event);
  } else if (ctx.vendor === 'azure-devops') {
    await postAzureDevOps(comments, ctx);
  } else {
    throw new Error(`Unsupported vendor: ${ctx.vendor}`);
  }

  // Mark all as posted
  for (const comment of comments) {
    updateComment(ctx.prId, comment.id, { status: 'posted' });
  }
}

async function postGitHub(
  comments: ReviewComment[],
  ctx: PostContext,
  event: 'COMMENT' | 'APPROVE' | 'REQUEST_CHANGES'
): Promise<void> {
  if (!ctx.headSha) {
    throw new Error('headSha is required for GitHub reviews');
  }
  const owner = ctx.vendorProject.owner;
  const repo = ctx.vendorProject.repo;

  const reviewBody = {
    commit_id: ctx.headSha,
    body: 'Review comments from an agent.',
    event,
    comments: comments.map((c) => ({
      path: c.file,
      line: c.lineEnd,
      ...(c.lineStart !== c.lineEnd ? { start_line: c.lineStart } : {}),
      side: c.side,
      body: renderCommentBody(c),
    })),
  };

  const jsonInput = JSON.stringify(reviewBody);
  await execWithStdin(
    'gh',
    ['api', `repos/${owner}/${repo}/pulls/${ctx.prId}/reviews`, '--input', '-'],
    jsonInput
  );
}

async function postAzureDevOps(
  comments: ReviewComment[],
  ctx: PostContext
): Promise<void> {
  const config = {
    org: ctx.vendorProject.org ?? '',
    project: ctx.vendorProject.project ?? '',
    repo: ctx.vendorProject.repo ?? '',
    pat: ctx.vendorAuth.pat ?? '',
  };
  const threadsUrl = `${baseUrl(config)}/pullrequests/${
    ctx.prId
  }/threads?api-version=7.1`;

  for (const comment of comments) {
    const thread = {
      comments: [
        {
          parentCommentId: 0,
          content: renderCommentBody(comment),
          commentType: 1,
        },
      ],
      threadContext: {
        filePath: `/${comment.file}`,
        rightFileStart: {
          line: comment.lineStart,
          offset: 1,
        },
        rightFileEnd: {
          line: comment.lineEnd,
          offset: 1,
        },
      },
      status: 1, // active
    };

    const response = await fetch(threadsUrl, {
      method: 'POST',
      headers: authHeaders(config.pat),
      body: JSON.stringify(thread),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Azure DevOps API ${response.status}: ${text}`);
    }
  }
}
