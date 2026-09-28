import { useState, useEffect, useRef, useCallback } from 'react';
import { watch } from 'node:fs';
import {
  readComments,
  commentDirPath,
  type DraftScope,
  type ReviewComment,
} from '@n10/review-comments';

/** One list for "none", so a PR with no drafts keeps a stable value. */
const NO_DRAFTS: ReviewComment[] = [];

export function useReviewComments(scope: DraftScope | null): ReviewComment[] {
  // Primitives, so a scope rebuilt each render does not re-subscribe.
  const repo = scope?.repo ?? null;
  const prId = scope?.prId ?? null;
  // Revision counter bumped by file watcher to trigger re-reads
  const [revision, setRevision] = useState(0);
  // What was last read, and for which PR: a read finishes after the
  // render that asked for it, and one for the PR the view has since
  // left must not be shown for the new one.
  const [read, setRead] = useState<{
    key: string;
    comments: ReviewComment[];
  } | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const bumpRevision = useCallback(() => {
    setRevision((r) => r + 1);
  }, []);

  useEffect(() => {
    if (repo === null || prId === null) return;

    const dir = commentDirPath({ repo, prId });
    let watcher: ReturnType<typeof watch> | null = null;

    try {
      watcher = watch(dir, () => {
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(bumpRevision, 100);
      });
    } catch {
      // Directory may not exist yet
    }

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      watcher?.close();
    };
  }, [repo, prId, bumpRevision]);

  // Re-read on a scope change and on every change the watcher reports.
  useEffect(() => {
    if (repo === null || prId === null) return;
    let current = true;
    const key = `${repo}/${prId}`;
    const show = (comments: ReviewComment[]) => {
      if (current) setRead({ key, comments });
    };
    // readComments answers none for a file it cannot read; a rejection
    // would be something else going wrong, and shows none too.
    readComments({ repo, prId }).then(show, () => show(NO_DRAFTS));
    return () => {
      current = false;
    };
  }, [repo, prId, revision]);

  return read !== null && read.key === `${repo}/${prId}`
    ? read.comments
    : NO_DRAFTS;
}
