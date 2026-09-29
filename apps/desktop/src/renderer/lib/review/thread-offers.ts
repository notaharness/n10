import type {
  Capability,
  ConversationThread,
  RemoteCommentThread,
} from '../../../host/contract.js';

/**
 * What an activity card offers on a thread the diff also knows. A
 * provider that refuses an action, or has none, gets no control for it.
 * One that does not say (Azure DevOps states no thread permissions) gets
 * the control the diff's card offers, and its answer to the write says
 * the rest: hiding it would read `unknown` as refused.
 */

const refused = (c: Capability) =>
  c.state === 'forbidden' || c.state === 'unavailable';

export interface ThreadOffers {
  reply: boolean;
  resolve: boolean;
}

/** A review thread: reply and resolve each as the provider allows. */
export function threadOffers(
  thread: ConversationThread,
  remote: RemoteCommentThread
): ThreadOffers {
  return {
    reply: !refused(thread.capabilities.reply),
    resolve: remote.canResolve && !refused(thread.capabilities.resolve),
  };
}
