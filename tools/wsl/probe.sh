#!/bin/bash
# Prints what the distro reports about itself, then fails unless it is a
# WSL2 kernel. A job that boots WSL1, or something that is not WSL at all,
# must not count as WSL2 coverage.
set -uo pipefail

section() { printf '\n== %s\n' "$1"; }

section 'kernel'
uname -a
cat /proc/sys/kernel/osrelease
cat /proc/version

section 'distro'
. /etc/os-release && echo "$PRETTY_NAME"
echo "WSL_DISTRO_NAME=${WSL_DISTRO_NAME-<unset>}"
echo "WSL_INTEROP=${WSL_INTEROP-<unset>}"
echo "DISPLAY=${DISPLAY-<unset>} WAYLAND_DISPLAY=${WAYLAND_DISPLAY-<unset>}"
ls /proc/sys/fs/binfmt_misc/ 2>&1 | tr '\n' ' '
echo
ls -ld /mnt/wslg /tmp/.X11-unix /mnt/wslg/.X11-unix/X0 2>&1

section 'mounts'
grep -E ' /mnt/' /proc/self/mountinfo || echo 'no /mnt mounts'

section 'interop'
command -v explorer.exe wslview cmd.exe || true

osrelease=$(cat /proc/sys/kernel/osrelease)
case "$osrelease" in
  *microsoft-standard-WSL2*) echo "WSL2 kernel: $osrelease" ;;
  *)
    echo "not a WSL2 kernel: $osrelease" >&2
    exit 1
    ;;
esac
