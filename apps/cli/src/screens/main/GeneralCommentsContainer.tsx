import { useCallback, useMemo } from 'react';
import { useInput } from 'ink';
import type { PullRequestInfo } from '@n10/vcs-core';
import { GeneralCommentsPane } from '../reviews/GeneralCommentsPane.js';
import type { TerminalLayout, PaneModeValue, DiffBundle } from '@n10/app-core';
import {
  useAsyncOps,
  useEngine,
  useSessionActions,
  LAYOUT,
} from '@n10/app-core';
import { useScrollWheel } from '../../hooks/useScrollWheel.js';
import { handleReplyModeInput } from '../../utils/reply-mode.js';

interface GeneralCommentsContainerProps {
  pane: PaneModeValue;
  terminal: TerminalLayout;
  terminalFocused: boolean;
  diffBundle: DiffBundle;
  selectedPr: PullRequestInfo | undefined;
}

// Owns the 'comments' pane — lists PR-level (non-inline) comments: the
// review agent's unposted findings on the pull request, which [p] posts,
// then those fetched from the VCS provider. Navigation is simple: j/k to
// move selection, esc to return to pr-detail. The comments stream comes
// in via diffBundle so we reuse the single provider fetch started in
// MainContent.
export function GeneralCommentsContainer({
  pane,
  terminal,
  terminalFocused,
  diffBundle,
  selectedPr,
}: GeneralCommentsContainerProps) {
  const generalComments = diffBundle.remote.generalComments;
  const drafts = useMemo(
    () =>
      diffBundle.comments.filter(
        (comment) => comment.file === null && comment.status !== 'posted'
      ),
    [diffBundle.comments]
  );
  const viewportHeight = Math.max(1, terminal.paneRows - 2);
  const count = drafts.length + generalComments.length;
  const { flashStatus } = useSessionActions();
  const { reviews } = useEngine();
  const asyncOps = useAsyncOps();
  const selectedThread =
    generalComments[pane.generalCommentsIndex - drafts.length];

  /** Move the cursor and keep it inside the viewport. */
  const moveSelection = (delta: 1 | -1) => {
    pane.setGeneralCommentsIndex((i) => {
      const next = Math.min(Math.max(i + delta, 0), count - 1);
      pane.setGeneralCommentsScrollOffset((off) => {
        if (next < off) return next;
        if (next >= off + viewportHeight) return next - viewportHeight + 1;
        return off;
      });
      return next;
    });
  };

  // Wheel scrolling (this pane slices by comment, so a tick is one
  // card). Main-pane region only — the sidebar scrolls itself.
  const { setGeneralCommentsIndex, setGeneralCommentsScrollOffset } = pane;
  const handleScrollWheel = useCallback(
    (ticks: number) => {
      const dir = Math.sign(ticks);
      setGeneralCommentsIndex((i) => {
        const next = Math.min(Math.max(i + dir, 0), Math.max(0, count - 1));
        setGeneralCommentsScrollOffset((off) => {
          if (next < off) return next;
          if (next >= off + viewportHeight) return next - viewportHeight + 1;
          return off;
        });
        return next;
      });
    },
    [
      count,
      viewportHeight,
      setGeneralCommentsIndex,
      setGeneralCommentsScrollOffset,
    ]
  );
  useScrollWheel(!terminalFocused && count > 0, handleScrollWheel, {
    xMin: LAYOUT.SIDEBAR_WIDTH + 1,
  });

  /** Open the composer now; re-read the conversation behind it, so a
   *  reply is never written against comments that have already moved
   *  on in the cache this pane reads from. */
  const startReply = () => {
    const target = selectedThread;
    if (!target) return;
    pane.setReplyingToThreadId(target.id);
    pane.setReplyBuffer('');
    diffBundle.remote.refresh();
    flashStatus('Checking for new comments...');
  };

  /** Post the selected finding on the pull request, at the head the
   *  sidebar last read. */
  const postDraft = () => {
    const draft = drafts[pane.generalCommentsIndex];
    if (!draft || draft.status !== 'draft' || !selectedPr) return;
    void asyncOps.run('post-comment', async () => {
      try {
        await reviews.agentComments.post({
          prId: selectedPr.id,
          ids: [draft.id],
          headSha: selectedPr.headSha,
        });
        flashStatus('Comment posted');
        diffBundle.remote.refresh();
      } catch (err) {
        flashStatus(`Post failed: ${(err as Error).message}`);
      }
    });
  };

  const toggleResolved = () => {
    const target = selectedThread;
    if (!target) return;
    const newResolved = !target.isResolved;
    flashStatus(newResolved ? 'Resolving thread...' : 'Reopening thread...');
    diffBundle.remote
      .toggleResolved(target.id, newResolved)
      .then((success) => {
        if (success) {
          flashStatus(newResolved ? 'Thread resolved' : 'Thread reopened');
        }
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        flashStatus(`Failed: ${msg}`);
      });
  };

  useInput(
    (input, key) => {
      // Reply mode bypass (Esc/Enter/text) — see apps/cli/src/utils/reply-mode.ts
      if (
        handleReplyModeInput(input, key, {
          pane,
          flashStatus,
          replyToThread: diffBundle.remote.replyToThread,
        })
      ) {
        return;
      }

      if (key.escape) {
        pane.setPaneMode('pr-detail');
        return;
      }
      // Everything below acts on the selected thread, so an empty list
      // has nothing for them to do.
      if (count === 0) return;
      if (input === 'j' || key.downArrow) moveSelection(1);
      else if (input === 'k' || key.upArrow) moveSelection(-1);
      else if (input === 'r') startReply();
      else if (input === 'v') toggleResolved();
      else if (input === 'p') postDraft();
    },
    { isActive: !terminalFocused }
  );

  return (
    <GeneralCommentsPane
      drafts={drafts}
      comments={generalComments}
      selectedIndex={pane.generalCommentsIndex}
      scrollOffset={pane.generalCommentsScrollOffset}
      paneRows={terminal.paneRows}
      replyingToThreadId={pane.replyingToThreadId}
      replyBuffer={pane.replyBuffer}
    />
  );
}
