"use strict";

/**
 * Live Screen — session registry + WebRTC signaling relay.
 *
 * NOTHING here touches media. The registry holds, per active session, only the
 * transient SDP offer/answer and ICE candidate strings needed to broker one
 * peer-to-peer connection. Every entry is deleted on teardown. Video flows
 * agent -> viewer directly and never reaches this process.
 *
 * Split like the other monitoring services:
 *   - authorizeViewer()   pure — gate + org setting + owner/grant check
 *   - the registry (Map) + EventEmitter — in-memory only, wired to socket.io
 *     and the DB status column by the caller (socket.js / controller)
 */

const { EventEmitter } = require("events");
const { LIVE_SCREEN_LEGALLY_APPROVED } = require("../config/liveScreenGate");
const { canViewContent } = require("./monitoringContent");

const num = (v, d) => (Number(v) > 0 ? Number(v) : d);
// 0 = no automatic maximum — a session runs until explicitly ended (by the
// viewer, the employee's Stop button, or a real connection failure). Set
// LIVE_SCREEN_MAX_SESSION_MS to a positive number to opt back into a cap.
const MAX_SESSION_MS = num(process.env.LIVE_SCREEN_MAX_SESSION_MS, 0);
const REQUEST_TIMEOUT_MS = num(process.env.LIVE_SCREEN_REQUEST_TIMEOUT_MS, 45 * 1000);
// After the offer is exchanged, the peers have this long to actually connect.
// STUN-only fails here on strict/symmetric-NAT networks (no TURN relay) — the
// session ends cleanly with reason "connect_failed" instead of hanging.
const CONNECT_TIMEOUT_MS = num(process.env.LIVE_SCREEN_CONNECT_TIMEOUT_MS, 40 * 1000);
const ENDED_GRACE_MS = 15 * 1000; // keep an ended session briefly so a late poll sees "stop"
// A viewer's signaling socket can drop for reasons that have nothing to do
// with wanting to end the session (WiFi blip, laptop sleep, a corporate proxy
// idling the websocket, a backgrounded tab). Give the SAME viewer this long to
// reconnect before actually ending their session(s) — the WebRTC media path is
// independent of this signaling socket, so a live call survives the blip.
const DISCONNECT_GRACE_MS = num(process.env.LIVE_SCREEN_DISCONNECT_GRACE_MS, 20 * 1000);

/** ICE/TURN servers for both peers.
 *
 * PRODUCTION: set LIVE_SCREEN_ICE_SERVERS to a JSON array of RTCIceServer
 * objects that includes a TURN server — direct P2P fails whenever either peer
 * is behind a symmetric NAT / restrictive firewall (common on corporate and
 * mobile networks), and only TURN relays past that. Example:
 *   LIVE_SCREEN_ICE_SERVERS=[
 *     {"urls":"stun:stun.l.google.com:19302"},
 *     {"urls":["turn:turn.example.com:3478","turn:turn.example.com:3478?transport=tcp"],
 *      "username":"…","credential":"…"}
 *   ]
 * The default below is STUN-only and will not connect through a strict NAT. */
const DEFAULT_ICE_SERVERS = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
];

function iceServers() {
  const raw = process.env.LIVE_SCREEN_ICE_SERVERS;
  if (raw && raw.trim()) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length) {
        const hasStun = parsed.some((s) =>
          [].concat(s.urls || []).some((u) => /^stun:/i.test(String(u)))
        );
        return hasStun ? parsed : [...DEFAULT_ICE_SERVERS, ...parsed];
      }
    } catch {
      console.error("LIVE_SCREEN_ICE_SERVERS is not valid JSON — using STUN-only default.");
    }
  }
  return DEFAULT_ICE_SERVERS;
}

// sessionId -> session
const sessions = new Map();
const emitter = new EventEmitter();

// Any session for this agent — including one that just ended (kept for
// ENDED_GRACE_MS so the agent's next poll sees "stop"). Prefers a live one.
function byAgent(agentId) {
  let ended = null;
  for (const s of sessions.values()) {
    if (s.agentId !== agentId) continue;
    if (s.status === "ended" || s.status === "error") ended = ended || s;
    else return s;
  }
  return ended;
}
function activeByTarget(organizationId, targetUserId) {
  for (const s of sessions.values()) {
    if (
      s.organizationId === organizationId &&
      s.targetUserId === targetUserId &&
      s.status !== "ended" &&
      s.status !== "error"
    ) {
      return s;
    }
  }
  return null;
}

