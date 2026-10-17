import type { CeremonyProgress, CeremonyRequest } from '@n10/engine/contract';

export type CeremonyOp = CeremonyRequest['op'];

/** Where a running ceremony is, from the host's progress events. */
type CeremonyPhase =
  | 'preparing'
  | 'passkey'
  | 'reading-directory'
  | 'notifying-peers'
  | 'publishing';

export interface CeremonyView {
  op: CeremonyOp;
  phase: CeremonyPhase;
  /** The passkey step reached: 0 before the first link, then 1, and
   *  2 for `init`'s second prompt. */
  step: number;
  /** The live link, only while beam waits on that passkey step. */
  passkeyUrl: string | null;
  cancelling: boolean;
}

export function startView(op: CeremonyOp): CeremonyView {
  return {
    op,
    phase: 'preparing',
    step: 0,
    passkeyUrl: null,
    cancelling: false,
  };
}

/** beam's `stage` names (docs/06, docs/07) and the host's own. */
const STAGES: Record<string, CeremonyPhase> = {
  'preparing network': 'preparing',
  'reading directory': 'reading-directory',
  'notifying peers': 'notifying-peers',
  publishing: 'publishing',
};

/**
 * One progress event folded in. A new passkey link replaces the old
 * one outright, and any stage after it drops the link: a finished
 * step's link is never left showing.
 */
export function ceremonyStep(
  view: CeremonyView,
  progress: CeremonyProgress
): CeremonyView {
  if (progress.kind === 'passkey') {
    const second = view.op === 'init' && progress.step === 'sign';
    return {
      ...view,
      phase: 'passkey',
      step: second ? 2 : 1,
      passkeyUrl: progress.ceremonyUrl,
    };
  }
  if (!Object.hasOwn(STAGES, progress.stage)) return view;
  return { ...view, phase: STAGES[progress.stage], passkeyUrl: null };
}

/** The two passkey prompts a fleet's creation needs, always listed. */
export const INIT_STEPS = ['Save a passkey', 'Add this machine'] as const;

/** The passkey steps are answered: beam is doing its own work. */
export function pastPasskeys(view: CeremonyView): boolean {
  return view.phase !== 'preparing' && view.phase !== 'passkey';
}

export type StepStatus = 'pending' | 'active' | 'done' | 'failed';

/** Each of `init`'s steps, given how far the view got and whether it
 *  failed. The step a failure or cancellation stopped on is `failed`,
 *  never `done`. */
export function initStepStatuses(
  view: CeremonyView,
  failed: boolean
): StepStatus[] {
  const past = pastPasskeys(view);
  return INIT_STEPS.map((_, i) => {
    const n = i + 1;
    if (past || n < view.step) return 'done';
    if (n > view.step) return 'pending';
    return failed ? 'failed' : 'active';
  });
}

interface CeremonyHeading {
  heading: string;
  explanation: string | null;
}

const PREPARING: CeremonyHeading = {
  heading: 'Getting ready…',
  explanation: null,
};

const PUBLISHING: Record<CeremonyOp, CeremonyHeading> = {
  init: {
    heading: 'Finishing setup…',
    explanation: null,
  },
  join: { heading: 'Finishing setup…', explanation: null },
  revoke: { heading: 'Revoking access…', explanation: null },
};

const PASSKEY: Record<CeremonyOp, CeremonyHeading[]> = {
  init: [
    {
      heading: '1 of 2 · Save a passkey',
      explanation: 'Open or scan to save your fleet’s passkey.',
    },
    {
      heading: '2 of 2 · Add this machine',
      explanation: 'Use the passkey you just saved.',
    },
  ],
  join: [
    {
      heading: 'Add this machine',
      explanation: 'Use your fleet’s existing passkey.',
    },
  ],
  revoke: [{ heading: 'Confirm with your passkey', explanation: null }],
};

/** What a running ceremony says at the top, from its latest signal. */
export function ceremonyHeading(view: CeremonyView): CeremonyHeading {
  if (view.cancelling) return { heading: 'Cancelling…', explanation: null };
  switch (view.phase) {
    case 'preparing':
      return PREPARING;
    case 'passkey':
      return PASSKEY[view.op][view.step - 1];
    case 'reading-directory':
      return { heading: 'Finding machines…', explanation: null };
    case 'notifying-peers':
      return { heading: 'Updating machines…', explanation: null };
    case 'publishing':
      return PUBLISHING[view.op];
  }
}
