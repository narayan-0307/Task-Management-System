// Tiny JSON HTTP client for talking to the monitoring backend.
// Uses the global fetch (Node 18+ / Electron). No third-party dependencies.
//
// It never logs request bodies or headers — callers get back only
// { status, data } and are responsible for logging safely.

class NetworkError extends Error {
    constructor(message) {
        super(message);
        this.name = "NetworkError";
    }
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

module.exports = { postJson, NetworkError, DEFAULT_TIMEOUT_MS };
