/**
 * How long a read-only `gh` call may run before it is killed.
 *
 * Reads only. A killed read is simply asked again on the next cycle; a
 * killed mutation may or may not have reached GitHub, so a mutation is
 * never given a deadline. Without one, a `gh` that hangs holds its
 * caller forever — and the engine runs one pull request list request
 * per repository at a time, so every refresh would queue behind it.
 */
export const GH_READ_DEADLINE_MS = 30_000;

/** `execFile` options for a read: killed outright at the deadline. */
export const GH_READ_OPTIONS = {
  timeout: GH_READ_DEADLINE_MS,
  killSignal: 'SIGKILL',
} as const;

/** Whether `execFile` killed the child at its `timeout`: Node marks the
 *  error it rejects with as `killed`. */
export function killedAtDeadline(err: unknown): boolean {
  return (
    err != null &&
    typeof err === 'object' &&
    (err as { killed?: unknown }).killed === true
  );
}
