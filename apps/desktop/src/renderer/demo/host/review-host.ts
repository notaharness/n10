import type {
  N10HostApi,
  RemoteCommentThread,
  ReviewComment,
} from '../../../host/contract.js';
import { VIEWER } from '../data/identity.js';
import { later } from './hub.js';
import type { DemoState } from './state.js';

/**
 * Pull requests, their threads and drafts, for whichever repository
 * is open. Descriptions are the real ones, loaded only when a tab asks
 * for them; diffs are `pr-diff-host.ts`.
 */
export async function load(
  loader: (() => Promise<{ default: string }>) | undefined
) {
  return loader ? (await loader()).default : '';
}

/** One file's section of a whole-repository patch. */
export function fileSection(patch: string, file: string): string {
  const sections = patch.split(/^(?=diff --git )/m);
  return sections.find((s) => s.startsWith(`diff --git a/${file} `)) ?? '';
}

/** A GitHub conversation comment answered: another comment on the pull
 *  request, a thread of its own in the diff's read. */
function answer(
  thread: RemoteCommentThread,
  body: string
): RemoteCommentThread {
  const id = `IC_demo_${Date.now().toString(36)}`;
  return {
    ...thread,
    id,
    comments: [
      { id, author: VIEWER, body, createdAt: new Date().toISOString() },
    ],
  };
}

function reply(thread: RemoteCommentThread, body: string): RemoteCommentThread {
  const id = `${thread.id}-${thread.comments.length + 1}`;
  const createdAt = new Date().toISOString();
  return {
    ...thread,
    comments: [...thread.comments, { id, author: VIEWER, body, createdAt }],
  };
}

/** A posted draft, as the provider hands it back: a thread of one. */
function posted(draft: ReviewComment): RemoteCommentThread {
  return {
    id: `PRRT_demo_${draft.id}`,
    file: draft.file,
    lineStart: draft.lineStart,
    lineEnd: draft.lineEnd,
    side: draft.side,
    isResolved: false,
    isOutdated: false,
    canResolve: true,
    comments: [
      {
        id: `${draft.id}-posted`,
        author: VIEWER,
        body: `${draft.body}\n\n---\n\n_Posted via [n10](https://github.com/notaharness/n10) by an agent_`,
        createdAt: new Date().toISOString(),
      },
    ],
  };
}

type ReviewHost = Pick<
  N10HostApi,
  | 'fetchCommentThreads'
  | 'replyToThread'
  | 'setThreadResolved'
  | 'fetchPrDescription'
  | 'fetchCommentImage'
  | 'listDraftComments'
  | 'updateDraftComment'
  | 'deleteDraftComment'
  | 'postDraftComments'
  | 'fetchWorktreeDiffText'
>;

export function createReviewHost(state: DemoState): ReviewHost {
  const repo = () => state.repo();
  const editThreads = (
    prId: number,
    edit: (t: RemoteCommentThread) => RemoteCommentThread,
    id: string
  ) => {
    const current = repo().threadsOf(prId);
    const apply = (list: RemoteCommentThread[]) =>
      list.map((t) => (t.id === id ? edit(t) : t));
    repo().threads[prId] = {
      threads: apply(current.threads),
      generalComments: apply(current.generalComments),
    };
    repo().recount(prId);
  };
  const drafts = (prId: number) => repo().drafts[prId] ?? [];
  const setDrafts = (prId: number, next: ReviewComment[]) => {
    repo().drafts[prId] = next;
  };
  return {
    fetchCommentThreads: (cwd, prId) =>
      later(state.repoAt(cwd).threadsOf(prId), 120),
    replyToThread: ({ prId, thread, body }) => {
      if (thread.replyKind === 'github-issue-comment') {
        const current = repo().threadsOf(prId);
        repo().threads[prId] = {
          ...current,
          generalComments: [...current.generalComments, answer(thread, body)],
        };
      } else {
        editThreads(prId, (t) => reply(t, body), thread.id);
      }
      return later(undefined);
    },
    setThreadResolved: ({ prId, thread, resolved }) => {
      editThreads(prId, (t) => ({ ...t, isResolved: resolved }), thread.id);
      return later(undefined);
    },
    fetchPrDescription: (cwd, prId) =>
      load(state.repoAt(cwd).data.descriptions[prId]),
    fetchCommentImage: () => later(null),
    listDraftComments: (cwd, prId) =>
      later(state.repoAt(cwd).drafts[prId] ?? []),
    updateDraftComment: (prId, id, patch) => {
      setDrafts(
        prId,
        drafts(prId).map((d) => (d.id === id ? { ...d, ...patch } : d))
      );
      return later(undefined);
    },
    deleteDraftComment: (prId, id) => {
      setDrafts(
        prId,
        drafts(prId).filter((d) => d.id !== id)
      );
      return later(undefined);
    },
    postDraftComments: ({ prId, ids }) => {
      const all = drafts(prId);
      const chosen = all.filter((d) => !ids || ids.includes(d.id));
      const current = repo().threadsOf(prId);
      repo().threads[prId] = {
        ...current,
        threads: [...current.threads, ...chosen.map(posted)],
      };
      setDrafts(
        prId,
        all.filter((d) => !chosen.includes(d))
      );
      repo().recount(prId);
      return later(chosen.length, 400);
    },
    fetchWorktreeDiffText: () => later(''),
  };
}
