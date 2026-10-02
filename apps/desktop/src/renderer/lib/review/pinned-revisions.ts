import { useEffect, useSyncExternalStore } from 'react';

/**
 * The revision each pull request's diff is held at, for the life of the
 * renderer.
 *
 * Not the pane's state: a pane without a terminal unmounts when its tab
 * goes to the background, and a tab that follows its worktree onto
 * another branch keeps its pane while its pull request changes. Held
 * here, keyed by repository and pull request, the revision survives the
 * first and cannot leak across the second — and a pull request closed
 * and opened again comes back where the reader left it, with anything
 * newer offered rather than swapped in.
 *
 * A pin is what the provider reported when the diff was first read: the
 * head and the target branch. Once read, the target commit it resolved
 * to joins it, so a read after the cache lets go resolves to the same
 * comparison. Only the reader moves a pin that has been shown; one whose
 * read never put anything on screen follows the provider (`shouldFollow`).
 */

export interface PinnedRevision {
  /** Absent when the provider reports no head: read at the branch. */
  head: string | undefined;
  target: string;
  targetOid?: string;
  /** The diff at this pin reached the screen. */
  shown?: boolean;
}

/** What the provider reports now. */
export interface ReportedRevision {
  head: string | undefined;
  target: string;
}

/** What the provider reports that the pin does not hold. */
export interface MovedRevision {
  /** The reported head, when it is not the pinned one. */
  head: string | null;
  /** The reported target branch, when it is not the pinned one. */
  target: string | null;
  /** The target branch the diff on screen is compared with. */
  readingTarget: string;
}

export function movedFrom(
  pin: PinnedRevision,
  reported: ReportedRevision
): MovedRevision | null {
  const head =
    reported.head !== undefined &&
    pin.head !== undefined &&
    reported.head !== pin.head
      ? reported.head
      : null;
  const target = reported.target !== pin.target ? reported.target : null;
  if (head === null && target === null) return null;
  return { head, target, readingTarget: pin.target };
}

/**
 * Whether to move the pin without the reader asking: only when its read
 * failed before anything reached the screen. There is nothing there to
 * keep, and the provider's newer revision may be readable.
 */
export function shouldFollow(
  pin: PinnedRevision,
  moved: MovedRevision | null,
  readFailed: boolean
): boolean {
  return moved !== null && readFailed && pin.shown !== true;
}

const pins = new Map<string, PinnedRevision>();
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function notify(): void {
  for (const listener of listeners) listener();
}

export function pinKey(repo: string, prId: number): string {
  return `${repo}#${prId}`;
}

export function setPin(key: string, pin: PinnedRevision): void {
  pins.set(key, pin);
  notify();
}

/** Add to a stored pin; nothing when there is none or nothing changes. */
export function updatePin(
  key: string,
  patch: Pick<PinnedRevision, 'targetOid' | 'shown'>
): void {
  const current = pins.get(key);
  if (!current) return;
  const next = { ...current, ...patch };
  if (next.targetOid === current.targetOid && next.shown === current.shown) {
    return;
  }
  pins.set(key, next);
  notify();
}

export function readPin(key: string): PinnedRevision | undefined {
  return pins.get(key);
}

/** Test hook: forget every pin. */
export function __resetPinsForTests(): void {
  pins.clear();
}

/**
 * The revision to read `key`'s diff at: the one pinned, else the one
 * the provider reports now, which becomes the pin once it names a head.
 * No reported head, no pin: the diff is read at the branch and says so.
 */
export function usePinnedRevision(
  key: string,
  reported: ReportedRevision
): PinnedRevision {
  const stored = useSyncExternalStore(subscribe, () => pins.get(key));
  const { head, target } = reported;
  useEffect(() => {
    if (stored === undefined && head !== undefined) {
      setPin(key, { head, target });
    }
  }, [key, stored, head, target]);
  return stored ?? { head, target };
}
