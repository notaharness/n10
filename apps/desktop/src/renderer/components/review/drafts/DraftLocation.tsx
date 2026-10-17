import { ArrowRightIcon, FileIcon, GitPullRequestIcon } from 'lucide-react';
import type { Ref } from 'react';
import type { ReviewComment } from '../../../../host/contract.js';
import { draftPlace } from '../../../lib/diff/diff-model.js';

/**
 * Where a draft goes: its lines or its file, which open the diff there,
 * or the pull request itself, which has no place in the diff.
 */
export function DraftLocation({
  draft,
  onOpenInDiff,
  locationRef,
}: {
  draft: ReviewComment;
  onOpenInDiff: () => void;
  locationRef?: Ref<HTMLButtonElement>;
}) {
  if (draft.file === null) {
    return (
      <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <GitPullRequestIcon className="size-3.5" />
        <span>{draftPlace(draft)}</span>
      </p>
    );
  }
  return (
    <button
      type="button"
      ref={locationRef}
      onClick={onOpenInDiff}
      className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      title="Open this file in the diff"
    >
      <FileIcon className="size-3.5" />
      <span className="font-mono">{draftPlace(draft)}</span>
      <ArrowRightIcon className="size-3" />
    </button>
  );
}
