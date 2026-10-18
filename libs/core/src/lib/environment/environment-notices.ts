/**
 * Setups n10 runs in but does not support, found when a repository opens.
 * They are warnings, not errors: the repository still opens, and each
 * shell shows them its own way. Missing tmux is not one of them; it
 * stops startup (`session-backend.ts`).
 */
import {
  nodeWslProbe,
  wslEnvironment,
  windowsDriveOf,
  type WslEnvironment,
  type WslProbe,
} from './wsl.js';

export type EnvironmentNoticeId = 'wsl1' | 'windows-drive';

export interface EnvironmentNotice {
  id: EnvironmentNoticeId;
  message: string;
}

export function wsl1Notice(wsl: WslEnvironment): EnvironmentNotice {
  const distro = wsl.distro ?? '<distro>';
  return {
    id: 'wsl1',
    message: `WSL 1 is unsupported. From Windows, run \`wsl --set-version ${distro} 2\`.`,
  };
}

export function windowsDriveNotice(repo: string): EnvironmentNotice {
  return {
    id: 'windows-drive',
    message: `Repositories on Windows drives are unsupported: ${repo}. Clone under ~/src in WSL.`,
  };
}

/** The notices for a repository opened at `repo`; none outside WSL. */
export function environmentNotices(
  repo: string,
  wsl: WslEnvironment | null = wslEnvironment(),
  probe: WslProbe = nodeWslProbe()
): EnvironmentNotice[] {
  if (!wsl) return [];
  const notices: EnvironmentNotice[] = [];
  if (wsl.version === 1) notices.push(wsl1Notice(wsl));
  if (windowsDriveOf(repo, probe)) notices.push(windowsDriveNotice(repo));
  return notices;
}
