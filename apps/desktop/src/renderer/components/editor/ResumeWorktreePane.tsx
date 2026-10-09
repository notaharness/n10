import type { RefObject } from 'react';
import type { WorktreeResume } from '../../../host/contract.js';
import { useLaunchAgent } from '../../lib/data/mutations.js';
import { useTabs } from '../../lib/tabs/tabs.js';
import { errorMessage } from '../../lib/utils.js';
import { Button } from '../ui/button.js';

export function ResumeWorktreePane({
  tabId,
  title,
  repo,
  branch,
  restore,
  paneRef,
  estimateGrid,
}: {
  tabId: string;
  title: string;
  repo: string;
  branch: string;
  restore: WorktreeResume;
  paneRef: RefObject<HTMLDivElement | null>;
  estimateGrid: () => { cols?: number; rows?: number };
}) {
  const resume = useLaunchAgent(repo);
  const tabs = useTabs();
  return (
    <div
      ref={paneRef}
      className="flex h-full flex-col items-center justify-center gap-3"
      data-terminal-pane
    >
      <p className="text-sm text-muted-foreground">{title}</p>
      <Button
        disabled={resume.isPending}
        onClick={() =>
          resume.mutate(
            {
              branch,
              intent: 'continue-or-blank',
              ...estimateGrid(),
              restore,
            },
            { onSuccess: () => tabs.resumeItem(tabId) }
          )
        }
      >
        Resume session
      </Button>
      {resume.error && (
        <p role="alert" className="text-sm text-destructive">
          {errorMessage(resume.error)}
        </p>
      )}
    </div>
  );
}
