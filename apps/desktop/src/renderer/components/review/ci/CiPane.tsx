import { Loader2Icon, RefreshCwIcon } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import type { CiOverview } from '@n10/vcs-core/ci';
import { useCiOverview } from '../../../lib/data/ci-queries.js';
import {
  ciSummary,
  CI_PROVIDER_LABEL,
  findCiJob,
  hostErrorMessage,
} from '../../../lib/review/ci-model.js';
import { useRepo } from '../../../lib/repo-context.js';
import { cn, errorMessage } from '../../../lib/utils.js';
import { Badge } from '../../ui/badge.js';
import { Button } from '../../ui/button.js';
import { Skeleton } from '../../ui/skeleton.js';
import { Tip } from '../../ui/tooltip.js';
import { CiJobDetail } from './CiJobDetail.js';
import { CiPipelineCard } from './CiPipelineCard.js';

function openExternal(url: string): void {
  window.n10
    .openExternal(url)
    .catch((e: unknown) =>
      toast.error(`Couldn't open the link: ${errorMessage(e)}`)
    );
}

function CiHeader({
  overview,
  fetching,
  onRefresh,
}: {
  overview: CiOverview | undefined;
  fetching: boolean;
  onRefresh: () => void;
}) {
  const status = overview
    ? `${
        CI_PROVIDER_LABEL[overview.provider] ?? overview.provider
      } · ${ciSummary(overview)}`
    : null;
  return (
    <header className="shrink-0 border-b border-border px-4 py-2">
      <div className="flex h-7 items-center gap-2">
        <h2 className="text-base font-semibold">CI</h2>
        <Badge variant="info">Preview</Badge>
        {status && (
          <span className="truncate text-sm text-muted-foreground">
            {status}
          </span>
        )}
        <Tip label="Refresh">
          <Button
            variant="ghost"
            size="icon-sm"
            className="ml-auto"
            aria-label="Refresh CI"
            onClick={onRefresh}
            disabled={fetching}
          >
            {fetching ? (
              <Loader2Icon className="animate-spin" />
            ) : (
              <RefreshCwIcon />
            )}
          </Button>
        </Tip>
      </div>
      <p className="text-xs text-muted-foreground">
        Stages and jobs appear in the order the provider lists them. Their
        dependencies are not shown: the provider&apos;s API does not report
        them.
      </p>
    </header>
  );
}

function CiBody({
  query,
  selected,
  onSelect,
}: {
  query: ReturnType<typeof useCiOverview>;
  selected: { pipelineId: string; jobId: string } | null;
  onSelect: (pipelineId: string, jobId: string) => void;
}) {
  if (query.isLoading) {
    return (
      <div className="space-y-3 p-4" aria-label="Loading CI">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }
  if (query.error && !query.data) {
    return (
      <div role="alert" className="flex items-center gap-3 p-4 text-sm">
        <span className="text-destructive">
          Couldn&apos;t load CI: {hostErrorMessage(query.error)}
        </span>
        <Button
          size="sm"
          variant="outline"
          onClick={() => void query.refetch()}
        >
          Retry
        </Button>
      </div>
    );
  }
  const pipelines = query.data?.pipelines ?? [];
  if (pipelines.length === 0) {
    return (
      <p className="p-4 text-sm text-muted-foreground">
        No pipelines have run for this pull request&apos;s latest commit.
      </p>
    );
  }
  return (
    <div className="space-y-3 p-4">
      {pipelines.map((pipeline) => (
        <CiPipelineCard
          key={pipeline.id}
          pipeline={pipeline}
          selectedJobId={
            selected?.pipelineId === pipeline.id ? selected.jobId : null
          }
          onSelectJob={(job) => onSelect(pipeline.id, job.id)}
          onOpen={openExternal}
        />
      ))}
    </div>
  );
}

/**
 * The CI page of a pull request (preview): every pipeline, its stages
 * and jobs; a chosen job's steps and log below.
 */
export function CiPane({ prId }: { prId: number }) {
  const { repo } = useRepo();
  const query = useCiOverview(repo.cwd, prId);
  const [selected, setSelected] = useState<{
    pipelineId: string;
    jobId: string;
  } | null>(null);
  const found = selected
    ? findCiJob(query.data, selected.pipelineId, selected.jobId)
    : null;

  return (
    <div className="flex h-full min-h-0 flex-col" data-ci-page>
      <CiHeader
        overview={query.data}
        fetching={query.isFetching}
        onRefresh={() => void query.refetch()}
      />
      <div
        className={cn('min-h-0 overflow-auto', found ? 'flex-[2]' : 'flex-1')}
      >
        <CiBody
          query={query}
          selected={selected}
          onSelect={(pipelineId, jobId) => setSelected({ pipelineId, jobId })}
        />
      </div>
      {found && (
        <div className="flex min-h-0 flex-[3]">
          <CiJobDetail
            key={`${found.pipeline.id}/${found.job.id}`}
            cwd={repo.cwd}
            job={found.job}
            onClose={() => setSelected(null)}
            onOpen={openExternal}
          />
        </div>
      )}
    </div>
  );
}
