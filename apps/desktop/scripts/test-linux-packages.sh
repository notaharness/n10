#!/usr/bin/env bash
# Install a deb in a clean Ubuntu container and launch both Linux formats.
set -euo pipefail

if (( $# != 2 )); then
  echo 'usage: test-linux-packages.sh <deb> <AppImage>' >&2
  exit 2
fi
deb=$(realpath "${1:?deb path required}")
app_image=$(realpath "${2:?AppImage path required}")
script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
qa_steps=$(node -e 'const fs = require("node:fs"); process.stdout.write(JSON.stringify([{ js: fs.readFileSync(process.argv[1], "utf8"), waitMs: 200 }]))' "$script_dir/installer-qa.js")
case $(uname -m) in
  x86_64) platform=linux/amd64 ;;
  aarch64) platform=linux/arm64 ;;
  *) echo 'Linux package QA requires x64 or arm64' >&2; exit 1 ;;
esac

docker run --rm -i --platform "$platform" \
  --device /dev/fuse --cap-add SYS_ADMIN --security-opt apparmor:unconfined \
  -e N10_QA_STEPS="$qa_steps" \
  -v "$deb:/tmp/n10.deb:ro" \
  -v "$app_image:/tmp/n10.AppImage:ro" \
  ubuntu:24.04 bash -se <<'CONTAINER'
set -euo pipefail
apt-get update -qq
DEBIAN_FRONTEND=noninteractive apt-get install -y -qq /tmp/n10.deb xvfb fuse3 > /tmp/install.log
test -c /dev/fuse
command -v fusermount3
tmux -V
git --version
git init -q /tmp/qa-repo

export HOME=/tmp/n10-home
export XDG_CONFIG_HOME="$HOME/.config"
export TMUX_TMPDIR="$HOME/tmux"
mkdir -p "$HOME" "$TMUX_TMPDIR"
unset TMUX

launch() {
  local name=$1
  shift
  if ! timeout 70s xvfb-run -a "$@" /tmp/qa-repo > "/tmp/$name.log" 2>&1; then
    cat "/tmp/$name.log"
    return 1
  fi
  if ! grep -Fq '[desktop] renderer loaded' "/tmp/$name.log" ||
     ! grep -Fq '[desktop] qa step 1 js → PTY_OK' "/tmp/$name.log" ||
     ! grep -Fq 'qa-repo' "/tmp/$name.log"; then
    cat "/tmp/$name.log"
    return 1
  fi
  echo "$name launched, opened qa-repo, loaded the renderer, and ran a shell PTY"
}

launch deb /usr/bin/n10-desktop --no-sandbox --disable-gpu
APPIMAGE_EXTRACT_AND_RUN=1 launch appimage-extract /tmp/n10.AppImage --no-sandbox --disable-gpu
unset APPIMAGE_EXTRACT_AND_RUN
launch appimage /tmp/n10.AppImage --no-sandbox --disable-gpu

mv /usr/bin/tmux /usr/bin/tmux.qa-disabled
unset N10_QA_STEPS
timeout 20s xvfb-run -a /usr/bin/n10-desktop --no-sandbox --disable-gpu \
  /tmp/qa-repo > /tmp/no-tmux.log 2>&1 || true
if ! grep -Fq 'n10 requires tmux 3.2 or newer' /tmp/no-tmux.log; then
  cat /tmp/no-tmux.log
  exit 1
fi
echo 'missing tmux reported the installation requirement before startup'
CONTAINER
