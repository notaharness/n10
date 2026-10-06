/**
 * beam-fleet-ux.md §4: what each failure code tells the owner, and the
 * next actions that can actually run from it. `retry` starts the same
 * flow afresh, `back` returns to its form with the values kept,
 * `close` leaves the result, `compatibility` opens the passkey help.
 */
export type NextAction = 'retry' | 'back' | 'close' | 'compatibility';

interface FailureCopy {
  explanation: string;
  actions: NextAction[];
}

const CAPACITY: FailureCopy = {
  explanation: 'Limit reached. Check the details.',
  actions: ['close'],
};

const INTERNAL: FailureCopy = {
  explanation: 'Couldn’t complete this request. Check Fleet and the details.',
  actions: ['close'],
};

const CATALOGUE: Record<string, FailureCopy> = {
  'prf-unsupported': {
    explanation: 'This passkey isn’t supported. Try another browser or device.',
    actions: ['compatibility', 'retry', 'back'],
  },
  'ceremony-cancelled': {
    explanation: 'Passkey request cancelled.',
    actions: ['retry', 'back'],
  },
  'ceremony-timeout': {
    explanation: 'Request expired. Try again.',
    actions: ['retry'],
  },
  'ceremony-state': {
    explanation: 'Couldn’t confirm the result. Check Fleet before retrying.',
    actions: ['close', 'retry'],
  },
  'bad-assertion': {
    explanation: 'Couldn’t verify the passkey. Try again.',
    actions: ['retry'],
  },
  'directory-unavailable': {
    explanation: 'Couldn’t reach your fleet. Check your connection and retry.',
    actions: ['retry'],
  },
  'wrong-passkey': {
    explanation: 'Wrong passkey. Choose your fleet’s original passkey.',
    actions: ['retry'],
  },
  busy: {
    explanation: 'Another request is open. Finish or cancel it first.',
    actions: ['back'],
  },
  'already-enrolled': {
    explanation: 'This machine already belongs to a fleet.',
    actions: ['close'],
  },
  'not-enrolled': {
    explanation: 'Create or join a fleet first.',
    actions: ['close'],
  },
  'revoked-peer': {
    explanation: 'Access revoked. Resetting won’t let this machine rejoin.',
    actions: ['close'],
  },
  'unknown-peer': {
    explanation: 'Machine no longer found. Check Fleet.',
    actions: ['close'],
  },
  'ambiguous-peer': {
    explanation: 'Names match. Choose by fingerprint.',
    actions: ['close'],
  },
  params: {
    explanation: 'Check the machine and fleet names.',
    actions: ['back'],
  },
  'bad-entry': {
    explanation: 'Couldn’t verify membership. Check the details.',
    actions: ['back'],
  },
  'storage-failure': {
    explanation: 'Couldn’t save. Check disk space and permissions.',
    actions: ['retry'],
  },
  offline: {
    explanation: 'Machine unreachable. Retry when it reconnects.',
    actions: ['close'],
  },
  grant: {
    explanation: 'This machine hasn’t allowed access.',
    actions: ['close'],
  },
  limit: CAPACITY,
  'queue-full': CAPACITY,
  spawn: {
    explanation: 'Couldn’t start the process. Check the details.',
    actions: ['back'],
  },
  internal: INTERNAL,
  'connection-lost': {
    explanation:
      'Connection lost. Check Fleet before retrying; this may have completed.',
    actions: ['close'],
  },
};

/** The copy for `code`; an unknown code reads as `internal`. */
export function failureCopy(code: string): FailureCopy {
  return Object.hasOwn(CATALOGUE, code) ? CATALOGUE[code] : INTERNAL;
}

/** A PRF failure while joining or revoking: the fix is a supported
 *  provider for the same passkey, not a new one. */
export const SAME_PASSKEY_NOTE =
  'Use the same fleet passkey. A new one creates a different fleet.';

/** Shown on top of any failure of a fleet's creation once its first
 *  passkey prompt was offered: a passkey may already exist. */
export const CREATE_FAILURE_NOTE =
  'A passkey may have been saved. Check Fleet before trying again.';
