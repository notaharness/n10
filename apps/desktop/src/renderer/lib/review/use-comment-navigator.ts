import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DiffLine } from '@n10/diff';
import type {
  RemoteCommentThread,
  ReviewComment,
} from '../../../host/contract.js';
import type { DiffJumpHandle } from '../../components/review/diff/VirtualDiffList.js';
import type { RowPlace } from '../diff/use-diff-jumps.js';
import type { DiffPlaceControls } from '../diff/use-single-file.js';
import {
  buildCommentRows,
  navIndexOf,
  stepComment,
  visibleComments,
  type CommentRow,
} from './review-model.js';
import { useTabView } from '../tabs/tab-views.js';

/**
 * Walking the comments on a pull request: one document-ordered list,
 * where the viewer is in it, and how to get the diff to show any of
 * them.
 *
 * It is one hook because the diff toolbar's prev/next and the header's
 * unresolved count both read it, and must agree about what "the next
 * comment" is: the list is filtered once, here, and both take the
 * result.
 */
export function useCommentNavigator({
  files,
  general,
  inlineThreads,
  drafts,
  hideResolved,
  onShowDiff,
}: {
  files: readonly [string, DiffLine[]][];
  general: readonly RemoteCommentThread[];
  inlineThreads: readonly RemoteCommentThread[];
  drafts: readonly ReviewComment[];
  hideResolved: boolean;
  /** Bring the diff to the front — jumping to a comment implies it. */
  onShowDiff: () => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const jumpRef = useRef<DiffJumpHandle | null>(null);
  // The file picked when the reader left the tab, while the diff still
  // has it; gone from the diff, nothing is picked.
  const { saved, save } = useTabView();
  const [selectedFile, setSelectedFile] = useState<string | null>(
    saved.file ?? null
  );
  if (
    selectedFile !== null &&
    files.length > 0 &&
    !files.some(([f]) => f === selectedFile)
  ) {
    setSelectedFile(null);
  }
  useEffect(() => save({ file: selectedFile }), [selectedFile, save]);
  // Whether the reader last went to the pull request's own conversation
  // rather than a file: single-file mode shows that section.
  const [conversation, setConversation] = useState(false);
  const [focusId, setFocusId] = useState<string | null>(null);

  // General (Conversation) comments first, then per file the remote
  // threads and the agent's drafts interleaved by line.
  const allItems = useMemo(
    () => buildCommentRows(files, general, inlineThreads, drafts),
    [files, general, inlineThreads, drafts]
  );
  // Hiding resolved threads in the diff while still listing them in the
  // rail — and letting prev/next jump to one that is not rendered — was
  // the inconsistency here, so the filter happens once.
  const items = visibleComments(allItems, hideResolved);
  const navIndex = navIndexOf(items, focusId);

  const jumpToFile = useCallback(
    (path: string, at?: RowPlace) => {
      setSelectedFile(path);
      setConversation(false);
      onShowDiff();
      requestAnimationFrame(() => {
        const jump = jumpRef.current;
        if (at && jump?.jumpToRow(at)) return;
        jump?.jumpToFile(path);
      });
    },
    [onShowDiff]
  );

  // A place a guide names: a line in the new version of a file, or
  // the file.
  const jumpToPlace = useCallback(
    (path: string, line?: number) => {
      if (line === undefined) return jumpToFile(path);
      setSelectedFile(path);
      setConversation(false);
      onShowDiff();
      requestAnimationFrame(() =>
        jumpRef.current?.jumpToLine({ file: path, side: 'RIGHT', line })
      );
    },
    [onShowDiff, jumpToFile]
  );

  // Scroll to any comment or draft by id, falling back to its file.
  // Goes through the virtual list's imperative handle — the target row
  // may not be materialized as DOM yet.
  const jumpToId = useCallback(
    (id: string, file: string | null) => {
      setFocusId(id);
      onShowDiff();
      setConversation(file === null);
      if (file) setSelectedFile(file);
      requestAnimationFrame(() => {
        const jump = jumpRef.current;
        if (jump?.jumpToId(id)) return;
        if (file && jump?.jumpToFile(file)) return;
        jump?.jumpToTop();
      });
    },
    [onShowDiff]
  );

  // Through the list's handle, so it replaces any jump still pending.
  const showConversation = useCallback(() => {
    setConversation(true);
    onShowDiff();
    requestAnimationFrame(() => jumpRef.current?.jumpToTop());
  }, [onShowDiff]);

  const step = useCallback(
    (delta: number) => {
      const target: CommentRow | null = stepComment(items, navIndex, delta);
      if (!target) return;
      jumpToId(target.id, target.file ?? null);
    },
    [items, navIndex, jumpToId]
  );

  const place = useMemo<DiffPlaceControls>(
    () => ({
      file: selectedFile,
      conversation,
      select: jumpToFile,
      showConversation,
    }),
    [selectedFile, conversation, jumpToFile, showConversation]
  );

  return {
    scrollRef,
    jumpRef,
    items,
    navIndex,
    focusId,
    selectedFile,
    place,
    jumpToFile,
    jumpToPlace,
    jumpToId,
    step,
  };
}
