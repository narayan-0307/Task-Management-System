const crypto = require("crypto");
const { Server } = require("socket.io");
const jwt = require("jsonwebtoken");
const { Op } = require("sequelize");
const { sequelize } = require("./config/db");
const {
  Project,
  Task,
  MonitoringAgent,
  MonitoringOrgSetting,
  MonitoringContentGrant,
  MonitoringConsent,
  MonitoringLiveScreenSession,
  MonitoringScreenshotRequest,
} = require("./models");
const {
  canAccessTaskChat,
  canAccessTaskChatViaMembership,
} = require("./utils/taskChatAccess");
const {
  canAccessConversation,
} = require("./utils/organizationChatAccess");
const liveScreen = require("./services/monitoringLiveScreen");
const monitoringScreenshot = require("./services/monitoringScreenshot");
const {
  LIVE_SCREEN_CONSENT_DOCUMENT_VERSION,
} = require("./config/liveScreenConsentDocument");
const { LIVE_SCREEN_LEGALLY_APPROVED } = require("./config/liveScreenGate");

let io = null;

function initSocket(server) {
  io = new Server(server, {
    cors: {
      origin: "*",
    },
  });

  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;

    if (!token) {
      return next(new Error("No token provided."));
    }

    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      socket.user = decoded; // { id, organization_id, role }
      next();
    } catch (error) {
      next(new Error("Invalid or expired token."));
    }
  });

  io.on("connection", (socket) => {
    // Personal room — used for direct notifications
    socket.join(`user:${socket.user.id}`);

    // This user reconnected (new tab, or the same tab's transport recovered
    // from a blip) — cancel any pending "end their Live Screen session(s)"
    // grace timer from a previous disconnect so a brief network hiccup never
    // kills a live call.
    liveScreen.cancelScheduledViewerDisconnect(socket.user.id);

    // Organization room — used for the org-wide activity feed. The id comes
    // from the verified JWT (socket.user), never from a client message, so a
    // client cannot subscribe to another organization's activity.
    if (socket.user.organization_id) {
      socket.join(`organization:${socket.user.organization_id}`);
    }

    socket.on("project:join", async (projectId) => {
      try {
        const project = await Project.findOne({
          where: { id: projectId, organization_id: socket.user.organization_id },
        });
        if (project) {
          socket.join(`project:${projectId}`);
        }
      } catch (err) {
        console.error("project:join error:", err.message);
      }
    });

    socket.on("project:leave", (projectId) => {
      socket.leave(`project:${projectId}`);
    });

    // Step 2D: `task:${taskId}` is the GENERAL task realtime room (comments,
    // subtasks, subtask comments -- see commentController.js/
    // subtaskController.js). It uses the broad canAccessTaskChat rule (org
    // admin, task creator, assignee, or any project member), same as before
    // Step 2C-2. Task Chat now has its OWN room/join below and is no longer
    // gated through this handler.
    socket.on("task:join", async (taskId) => {
      try {
        const access = await canAccessTaskChat(socket.user.id, taskId);

        if (!access.allowed) {
          socket.emit("task:join:error", {
            taskId,
            message: "You do not have access to this task.",
          });
          return;
        }

        if (
          Number(access.task.organization_id) !==
          Number(socket.user.organization_id)
        ) {
          socket.emit("task:join:error", {
            taskId,
            message: "You do not have access to this task.",
          });
          return;
        }

        socket.join(`task:${taskId}`);
      } catch (err) {
        console.error("task:join error:", err.message);

        socket.emit("task:join:error", {
          taskId,
          message: "Unable to join task.",
        });
      }
    });

    socket.on("task:leave", (taskId) => {
      socket.leave(`task:${taskId}`);
    });

    // Step 2D: `task-chat:${taskId}` is a SEPARATE room, used ONLY for Task
    // Chat (`message:new`). TaskMember is the sole source of truth here --
    // no org-admin/creator/assignee/project-member bypass, matching the REST
    // Task Chat endpoints (canAccessTaskChatViaMembership).
    socket.on("task:chat:join", async (taskId) => {
      try {
        const access = await canAccessTaskChatViaMembership(
          socket.user.id,
          taskId,
        );

        if (!access.allowed) {
          socket.emit("task:chat:join:error", {
            taskId,
            message: "You do not have access to this task's chat.",
          });
          return;
        }

        if (
          Number(access.task.organization_id) !==
          Number(socket.user.organization_id)
        ) {
          socket.emit("task:chat:join:error", {
            taskId,
            message: "You do not have access to this task's chat.",
          });
          return;
        }

        socket.join(`task-chat:${taskId}`);
      } catch (err) {
        console.error("task:chat:join error:", err.message);

        socket.emit("task:chat:join:error", {
          taskId,
          message: "Unable to join task chat.",
        });
      }
    });

    socket.on("task:chat:leave", (taskId) => {
      socket.leave(`task-chat:${taskId}`);
    });

    // Organization Chat (Step 7) -- entirely separate room namespace from
    // Task Chat (`task-chat:${taskId}`) and from the org-wide Activity feed
    // room (`organization:${organizationId}`, joined automatically above).
    // Every conversation (org_wide, direct, or group) uses the SAME room --
    // `conversation:${conversationId}` -- and the SAME authorization rule:
    // active OrganizationMember AND an explicit ConversationMember row.
    // org_wide conversations are not a bypass; a membership row is still
    // required, exactly like direct/group.
    socket.on("orgchat:conversation:join", async (payload = {}) => {
      const conversationId = payload && payload.conversationId;

      try {
        const access = await canAccessConversation(
          socket.user.id,
          conversationId,
        );

        if (!access.allowed) {
          socket.emit("orgchat:conversation:join:error", {
            conversationId,
            message: "You do not have access to this conversation.",
          });
          return;
        }

        // conversation_id is never trusted from the client for room naming
        // beyond this point -- access.conversation is the server-loaded
        // record, and its organization is re-checked against the verified
        // JWT identity (defense in depth for the multi-org-per-user schema).
        if (
          Number(access.conversation.organization_id) !==
          Number(socket.user.organization_id)
        ) {
          socket.emit("orgchat:conversation:join:error", {
            conversationId,
            message: "You do not have access to this conversation.",
          });
          return;
        }

        socket.join(`conversation:${access.conversation.id}`);
      } catch (err) {
        console.error("orgchat:conversation:join error:", err.message);

        socket.emit("orgchat:conversation:join:error", {
          conversationId,
          message: "Unable to join conversation.",
        });
      }
    });

    socket.on("orgchat:conversation:leave", (payload = {}) => {
      const conversationId = payload && payload.conversationId;
      if (conversationId) {
        socket.leave(`conversation:${conversationId}`);
      }
    });

    wireLiveScreenSocket(socket);
    wireScreenshotSocket(socket);
  });

  wireLiveScreenRelay();
  wireScreenshotRelay();
  reportLiveScreenReadiness();

  return io;
}

