// Chrome native-messaging host. Chrome spawns this per connection (see the
// host manifest in Task-Monitoring-Extension/DEPLOYMENT.md). It does NOTHING
// except pump messages between Chrome (stdio, length-prefixed JSON) and the
// running agent (local pipe/socket). It holds no state and makes no decisions.
//
// Runs as plain Node (no Electron). If the agent is not running, the info file
// is absent or the pipe refuses — this process just exits and Chrome drops the
// port; capture is off anyway when the agent is down.
//
// Diagnostics (Step 4A): every exit path below is silent to Chrome by design
// (stdout is reserved for the native-messaging protocol — see nativeMessaging.js
// — so nothing human-readable may ever go there, and this was a genuine gap on
// an unattended machine with nobody watching the extension's DevTools console).
// nativeHostDiagnostics.logFailure() appends one bounded, local-only log line
// per failure — never to stdout, never including the bridge token, the
// contents of ext-bridge.json, or any native-messaging payload. See that
// module's header for the exact rules. This does not change the protocol, the
// exit codes, or introduce any reconnect logic here — background.js remains
// solely responsible for reconnecting.

"use strict";

const fs = require("fs");
const os = require("os");
const net = require("net");
const path = require("path");
const { encode, createDecoder } = require("./nativeMessaging");
const { logFailure } = require("./nativeHostDiagnostics");

const INFO_FILE = path.join(os.homedir(), ".humancare-monitoring", "ext-bridge.json");

function readInfo() {
    try {
        const raw = fs.readFileSync(INFO_FILE, "utf8");
        try {
            const j = JSON.parse(raw);
            if (j && j.pipe && j.token) return j;
            logFailure("info_file_incomplete");
        } catch (parseErr) {
            logFailure("info_file_malformed", parseErr && parseErr.name);
        }
    } catch (readErr) {
        // Never log the path/contents — just whether it was missing vs. some
        // other read failure (permissions, etc.), which is all that's needed
        // to tell "agent never started" apart from "something else is wrong".
        logFailure(readErr && readErr.code === "ENOENT" ? "info_file_missing" : "info_file_unreadable", readErr && readErr.code);
    }
    return null;
}

function toChrome(obj) {
    try {
        process.stdout.write(encode(obj));
    } catch (err) {
        logFailure("stdout_write_failed", err && err.name);
        process.exit(0);
    }
}

function main() {
    const info = readInfo();
    if (!info) {
        // Agent not running (or the bridge info was unusable) — nothing to
        // bridge to. readInfo() already logged the specific reason.
        process.exit(0);
    }

    const sock = net.connect(info.pipe);
    const toAgent = (obj) => {
        try {
            sock.write(encode(obj));
        } catch (err) {
            // agent gone — the 'close'/'error' handlers below also fire and
            // exit; this is only extra context for that same event.
            logFailure("agent_write_failed", err && err.name);
        }
    };

    const fromChrome = createDecoder();
    const fromAgent = createDecoder();

    sock.on("connect", () => {
        toAgent({ t: "auth", token: info.token });
        toAgent({ t: "hello", from: "native-host" });
    });

    sock.on("data", (chunk) => {
        let msgs;
        try {
            msgs = fromAgent.push(chunk);
        } catch (err) {
            // Never log `chunk`/`msgs` — only that framing failed.
            logFailure("decode_error_from_agent", err && err.message ? err.message.slice(0, 60) : err && err.name);
            sock.destroy();
            return;
        }
        for (const m of msgs) toChrome(m); // e.g. { t:"config", enabled, blocklist }
    });

    sock.on("error", (err) => {
        logFailure("pipe_connection_error", err && err.code);
        process.exit(0);
    });
    sock.on("close", () => {
        // Normal end-of-connection too (e.g. a clean Agent shutdown), not
        // only a failure — logged for the same reason as the others: so a
        // gap in captures is diagnosable after the fact.
        logFailure("pipe_closed");
        process.exit(0);
    });

    process.stdin.on("data", (chunk) => {
        let msgs;
        try {
            msgs = fromChrome.push(chunk);
        } catch (err) {
            // Never log `chunk`/`msgs` — only that framing failed. This is the
            // one path closest to real captured input; still only the codec's
            // own error is logged, never the frame contents.
            logFailure("decode_error_from_chrome", err && err.message ? err.message.slice(0, 60) : err && err.name);
            process.exit(0);
        }
        for (const m of msgs) toAgent(m); // e.g. { t:"capture", ... } / { t:"hello" }
    });
    process.stdin.on("end", () => {
        // Normal: Chrome closed the port (e.g. the service worker went idle).
        logFailure("stdin_ended");
        process.exit(0);
    });
    process.stdin.on("error", (err) => {
        logFailure("stdin_error", err && err.code);
        process.exit(0);
    });
}

try {
    main();
} catch (err) {
    // An unexpected synchronous throw during setup — Node's own default
    // (print to stderr, exit 1) is preserved below; this only adds a local
    // diagnostic line first.
    logFailure("uncaught_exception", err && err.name);
    process.exit(1);
}

process.on("uncaughtException", (err) => {
    logFailure("uncaught_exception", err && err.name);
    process.exit(1);
});
