# Deploying the monitoring extension

The extension only works alongside the desktop Monitoring Agent: it talks to the
Agent over Chrome/Edge Native Messaging. They are deployed as a pair, but by
different mechanisms:

- **Agent** (and the Native Messaging host): the machine-wide Agent installer.
- **Extension**: a signed CRX3, intended to be force-installed by managed
  browser policy (not yet set up — see Deployment status).

---

## Deployment status

**DONE**

- Fixed extension ID (`acfadakklgdcfmogimojahhgihenaiii`)
- Signed CRX3 packaging (`npm run package`)
- `update.xml` generation
- Machine-wide Agent installer (per-machine, Program Files)
- HKLM Native Messaging registration (Chrome and Edge)
- `NativeMessagingUserLevelHosts` policy (set only if absent)
- Fixed `allowed_origins`

**NOT DONE**

- Production HTTPS extension hosting (no real hosting URL exists yet)
- Managed Chrome `ExtensionInstallForcelist`
- Managed Edge `ExtensionInstallForcelist`
- Real managed Windows validation
- Update/upgrade validation
- Production deployment runbook

What has and has not been verified:

- The extension test suite passes (91/91).
- A real CRX was generated with a signing key kept outside the repository, and
  checked locally: CRX3 structure and signature verification only.
- The CRX has **not** been accepted/installed by Chrome or Edge, and managed
  force-install has **not** been tested.

---

## Architecture

```
Managed browser
    ↓
force-installed extension
    ↓
Chrome/Edge Native Messaging
    ↓
HKLM native host registration
    ↓
Agent nativeHost.js
    ↓
Agent bridge
    ↓
local named pipe
    ↓
Monitoring Agent
    ↓
backend
```

(The "force-installed" step is the intended production path; the policy that
does it is not implemented yet.)

How it runs:

- The Agent starts → `bridgeServer.start()` opens the pipe
  `\\.\pipe\co.humancareconnect.monitoring` and writes a token to
  `%USERPROFILE%\.humancare-monitoring\ext-bridge.json` (0600).
- The browser loads the extension → its background worker calls
  `connectNative("co.humancareconnect.monitoring")` → the browser runs the host
  registered under HKLM → `native-host.bat` → `nativeHost.js`, which reads the
  token file and connects to the pipe.
- The heartbeat says `content_capture.active === true` → the Agent calls
  `extensionBridge.setState({enabled:true, blocklist})` → the bridge pushes that
  to the extension → it starts forwarding search/prompt commits.
- Everything downstream (consent version check, blocklist re-check, encryption,
  retention, audit) is the same as the Agent's own UIA capture path.

---

## 1. Fixed extension ID

The extension ID is derived from the public `key` in `manifest.json`, so it is
the same on every machine, in Chrome and Edge, from any folder:

**`acfadakklgdcfmogimojahhgihenaiii`**

- The `key` is a **public** key and is committed.
- The matching **private** key is **not** in this repository and must never be
  committed (`*.pem`, `*.key`, `*.p12`, `*.pfx` are git-ignored, and
  `test/manifest.test.js` fails if a key file or private-key block appears
  here). It is needed only to sign the CRX; it is not needed to build, load or
  compute the ID. Keep it in the organisation's secrets store with a backup.
- **Do not regenerate the key.** A new key means a new ID, which breaks the
  Native Messaging `allowed_origins` entry (baked into the Agent installer) and
  any policy naming the old ID. `test/manifest.test.js` pins the ID.

---

## 2. Packaging the extension (signed CRX3 + update.xml)

```powershell
npm run build
$env:HC_EXTENSION_KEY = "<path to the PEM signing key, OUTSIDE this repo>"
$env:HC_EXTENSION_UPDATE_BASE_URL = "https://<real-host>"   # must be https
npm run package
```

- `HC_EXTENSION_KEY` is the only way the key is supplied. The script refuses a
  key inside the repository and never prints, copies or logs it.
- Output is `release/humancare-monitoring-<version>.crx` and `release/update.xml`
  (git-ignored). The version comes from `dist/manifest.json`; bump
  `manifest.json` for every release or browsers will not update.
- The script fails unless the CRX's extension ID is exactly
  `acfadakklgdcfmogimojahhgihenaiii`, the signature verifies, and the key matches
  `manifest.json`'s `key`. It also fails if `HC_EXTENSION_UPDATE_BASE_URL` is
  missing.
- Packaging does not publish anything. No production hosting exists yet; the
  `.crx` and `update.xml` must be served over HTTPS from the URL given in
  `HC_EXTENSION_UPDATE_BASE_URL` once a host is chosen.

