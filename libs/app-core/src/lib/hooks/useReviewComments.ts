import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  readComments,
  watchComments,
  type DraftScope,
  type ReviewComment,
} from '@n10/review-comments';

export function useReviewComments(scope: DraftScope | null): ReviewComment[] {
  // Primitives, so a scope rebuilt each render does not re-subscribe.
  const repo = scope?.repo ?? null;
  const prId = scope?.prId ?? null;
  // Revision counter bumped by file watcher to trigger re-reads
  const [revision, setRevision] = useState(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const bumpRevision = useCallback(() => {
    setRevision((r) => r + 1);
  }, []);

  useEffect(() => {
    if (repo === null || prId === null) return;

    const changed = () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(bumpRevision, 100);
    };
    let unwatch: (() => void) | undefined;
    try {
      unwatch = watchComments({ repo, prId }, changed);
    } catch {
      // No watch (the reviews directory cannot be created): the drafts
      // still show, just not live.
    }
    // The drafts were read during render, before this watch existed; a
    // write in between would otherwise go unseen until the next one.
    changed();

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      unwatch?.();
    };
  }, [repo, prId, bumpRevision]);

  // Derive comments from the scope + revision (re-reads on file change
  // or scope change)
  return useMemo(
    () => (repo !== null && prId !== null ? readComments({ repo, prId }) : []),
    // `revision` reads as unnecessary because the body never looks at
    // it, and that is precisely its job: the watcher above bumps it
    // when the drafts file changes on disk, and re-reading the file is
    // the point. Drop it and the comments freeze at whatever was on
    // disk when the PR was opened. Unlike the plan store there is no
    // snapshot to derive from — the source is the filesystem — and
    // useSyncExternalStore needs a referentially stable snapshot, which
    // readComments cannot give without a cache layer it does not have.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- see above
    [repo, prId, revision]
  );
}
