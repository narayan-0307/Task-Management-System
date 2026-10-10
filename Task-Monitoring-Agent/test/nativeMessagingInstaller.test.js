"use strict";

// Production Native Messaging deployment (installer.nsh): machine-wide, HKLM,
// files under <INSTDIR>\native-host\. These are static checks of the NSIS
// script; the real install behaviour needs a clean-Windows installer test.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const nsh = fs.readFileSync(path.join(__dirname, "..", "build", "installer.nsh"), "utf8");
const lines = nsh.split(/\r?\n/);

const HOST = "co.humancareconnect.monitoring";
const EXT_ID = "acfadakklgdcfmogimojahhgihenaiii";
const CHROME_KEY = `SOFTWARE\\Google\\Chrome\\NativeMessagingHosts\\${HOST}`;
const EDGE_KEY = `SOFTWARE\\Microsoft\\Edge\\NativeMessagingHosts\\${HOST}`;
const MANIFEST = `$INSTDIR\\native-host\\${HOST}.json`;
const BAT = "$INSTDIR\\native-host\\native-host.bat";

function macroBody(name) {
  const m = nsh.match(new RegExp(`!macro ${name}\\b([\\s\\S]*?)!macroend`));
  assert.ok(m, `macro ${name} missing`);
  return m[1];
}
const install = macroBody("customInstall");
const uninstall = macroBody("customUnInstall");
const code = (s) => s.split(/\r?\n/).filter((l) => !/^\s*;/.test(l)).join("\n");

