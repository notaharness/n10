#!/usr/bin/env node
/**
 * A stand-in for the `gh` CLI, so the pull-request half of the app can
 * be driven offline.
 *
 * The GitHub provider reaches GitHub only by running `gh` (see
 * libs/vcs/github/src/lib/provider.ts — every call is `execFile('gh',
 * …)`), which means putting this on PATH ahead of the real one hands
 * the app a whole pull request, its review threads and its description
 * without a network, a token, or a change to a line of production
 * code. Before it existed, everything downstream of a PR — the review
 * workspace, the diff, comment threads, drafts, and now the plan — was
 * reachable only from the @integration suite, which needs a token and
 * therefore does not run on most pull requests.
 *
 * The scenario is a JSON file named by N10_FAKE_GH; its shape is
 * documented in setup/fake-gh.ts. Anything not in it answers with an
 * empty result rather than failing, so a test declares only what it
 * cares about.
 */
import { readFileSync, writeFileSync, writeSync } from 'node:fs';

const scenarioPath = process.env.N10_FAKE_GH;
const scenario = JSON.parse(readFileSync(scenarioPath, 'utf8'));

/**
 * Optional stand-in for the round trip to GitHub (N10_FAKE_GH_LATENCY_MS).
 *
 * Off by default, so the e2e suite stays as fast as it was. The perf
 * suite turns it on: a provider that answers instantly hides the thing
 * worth measuring, which is what the app does with the window while it
 * waits. Blocking rather than deferring, because `gh` is a subprocess
 * the app waits on — a real slow call blocks nothing else in *this*
 * process either.
 */
const latency = Number(process.env.N10_FAKE_GH_LATENCY_MS ?? 0);
if (latency > 0) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, latency);
}

/**
 * Persist the scenario back to disk.
 *
 * Mutations have to stick, or the app's refetch immediately undoes what
 * the user just did: a reply vanishes and a resolved thread comes back
 * open. Each `gh` invocation is its own process, so the file is the
 * only place that state can live.
 */
function save() {
  writeFileSync(scenarioPath, JSON.stringify(scenario, null, 2), 'utf8');
}

/**
 * Find a review thread by the id the reader hands back. The fallback id
 * is positional *within its pull request* (see threadNode), so it has
 * to be computed the same way here.
 */
function findThread(id) {
  for (const pr of prs) {
    const threads = pr.threads ?? [];
    for (let i = 0; i < threads.length; i++) {
      if ((threads[i].id ?? `thread-${i + 1}`) === id) {
        return { pr, t: threads[i] };
      }
    }
  }
  return undefined;
}
const prs = scenario.prs ?? [];
const argv = process.argv.slice(2);

/**
 * Answer the way `gh` does when GitHub has an outage: its own error on
 * stderr and a nonzero exit. The provider classifies the text, so this
 * is the path a real 5xx takes through the app.
 */
function failLikeGitHub() {
  process.stderr.write('HTTP 502: Bad Gateway (https://api.github.com/)\n');
  process.exit(1);
}

/** Whether the scenario says this PR's `read` should fail right now. */
const failing = (pr, read) => Boolean(pr?.failing?.[read]);

/**
 * Print the answer and exit. The write is synchronous: an asynchronous
 * one into a pipe is cut off at the pipe's buffer (64 KiB) by the exit,
 * and a conversation page is bigger than that. Node leaves the pipe
 * non-blocking, so a full buffer answers EAGAIN until the app reads.
 */
const out = (value) => {
  const bytes = Buffer.from(
    typeof value === 'string' ? value : JSON.stringify(value)
  );
  for (let at = 0; at < bytes.length; ) {
    try {
      at += writeSync(1, bytes, at);
    } catch (err) {
      if (err.code !== 'EAGAIN') throw err;
    }
  }
  process.exit(0);
};

/** `-f k=v` / `-F k=n` pairs, as gh itself collects them. */
function flags(args) {
  const map = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '-f' || args[i] === '-F') {
      const eq = (args[i + 1] ?? '').indexOf('=');
      if (eq > 0) map[args[i + 1].slice(0, eq)] = args[i + 1].slice(eq + 1);
      i++;
    }
  }
  return map;
}

