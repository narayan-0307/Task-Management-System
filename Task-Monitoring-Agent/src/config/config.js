// Agent configuration loader.
//
// Resolution order (first match wins per field):
//   1. Environment variables
//        AGENT_API_BASE_URL
//        AGENT_UUID     (development/headless only — ignored when packaged)
//        AGENT_SECRET   (development/headless only — ignored when packaged)
//        HEARTBEAT_INTERVAL_SECONDS
//        ACTIVITY_POLL_INTERVAL_SECONDS
//        ACTIVITY_BUFFER_MAX_SIZE
//        IDLE_THRESHOLD_SECONDS
//   2. The optional `fallback` object passed to buildConfig(). This is how the
//      Electron first-time setup UI feeds in the credentials the employee
//      entered (decrypted from secure storage). It sits above the JSON file so
//      a completed UI setup wins over a stale agent.config.json, but still
//      below environment variables so CI / developer overrides keep working.
//   3. A local JSON file (default: <agent root>/agent.config.json,
//      or the path in AGENT_CONFIG_PATH) — DEVELOPMENT ONLY. Ignored entirely
//      when running as a packaged Electron app (app.isPackaged), and excluded
//      from the electron-builder package.
//
// The real agent_secret must only ever live in the local file, the environment,
// or the OS-encrypted Electron store — never in committed source.
// agent.config.json is gitignored.

const fs = require("fs");
const path = require("path");

const DEFAULT_HEARTBEAT_INTERVAL_SECONDS = 30;
// Phase 3: display power is now a persistent notification stream
// (displayPowerWatcher.js), not a per-poll PowerShell spawn, so the poll no
// longer has to be fast to keep screen on/off boundaries tight. Raised 5 -> 15
// to cut the active-window / domain PowerShell spawn rate ~3x. Legacy
// /activities session boundaries are correspondingly coarser (up to ~15s).
const DEFAULT_ACTIVITY_POLL_INTERVAL_SECONDS = 15;
const DEFAULT_ACTIVITY_BUFFER_MAX_SIZE = 10;
// §3: keyboard/mouse inactivity that marks the user IDLE. Was 60 and unused;
// now the real 5-minute threshold consumed by monitoring/inputState.js.
const DEFAULT_IDLE_THRESHOLD_SECONDS = 300;

// Events pipeline (Phase 1). The agent emits raw events IN ADDITION to the
// legacy /activities path (dual mode). Set EVENTS_PIPELINE_ENABLED=false to
// fully disable event emission/flush/input-polling and fall back to the
// legacy-only behaviour.
const DEFAULT_EVENT_FLUSH_INTERVAL_SECONDS = 20;
const DEFAULT_EVENT_BATCH_MAX_SIZE = 100;
const DEFAULT_EVENT_QUEUE_MAX_EVENTS = 20000;
const DEFAULT_INPUT_POLL_INTERVAL_SECONDS = 25;

// §5b content capture (Phase 4). Fully inert unless the SERVER's heartbeat
// reports content_capture.active === true (legal gate open + org enabled +
// consent on file). These only tune cadence when it IS active.
// Lowered 4 -> 2.5: the capture loop is a sampler with no keyboard/submit hook,
// so a shorter interval directly reduces how many quick searches fall between
// two samples. The address-bar UIA read is cached per (app, window title) so a
// faster poll does not mean proportionally more PowerShell spawns.
const DEFAULT_CONTENT_POLL_INTERVAL_SECONDS = 2.5;
// Lowered 30 -> 15 so a captured search/prompt reaches the server within ~15s of
// being emitted. At ~7 agents this is ~1 small POST per agent per 15s — trivial.
const DEFAULT_CONTENT_FLUSH_INTERVAL_SECONDS = 15;

// Live Screen (opt-in, gated). Two poll speeds so a new request is picked up
// quickly without polling fast forever:
//   idle   — runs continuously whenever the org has the feature enabled, so a
//            NEW request is noticed within one idle interval instead of
//            waiting for the next heartbeat (which can be ~30s away).
//   active — used once a session is pending/connecting/live, for snappier
//            signaling during the session itself.
const DEFAULT_LIVE_SCREEN_IDLE_POLL_INTERVAL_SECONDS = 5;
const DEFAULT_LIVE_SCREEN_POLL_INTERVAL_SECONDS = 2;
// 0 = no automatic maximum — the session runs until the viewer, the employee's
// Stop button, or a real connection failure ends it. Set
// LIVE_SCREEN_MAX_SESSION_SECONDS to opt back into a cap.
const DEFAULT_LIVE_SCREEN_MAX_SESSION_SECONDS = 0;
// Local safety net for a peer connection that never establishes (STUN-only on a
// strict NAT, etc.) — slightly longer than the server's own connect timeout so
// the server usually reports the failure first.
const DEFAULT_LIVE_SCREEN_CONNECT_TIMEOUT_SECONDS = 45;

