"use strict";

// Black-box tests for native-host/install.ps1 and uninstall.ps1. Windows-only,
// like the rest of this deployment tooling.
//
// SAFETY: install.ps1 writes registry keys. Every run here goes through
// runInstall(), which ALWAYS passes -RegistryRoot pointing into a throw-away
// subtree (HKCU\Software\HumanCareInstallTest\<random>) and its own temporary
// %LOCALAPPDATA%, so these tests never create, change or delete the real
//   HKCU\Software\Google\Chrome\NativeMessagingHosts\co.humancareconnect.monitoring
//   HKCU\Software\Microsoft\Edge\NativeMessagingHosts\co.humancareconnect.monitoring
// keys. The last test proves it by comparing the real keys before and after.

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const { spawnSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const isWin = process.platform === "win32";
const WIN_ONLY = !isWin && "Windows-only deployment tooling";

const INSTALL_PS1 = require.resolve("../native-host/install.ps1");
const UNINSTALL_PS1 = require.resolve("../native-host/uninstall.ps1");
const MANIFEST = path.join(__dirname, "..", "manifest.json");

const HOST_NAME = "co.humancareconnect.monitoring";
const FIXED_EXTENSION_ID = "acfadakklgdcfmogimojahhgihenaiii";
const EXPECTED_ORIGIN = `chrome-extension://${FIXED_EXTENSION_ID}/`;

const CHROME_REL = "Google\\Chrome\\NativeMessagingHosts";
const EDGE_REL = "Microsoft\\Edge\\NativeMessagingHosts";

const SANDBOX_PARENT = "HKCU\\Software\\HumanCareInstallTest"; // reg.exe form (no colon)

// --- helpers ---------------------------------------------------------------

function idFromKey(keyB64) {
  return crypto
    .createHash("sha256")
    .update(Buffer.from(keyB64, "base64"))
    .digest("hex")
    .slice(0, 32)
    .replace(/[0-9a-f]/g, (c) => String.fromCharCode(97 + parseInt(c, 16)));
}

function regDefault(keyNoColon) {
  const r = spawnSync("reg.exe", ["query", keyNoColon, "/ve"], { encoding: "utf8" });
  if (r.status !== 0) return null;
  const m = /REG_SZ\s+(.*)\r?$/m.exec(r.stdout);
  return m ? m[1].trim() : "";
}

function regDeleteTree(keyNoColon) {
  spawnSync("reg.exe", ["delete", keyNoColon, "/f"], { encoding: "utf8" });
}

// The REAL registrations, captured once at load. Used to prove the tests never
// touch them (and to avoid running uninstall.ps1 if one is really installed).
const REAL_CHROME = `HKCU\\Software\\${CHROME_REL}\\${HOST_NAME}`;
const REAL_EDGE = `HKCU\\Software\\${EDGE_REL}\\${HOST_NAME}`;
const realBefore = isWin ? { chrome: regDefault(REAL_CHROME), edge: regDefault(REAL_EDGE) } : {};
const realRegistrationExists = Boolean(realBefore.chrome !== null && realBefore.chrome !== undefined) || Boolean(realBefore.edge !== null && realBefore.edge !== undefined);

/** A fresh isolated environment: temp %LOCALAPPDATA% + sandbox registry root. */
function sandbox() {
  const localAppData = fs.mkdtempSync(path.join(os.tmpdir(), "hcc-install-test-"));
  const id = crypto.randomBytes(6).toString("hex");
  const regRootNoColon = `${SANDBOX_PARENT}\\${id}`;
  return {
    localAppData,
    regRoot: `HKCU:\\Software\\HumanCareInstallTest\\${id}`, // PowerShell form
    regRootNoColon,
    dir: path.join(localAppData, "HumanCareMonitoring"),
    cleanup() {
      regDeleteTree(regRootNoColon);
      fs.rmSync(localAppData, { recursive: true, force: true });
    },
  };
}

function runInstall(sb, extraArgs = [], { regRoot = sb.regRoot } = {}) {
  // Hard guard: refuse to run against anything but the sandbox (or a value the
  // test deliberately uses to prove rejection, which the script rejects first).
  assert.ok(
    regRoot.startsWith("HKCU:\\Software\\HumanCareInstallTest\\") || /^HKLM:/i.test(regRoot),
    "tests must never run install.ps1 against the real registry",
  );
  return spawnSync(
    "powershell.exe",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", INSTALL_PS1, "-RegistryRoot", regRoot, ...extraArgs],
    { env: { ...process.env, LOCALAPPDATA: sb.localAppData }, encoding: "utf8", timeout: 30000 },
  );
}

function runUninstall(sb) {
  return spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", UNINSTALL_PS1], {
    env: { ...process.env, LOCALAPPDATA: sb.localAppData },
    encoding: "utf8",
    timeout: 30000,
  });
}