const page = { hasNextPage: false, endCursor: null };

function searchNode(pr) {
  return {
    number: pr.number,
    title: pr.title,
    headRefName: pr.headRefName,
    baseRefName: pr.baseRefName ?? 'main',
    headRefOid: pr.headRefOid ?? 'f'.repeat(40),
    url: `https://github.com/${scenario.owner ?? 'n10'}/${
      scenario.repo ?? 'fixture'
    }/pull/${pr.number}`,
    author: { login: pr.author ?? scenario.username ?? 'n10-tester' },
    isDraft: pr.isDraft ?? false,
    reviews: {
      nodes: (pr.reviews ?? []).map((r) => ({
        author: { login: r.author },
        state: r.state,
      })),
    },
    reviewRequests: {
      nodes: (pr.reviewRequests ?? []).map((login) => ({
        requestedReviewer: { login },
      })),
    },
    reviewThreads: {
      nodes: (pr.threads ?? []).map((t) => ({
        isResolved: t.isResolved ?? false,
      })),
    },
    commits: {
      nodes: [
        {
          commit: {
            statusCheckRollup: pr.rollup ? { state: pr.rollup } : null,
          },
        },
      ],
    },
  };
}

function threadNode(t, i) {
  return {
    id: t.id ?? `thread-${i + 1}`,
    isResolved: t.isResolved ?? false,
    isOutdated: t.isOutdated ?? false,
    path: t.path ?? null,
    line: t.line ?? null,
    startLine: t.startLine ?? null,
    originalLine: t.originalLine ?? null,
    originalStartLine: null,
    diffSide: t.side ?? 'RIGHT',
    comments: {
      nodes: (t.comments ?? []).map((c, j) => ({
        id: `${t.id ?? `thread-${i + 1}`}-c${j + 1}`,
        author: { login: c.author },
        body: c.body,
        createdAt: c.createdAt ?? '2026-01-01T00:00:00Z',
        isMinimized: false,
      })),
    },
  };
}

// ── The whole conversation, a hundred nodes a page ──
//
// The conversation reader follows every connection past its first page,
// so this pages the way GitHub does: at most a hundred nodes, an offset
// cursor, and a total count. A reader that stops early shows up in the
// counts a test asserts.

function pageOf(all, after) {
  const start = after ? Number(after) : 0;
  const nodes = all.slice(start, start + 100);
  const end = start + nodes.length;
  return {
    totalCount: all.length,
    pageInfo: { hasNextPage: end < all.length, endCursor: String(end) },
    nodes,
  };
}

/** A login ending in `bot` is a GitHub App, as `ci-bot` would be. */
const actor = (login) =>
  login ? { __typename: /bot$/.test(login) ? 'Bot' : 'User', login } : null;

function conversationComment(c, id) {
  return {
    id,
    author: actor(c.author),
    body: c.body,
    createdAt: c.createdAt ?? '2026-01-01T00:00:00Z',
    lastEditedAt: null,
    isMinimized: false,
    minimizedReason: null,
    url: `https://github.com/n10/fixture/pull/1#${id}`,
    viewerCanUpdate: c.author === (scenario.username ?? 'n10-tester'),
    viewerCannotUpdateReasons: [],
    viewerCanDelete: c.author === (scenario.username ?? 'n10-tester'),
  };
}

function threadComments(t, i) {
  const id = t.id ?? `thread-${i + 1}`;
  return (t.comments ?? []).map((c, j) => ({
    ...conversationComment(c, `${id}-c${j + 1}`),
    replyTo: j === 0 ? null : { id: `${id}-c1` },
    pullRequestReview: null,
    state: 'SUBMITTED',
  }));
}

