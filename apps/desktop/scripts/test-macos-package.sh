#!/usr/bin/env bash
# Install a DMG into an isolated Applications directory and exercise the
# packaged renderer and a shell PTY through the session host.
set -euo pipefail

if (( $# != 2 )); then
  echo 'usage: test-macos-package.sh <dmg> <screenshot.png>' >&2
  exit 2
fi
dmg=$(cd "$(dirname "$1")" && pwd)/$(basename "$1")
mkdir -p "$(dirname "$2")"
shot=$(cd "$(dirname "$2")" && pwd)/$(basename "$2")
script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# macOS tmux sockets have a short path limit; keep the fixture HOME short.
work=$(mktemp -d /tmp/n10-macos-qa.XXXXXX)
mounted=false
cleanup() {
  if "$mounted"; then hdiutil detach "$work/mount" -quiet; fi
  rm -rf "$work"
}
trap cleanup EXIT

mkdir -p "$work/mount" "$work/home/Applications" "$work/home/tmux"
hdiutil attach "$dmg" -quiet -nobrowse -readonly -mountpoint "$work/mount"
mounted=true
source_app=$(find "$work/mount" -maxdepth 1 -name '*.app' -type d -print -quit)
if [[ -z "$source_app" ]]; then
  echo "no application bundle in $dmg" >&2
  exit 1
fi
installed="$work/home/Applications/$(basename "$source_app")"
ditto "$source_app" "$installed"
hdiutil detach "$work/mount" -quiet
mounted=false
codesign --verify --deep --strict "$installed"

git init -q "$work/repo"
export HOME="$work/home"
export TMUX_TMPDIR="$HOME/tmux"
unset TMUX
export N10_QA_STEPS
N10_QA_STEPS=$(node -e '
  const fs = require("node:fs");
  const js = fs.readFileSync(process.argv[1], "utf8").replaceAll("/tmp/qa-repo", process.argv[2]);
  process.stdout.write(JSON.stringify([{ js, waitMs: 200, shot: process.argv[3] }]));
' "$script_dir/installer-qa.js" "$work/repo" "$shot")

app_binary="$installed/Contents/MacOS/n10-desktop"
if ! python3 - "$app_binary" "$work/repo" "$work/app.log" <<'PY'
import subprocess
import sys

with open(sys.argv[3], 'w') as log:
    subprocess.run([sys.argv[1], sys.argv[2]], stdout=log,
                   stderr=subprocess.STDOUT, timeout=90, check=True)
PY
then
  cat "$work/app.log"
  exit 1
fi
if ! grep -Fq '[desktop] renderer loaded' "$work/app.log" ||
   ! grep -Fq '[desktop] qa step 1 js → PTY_OK' "$work/app.log" ||
   ! grep -Fq "[desktop] startup repo: $work/repo" "$work/app.log" ||
   [[ ! -s "$shot" ]]; then
  cat "$work/app.log"
  echo 'installed macOS app did not load the repo, renderer, and shell PTY' >&2
  exit 1
fi
echo "installed $(basename "$installed") loaded the renderer and returned shell PTY output"
echo "screenshot: $shot"