const scriptText = fs.readFileSync(INSTALL_PS1, "utf8");

// --- static checks (no PowerShell, no registry) ------------------------------

test("install.ps1 pins one valid extension id that matches the manifest key", () => {
  const m = /\$ExtensionId\s*=\s*"([^"]+)"/.exec(scriptText);
  assert.ok(m, "install.ps1 must define $ExtensionId");
  assert.equal(m[1], FIXED_EXTENSION_ID);
  assert.match(m[1], /^[a-p]{32}$/);

  // the script validates it with the required pattern, case-sensitively
  assert.match(scriptText, /\$ExtensionId\s+-cnotmatch\s+'\^\[a-p\]\{32\}\$'/);

  // and it is the id the manifest "key" actually produces
  const { key } = JSON.parse(fs.readFileSync(MANIFEST, "utf8"));
  assert.equal(idFromKey(key), m[1]);
});

test("install.ps1 no longer declares -ChromeId / -EdgeId", () => {
  const params = /^\s*param\s*\(([\s\S]*?)\)/m.exec(scriptText);
  assert.ok(params, "param block not found");
  assert.doesNotMatch(params[1], /ChromeId|EdgeId/);
  assert.match(params[1], /\$RegistryRoot\s*=\s*"HKCU:\\Software"/, "RegistryRoot must default to the real HKCU:\\Software");
  // no leftover code paths that branch on the old parameters
  assert.doesNotMatch(scriptText, /\$ChromeId|\$EdgeId/);
});