const manifestCmd = lines.find((l) => /^\s*nsExec::/.test(l) && l.includes("ConvertTo-Json"));
const batLines = lines.filter((l) => /^\s*FileWrite \$2 '/.test(l));

test("fixed extension id is exactly the one allowed origin (no wildcards, no other ids)", () => {
  assert.ok(manifestCmd, "manifest generation command missing");
  const origins = manifestCmd.match(/allowed_origins = \[string\[\]\]@\(([^)]*)\)/);
  assert.ok(origins);
  assert.equal(origins[1].trim(), `'chrome-extension://${EXT_ID}/'`);
  assert.equal((nsh.match(/chrome-extension:\/\//g) || []).length, 1);
  assert.doesNotMatch(manifestCmd, /\*/);
  assert.equal((nsh.match(/\b[a-p]{32}\b/g) || []).length, 1);
});

test("extension id matches the dev install.ps1 and the extension manifest test", () => {
  const ps1 = path.join(__dirname, "..", "..", "Task-Monitoring-Extension", "native-host", "install.ps1");
  if (!fs.existsSync(ps1)) return;
  assert.match(fs.readFileSync(ps1, "utf8"), new RegExp(`\\$ExtensionId = "${EXT_ID}"`));
});

test("host name is exactly co.humancareconnect.monitoring in manifest and both registry keys", () => {
  assert.match(manifestCmd, new RegExp(`name = '${HOST.replace(/\./g, "\\.")}'`));
  assert.ok(install.includes(`${HOST}.json`));
});

test("Chrome and Edge are registered in HKLM with the manifest path as the default value", () => {
  assert.ok(install.includes(`WriteRegStr HKLM "${CHROME_KEY}" "" "${MANIFEST}"`));
  assert.ok(install.includes(`WriteRegStr HKLM "${EDGE_KEY}" "" "${MANIFEST}"`));
  assert.equal((code(install).match(/WriteRegStr/g) || []).length, 2);
});

test("installer creates no HKCU Native Messaging keys", () => {
  assert.doesNotMatch(nsh, /HKCU|HKEY_CURRENT_USER|SHELL_CONTEXT|HKCR/);
});

test("manifest path and BAT are under $INSTDIR\\native-host\\ (Program Files), never user-writable locations", () => {
  assert.ok(manifestCmd.includes(`path = '${BAT}'`));
  assert.ok(manifestCmd.includes(`-LiteralPath '${MANIFEST}'`));
  assert.ok(install.includes(`FileOpen $2 "${BAT}" w`));
  assert.ok(install.includes('CreateDirectory "$INSTDIR\\native-host"'));
  assert.doesNotMatch(code(nsh), /LOCALAPPDATA|APPDATA|PROGRAMDATA|\$PROFILE|\$TEMP|\$TMP/i);
});

test("manifest is generated with PowerShell ConvertTo-Json (stdio, no raw JSON in NSIS)", () => {
  assert.match(manifestCmd, /type = 'stdio'/);
  assert.match(manifestCmd, /\| ConvertTo-Json/);
  assert.doesNotMatch(install, /FileWrite[^\n]*"name"/);
});

test("BAT runs the installed Agent exe on nativeHost.js inside app.asar, as Node, forwarding args", () => {
  const body = batLines.map((l) => l.match(/FileWrite \$2 '(.*)'\s*$/)[1].replace(/\$\\r\$\\n$/, ""));
  assert.deepEqual(body, [
    "@echo off",
    "set ELECTRON_RUN_AS_NODE=1",
    '"$INSTDIR\\${APP_EXECUTABLE_FILENAME}" "$INSTDIR\\resources\\app.asar\\src\\monitoring\\extension\\nativeHost.js" %*',
  ]);
});

test("BAT and manifest contain no credentials, uuid, secret, token or password", () => {
  const text = [...batLines, manifestCmd].join("\n");
  assert.doesNotMatch(text, /secret|uuid|token|password|credential|agent_/i);
});

test("uninstall removes ONLY the two exact HKLM host keys, then the native-host dir", () => {
  const c = code(uninstall);
  const dels = c.match(/DeleteRegKey[^\n]*/g) || [];
  assert.deepEqual(dels, [`DeleteRegKey HKLM "${CHROME_KEY}"`, `DeleteRegKey HKLM "${EDGE_KEY}"`]);
  assert.match(c, /RMDir \/r "\$INSTDIR\\native-host"/);
});

test("uninstall never deletes parent registry keys, other hosts, credentials or bridge files", () => {
  const c = code(uninstall);
  assert.doesNotMatch(c, /NativeMessagingHosts"/); // every key ends with the host name
  assert.doesNotMatch(c, /\/ifempty|\*/);
  assert.doesNotMatch(c, /agent-credentials|APPDATA|userData|ext-bridge|\.humancare-monitoring/i);
  assert.ok(c.includes('schtasks.exe /Delete /TN "HumanCare Connect Monitoring Agent" /F')); // task removal kept
});

const CHROME_POL = "SOFTWARE\\Policies\\Google\\Chrome";
const EDGE_POL = "SOFTWARE\\Policies\\Microsoft\\Edge";

test("NativeMessagingUserLevelHosts is written as DWORD 0 under the exact Chrome and Edge policy keys", () => {
  assert.ok(install.includes(`WriteRegDWORD HKLM "${CHROME_POL}" "NativeMessagingUserLevelHosts" 0`));
  assert.ok(install.includes(`WriteRegDWORD HKLM "${EDGE_POL}" "NativeMessagingUserLevelHosts" 0`));
  assert.equal((code(install).match(/WriteRegDWORD/g) || []).length, 2);
});

test("policy values are only written when absent (existing org values are never overwritten)", () => {
  for (const key of [CHROME_POL, EDGE_POL]) {
    assert.ok(install.includes(`ReadRegDWORD $4 HKLM "${key}" "NativeMessagingUserLevelHosts"`));
  }
  assert.equal((code(install).match(/\$\{If\} \$\{Errors\}/g) || []).length, 2);
});

test("uninstall deletes only the two policy values, only when owned and still 0", () => {
  const c = code(uninstall);
  const vals = c.match(/DeleteRegValue[^\n]*/g) || [];
  assert.deepEqual(vals, [
    `DeleteRegValue HKLM "${CHROME_POL}" "NativeMessagingUserLevelHosts"`,
    `DeleteRegValue HKLM "${EDGE_POL}" "NativeMessagingUserLevelHosts"`,
  ]);
  assert.ok(c.includes("policy-chrome.owned") && c.includes("policy-edge.owned"));
  assert.equal((c.match(/\$4 == 0/g) || []).length, 2);
  assert.doesNotMatch(c, /DeleteRegKey[^\n]*Policies/);
});

test("only the two NativeMessagingUserLevelHosts policies are touched; no other policy", () => {
  const polLines = lines.filter((l) => /Policies/.test(l) && !/^\s*;/.test(l));
  assert.ok(polLines.length > 0);
  for (const l of polLines) assert.match(l, /NativeMessagingUserLevelHosts/);
  assert.doesNotMatch(nsh, /ExtensionInstallForcelist|ExtensionSettings|NativeMessagingAllowlist/);
});

test("existing HKLM native host registration is unchanged by the policy step", () => {
  assert.ok(install.includes(`WriteRegStr HKLM "${CHROME_KEY}" "" "${MANIFEST}"`));
  assert.ok(install.includes(`WriteRegStr HKLM "${EDGE_KEY}" "" "${MANIFEST}"`));
});