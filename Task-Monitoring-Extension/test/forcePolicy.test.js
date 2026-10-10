"use strict";

// Tests for policy/force-install-policy.ps1. Windows-only.
//
// SAFETY: every write-capable run passes -TestOnly plus a -RegistryRoot under
// the script's dedicated test sandbox (HKCU:\Software\HumanCareMonitoring\
// ForceInstallPolicyTest\<random>). The script rejects -RegistryRoot without
// -TestOnly, and rejects -TestOnly with anything outside that sandbox (see the
// "-RegistryRoot / -TestOnly" tests below) -- so this suite can never reach,
// read-write, the real HKLM:\SOFTWARE\Policies production root, or any other
// real policy location such as HKCU:\SOFTWARE\Policies.
//
// The suite's one default-root Status call (no flags at all) does read the
// real production path (HKLM:\SOFTWARE\Policies\...). That's safe: Status is
// read-only (Test-Path/Get-Item only, no writes) and requires no elevation.
// No test in this file ever invokes Apply or Remove against that default
// production root -- see the "elevation" and "32-bit process" sections below
// for why, and why those are static source checks instead.

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const isWin = process.platform === "win32";
const WIN_ONLY = !isWin && "Windows-only deployment tooling";

const SCRIPT = path.join(__dirname, "..", "policy", "force-install-policy.ps1");
const SRC = fs.readFileSync(SCRIPT, "utf8");

const ID = "acfadakklgdcfmogimojahhgihenaiii";
const URL = "https://darkred-marten-457458.hostingersite.com/monitoring-extension/update.xml";
const ENTRY = `${ID};${URL}`;
const CHROME = "Google\\Chrome\\ExtensionInstallForcelist";
const EDGE = "Microsoft\\Edge\\ExtensionInstallForcelist";

const PRODUCTION_ROOT = "HKLM:\\SOFTWARE\\Policies";
const SANDBOX_ROOT_PS = "HKCU:\\Software\\HumanCareMonitoring\\ForceInstallPolicyTest";
const SANDBOX_ROOT_REG = "HKCU\\Software\\HumanCareMonitoring\\ForceInstallPolicyTest";

const RUN_ID = crypto.randomBytes(6).toString("hex");
const ROOT_PS = `${SANDBOX_ROOT_PS}\\${RUN_ID}`;
const ROOT_REG = `${SANDBOX_ROOT_REG}\\${RUN_ID}`;

function ps(args) {
  return spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", SCRIPT, ...args], {
    encoding: "utf8",
  });
}
// Every behavioural test runs through the dedicated sandbox via -TestOnly.
function run(action, extra = []) {
  return ps(["-Action", action, "-RegistryRoot", ROOT_PS, "-TestOnly", ...extra]);
}
function regAdd(sub, name, data) {
  spawnSync("reg.exe", ["add", `${ROOT_REG}\\${sub}`, "/v", name, "/t", "REG_SZ", "/d", data, "/f"]);
}
function values(sub) {
  const r = spawnSync("reg.exe", ["query", `${ROOT_REG}\\${sub}`], { encoding: "utf8" });
  if (r.status !== 0) return null;
  const out = {};
  for (const m of r.stdout.matchAll(/^\s+(\S+)\s+REG_SZ\s+(.*?)\r?$/gm)) out[m[1]] = m[2];
  return out;
}
function rawQuery(sub) {
  return spawnSync("reg.exe", ["query", `${ROOT_REG}\\${sub}`], { encoding: "utf8" }).stdout;
}
function keyExists(sub) {
  return spawnSync("reg.exe", ["query", `${ROOT_REG}\\${sub}`]).status === 0;
}
function reset() {
  spawnSync("reg.exe", ["delete", ROOT_REG, "/f"]);
}
test.beforeEach(reset);
test.after(() => {
  reset();
  // Also drop the whole dedicated sandbox tree (not just this run's random
  // subkey) so repeated local runs don't accumulate empty leftovers. This is
  // the sandbox the script itself restricts -TestOnly to -- never a real
  // policy location.
  spawnSync("reg.exe", ["delete", SANDBOX_ROOT_REG, "/f"]);
});

// --- static checks -----------------------------------------------------------

test("script has the exact extension ID, update URL and entry", () => {
  assert.ok(SRC.includes(`$ExtensionId = "${ID}"`));
  assert.ok(SRC.includes(`$UpdateUrl   = "${URL}"`));
  assert.ok(SRC.includes('$Entry       = "$ExtensionId;$UpdateUrl"'));
});

test("policy ID matches the ID derived from manifest.json key", () => {
  const key = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "manifest.json"), "utf8")).key;
  const derived = crypto.createHash("sha256").update(Buffer.from(key, "base64")).digest("hex")
    .slice(0, 32).replace(/[0-9a-f]/g, (c) => String.fromCharCode(97 + parseInt(c, 16)));
  assert.equal(derived, ID);
});

