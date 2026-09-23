// Pure, Electron-free formatting for uncaughtException / unhandledRejection
// diagnostics (Step 2 crash audit). No dependency on electron, so this can be
// unit-tested directly instead of requiring main.js (which cannot be loaded
// outside a real Electron runtime).
//
// Callers must pass only { name, message, stack } (or an Error/rejection
// reason) plus an optional agent_uuid — never a full config, request body, or
// captured-content object. This module never touches, and therefore can never
// leak, the agent secret, auth tokens, encryption keys, or captured
// search/prompt text.

function stamp() {
    return new Date().toISOString();
}

// A rejection reason can be anything — a string, a plain object, undefined.
// Deliberately narrow to name/message/stack only; never serialize an
// arbitrary object here, since that is exactly how something sensitive could
// leak if a call site ever rejected with e.g. a config object by mistake.
function toErrorLike(value) {
    if (value instanceof Error) {
        return { name: value.name, message: value.message, stack: value.stack };
    }
    return {
        name: "NonErrorRejection",
        message: typeof value === "string" ? value : Object.prototype.toString.call(value),
        stack: null,
    };
}

/**
 * @param {"uncaughtException"|"unhandledRejection"} kind
 * @param {*} errorOrReason
 * @param {string|null} [agentUuid]
 * @returns {string[]} safe log lines, one per call to the logger
 */
function formatCrashDiagnostics(kind, errorOrReason, agentUuid) {
    const e = toErrorLike(errorOrReason);
    return [
        `[${stamp()}] FATAL-DIAGNOSTIC (${kind})`,
        `Agent: ${agentUuid || "(not connected)"}`,
        `Error name: ${e.name || "Unknown"}`,
        `Error message: ${e.message || "(no message)"}`,
        `Stack: ${e.stack || "(no stack available)"}`,
    ];
}

module.exports = { formatCrashDiagnostics };
