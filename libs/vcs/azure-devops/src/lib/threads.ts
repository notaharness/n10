import { unexpectedResponseError } from '@n10/vcs-core';
import { authHeaders, baseUrl } from './client.js';
import { invalidatePr, toAdoConfig } from './provider.js';
import { adoSend, PROVIDER_NAME } from './request.js';

/** A new thread: its opening comment and the lines it is about. */
export interface NewPullRequestThread {
  content: string;
  /** Relative to the repository root. */
  file: string;
  /** LEFT is the old version of the file: a comment on a removed line. */
  side: 'LEFT' | 'RIGHT';
  lineStart: number;
  lineEnd: number;
}

/**
 * Where a thread sits. A LEFT comment is about a line that exists only
 * on the old side of the diff; anchored on the right it would land on
 * whatever now has its line number, or be refused when nothing does.
 */
function threadContext(thread: NewPullRequestThread) {
  const side = thread.side === 'LEFT' ? 'left' : 'right';
  return {
    filePath: `/${thread.file}`,
    [`${side}FileStart`]: { line: thread.lineStart, offset: 1 },
    [`${side}FileEnd`]: { line: thread.lineEnd, offset: 1 },
  };
}

/**
 * Open a new, active comment thread on a pull request — the draft
 * poster's write in `@n10/review-comments` — and answer its id.
 *
 * Through the transport like every other request, so a sign-in page
 * under a success status, a throttle or an error body is an error, and
 * so is any answer that is not a created thread. The poster marks a
 * draft posted only when this resolves.
 */
export async function createPullRequestThread(
  auth: Record<string, string>,
  project: Record<string, string>,
  prId: number,
  thread: NewPullRequestThread
): Promise<number> {
  const config = toAdoConfig(auth, project);
  const url = `${baseUrl(config)}/pullrequests/${prId}/threads?api-version=7.1`;
  const context = threadContext(thread);
  const created = await adoSend<{ id?: unknown }>(
    'createPullRequestThread',
    url,
    {
      method: 'POST',
      headers: authHeaders(config.pat),
      body: JSON.stringify({
        comments: [
          { parentCommentId: 0, content: thread.content, commentType: 1 },
        ],
        threadContext: context,
        status: 1, // active
      }),
      bodyForLog: { contentLength: thread.content.length, ...context },
    }
  );
  invalidatePr(config, prId);
  if (typeof created?.id !== 'number') {
    throw unexpectedResponseError(PROVIDER_NAME);
  }
  return created.id;
}
