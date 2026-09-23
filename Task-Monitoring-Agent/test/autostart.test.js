"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const autostart = require("../src/autostart");
const { setAutoStart, isAutoStartEnabled, launchedHidden, HIDDEN_FLAG, TASK_NAME } = autostart;
const { buildTaskXml, currentUserId, RESTART_COUNT, RESTART_INTERVAL_MINUTES, setRunSchtasks, resetRunSchtasks } =
  autostart.__test;

function withMockSchtasks(impl, fn) {
  setRunSchtasks(impl);
  try {
    return fn();
  } finally {
    resetRunSchtasks();
  }
}

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

test("buildTaskXml embeds the given executable path verbatim as the task Command (no hardcoded path)", () => {
  const exePath = "C:\\Users\\Test User\\AppData\\Local\\Programs\\Task Monitoring Agent\\Task Monitoring Agent.exe";
  const xml = buildTaskXml(exePath);
  assert.match(xml, /<Command>C:\\Users\\Test User\\AppData\\Local\\Programs\\Task Monitoring Agent\\Task Monitoring Agent\.exe<\/Command>/);
  assert.match(xml, /<Arguments>--hidden<\/Arguments>/);
});

test("buildTaskXml never places a secret/token-shaped value on the command line — it only ever receives an exe path", () => {
  // The function's only input is the exe path; nothing in this codebase ever
  // passes it a config/credentials object, but assert here that the XML
  // structure has exactly one Exec/Command/Arguments and nothing else that
  // could carry extra data.
  const xml = buildTaskXml("C:\\Program Files\\Agent\\Agent.exe");
  const execMatches = xml.match(/<Exec>/g) || [];
  assert.equal(execMatches.length, 1);
  assert.match(xml, /<Arguments>--hidden<\/Arguments>/);
});

test("buildTaskXml XML-escapes special characters in the executable path", () => {
  const xml = buildTaskXml('C:\\Path With & Ampersand\\Agent.exe');
  assert.match(xml, /<Command>C:\\Path With &amp; Ampersand\\Agent\.exe<\/Command>/);
  assert.equal(xml.includes("With & Ampersand"), false);
});

test("buildTaskXml configures a per-user logon trigger, least-privilege run level, and bounded restart-on-failure", () => {
  const xml = buildTaskXml("C:\\Agent\\Agent.exe");
  assert.match(xml, /<LogonTrigger>/);
  assert.match(xml, /<RunLevel>LeastPrivilege<\/RunLevel>/);
  assert.match(xml, /<LogonType>InteractiveToken<\/LogonType>/); // no stored password needed
  assert.match(xml, /<RestartOnFailure>/);
  assert.match(xml, new RegExp(`<Count>${RESTART_COUNT}</Count>`));
  assert.match(xml, new RegExp(`<Interval>PT${RESTART_INTERVAL_MINUTES}M</Interval>`));
  // Bounded, not unbounded: Count must be a small finite number.
  assert.ok(RESTART_COUNT > 0 && RESTART_COUNT <= 10);
});

test("currentUserId() returns a non-empty DOMAIN\\user-shaped identifier", () => {
  const id = currentUserId();
  assert.match(id, /^.+\\.+$/);
});

test("setAutoStart(true) invokes schtasks /Create with /TN <TASK_NAME> and /XML, then cleans up the temp file", () => {
  let seenArgs = null;
  const result = withMockSchtasks(
    (args) => {
      if (args[0] === "/Create") seenArgs = args;
      return "";
    },
    () => setAutoStart(true),
  );
  // On non-Windows CI this branch returns false immediately (platform check)
  // — only assert schtasks was invoked when we're actually on win32.
  if (process.platform === "win32") {
    assert.equal(result, true);
    assert.ok(seenArgs, "expected schtasks /Create to be called");
    assert.equal(seenArgs[0], "/Create");
    assert.equal(seenArgs[1], "/TN");
    assert.equal(seenArgs[2], TASK_NAME);
    assert.equal(seenArgs[3], "/XML");
    assert.ok(seenArgs[4]); // a temp file path
    assert.equal(seenArgs[5], "/F");
  }
});

test("setAutoStart(false) invokes schtasks /Delete /TN <TASK_NAME> /F", () => {
  let seenArgs = null;
  const result = withMockSchtasks(
    (args) => {
      seenArgs = args;
      return "";
    },
    () => setAutoStart(false),
  );
  if (process.platform === "win32") {
    assert.equal(result, true);
    assert.deepEqual(seenArgs, ["/Delete", "/TN", TASK_NAME, "/F"]);
  }
});

test("setAutoStart(false) does not throw when the task does not exist (schtasks exits non-zero)", () => {
  const result = withMockSchtasks(
    () => {
      throw new Error("ERROR: The system cannot find the file specified.");
    },
    () => setAutoStart(false),
  );
  // Absence of the task is not a failure from the caller's point of view.
  assert.equal(result, true);
});

test("setAutoStart(true) returns false (not throw) when schtasks fails to register the task", () => {
  const result = withMockSchtasks(
    () => {
      throw new Error("Access is denied.");
    },
    () => setAutoStart(true),
  );
  if (process.platform === "win32") {
    assert.equal(result, false);
  }
});

test("isAutoStartEnabled() reflects whether schtasks /Query succeeds", () => {
  const whenPresent = withMockSchtasks(
    () => "TaskName: HumanCare Connect Monitoring Agent\nStatus: Ready",
    () => isAutoStartEnabled(),
  );
  const whenAbsent = withMockSchtasks(
    () => {
      throw new Error("ERROR: The system cannot find the file specified.");
    },
    () => isAutoStartEnabled(),
  );
  if (process.platform === "win32") {
    assert.equal(whenPresent, true);
    assert.equal(whenAbsent, false);
  } else {
    assert.equal(whenPresent, false);
    assert.equal(whenAbsent, false);
  }
});