// Boot-time check: the Live Screen migrations (monitoring_live_screen_sessions +
// monitoring_org_settings.live_screen_enabled) ship in code but only run via
// `npm run migrate:prod`. On a Passenger host that is NOT executed on deploy,
// so the tables can be missing — which surfaces later as a "server error" when
// a viewer clicks Live Screen. Make that loud at startup instead.
async function reportLiveScreenReadiness() {
  if (!LIVE_SCREEN_LEGALLY_APPROVED) {
    console.log("[live-screen] legal gate is closed — feature disabled.");
    return;
  }
  try {
    const h = await liveScreen.schemaHealth(sequelize);
    if (h.sessions_table && h.org_setting_column) {
      console.log("[live-screen] enabled; schema OK.");
      return;
    }
    console.error(
      "\n" +
        "  ┌─────────────────────────────────────────────────────────────────┐\n" +
        "  │  LIVE SCREEN SCHEMA IS MISSING — the feature will fail.          │\n" +
        `  │   monitoring_live_screen_sessions table : ${h.sessions_table ? "present" : "MISSING "}              │\n` +
        `  │   monitoring_org_settings.live_screen_enabled : ${h.org_setting_column ? "present" : "MISSING "}       │\n` +
        "  │  Run the pending migrations on this database:                    │\n" +
        "  │    npx sequelize-cli db:migrate --env production                 │\n" +
        "  └─────────────────────────────────────────────────────────────────┘\n",
    );
  } catch (err) {
    console.error("[live-screen] schema check failed:", err.message);
  }
}

