import { rmSync } from 'node:fs';
import { afterAll, describe, it, expect, vi, beforeEach } from 'vitest';
import type { PostContext, ReviewComment } from '@n10/review-comments';
import {
  appendComment,
  draftRepoKey,
  postReviewComments,
} from '@n10/review-comments';

// The poster claims each draft in the store before sending it, and the
// store lives under $HOME, so the drafts go in a scratch one — set
// before the store is imported, since it resolves the path then.
await vi.hoisted(async () => {
  const { mkdtempSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { tmpdir } = await import('node:os');
  process.env.HOME = mkdtempSync(join(tmpdir(), 'n10-cli-poster-'));
});

afterAll(() => {
  // Only ever the scratch HOME made above, never a real one.
  const home = process.env.HOME ?? '';
  if (home.includes('n10-cli-poster-')) rmSync(home, { recursive: true });
});

/** Post a draft that is in the store, as both shells do. */
async function post(comment: ReviewComment, ctx: PostContext) {
  const repo = draftRepoKey(ctx.vendor, ctx.vendorProject);
  if (repo) await appendComment({ repo, prId: ctx.prId }, comment);
  return postReviewComments([comment], ctx);
}

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function makeComment(overrides?: Partial<ReviewComment>): ReviewComment {
  return {
    id: 'c1',
    file: 'src/foo.ts',
    lineStart: 10,
    lineEnd: 12,
    severity: 'major',
    body: 'Fix this',
    side: 'RIGHT',
    status: 'draft',
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('postAzureDevOps via fetch()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('sends correct URL, auth header, and thread body', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve(''),
    });

    const comment = makeComment();
    await post(comment, {
      vendor: 'azure-devops',
      vendorAuth: { pat: 'my-pat' },
      vendorProject: { org: 'myorg', project: 'myproj', repo: 'myrepo' },
      prId: 42,
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    // Naming the request shape here is what makes the assertions below
    // type-checked rather than `any.any.any`.
    const [url, opts] = mockFetch.mock.calls[0] as [
      string,
      { method: string; headers: Record<string, string>; body: string }
    ];
    expect(url).toBe(
      'https://dev.azure.com/myorg/myproj/_apis/git/repositories/myrepo/pullrequests/42/threads?api-version=7.1'
    );
    expect(opts.method).toBe('POST');
    expect(opts.headers['Content-Type']).toBe('application/json');
    expect(opts.headers['Authorization']).toBe(`Basic ${btoa(':my-pat')}`);

    const body = JSON.parse(opts.body);
    // A Conventional Comment (conventionalcomments.org), signed at the
    // end rather than opening with a disclaimer.
    expect(body.comments[0].content).toContain('issue (non-blocking):');
    expect(body.comments[0].content).toContain('by an agent_');
    expect(body.threadContext.filePath).toBe('/src/foo.ts');
    expect(body.threadContext.rightFileStart.line).toBe(10);
    expect(body.threadContext.rightFileEnd.line).toBe(12);
  });

  it('throws on non-ok response', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 401,
      text: () => Promise.resolve('Unauthorized'),
    });

    await expect(
      post(makeComment(), {
        vendor: 'azure-devops',
        vendorAuth: { pat: 'bad' },
        vendorProject: { org: 'o', project: 'p', repo: 'r' },
        prId: 1,
      })
    ).rejects.toThrow('Azure DevOps API 401');
  });
});

describe('postReviewComments vendor guard', () => {
  it('throws for unsupported vendor', async () => {
    await expect(
      postReviewComments([makeComment()], {
        vendor: 'gitlab' as 'github',
        vendorAuth: {},
        vendorProject: {},
        prId: 1,
      })
    ).rejects.toThrow('Unsupported vendor: gitlab');
  });

  it('throws when GitHub is missing headSha', async () => {
    await expect(
      postReviewComments([makeComment()], {
        vendor: 'github',
        vendorAuth: {},
        vendorProject: { owner: 'o', repo: 'r' },
        prId: 1,
      })
    ).rejects.toThrow('headSha is required');
  });
});
