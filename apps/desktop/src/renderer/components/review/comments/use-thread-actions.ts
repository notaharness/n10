import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { snapshotRemote } from '@n10/core/plan';
import type { RemoteCommentThread } from '../../../../host/contract.js';
import { useReply, useSetResolved } from '../../../lib/data/mutations.js';
import { pullRequestRefFor } from '../../../lib/data/pr-snapshot-query.js';
import { usePlan, usePlanControls } from '../../../lib/plan/plan.js';
import { useReviewDraft } from '../../../lib/review/review-drafts.js';
import { useRepo } from '../../../lib/repo-context.js';
import { errorMessage } from '../../../lib/utils.js';
import { useComposerRefresh } from './use-composer-refresh.js';

/**
 * What a card can do with a review thread: queue it in the plan, reply,
 * and resolve or reopen it, through the host's own calls. The diff's
 * thread cards and the Overview's activity share it, so the gesture and
 * its effect are the same wherever a thread is shown.
 *
 * `visible` is whether the card shows its footer: the freshness notice
 * belongs to a composer the reader can see, so a card folded mid-reply
 * drops its baseline rather than greeting the reader, on unfolding,
 * with news of a check they never asked for.
 */
export function useThreadActions(
  prId: number,
  thread: RemoteCommentThread,
  visible: boolean
) {
  const { repo } = useRepo();
  const plan = usePlan(prId);
  const planControls = usePlanControls(
    plan,
    'remote',
    thread.id,
    useCallback(() => snapshotRemote(thread), [thread])
  );
  const reply = useReply(repo.cwd);
  const resolve = useSetResolved(repo.cwd);
  const draft = useReviewDraft(pullRequestRefFor(repo, prId), {
    kind: 'reply',
    threadId: thread.id,
  });
  const [composing, setComposing] = useState(false);
  // Opening the box refetches the thread, so a reply is never written
  // against a conversation that has already moved on.
  const refresh = useComposerRefresh(prId, thread.comments.length);
  const openComposer = (next: boolean) => {
    setComposing(next);
    if (next) refresh.begin();
    else refresh.end();
  };
  const composerVisible = visible && composing;
  const { end: endRefresh } = refresh;
  useEffect(() => {
    if (!composerVisible) endRefresh();
  }, [composerVisible, endRefresh]);

  const send = (alsoResolve = false) => {
    const body = draft.body.trim();
    if (!body) return;
    reply.mutate(
      { prId, thread, body },
      {
        onSuccess: () => {
          void draft.clear();
          openComposer(false);
          if (alsoResolve && thread.canResolve && !thread.isResolved) {
            resolve.mutate(
              { prId, thread, resolved: true },
              { onError: (e) => toast.error(errorMessage(e)) }
            );
          }
        },
        onError: (e) => toast.error(errorMessage(e)),
      }
    );
  };

  const toggleResolved = () =>
    resolve.mutate(
      { prId, thread, resolved: !thread.isResolved },
      { onError: (e) => toast.error(errorMessage(e)) }
    );

  return {
    planControls,
    footer: {
      composing,
      setComposing: openComposer,
      notice: refresh.notice,
      draft,
      sending: reply.isPending,
      resolving: resolve.isPending,
      onSend: send,
      onToggleResolved: toggleResolved,
    },
  };
}

export type ThreadActions = ReturnType<typeof useThreadActions>;
