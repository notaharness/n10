import { ExternalLinkIcon, XIcon } from 'lucide-react';
import { useState } from 'react';
import type { CiJob, CiLogRef, CiStatus } from '@n10/vcs-core/ci';
import { useCiLog } from '../../../lib/data/ci-queries.js';
import {
  ciDuration,
  missingJobLogReason,
} from '../../../lib/review/ci-model.js';
import { cn } from '../../../lib/utils.js';
import { Button } from '../../ui/button.js';
import { ScrollArea } from '../../ui/scroll-area.js';
import { Tip } from '../../ui/tooltip.js';
import { CiLogView } from './CiLogView.js';
import { CiStatusIcon } from './CiStatusIcon.js';

/** What a row shows: a step, or the job itself as the whole log. */
interface StepLike {
  name: string;
  status: CiStatus;
  startedAt: string | null;
  completedAt: string | null;
}

function StepRow({
  step,
  selected,
  onSelect,
}: {
  step: StepLike;
  selected: boolean;
  onSelect: (() => void) | null;
}) {
  const duration = ciDuration(step.startedAt, step.completedAt);
  const body = (
    <>
      <CiStatusIcon status={step.status} />
      <span className="min-w-0 flex-1 truncate">{step.name}</span>
      {duration && (
        <span className="shrink-0 font-mono text-xs text-muted-foreground tabular-nums">
          {duration}
        </span>
      )}
    </>
  );
  const row =
    'flex h-7 w-full min-w-0 items-center gap-2 rounded-md px-2 text-left text-sm';
  // A step is a button only where it has a log of its own (Azure).
  if (!onSelect) {
    return (
      <li className={row} data-ci-step={step.name}>
        {body}
      </li>
    );
  }
  return (
    <li data-ci-step={step.name}>
      <button
        type="button"
        onClick={onSelect}
        aria-pressed={selected}
        className={cn(
          row,
          'transition-colors',
          selected ? 'bg-sidebar-active' : 'hover:bg-sidebar-accent'
        )}
      >
        {body}
      </button>
    </li>
  );
}

/**
 * A selected job: its steps, and a log. The log is the job's own to
 * begin with; on Azure, where every task has a log, choosing a step
 * shows that step's. GitHub's logs are per job, so its steps are
 * listed without one.
 */
export function CiJobDetail({
  cwd,
  job,
  onClose,
  onOpen,
}: {
  cwd: string;
  job: CiJob;
  onClose: () => void;
  onOpen: (url: string) => void;
}) {
  const [stepId, setStepId] = useState<string | null>(null);
  const step = job.steps.find((s) => s.id === stepId && s.log) ?? null;
  const ref: CiLogRef | null = step?.log ?? job.log;
  const log = useCiLog(cwd, ref);
  const hasStepLogs = job.steps.some((s) => s.log);
  const { url } = job;

  return (
    <div
      aria-label={`${job.name} details`}
      className="flex min-h-0 flex-1 border-t border-border"
    >
      <div className="flex w-80 shrink-0 flex-col border-r border-border">
        <header className="flex h-8 shrink-0 items-center gap-2 border-b border-border pr-1 pl-3">
          <CiStatusIcon status={job.status} />
          <h3 className="min-w-0 flex-1 truncate text-sm font-semibold">
            {job.name}
          </h3>
          {url && (
            <Tip label="Open in the browser">
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Open ${job.name} in the browser`}
                onClick={() => onOpen(url)}
              >
                <ExternalLinkIcon />
              </Button>
            </Tip>
          )}
          <Tip label="Close">
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Close job details"
              onClick={onClose}
            >
              <XIcon />
            </Button>
          </Tip>
        </header>
        <ScrollArea className="min-h-0 flex-1">
          {job.steps.length === 0 ? (
            <p className="p-3 text-sm text-muted-foreground">No steps.</p>
          ) : (
            <ol aria-label="Steps" className="space-y-0.5 p-1.5">
              {hasStepLogs && (
                <StepRow
                  step={{ ...job, name: 'Whole job' }}
                  selected={step === null}
                  onSelect={() => setStepId(null)}
                />
              )}
              {job.steps.map((s) => (
                <StepRow
                  key={s.id}
                  step={s}
                  selected={s.id === step?.id}
                  onSelect={s.log ? () => setStepId(s.id) : null}
                />
              ))}
            </ol>
          )}
        </ScrollArea>
      </div>
      <CiLogView
        title={step ? step.name : job.name}
        log={log.data}
        isLoading={log.isLoading}
        error={log.error}
        onRetry={() => void log.refetch()}
        missing={ref ? null : missingJobLogReason(job)}
      />
    </div>
  );
}
