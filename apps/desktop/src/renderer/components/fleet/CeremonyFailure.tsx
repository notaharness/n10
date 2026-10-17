import type { CeremonyOp } from '../../lib/fleet/ceremony-progress.js';
import {
  CREATE_FAILURE_NOTE,
  SAME_PASSKEY_NOTE,
  failureCopy,
  type NextAction,
} from '../../lib/fleet/ceremony-errors.js';
import { useFocusOnMount } from '../../lib/fleet/use-focus-on-mount.js';
import { Button } from '../ui/button.js';
import { openLink } from '../../lib/open-link.js';

interface Handlers {
  retry?: () => void;
  back?: () => void;
  close: () => void;
}

const LABEL: Record<keyof Handlers, string> = {
  retry: 'Try again',
  back: 'Back',
  close: 'Close',
};

/** The actions to offer: the catalogue's that this surface can run,
 *  then Close, so no result is a dead end. */
function runnable(actions: NextAction[], handlers: Handlers) {
  const offered = actions.filter(
    (a): a is keyof Handlers => a !== 'compatibility' && !!handlers[a]
  );
  if (!offered.includes('back') && !offered.includes('close')) {
    offered.push('close');
  }
  return offered;
}

function FailureExplanation({
  op,
  code,
  reachedPasskey,
}: {
  op: CeremonyOp;
  code: string;
  reachedPasskey: boolean;
}) {
  const createPrf = op === 'init' && code === 'prf-unsupported';
  return (
    <>
      <h3 className="text-xl font-semibold">
        {createPrf
          ? 'This passkey could not finish setup.'
          : failureCopy(code).explanation}
      </h3>
      {createPrf && (
        <p>
          Your browser or passkey provider did not return the encryption data
          beam needs (WebAuthn PRF). Fleet creation is not complete. A passkey
          may still be saved.
        </p>
      )}
      {code === 'prf-unsupported' && !createPrf && (
        <p>
          Update your browser and passkey manager, then start a fresh request.
        </p>
      )}
      {op === 'init' && reachedPasskey && !createPrf && (
        <p>{CREATE_FAILURE_NOTE}</p>
      )}
      {op !== 'init' &&
        ['prf-unsupported', 'wrong-passkey', 'bad-assertion'].includes(
          code
        ) && <p>{SAME_PASSKEY_NOTE}</p>}
    </>
  );
}

/**
 * A ceremony that ended in failure (beam-fleet-ux.md §4): what it means,
 * beam's exact code and its own detail, and only the next actions that
 * can run here. No link from the failed request stays on screen.
 */
export function CeremonyFailure({
  op,
  code,
  detail,
  reachedPasskey = false,
  handlers,
}: {
  op: CeremonyOp;
  code: string;
  detail: string | null;
  /** The ceremony got as far as offering a passkey link. */
  reachedPasskey?: boolean;
  handlers: Handlers;
}) {
  const copy = failureCopy(code);
  const focus = useFocusOnMount<HTMLDivElement>();
  return (
    <div className="space-y-3">
      <div
        ref={focus}
        tabIndex={-1}
        role="alert"
        className="space-y-2 text-base outline-none"
      >
        <FailureExplanation
          op={op}
          code={code}
          reachedPasskey={reachedPasskey}
        />
      </div>
      <details className="text-sm text-muted-foreground">
        <summary>Details</summary>
        {code === 'prf-unsupported' && (
          <p>This passkey did not provide WebAuthn PRF.</p>
        )}
        <p>
          <code className="font-mono text-foreground select-all">{code}</code>
        </p>
        {detail && (
          <p className="font-mono text-sm break-words text-muted-foreground select-text">
            {detail}
          </p>
        )}
      </details>
      {copy.actions.includes('compatibility') && (
        <Button variant="link" className="h-auto p-0" asChild>
          <a
            href="https://github.com/notaharness/n10/blob/master/docs/design/beam-fleet-ux.md#7-compatibility-evidence-and-exact-user-facing-help"
            onClick={(event) => {
              event.preventDefault();
              openLink(event.currentTarget.href);
            }}
          >
            Passkey compatibility
          </a>
        </Button>
      )}
      {op === 'init' && copy.actions.includes('retry') && handlers.retry && (
        <p className="text-sm text-muted-foreground">
          This restarts both passkey prompts.
        </p>
      )}
      <div className="flex justify-end gap-2">
        {runnable(copy.actions, handlers).map((a, i) => (
          <Button
            key={a}
            variant={i === 0 ? 'default' : 'outline'}
            onClick={handlers[a]}
          >
            {a === 'retry' && op === 'init'
              ? 'Start again'
              : a === 'retry' && code === 'ceremony-timeout'
              ? 'Start a fresh request'
              : LABEL[a]}
          </Button>
        ))}
      </div>
    </div>
  );
}
