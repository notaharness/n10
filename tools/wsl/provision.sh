#!/bin/bash
# Run as root inside a freshly imported WSL distro: installs what n10's
# Linux requirements name (Git, tmux, a build toolchain for node-pty, the
# dependencies of the tmux the suites build, and Node), the system
# libraries of the checkout's Playwright Chromium, and creates the ordinary
# user the suites run as, as the distro's default user.
# The Node major matches the Linux CI job.
set -euo pipefail

usage='usage: provision.sh <user> <node-major> <checkout>'
user=${1:?$usage}
node_major=${2:?$usage}
checkout=${3:?$usage}

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y --no-install-recommends \
  git tmux ca-certificates curl xz-utils build-essential python3 \
  libevent-dev libncurses-dev bison pkg-config

# Node's own Linux build, checked against its published sums.
base="https://nodejs.org/dist/latest-v${node_major}.x"
tmp=$(mktemp -d)
curl -fsSL --retry 3 --retry-all-errors "$base/SHASUMS256.txt" -o "$tmp/SHASUMS256.txt"
tarball=$(awk '/linux-x64\.tar\.xz$/ { print $2 }' "$tmp/SHASUMS256.txt")
curl -fsSL --retry 3 --retry-all-errors "$base/$tarball" -o "$tmp/$tarball"
(cd "$tmp" && grep " $tarball\$" SHASUMS256.txt | sha256sum -c -)
tar -xJf "$tmp/$tarball" -C /usr/local --strip-components=1
rm -rf "$tmp"

playwright=$(node -p \
  "require('$checkout/package-lock.json').packages['node_modules/playwright'].version")
npx --yes "playwright@$playwright" install-deps chromium

id "$user" >/dev/null 2>&1 || useradd --create-home --shell /bin/bash "$user"
# The default user owns the Windows drives' files once the distro
# restarts, as for anyone who set the distro up interactively. Whatever
# the image's wsl.conf says, the default is this user.
if grep -q '^\[user\]' /etc/wsl.conf 2>/dev/null; then
  sed -i -e '/^default=/d' -e "/^\[user\]/a default=$user" /etc/wsl.conf
else
  printf '\n[user]\ndefault=%s\n' "$user" >>/etc/wsl.conf
fi
cat /etc/wsl.conf
node --version
npm --version
