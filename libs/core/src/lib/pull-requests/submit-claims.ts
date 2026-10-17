import type { Publication } from './review-draft-types.js';

/**
 * Drafts files with a submit running in this process. A second submit
 * would take the first one's attempt for its own and resume it while it
 * is still going: it is refused instead. The host is one process per
 * machine (the single-instance lock), so this is the whole claim.
 */
const running = new Set<string>();

/** Run `work` holding the claim on `file`, or refuse when it is held. */
export async function withSubmitClaim<T>(
  file: string,
  work: () => Promise<T>
): Promise<T> {
  if (running.has(file)) {
    throw new Error('This review is already being submitted');
  }
  running.add(file);
  try {
    return await work();
  } finally {
    running.delete(file);
  }
}

/**
 * A draft as it stands for a reader: `publishing` with no submit
 * running means the submit that marked it stopped with the process, so
 * whether it went out is not known until it is looked for.
 */
export function asRead(file: string, p: Publication): Publication {
  if (p.state !== 'publishing' || running.has(file)) return p;
  return { state: 'unknown', attempt: p.attempt, since: p.since };
}
