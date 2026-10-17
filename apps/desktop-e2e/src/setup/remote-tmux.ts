import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { delimiter, join } from 'node:path';

/** A shell word that stays one word whatever `value` holds. */
function quoted(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

/**
 * The `PATH` for a beam daemon whose `pty` and `exec` processes must
 * reach the tmux server in `home`, not the developer's. beam gives those
 * processes only a login's part of its environment (beam docs/04), so
 * `TMUX_TMPDIR` never arrives and tmux would fall back to
 * `/tmp/tmux-$UID`. `PATH` does arrive, and beam resolves `tmux` on it:
 * a wrapper first on it pins the socket directory, as a machine of its
 * own would have it.
 */
export function pinnedTmuxPath(home: string, path = process.env.PATH ?? '') {
  const tmux = execFileSync('sh', ['-c', 'command -v tmux'], {
    encoding: 'utf8',
  }).trim();
  const bin = join(home, '.beam-e2e', 'bin');
  mkdirSync(bin, { recursive: true });
  const wrapper = join(bin, 'tmux');
  writeFileSync(
    wrapper,
    [
      '#!/bin/sh',
      'unset TMUX TMUX_PANE',
      `TMUX_TMPDIR=${quoted(home)} exec ${quoted(tmux)} "$@"`,
      '',
    ].join('\n')
  );
  chmodSync(wrapper, 0o755);
  return [bin, path].join(delimiter);
}