test("install.ps1 registers per-user (HKCU) only — HKLM is only ever READ", () => {
  // ignore the <# help #> block and # comments; look at executable lines only
  const code = scriptText.replace(/<#[\s\S]*?#>/, "");
  const hklmLines = code.split(/\r?\n/).filter((l) => /HKLM/i.test(l) && !/^\s*#/.test(l));
  // the only HKLM uses: (1) READING the installed Agent's uninstall entry,
  // (2) the error text that rejects an HKLM -RegistryRoot. Never a write.
  for (const line of hklmLines) {
    assert.ok(
      /CurrentVersion\\Uninstall/.test(line) || /Write-Error/.test(line) || /Test-Path\s+"HKLM:[^"]*NativeMessagingHosts/.test(line) || /Write-Warning/.test(line),
      `unexpected HKLM reference: ${line.trim()}`,
    );
    assert.doesNotMatch(line, /New-Item|Set-ItemProperty|Remove-Item|reg\s+add/i);
  }
  assert.ok(hklmLines.some((l) => /CurrentVersion\\Uninstall/.test(l)), "Agent detection (uninstall-entry lookup) must be preserved");
  // and the registry write targets are the HKCU-rooted browser keys
  assert.match(scriptText, /"Chrome"\s*=\s*"Google\\Chrome\\NativeMessagingHosts"/);
  assert.match(scriptText, /"Edge"\s*=\s*"Microsoft\\Edge\\NativeMessagingHosts"/);
});

// --- runtime checks (isolated: temp LOCALAPPDATA + sandbox registry) ---------

test("install.ps1 runs with NO arguments and writes exactly one fixed allowed origin", { skip: WIN_ONLY }, () => {
  const sb = sandbox();
  try {
    const result = runInstall(sb); // no -ChromeId / -EdgeId
    assert.equal(result.status, 0, `install.ps1 failed: ${result.stderr}`);

    const jsonPath = path.join(sb.dir, `${HOST_NAME}.json`);
    assert.ok(fs.existsSync(jsonPath), "host manifest was not created");
    const manifest = JSON.parse(fs.readFileSync(jsonPath, "utf8"));

    // structure unchanged: same fields, same order, same constant values
    assert.deepEqual(Object.keys(manifest), ["name", "description", "path", "type", "allowed_origins"]);
    assert.equal(manifest.name, HOST_NAME);
    assert.equal(manifest.description, "HumanCare Connect monitoring bridge");
    assert.equal(manifest.type, "stdio");
    assert.equal(manifest.path, path.join(sb.dir, "native-host.bat"));

    // exactly ONE origin, and it is the fixed id
    assert.ok(Array.isArray(manifest.allowed_origins), "allowed_origins must be a JSON array");
    assert.equal(manifest.allowed_origins.length, 1);
    assert.equal(manifest.allowed_origins[0], EXPECTED_ORIGIN);
    const idInOrigin = /^chrome-extension:\/\/([^/]+)\/$/.exec(manifest.allowed_origins[0]);
    assert.ok(idInOrigin);
    assert.match(idInOrigin[1], /^[a-p]{32}$/);
    assert.equal(idInOrigin[1], FIXED_EXTENSION_ID);

    // the installer prints the same single origin
    assert.ok(result.stdout.includes(EXPECTED_ORIGIN));
    assert.equal(result.stdout.split(EXPECTED_ORIGIN).length - 1, 1, "origin should be listed exactly once");
  } finally {
    sb.cleanup();
  }
});

test("install.ps1 registers the SAME host manifest for BOTH Chrome and Edge (HKCU)", { skip: WIN_ONLY }, () => {
  const sb = sandbox();
  try {
    const result = runInstall(sb);
    assert.equal(result.status, 0, `install.ps1 failed: ${result.stderr}`);

    const jsonPath = path.join(sb.dir, `${HOST_NAME}.json`);
    const chromeKey = `${sb.regRootNoColon}\\${CHROME_REL}\\${HOST_NAME}`;
    const edgeKey = `${sb.regRootNoColon}\\${EDGE_REL}\\${HOST_NAME}`;

    assert.equal(regDefault(chromeKey), jsonPath, "Chrome registration missing or wrong");
    assert.equal(regDefault(edgeKey), jsonPath, "Edge registration missing or wrong");

    // announced in the output with the real-key relative layout
    assert.match(result.stdout, new RegExp(`Chrome\\s+->\\s+.*${CHROME_REL.replace(/\\/g, "\\\\")}\\\\${HOST_NAME.replace(/\./g, "\\.")}`));
    assert.match(result.stdout, new RegExp(`Edge\\s+->\\s+.*${EDGE_REL.replace(/\\/g, "\\\\")}\\\\${HOST_NAME.replace(/\./g, "\\.")}`));
  } finally {
    sb.cleanup();
  }
});

test("passing the old -ChromeId / -EdgeId is rejected, not silently ignored", { skip: WIN_ONLY }, () => {
  for (const args of [["-ChromeId", "abcdefghijklmnopabcdefghijklmnop"], ["-EdgeId", "abcdefghijklmnopabcdefghijklmnop"]]) {
    const sb = sandbox();
    try {
      const result = runInstall(sb, args);
      assert.notEqual(result.status, 0, `${args[0]} should be an unknown parameter`);
      assert.equal(fs.existsSync(sb.dir), false, "nothing may be written when parameters are rejected");
      assert.equal(regDefault(`${sb.regRootNoColon}\\${CHROME_REL}\\${HOST_NAME}`), null);
    } finally {
      sb.cleanup();
    }
  }
});

test("a machine-wide (HKLM) -RegistryRoot is refused before anything is written", { skip: WIN_ONLY }, () => {
  const sb = sandbox();
  try {
    const result = runInstall(sb, [], { regRoot: "HKLM:\\Software\\HumanCareInstallTest\\never" });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /HKCU/);
    assert.equal(fs.existsSync(sb.dir), false, "no files may be created when the root is rejected");
  } finally {
    sb.cleanup();
  }
});

