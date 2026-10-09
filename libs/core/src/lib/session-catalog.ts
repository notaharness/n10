import type { SessionBackend, SessionSpec, SessionTarget } from '@n10/terminal';
import {
  sameTmuxIncarnation,
  type TmuxSessionIncarnation,
} from '@n10/terminal-tmux';
import { tmuxCatalog } from './tmux-catalog.js';

/**
 * One launch of the process a target hosts. A replacement or an
 * approval names the incarnation it saw, so a session that was
 * restarted, or a label reused after a kill, never matches it.
 */
export type SessionIncarnation = { kind: 'tmux' } & TmuxSessionIncarnation;

/** A persistent session as its catalog lists it, before core reads
 *  its tags. */
export interface CatalogSession {
  target: SessionTarget;
  /** Epoch seconds: orders two sessions that claim one identity. */
  created: number;
  /** The process ended and the session retains its screen. */
  exited: boolean;
  exitCode?: number;
  /** The directory the session runs in; `''` when unknown. */
  path: string;
  /** The requested tags that are set. */
  tags: Record<string, string>;
}

/** A session and the incarnation running it, read together. */
export interface CatalogSnapshot extends CatalogSession {
  incarnation: SessionIncarnation;
  /** The process the session runs, while it runs. */
  pid?: number;
}

/** What core asks a catalog to do when it opens a session. The caller
 *  decides identity and intent; the catalog performs them. */
export type SessionLaunchPlan =
  | {
      mode: 'create';
      label: string;
      tags: Record<string, string>;
      retainOnExit?: boolean;
      /** Labels the new session must not take. */
      excludedNames?: readonly string[];
    }
  | {
      mode: 'attach';
      target: SessionTarget;
      expected?: SessionIncarnation;
      expectedTags?: Record<string, string>;
    }
  | {
      mode: 'restart';
      target: SessionTarget;
      expected?: SessionIncarnation;
      expectedTags?: Record<string, string>;
      tags?: Record<string, string | null>;
      retainOnExit?: boolean;
    }
  | {
      mode: 'replace';
      target: SessionTarget;
      expected: SessionIncarnation;
      expectedTags?: Record<string, string>;
      tags?: Record<string, string | null>;
      retainOnExit?: boolean;
    };

/**
 * The persistent sessions on this machine and the operations core
 * performs on them. Every local listing, snapshot, kill and launch in
 * core goes through it; identity, from the tags, stays in core.
 */
export interface SessionCatalog {
  /** Every session with the requested tags, or `null` when the catalog
   *  could not be read. No sessions is an empty list. */
  list(tags: readonly string[]): CatalogSession[] | null;
  /** One session, or `null` when it is gone. */
  snapshot(
    target: SessionTarget,
    tags?: readonly string[]
  ): CatalogSnapshot | null;
  /** Ends the session. A session already gone is not an error. */
  kill(target: SessionTarget): void;
  open(spec: SessionSpec, plan: SessionLaunchPlan): Promise<SessionBackend>;
}

/** The catalog sessions on this machine live in. */
export function localCatalog(): SessionCatalog {
  return tmuxCatalog;
}

export function sameSessionTarget(a: SessionTarget, b: SessionTarget): boolean {
  return a.kind === b.kind && a.name === b.name;
}

/** The target an incarnation ran under. */
export function incarnationTarget(
  incarnation: SessionIncarnation
): SessionTarget {
  return { kind: incarnation.kind, name: incarnation.name };
}

/** Whether two incarnations name the exact same process. */
export function sameIncarnation(
  a: SessionIncarnation,
  b: SessionIncarnation
): boolean {
  return a.kind === b.kind && sameTmuxIncarnation(a, b);
}
