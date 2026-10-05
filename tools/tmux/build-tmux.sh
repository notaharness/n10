#!/bin/sh
# Builds the tmux that CI runs n10 against, from its release tarball,
# into the prefix given. Needs a C compiler, make, pkg-config, a yacc
# (bison) and libevent's and ncurses' development files.
#
# Why 3.7: docs/testing.md. A new version means a new checksum here;
# CI's cache of the build is keyed on this file.
set -eu

TMUX_VERSION=3.7c
TMUX_SHA256=7c60cae9a0e25288e2e24750aafc9e8800fc7fd4555e447e1b29ee4201cfb3bf

prefix=$1
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

curl -fsSL -o "$work/tmux.tar.gz" \
  "https://github.com/tmux/tmux/releases/download/$TMUX_VERSION/tmux-$TMUX_VERSION.tar.gz"
echo "$TMUX_SHA256  $work/tmux.tar.gz" | sha256sum -c -
tar -xzf "$work/tmux.tar.gz" -C "$work"
cd "$work/tmux-$TMUX_VERSION"
./configure --prefix="$prefix"
make -j"$(nproc)"
make install
