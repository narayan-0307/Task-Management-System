<#
  Managed Chrome / Edge force-install policy for the HumanCare monitoring extension.

  INTENDED FOR MANAGED WINDOWS MACHINES (GPO / Intune / MDM). Run elevated, from
  64-bit Windows PowerShell, by an administrator. NOT yet verified on a managed
  machine.

  Actions:
    Status  (default) read-only: show current ExtensionInstallForcelist values
    Apply             add our entry to the Chrome and Edge forcelists
    Remove            remove ONLY the entries whose data is exactly our entry

  Production (default, no -TestOnly) ALWAYS operates under:
    HKLM:\SOFTWARE\Policies\Google\Chrome\ExtensionInstallForcelist
    HKLM:\SOFTWARE\Policies\Microsoft\Edge\ExtensionInstallForcelist
  -RegistryRoot cannot be used to redirect production elsewhere. Writes no
  per-user (HKCU) keys, never touches NativeMessagingUserLevelHosts or any
  other policy, never deletes a policy key, never overwrites an existing value.

  Apply inspects BOTH browsers before changing either; any problem aborts with no changes:
    - our exact entry already present   -> left as is (idempotent)
    - same extension ID, different data -> abort (conflict, resolve manually)
    - value "1" taken by something else -> uses the lowest free numeric name instead
  -WhatIf shows what would happen without writing. It still requires elevation
  and a 64-bit process for Apply/Remove on production, since those checks guard
  which registry view and privilege level the (previewed) write would use.

  Apply/Remove on production additionally require:
    - an elevated (Administrator) session, and
    - a 64-bit PowerShell process on a 64-bit OS (refuses to run under a 32-bit
      process, where registry redirection could silently target the wrong,
      WOW6432Node view instead of the real policy location).

  -TestOnly / -RegistryRoot: TEST-ONLY mechanism, not for production use.
  -RegistryRoot is rejected unless -TestOnly is also supplied. With -TestOnly,
  -RegistryRoot (or its default) is restricted to the dedicated test sandbox
  below, or a subkey of it -- never HKCU:\SOFTWARE\Policies or any other real
  policy location. Under -TestOnly, neither the elevation check nor the 64-bit
  process check applies (the sandbox is HKCU and carries no browser policy
  meaning), so the test suite can run unprivileged.
#>
[CmdletBinding(SupportsShouldProcess = $true)]
param(
  [ValidateSet("Status", "Apply", "Remove")]
  [string]$Action = "Status",

  # TEST-ONLY. Requires -TestOnly. Restricted to the dedicated test sandbox
  # (or a subkey of it) -- see $TestSandboxRoot below. Never a real policy path.
  [string]$RegistryRoot,

  # TEST-ONLY. Required to pass -RegistryRoot at all. Lets the test suite point
  # the script at a throwaway sandbox instead of the real production policy
  # root, and skips the elevation / 64-bit-process checks that production
  # requires (the sandbox is HKCU and has no browser-policy effect).
  [switch]$TestOnly
)

$ErrorActionPreference = "Stop"

$ExtensionId = "acfadakklgdcfmogimojahhgihenaiii"
$UpdateUrl   = "https://darkred-marten-457458.hostingersite.com/monitoring-extension/update.xml"
$Entry       = "$ExtensionId;$UpdateUrl"

$ProductionRoot  = "HKLM:\SOFTWARE\Policies"
$TestSandboxRoot = "HKCU:\Software\HumanCareMonitoring\ForceInstallPolicyTest"

$Browsers = @(
  @{ Name = "Chrome"; Key = "Google\Chrome\ExtensionInstallForcelist" },
  @{ Name = "Edge";   Key = "Microsoft\Edge\ExtensionInstallForcelist" }
)

function Get-ForcelistValues([string]$Path) {
  # Returns @{ Name = Data } for the existing values; $null if the key is absent.
  if (-not (Test-Path -LiteralPath $Path)) { return $null }
  $out = [ordered]@{}
  $item = Get-Item -LiteralPath $Path
  foreach ($n in $item.GetValueNames()) { $out[$n] = [string]$item.GetValue($n) }
  return $out
}

