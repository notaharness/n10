# A tmux session started inside a WSL 2 distro must outlive the wsl.exe
# that started it and a stretch with no wsl.exe attached, which is what
# closing Windows Terminal and reopening n10 relies on.
param(
  [Parameter(Mandatory)] [string] $Distro,
  [Parameter(Mandatory)] [string] $User,
  [int] $IdleSeconds = 120
)
$ErrorActionPreference = 'Stop'

# --exec hands bash the script as one argument; without it the login shell
# would parse and expand it first.
function In-Distro([string] $script) {
  wsl -d $Distro -u $User --exec /bin/bash -c $script
}

Write-Host '== init and wsl.conf'
In-Distro 'ps -p 1 -o comm=; cat /etc/wsl.conf 2>/dev/null || echo no /etc/wsl.conf'

# A scratch socket directory, as n10's own tests use. TMUX would override
# TMUX_TMPDIR, so it is unset.
$socket = 'set -e; unset TMUX; export TMUX_TMPDIR=$HOME/.lifetime-tmux; mkdir -p $TMUX_TMPDIR'
In-Distro "$socket; tmux new-session -d -s lifetime 'sleep 100000'; tmux display-message -p -t lifetime '#{socket_path}'"
if ($LASTEXITCODE -ne 0) { throw 'could not start the tmux session' }

Write-Host "== no wsl.exe attached for $IdleSeconds s"
for ($t = 0; $t -lt $IdleSeconds; $t += 15) {
  Start-Sleep -Seconds 15
  $state = (wsl --list --verbose) -match "\b$Distro\b"
  Write-Host "t+$($t + 15)s: $state"
}

Write-Host '== reattach'
In-Distro "$socket; tmux has-session -t lifetime; tmux display-message -p -t lifetime '#{socket_path}'; tmux kill-session -t lifetime"
if ($LASTEXITCODE -ne 0) { throw 'the tmux session did not survive' }
