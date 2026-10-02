import { Banner } from '../ui/banner.js';
import { Button } from '../ui/button.js';

/**
 * The terminal pane's connection banner (ux-machines.md §6). A dropped
 * network connection must never look like the agent exited — that
 * affordance is gated on `processState` elsewhere (TerminalView,
 * ContentPane), never on this — so this renders only for
 * `reconnecting`/`failed` and shows the terminal content underneath
 * unobstructed.
 *
 * `onReconnect` is the manual retry that follows Phase 5's bounded
 * automatic reconnect (3 attempts) giving up — rendered only on
 * `failed`, and only when the caller actually has an op to run: a
 * button that does nothing is worse than no button.
 */
export function ConnectionBanner({
  state,
  machineLabel,
  onReconnect,
  reconnecting,
}: {
  state: 'reconnecting' | 'failed';
  /** The remote machine's label, resolved by the caller — never a
   *  peerId, which means nothing to the user. */
  machineLabel: string;
  onReconnect?: () => void;
  /** True while a manual reconnect request is in flight. */
  reconnecting?: boolean;
}) {
  return (
    <Banner
      actions={
        state === 'failed' &&
        onReconnect && (
          <Button
            size="sm"
            variant="outline"
            disabled={reconnecting}
            onClick={onReconnect}
          >
            Reconnect
          </Button>
        )
      }
    >
      {state === 'reconnecting'
        ? `Reconnecting to ${machineLabel}…`
        : `Disconnected from ${machineLabel}`}
    </Banner>
  );
}