test("production root is HKLM:\\SOFTWARE\\Policies and Chrome/Edge forcelist paths are correct", () => {
  assert.ok(SRC.includes(`$ProductionRoot  = "${PRODUCTION_ROOT}"`));
  assert.ok(SRC.includes(`Key = "${CHROME}"`));
  assert.ok(SRC.includes(`Key = "${EDGE}"`));
});

test("test sandbox root is distinct from both HKCU:\\SOFTWARE\\Policies and the production root", () => {
  assert.ok(SRC.includes(`$TestSandboxRoot = "${SANDBOX_ROOT_PS}"`));
  assert.notEqual(SANDBOX_ROOT_PS.toLowerCase(), "hkcu:\\software\\policies");
  assert.notEqual(SANDBOX_ROOT_PS.toLowerCase(), PRODUCTION_ROOT.toLowerCase());
});

test("script never deletes a registry key or force-overwrites a value", () => {
  const code = SRC.replace(/<#[\s\S]*?#>/, "");
  assert.ok(!/Remove-Item\b/.test(code), "never deletes keys");
  assert.ok(!/-Force\b/.test(code.replace(/New-Item -Path \$p\.Path -Force/, "")), "no force-overwrite of values");
});

// --- -RegistryRoot / -TestOnly validation ------------------------------------

test("-RegistryRoot without -TestOnly is rejected", { skip: WIN_ONLY }, () => {
  const r = ps(["-Action", "Status", "-RegistryRoot", ROOT_PS]);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /-TestOnly/);
});

test("-TestOnly with HKCU:\\SOFTWARE\\Policies (a real browser policy location) is rejected", { skip: WIN_ONLY }, () => {
  const r = ps(["-Action", "Status", "-RegistryRoot", "HKCU:\\SOFTWARE\\Policies", "-TestOnly"]);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /sandbox/i);
});

test("-TestOnly with an arbitrary HKCU path outside the sandbox is rejected", { skip: WIN_ONLY }, () => {
  const r = ps(["-Action", "Status", "-RegistryRoot", "HKCU:\\Software\\SomeOtherApp", "-TestOnly"]);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /sandbox/i);
});

test("-TestOnly with the dedicated test sandbox (or a subkey of it) works", { skip: WIN_ONLY }, () => {
  assert.equal(ps(["-Action", "Status", "-RegistryRoot", ROOT_PS, "-TestOnly"]).status, 0);
  assert.equal(ps(["-Action", "Status", "-RegistryRoot", SANDBOX_ROOT_PS, "-TestOnly"]).status, 0);
});

test("production default root remains HKLM:\\SOFTWARE\\Policies (Status, no flags)", { skip: WIN_ONLY }, () => {
  // Status is read-only (no writes, no elevation needed), so this is safe to
  // run against the real default root. No Apply/Remove call in this suite
  // ever uses the default root.
  const r = ps(["-Action", "Status"]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /HKLM:\\SOFTWARE\\Policies\\Google\\Chrome\\ExtensionInstallForcelist/);
  assert.match(r.stdout, /HKLM:\\SOFTWARE\\Policies\\Microsoft\\Edge\\ExtensionInstallForcelist/);
});

// --- elevation & 64-bit process guard (static only -- see file header) ------
//
// These are intentionally static source checks, not live invocations. Testing
// them live would require running `-Action Apply`/`-Action Remove` with no
// -TestOnly, which always targets the real production root
// (HKLM:\SOFTWARE\Policies). We cannot safely guarantee this test runner is
// non-elevated, and a false guarantee would mean the test suite itself writes
// to (or deletes from) the real Chrome/Edge policy -- exactly what this
// deployment artifact must never do outside a deliberate, supervised run. So
// elevation and 64-bit enforcement are verified by inspecting that the checks
// are unconditional for production (not gated by a specific registry path
// pattern) and are skipped only under -TestOnly.

