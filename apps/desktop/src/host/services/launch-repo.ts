/**
 * The repository a later launch named (main/second-launch.ts), kept
 * until a page is listening for it.
 *
 * Main cannot tell from outside when the renderer has subscribed to
 * menu commands, so the page says so: it claims on mount, taking any
 * launch that arrived first, and later launches go to it directly. A
 * page that navigates away or closes gives the claim up, so a launch
 * during a reload, or with no window, waits for the next page.
 */

let waiting: string | null = null;
let claimed = false;

/** True when a page has claimed launches and `cwd` should go to it
 *  now; otherwise `cwd` waits, replacing any launch before it. */
export function offerLaunchRepo(cwd: string): boolean {
  if (claimed) return true;
  waiting = cwd;
  return false;
}

/** A page is listening: it takes the launch that waited, if any. */
export function claimLaunchRepo(): string | null {
  claimed = true;
  const cwd = waiting;
  waiting = null;
  return cwd;
}

/** The page that claimed is navigating away or closing. */
export function releaseLaunchRepo(): void {
  claimed = false;
}
