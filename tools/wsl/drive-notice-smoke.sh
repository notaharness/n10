#!/bin/bash
# The built `n10 --tui`, opened on a repository on the C: drive, must
# warn that the location is unsupported. Run from the n10 checkout after
# a build, as the distro's default user (who owns the drive's files).
set -euo pipefail

repo=/mnt/c/n10-drive-smoke
rm -rf "$repo"
git init --quiet "$repo"
git -C "$repo" -c user.name=ci -c user.email=ci@example.com \
  commit --quiet --allow-empty -m init

export TMUX_TMPDIR="$HOME/.drive-smoke-tmux"
mkdir -p "$TMUX_TMPDIR"
unset TMUX
# Without a terminal Ink stops after the warning; only stderr matters.
timeout 30 node apps/cli/dist/main.js --tui "$repo" </dev/null \
  >/dev/null 2>"$HOME/drive-smoke.err" || true
cat "$HOME/drive-smoke.err"
grep -F "Repositories on Windows drives are unsupported: $repo." \
  "$HOME/drive-smoke.err"