function conversationThread(t, i) {
  const node = threadNode(t, i);
  return {
    ...node,
    subjectType: t.line == null && t.originalLine == null ? 'FILE' : 'LINE',
    startDiffSide: null,
    resolvedBy: t.isResolved ? actor(t.resolvedBy) : null,
    viewerCanReply: true,
    viewerCanResolve: !node.isResolved,
    viewerCanUnresolve: node.isResolved,
    root: { nodes: [{ diffHunk: t.diffHunk ?? '', originalCommit: null }] },
    comments: pageOf(threadComments(t, i), undefined),
  };
}

function conversationConnections(pr, after) {
  const threads = pageOf(pr?.threads ?? [], after);
  return {
    reviewThreads: {
      ...threads,
      nodes: threads.nodes.map((t, k) =>
        conversationThread(t, (after ? Number(after) : 0) + k)
      ),
    },
    comments: pageOf(
      (pr?.generalComments ?? []).map((c, i) =>
        conversationComment(c, `general-${i + 1}`)
      ),
      after
    ),
    reviews: pageOf(
      (pr?.reviews ?? []).map((r, i) => ({
        id: `review-${i + 1}`,
        author: actor(r.author),
        state: r.state,
        body: r.body ?? '',
        submittedAt: r.submittedAt ?? '2026-01-01T00:00:00Z',
        url: `https://github.com/n10/fixture/pull/1#review-${i + 1}`,
        commit: null,
        comments: { totalCount: r.commentCount ?? 0 },
        isMinimized: false,
        minimizedReason: null,
      })),
      after
    ),
    timelineItems: {
      ...pageOf(pr?.events ?? [], after),
      totalCount: undefined,
    },
  };
}

// ── gh auth status ──
if (argv[0] === 'auth' && argv[1] === 'status') {
  out(
    `github.com\n  ✓ Logged in to github.com account ${
      scenario.username ?? 'n10-tester'
    } (keyring)\n`
  );
}

