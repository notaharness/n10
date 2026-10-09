/** Stable, machine-readable mux failures. */
export type MuxErrorCode =
  | 'HOST_NOT_RUNNING'
  | 'AUTH_FAILED'
  | 'VERSION_UNSUPPORTED'
  | 'UNSUPPORTED';

export class MuxError extends Error {
  constructor(readonly code: MuxErrorCode, message: string) {
    super(message);
    this.name = 'MuxError';
  }
}
