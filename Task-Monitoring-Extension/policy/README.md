# Managed force-install policy (Chrome + Edge)

Deploys the HumanCare Monitoring Extension to **managed Windows devices** (GPO, Intune, MDM,
or any equivalent browser-management tooling) by setting the Chrome and Edge force-install
policy. This is an administrator deployment artifact — it is not applied by the extension
itself or by the Task Monitoring Agent installer.

> **Not yet validated on a managed machine.** See [Validation status](#validation-status).

## Production extension

| | |
|---|---|
| Extension ID | `acfadakklgdcfmogimojahhgihenaiii` |
| Update URL | `https://darkred-marten-457458.hostingersite.com/monitoring-extension/update.xml` |

## Registry policy

| Browser | Key (HKLM) |
|---|---|
| Chrome | `HKLM:\SOFTWARE\Policies\Google\Chrome\ExtensionInstallForcelist` |
| Edge | `HKLM:\SOFTWARE\Policies\Microsoft\Edge\ExtensionInstallForcelist` |

Each entry is a `REG_SZ` value. The value **name** is an arbitrary number (`1`, `2`, …); the
value **data** must be:

```
<EXTENSION_ID>;<UPDATE_URL>
```

i.e. for this extension:

```
acfadakklgdcfmogimojahhgihenaiii;https://darkred-marten-457458.hostingersite.com/monitoring-extension/update.xml
```

The same entry is written to both the Chrome and Edge forcelist keys. The script sets nothing
else — no HKCU policy, no `NativeMessagingUserLevelHosts` (owned by the Agent installer), no
`NativeMessagingAllowlist`.

**Production always uses `HKLM:\SOFTWARE\Policies` for Chrome and Edge.** This is hardcoded and
cannot be redirected — see [Test-only sandbox](#test-only-sandbox-do-not-use-in-production)
below for the one, explicitly-gated exception.

## Script

`policy/force-install-policy.ps1` — run from an elevated, **64-bit** Windows PowerShell.

```
force-install-policy.ps1 [-Action Status|Apply|Remove] [-RegistryRoot <path> -TestOnly]
```

- `-Action` (default `Status`): which operation to run.
- `-RegistryRoot` / `-TestOnly`: **test-only**, not for production use. See
  [Test-only sandbox](#test-only-sandbox-do-not-use-in-production).
- Supports `-WhatIf` (from `SupportsShouldProcess`) on `Apply` and `Remove` to preview the
  change without writing anything. On production, previewing still requires an elevated,
  64-bit session (see below) — `-WhatIf` only skips the registry write itself, not the
  elevation or 64-bit-process checks that gate it.
- `Apply`/`Remove` on the production root additionally require:
  - an **elevated (Administrator)** session, and
  - a **64-bit PowerShell process** on a 64-bit OS. The script refuses to run otherwise, so it
    never silently writes to an ambiguous (WOW6432Node-redirected) registry view. This guard
    exists defensively, in response to an audit finding; actual WOW64 behavior for this policy
    location has not been independently verified on a real managed machine — the guard simply
    rules out the ambiguous case instead of claiming to have solved it.
- `Status` remains read-only and requires neither elevation nor a 64-bit process.

### Apply procedure

```powershell
cd "Task-Monitoring-Extension\policy"

# Preview current state (read-only, no admin required)
.\force-install-policy.ps1

# Preview what Apply would change (still requires an elevated, 64-bit session —
# see "Script" above; -WhatIf previews the write, not the privilege checks)
.\force-install-policy.ps1 -Action Apply -WhatIf

# Apply, from an elevated, 64-bit Windows PowerShell
.\force-install-policy.ps1 -Action Apply
```

`Status` prints every existing value under both forcelist keys and whether our entry is
already present. `Apply` inspects both browsers before writing anything:

- If our exact entry is already present under a browser, that browser is left unchanged
  (idempotent).
- If an entry already exists for our extension ID but with different data, `Apply` aborts
  with an error and makes **no changes to either browser** — it never overwrites an existing
  value.
- Otherwise it writes our entry under the lowest value name not already in use (`1` if free,
  otherwise the next free number, filling any gap — e.g. with `1` and `3` taken, it uses `2`),
  for Chrome and Edge independently.

### Remove procedure

```powershell
cd "Task-Monitoring-Extension\policy"
.\force-install-policy.ps1 -Action Remove -WhatIf   # preview (still needs an elevated, 64-bit session)
.\force-install-policy.ps1 -Action Remove            # from an elevated, 64-bit Windows PowerShell
```

`Remove` deletes only the value(s), under either forcelist key, whose data exactly matches our
extension ID + update URL entry. It never deletes the `ExtensionInstallForcelist` key itself,
and never touches any other value under it, even one that happens to share the same value name
(e.g. `1`) as our entry would use.

## Test-only sandbox (do not use in production)

`-RegistryRoot` and `-TestOnly` exist **only** so the automated test suite can point the script
at a throwaway registry location instead of the real policy. They are not an administrator
option.

- `-RegistryRoot` is rejected unless `-TestOnly` is also passed.
- With `-TestOnly`, `-RegistryRoot` (or its default, if omitted) is restricted to the script's
  dedicated sandbox, `HKCU:\Software\HumanCareMonitoring\ForceInstallPolicyTest`, or a subkey of
  it. Anything else is rejected — including `HKCU:\SOFTWARE\Policies`, which **is** a real
  browser policy location (Chrome/Edge also honor a per-user forcelist there) and must never be
  used as a stand-in for testing.
- `-TestOnly` skips the elevation and 64-bit-process checks, because the sandbox is an ordinary
  HKCU key with no browser-policy effect.

**Administrators should never pass `-RegistryRoot` (with or without `-TestOnly`).** Running the
script with no flags, or with just `-Action`, always targets the real production root.

## Safety behaviour (covered by `test/forcePolicy.test.js`, 24/24 passing)

- Existing, unrelated forcelist entries (other extensions) are preserved by both `Apply` and
  `Remove`, including when they leave a numeric gap (e.g. values `1` and `3` already present).
- Unrelated policies under `Google\Chrome` / `Microsoft\Edge` are left untouched; `Remove`
  deletes only the matching value(s), never the forcelist key or any sibling policy.
- A conflicting pre-existing entry for our extension ID (same ID, different update URL) causes
  `Apply` to abort before writing anything to either browser.
- `Remove` only ever removes entries whose data is exactly the entry this script would write —
  it will not remove an unrelated entry even if it occupies the value name (e.g. `1`) our
  entry would otherwise use.
- `-WhatIf` on `Apply`/`Remove` writes nothing to the registry.
- The written value's registry type is `REG_SZ`.
- `-RegistryRoot` without `-TestOnly`, and `-TestOnly` with anything outside the dedicated
  sandbox (including `HKCU:\SOFTWARE\Policies` and other arbitrary HKCU paths), are rejected.
- The production root stays `HKLM:\SOFTWARE\Policies` regardless of what's passed (a default,
  no-flags `Status` run is checked against that literal path).

The elevation and 64-bit-process requirements for production `Apply`/`Remove` are verified by
static source checks (that the guard is unconditional whenever `-TestOnly` is absent, and that
it covers both `Apply` and `Remove`), not by live invocation — doing so live would require
actually running `Apply`/`Remove` against the real `HKLM:\SOFTWARE\Policies` root, which this
test suite must never do. See the comments in `forcePolicy.test.js` for the full reasoning,
including why a real 32-bit-process run isn't simulated either.

## Managed-device requirement

This policy only has effect on **managed Windows devices** where Chrome/Edge are configured to
read policy from `HKLM\SOFTWARE\Policies` via GPO, Intune, or another MDM/browser-management
product. On an unmanaged device the registry values can be set but the browser will not apply
Enterprise policy from them (no management enrollment), so nothing will install.

## Validation status

- Policy tests (`test/forcePolicy.test.js`): **24/24 passing**.
- Full extension test suite (`npm test`): **115/115 passing**, no regressions.
- Production HTTPS update URL: configured and present in the script
  (`https://darkred-marten-457458.hostingersite.com/monitoring-extension/update.xml`).
- **Actual managed Chrome/Edge force-install on a real managed machine: not yet performed.**
  Whether the extension force-installs, whether an employee can disable or remove it under
  that policy, and whether the 64-bit/WOW6432Node guard behaves as expected on a real 64-bit
  managed box, must still be verified there before relying on this in production.
