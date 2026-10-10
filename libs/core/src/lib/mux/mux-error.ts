/** Stable, machine-readable mux failures. */
export type MuxErrorCode =
  | 'HOST_NOT_RUNNING'
  | 'AUTH_FAILED'
  | 'VERSION_UNSUPPORTED'
  | 'NOT_FOUND'
  | 'IDENTITY_MISMATCH'
  | 'STALE_GENERATION'
  | 'RUNNING'
  | 'INVALID_REQUEST'
  | 'SPAWN_FAILED'
  | 'UNSUPPORTED'
  | 'OUTPUT_LIMIT'
  | 'OUTCOME_UNKNOWN';

/** The exit status a one-shot client ends with for each failure:
 *  2 a request or output out of bounds, 3 no such owner or session,
 *  4 authentication or version, 5 state that changed underneath. */
export const MUX_EXIT_STATUS: Record<MuxErrorCode, number> = {
  INVALID_REQUEST: 2,
  OUTPUT_LIMIT: 2,
  HOST_NOT_RUNNING: 3,
  NOT_FOUND: 3,
  AUTH_FAILED: 4,
  VERSION_UNSUPPORTED: 4,
  IDENTITY_MISMATCH: 5,
  STALE_GENERATION: 5,
  RUNNING: 5,
  SPAWN_FAILED: 1,
  UNSUPPORTED: 1,
  OUTCOME_UNKNOWN: 1,
};

export class MuxError extends Error {
  constructor(readonly code: MuxErrorCode, message: string) {
    super(message);
    this.name = 'MuxError';
  }
}

export function isMuxErrorCode(code: unknown): code is MuxErrorCode {
  return typeof code === 'string' && code in MUX_EXIT_STATUS;
}
