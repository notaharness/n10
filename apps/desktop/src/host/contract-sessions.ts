import type { Affiliation } from '@n10/core';

/**
 * Agent sessions as the renderer lists them: the open repository's own
 * (`SessionSummary`) and those alive in other repositories
 * (`ForeignSessionSummary`), which the tab strip gives a tab in their
 * own group without attaching to.
 *
 * Split from `contract.ts` because it is one subject, and because that
 * file is a catalogue already.
 */

export interface SessionSummary {
  name: string;
  running: boolean;
  spawnedAt: number;
  /** The machine this session runs on — `'local'` or a beam peerId
   *  (decisions.md D2, D8). The renderer resolves it to a label and
   *  shows it only when more than one machine is registered. */
  machine: string;
  /** Local client health, independent of `running`: a dropped
   *  connection must never render as the agent having exited
   *  (decisions.md D4). Absent for a local session, which has no
   *  separate transport to lose. */
  connectionState?: 'connected' | 'reconnecting' | 'failed';
}

/**
 * An agent alive in a repository other than the open one — tmux still
 * holds it, and its tab belongs in that repository's group on the
 * strip. A strip entry only: nothing is attached until its repository
 * is opened, when that repository's own discovery attaches it.
 */
export interface ForeignSessionSummary {
  /** The repository it runs in — the real path of the main checkout. */
  repo: string;
  /** The branch its checkout is on now. */
  branch: string;
  /** The checkout the agent belongs to. */
  worktree: string;
  /** Its qualified core registry key (repository plus checkout). */
  sessionName: string;
  /** What it belongs to, once discovery has listed it. */
  affiliation?: Affiliation;
}

/** Agents alive elsewhere, and what this machine's tmux runs. */
export interface ForeignSessionsAnswer {
  /** The open repository the answer leaves out, as `RepoInfo.cwd` names
   *  it: a shell whose open repository is another reads it as no answer. */
  excluded: string;
  /** Agents alive in repositories other than `excluded`. */
  sessions: ForeignSessionSummary[];
  /** The registry name of every agent session alive on this machine, in
   *  any repository (`excluded` too) and on a branch or not: whether a
   *  closed agent has ended. `null` when tmux could not be asked. */
  alive: string[] | null;
}
