/**
 * Writes against an optimistic repository switch.
 *
 * Opening a repository the renderer already holds shows it before the
 * host has selected it (`openRepoAsync`). Writes name no repository:
 * the host applies them to the one it has selected. So a write made
 * from the shown repository waits until the host has answered the open,
 * and one made while a failed open was still on screen is refused: the
 * host never left the repository before, and the write was meant for
 * the other one. The refusal holds until the window shows the
 * repository the host has selected again (`repoShown`).
 */

interface Switch {
  /** Settles when the host has answered the open; rejects if it failed. */
  readonly landed: Promise<void>;
  /** The repository the window returns to if the open fails; null for
   *  the repository picker, where nothing writes. */
  readonly previous: string | null;
  failed: boolean;
}

let current: Switch | null = null;

/** The window shows a repository the host is still opening. */
export function switchStarted(
  open: Promise<unknown>,
  previous: string | null
): void {
  const sw: Switch = {
    previous,
    failed: false,
    landed: open.then(
      () => {
        if (current === sw) current = null;
      },
      () => {
        sw.failed = true;
        throw new Error(
          'That repository did not open, so this was not done. Try again.'
        );
      }
    ),
  };
  // Only writes observe a failure; with none waiting it is not an error.
  sw.landed.catch(() => undefined);
  current = sw;
}

/** The window now shows `cwd`. A failed switch's refusal ends once the
 *  repository it returned to is on screen. */
export function repoShown(cwd: string): void {
  if (current?.failed && (current.previous ?? cwd) === cwd) current = null;
}

/** Resolves when a write may go to the host; rejects one a failed switch
 *  caught. Every repository write waits on it. */
export function writable(): Promise<void> {
  return current?.landed ?? Promise.resolve();
}