test("install.ps1 generates the same native-host.bat as before (no system node.exe)", { skip: WIN_ONLY }, () => {
  const sb = sandbox();
  try {
    const result = runInstall(sb);
    assert.equal(result.status, 0, `install.ps1 failed: ${result.stderr}`);

    const batPath = path.join(sb.dir, "native-host.bat");
    assert.ok(fs.existsSync(batPath), "native-host.bat was not created");
    const bat = fs.readFileSync(batPath, "utf8");

    // 1 & 3: no system Node.js required.
    assert.equal(/node\.exe/i.test(bat) && !/electron\.exe/i.test(bat), false);
    assert.doesNotMatch(bat, /Program Files\\nodejs/i);

    // 4: ELECTRON_RUN_AS_NODE=1 is set.
    assert.match(bat, /set ELECTRON_RUN_AS_NODE=1/);

    // 3: the wrapper points at an Electron/Agent executable, not a bare node.exe.
    assert.match(bat, /electron\.exe|Task Monitoring Agent\.exe/i);

    // 5: nativeHost.js is forwarded as the script argument.
    assert.match(bat, /nativeHost\.js/);

    // 6: %* argument forwarding is preserved.
    assert.match(bat.trim(), /%\*\s*$/);

    // 7: paths are quoted (the generated command line has real spaces in it,
    // e.g. "Task Management System", "Task Monitoring Agent.exe").
    const execLine = bat.split("\n").find((l) => l.includes("nativeHost.js"));
    assert.ok(execLine, "expected an exec line referencing nativeHost.js");
    assert.match(execLine, /^"[^"]+"\s+"[^"]+"\s+%\*\s*$/);

    // exactly the three lines install.ps1 has always written
    assert.deepEqual(bat.split(/\r?\n/).filter(Boolean).slice(0, 2), ["@echo off", "set ELECTRON_RUN_AS_NODE=1"]);

    // 5 (security): no secrets/tokens/credentials of any kind in the .bat.
    for (const forbidden of ["secret", "token", "password", "Authorization", "Bearer "]) {
      assert.equal(bat.toLowerCase().includes(forbidden.toLowerCase()), false, `.bat unexpectedly contains "${forbidden}"`);
    }
  } finally {
    sb.cleanup();
  }
});

test(
  "uninstall.ps1 still removes the files install.ps1 wrote",
  {
    skip:
      WIN_ONLY ||
      (realRegistrationExists &&
        "a REAL host registration exists on this machine — not running uninstall.ps1 (it would delete it)"),
  },
  () => {
    const sb = sandbox();
    try {
      const installResult = runInstall(sb);
      assert.equal(installResult.status, 0, `install.ps1 failed: ${installResult.stderr}`);
      assert.ok(fs.existsSync(path.join(sb.dir, "native-host.bat")));
      assert.ok(fs.existsSync(path.join(sb.dir, `${HOST_NAME}.json`)));

      // uninstall.ps1 acts on the real HKCU keys (absent here, so a no-op) and on
      // the files under this test's temporary %LOCALAPPDATA%.
      const uninstallResult = runUninstall(sb);
      assert.equal(uninstallResult.status, 0, `uninstall.ps1 failed: ${uninstallResult.stderr}`);
      assert.equal(fs.existsSync(path.join(sb.dir, "native-host.bat")), false);
      assert.equal(fs.existsSync(path.join(sb.dir, `${HOST_NAME}.json`)), false);
    } finally {
      sb.cleanup();
    }
  },
);

// --- must stay LAST ----------------------------------------------------------

test("the real Chrome/Edge registrations were not touched by this test file", { skip: WIN_ONLY }, () => {
  assert.equal(regDefault(REAL_CHROME), realBefore.chrome);
  assert.equal(regDefault(REAL_EDGE), realBefore.edge);
  // and the throw-away parent key is gone (each test removed its own subtree)
  regDeleteTree(SANDBOX_PARENT);
  assert.equal(regDefault(SANDBOX_PARENT), null);
});
