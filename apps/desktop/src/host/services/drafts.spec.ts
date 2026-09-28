import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as ReviewCommentsModule from '@n10/review-comments';
import type { DraftScope, ReviewComment } from '@n10/review-comments';

/**
 * Draft posting is the one host path that mutates somebody else's
 * system, and its failure modes are expensive: a batch that dies
 * mid-way must not reset already-live comments back to draft (they
 * would be posted twice on retry), and a review *verdict* must ride
 * exactly one of the posts, or approving a PR with five comments files
 * five approvals.
 */

const state = vi.hoisted(() => ({
  comments: [] as ReviewComment[],
  /** Every scope the store was asked to read or write. */
  scopes: [] as DraftScope[],
  config: {} as Record<string, unknown>,
  posts: [] as { ids: string[]; event: string }[],
  failOn: null as string | null,
}));

vi.mock('./repo.js', () => ({
  requireRepo: () => '/repo',
}));

vi.mock('@n10/vcs-core', () => ({
  readConfig: () => state.config,
}));

vi.mock('@n10/review-comments', async () => {
  const actual = await vi.importActual<typeof ReviewCommentsModule>(
    '@n10/review-comments'
  );
  return {
    // The real ones: settling a body's header against its severity,
    // and which repository a project's drafts belong to, are logic
    // under test here, not collaborators to stub out.
    resolveComment: actual.resolveComment,
    draftRepoKey: actual.draftRepoKey,
    readComments: async (scope: DraftScope) => {
      state.scopes.push(scope);
      return state.comments.map((c) => ({ ...c }));
    },
    updateComment: async (
      scope: DraftScope,
      id: string,
      patch: Partial<ReviewComment>
    ) => {
      state.scopes.push(scope);
      const found = state.comments.find((c) => c.id === id);
      if (!found) return false;
      Object.assign(found, patch);
      return true;
    },
    removeComment: async (scope: DraftScope, id: string) => {
      state.scopes.push(scope);
      const before = state.comments.length;
      state.comments = state.comments.filter((c) => c.id !== id);
      return state.comments.length < before;
    },
    postReviewComments: (
      comments: ReviewComment[],
      _ctx: unknown,
      event: string
    ) => {
      const ids = comments.map((c) => c.id);
      state.posts.push({ ids, event });
      if (state.failOn && ids.includes(state.failOn)) {
        return Promise.reject(new Error('provider said no'));
      }
      for (const c of comments) {
        const found = state.comments.find((x) => x.id === c.id);
        if (found) found.status = 'posted';
      }
      return Promise.resolve(comments);
    },
  };
});

const ReviewComments = await vi.importActual<typeof ReviewCommentsModule>(
  '@n10/review-comments'
);
const {
  deleteDraftComment,
  listDraftComments,
  postDraftComments,
  updateDraftComment,
} = await import('./drafts.js');

function draft(id: string, status: ReviewComment['status'] = 'draft') {
  return { id, status, body: `body ${id}` } as ReviewComment;
}

beforeEach(() => {
  state.comments = [draft('a'), draft('b'), draft('c')];
  state.scopes = [];
  state.config = {
    vendor: 'github',
    vendorAuth: {},
    vendorProject: { owner: 'acme', repo: 'widgets' },
  };
  state.posts = [];
  state.failOn = null;
});

describe('PR id validation', () => {
  // prId becomes a path segment under ~/.n10/reviews, so anything
  // that isn't a positive integer could write outside that directory.
  it.each([
    ['a string', '../../etc'],
    ['a float', 1.5],
    ['zero', 0],
    ['a negative', -3],
    ['null', null],
    ['undefined', undefined],
  ])('rejects %s', async (_label, value) => {
    await expect(listDraftComments(value as number)).rejects.toThrow(
      'Invalid PR id'
    );
    await expect(updateDraftComment(value as number, 'a', {})).rejects.toThrow(
      'Invalid PR id'
    );
    await expect(deleteDraftComment(value as number, 'a')).rejects.toThrow(
      'Invalid PR id'
    );
  });

  it('accepts a positive integer', async () => {
    await expect(listDraftComments(42)).resolves.toEqual(expect.any(Array));
  });
});

describe('the drafts a PR id means', () => {
  const widgets = ReviewComments.draftRepoKey('github', {
    owner: 'acme',
    repo: 'widgets',
  });

  /** Every repository has a #7; the open one decides whose. */
  it('are the open repository’s, for every read and write', async () => {
    await listDraftComments(7);
    await updateDraftComment(7, 'a', { body: 'x' });
    await deleteDraftComment(7, 'b');
    await postDraftComments({ prId: 7, headSha: 'sha' });
    expect(new Set(state.scopes.map((s) => JSON.stringify(s)))).toEqual(
      new Set([JSON.stringify({ repo: widgets, prId: 7 })])
    );
  });

  it('are none when the project names no repository', async () => {
    state.config = { vendor: 'github', vendorAuth: {}, vendorProject: {} };
    expect(await listDraftComments(7)).toEqual([]);
    await expect(updateDraftComment(7, 'a', { body: 'x' })).rejects.toThrow(
      'No repository is configured'
    );
  });
});

