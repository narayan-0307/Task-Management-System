<#
  Registers the HumanCare Connect native messaging host for Chrome and/or Edge
  on THIS machine, for the CURRENT user (HKCU). Run from a normal PowerShell
  (no admin needed).

  Usage:
    .\install.ps1 -ChromeId <id>                     # Chrome only
    .\install.ps1 -EdgeId <id>                       # Edge only
    .\install.ps1 -ChromeId <id> -EdgeId <id>        # both

  Get the ids from chrome://extensions and edge://extensions after loading the
  built dist/ folder unpacked (Developer mode -> Load unpacked).

  What it does:
    - writes native-host.bat + co.humancareconnect.monitoring.json to
      %LOCALAPPDATA%\HumanCareMonitoring\
    - points the .bat at nativeHost.js, run through the Agent's OWN already-
      installed Electron runtime (ELECTRON_RUN_AS_NODE=1) — NOT a separately
      installed system Node.js, which is not an employee-machine prerequisite
      (Step 4B). If a packaged Agent install is found (via its uninstall
      registry entry, so no path is ever hardcoded), that is used; otherwise
      this falls back to the repo's own node_modules\electron (already
      required by `npm install` for the existing from-source testing flow
      documented in DEPLOYMENT.md).
    - sets HKCU\...\NativeMessagingHosts\co.humancareconnect.monitoring
#>

param(
    [string]$ChromeId,
    [string]$EdgeId
)

$ErrorActionPreference = "Stop"

if (-not $ChromeId -and -not $EdgeId) {
    Write-Error "Give -ChromeId and/or -EdgeId (from chrome://extensions / edge://extensions)."
    exit 1
}

$HostName = "co.humancareconnect.monitoring"

# --- locate an Electron runtime to run nativeHost.js with (no system Node.js) ---
#
# Preferred: a packaged, installed Agent. electron-builder's per-user NSIS
# install registers an uninstall entry under HKCU with InstallLocation set to
# whatever directory the employee actually chose (allowToChangeInstallationDirectory
# is enabled) — so this is looked up by DisplayName, never hardcoded.
function Find-InstalledAgent {
    $roots = @(
        "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*",
        "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*"
    )
    foreach ($root in $roots) {
        $entries = Get-ItemProperty -Path $root -ErrorAction SilentlyContinue |
            Where-Object { $_.DisplayName -like "Task Monitoring Agent*" -and $_.InstallLocation }
        foreach ($entry in $entries) {
            $exe = Join-Path $entry.InstallLocation "Task Monitoring Agent.exe"
            $asar = Join-Path $entry.InstallLocation "resources\app.asar"
            $script = Join-Path $asar "src\monitoring\extension\nativeHost.js"
            # Test-Path cannot see INSIDE an .asar archive (it's a virtual
            # filesystem only Electron's patched Node understands, not
            # PowerShell/the OS) — verify the archive file itself exists
            # instead of the path inside it, which would always read as
            # missing even for a genuinely working install.
            if ((Test-Path $exe) -and (Test-Path $asar)) {
                return [PSCustomObject]@{ AgentExe = $exe; HostScript = $script }
            }
        }
    }
    return $null
}

$installed = Find-InstalledAgent
if ($installed) {
    $AgentExe   = $installed.AgentExe
    $HostScript = $installed.HostScript
    Write-Host "Using the installed Agent: $AgentExe"
} else {
    # Fallback: single-machine testing from source (see DEPLOYMENT.md) — no
    # packaged install exists yet, so use the repo's own Electron, which
    # `npm install` in Task-Monitoring-Agent already requires. Still not a
    # separately installed system Node.js.
    $RepoRoot   = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
    $AgentExe   = Join-Path $RepoRoot "Task-Monitoring-Agent\node_modules\electron\dist\electron.exe"
    $HostScript = Join-Path $RepoRoot "Task-Monitoring-Agent\src\monitoring\extension\nativeHost.js"
    if (-not (Test-Path $AgentExe)) {
        Write-Error "No installed Agent was found, and the repo's Electron binary is missing at $AgentExe - run 'npm install' inside Task-Monitoring-Agent first, or install the packaged Agent."
        exit 1
    }
    if (-not (Test-Path $HostScript)) {
        Write-Error "nativeHost.js not found at $HostScript - run this from inside the repo."
        exit 1
    }
    Write-Host "No installed Agent found - using the repo's Electron for local testing: $AgentExe"
}

$InstallDir = Join-Path $env:LOCALAPPDATA "HumanCareMonitoring"
New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null

$BatPath      = Join-Path $InstallDir "native-host.bat"
$ManifestPath = Join-Path $InstallDir "$HostName.json"

# --- the .bat Chrome/Edge will launch ---------------------------------------
# ELECTRON_RUN_AS_NODE makes the Agent's own Electron binary behave as plain
# Node for this one process — no separate Node.js runtime is shipped or
# required. Only paths and this fixed flag are written here; no credentials,
# tokens, or secrets ever go into this file.
@"
@echo off
set ELECTRON_RUN_AS_NODE=1
"$AgentExe" "$HostScript" %*
"@ | Set-Content -Path $BatPath -Encoding ascii

# --- the native messaging host manifest ------------------------------------
$origins = @()
if ($ChromeId) { $origins += "chrome-extension://$ChromeId/" }
if ($EdgeId)   { $origins += "chrome-extension://$EdgeId/" }

$manifest = [ordered]@{
    name            = $HostName
    description     = "HumanCare Connect monitoring bridge"
    path            = $BatPath
    type            = "stdio"
    allowed_origins = $origins
}
($manifest | ConvertTo-Json -Depth 4) | Set-Content -Path $ManifestPath -Encoding ascii

# --- registry (HKCU, per-user, no admin) ----------------------------------
if ($ChromeId) {
    $k = "HKCU:\Software\Google\Chrome\NativeMessagingHosts\$HostName"
    New-Item -Path $k -Force | Out-Null
    Set-ItemProperty -Path $k -Name "(default)" -Value $ManifestPath
    Write-Host "Chrome  -> $k"
}
if ($EdgeId) {
    $k = "HKCU:\Software\Microsoft\Edge\NativeMessagingHosts\$HostName"
    New-Item -Path $k -Force | Out-Null
    Set-ItemProperty -Path $k -Name "(default)" -Value $ManifestPath
    Write-Host "Edge    -> $k"
}

Write-Host ""
Write-Host "Installed:"
Write-Host "  $BatPath"
Write-Host "  $ManifestPath"
Write-Host ""
Write-Host "allowed_origins:"
$origins | ForEach-Object { Write-Host "  $_" }
Write-Host ""
Write-Host "Restart Chrome/Edge completely (all windows) so it picks up the host."
