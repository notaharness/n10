import { ExternalLinkIcon } from 'lucide-react';
import type { CiJob, CiPipeline, CiStage } from '@n10/vcs-core/ci';
import { ciDuration, CI_STATUS_LABEL } from '../../../lib/review/ci-model.js';
import { cn } from '../../../lib/utils.js';
import { Button } from '../../ui/button.js';
import { Tip } from '../../ui/tooltip.js';
import { CiStatusIcon } from './CiStatusIcon.js';

function JobRow({
  job,
  selected,
  onSelect,
}: {
  job: CiJob;
  selected: boolean;
  onSelect: () => void;
}) {
  const duration = ciDuration(job.startedAt, job.completedAt);
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      title={`${job.name} · ${CI_STATUS_LABEL[job.status]}`}
      data-ci-job={job.name}
      className={cn(
        'flex h-7 w-full min-w-0 items-center gap-2 rounded-md border px-2 text-left text-sm transition-colors',
        selected
          ? 'border-primary/60 bg-sidebar-active'
          : 'border-border bg-card hover:bg-sidebar-accent'
      )}
    >
      <CiStatusIcon status={job.status} />
      <span className="min-w-0 flex-1 truncate">{job.name}</span>
      {duration && (
        <span className="shrink-0 font-mono text-xs text-muted-foreground tabular-nums">
          {duration}
        </span>
      )}
    </button>
  );
}

/**
 * One stage and its jobs, in the provider's order. A stage with no
 * name (a GitHub workflow, which has no stages) lays its jobs out in a
 * grid instead of one long column.
 */
function StageColumn({
  stage,
  selectedJobId,
  onSelectJob,
}: {
  stage: CiStage;
  selectedJobId: string | null;
  onSelectJob: (job: CiJob) => void;
}) {
  const unnamed = stage.name === null;
  return (
    <section
      aria-label={stage.name ?? 'Jobs'}
      className={cn(
        'flex min-w-0 flex-col gap-1.5',
        unnamed ? 'flex-1' : 'w-64 shrink-0'
      )}
    >
      {!unnamed && (
        <h4 className="flex h-6 items-center gap-1.5 text-xs font-semibold text-muted-foreground">
          <CiStatusIcon status={stage.status} />
          <span className="truncate">{stage.name}</span>
        </h4>
      )}
      <div
        className={cn(
          'gap-1.5',
          unnamed
            ? 'grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))]'
            : 'flex flex-col'
        )}
      >
        {stage.jobs.map((job) => (
          <JobRow
            key={job.id}
            job={job}
            selected={job.id === selectedJobId}
            onSelect={() => onSelectJob(job)}
          />
        ))}
      </div>
    </section>
  );
}

/** A pipeline: its header, then its stages side by side as columns. */
export function CiPipelineCard({
  pipeline,
  selectedJobId,
  onSelectJob,
  onOpen,
}: {
  pipeline: CiPipeline;
  selectedJobId: string | null;
  onSelectJob: (job: CiJob) => void;
  onOpen: (url: string) => void;
}) {
  const duration = ciDuration(pipeline.startedAt, pipeline.completedAt);
  const meta = [pipeline.event, pipeline.commit?.slice(0, 7), duration].filter(
    Boolean
  );
  const { url } = pipeline;
  return (
    <article
      aria-label={pipeline.name}
      data-ci-pipeline={pipeline.name}
      className="rounded-lg border border-border bg-background"
    >
      <header className="flex h-9 items-center gap-2 border-b border-border px-3">
        <CiStatusIcon status={pipeline.status} className="size-4" />
        <h3 className="truncate text-sm font-semibold">{pipeline.name}</h3>
        <span className="truncate font-mono text-xs text-muted-foreground">
          {meta.join(' · ')}
        </span>
        {url && (
          <Tip label="Open in the browser">
            <Button
              variant="ghost"
              size="icon-sm"
              className="ml-auto"
              aria-label={`Open ${pipeline.name} in the browser`}
              onClick={() => onOpen(url)}
            >
              <ExternalLinkIcon />
            </Button>
          </Tip>
        )}
      </header>
      {pipeline.stages.length === 0 ? (
        <p className="px-3 py-2 text-sm text-muted-foreground">No jobs yet.</p>
      ) : (
        <div className="flex gap-4 overflow-x-auto p-3">
          {pipeline.stages.map((stage) => (
            <StageColumn
              key={stage.id}
              stage={stage}
              selectedJobId={selectedJobId}
              onSelectJob={onSelectJob}
            />
          ))}
        </div>
      )}
    </article>
  );
}
