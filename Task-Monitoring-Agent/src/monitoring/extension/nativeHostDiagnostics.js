// Minimal, local-only failure diagnostics for nativeHost.js (Step 4A).
//
// Chrome Native Messaging reserves stdout for the length-prefixed protocol
// (see nativeMessaging.js) — nothing human-readable may ever be written
// there, and this module never touches stdout. It writes ONLY to a small,
// bounded, local log file, so a native-host failure on an unattended
// employee laptop leaves a trace without anyone watching Chrome DevTools.
//
// NEVER pass this module: the bridge/pipe token, ext-bridge.json's contents,
// agent secrets, captured search/prompt text, URLs, or any native-messaging
// payload body. Only a fixed short category string and an optional short,
// pre-sanitized detail string (e.g. an error's .name, or a safe .code like
// "ENOENT"). Callers in nativeHost.js are responsible for never passing
// anything else.

const fs = require("fs");
const os = require("os");
const path = require("path");

const LOG_DIR = path.join(os.homedir(), ".humancare-monitoring");
const LOG_FILE = path.join(LOG_DIR, "native-host.log");

// Bounded, simple strategy: once the file reaches this size, drop it and
// start fresh rather than growing without limit or building rotation logic.
const MAX_LOG_BYTES = 200 * 1024; // 200 KB
const MAX_DETAIL_LEN = 200;

function stamp() {
    return new Date().toISOString();
}

function safeDetail(detail) {
    if (detail === undefined || detail === null) return "";
    const s = String(detail);
    return s.length > MAX_DETAIL_LEN ? s.slice(0, MAX_DETAIL_LEN) + "…" : s;
}

/**
 * Append one diagnostic line: "[timestamp] category - detail".
 * Never throws — a diagnostics failure must never crash or block the native
 * host, which has one job (pump bytes) that always takes priority.
 *
 * @param {string} category short fixed label, e.g. "pipe_connection_error"
 * @param {string} [detail] optional short, pre-sanitized string — never a
 *   token, secret, or payload (see module header)
 */
function logFailure(category, detail) {
    try {
        fs.mkdirSync(LOG_DIR, { recursive: true });

        let size = 0;
        try {
            size = fs.statSync(LOG_FILE).size;
        } catch {
            size = 0;
        }
        if (size >= MAX_LOG_BYTES) {
            try {
                fs.writeFileSync(LOG_FILE, "");
            } catch {
                /* best effort — fall through and try to append anyway */
            }
        }

        const line = `[${stamp()}] ${category}${detail ? " - " + safeDetail(detail) : ""}\n`;
        fs.appendFileSync(LOG_FILE, line);
    } catch {
        /* diagnostics are best-effort only */
    }
}

module.exports = { logFailure, LOG_FILE, LOG_DIR, MAX_LOG_BYTES, MAX_DETAIL_LEN };
