import { createContext, useContext, useMemo, type ReactNode } from 'react';
import type {
  Capability,
  RemoteCommentThread,
} from '../../../../host/contract.js';
import { useThreads } from '../../../lib/data/queries.js';
import { useRepo } from '../../../lib/repo-context.js';
import { ThreadFooter } from '../comments/ThreadFooter.js';
import { useThreadActions } from '../comments/use-thread-actions.js';
import { PlanAttachment, PlanControls } from '../PlanControls.js';

/**
 * The review threads the diff acts on, for the activity's cards to act
 * on too. A conversation thread or comment is the same one the diff's
 * comment read names by id: a GitHub review thread or conversation
 * comment, an Azure DevOps thread. Where the diff has not read it, the
 * card offers nothing it cannot do.
 */

interface ActivityActions {
  prId: number;
  byId: ReadonlyMap<string, RemoteCommentThread>;
}

const Actions = createContext<ActivityActions | null>(null);

export function ActivityActionsProvider({
  prId,
  children,
}: {
  prId: number;
  children: ReactNode;
}) {
  const { repo } = useRepo();
  const { data } = useThreads(repo.cwd, prId);
  const value = useMemo(() => {
    const all = [...(data?.threads ?? []), ...(data?.generalComments ?? [])];
    return { prId, byId: new Map(all.map((t) => [t.id, t])) };
  }, [data, prId]);
  return <Actions.Provider value={value}>{children}</Actions.Provider>;
}

/** The thread the diff knows by this id, and the pull request it is
 *  on; null where there is none to act on. */
export function useRemoteThread(
  id: string
): { prId: number; thread: RemoteCommentThread } | null {
  const ctx = useContext(Actions);
  const thread = ctx?.byId.get(id);
  return ctx && thread ? { prId: ctx.prId, thread } : null;
}

/** The provider lets the viewer do it. */
export const supported = (c: Capability) => c.state === 'supported';

/** A card's action controls: the plan's in its header, the note and
 *  the reply box and resolve button beneath it. */
export interface ActionsView {
  plan: ReactNode;
  footer: ReactNode;
}

/**
 * The diff card's actions for one activity card, each only where the
 * provider lets the viewer take it. Rendered only where the diff knows
 * the thread, since its hooks need one.
 */
export function ThreadActionsFor({
  remote,
  open,
  canReply,
  canResolve,
  onUnfold,
  children,
}: {
  remote: { prId: number; thread: RemoteCommentThread };
  /** The card shows its footer. */
  open: boolean;
  canReply: boolean;
  canResolve: boolean;
  /** Open the card, so a note being written can be seen. */
  onUnfold: () => void;
  children: (actions: ActionsView) => ReactNode;
}) {
  const { planControls: plan, footer } = useThreadActions(
    remote.prId,
    remote.thread,
    open
  );
  return children({
    plan: (
      <PlanControls
        inPlan={plan.inPlan}
        hasNote={plan.note !== undefined}
        onToggle={plan.toggleInPlan}
        onNote={() => {
          onUnfold();
          plan.startNote();
        }}
      />
    ),
    footer: (
      <>
        <PlanAttachment
          composing={plan.composing}
          note={plan.note}
          onSave={plan.saveNote}
          onCancel={plan.cancelNote}
          onEdit={plan.startNote}
        />
        {(canReply || canResolve) && (
          <ThreadFooter
            canReply={canReply}
            canResolve={canResolve}
            isResolved={remote.thread.isResolved}
            {...footer}
          />
        )}
      </>
    ),
  });
}
