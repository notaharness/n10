/**
 * The fake `gh`'s side of filing a review, as GitHub's GraphQL schema
 * describes it: one pending review per reviewer on a PR, visible only
 * to them (`pr.pendingReview`), filled by thread and reply mutations,
 * and turned into threads, replies and a review summary by the submit.
 *
 * `scenario.loseAnswers` names operations whose write is kept but
 * whose answer never arrives, once each: the publisher must find what
 * it did rather than do it again. `scenario.reviewWrites` counts what
 * reached "GitHub", for a test to assert nothing was sent twice.
 * What GitHub itself refuses (a second pending review, a submit of one
 * not pending) is answered with GraphQL errors and no write.
 */

class Refused extends Error {
  /** `field` is named null beside the error, as in GitHub's own
   *  refusals. */
  constructor(message, field, type = 'UNPROCESSABLE') {
    super(message);
    this.field = field;
    this.type = type;
  }
}

let next = 0;
const newId = (prefix) => `${prefix}_${Date.now()}_${++next}`;

function count(scenario, op) {
  scenario.reviewWrites = scenario.reviewWrites ?? {};
  scenario.reviewWrites[op] = (scenario.reviewWrites[op] ?? 0) + 1;
}

function prOf(prs, vars) {
  return prs.find(
    (p) =>
      String(p.number) === String(vars.number) ||
      `PR_${p.number}` === vars.pr ||
      p.pendingReview?.id === vars.review
  );
}

/** The id of thread `i`'s first comment, which its replies answer. */
function rootOf(pr, i) {
  return pr.threads?.[i]?.comments[0]?.id ?? `thread-${i + 1}-comment-1`;
}

const reads = {
  ReviewPublicationState(prs, vars) {
    const pr = prOf(prs, vars);
    const pending = pr?.pendingReview;
    return {
      repository: {
        pullRequest: pr && {
          id: `PR_${pr.number}`,
          headRefOid: pr.headRefOid ?? 'f'.repeat(40),
          reviews: {
            nodes: pending
              ? [
                  {
                    id: pending.id,
                    comments: { totalCount: pending.comments.length },
                    viewerDidAuthor: true,
                    commit: { oid: pending.commit },
                  },
                ]
              : [],
          },
        },
      },
    };
  },
  ReviewPublicationComments(prs, vars) {
    const pr = prs.find((p) => p.pendingReview?.id === vars.id);
    if (!pr) return { node: null };
    return {
      node: {
        comments: {
          pageInfo: { hasNextPage: false, endCursor: null },
          nodes: pr.pendingReview.comments.map((c) => ({
            id: c.id,
            body: c.body,
            path: c.path,
            line: c.line ?? null,
            startLine: c.startLine ?? null,
            subjectType: c.file ? 'FILE' : 'LINE',
            replyTo: c.replyTo,
          })),
        },
      },
    };
  },
  ReviewPublicationThreadRoot(prs, vars) {
    for (const pr of prs) {
      const i = (pr.threads ?? []).findIndex(
        (x, n) => (x.id ?? `thread-${n + 1}`) === vars.id
      );
      if (i >= 0) {
        return { node: { comments: { nodes: [{ id: rootOf(pr, i) }] } } };
      }
    }
    return { node: null };
  },
  ReviewPublicationById(prs, vars) {
    for (const pr of prs) {
      if (pr.pendingReview?.id === vars.id) {
        return { node: { id: vars.id, state: 'PENDING', body: '' } };
      }
      const done = (pr.reviews ?? []).find((r) => r.id === vars.id);
      if (done) {
        return { node: { id: vars.id, state: done.state, body: done.body } };
      }
    }
    throw new Refused(
      `Could not resolve to a node with the global id of '${vars.id}'`,
      'node',
      'NOT_FOUND'
    );
  },
};

