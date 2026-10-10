import {
  closeSessionBackend,
  getTmuxAvailability,
  joinKillOnCloseJob,
  ownSessions,
  probeTmuxAvailability,
} from '@n10/core';
import { MUX_EXIT_STATUS } from '@n10/core/mux';
import { errorLine } from './mux-format.js';

/** What ends a foreground owner: Ctrl+C, a kill, or its console closing
 *  (Node reports a closed Windows console as SIGHUP). */
const ENDING_SIGNALS = ['SIGINT', 'SIGTERM', 'SIGHUP'] as const;

function refuse(code: keyof typeof MUX_EXIT_STATUS, message: string): number {
  process.stderr.write(errorLine(code, message));
  return MUX_EXIT_STATUS[code];
}

/**
 * `n10 mux serve`: own this profile's sessions in the foreground, as
 * the desktop or TUI would, until a signal ends it and the sessions
 * with it. Where tmux is installed, sessions live in tmux instead; an
 * owner already running is reported and left alone.
 */
export async function serveMux(): Promise<number> {
  await probeTmuxAvailability();
  const tmux = getTmuxAvailability();
  if (tmux?.available)
    return refuse(
      'UNSUPPORTED',
      'tmux is installed, so n10 keeps its sessions in tmux'
    );
  if (!tmux?.missing)
    return refuse(
      'UNSUPPORTED',
      `n10 requires tmux 3.2 or newer. ${tmux?.reason ?? ''}`.trim()
    );
  // On Windows its sessions end with it however it ends, as the
  // desktop's session host's do.
  joinKillOnCloseJob();
  let claim: Awaited<ReturnType<typeof ownSessions>>;
  try {
    claim = await ownSessions('headless');
  } catch (err) {
    // A socket path past the platform's limit, a runtime directory
    // another account owns: said, not thrown.
    return refuse(
      'UNSUPPORTED',
      `Cannot serve: ${err instanceof Error ? err.message : String(err)}`
    );
  }
  if (claim.kind === 'existing')
    return refuse(
      'RUNNING',
      `An n10 mux owner is already running as host ${claim.hostId}`
    );
  const { hostId } = claim;
  return new Promise<number>((resolve) => {
    const end = () => {
      for (const signal of ENDING_SIGNALS) process.off(signal, end);
      closeSessionBackend();
      resolve(0);
    };
    for (const signal of ENDING_SIGNALS) process.on(signal, end);
    // Last: whoever reads this may signal at once.
    process.stderr.write(`n10 mux serving as host ${hostId}\n`);
  });
}