/**
 * Pure end-to-end check of one viewer request. The caller has already fetched
 * orgSettings / grants / agent / consent from the DB; this decides yes/no and
 * why, with a specific code for each failure so the dashboard and logs show the
 * real cause (never a generic error).
 *
 * @returns {{ ok:true, accessVia:"owner"|"grant", targetUserId:number }
 *          | { ok:false, code:string }}
 *   codes: unauthenticated | bad_request | not_enabled | not_authorized |
 *          agent_offline | consent_missing
 */
function prepareViewerRequest(p) {
  const viewer = p.viewer || {};
  if (!viewer.id || !p.organizationId) return { ok: false, code: "unauthenticated" };

  const targetUserId = Number(p.targetUserId);
  if (!Number.isInteger(targetUserId) || targetUserId <= 0) {
    return { ok: false, code: "bad_request" };
  }

  const authz = authorizeViewer({
    gateApproved: p.gateApproved,
    orgSettings: p.orgSettings,
    viewer,
    organizationId: p.organizationId,
    targetUserId,
    grants: p.grants,
    now: p.now,
  });
  if (!authz.ok) return authz;

  if (!p.agent) return { ok: false, code: "agent_offline" };
  if (!p.consent) return { ok: false, code: "consent_missing" };

  return { ok: true, accessVia: authz.accessVia, targetUserId };
}

/**
 * Pure authorization for starting a live-screen session.
 * @returns {{ ok:true, accessVia:"owner"|"grant" } | { ok:false, code:string }}
 */
function authorizeViewer(p) {
  const gateApproved =
    p.gateApproved !== undefined ? p.gateApproved : LIVE_SCREEN_LEGALLY_APPROVED;
  if (!gateApproved) return { ok: false, code: "not_enabled" };
  if (!p.orgSettings || !p.orgSettings.live_screen_enabled) {
    return { ok: false, code: "not_enabled" };
  }

  const verdict = canViewContent({
    viewerUserId: p.viewer.id,
    viewerRole: p.viewer.role,
    organizationId: p.organizationId,
    targetUserId: p.targetUserId,
    grants: p.grants || [],
    now: p.now || new Date(),
  });
  if (!verdict.allowed) return { ok: false, code: "not_authorized" };
  return { ok: true, accessVia: verdict.via };
}

function clearTimers(s) {
  if (s.timers.request) clearTimeout(s.timers.request);
  if (s.timers.connect) clearTimeout(s.timers.connect);
  if (s.timers.max) clearTimeout(s.timers.max);
  s.timers = {};
}

/** End a session and drop every transient signaling artefact. Idempotent. */
function endSession(sessionId, reason) {
  const s = sessions.get(sessionId);
  if (!s || s.status === "ended" || s.status === "error") return;
  clearTimers(s);
  s.status = reason === "error" ? "error" : "ended";
  s.endReason = reason;
  s.endedAt = new Date();
  s.signal = { offer: null, answer: null, viewerIce: [], agentIce: [] }; // wiped
  emitter.emit("session", { type: "ended", session: publicView(s), reason });
  setTimeout(() => sessions.delete(sessionId), ENDED_GRACE_MS).unref?.();
}

function publicView(s) {
  return {
    id: s.id,
    organizationId: s.organizationId,
    viewerUserId: s.viewerUserId,
    targetUserId: s.targetUserId,
    agentId: s.agentId,
    status: s.status,
    accessVia: s.accessVia,
    endReason: s.endReason || null,
    connectedAt: s.connectedAt || null,
    endedAt: s.endedAt || null,
  };
}

/**
 * Register a new viewer-initiated session. Caller has already run
 * authorizeViewer(). `agentId` is the target's active agent.
 */
