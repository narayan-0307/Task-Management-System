<#
  DEVELOPER / MANUAL SCRIPT ONLY.
  PRODUCTION installation is performed by the Task Monitoring Agent installer
  (per-machine NSIS): it writes native-host.bat and the host manifest under
  C:\Program Files\Task Monitoring Agent\native-host\ and registers the host in
  HKLM for Chrome and Edge. That installer is authoritative. This script never
  writes HKLM; it only registers a per-user (HKCU) host for local development.
  NOTE: a per-user (HKCU) registration takes precedence over HKLM in Chrome and
  Edge, so running this on a machine that has the production install would
  shadow it (this script warns when it detects that). Run uninstall.ps1 to undo.

  Registers the HumanCare Connect native messaging host for Chrome AND Edge on
  THIS machine, for the CURRENT user (HKCU). Run from a normal PowerShell (no
  admin needed).

  Usage:
    .\install.ps1

  There is nothing to look up or type. The extension has a FIXED id (derived
  from the public "key" in Task-Monitoring-Extension\manifest.json), so the same
  id is registered for both browsers:

    acfadakklgdcfmogimojahhgihenaiii

  The old -ChromeId / -EdgeId parameters are gone on purpose: passing them is
  now an error rather than being silently ignored.

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
    - sets, for BOTH browsers (same fixed extension id, exactly one
      allowed_origins entry):
        HKCU\Software\Google\Chrome\NativeMessagingHosts\co.humancareconnect.monitoring
        HKCU\Software\Microsoft\Edge\NativeMessagingHosts\co.humancareconnect.monitoring

  -RegistryRoot is for the automated tests only: it redirects the registry
  writes into a throw-away HKCU subtree so a test run never touches a real
  registration. Leave it at its default. It must be under HKCU:\ — an HKLM
  (machine-wide) location is rejected; that is a separate, later step.
#>

# [CmdletBinding()] makes an unknown parameter (e.g. the old -ChromeId / -EdgeId)
# a hard error; without it PowerShell would silently drop it into $args.
[CmdletBinding()]
param(
    [string]$RegistryRoot = "HKCU:\Software"
)

$ErrorActionPreference = "Stop"

# The ONE extension id this host accepts. It is derived from the public "key" in
# Task-Monitoring-Extension\manifest.json (a test keeps the two in sync). Changing
# the manifest key changes this id and breaks every installed registration.
$ExtensionId = "acfadakklgdcfmogimojahhgihenaiii"

if ($ExtensionId -cnotmatch '^[a-p]{32}$') {
    Write-Error "Internal error: the built-in extension id '$ExtensionId' is not a valid Chromium extension id (expected 32 characters a-p)."
    exit 1
}

# Per-user only (this step). Refuse anything that is not HKCU so this script can
# never be pointed at a machine-wide location by accident.
if ($RegistryRoot -inotmatch '^HKCU:\\') {
    Write-Error "-RegistryRoot must be under HKCU:\ (got '$RegistryRoot'). Machine-wide (HKLM) registration is not implemented here."
    exit 1
}

$HostName = "co.humancareconnect.monitoring"

# Read-only: warn if the production (HKLM) registration exists, because the
# per-user registration this script writes would take precedence over it.
if ((Test-Path "HKLM:\SOFTWARE\Google\Chrome\NativeMessagingHosts\$HostName") -or (Test-Path "HKLM:\SOFTWARE\Microsoft\Edge\NativeMessagingHosts\$HostName")) {
    Write-Warning "A production (HKLM) native messaging registration for '$HostName' exists. The per-user (HKCU) registration this script writes will override it for the current user. Use this script for local development only."
}

# --- locate an Electron runtime to run nativeHost.js with (no system Node.js) ---
#
# Preferred: a packaged, installed Agent. The production installer is
# per-machine, so its uninstall entry is under HKLM (checked first); an older
# per-user install is under HKCU. InstallLocation is looked up by DisplayName,
# never hardcoded.
function Find-InstalledAgent {
    $roots = @(
        "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*",
        "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*"
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
# Exactly one origin: the fixed extension id. (Edge also uses the
# chrome-extension:// scheme.) A typed [string[]] keeps it a JSON array even
# with a single element.
[string[]]$origins = @("chrome-extension://$ExtensionId/")

$manifest = [ordered]@{
    name            = $HostName
    description     = "HumanCare Connect monitoring bridge"
    path            = $BatPath
    type            = "stdio"
    allowed_origins = $origins
}
($manifest | ConvertTo-Json -Depth 4) | Set-Content -Path $ManifestPath -Encoding ascii

# --- registry (HKCU, per-user, no admin) ----------------------------------
# Both browsers, always, pointing at the same host manifest. (By default
# $RegistryRoot is HKCU:\Software, i.e. the real
# HKCU\Software\{Google\Chrome|Microsoft\Edge}\NativeMessagingHosts keys.)
$browserKeys = [ordered]@{
    "Chrome" = "Google\Chrome\NativeMessagingHosts"
    "Edge"   = "Microsoft\Edge\NativeMessagingHosts"
}
foreach ($browser in $browserKeys.Keys) {
    $k = "$RegistryRoot\$($browserKeys[$browser])\$HostName"
    New-Item -Path $k -Force | Out-Null
    Set-ItemProperty -Path $k -Name "(default)" -Value $ManifestPath
    Write-Host ("{0,-7} -> {1}" -f $browser, $k)
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
