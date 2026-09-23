// Windows per-user Scheduled Task auto-start + bounded crash-restart
// (Step 3 reliability hardening). Replaces the previous
// app.setLoginItemSettings (Run-key) mechanism — a Run-key only fires at
// login and has no notion of "the process died unexpectedly, relaunch it";
// Task Scheduler's own restart-on-failure setting does, with a bounded retry
// count, so Windows itself recovers a crashed Agent with no custom
// watchdog/polling code anywhere in this project.
//
// Still per-user and admin-free: the task is created with RunLevel
// LeastPrivilege under the current user's own logon trigger (LogonType
// InteractiveToken — uses the already-logged-on token, never a stored
// password), the same no-admin model already used for the extension's
// native-messaging host (Task-Monitoring-Extension/native-host/install.ps1).
//
// The task's command line is ONLY "<AgentExePath> --hidden" — no agent
// secret, token, or config value is ever placed on it. The Agent loads its
// credentials itself, via the existing secure configuration mechanism
// (storage/secureConfig.js), once it starts. This module never sees those
// credentials.
//
// Bounded restart policy: Task Scheduler retries up to RESTART_COUNT times,
// RESTART_INTERVAL_MINUTES apart, after the Agent exits with a non-zero
// ("failed") code — e.g. Step 2's app.exit(1) on an uncaught exception. A
// clean app.quit()/app.exit(0) (the tray's "Exit Agent") is exit code 0 and
// is never treated as a failure, so it is never auto-relaunched. After
// RESTART_COUNT failed attempts Task Scheduler stops retrying on its own —
// there is no unbounded loop anywhere in this design.
//
// Public API (setAutoStart/isAutoStartEnabled/launchedHidden/HIDDEN_FLAG) is
// unchanged from the previous Run-key implementation, so main.js's existing
// call sites (agent:connect -> setAutoStart(true), bootstrap() on a rejected
// saved credential -> setAutoStart(false)) needed no changes — those are
// already exactly "register after successful enrollment" / "remove when
// credentials go bad".
//
// Uses only process.execPath + child_process + schtasks.exe — no Electron
// API is required for the Scheduled Task itself, so this module (aside from
// the defensive old-Run-key cleanup below) runs under plain Node and is
// unit-testable without an Electron runtime.

const { execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const logger = require("./utils/logger");

const TASK_NAME = "HumanCare Connect Monitoring Agent";
const HIDDEN_FLAG = "--hidden";

const RESTART_INTERVAL_MINUTES = 1;
const RESTART_COUNT = 3;

function launchedHidden() {
    return process.argv.includes(HIDDEN_FLAG);
}

function currentUserId() {
    const user = os.userInfo().username;
    const domain = process.env.USERDOMAIN || process.env.COMPUTERNAME || os.hostname();
    return `${domain}\\${user}`;
}

function xmlEscape(value) {
    return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&apos;");
}

// Exported for tests. Task Scheduler XML (schema 1.2) — a per-user logon
// trigger plus a bounded restart-on-failure policy, neither of which the
// plain `schtasks /Create` CLI flags can express (they are XML/COM-API-only
// settings), hence building XML instead of a flag-only command line.
function buildTaskXml(exePath) {
    const userId = xmlEscape(currentUserId());
    const command = xmlEscape(exePath);
    return `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Description>Launches the HumanCare Connect Monitoring Agent at logon and restarts it automatically after a crash (bounded retries). Registered by the Agent itself after successful enrollment.</Description>
  </RegistrationInfo>
  <Triggers>
    <LogonTrigger>
      <Enabled>true</Enabled>
      <UserId>${userId}</UserId>
    </LogonTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author">
      <UserId>${userId}</UserId>
      <LogonType>InteractiveToken</LogonType>
      <RunLevel>LeastPrivilege</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <AllowHardTerminate>true</AllowHardTerminate>
    <StartWhenAvailable>true</StartWhenAvailable>
    <RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>
    <Enabled>true</Enabled>
    <Hidden>false</Hidden>
    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>
    <RestartOnFailure>
      <Interval>PT${RESTART_INTERVAL_MINUTES}M</Interval>
      <Count>${RESTART_COUNT}</Count>
    </RestartOnFailure>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>${command}</Command>
      <Arguments>${HIDDEN_FLAG}</Arguments>
    </Exec>
  </Actions>
</Task>`;
}

// Indirection point for tests only (see test/autostart.test.js) — production
// code always uses the real schtasks.exe. Never used to change production
// behavior.
let runSchtasks = (args) => execFileSync("schtasks.exe", args, { windowsHide: true, stdio: "pipe" });

// One-time defensive cleanup of the OLD Run-key mechanism this replaces, so
// the two auto-start paths never coexist (decision: replace, not add). Safe
// to call unconditionally and repeatedly: a no-op if the key was never set,
// and a no-op (not a throw) outside a real Electron runtime, since `app` is
// then undefined and never invoked. Requires an Electron runtime to actually
// observe the Run-key being cleared, so this specific effect is not covered
// by the plain-Node unit tests in test/autostart.test.js.
function clearLegacyRunKeyAutoStart() {
    try {
        // eslint-disable-next-line global-require
        const { app } = require("electron");
        if (app && typeof app.setLoginItemSettings === "function") {
            app.setLoginItemSettings({ openAtLogin: false });
        }
    } catch {
        /* not running under Electron, or the call failed — nothing more to do */
    }
}

function setAutoStart(enabled) {
    if (process.platform !== "win32") return false;

    clearLegacyRunKeyAutoStart();

    if (!enabled) {
        try {
            runSchtasks(["/Delete", "/TN", TASK_NAME, "/F"]);
            logger.info("Windows Scheduled Task removed.");
        } catch {
            // Already absent (or schtasks unavailable) — either way there is
            // nothing left to auto-start; not a fatal condition.
            logger.info("Windows Scheduled Task was not present (nothing to remove).");
        }
        return true;
    }

    // The ACTUAL running executable — in a packaged build this is the
    // installed .exe; in development it is electron.exe (documented
    // limitation, same as the previous Run-key implementation). Never
    // hardcoded, so a reinstall/update to a new install directory or
    // executable name is picked up automatically the next time this runs.
    const exePath = process.execPath;
    const xml = buildTaskXml(exePath);
    const tmpPath = path.join(os.tmpdir(), `hcc-monitoring-task-${process.pid}-${Date.now()}.xml`);
    try {
        fs.writeFileSync(tmpPath, "﻿" + xml, "utf16le");
        runSchtasks(["/Create", "/TN", TASK_NAME, "/XML", tmpPath, "/F"]);
        logger.info("Windows Scheduled Task registered (logon trigger + bounded crash-restart).");
        return true;
    } catch {
        logger.warn("Unable to register Windows Scheduled Task for auto-start.");
        return false;
    } finally {
        try {
            fs.unlinkSync(tmpPath);
        } catch {
            /* best effort */
        }
    }
}

function isAutoStartEnabled() {
    if (process.platform !== "win32") return false;
    try {
        runSchtasks(["/Query", "/TN", TASK_NAME]);
        return true;
    } catch {
        return false;
    }
}

module.exports = {
    setAutoStart,
    isAutoStartEnabled,
    launchedHidden,
    HIDDEN_FLAG,
    TASK_NAME,
    // Exported for tests only.
    __test: {
        buildTaskXml,
        currentUserId,
        RESTART_COUNT,
        RESTART_INTERVAL_MINUTES,
        setRunSchtasks: (fn) => {
            runSchtasks = fn;
        },
        resetRunSchtasks: () => {
            runSchtasks = (args) => execFileSync("schtasks.exe", args, { windowsHide: true, stdio: "pipe" });
        },
    },
};