function createSession({ id, organizationId, viewer, targetUserId, agentId, accessVia }) {
  // one live session per target at a time
  const existing = activeByTarget(organizationId, targetUserId);
  if (existing) endSession(existing.id, "superseded");

  const s = {
    id,
    organizationId,
    viewerUserId: viewer.id,
    targetUserId,
    agentId,
    accessVia,
    status: "requested",
    createdAt: new Date(),
    connectedAt: null,
    signal: { offer: null, answer: null, viewerIce: [], agentIce: [] },
    timers: {},
  };
  s.timers.request = setTimeout(
    () => endSession(id, "agent_unavailable"),
    REQUEST_TIMEOUT_MS,
  );
  if (s.timers.request.unref) s.timers.request.unref();
  if (MAX_SESSION_MS > 0) {
    s.timers.max = setTimeout(() => endSession(id, "max_duration"), MAX_SESSION_MS);
    if (s.timers.max.unref) s.timers.max.unref();
  }

  sessions.set(id, s);
  emitter.emit("session", { type: "requested", session: publicView(s) });
  return publicView(s);
}

// ---- agent side (polled directive + posted signal) ----------------------

/** What the agent for `agentId` should do right now. */
function agentDirective(agentId) {
  const s = byAgent(agentId);
  if (!s) return { action: "none" };
  if (s.status === "requested" || s.status === "connecting") {
    return {
      action: "start",
      session_id: s.id,
      ice_servers: iceServers(),
      answer: s.signal.answer || null,
      viewer_ice: s.signal.viewerIce.splice(0), // deliver once
    };
  }
  if (s.status === "live") {
    return {
      action: "keep",
      session_id: s.id,
      viewer_ice: s.signal.viewerIce.splice(0),
    };
  }
  return { action: "stop", session_id: s.id };
}

/** Agent posts an offer / ICE / status update. */
function agentSignal(agentId, msg) {
  const s = byAgent(agentId);
  if (!s || !msg || msg.session_id !== s.id) return { ok: false, code: "no_session" };
  // byAgent() deliberately still returns a session for ENDED_GRACE_MS after it
  // ended (so a late poll sees "stop"). A late/retried agent signal for that
  // same id must NOT resurrect it — e.g. a retried "connected" arriving just
  // after connect_failed already fired would otherwise flip status back to
  // "live" on a session the viewer has already been told is over.
  if (s.status === "ended" || s.status === "error") {
    return { ok: false, code: "session_ended" };
  }

  switch (msg.type) {
    case "offer":
      if (s.timers.request) {
        clearTimeout(s.timers.request);
        s.timers.request = null;
      }
      s.status = "connecting";
      s.signal.offer = msg.sdp || null;
      if (!s.timers.connect) {
        s.timers.connect = setTimeout(
          () => endSession(s.id, "connect_failed"),
          CONNECT_TIMEOUT_MS,
        );
        if (s.timers.connect.unref) s.timers.connect.unref();
      }
      emitter.emit("session", { type: "offer", session: publicView(s), sdp: msg.sdp });
      return { ok: true };
    case "ice":
      if (msg.candidate) s.signal.agentIce.push(msg.candidate);
      emitter.emit("session", {
        type: "ice",
        session: publicView(s),
        candidate: msg.candidate,
      });
      return { ok: true };
    case "connected":
      // The agent resends this on every active poll until it sees the server
      // has actually switched to "live" (see liveScreenController.js's
      // resend-on-mismatch logic) — the single HTTP POST that used to be the
      // only chance for this to land could be lost to a network blip, leaving
      // CONNECT_TIMEOUT_MS to end a perfectly healthy session. Idempotent by
      // design: a repeat once already "live" only re-clears an already-null
      // timer and skips the status/emit below.
      if (s.timers.connect) {
        clearTimeout(s.timers.connect);
        s.timers.connect = null;
      }
      if (s.status !== "live") {
        s.status = "live";
        s.connectedAt = new Date();
        emitter.emit("session", { type: "live", session: publicView(s) });
      }
      return { ok: true };
    case "stopped":
      endSession(s.id, "stopped_by_employee");
      return { ok: true };
    case "error":
      endSession(s.id, "error");
      return { ok: true };
    default:
      return { ok: false, code: "bad_type" };
  }
}

