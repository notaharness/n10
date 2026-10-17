import { useQuery } from '@tanstack/react-query';
import { PlayIcon } from 'lucide-react';
import { useRef, useState } from 'react';
import type { PullRequestInfo } from '@n10/vcs-core';
import type {
  AgentId,
  LaunchStep,
  SessionIncarnation,
  SessionLaunchView,
} from '../../../host/contract.js';
import { useAgentOptions } from '../../lib/data/queries.js';
import { useGuidedReviewChoice } from './use-guided-review-choice.js';
import { agentIdForLaunch } from '../../lib/agent-pick.js';
import { useMachineChoice } from '../../lib/machines/use-machine-choice.js';
import { LaunchDialogBody } from './LaunchDialogBody.js';
import { firstField, useLaunchFocus } from './launch-keyboard.js';
import { focusAfter } from '../../lib/focus.js';
import { Button } from '../ui/button.js';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog.js';
import { ToggleGroup, ToggleGroupItem } from '../ui/toggle-group.js';

export type LaunchChoice =
  | {
      kind: 'session';
      fresh: boolean;
      agentId?: AgentId;
      expected?: SessionIncarnation;
      /** A beam peerId to launch on (ux-machines.md §5), or omitted for
       *  local — never set for a "continue", which resumes on whatever
       *  machine its session already lives on. */
      machine?: string;
    }
  | {
      kind: 'review';
      instruction?: string;
      /** Ask for a guided review too. */
      guide: boolean;
      agentId?: AgentId;
      expected?: SessionIncarnation;
      machine?: string;
    };
export type Mode = 'continue' | 'new' | 'review';

/** Session choices are based on a native snapshot, also used to guard replacement. */
export function LaunchDialog({
  pr,
  branch,
  cwd,
  hasWorktree,
  busy,
  remoteStep,
  remoteError,
  onChoose,
  onClose,
}: {
  pr?: PullRequestInfo;
  branch: string;
  cwd: string;
  hasWorktree: boolean;
  /** True while a launch (local or remote) is in flight. */
  busy?: boolean;
  /** Set only during a remote launch (ux-machines.md §5). */
  remoteStep?: LaunchStep | null;
  remoteError?: string | null;
  onChoose: (choice: LaunchChoice) => void;
  onClose: () => void;
}) {
  const context = useQuery({
    queryKey: ['session-launch-context', cwd, branch],
    queryFn: () => window.n10.getSessionLaunchContext(branch),
    staleTime: 0,
    refetchOnWindowFocus: false,
  });
  const [selected, setSelected] = useState<Mode | null>(null);
  const [instruction, setInstruction] = useState('');
  const [guide, setGuide] = useGuidedReviewChoice();
  const options = useAgentOptions(cwd);
  const agents = options.data ?? [];
  const [agentIndex, setAgentIndex] = useState(0);
  const machineChoice = useMachineChoice();
  const info = context.data;
  const canContinue = canContinueSession(info);
  const mode = selectedMode(selected, canContinue);
  const replacing = isReplacing(mode, info);
  // A "continue" resumes on whatever machine its session already lives
  // on — the choice is meaningless there even if a peer was picked
  // before switching mode.
  const machine =
    mode === 'continue' ? undefined : machineChoice.selectedMachine();
  const disabled =
    launchDisabled(
      info,
      context.isFetching,
      context.isError,
      mode,
      agents.length
    ) || Boolean(busy);
  const go = () => {
    if (!info || disabled) return;
    onChoose(
      launchChoice(
        mode,
        info,
        { instruction, guide },
        agentIdForLaunch(agents, agentIndex),
        machine
      )
    );
  };
  const action = actionLabel(mode, info, replacing);
  const content = useRef<HTMLDivElement>(null);
  useLaunchFocus(content, mode === 'continue', !disabled);
  // From the keyboard, choosing a mode moves on to its first field.
  const choose = (next: Mode, fromKeyboard: boolean) => {
    setSelected(next);
    if (fromKeyboard)
      focusAfter(() => firstField(content.current, next === 'continue'));
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        ref={content}
        data-launch-dialog
        // Its fields are disabled until loaded; `useLaunchFocus` moves
        // focus on to them from here.
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          content.current?.focus();
        }}
        className="flex max-h-[calc(100dvh-2rem)] min-w-0 flex-col gap-0 overflow-hidden p-0 sm:max-w-xl"
      >
        <div className="min-h-0 min-w-0 overflow-y-auto">
          <LaunchHeader pr={pr} branch={branch} hasWorktree={hasWorktree} />
          <ToggleGroup
            type="single"
            value={mode}
            aria-label="Session action"
            className="gap-1 border-b px-5 pb-4"
          >
            {canContinue && (
              <Action value="continue" onChoose={choose}>
                Continue
              </Action>
            )}
            <Action value="new" onChoose={choose}>
              New session
            </Action>
            {pr && (
              <Action value="review" onChoose={choose}>
                Review
              </Action>
            )}
          </ToggleGroup>
          <LaunchDialogBody
            mode={mode}
            info={info}
            fetching={context.isFetching}
            contextError={context.error}
            agentOptionsError={options.error}
            agents={agents}
            agentIndex={agentIndex}
            onAgentIndexChange={setAgentIndex}
            machineChoice={machineChoice}
            remoteStep={remoteStep}
            remoteError={remoteError}
            instruction={instruction}
            onInstructionChange={setInstruction}
            guide={guide}
            onGuideChange={setGuide}
            onSubmit={go}
            replacing={replacing}
          />
        </div>
        <DialogFooter className="shrink-0 flex-wrap border-t px-5 py-4">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            data-launch-action
            onClick={go}
            disabled={disabled}
            className="h-auto min-h-8 whitespace-normal text-left"
          >
            <PlayIcon className="shrink-0" />
            {action}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Action({
  value,
  onChoose,
  children,
}: {
  value: Mode;
  onChoose: (mode: Mode, fromKeyboard: boolean) => void;
  children: string;
}) {
  return (
    <ToggleGroupItem
      value={value}
      // Chosen here, not by the group's own toggle, as in the new
      // terminal dialog: a second press on the chosen mode — Enter,
      // Space or a click — must not clear it. A click from a key has
      // no pointer `detail`.
      onClick={(e) => {
        e.preventDefault();
        onChoose(value, e.detail === 0);
      }}
      className="min-w-0 flex-1 rounded-md border border-transparent px-2 py-2 text-sm data-[state=on]:border-primary data-[state=on]:bg-primary/10 data-[state=on]:text-primary"
    >
      {children}
    </ToggleGroupItem>
  );
}