// ---------------------------------------------------------------------------
// Live Screen — WebRTC signaling for the VIEWER side. The media never touches
// this server; only SDP/ICE text is relayed, and only while a session is open.
// Gated by config/liveScreenGate.js (LIVE_SCREEN_LEGALLY_APPROVED).
// ---------------------------------------------------------------------------

let liveScreenRelayWired = false;

function wireLiveScreenRelay() {
  if (liveScreenRelayWired) return;
  liveScreenRelayWired = true;

  liveScreen.emitter.on("session", async (evt) => {
    const s = evt.session;
    const room = s.viewerUserId ? `user:${s.viewerUserId}` : null;

    // keep the audit row's status column in step (metadata only)
    try {
      if (evt.type === "offer") {
        await MonitoringLiveScreenSession.update(
          { status: "connecting" },
          { where: { id: s.id } },
        );
      } else if (evt.type === "live") {
        await MonitoringLiveScreenSession.update(
          { status: "live", connected_at: new Date() },
          { where: { id: s.id } },
        );
      } else if (evt.type === "ended") {
        await MonitoringLiveScreenSession.update(
          {
            status: s.status === "error" ? "error" : "ended",
            end_reason: evt.reason || s.endReason || "ended",
            ended_at: new Date(),
          },
          { where: { id: s.id, status: { [Op.notIn]: ["ended", "error"] } } },
        );
      }
    } catch (err) {
      console.error("live-screen audit update failed:", err.message);
    }

    if (!room || !io) return;
    if (evt.type === "offer") {
      io.to(room).emit("livescreen:offer", { sessionId: s.id, sdp: evt.sdp });
    } else if (evt.type === "ice") {
      io.to(room).emit("livescreen:ice", {
        sessionId: s.id,
        candidate: evt.candidate,
      });
    } else if (evt.type === "live") {
      io.to(room).emit("livescreen:status", { sessionId: s.id, status: "live" });
    } else if (evt.type === "ended") {
      io.to(room).emit("livescreen:ended", {
        sessionId: s.id,
        reason: evt.reason || s.endReason || "ended",
      });
    }
  });
}

