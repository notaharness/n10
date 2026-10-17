import type {
  BranchSessions,
  BranchTerminalRequest,
  TerminalSummary,
} from '../contract.js';
import { activeRepository, openRepository, repository } from './repo.js';
import { machineFor } from './remote-machines.js';
import { broadcastLaunchStep } from './session-relay.js';
import { launchTerminal, listTerminals as terminals } from './terminals.js';

/** The engine decides which sessions are the branch's; the host
 *  supplies the terminals it holds. */
export function listBranchSessions(
  repo: string,
  branch: string
): BranchSessions {
  return repository(repo).sessions.branchSessions(branch, terminals());
}

/** Every terminal, each named with the open repository's branch whose
 *  checkout holds it. */
export function listTerminals(): TerminalSummary[] {
  const sessions = openRepository()?.sessions;
  return terminals().map((t) => {
    const branch = sessions?.terminalBranch(t);
    return branch ? { ...t, branch } : t;
  });
}

/** A shell in the branch's checkout on the requested machine. The
 *  repository is captured before the checkout is resolved, which comes
 *  back in that machine's own terms. */
export async function launchBranchTerminal(
  req: BranchTerminalRequest
): Promise<TerminalSummary> {
  const repo = activeRepository();
  if (req.machine && req.launchId)
    broadcastLaunchStep({ launchId: req.launchId, step: 'worktree' });
  const cwd = await repo.sessions.checkoutOn(
    req.branch,
    req.machine
      ? { id: req.machine, machine: machineFor(req.machine) }
      : undefined
  );
  return launchTerminal({
    kind: 'shell',
    cwd,
    machinePath: true,
    cols: req.cols,
    rows: req.rows,
    ...(req.machine ? { machine: req.machine, launchId: req.launchId } : {}),
  });
}
