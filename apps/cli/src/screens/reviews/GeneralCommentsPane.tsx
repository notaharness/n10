import { memo } from 'react';
import { Box, Text } from 'ink';
import type { ReviewComment } from '@n10/review-comments';
import type { RemoteCommentThread } from '@n10/vcs-core';
import {
  CommentThreadCard,
  LocalCommentCard,
} from '../../components/CommentThread.js';

/**
 * The pull request's own comments: the agent's unposted findings on it,
 * then the provider's conversation. One list, selected by index.
 */
export const GeneralCommentsPane = memo(function GeneralCommentsPane({
  drafts = [],
  comments,
  selectedIndex,
  scrollOffset,
  paneRows,
  replyingToThreadId,
  replyBuffer,
}: {
  drafts?: ReviewComment[];
  comments: RemoteCommentThread[];
  selectedIndex: number;
  scrollOffset: number;
  paneRows: number;
  replyingToThreadId?: string | null;
  replyBuffer?: string;
}) {
  const total = drafts.length + comments.length;
  if (total === 0) {
    return (
      <Box flexDirection="column" paddingLeft={1} paddingTop={1}>
        <Text dimColor>No general comments on this PR.</Text>
        <Text dimColor>Press [esc] to go back.</Text>
      </Box>
    );
  }

  const viewportHeight = Math.max(1, paneRows - 2);
  const items = [
    ...drafts.map((draft) => ({ kind: 'draft' as const, draft })),
    ...comments.map((thread) => ({ kind: 'thread' as const, thread })),
  ].slice(scrollOffset, scrollOffset + viewportHeight);

  return (
    <Box flexDirection="column" paddingLeft={1}>
      <Box>
        <Text bold>PR Comments ({total})</Text>
        <Text dimColor>
          {' '}
          [esc] back · [j/k] navigate · [r] reply · [v] resolve
        </Text>
      </Box>
      <Box flexDirection="column" marginTop={1}>
        {items.map((item, idx) => {
          const selected = scrollOffset + idx === selectedIndex;
          return item.kind === 'draft' ? (
            <LocalCommentCard
              key={item.draft.id}
              comment={item.draft}
              selected={selected}
              postOnly
            />
          ) : (
            <CommentThreadCard
              key={item.thread.id}
              thread={item.thread}
              selected={selected}
              replyingToThreadId={replyingToThreadId}
              replyBuffer={replyBuffer}
            />
          );
        })}
      </Box>
    </Box>
  );
});