const writes = {
  StartReview(prs, vars, scenario) {
    const pr = prOf(prs, vars);
    if (pr.pendingReview) {
      throw new Refused(
        'User can only have one pending review per pull request',
        'addPullRequestReview'
      );
    }
    const id = newId('PRR');
    pr.pendingReview = {
      id,
      createdAt: new Date().toISOString(),
      commit: vars.commit,
      comments: [],
    };
    count(scenario, 'StartReview');
    return { addPullRequestReview: { pullRequestReview: { id } } };
  },
  AddReviewThread(prs, vars, scenario, query) {
    const pr = prOf(prs, vars);
    const id = newId('PRRC');
    pr.pendingReview.comments.push({
      id,
      body: vars.body,
      path: vars.path,
      replyTo: null,
      line: vars.line ? Number(vars.line) : undefined,
      startLine: vars.startLine ? Number(vars.startLine) : undefined,
      startSide: vars.startSide,
      side: vars.side,
      file: query.includes('subjectType: FILE'),
    });
    count(scenario, 'AddReviewThread');
    return {
      addPullRequestReviewThread: {
        thread: { id: newId('PRRT'), comments: { nodes: [{ id }] } },
      },
    };
  },
  AddReviewReply(prs, vars, scenario) {
    const pr = prOf(prs, vars);
    const id = newId('PRRC');
    const i = (pr.threads ?? []).findIndex(
      (x, n) => (x.id ?? `thread-${n + 1}`) === vars.thread
    );
    pr.pendingReview.comments.push({
      id,
      body: vars.body,
      path: '',
      // The comment replied to, as GitHub's `replyTo` is.
      replyTo: { id: rootOf(pr, i) },
      thread: vars.thread,
    });
    count(scenario, 'AddReviewReply');
    return { addPullRequestReviewThreadReply: { comment: { id } } };
  },
  SubmitReview(prs, vars, scenario) {
    const pr = prOf(prs, vars);
    const author = scenario.username ?? 'n10-tester';
    const pending = pr?.pendingReview;
    if (!pending) {
      throw new Refused('Review is not pending', 'submitPullRequestReview');
    }
    for (const c of pending.comments) {
      if (c.thread) {
        const t = (pr.threads ?? []).find(
          (x, i) => (x.id ?? `thread-${i + 1}`) === c.thread
        );
        t?.comments.push({ author, body: c.body });
      } else {
        pr.threads = [
          ...(pr.threads ?? []),
          {
            path: c.path,
            ...(c.file
              ? {}
              : {
                  line: c.line,
                  startLine: c.startLine,
                  startSide: c.startSide,
                  side: c.side,
                }),
            comments: [{ author, body: c.body }],
          },
        ];
      }
    }
    const state =
      { APPROVE: 'APPROVED', REQUEST_CHANGES: 'CHANGES_REQUESTED' }[
        vars.event
      ] ?? 'COMMENTED';
    pr.reviews = [
      ...(pr.reviews ?? []),
      {
        id: pending.id,
        author,
        state,
        body: vars.body,
        commentCount: pending.comments.length,
        commit: pending.commit,
        submittedAt: new Date().toISOString(),
      },
    ];
    pr.pendingReview = undefined;
    count(scenario, 'SubmitReview');
    return {
      submitPullRequestReview: { pullRequestReview: { id: pending.id, state } },
    };
  },
};

/**
 * The answer to a review publication query or mutation, or null when
 * `query` is none of them. `lost` is set when the write was kept but
 * its answer must be dropped; `errors` when GitHub would refuse it.
 */
export function reviewGraphql(query, vars, prs, scenario) {
  const op = /(?:query|mutation) (\w+)\(/.exec(query)?.[1];
  const run = reads[op] ?? writes[op];
  if (!run) return null;
  let data;
  try {
    data = run(prs, vars, scenario, query);
  } catch (err) {
    if (!(err instanceof Refused)) throw err;
    return {
      data: { [err.field]: null },
      errors: [{ type: err.type, message: err.message }],
    };
  }
  if (reads[op]) return { data };
  const lose = scenario.loseAnswers ?? [];
  const lost = lose.includes(op);
  if (lost) scenario.loseAnswers = lose.filter((x) => x !== op);
  return { data, lost, wrote: true };
}
