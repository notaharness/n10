import type { AppConfig, PullRequestInfo, VcsProvider } from '@n10/vcs-core';
import type {
  BabysitStatus,
  DeliveryTiming,
  PullRequestLookup,
} from '@n10/core';

export interface PrBabysitterOptions {
  pr: PullRequestInfo;
  /** The repository the pull request belongs to. Every git call runs
   *  against it, whatever the process's directory is by then. */
  cwd: string;
  /** Read per poll, like the config: a vendor switched in Settings
   *  takes effect on the next poll rather than at the next start. */
  getProvider: () => VcsProvider | null;
  /** Read per poll, so a credential change takes effect. */
  getConfig: () => AppConfig;
  readPullRequest: () => Promise<PullRequestLookup>;
  /** Grid for an agent started because none was running. */
  paneSize: () => { cols: number; rows: number };
  /** A session was started in `cwd` to receive the update. The
   *  desktop attaches its output relay here. */
  onSpawned?: (name: string, cwd: string) => void;
  /** A live session under this name belongs to another repository. */
  isForeignSession?: (name: string) => boolean;
  /** Fires on a transition — the phase, a hold, a delivery, an error
   *  appearing or clearing, the end — and not on a poll that left all
   *  of that where it was. `status()` is always current regardless. */
  onStatus: (status: BabysitStatus) => void;
  /** Defaults come from the environment when set (`babysitTimingFromEnv`),
   *  then from the model's constants. */
  intervalMs?: number;
  remoteRefreshMs?: number;
  idleMs?: number;
  timing?: DeliveryTiming;
  /** Returning false skips a tick — the desktop can have another
   *  repository open, and this one's branch names mean nothing there. */
  isCurrent?: () => boolean;
  now?: () => number;
}

export interface PrBabysitter {
  /** Poll now rather than at the next tick. Resolves when the poll,
   *  and any delivery it led to, has finished. */
  pollNow(): Promise<void>;
  status(): BabysitStatus;
  /** Stop watching. Idempotent. */
  stop(): void;
}
