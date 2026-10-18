#!/bin/bash
# Run as the ordinary user inside the WSL distro, from the checkout the
# runner made on its Windows drive. Clones the checked-out commit into the
# Linux filesystem, which is where n10's guide puts repositories, and runs
# one offline suite there against CI's tmux:
#
#   cli      the TUI suite, WSL detection, and the Windows-drive warning
#   desktop  the Electron suite, and a sandboxed launch of the assembled
#            npm package on WSLg's display
#
# The suite's output is copied back beside the checkout for upload.
set -euo pipefail

suite=${1:?usage: run-e2e.sh cli|desktop}
source=$PWD

# The Windows checkout belongs to another owner as far as Git can tell.
git config --global --add safe.directory "$source"
git config --global --add safe.directory "$source/.git"

# Cloning reads Git objects, not the Windows working tree, so line
# endings come out as committed whatever the runner's autocrlf.
sha=$(git -C "$source" rev-parse HEAD)
rm -rf "$HOME/src/n10"
git clone --quiet --no-checkout "file://$source" "$HOME/src/n10"
cd "$HOME/src/n10"
git fetch --quiet origin "$sha"
git checkout --quiet --detach "$sha"
trap 'cp -r "apps/$suite-e2e/test-output" "$source/wsl-test-output" 2>/dev/null || true' EXIT

tools/tmux/build-tmux.sh "$HOME/.cache/n10-tmux"
export PATH="$HOME/.cache/n10-tmux/bin:$PATH"
tools/tmux/require-tmux.sh

npm ci --no-audit --no-fund

# The runner's environment does not cross into WSL (WSLENV is unset), so
# CI and GITHUB_ACTIONS, which stop Ink painting, are absent here.
export NX_DAEMON=false

case "$suite" in
  cli)
    # Detection against this distro's own kernel, interop and mounts.
    N10_EXPECT_WSL=2 npx vitest run --root libs/core src/lib/environment
    npx playwright install chromium
    npx nx e2e cli-e2e --outputStyle=static
    tools/wsl/drive-notice-smoke.sh
    ;;
  desktop)
    npx --no install-electron
    # What a user's npm install does on WSLg: `n10`, sandboxed, on WSLg's
    # display. Display :0's socket must be WSLg's, however it is linked in.
    if [ "${DISPLAY-}" != ':0' ] ||
      ! [ /tmp/.X11-unix/X0 -ef /mnt/wslg/.X11-unix/X0 ]; then
      echo "no WSLg display: DISPLAY=${DISPLAY-<unset>}" >&2
      exit 1
    fi
    npx nx run cli:prepare-publish --outputStyle=static
    tools/wsl/sandbox-smoke.sh
    # Regression for the Linux host, on Xvfb at the screen size the suite
    # is written for (WSLg's output on a runner is 1024x768). The suite
    # watches link opening through Electron's shell; a BROWSER keeps n10
    # on it inside WSL, as it does for a user who set one.
    BROWSER=true npx nx e2e desktop-e2e --outputStyle=static
    ;;
  *)
    echo "unknown suite: $suite" >&2
    exit 2
    ;;
esac