// ---- viewer side (socket.io) -------------------------------------------

function viewerAnswer(sessionId, sdp) {
  const s = sessions.get(sessionId);
  if (!s || s.status === "ended" || s.status === "error") return false;
  s.signal.answer = sdp || null;
  return true;
}
function viewerIce(sessionId, candidate) {
  const s = sessions.get(sessionId);
  if (!s || s.status === "ended" || s.status === "error") return false;
  if (candidate) s.signal.viewerIce.push(candidate);
  return true;
}
function agentIceFor(sessionId) {
  const s = sessions.get(sessionId);
  if (!s) return [];
  return s.signal.agentIce.splice(0);
}
function getSession(sessionId) {
  const s = sessions.get(sessionId);
  return s ? publicView(s) : null;
}
function endAllForViewer(viewerUserId, reason = "viewer_disconnected") {
  for (const s of [...sessions.values()]) {
    if (s.viewerUserId === viewerUserId) endSession(s.id, reason);
  }
}

// viewerUserId -> Timeout. A signaling-socket disconnect starts this grace
// timer instead of ending the session outright; connecting again (same user,
// any tab) cancels it. Only a disconnect that outlasts the grace period is
// treated as a real "the viewer left".
const pendingViewerDisconnects = new Map();

function cancelScheduledViewerDisconnect(viewerUserId) {
  const t = pendingViewerDisconnects.get(viewerUserId);
  if (t) {
    clearTimeout(t);
    pendingViewerDisconnects.delete(viewerUserId);
  }
}

function scheduleViewerDisconnect(viewerUserId, reason = "viewer_disconnected") {
  cancelScheduledViewerDisconnect(viewerUserId);
  const t = setTimeout(() => {
    pendingViewerDisconnects.delete(viewerUserId);
    endAllForViewer(viewerUserId, reason);
  }, DISCONNECT_GRACE_MS);
  if (t.unref) t.unref();
  pendingViewerDisconnects.set(viewerUserId, t);
}

function activeSessionCount() {
  let n = 0;
  for (const s of sessions.values()) {
    if (s.status !== "ended" && s.status !== "error") n += 1;
  }
  return n;
}

/**
 * Is the Live Screen schema actually present? The feature's migrations
 * (monitoring_live_screen_sessions + monitoring_org_settings.live_screen_enabled)
 * are separate from the code deploy — on a Passenger host `npm start`
 * (which runs migrate:prod) is not executed, so they can be missing.
 * @param {import("sequelize").Sequelize} sequelize
 */
async function schemaHealth(sequelize) {
  const qi = sequelize.getQueryInterface();
  const out = { sessions_table: false, org_setting_column: false, error: null };
  try {
    await qi.describeTable("monitoring_live_screen_sessions");
    out.sessions_table = true;
  } catch {
    /* missing */
  }
  try {
    const cols = await qi.describeTable("monitoring_org_settings");
    out.org_setting_column = Boolean(cols && cols.live_screen_enabled);
  } catch (err) {
    out.error = err.message;
  }
  return out;
}

/** true when a caught error means "the DB schema isn't there yet". */
function isSchemaError(err) {
  if (!err) return false;
  const code = err.original && err.original.code;
  return (
    err.name === "SequelizeDatabaseError" &&
    ["ER_NO_SUCH_TABLE", "ER_BAD_FIELD_ERROR"].includes(code)
  );
}

function _reset() {
  for (const s of sessions.values()) clearTimers(s);
  sessions.clear();
  for (const t of pendingViewerDisconnects.values()) clearTimeout(t);
  pendingViewerDisconnects.clear();
  emitter.removeAllListeners();
}

module.exports = {
  emitter,
  iceServers,
  authorizeViewer,
  prepareViewerRequest,
  createSession,
  endSession,
  agentDirective,
  agentSignal,
  viewerAnswer,
  viewerIce,
  agentIceFor,
  getSession,
  endAllForViewer,
  scheduleViewerDisconnect,
  cancelScheduledViewerDisconnect,
  activeSessionCount,
  schemaHealth,
  isSchemaError,
  MAX_SESSION_MS,
  _reset,
};
