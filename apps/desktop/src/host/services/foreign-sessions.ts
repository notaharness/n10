import { realpathSync } from 'node:fs';
import { listLiveWorktreeSessions } from '@n10/core';
import type { ForeignSessionSummary } from '../contract.js';
import { ensureRecent } from './recent-repos.js';
import { requireRepo } from './repo.js';

/** The foreign set as last answered, so the repo list is written only
 *  when it changes: this is a polled read, and the list is the user's
 *  — a repository they removed must not come back on every tick. */
let lastAnswered = '';

/**
 * Agents alive in repositories other than the open one.
 *
 * The host attaches only the open repository's sessions — it is
 * single-repo by construction — but tmux holds every repository's, and
 * a tab strip that spans repositories wants each of them back in its
 * own group after a relaunch. So this lists the rest as strip entries
 * only: repository, branch, session name, nothing attached. Activating
 * one opens its repository, and that repository's own discovery
 * attaches the agent through the normal path.
 *
 * The open repository's own agents are left out: the sidebar describes
 * those, and listing them here as well would open each twice. An agent
 * on a detached HEAD is listed under its directory name, which is its
 * row's label once that repository is open.
 */
export function listForeignSessions(): ForeignSessionSummary[] {
  const open = requireRepo();
  // Identity is the real path — the same string git reports as the
  // toplevel, which is what the core derives a session's repository
  // from — so a repository opened through a symlink still recognises
  // its own agents as its own.
  let openRoot: string;
  try {
    openRoot = realpathSync(open);
  } catch {
    openRoot = open;
  }
  const out: ForeignSessionSummary[] = [];
  for (const live of listLiveWorktreeSessions()) {
    if (live.repoRoot === openRoot) continue;
    out.push({
      repo: live.repoRoot,
      branch: live.branch,
      worktree: live.path,
      sessionName: live.sessionName,
    });
  }
  noteRepositories(out);
  return out;
}

/** Put each foreign repository on the repo list — so the tab's
 *  repository can be opened like any other, the same courtesy a
 *  restored terminal's gets — once per change of the foreign set. */
function noteRepositories(foreign: ForeignSessionSummary[]): void {
  const answered = foreign
    .map((s) => `${s.repo}\0${s.sessionName}`)
    .sort()
    .join('\n');
  if (answered === lastAnswered) return;
  lastAnswered = answered;
  for (const repo of new Set(foreign.map((s) => s.repo))) ensureRecent(repo);
}
