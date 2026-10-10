"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const autostart = require("../src/autostart");
const { setAutoStart, isAutoStartEnabled, launchedHidden, HIDDEN_FLAG, TASK_NAME } = autostart;
const { setRunSchtasks, resetRunSchtasks } = autostart.__test;

const nsh = fs.readFileSync(path.join(__dirname, "..", "build", "installer.nsh"), "utf8");
const mainSrc = fs.readFileSync(path.join(__dirname, "..", "src", "main.js"), "utf8");

function withMockSchtasks(impl, fn) {
  setRunSchtasks(impl);
  try {
    return fn();
  } finally {
    resetRunSchtasks();
  }
}

// ------------------------------------------------------- runtime (unchanged)

test("launchedHidden() reflects the --hidden argv flag", () => {
  assert.equal(HIDDEN_FLAG, "--hidden");
  const original = process.argv;
  try {
    process.argv = [...original.filter((a) => a !== HIDDEN_FLAG)];
    assert.equal(launchedHidden(), false);
    process.argv = [...process.argv, HIDDEN_FLAG];
    assert.equal(launchedHidden(), true);
  } finally {
    process.argv = original;
  }
});

test("TASK_NAME is a stable, human-identifiable name (not random)", () => {
  assert.equal(TASK_NAME, "HumanCare Connect Monitoring Agent");
});

test("isAutoStartEnabled() reflects whether schtasks /Query succeeds", () => {
  const whenPresent = withMockSchtasks(() => "Status: Ready", () => isAutoStartEnabled());
  const whenAbsent = withMockSchtasks(
    () => {
      throw new Error("ERROR: The system cannot find the file specified.");
    },
    () => isAutoStartEnabled(),
  );
  assert.equal(whenPresent, process.platform === "win32");
  assert.equal(whenAbsent, false);
});

// ------------------------------------------- runtime no longer owns the task

test("setAutoStart(true/false) never creates, changes or deletes the task (only /Query)", () => {
  for (const enabled of [true, false]) {
    const calls = [];
    withMockSchtasks(
      (args) => {
        calls.push(args[0]);
        return "";
      },
      () => setAutoStart(enabled),
    );
    assert.ok(!calls.includes("/Create"), "must not /Create");
    assert.ok(!calls.includes("/Delete"), "must not /Delete");
    assert.ok(!calls.includes("/Change"), "must not /Change");
  }
});

test("setAutoStart does not throw when the task is absent or schtasks fails", () => {
  assert.doesNotThrow(() =>
    withMockSchtasks(
      () => {
        throw new Error("Access is denied.");
      },
      () => setAutoStart(true),
    ),
  );
});

test("enrollment (agent:connect) still calls setAutoStart(true) and does not require task creation to succeed", () => {
  assert.match(mainSrc, /saveSecureConfig\(\{ apiBaseUrl, agentUuid, agentSecret \}\);[\s\S]*?setAutoStart\(true\);/);
  assert.doesNotMatch(mainSrc, /if\s*\(\s*!?\s*setAutoStart/);
});

test("autostart.js no longer contains task-creation code", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "src", "autostart.js"), "utf8");
  assert.doesNotMatch(src, /"\/Create"|"\/Delete"|buildTaskXml/);
});

// ---------------------------------------------------- installer-time task

test("installer.nsh registers the machine-wide task at install time (customInstall)", () => {
  assert.match(nsh, /!macro customInstall/);
  assert.match(nsh, /Register-ScheduledTask -TaskName 'HumanCare Connect Monitoring Agent'/);
  assert.ok(nsh.includes(TASK_NAME));
});

test("task principal is the Users group, not an employee account", () => {
  assert.match(nsh, /<GroupId>S-1-5-32-545<\/GroupId>/);
  assert.doesNotMatch(nsh, /<UserId>/);
  assert.doesNotMatch(nsh, /USERNAME|USERDOMAIN|USERPROFILE/i);
});

test("task runs in the interactive session at logon, least privilege, no stored password", () => {
  assert.match(nsh, /<LogonTrigger><Enabled>true<\/Enabled><\/LogonTrigger>/);
  assert.match(nsh, /<RunLevel>LeastPrivilege<\/RunLevel>/);
  assert.doesNotMatch(nsh, /<Password>|<LogonType>Password|S4U|ServiceAccount|SYSTEM/i);
  assert.doesNotMatch(nsh, /\/RU|\/RP/);
});

