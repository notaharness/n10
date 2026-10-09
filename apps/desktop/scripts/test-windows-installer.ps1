# Exercise the NSIS installer in the current user's Windows runner account.
$ErrorActionPreference = 'Stop'
$installer = (Resolve-Path $args[0]).Path
$qaRoot = Join-Path $env:RUNNER_TEMP 'n10-installer-qa'
New-Item -ItemType Directory -Force $qaRoot | Out-Null
$env:N10_QA_RENDERER_ONLY = '1'
$env:N10_QA_RESULT_FILE = Join-Path $qaRoot 'renderer-result.txt'
$shot = Join-Path $qaRoot 'renderer.png'
$env:N10_QA_STEPS = ConvertTo-Json -Compress -InputObject @(@{
  js = 'document.querySelector("#root")?.childElementCount > 0 && !!window.n10 ? "RENDERER_OK" : "RENDERER_MISSING"'
  shot = $shot
})

$install = Start-Process -FilePath $installer -ArgumentList '/S' -PassThru -Wait
if ($install.ExitCode -ne 0) { throw "Installer exited $($install.ExitCode)" }
$app = Get-ChildItem (Join-Path $env:LOCALAPPDATA 'Programs') -Filter n10-desktop.exe -Recurse -File |
  Select-Object -First 1
if (-not $app) { throw 'Per-user installation did not contain n10-desktop.exe' }
$installDir = $app.DirectoryName
$programs = [Environment]::GetFolderPath('Programs')
$desktop = [Environment]::GetFolderPath('DesktopDirectory')
$startShortcut = Join-Path $programs 'n10 Desktop.lnk'
$desktopShortcut = Join-Path $desktop 'n10 Desktop.lnk'
if (!(Test-Path $startShortcut)) { throw "Start menu shortcut missing: $startShortcut" }
if (!(Test-Path $desktopShortcut)) { throw "Desktop shortcut missing: $desktopShortcut" }

$stdout = Join-Path $qaRoot 'stdout.log'
$stderr = Join-Path $qaRoot 'stderr.log'
$appProcess = Start-Process -FilePath $app.FullName -PassThru `
  -RedirectStandardOutput $stdout -RedirectStandardError $stderr
try {
  if (-not $appProcess.WaitForExit(90000)) { throw 'Packaged app did not exit after renderer QA' }
  if ($appProcess.ExitCode -ne 0) { throw "Packaged app exited $($appProcess.ExitCode)" }
  if ((Get-Content $env:N10_QA_RESULT_FILE -Raw).Trim() -ne 'RENDERER_OK') {
    throw 'Packaged renderer did not mount with its preload bridge'
  }
  if (!(Test-Path $shot) -or (Get-Item $shot).Length -lt 1000) {
    throw 'Packaged renderer screenshot missing'
  }
  $logs = (Get-Content $stdout, $stderr -Raw) -join "`n"
  if (!$logs.Contains('Terminal sessions are not supported on Windows yet.')) {
    throw 'Packaged app did not report the Windows session limitation'
  }
  if ($logs.Contains('Install it, then start n10 again')) {
    throw 'Packaged app still suggests installing tmux on Windows'
  }
  Write-Host "Per-user install, shortcuts, renderer and screenshot passed: $installDir"
} finally {
  Get-Content $stdout, $stderr -ErrorAction SilentlyContinue
  Get-Process n10-desktop -ErrorAction SilentlyContinue | Stop-Process -Force
  $uninstaller = Get-ChildItem $installDir -Filter 'Uninstall*.exe' -File |
    Select-Object -First 1
  if (-not $uninstaller) { throw 'NSIS uninstaller missing' }
  $uninstall = Start-Process -FilePath $uninstaller.FullName -ArgumentList '/S' -PassThru -Wait
  if ($uninstall.ExitCode -ne 0) { throw "Uninstaller exited $($uninstall.ExitCode)" }
  if (Test-Path $app.FullName) { throw 'Installed executable remains after uninstall' }
  if (Test-Path $startShortcut) { throw 'Start menu shortcut remains after uninstall' }
  if (Test-Path $desktopShortcut) { throw 'Desktop shortcut remains after uninstall' }
  Write-Host 'Silent uninstall removed the app and both shortcuts'
}