function Test-UnderRoot([string]$Path, [string]$Root) {
  $p = $Path.TrimEnd("\")
  $r = $Root.TrimEnd("\")
  return ($p -ieq $r) -or ($p -ilike "$r\*")
}

# --- -RegistryRoot / -TestOnly validation (always enforced, every Action) ---
$explicitRoot = $PSBoundParameters.ContainsKey("RegistryRoot")

if ($explicitRoot -and -not $TestOnly) {
  throw "-RegistryRoot requires -TestOnly. Production always uses $ProductionRoot and cannot be redirected."
}

if ($TestOnly) {
  if (-not $explicitRoot) { $RegistryRoot = $TestSandboxRoot }
  if (-not (Test-UnderRoot $RegistryRoot $TestSandboxRoot)) {
    throw "-TestOnly only permits the dedicated test sandbox ($TestSandboxRoot) or a subkey of it, not '$RegistryRoot'. Real policy locations (e.g. HKCU:\SOFTWARE\Policies or HKLM:\SOFTWARE\Policies) are never allowed here."
  }
} else {
  $RegistryRoot = $ProductionRoot
}

# --- production-only safety checks (skipped entirely under -TestOnly) ------
if (-not $TestOnly -and $Action -ne "Status") {
  $id = [Security.Principal.WindowsIdentity]::GetCurrent()
  if (-not ([Security.Principal.WindowsPrincipal]$id).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw "Run this script from an elevated (Administrator) PowerShell."
  }
  if ([Environment]::Is64BitOperatingSystem -and -not [Environment]::Is64BitProcess) {
    throw "This is a 64-bit Windows machine but PowerShell is running as a 32-bit process. Registry redirection could silently target the wrong (WOW6432Node) view instead of the real policy. Re-run this script from 64-bit Windows PowerShell (not 'Windows PowerShell (x86)')."
  }
}

# --- inspect everything first ------------------------------------------------
$plan = @()
foreach ($b in $Browsers) {
  $path = Join-Path $RegistryRoot $b.Key
  $vals = Get-ForcelistValues $path
  $ours = @(); $conflict = $null
  if ($vals) {
    foreach ($k in $vals.Keys) {
      if ($vals[$k] -ceq $Entry) { $ours += $k }
      elseif ($vals[$k].Split(";")[0].Trim() -ieq $ExtensionId) { $conflict = "$k = $($vals[$k])" }
    }
  }
  $plan += [pscustomobject]@{ Name = $b.Name; Path = $path; Values = $vals; Ours = $ours; Conflict = $conflict }
}

if ($Action -eq "Status") {
  foreach ($p in $plan) {
    Write-Host "$($p.Name): $($p.Path)"
    if (-not $p.Values) { Write-Host "  (key does not exist)"; continue }
    foreach ($k in $p.Values.Keys) { Write-Host "  $k = $($p.Values[$k])" }
    Write-Host ("  our entry: " + $(if ($p.Ours.Count) { "present (value " + ($p.Ours -join ", ") + ")" } else { "absent" }))
  }
  return
}

if ($Action -eq "Apply") {
  foreach ($p in $plan) {
    if ($p.Conflict) { throw "$($p.Name): existing entry for this extension ID has different data ($($p.Conflict)). Nothing was changed; resolve it manually." }
  }
  foreach ($p in $plan) {
    if ($p.Ours.Count) { Write-Host "$($p.Name): already present (value $($p.Ours -join ', ')) - no change."; continue }
    $used = @(); if ($p.Values) { $used = @($p.Values.Keys) }
    $n = 1; while ($used -contains "$n") { $n++ }
    if ($PSCmdlet.ShouldProcess("$($p.Path)", "Set value '$n' = $Entry")) {
      if (-not (Test-Path -LiteralPath $p.Path)) { New-Item -Path $p.Path -Force | Out-Null }
      New-ItemProperty -LiteralPath $p.Path -Name "$n" -Value $Entry -PropertyType String | Out-Null  # no overwrite flag
      Write-Host "$($p.Name): added value '$n'."
    }
  }
  return
}

# Remove: only values whose data is exactly our entry. Keys are never deleted.
foreach ($p in $plan) {
  if (-not $p.Ours.Count) { Write-Host "$($p.Name): our entry not present - nothing to remove."; continue }
  foreach ($k in $p.Ours) {
    if ($PSCmdlet.ShouldProcess("$($p.Path)", "Remove value '$k'")) {
      Remove-ItemProperty -LiteralPath $p.Path -Name $k
      Write-Host "$($p.Name): removed value '$k'."
    }
  }
}