describe('editing drafts', () => {
  it('refuses to edit or delete a comment that is already posted', async () => {
    state.comments = [draft('a', 'posted')];
    await expect(updateDraftComment(1, 'a', { body: 'x' })).rejects.toThrow(
      'already posted'
    );
    await expect(deleteDraftComment(1, 'a')).rejects.toThrow('already posted');
  });

  it('refuses to edit a comment mid-post', async () => {
    state.comments = [draft('a', 'posting')];
    await expect(updateDraftComment(1, 'a', { body: 'x' })).rejects.toThrow(
      'being posted'
    );
  });

  it('reports a comment that no longer exists', async () => {
    await expect(updateDraftComment(1, 'gone', { body: 'x' })).rejects.toThrow(
      'no longer exists'
    );
  });
});

describe('postDraftComments', () => {
  it('posts one comment per call so a failure can only cost that one', async () => {
    const posted = await postDraftComments({ prId: 1, headSha: 'sha' });
    expect(posted).toBe(3);
    expect(state.posts.map((p) => p.ids)).toEqual([['a'], ['b'], ['c']]);
  });

  it('sends a verdict with the first post only', async () => {
    await postDraftComments({ prId: 1, headSha: 'sha', event: 'APPROVE' });
    // Repeating the event per comment would file three approvals.
    expect(state.posts.map((p) => p.event)).toEqual([
      'APPROVE',
      'COMMENT',
      'COMMENT',
    ]);
  });

  it('defaults to a plain comment event', async () => {
    await postDraftComments({ prId: 1, headSha: 'sha' });
    expect(new Set(state.posts.map((p) => p.event))).toEqual(
      new Set(['COMMENT'])
    );
  });

  it('posts only the requested ids', async () => {
    await postDraftComments({ prId: 1, headSha: 'sha', ids: ['c'] });
    expect(state.posts.map((p) => p.ids)).toEqual([['c']]);
  });

  it('skips comments that are already posted', async () => {
    state.comments = [draft('a', 'posted'), draft('b')];
    const posted = await postDraftComments({ prId: 1, headSha: 'sha' });
    expect(posted).toBe(1);
    expect(state.posts.map((p) => p.ids)).toEqual([['b']]);
  });

  it('returns zero without calling the provider when nothing is draft', async () => {
    state.comments = [draft('a', 'posted')];
    expect(await postDraftComments({ prId: 1, headSha: 'sha' })).toBe(0);
    expect(state.posts).toEqual([]);
  });

  it('leaves already-posted comments posted when a later one fails', async () => {
    state.failOn = 'b';
    await expect(
      postDraftComments({ prId: 1, headSha: 'sha' })
    ).rejects.toThrow('Posted 1 of 3, then failed: provider said no');

    const byId = Object.fromEntries(
      state.comments.map((c) => [c.id, c.status])
    );
    // 'a' is live on the provider — resetting it to draft would post it
    // a second time on retry. Only the failure goes back to draft.
    expect(byId).toEqual({ a: 'posted', b: 'draft', c: 'draft' });
  });

  it('reports the raw error when the very first post fails', async () => {
    state.failOn = 'a';
    await expect(
      postDraftComments({ prId: 1, headSha: 'sha' })
    ).rejects.toThrow('provider said no');
  });

  it('refuses to post without a configured provider', async () => {
    state.config = {};
    await expect(postDraftComments({ prId: 1 })).rejects.toThrow(
      'No VCS provider configured'
    );
  });

  it('refuses an unsupported provider', async () => {
    state.config = { vendor: 'gitlab' };
    await expect(postDraftComments({ prId: 1 })).rejects.toThrow(
      'Unsupported vendor: gitlab'
    );
  });

  it('requires a head SHA on GitHub, where comments anchor to a commit', async () => {
    await expect(postDraftComments({ prId: 1 })).rejects.toThrow(
      'Missing head SHA'
    );
  });

  it('does not require a head SHA on Azure DevOps', async () => {
    state.config = {
      vendor: 'azure-devops',
      vendorAuth: {},
      vendorProject: { org: 'acme', project: 'p', repo: 'widgets' },
    };
    await expect(postDraftComments({ prId: 1 })).resolves.toBe(3);
  });
});

describe('editing a draft settles its body against its severity', () => {
  /** Both write paths — the agent's `add-comment` and a hand edit here
   *  — have to leave the file in the same shape, or the walkthrough
   *  order, the rail dot and the TUI chip start disagreeing with the
   *  badge the body itself carries. */
  it('raises the severity when the edited body carries a louder header', async () => {
    state.comments = [
      {
        id: 'a',
        status: 'draft',
        body: 'body a',
        severity: 'nit',
      } as ReviewComment,
    ];
    await updateDraftComment(1, 'a', {
      body: 'question (blocking): does this drop writes?',
    });
    expect(state.comments[0].severity).toBe('critical');
  });

  it('will not let an accidental label quieten the declared severity', async () => {
    state.comments = [
      {
        id: 'a',
        status: 'draft',
        body: 'body a',
        severity: 'critical',
      } as ReviewComment,
    ];
    await updateDraftComment(1, 'a', {
      body: 'Note: this drops writes on crash',
    });
    expect(state.comments[0].severity).toBe('critical');
  });

  /** A severity-only edit (the dropdown) must not be second-guessed. */
  it('leaves a patch that does not touch the body alone', async () => {
    state.comments = [
      {
        id: 'a',
        status: 'draft',
        body: 'body a',
        severity: 'nit',
      } as ReviewComment,
    ];
    await updateDraftComment(1, 'a', { severity: 'major' });
    expect(state.comments[0].severity).toBe('major');
  });
});
