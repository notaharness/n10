/**
 * The repository a later launch named (main/second-launch.ts), kept
 * until a page is listening for it.
 *
 * Main cannot tell from outside when the renderer has subscribed to
 * menu commands, so the page says so: it claims on mount
 * (`takeLaunchRepo`, which the host hands to main), taking any launch
 * that arrived first, and later launches go to it directly. The claim
 * is the page's: once it ends, a launch waits for the next page.
 */

let waiting: string | null = null;
let claimant: number | null = null;

/** The page (by webContents id) that has claimed launches and should
 *  get `cwd` now; null when none has, and `cwd` waits, replacing any
 *  launch before it. */
export function offerLaunchRepo(cwd: string): number | null {
  if (claimant === null) waiting = cwd;
  return claimant;
}

/** `viewer`'s page is listening: it takes the launch that waited. */
export function claimLaunchRepo(viewer: number): string | null {
  claimant = viewer;
  const cwd = waiting;
  waiting = null;
  return cwd;
}

/** `viewer`'s page is gone; a claim another page made stands. */
export function releaseLaunchRepo(viewer: number): void {
  if (claimant === viewer) claimant = null;
}
