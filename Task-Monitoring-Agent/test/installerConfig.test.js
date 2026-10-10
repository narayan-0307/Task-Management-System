"use strict";

// Packaging policy: the NSIS installer is per-machine (Program Files) and the
// employee cannot pick another (user-writable) installation directory.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const pkg = JSON.parse(
  fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8"),
);
const nsisScript = fs.readFileSync(
  path.join(__dirname, "..", "build", "installer.nsh"),
  "utf8",
);

test("installer: NSIS is per-machine", () => {
  assert.equal(pkg.build.win.target, "nsis");
  assert.equal(pkg.build.nsis.perMachine, true);
});

test("installer: install directory cannot be changed by the user", () => {
  assert.equal(pkg.build.nsis.allowToChangeInstallationDirectory, false);
  assert.equal(pkg.build.nsis.oneClick, false);
});

test("installer: no custom installDir / user-writable location is configured", () => {
  const serialized = JSON.stringify(pkg.build);
  assert.doesNotMatch(serialized, /LOCALAPPDATA|\$APPDATA|%APPDATA%/i);
  assert.equal(pkg.build.nsis.installDir, undefined);
});

test("installer: identity and packaging are preserved", () => {
  assert.equal(pkg.build.appId, "com.tms.monitoringagent");
  assert.equal(pkg.build.productName, "Task Monitoring Agent");
  assert.equal(pkg.name, "task-monitoring-agent");
  assert.equal(pkg.version, "1.0.0");
  assert.equal(pkg.main, "src/main.js");
  assert.ok(pkg.build.files.includes("!**/agent.config*.json"));
  assert.notEqual(pkg.build.asar, false);
});

test("installer: does not write HKCU registry keys", () => {
  assert.doesNotMatch(nsisScript, /HKCU|HKEY_CURRENT_USER|SHELL_CONTEXT/);
});

test("installer: userData (credential store) location is not overridden", () => {
  const src = fs.readFileSync(
    path.join(__dirname, "..", "src", "storage", "secureConfig.js"),
    "utf8",
  );
  assert.match(src, /app\.getPath\("userData"\)/);
  const main = fs.readFileSync(path.join(__dirname, "..", "src", "main.js"), "utf8");
  assert.doesNotMatch(main, /setPath\(\s*["']userData["']/);
});