function wireLiveScreenSocket(socket) {
  const user = socket.user; // { id, organization_id, role } from verified JWT

  socket.on("livescreen:request", async ({ targetUserId } = {}, ack) => {
    const reply = typeof ack === "function" ? ack : () => {};
    const target = Number(targetUserId);
    try {
      const [orgSettings, grants, agent, consent] = await Promise.all([
        MonitoringOrgSetting.findOne({
          where: { organization_id: user.organization_id },
          attributes: ["organization_id", "live_screen_enabled"],
          raw: true,
        }),
        MonitoringContentGrant.findAll({
          where: { organization_id: user.organization_id, grantee_user_id: user.id },
          raw: true,
        }),
        Number.isInteger(target) && target > 0
          ? MonitoringAgent.findOne({
              where: {
                organization_id: user.organization_id,
                user_id: target,
                status: "active",
              },
              order: [["last_seen_at", "DESC"]],
            })
          : null,
        Number.isInteger(target) && target > 0
          ? MonitoringConsent.findOne({
              where: {
                user_id: target,
                document_version: LIVE_SCREEN_CONSENT_DOCUMENT_VERSION,
              },
              raw: true,
            })
          : null,
      ]);

      const decision = liveScreen.prepareViewerRequest({
        viewer: user,
        organizationId: user.organization_id,
        targetUserId: target,
        orgSettings,
        grants,
        agent,
        consent,
      });
      if (!decision.ok) return reply({ ok: false, code: decision.code });

      const id = crypto.randomUUID();
      await MonitoringLiveScreenSession.create({
        id,
        organization_id: user.organization_id,
        viewer_user_id: user.id,
        target_user_id: target,
        agent_id: agent.id,
        status: "requested",
        access_via: decision.accessVia,
        viewer_ip:
          (socket.handshake.headers["x-forwarded-for"] || "")
            .split(",")[0]
            .trim() ||
          socket.handshake.address ||
          null,
      });

      liveScreen.createSession({
        id,
        organizationId: user.organization_id,
        viewer: user,
        targetUserId: target,
        agentId: agent.id,
        accessVia: decision.accessVia,
      });

      reply({ ok: true, sessionId: id, iceServers: liveScreen.iceServers() });
    } catch (err) {
      // Full detail in the log so the exact cause is visible, not just .message.
      console.error("livescreen:request FAILED", {
        viewer: user && user.id,
        org: user && user.organization_id,
        target,
        name: err && err.name,
        db_code: err && err.original && err.original.code,
        sql: err && err.sql,
        message: err && err.message,
      });
      if (liveScreen.isSchemaError(err)) {
        return reply({
          ok: false,
          code: "not_ready",
          detail:
            "Live Screen database migrations have not been applied on this server. " +
            "Run: npx sequelize-cli db:migrate --env production",
        });
      }
      reply({ ok: false, code: "server_error" });
    }
  });

  socket.on("livescreen:answer", ({ sessionId, sdp } = {}) => {
    const s = liveScreen.getSession(sessionId);
    if (!s || s.viewerUserId !== user.id) return;
    liveScreen.viewerAnswer(sessionId, sdp);
    // hand the viewer any ICE the agent already produced
    for (const candidate of liveScreen.agentIceFor(sessionId)) {
      socket.emit("livescreen:ice", { sessionId, candidate });
    }
  });

  socket.on("livescreen:ice", ({ sessionId, candidate } = {}) => {
    const s = liveScreen.getSession(sessionId);
    if (!s || s.viewerUserId !== user.id) return;
    liveScreen.viewerIce(sessionId, candidate);
  });

  socket.on("livescreen:stop", ({ sessionId } = {}) => {
    const s = liveScreen.getSession(sessionId);
    if (!s || s.viewerUserId !== user.id) return;
    liveScreen.endSession(sessionId, "stopped_by_viewer");
  });

  socket.on("disconnect", () => {
    // Don't end the session on the spot — the signaling socket dropping is
    // not the same as the viewer wanting to stop (WiFi blip, sleep, a proxy
    // idling the websocket). Give them DISCONNECT_GRACE_MS to reconnect;
    // "connection" above cancels this if they do. The WebRTC media itself is
    // a separate P2P path and is untouched by this socket dropping.
    liveScreen.scheduleViewerDisconnect(user.id, "viewer_disconnected");
  });
}

// ---------------------------------------------------------------------------
// Screenshot — a SEPARATE feature from Live Screen. No WebRTC, no persistent
// session: one request, one image, delivered once. The image bytes DO transit
// this server's memory (see services/monitoringScreenshot.js for why that is
// unavoidable here), but only as a same-tick event payload — this relay never
// assigns them to a variable that outlives the emit, never logs them, and
// never writes them to the database. Only request metadata is persisted.
// ---------------------------------------------------------------------------

let screenshotRelayWired = false;

