#!/bin/sh
# Fails unless the tmux on PATH is 3.7 or later, the version CI's tmux
# tests are written against (docs/testing.md).
set -eu

version=$(tmux -V)
if ! echo "$version" | awk '
  $1 == "tmux" {
    split($2, v, /[^0-9]+/)
    exit !(v[1] > 3 || (v[1] == 3 && v[2] >= 7))
  }
  { exit 1 }'; then
  echo "CI runs tmux 3.7 or later; found: $version" >&2
  exit 1
fi
echo "$version"
