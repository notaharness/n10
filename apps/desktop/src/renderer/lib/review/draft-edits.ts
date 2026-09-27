import type {
  DraftTarget,
  PullRequestRef,
  ReviewDraft,
} from '../../../host/contract.js';
import { pullRequestKey } from '@n10/vcs-core/pr-details';

/**
 * What the reviewer has typed and whether it is kept yet, held outside
 * any component. A composer can unmount at any moment — scrolled out
 * of the virtual list, its tab hidden, its thread collapsed — and the
 * text it held, the pause before its save and a save that failed all
 * outlive it here. Nothing is lost while the renderer runs; the store
 * on disk is what survives a restart.
 *
 * Entries are keyed by repository, pull request, account and target,
 * so text typed as one account is never shown or saved as another.
 */

export type SaveState =
  | { kind: 'idle' }
  | { kind: 'saving' }
  | { kind: 'saved'; at: number }
  | { kind: 'failed'; error: string };

export interface Edit {
  text: string;
  save: SaveState;
}

export interface SaveRequest {
  /** The checkout the text was typed in; not sent to the host. */
  cwd: string;
  ref: PullRequestRef;
  viewer: string | null;
  target: DraftTarget;
  body: string;
}

export interface EditIo {
  save: (req: SaveRequest) => Promise<ReviewDraft | null>;
  /** Told of each stored answer, to keep the drafts list current. */
  saved: (req: SaveRequest, draft: ReviewDraft | null) => void;
  now: () => number;
  setTimer: (fn: () => void, ms: number) => number;
  clearTimer: (id: number) => void;
}

interface Slot {
  edit: Edit;
  req: SaveRequest;
  timer: number | null;
  seq: number;
}

export const SAVE_DELAY_MS = 400;

/** An inline draft is known by its key: its anchor is data, not identity. */
function targetKey(target: DraftTarget): string {
  switch (target.kind) {
    case 'reply':
      return `reply:${target.threadId}`;
    case 'inline':
      return `inline:${target.key}`;
    default:
      return target.kind;
  }
}

export function sameTarget(a: DraftTarget, b: DraftTarget): boolean {
  return targetKey(a) === targetKey(b);
}

export function editKey(req: Omit<SaveRequest, 'body'>): string {
  return JSON.stringify([
    req.cwd,
    pullRequestKey(req.ref),
    req.viewer?.toLowerCase() ?? null,
    targetKey(req.target),
  ]);
}

export class DraftEdits {
  private slots = new Map<string, Slot>();
  private listeners = new Set<() => void>();
  private next = 0;

  constructor(private readonly io: EditIo) {}

  subscribe = (cb: () => void): (() => void) => {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  };

  get = (key: string): Edit | undefined => this.slots.get(key)?.edit;

  /** Take `req.body` as the text, and save it after the pause. */
  type(key: string, req: SaveRequest): void {
    const slot = this.slots.get(key);
    if (slot?.timer != null) this.io.clearTimer(slot.timer);
    const timer = this.io.setTimer(() => this.flush(key), SAVE_DELAY_MS);
    // A failure stands until a save succeeds: typing does not make the
    // text any safer, and the alert should not blink with each key.
    const failed = slot?.edit.save.kind === 'failed';
    this.put(key, {
      edit: {
        text: req.body,
        save: failed ? slot.edit.save : { kind: 'saving' },
      },
      req,
      timer,
      seq: slot?.seq ?? 0,
    });
  }

  /** Take `text` with nowhere to save it: no pull request identity. */
  local(key: string, req: SaveRequest): void {
    this.put(key, {
      edit: { text: req.body, save: { kind: 'idle' } },
      req,
      timer: null,
      seq: this.slots.get(key)?.seq ?? 0,
    });
  }

  /** Save now what is waiting. */
  flush(key: string): void {
    const slot = this.slots.get(key);
    if (slot?.timer == null) return;
    this.io.clearTimer(slot.timer);
    this.write(key, { ...slot, timer: null });
  }

  /** Whether any text failed to save, and so exists only here. */
  hasFailed(): boolean {
    for (const slot of this.slots.values()) {
      if (slot.edit.save.kind === 'failed') return true;
    }
    return false;
  }

  /** Save now everything waiting: the page is going away. */
  flushAll(): void {
    for (const key of this.slots.keys()) this.flush(key);
  }

  /** Save again what failed to save. */
  retry(key: string): void {
    const slot = this.slots.get(key);
    if (!slot || slot.edit.save.kind !== 'failed') return;
    this.write(key, slot);
  }

  /** Drop the text: it was discarded or sent. A save in flight for it
   *  still lands, but no longer speaks for what is on screen. */
  forget(key: string): void {
    const slot = this.slots.get(key);
    if (!slot) return;
    if (slot.timer != null) this.io.clearTimer(slot.timer);
    this.slots.delete(key);
    this.notify();
  }

  private write(key: string, slot: Slot): void {
    const seq = ++this.next;
    const { req } = slot;
    this.put(key, {
      ...slot,
      seq,
      edit: { ...slot.edit, save: { kind: 'saving' } },
    });
    this.io.save(req).then(
      (draft) => {
        this.io.saved(req, draft);
        this.settle(key, seq, { kind: 'saved', at: this.io.now() });
      },
      (err: unknown) =>
        this.settle(key, seq, {
          kind: 'failed',
          error: err instanceof Error ? err.message : String(err),
        })
    );
  }

  /** Only the latest save speaks for the text, and only while nothing
   *  newer is waiting to be saved. */
  private settle(key: string, seq: number, save: SaveState): void {
    const slot = this.slots.get(key);
    if (!slot || slot.seq !== seq || slot.timer != null) return;
    this.put(key, { ...slot, edit: { ...slot.edit, save } });
  }

  private put(key: string, slot: Slot): void {
    this.slots.set(key, slot);
    this.notify();
  }

  private notify(): void {
    for (const cb of this.listeners) cb();
  }
}
