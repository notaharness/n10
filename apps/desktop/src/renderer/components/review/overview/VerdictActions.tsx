import {
  CheckCircle2Icon,
  ClockIcon,
  Loader2Icon,
  MessageSquarePlusIcon,
  XCircleIcon,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { toast } from 'sonner';
import type { ReviewVerdict } from '@n10/vcs-core/types';
import { useSubmitVerdict } from '../../../lib/data/mutations.js';
import { useRepo } from '../../../lib/repo-context.js';
import { errorMessage } from '../../../lib/utils.js';
import { Button } from '../../ui/button.js';
import { Tip } from '../../ui/tooltip.js';
import { Section } from './parts.js';

const VERDICT_DONE: Record<ReviewVerdict, string> = {
  approve: 'Approved',
  'approve-with-suggestions': 'Approved with suggestions',
  'wait-for-author': 'Marked as waiting for author',
  reject: 'Changes requested',
};

/** One vote, coloured only by its icon so no verdict shouts before the
 *  change has been read. The icon becomes a spinner while it is sent. */
function VerdictButton({
  tip,
  icon,
  pending,
  disabled,
  onClick,
  children,
}: {
  tip: string;
  icon: ReactNode;
  pending: boolean;
  disabled: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Tip label={tip}>
      <Button
        variant="outline"
        size="sm"
        onClick={onClick}
        disabled={disabled}
        className="@min-[900px]:w-full @min-[900px]:justify-start"
      >
        {pending ? <Loader2Icon className="animate-spin" /> : icon}
        {children}
      </Button>
    </Tip>
  );
}

/**
 * The reviewer's votes, in the provider's own terms and nothing else:
 * Azure DevOps has four; GitHub has approve and request changes. A vote
 * posts at once, and says so.
 */
export function VerdictActions({ prId }: { prId: number }) {
  const { repo } = useRepo();
  const verdict = useSubmitVerdict(repo.cwd, repo.providerId ?? undefined);
  const isGitHub = repo.providerId === 'github';
  const pending = verdict.isPending ? verdict.variables?.verdict : null;

  const submit = (v: ReviewVerdict) =>
    verdict.mutate(
      { prId, verdict: v },
      {
        onSuccess: () => toast.success(VERDICT_DONE[v]),
        onError: (e) => toast.error(`Review vote failed: ${errorMessage(e)}`),
      }
    );
  const vote = (v: ReviewVerdict) => ({
    pending: pending === v,
    disabled: verdict.isPending,
    onClick: () => submit(v),
  });

  return (
    <Section title="Your review">
      <p className="mb-2 text-xs text-muted-foreground">
        A vote posts to {isGitHub ? 'GitHub' : 'Azure DevOps'} at once.
      </p>
      {/* A column of full-width votes beside the description; a row that
          wraps once the Overview is one column. */}
      <div className="flex flex-wrap gap-1.5 @min-[900px]:flex-col">
        <VerdictButton
          tip="Approve this pull request"
          icon={<CheckCircle2Icon className="text-success" />}
          {...vote('approve')}
        >
          Approve
        </VerdictButton>
        {!isGitHub && (
          <VerdictButton
            tip="Approve, with non-blocking suggestions"
            icon={<MessageSquarePlusIcon className="text-success" />}
            {...vote('approve-with-suggestions')}
          >
            Approve with suggestions
          </VerdictButton>
        )}
        {!isGitHub && (
          <VerdictButton
            tip="Block the pull request until the author responds"
            icon={<ClockIcon className="text-warning" />}
            {...vote('wait-for-author')}
          >
            Wait for author
          </VerdictButton>
        )}
        <VerdictButton
          tip={
            isGitHub
              ? 'Submit a changes-requested review'
              : 'Reject this pull request'
          }
          icon={<XCircleIcon className="text-destructive" />}
          {...vote('reject')}
        >
          {isGitHub ? 'Request changes' : 'Reject'}
        </VerdictButton>
      </div>
    </Section>
  );
}