function canContinueSession(info?: SessionLaunchView) {
  return Boolean(info?.exists && (info.running || info.canResume));
}
function selectedMode(selected: Mode | null, canContinue: boolean): Mode {
  if (selected === 'continue' && !canContinue) return 'new';
  return selected ?? (canContinue ? 'continue' : 'new');
}
function launchDisabled(
  info: SessionLaunchView | undefined,
  fetching: boolean,
  error: boolean,
  mode: Mode,
  agents: number
) {
  return !info || fetching || error || (mode !== 'continue' && agents === 0);
}
function launchChoice(
  mode: Mode,
  info: SessionLaunchView,
  review: { instruction: string; guide: boolean },
  agentId: AgentId | undefined,
  machine: string | undefined
): LaunchChoice {
  if (mode === 'review')
    return {
      kind: 'review',
      agentId,
      instruction: review.instruction.trim() || undefined,
      guide: review.guide,
      expected: info.incarnation,
      machine,
    };
  return {
    kind: 'session',
    agentId: mode === 'new' ? agentId : undefined,
    fresh: mode === 'new',
    expected: info.incarnation,
    machine,
  };
}
function actionLabel(
  mode: Mode,
  info: SessionLaunchView | undefined,
  replacing: boolean
) {
  if (mode === 'continue')
    return `${info?.running ? 'Open' : 'Continue with'} ${
      info?.recordedAgentName ?? 'session'
    }`;
  const subject = mode === 'review' ? 'review' : 'new session';
  return `${replacing ? 'Stop and start' : 'Start'} ${subject}`;
}

function isReplacing(mode: Mode, info?: SessionLaunchView) {
  return mode !== 'continue' && Boolean(info?.running);
}
function LaunchHeader({
  pr,
  branch,
  hasWorktree,
}: {
  pr?: PullRequestInfo;
  branch: string;
  hasWorktree: boolean;
}) {
  return (
    <DialogHeader className="min-w-0 px-5 pt-5 pr-10 pb-4">
      {pr && (
        <p className="text-sm text-muted-foreground">Pull request #{pr.id}</p>
      )}
      <DialogTitle className="min-w-0 leading-snug [overflow-wrap:anywhere]">
        {pr?.title || branch}
      </DialogTitle>
      <DialogDescription className="min-w-0 [overflow-wrap:anywhere]">
        {pr ? `${pr.sourceBranch} → ${pr.targetBranch}` : 'Worktree'}
        {!hasWorktree && ' · a worktree will be created first'}
      </DialogDescription>
    </DialogHeader>
  );
}