function wireScreenshotRelay() {
  if (screenshotRelayWired) return;
  screenshotRelayWired = true;

  monitoringScreenshot.emitter.on("request", async (evt) => {
    const r = evt.request;
    const room = r.viewerUserId ? `user:${r.viewerUserId}` : null;

    try {
      if (evt.type === "delivered") {
        await MonitoringScreenshotRequest.update(
          { status: "delivered", delivered_at: r.deliveredAt || new Date() },
          { where: { id: r.id } },
        );
      } else if (evt.type === "failed") {
        await MonitoringScreenshotRequest.update(
          { status: r.status, error_reason: evt.code || null },
          { where: { id: r.id } },
        );
      }
    } catch (err) {
      console.error("screenshot audit update failed:", err.message);
    }

    if (!room || !io) return;
    if (evt.type === "delivered") {
      // Same-tick pass-through only: evt.imageBuffer is read here and handed
      // straight to socket.io's emit, never assigned anywhere that persists.
      io.to(room).emit("screenshot:ready", {
        requestId: r.id,
        image: evt.imageBuffer.toString("base64"),
        mimeType: evt.mimeType,
      });
    } else if (evt.type === "failed") {
      io.to(room).emit("screenshot:error", { requestId: r.id, code: evt.code });
    }
  });
}

function wireScreenshotSocket(socket) {
  const user = socket.user; // { id, organization_id, role } from verified JWT

  socket.on("screenshot:request", async ({ targetUserId } = {}, ack) => {
    const reply = typeof ack === "function" ? ack : () => {};
    const target = Number(targetUserId);
    try {
      const [orgSettings, grants, agent, consent] = await Promise.all([
        MonitoringOrgSetting.findOne({
          where: { organization_id: user.organization_id },
          attributes: ["organization_id", "live_screen_enabled"],
          raw: true,
        }),
        MonitoringContentGrant.findAll({
          where: { organization_id: user.organization_id, grantee_user_id: user.id },
          raw: true,
        }),
        Number.isInteger(target) && target > 0
          ? MonitoringAgent.findOne({
              where: {
                organization_id: user.organization_id,
                user_id: target,
                status: "active",
              },
              order: [["last_seen_at", "DESC"]],
            })
          : null,
        Number.isInteger(target) && target > 0
          ? MonitoringConsent.findOne({
              where: {
                user_id: target,
                document_version: LIVE_SCREEN_CONSENT_DOCUMENT_VERSION,
              },
              raw: true,
            })
          : null,
      ]);

      const decision = monitoringScreenshot.prepareViewerRequest({
        viewer: user,
        organizationId: user.organization_id,
        targetUserId: target,
        orgSettings,
        grants,
        agent,
        consent,
      });
      if (!decision.ok) return reply({ ok: false, code: decision.code });

      const id = crypto.randomUUID();
      await MonitoringScreenshotRequest.create({
        id,
        organization_id: user.organization_id,
        viewer_user_id: user.id,
        target_user_id: target,
        agent_id: agent.id,
        status: "requested",
        access_via: decision.accessVia,
        viewer_ip:
          (socket.handshake.headers["x-forwarded-for"] || "")
            .split(",")[0]
            .trim() ||
          socket.handshake.address ||
          null,
        requested_at: new Date(),
      });

      monitoringScreenshot.createRequest({
        id,
        organizationId: user.organization_id,
        viewer: user,
        targetUserId: target,
        agentId: agent.id,
        accessVia: decision.accessVia,
      });

      reply({ ok: true, requestId: id });
    } catch (err) {
      console.error("screenshot:request FAILED", {
        viewer: user && user.id,
        org: user && user.organization_id,
        target,
        name: err && err.name,
        db_code: err && err.original && err.original.code,
        sql: err && err.sql,
        message: err && err.message,
      });
      if (liveScreen.isSchemaError(err)) {
        return reply({
          ok: false,
          code: "not_ready",
          detail:
            "Screenshot database migrations have not been applied on this server. " +
            "Run: npx sequelize-cli db:migrate --env production",
        });
      }
      reply({ ok: false, code: "server_error" });
    }
  });
}

function getIO() {
  if (!io) {
    throw new Error("Socket.io not initialized. Call initSocket first.");
  }
  return io;
}

