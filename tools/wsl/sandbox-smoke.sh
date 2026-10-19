#!/bin/bash
# Launches n10 Desktop the way an npm install does (`n10` from the
# assembled package) on WSLg's display, and requires Chromium's sandbox to
# be on: the renderer must run under a seccomp filter in a user namespace
# of its own, and no process may have been given --no-sandbox. Run from
# the n10 checkout after `nx run cli:prepare-publish`.
set -euo pipefail

repo="$HOME/src/sandbox-smoke"
rm -rf "$repo"
git init --quiet "$repo"
git -C "$repo" -c user.name=ci -c user.email=ci@example.com \
  commit --quiet --allow-empty -m init

export TMUX_TMPDIR="$HOME/.sandbox-smoke-tmux"
mkdir -p "$TMUX_TMPDIR"
unset TMUX
log="$HOME/sandbox-smoke.log"
app="$PWD/apps/cli/dist"
(cd "$repo" && exec setsid node "$app/main.js") >"$log" 2>&1 &
launcher=$!
# The launcher forwards TERM to Electron, which runs in a session of its
# own. Whatever is left after 15 s is killed by its command line.
stop() {
  kill -TERM "$launcher" 2>/dev/null || true
  for _ in $(seq 15); do
    kill -0 "$launcher" 2>/dev/null || break
    sleep 1
  done
  pkill -KILL -f -- "$app" 2>/dev/null || true
  wait "$launcher" 2>/dev/null || true
}
trap 'stop; cat "$log"' EXIT

renderer=''
for _ in $(seq 60); do
  renderer=$(pgrep -f -- "--type=renderer.*$app|$app.*--type=renderer" | head -1 || true)
  [ -n "$renderer" ] && break
  sleep 1
done
if [ -z "$renderer" ]; then
  echo 'no renderer process started' >&2
  exit 1
fi
sleep 3
if ! [ -d /proc/"$renderer" ]; then
  echo "renderer $renderer exited within 3 s of starting" >&2
  exit 1
fi

echo "renderer $renderer: $(tr '\0' ' ' </proc/"$renderer"/cmdline | cut -c1-200)"
echo "display: $(tr '\0' '\n' </proc/"$renderer"/cmdline | grep -- '--ozone-platform' || echo 'no --ozone-platform')"
if pgrep -af -- '--no-sandbox' | grep -F "$app"; then
  echo 'a process was started with --no-sandbox' >&2
  exit 1
fi
seccomp=$(awk '/^Seccomp:/ { print $2 }' /proc/"$renderer"/status)
echo "renderer Seccomp: $seccomp"
[ "$seccomp" = 2 ] || { echo 'renderer has no seccomp filter' >&2; exit 1; }
own=$(readlink /proc/self/ns/user)
theirs=$(readlink /proc/"$renderer"/ns/user)
echo "user namespace: shell $own, renderer $theirs"
[ "$own" != "$theirs" ] || { echo 'renderer shares our user namespace' >&2; exit 1; }
echo 'sandboxed'