test("production Apply requires elevation (static: check is unconditional for non-TestOnly)", () => {
  const code = SRC.replace(/<#[\s\S]*?#>/, "");
  assert.match(
    code,
    /if \(-not \$TestOnly -and \$Action -ne "Status"\)\s*\{[\s\S]*?WindowsBuiltInRole\]::Administrator/,
    "elevation check must run whenever -TestOnly is absent and Action isn't Status (covers Apply)"
  );
});

test("production Remove requires elevation (static: check is unconditional for non-TestOnly)", () => {
  const code = SRC.replace(/<#[\s\S]*?#>/, "");
  // Same guard as Apply: it is keyed on Action != "Status", not on Action ==
  // "Apply", so it also covers Remove. Confirm Remove has no separate,
  // unguarded code path before this check runs.
  const guardIndex = code.search(/if \(-not \$TestOnly -and \$Action -ne "Status"\)/);
  const removeIndex = code.search(/# Remove: only values whose data is exactly our entry/);
  assert.ok(guardIndex > -1 && removeIndex > -1 && guardIndex < removeIndex, "elevation guard precedes the Remove logic");
});

test("32-bit process guard exists for production Apply/Remove (static only)", () => {
  // Not exercised live, for the same reason as the elevation tests above, plus
  // a second one: reaching this guard at all (rather than failing earlier at
  // the elevation check) means the test runner would need to already be
  // elevated. Spawning a genuine 32-bit PowerShell process and confirming it
  // is actually blocked on a 64-bit OS isn't something we can do safely or
  // reliably from this suite without risking a real, elevated Apply/Remove
  // against HKLM:\SOFTWARE\Policies if any assumption here were wrong. So this
  // is documented, not faked: we only assert the guard is present and placed
  // alongside the elevation check (same production-only, non-TestOnly branch).
  const code = SRC.replace(/<#[\s\S]*?#>/, "");
  assert.match(code, /Is64BitOperatingSystem/);
  assert.match(code, /Is64BitProcess/);
});

// --- Apply / Remove behaviour (sandboxed via -TestOnly) ----------------------

test("apply on empty registry writes value 1 in both browsers", { skip: WIN_ONLY }, () => {
  const r = run("Apply");
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(values(CHROME), { 1: ENTRY });
  assert.deepEqual(values(EDGE), { 1: ENTRY });
});

test("apply preserves existing entries and picks a free number", { skip: WIN_ONLY }, () => {
  regAdd(CHROME, "1", "other;https://example.com/u.xml");
  regAdd(EDGE, "1", "x;https://example.com/e.xml");
  regAdd(EDGE, "2", "y;https://example.com/f.xml");
  assert.equal(run("Apply").status, 0);
  assert.deepEqual(values(CHROME), { 1: "other;https://example.com/u.xml", 2: ENTRY });
  assert.deepEqual(values(EDGE), {
    1: "x;https://example.com/e.xml",
    2: "y;https://example.com/f.xml",
    3: ENTRY,
  });
});

test("apply fills a true gap: existing values 1 and 3 -> chooses 2", { skip: WIN_ONLY }, () => {
  regAdd(CHROME, "1", "other-a;https://example.com/a.xml");
  regAdd(CHROME, "3", "other-c;https://example.com/c.xml");
  assert.equal(run("Apply").status, 0);
  assert.deepEqual(values(CHROME), {
    1: "other-a;https://example.com/a.xml",
    2: ENTRY,
    3: "other-c;https://example.com/c.xml",
  });
});

test("apply is idempotent", { skip: WIN_ONLY }, () => {
  run("Apply");
  assert.equal(run("Apply").status, 0);
  assert.deepEqual(values(CHROME), { 1: ENTRY });
});

test("conflicting entry for our ID aborts with no changes", { skip: WIN_ONLY }, () => {
  const bad = `${ID};https://other.example/update.xml`;
  regAdd(EDGE, "1", bad);
  const r = run("Apply");
  assert.notEqual(r.status, 0);
  assert.deepEqual(values(EDGE), { 1: bad });
  assert.equal(keyExists(CHROME), false);
});

test("Apply -WhatIf writes nothing", { skip: WIN_ONLY }, () => {
  assert.equal(run("Apply", ["-WhatIf"]).status, 0);
  assert.equal(keyExists(CHROME), false);
  assert.equal(keyExists(EDGE), false);
});

test("Remove -WhatIf makes no changes to an existing entry", { skip: WIN_ONLY }, () => {
  run("Apply");
  assert.deepEqual(values(CHROME), { 1: ENTRY });
  assert.equal(run("Remove", ["-WhatIf"]).status, 0);
  assert.deepEqual(values(CHROME), { 1: ENTRY });
  assert.deepEqual(values(EDGE), { 1: ENTRY });
});

test("remove deletes only our entry; keeps other entries, other policies and the keys", { skip: WIN_ONLY }, () => {
  regAdd(CHROME, "1", "other;https://example.com/u.xml");
  run("Apply");
  regAdd("Google\\Chrome", "SomeOtherPolicy", "keep");
  assert.equal(run("Remove").status, 0);
  assert.deepEqual(values(CHROME), { 1: "other;https://example.com/u.xml" });
  assert.equal(values("Google\\Chrome").SomeOtherPolicy, "keep");
  assert.ok(keyExists(EDGE), "Edge forcelist key kept even though empty");
  assert.deepEqual(values(EDGE), {});
});

test("remove never touches an unrelated value, even one named 1", { skip: WIN_ONLY }, () => {
  regAdd(CHROME, "1", "other;https://example.com/u.xml");
  assert.equal(run("Remove").status, 0);
  assert.deepEqual(values(CHROME), { 1: "other;https://example.com/u.xml" });
});

test("written value's registry type is REG_SZ", { skip: WIN_ONLY }, () => {
  assert.equal(run("Apply").status, 0);
  const out = rawQuery(CHROME);
  assert.match(out, /^\s+1\s+REG_SZ\s+/m, `expected a REG_SZ value named 1, got:\n${out}`);
});

test("default-root Status run is read-only and does not touch HKCU", { skip: WIN_ONLY }, () => {
  const q = () => spawnSync("reg.exe", ["query", "HKCU\\Software\\Policies", "/s"], { encoding: "utf8" });
  const before = q();
  const r = ps([]);
  assert.equal(r.status, 0, r.stderr);
  const after = q();
  assert.equal(after.status, before.status);
  assert.equal(after.stdout, before.stdout);
});