function emitTaskMessage(taskId, message) {
  if (!io) {
    console.error("Task message emit failed: Socket.IO is not initialized.");
    return false;
  }

  // Step 2D: Task Chat lives on its own room, separate from the general
  // `task:${taskId}` room used by comments/subtasks.
  io.to(`task-chat:${taskId}`).emit("message:new", message);
  return true;
}

// Step 2C-2 (retargeted in Step 2D): called right after a TaskMember row is
// removed (see removeTaskMember in controllers/taskMemberController.js) so
// an already-connected socket cannot keep receiving/sending Task Chat
// traffic for a task the user was just removed from. Only removes Task Chat
// room membership — the socket connection itself is never touched, the
// user's membership in the general `task:${taskId}` room is untouched, and
// every socket the user has open (multiple tabs/devices) is evicted, since
// they all sit in the same `task-chat:${taskId}` room independently.
async function evictUserFromTaskRoom(userId, taskId) {
  if (!io) return; // socket layer not running (e.g. tests, CLI scripts)

  try {
    const room = `task-chat:${taskId}`;
    const sockets = await io.in(room).fetchSockets();

    for (const socket of sockets) {
      if (socket.user && Number(socket.user.id) === Number(userId)) {
        socket.leave(room);
        socket.emit("task:membership-removed", { task_id: Number(taskId) });
      }
    }
  } catch (err) {
    console.error("evictUserFromTaskRoom failed:", err.message);
  }
}

// Organization Chat (Step 7) -- mirrors emitTaskMessage/evictUserFromTaskRoom
// exactly, but targets the separate conversation:<id> room and never touches
// task:<id>/task-chat:<id> or the organization:<id> Activity room.
function emitOrgChatMessage(conversationId, message) {
  if (!io) {
    console.error(
      "Organization chat message emit failed: Socket.IO is not initialized.",
    );
    return false;
  }

  io.to(`conversation:${conversationId}`).emit("orgchat:message:new", message);
  return true;
}

// Step 28: mirrors emitOrgChatMessage exactly -- same room, same
// never-throws safety guard -- but for an attachment uploaded against an
// already-created message (uploadOrgChatAttachment in
// organizationChatAttachmentController.js runs strictly after the message
// exists, so this always fires after orgchat:message:new for the same
// message). Never emitted from message creation itself.
function emitOrgChatAttachment(conversationId, messageId, attachment) {
  if (!io) {
    console.error(
      "Organization chat attachment emit failed: Socket.IO is not initialized.",
    );
    return false;
  }

  io.to(`conversation:${conversationId}`).emit("orgchat:attachment:new", {
    conversation_id: conversationId,
    message_id: messageId,
    attachment,
  });
  return true;
}

// Called right after a ConversationMember row is removed (see
// removeConversationMember in controllers/organizationChatController.js) so
// an already-connected socket cannot keep receiving/sending Organization
// Chat traffic for a conversation the user was just removed from. Every
// socket the user has open (multiple tabs/devices) is evicted, since they
// all sit in the same conversation:<id> room independently. Task Chat's
// task-chat:<id> room and eviction are entirely untouched by this.
async function evictUserFromConversationRoom(userId, conversationId) {
  if (!io) return; // socket layer not running (e.g. tests, CLI scripts)

  try {
    const room = `conversation:${conversationId}`;
    const sockets = await io.in(room).fetchSockets();

    for (const socket of sockets) {
      if (socket.user && Number(socket.user.id) === Number(userId)) {
        socket.leave(room);
        socket.emit("orgchat:conversation:membership-removed", {
          conversation_id: Number(conversationId),
        });
      }
    }
  } catch (err) {
    console.error("evictUserFromConversationRoom failed:", err.message);
  }
}

module.exports = {
  initSocket,
  getIO,
  emitTaskMessage,
  evictUserFromTaskRoom,
  emitOrgChatMessage,
  emitOrgChatAttachment,
  evictUserFromConversationRoom,
};