// Screenshot (opt-in, gated) — a separate feature from Live Screen. One poll
// speed is enough: there is no "active session" to speed up for, just a
// pending request that should be noticed quickly.
const DEFAULT_SCREENSHOT_POLL_INTERVAL_SECONDS = 5;

function positiveNumberOr(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function booleanOr(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  const s = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(s)) return true;
  if (["0", "false", "no", "off"].includes(s)) return false;
  return fallback;
}

// True only inside a packaged (installed) Electron app. Under plain Node (the
// headless `npm run agent` / tests) require("electron") returns the binary
// path string, not the API, so this is false; under `electron .` in
// development app.isPackaged is false.
function isPackagedApp() {
  try {
    // eslint-disable-next-line global-require
    const electron = require("electron");
    return Boolean(
      electron &&
      typeof electron === "object" &&
      electron.app &&
      electron.app.isPackaged === true,
    );
  } catch {
    return false;
  }
}

// Production backend (Hostinger). The default API URL an INSTALLED agent offers
// in its setup screen. A public address, not a credential — the agent UUID and
// secret still come only from enrollment (secure store). Development keeps its
// own localhost default (main.js DEFAULT_API_BASE_URL).
const PRODUCTION_API_BASE_URL =
  "https://darkviolet-cobra-939760.hostingersite.com/api";

// API URL policy — the single source of truth for which backend URLs the agent
// may talk to. Trims and drops trailing slashes (existing normalization).
//   development: http: or https:  (http://localhost:5000/api keeps working)
//   packaged:    https: ONLY — credentials and monitoring data must never travel
//                over plain HTTP. An http: URL is rejected, never upgraded.
// Returns { url, error } where error is null | "invalid_url" | "insecure_url".
function checkApiUrl(value, options = {}) {
  const packaged =
    typeof options.isPackaged === "boolean"
      ? options.isPackaged
      : isPackagedApp();
  const trimmed = String(value || "")
    .trim()
    .replace(/\/+$/, "");
  if (!trimmed) return { url: null, error: "invalid_url" };

  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { url: null, error: "invalid_url" };
  }
  if (parsed.protocol === "https:") return { url: trimmed, error: null };
  if (parsed.protocol === "http:") {
    return packaged
      ? { url: null, error: "insecure_url" }
      : { url: trimmed, error: null };
  }
  return { url: null, error: "invalid_url" };
}

// Convenience wrapper: the normalized URL, or null when it is not allowed.
function normalizeApiUrl(value, options = {}) {
  return checkApiUrl(value, options).url;
}

// agent.config.json is a DEVELOPMENT-only credential source. A packaged app
// never reads it — not from the app bundle, not via AGENT_CONFIG_PATH — so an
// installer can never ship (or silently pick up) a reusable agent identity.
// Packaged installs get credentials only from the setup/enrollment flow
// (Electron secure store, passed in as `fallback`).
function loadFileConfig(packaged) {
  if (packaged) {
    return {};
  }

  const configPath =
    process.env.AGENT_CONFIG_PATH ||
    path.join(__dirname, "..", "..", "agent.config.json");

  if (!fs.existsSync(configPath)) {
    return {};
  }

  try {
    const raw = fs.readFileSync(configPath, "utf8");
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `Unable to read agent config file at ${configPath}: ${err.message}`,
    );
  }
}