test("task launches the installed exe with only --hidden and has bounded restart", () => {
  assert.match(nsh, /<Command>\$INSTDIR\\\$\{APP_EXECUTABLE_FILENAME\}<\/Command><Arguments>--hidden<\/Arguments>/);
  assert.match(nsh, /<RestartOnFailure><Interval>PT1M<\/Interval><Count>3<\/Count><\/RestartOnFailure>/);
  assert.equal((nsh.match(/<Exec>/g) || []).length, 1);
  const actionsLine = nsh.split("\n").find((l) => l.includes("<Actions"));
  assert.doesNotMatch(actionsLine, /secret|uuid|password|token/i);
});

test("task is not a Windows Service", () => {
  assert.doesNotMatch(nsh, /sc\.exe|nssm|CreateService|SERVICE_/i);
});

test("uninstall removes the machine-wide task (by exact name only)", () => {
  assert.match(nsh, /!macro customUnInstall/);
  assert.match(nsh, /schtasks\.exe \/Delete \/TN "HumanCare Connect Monitoring Agent" \/F/);
  assert.doesNotMatch(nsh, /\/TN\s+"\*"|\\\*/);
});

test("installer does not touch credentials/userData", () => {
  assert.doesNotMatch(nsh, /agent-credentials|RMDir[^\n]*APPDATA/i);
});

// ------------------------------------------- NSIS XML generation / hooks

function generatedTaskXml() {
  const lines = nsh.split(/\r?\n/).filter((l) => /^\s*FileWrite \$0 '/.test(l));
  return lines
    .map((l) => l.match(/FileWrite \$0 '(.*)'\s*$/)[1].replace(/\$\\r\$\\n$/, ""))
    .join("\n")
    .replace("$INSTDIR\\${APP_EXECUTABLE_FILENAME}", "C:\\Program Files\\Task Monitoring Agent\\Task Monitoring Agent.exe");
}

test("generated task XML is ASCII, well-formed, and has no encoding declaration that could mismatch the ANSI file NSIS writes", () => {
  const xml = generatedTaskXml();
  assert.match(xml, /^<Task version="1\.2"/);
  assert.doesNotMatch(xml, /<\?xml/); // FileWrite is ANSI; UTF-8 is rejected and UTF-16 would be a lie
  assert.ok(/^[\x00-\x7f]*$/.test(xml), "XML must be pure ASCII");
  assert.doesNotMatch(xml, /\$/, "no unexpanded NSIS variables may remain except the substituted ones");
  const stack = [];
  for (const m of xml.matchAll(/<(\/?)([A-Za-z]+)([^>]*?)(\/?)>/g)) {
    if (m[4]) continue;
    if (m[1]) assert.equal(stack.pop(), m[2], `unbalanced </${m[2]}>`);
    else stack.push(m[2]);
  }
  assert.equal(stack.length, 0);
});

test("generated task XML: Users group principal, no LogonType/UserId, logon trigger, single exec", () => {
  const xml = generatedTaskXml();
  assert.match(xml, /<GroupId>S-1-5-32-545<\/GroupId>/);
  assert.doesNotMatch(xml, /<UserId>|<LogonType>/);
  assert.equal((xml.match(/<LogonTrigger>/g) || []).length, 1);
  assert.equal((xml.match(/<Exec>/g) || []).length, 1);
  assert.match(xml, /<Command>C:\\Program Files\\Task Monitoring Agent\\Task Monitoring Agent\.exe<\/Command>/);
});

test("installer.nsh uses valid electron-builder hooks and the registration is written to a plugins-dir temp file and removed", () => {
  assert.match(nsh, /!macro customInstall[\s\S]*!macroend/);
  assert.match(nsh, /!macro customUnInstall[\s\S]*!macroend/);
  assert.match(nsh, /InitPluginsDir/);
  assert.match(nsh, /\$PLUGINSDIR\\hcc-agent-task\.xml/);
  assert.match(nsh, /Delete "\$PLUGINSDIR\\hcc-agent-task\.xml"/);
});

test("APP_EXECUTABLE_FILENAME is the electron-builder NSIS define (productName + .exe)", () => {
  const common = path.join(__dirname, "..", "node_modules", "app-builder-lib", "templates", "nsis", "common.nsh");
  if (!fs.existsSync(common)) return; // electron-builder not installed
  assert.match(fs.readFileSync(common, "utf8"), /!define APP_EXECUTABLE_FILENAME "\$\{PRODUCT_FILENAME\}\.exe"/);
});