---

## 3. Agent installer and Native Messaging host (production)

The Agent installer (electron-builder NSIS, `perMachine: true`, runs elevated,
installs under Program Files) does all of the following. Employees do nothing
by hand.

- Registers the machine-wide scheduled task `HumanCare Connect Monitoring Agent`
  (runs the Agent at logon for any user, least privilege).
- Creates the Native Messaging host under the Agent installation directory
  (`<INSTDIR>\native-host\`, not user-writable):
  - `native-host.bat` — runs `nativeHost.js` from `resources\app.asar` through
    the Agent executable with `ELECTRON_RUN_AS_NODE=1`.
  - `co.humancareconnect.monitoring.json` — the host manifest, with exactly one
    allowed origin: `chrome-extension://acfadakklgdcfmogimojahhgihenaiii/`
- Registers the host under **HKLM** for both browsers (no HKCU keys):

  ```
  HKLM\SOFTWARE\Google\Chrome\NativeMessagingHosts\co.humancareconnect.monitoring
  HKLM\SOFTWARE\Microsoft\Edge\NativeMessagingHosts\co.humancareconnect.monitoring
    (Default) = "<INSTDIR>\native-host\co.humancareconnect.monitoring.json"
  ```

- Sets, **only when the value does not already exist**, so per-user hosts cannot
  shadow the machine-wide one:

  ```
  HKLM\SOFTWARE\Policies\Google\Chrome\NativeMessagingUserLevelHosts   = REG_DWORD 0
  HKLM\SOFTWARE\Policies\Microsoft\Edge\NativeMessagingUserLevelHosts  = REG_DWORD 0
  ```

  Pre-existing organisation policy values are preserved. The installer records
  only the values it created (marker files in `<INSTDIR>\native-host\`), and the
  uninstaller removes only those, plus the two host keys and the host files.

Production deployment must **not** tell employees to load the extension
unpacked, run `install.ps1`, type extension IDs, or create HKCU Native
Messaging registrations.

---

## 4. Extension force-install (NOT IMPLEMENTED)

`ExtensionInstallForcelist` for Chrome and Edge has **not** been implemented or
tested, and there is no production hosting URL to point it at. When it is built,
it will reference extension ID `acfadakklgdcfmogimojahhgihenaiii` and the
HTTPS `update.xml` URL from §2. Until then, the extension is not installed on
managed machines by anything in this repository.

---

## Local development / testing (single machine, from source)

> **Development only. This is not the production deployment mechanism.**
> `native-host/install.ps1` is a local-user helper; do not use it for employees.

No key, hosting or policy needed:

```powershell
# 1. build the extension
cd Task-Monitoring-Extension
npm install; npm run build          # -> dist\

# 2. load dist\ unpacked in Chrome (chrome://extensions, Developer mode,
#    Load unpacked) and in Edge (edge://extensions). The ID is fixed (see §1):
#    both browsers should show acfadakklgdcfmogimojahhgihenaiii — nothing to copy.

# 3. register the native messaging host for this user (Chrome AND Edge, HKCU,
#    no admin, no parameters)
cd native-host
.\install.ps1

# 4. restart Chrome AND Edge completely (close every window)

# 5. start the updated agent from source
cd ..\..\Task-Monitoring-Agent
npm install; npm start
```

`install.ps1` takes no `-ChromeId` / `-EdgeId` (passing them is an error). It
writes one `allowed_origins` entry,
`chrome-extension://acfadakklgdcfmogimojahhgihenaiii/`, and registers the same
host for both browsers under `HKCU\Software\Google\Chrome\NativeMessagingHosts\`
and `HKCU\Software\Microsoft\Edge\NativeMessagingHosts\`, with files in
`%LOCALAPPDATA%\HumanCareMonitoring\`. `.\uninstall.ps1` removes the
registration.

On a machine that also has the production Agent installed, the HKLM policy
`NativeMessagingUserLevelHosts = 0` makes browsers ignore these HKCU
registrations, so this helper will not work there.

---

## Verifying on one machine

1. Agent running, extension installed (unpacked for dev), heartbeat shows
   capture active.
2. `chrome://extensions` → the extension has no errors; its service worker is
   "active".
3. Do a search on any site → within one flush interval it appears in the
   dashboard's Search & Prompt Content.
4. Do a search in an Incognito window → it must NOT appear.
5. Do a search on a bank site → it must NOT appear.
6. Agent log shows the periodic `Content capture stats` line with a rising
   `captured` / `sent`.