// options.isPackaged overrides the app.isPackaged detection (tests only).
function buildConfig(fallback = {}, options = {}) {
  const packaged =
    typeof options.isPackaged === "boolean"
      ? options.isPackaged
      : isPackagedApp();

  const fileConfig = loadFileConfig(packaged);
  const fb = fallback || {};

  // env var > fallback (Electron setup UI) > agent.config.json
  const layered = (envKey, key) =>
    process.env[envKey] || fb[key] || fileConfig[key] || "";

  // ------------------------------------------------------------
  // API URL
  // ------------------------------------------------------------
  //
  // Development:
  //   Keep the existing configurable behavior.
  //
  // Packaged/installed:
  //   ALWAYS use the production backend.
  //
  // This prevents an employee from changing the monitoring server
  // using:
  //   - AGENT_API_BASE_URL
  //   - saved/fallback configuration
  //   - agent.config.json
  //
  let apiBaseUrl;
  let apiBaseUrlError = null;

  if (packaged) {
    // Installed agent is permanently pinned to the production backend.
    apiBaseUrl = PRODUCTION_API_BASE_URL;
  } else {
    // Development/headless behavior remains unchanged.
    apiBaseUrl = layered("AGENT_API_BASE_URL", "apiBaseUrl");

    if (apiBaseUrl) {
      const checked = checkApiUrl(apiBaseUrl, {
        isPackaged: false,
      });

      apiBaseUrl = checked.url || "";
      apiBaseUrlError = checked.error;
    }
  }

  // ------------------------------------------------------------
  // Credentials
  // ------------------------------------------------------------
  //
  // Packaged:
  //   Credentials ONLY come from the secure enrollment flow.
  //
  // Development:
  //   AGENT_UUID / AGENT_SECRET environment variables continue
  //   to work as before.
  //
  const credential = (envKey, key) =>
    packaged ? fb[key] || "" : layered(envKey, key);

  const agentUuid = credential("AGENT_UUID", "agentUuid");
  const agentSecret = credential("AGENT_SECRET", "agentSecret");

  // --- Phase 5 cutover: what the agent actually sends ---
  //   "events" (default) -> raw event pipeline only. Legacy POST /agent/activities
  //                         is NOT written to.
  //   "dual"             -> both, for a supervised transition window.
  //   "legacy"           -> only POST /agent/activities (the revert path).
  // EVENTS_PIPELINE_ENABLED=false is honoured as a hard override that forces
  // legacy-only, so a stale config that only knows that flag still works.
  const rawMode = String(layered("PIPELINE_MODE", "pipelineMode") || "events")
    .trim()
    .toLowerCase();

  let pipelineMode = ["events", "dual", "legacy"].includes(rawMode)
    ? rawMode
    : "events";

  const eventsFlagRaw =
    process.env.EVENTS_PIPELINE_ENABLED !== undefined
      ? process.env.EVENTS_PIPELINE_ENABLED
      : fb.eventsPipelineEnabled !== undefined
        ? fb.eventsPipelineEnabled
        : fileConfig.eventsPipelineEnabled;

  const eventsFlag = booleanOr(eventsFlagRaw, true);

  if (eventsFlagRaw !== undefined && eventsFlag === false) {
    pipelineMode = "legacy";
  }

  const eventsPipelineEnabled = pipelineMode !== "legacy";

  // Never leave the agent blind: if events are off, legacy stays on regardless
  // of mode.
  const legacyActivitiesEnabled =
    !eventsPipelineEnabled ||
    pipelineMode === "legacy" ||
    pipelineMode === "dual";

  return {
    pipelineMode,

    // Packaged builds are already pinned to the production URL.
    // Development URLs are normalized as before.
    apiBaseUrl: apiBaseUrl.replace(/\/+$/, ""),

    // null, or "insecure_url" / "invalid_url" in development when
    // the configured URL is rejected.
    apiBaseUrlError,

    agentUuid,
    agentSecret,

    heartbeatIntervalSeconds: positiveNumberOr(
      layered("HEARTBEAT_INTERVAL_SECONDS", "heartbeatIntervalSeconds"),
      DEFAULT_HEARTBEAT_INTERVAL_SECONDS,
    ),

    activityPollIntervalSeconds: positiveNumberOr(
      layered("ACTIVITY_POLL_INTERVAL_SECONDS", "activityPollIntervalSeconds"),
      DEFAULT_ACTIVITY_POLL_INTERVAL_SECONDS,
    ),

    activityBufferMaxSize: positiveNumberOr(
      layered("ACTIVITY_BUFFER_MAX_SIZE", "activityBufferMaxSize"),
      DEFAULT_ACTIVITY_BUFFER_MAX_SIZE,
    ),

    idleThresholdSeconds: positiveNumberOr(
      layered("IDLE_THRESHOLD_SECONDS", "idleThresholdSeconds"),
      DEFAULT_IDLE_THRESHOLD_SECONDS,
    ),

    // --- events pipeline (Phase 1); gated by pipelineMode (Phase 5) ---
    eventsPipelineEnabled,
    legacyActivitiesEnabled,

    eventFlushIntervalSeconds: positiveNumberOr(
      layered("EVENT_FLUSH_INTERVAL_SECONDS", "eventFlushIntervalSeconds"),
      DEFAULT_EVENT_FLUSH_INTERVAL_SECONDS,
    ),

    eventBatchMaxSize: positiveNumberOr(
      layered("EVENT_BATCH_MAX_SIZE", "eventBatchMaxSize"),
      DEFAULT_EVENT_BATCH_MAX_SIZE,
    ),

    eventQueueMaxEvents: positiveNumberOr(
      layered("EVENT_QUEUE_MAX_EVENTS", "eventQueueMaxEvents"),
      DEFAULT_EVENT_QUEUE_MAX_EVENTS,
    ),

    inputPollIntervalSeconds: positiveNumberOr(
      layered("INPUT_POLL_INTERVAL_SECONDS", "inputPollIntervalSeconds"),
      DEFAULT_INPUT_POLL_INTERVAL_SECONDS,
    ),

    // --- §5b content capture (Phase 4) ---
    contentPollIntervalSeconds: positiveNumberOr(
      layered("CONTENT_POLL_INTERVAL_SECONDS", "contentPollIntervalSeconds"),
      DEFAULT_CONTENT_POLL_INTERVAL_SECONDS,
    ),

    contentFlushIntervalSeconds: positiveNumberOr(
      layered("CONTENT_FLUSH_INTERVAL_SECONDS", "contentFlushIntervalSeconds"),
      DEFAULT_CONTENT_FLUSH_INTERVAL_SECONDS,
    ),

    // --- Live Screen ---
    liveScreenIdlePollIntervalSeconds: positiveNumberOr(
      layered(
        "LIVE_SCREEN_IDLE_POLL_INTERVAL_SECONDS",
        "liveScreenIdlePollIntervalSeconds",
      ),
      DEFAULT_LIVE_SCREEN_IDLE_POLL_INTERVAL_SECONDS,
    ),

    liveScreenPollIntervalSeconds: positiveNumberOr(
      layered(
        "LIVE_SCREEN_POLL_INTERVAL_SECONDS",
        "liveScreenPollIntervalSeconds",
      ),
      DEFAULT_LIVE_SCREEN_POLL_INTERVAL_SECONDS,
    ),

    liveScreenMaxSessionSeconds: positiveNumberOr(
      layered("LIVE_SCREEN_MAX_SESSION_SECONDS", "liveScreenMaxSessionSeconds"),
      DEFAULT_LIVE_SCREEN_MAX_SESSION_SECONDS,
    ),

    liveScreenConnectTimeoutSeconds: positiveNumberOr(
      layered(
        "LIVE_SCREEN_CONNECT_TIMEOUT_SECONDS",
        "liveScreenConnectTimeoutSeconds",
      ),
      DEFAULT_LIVE_SCREEN_CONNECT_TIMEOUT_SECONDS,
    ),

    // --- Screenshot ---
    screenshotPollIntervalSeconds: positiveNumberOr(
      layered(
        "SCREENSHOT_POLL_INTERVAL_SECONDS",
        "screenshotPollIntervalSeconds",
      ),
      DEFAULT_SCREENSHOT_POLL_INTERVAL_SECONDS,
    ),
  };
}

