import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll } from 'vitest';

/**
 * Put any tmux command this project's tests run onto a throwaway
 * server, before a single spec is imported.
 *
 * `libs/core` is where the real tmux calls live — the resolver lists
 * sessions, `killPersistedTmuxSession` kills one — and
 * `session-resolver.spec.ts` deliberately creates and kills real
 * sessions to prove the tag rules against a server. Without this it
 * would do that on `/tmp/tmux-$UID/default`, next to the developer's
 * own agents; the spec refuses to run unless the directory below is
 * in force.
 *
 * `TMUX_TMPDIR` picks the socket directory; `TMUX` names a socket path
 * outright and **wins**, so the second is removed rather than
 * overridden. The scratch server is never killed: it exits by itself
 * once its last session is gone.
 */
process.env.TMUX_TMPDIR = mkdtempSync(join(tmpdir(), 'n10-core-tests-'));
delete process.env.TMUX;
delete process.env.TMUX_PANE;

const ANCHOR = 'scratch-anchor';

/**
 * Keep the scratch server up from a spec's first test to its last.
 *
 * tmux exits with its last session, and a client that connects while
 * it is going down fails with "server exited unexpectedly" (or "no
 * server running"). A spec that kills every session it made after each
 * test races that shutdown with the next test's first command; one
 * idle session held for the whole file means the server only exits
 * once the file is done with it.
 */
export function holdScratchTmuxServer(): void {
  beforeAll(() => {
    execFileSync('tmux', ['new-session', '-d', '-s', ANCHOR, 'sleep 3600']);
  });
  afterAll(() => {
    execFileSync('tmux', ['kill-session', '-t', `=${ANCHOR}:`]);
  });
}
