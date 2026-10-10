// Windows auto-start — STATUS ONLY at runtime.
//
// The "HumanCare Connect Monitoring Agent" Scheduled Task is machine-wide and
// is created (and removed) by the administrator-run NSIS installer — see
// build/installer.nsh. It is owned by the installer's elevated account, not by
// the employee, so a standard user cannot modify or delete it. Its principal is
// the built-in Users group with an interactive-token logon trigger, so the
// Agent still starts inside each employee's own interactive desktop session
// (tray / UI / Live Screen need that) — it is deliberately NOT a Windows
// Service. No password or credential is stored in the task, and its command
// line is only "<AgentExe> --hidden"; the Agent loads its per-user DPAPI
// credentials itself (storage/secureConfig.js).
//
// Because a non-admin Agent cannot (and must not) create/replace/delete that
// task, setAutoStart() no longer touches it. It is kept so main.js call sites
// (enrollment -> setAutoStart(true), rejected credentials -> setAutoStart(false))
// are unchanged. Restart-on-failure policy lives in the installer's task XML.
//
// Plain Node + schtasks.exe /Query only; unit-testable without Electron.

const { execFileSync } = require("child_process");
const logger = require("./utils/logger");

const TASK_NAME = "HumanCare Connect Monitoring Agent";
const HIDDEN_FLAG = "--hidden";

function launchedHidden() {
    return process.argv.includes(HIDDEN_FLAG);
}

// Indirection point for tests only (see test/autostart.test.js).
let runSchtasks = (args) => execFileSync("schtasks.exe", args, { windowsHide: true, stdio: "pipe" });

// One-time defensive cleanup of the OLD per-user Run-key mechanism so it never
// coexists with the machine-wide task. No-op outside a real Electron runtime.
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

function isAutoStartEnabled() {
    if (process.platform !== "win32") return false;
    try {
        runSchtasks(["/Query", "/TN", TASK_NAME]);
        return true;
    } catch {
        return false;
    }
}

// No-op for the task itself: it is installer-managed. Returns whether the
// installer-created task is currently present.
function setAutoStart(enabled) {
    if (process.platform !== "win32") return false;
    clearLegacyRunKeyAutoStart();
    const present = isAutoStartEnabled();
    logger.info(
        `Auto-start is installer-managed (machine-wide Scheduled Task); runtime ${enabled ? "enable" : "disable"} request ignored. Task present: ${present}.`,
    );
    return present;
}

module.exports = {
    setAutoStart,
    isAutoStartEnabled,
    launchedHidden,
    HIDDEN_FLAG,
    TASK_NAME,
    // Exported for tests only.
    __test: {
        setRunSchtasks: (fn) => {
            runSchtasks = fn;
        },
        resetRunSchtasks: () => {
            runSchtasks = (args) => execFileSync("schtasks.exe", args, { windowsHide: true, stdio: "pipe" });
        },
    },
};