function validateConfig(config) {
  if (config.apiBaseUrlError === "insecure_url") {
    throw new Error(
      "The configured API URL is not HTTPS. The installed agent only connects " +
        "to an https:// monitoring server.",
    );
  }
  const missing = [];
  if (!config.apiBaseUrl) missing.push("apiBaseUrl");
  if (!config.agentUuid) missing.push("agentUuid");
  if (!config.agentSecret) missing.push("agentSecret");

  if (missing.length > 0) {
    throw new Error(
      `Missing required agent configuration: ${missing.join(", ")}. ` +
        `Copy agent.config.example.json to agent.config.json and fill it in.`,
    );
  }
}

module.exports = {
  buildConfig,
  validateConfig,
  isPackagedApp,
  checkApiUrl,
  normalizeApiUrl,
  PRODUCTION_API_BASE_URL,
  booleanOr,
  DEFAULT_HEARTBEAT_INTERVAL_SECONDS,
  DEFAULT_ACTIVITY_POLL_INTERVAL_SECONDS,
  DEFAULT_ACTIVITY_BUFFER_MAX_SIZE,
  DEFAULT_IDLE_THRESHOLD_SECONDS,
  DEFAULT_EVENT_FLUSH_INTERVAL_SECONDS,
  DEFAULT_EVENT_BATCH_MAX_SIZE,
  DEFAULT_EVENT_QUEUE_MAX_EVENTS,
  DEFAULT_INPUT_POLL_INTERVAL_SECONDS,
  DEFAULT_CONTENT_POLL_INTERVAL_SECONDS,
  DEFAULT_CONTENT_FLUSH_INTERVAL_SECONDS,
};