// ── gh api graphql ──
if (argv[0] === 'api' && argv[1] === 'graphql') {
  const vars = flags(argv);
  const query = vars.query ?? '';

  // The open-PR search is the only one asking for a check rollup; the
  // merged-branch sweep asks for headRefName alone and gets nothing,
  // which keeps the sync loop from deleting a test's branches.
  if (query.includes('statusCheckRollup')) {
    out({ data: { search: { pageInfo: page, nodes: prs.map(searchNode) } } });
  }
  if (query.includes('search(')) {
    out({ data: { search: { pageInfo: page, nodes: [] } } });
  }

  if (query.includes('query PullRequestConversation(')) {
    const pr = prs.find((p) => String(p.number) === String(vars.number));
    if (failing(pr, 'conversation')) failLikeGitHub();
    out({
      data: { repository: { pullRequest: conversationConnections(pr) } },
    });
  }
  if (query.includes('query PullRequestConversationPage(')) {
    const pr = prs.find((p) => String(p.number) === String(vars.number));
    if (failing(pr, 'conversation')) failLikeGitHub();
    const all = conversationConnections(pr, vars.after);
    const name = Object.keys(all).find((n) => query.includes(`${n}(first:`));
    out({ data: { repository: { pullRequest: { [name]: all[name] } } } });
  }
  if (query.includes('query MentionableUsers(')) {
    const q = (vars.q ?? '').toLowerCase();
    const nodes = (scenario.mentionable ?? [])
      .filter((u) => `${u.login} ${u.name ?? ''}`.toLowerCase().includes(q))
      .slice(0, 8)
      .map((u) => ({ login: u.login, name: u.name ?? null }));
    out({ data: { repository: { mentionableUsers: { nodes } } } });
  }
  if (query.includes('query PullRequestThreadReplies(')) {
    for (const pr of prs) {
      const i = (pr.threads ?? []).findIndex(
        (t, k) => (t.id ?? `thread-${k + 1}`) === vars.thread
      );
      if (i < 0) continue;
      const comments = pageOf(threadComments(pr.threads[i], i), vars.after);
      out({ data: { node: { comments } } });
    }
    out({ data: { node: null } });
  }

  if (query.includes('reviewThreads(first: 100, after: $threadCursor)')) {
    const pr = prs.find((p) => String(p.number) === String(vars.prNumber));
    if (failing(pr, 'threads')) failLikeGitHub();
    out({
      data: {
        repository: {
          pullRequest: {
            id: `PR_${vars.prNumber}`,
            reviewThreads: {
              pageInfo: page,
              nodes: (pr?.threads ?? []).map(threadNode),
            },
            comments: {
              pageInfo: page,
              nodes: (pr?.generalComments ?? []).map((c, i) => ({
                id: `general-${i + 1}`,
                author: { login: c.author },
                body: c.body,
                createdAt: c.createdAt ?? '2026-01-01T00:00:00Z',
              })),
            },
          },
        },
      },
    });
  }

  // ── Mutations ──
  if (query.includes('addPullRequestReviewThreadReply')) {
    const found = findThread(vars.threadId);
    const comment = {
      id: `reply-${Date.now()}`,
      author: scenario.username ?? 'n10-tester',
      body: vars.body,
      createdAt: new Date().toISOString(),
    };
    if (found) {
      found.t.comments = [...(found.t.comments ?? []), comment];
      save();
    }
    out({
      data: {
        addPullRequestReviewThreadReply: {
          comment: {
            id: comment.id,
            body: comment.body,
            createdAt: comment.createdAt,
            author: { login: comment.author },
          },
        },
      },
    });
  }

  if (query.includes('addComment(')) {
    const pr = prs.find((p) => `PR_${p.number}` === vars.subjectId);
    const comment = {
      author: scenario.username ?? 'n10-tester',
      body: vars.body,
      createdAt: new Date().toISOString(),
    };
    if (pr) {
      pr.generalComments = [...(pr.generalComments ?? []), comment];
      save();
    }
    out({
      data: {
        addComment: {
          commentEdge: {
            node: {
              id: `general-${Date.now()}`,
              body: comment.body,
              createdAt: comment.createdAt,
              author: { login: comment.author },
            },
          },
        },
      },
    });
  }

  // Order matters: 'unresolveReviewThread(' contains
  // 'resolveReviewThread(', so the negative has to be tested first.
  const unresolving = query.includes('unresolveReviewThread(');
  const resolving = !unresolving && query.includes('resolveReviewThread(');
  if (resolving || unresolving) {
    const found = findThread(vars.threadId);
    if (found) {
      found.t.isResolved = resolving;
      save();
    }
    const key = resolving ? 'resolveReviewThread' : 'unresolveReviewThread';
    out({
      data: {
        [key]: { thread: { id: vars.threadId, isResolved: resolving } },
      },
    });
  }

  out({ data: {} });
}

// ── gh api repos/<owner>/<repo>/pulls/<n>/reviews --input - ──
// Posting draft comments (review-comments' poster). The JSON review
// arrives on stdin; consume it before answering, or the parent's
// write races the exit and dies on EPIPE.
if (
  argv[0] === 'api' &&
  /^repos\/[^/]+\/[^/]+\/pulls\/\d+\/reviews$/.test(argv[1] ?? '') &&
  argv.includes('--input')
) {
  let body = '';
  process.stdin.on('data', (c) => (body += c));
  process.stdin.on('end', () => out({ id: 1, body: JSON.parse(body).body }));
} else {
  // ── gh api repos/<owner>/<repo>/pulls/<n> --jq '.body // ""' ──
  const pullPath = argv[1]?.match(/^repos\/[^/]+\/[^/]+\/pulls\/(\d+)$/);
  if (argv[0] === 'api' && pullPath) {
    const pr = prs.find((p) => String(p.number) === pullPath[1]);
    if (failing(pr, 'body')) failLikeGitHub();
    out(pr?.body ?? '');
  }

  if (argv[0] === 'api' && argv[1] === '/user') {
    out({ login: scenario.username ?? 'n10-tester' });
  }

  process.stderr.write(`fake gh: unhandled invocation: ${argv.join(' ')}\n`);
  process.exit(1);
}
