// Tiny JSON HTTP client for talking to the monitoring backend.
// Uses the global fetch (Node 18+ / Electron). No third-party dependencies.
//
// It never logs request bodies or headers — callers get back only
// { status, data } and are responsible for logging safely.

const { isPackagedApp } = require("../config/config");

class NetworkError extends Error {
    constructor(message) {
        super(message);
        this.name = "NetworkError";
    }
}

// Raised BEFORE any connection is opened when a packaged agent is asked to
// send to a non-https: URL. Every agent request goes through postJson, so this
// is the last line of defense behind config.checkApiUrl: nothing (credentials,
// events, content, screenshots) can leave a packaged agent over plain HTTP.
// It extends NetworkError so every existing caller treats it as "couldn't
// send" and keeps its data queued — nothing is dropped and nothing is sent.
class InsecureUrlError extends NetworkError {
    constructor() {
        super("Refusing to send over plain HTTP: the installed agent requires an https:// API URL.");
        this.name = "InsecureUrlError";
    }
}

function assertTransportAllowed(url) {
    if (!isPackagedApp()) return;
    let protocol = null;
    try {
        protocol = new URL(url).protocol;
    } catch {
        protocol = null;
    }
    if (protocol !== "https:") throw new InsecureUrlError();
}

// A hung TCP/backend connection must never leave a request pending forever —
// every request is bounded by an AbortController-driven timeout. Overridable
// via AGENT_API_TIMEOUT_MS (or a per-call timeoutMs argument) without
// touching the config module in this step.
const DEFAULT_TIMEOUT_MS = 10000;

function resolveTimeoutMs(timeoutMs) {
    const fromArg = Number(timeoutMs);
    if (Number.isFinite(fromArg) && fromArg > 0) return fromArg;

    const fromEnv = Number(process.env.AGENT_API_TIMEOUT_MS);
    if (Number.isFinite(fromEnv) && fromEnv > 0) return fromEnv;

    return DEFAULT_TIMEOUT_MS;
}

async function postJson(url, body, timeoutMs) {
    assertTransportAllowed(url);
    const timeout = resolveTimeoutMs(timeoutMs);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    let response;
    try {
        response = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
            signal: controller.signal,
        });
    } catch (err) {
        if (err && err.name === "AbortError") {
            // Timed out — treat as a controlled network failure, same as a
            // DNS failure or connection refused, so every existing caller's
            // NetworkError handling covers it without changes.
            throw new NetworkError(`Request timed out after ${timeout}ms: ${url}`);
        }
        // DNS failure, connection refused, etc.
        throw new NetworkError(err.message);
    } finally {
        clearTimeout(timer);
    }

    let data = null;
    try {
        data = await response.json();
    } catch {
        data = null;
    }

    return { status: response.status, data };
}

module.exports = { postJson, NetworkError, InsecureUrlError, DEFAULT_TIMEOUT_MS };
