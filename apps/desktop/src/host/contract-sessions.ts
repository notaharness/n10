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
}

/**
 * An Orchestra orchestrator's session and the sessions that report to
 * it. Core's `orchestratorGroups` decides membership from Orchestra's
 * tags; a marked orchestrator is listed with no players too.
 */
export interface OrchestratorGroupSummary {
  orchestrator: OrchestraMemberSummary;
  players: OrchestraMemberSummary[];
}

/** A session of a group, by what its tab can carry: the core registry
 *  key (a terminal tab's `name`, a worktree row's session name), and for
 *  a worktree session its repository and checkout, which a tab from
 *  another repository is stamped with. */
export interface OrchestraMemberSummary {
  key: string;
  repo: string;
  /** `''` for a terminal. */
  worktree: string;
}
