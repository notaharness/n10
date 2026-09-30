import { CheckIcon } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import type { DiffLine } from '@n10/diff';
import type { ReviewComment } from '../../../../host/contract.js';
import {
  orderDraftsForReview,
  severityCounts,
  snippetAround,
} from '../../../lib/diff/diff-model.js';
import {
  useDeleteDraft,
  usePostDrafts,
  useUpdateDraft,
} from '../../../lib/data/mutations.js';
import { useRepo } from '../../../lib/repo-context.js';
import { useTabView } from '../../../lib/tabs/tab-views.js';
import { errorMessage } from '../../../lib/utils.js';
import { Button } from '../../ui/button.js';
import { StepCard } from './ReviewStepCard.js';

/**
 * "Review ready" walkthrough: steps through the agent's draft comments
 * one at a time, in severity order, each with the code snippet it
 * anchors to. Post / edit / discard / skip per draft; posting advances
 * to the next. A final screen offers to post everything that's left.
 */
export function ReviewStepper({
  prId,
  headSha,
  drafts,
  filesByName,
  fileOrder,
  onExit,
  onOpenInDiff,
}: {
  prId: number;
  headSha?: string;
  drafts: ReviewComment[];
  filesByName: Map<string, DiffLine[]>;
  fileOrder: Map<string, number>;
  onExit: () => void;
  onOpenInDiff: (file: string) => void;
}) {
  const { repo } = useRepo();
  const update = useUpdateDraft(repo.cwd);
  const remove = useDeleteDraft(repo.cwd);
  const post = usePostDrafts(repo.cwd);

  const ordered = useMemo(
    () => orderDraftsForReview(drafts, fileOrder),
    [drafts, fileOrder]
  );
  // The step the reader was on when they left the tab.
  const { saved, save } = useTabView();
  const [index, setIndex] = useState(saved.step ?? 0);
  const clamped = Math.min(index, Math.max(0, ordered.length - 1));
  if (clamped !== index) setIndex(clamped);
  useEffect(() => save({ step: clamped }), [clamped, save]);

  const current = ordered[clamped];
  const done = ordered.length === 0;

  if (done) {
    return <FinishScreen onExit={onExit} />;
  }

  return (
    <StepCard
      key={current.id}
      draft={current}
      prId={prId}
      pos={clamped + 1}
      total={ordered.length}
      counts={severityCounts(ordered)}
      snippet={snippetAround(
        filesByName.get(current.file) ?? [],
        current.side,
        current.lineStart,
        current.lineEnd
      )}
      busy={post.isPending || update.isPending || remove.isPending}
      atStart={clamped === 0}
      atEnd={clamped >= ordered.length - 1}
      onPrev={() => setIndex((i) => Math.max(0, i - 1))}
      onNext={() => setIndex((i) => Math.min(ordered.length - 1, i + 1))}
      onExit={onExit}
      onOpenInDiff={() => onOpenInDiff(current.file)}
      onPost={() =>
        post.mutate(
          { prId, ids: [current.id], headSha },
          {
            // The posted draft leaves the list, shifting the next one
            // into this index — keep index where it is.
            onSuccess: () => toast.success('Comment posted'),
            onError: (e) => toast.error(`Post failed: ${errorMessage(e)}`),
          }
        )
      }
      onDiscard={() =>
        remove.mutate(
          { prId, id: current.id },
          { onError: (e) => toast.error(errorMessage(e)) }
        )
      }
      onSave={(body, severity) =>
        update.mutate(
          { prId, id: current.id, patch: { body, severity } },
          { onError: (e) => toast.error(errorMessage(e)) }
        )
      }
    />
  );
}

function FinishScreen({ onExit }: { onExit: () => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
      <span className="flex size-12 items-center justify-center rounded-full bg-success/15">
        <CheckIcon className="size-6 text-success" />
      </span>
      <div>
        <p className="text-lg font-semibold">All drafts handled</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Every draft comment has been posted or discarded.
        </p>
      </div>
      <Button variant="outline" size="sm" onClick={onExit}>
        Back to diff
      </Button>
    </div>
  );
}
