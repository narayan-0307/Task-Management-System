const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const path = require("node:path");
const fs = require("node:fs");
const jwt = require("jsonwebtoken");
const { io: ioClient } = require("socket.io-client");

require("dotenv").config();

const {
  Organization,
  OrganizationMember,
  User,
  Conversation,
  ConversationMember,
  Message,
  Attachment,
} = require("../models");

const { initSocket, getIO } = require("../socket");
const { ensureOrganizationChat } = require("../services/organizationChatProvisioning");
const { createActivity } = require("../utils/activity");
const {
  createMessage,
} = require("../controllers/organizationMessageController");
const {
  removeConversationMember,
} = require("../controllers/organizationChatController");
const {
  uploadOrgChatAttachment,
} = require("../controllers/organizationChatAttachmentController");

const UPLOAD_DIR = path.join(__dirname, "../uploads");

// Mirrors organizationChatAttachment.test.js's fakeUploadedFile -- a fake
// multer `req.file`, so this suite can call uploadOrgChatAttachment()
// directly (same pattern this file already uses for createMessage()) rather
// than exercising multer/HTTP for a socket-emission test.
function fakeUploadedFile(name = "step28-note.txt") {
  const filename = `${Date.now()}-${Math.round(Math.random() * 1e9)}${path.extname(name)}`;
  const filePath = path.join(UPLOAD_DIR, filename);
  fs.writeFileSync(filePath, "step 28 realtime attachment test contents");
  return {
    originalname: name,
    filename,
    size: fs.statSync(filePath).size,
    mimetype: "text/plain",
  };
}

// Same real-Socket.IO end-to-end pattern as
// test/taskChatSocketAuthorization.test.js: a real HTTP server, real
// socket.io-client connections, real room join/leave, real authorization
// functions -- room membership and cross-room isolation are exactly the
// things that must be proven against actual behavior.

function mockRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

function mockReq({ params = {}, body = {}, user, file }) {
  return { params, body, user, file };
}

function tokenFor(userId, organizationId, role) {
  return jwt.sign(
    { id: userId, organization_id: organizationId, role },
    process.env.JWT_SECRET,
    { expiresIn: "1h" },
  );
}

function connectClient(port, token) {
  return new Promise((resolve, reject) => {
    const socket = ioClient(`http://127.0.0.1:${port}`, {
      auth: { token },
      transports: ["websocket"],
      forceNew: true,
      reconnection: false,
    });
    socket.once("connect", () => resolve(socket));
    socket.once("connect_error", (err) => reject(err));
  });
}

async function waitUntil(conditionFn, { timeout = 2000, interval = 40 } = {}) {
  const start = Date.now();
  for (;;) {
    if (await conditionFn()) return true;
    if (Date.now() - start >= timeout) return false;
    await new Promise((r) => setTimeout(r, interval));
  }
}

async function isSocketInRoom(room, socketId) {
  const sockets = await getIO().in(room).fetchSockets();
  return sockets.some((s) => s.id === socketId);
}

async function orgChatJoinAndExpect(client, conversationId, expectAllowed) {
  const errorPromise = new Promise((resolve) => {
    const handler = (payload) => resolve(payload);
    client.once("orgchat:conversation:join:error", handler);
    setTimeout(() => {
      client.off("orgchat:conversation:join:error", handler);
      resolve(null);
    }, 300);
  });

  client.emit("orgchat:conversation:join", { conversationId });

  const room = `conversation:${conversationId}`;

  if (expectAllowed) {
    const inRoom = await waitUntil(() => isSocketInRoom(room, client.id));
    assert.ok(inRoom, "expected socket to be admitted to the conversation room");
  } else {
    await errorPromise;
    await new Promise((r) => setTimeout(r, 150));
    const inRoom = await isSocketInRoom(room, client.id);
    assert.equal(inRoom, false, "expected socket to be rejected from the conversation room");
  }
}

test("Organization Chat Socket.IO realtime messaging — Step 7", async (t) => {
  const suffix = Date.now();
  let httpServer;
  let port;

  let org, otherOrg;
  let alice, bob, carol, dave, erin, frank;
  let groupConversation, secondGroupConversation, orgWideConversation, otherOrgConversation;
  const openClients = [];
  const createdConversationIds = [];

  t.after(async () => {
    for (const c of openClients) {
      try { c.disconnect(); } catch { /* ignore */ }
    }
    if (httpServer) {
      await new Promise((resolve) => httpServer.close(resolve));
    }

    if (createdConversationIds.length) {
      await Message.destroy({ where: { conversation_id: createdConversationIds } });
      await ConversationMember.destroy({ where: { conversation_id: createdConversationIds } });
      await Conversation.destroy({ where: { id: createdConversationIds } });
    }
    if (org) await OrganizationMember.destroy({ where: { organization_id: org.id } });
    if (otherOrg) await OrganizationMember.destroy({ where: { organization_id: otherOrg.id } });
    const userIds = [alice, bob, carol, dave, erin, frank]
      .filter(Boolean)
      .map((u) => u.id);
    if (userIds.length) await User.destroy({ where: { id: userIds } });
    if (org) await Organization.destroy({ where: { id: org.id } });
    if (otherOrg) await Organization.destroy({ where: { id: otherOrg.id } });
  });

  await t.test("fixtures + real Socket.IO server set up", async () => {
    org = await Organization.create({
      name: `OrgChatSocket Test Org ${suffix}`,
      slug: `orgchatsocket-test-org-${suffix}`,
    });
    otherOrg = await Organization.create({
      name: `OrgChatSocket Other Org ${suffix}`,
      slug: `orgchatsocket-other-org-${suffix}`,
    });

    async function makeUser(label) {
      return User.create({
        first_name: label,
        last_name: "Test",
        email: `${label.toLowerCase()}-${suffix}@example.test`,
      });
    }

    alice = await makeUser("SockAlice");
    bob = await makeUser("SockBob");
    carol = await makeUser("SockCarol");
    dave = await makeUser("SockDave");
    erin = await makeUser("SockErin");
    frank = await makeUser("SockFrank");

    await OrganizationMember.bulkCreate([
      { organization_id: org.id, user_id: alice.id, role: "owner", is_active: true },
      { organization_id: org.id, user_id: bob.id, role: "member", is_active: true },
      { organization_id: org.id, user_id: carol.id, role: "member", is_active: true },
      { organization_id: org.id, user_id: dave.id, role: "member", is_active: false },
      { organization_id: org.id, user_id: frank.id, role: "member", is_active: true },
      { organization_id: otherOrg.id, user_id: erin.id, role: "member", is_active: true },
    ]);

    // A group conversation: alice + bob only (carol deliberately excluded).
    groupConversation = await Conversation.create({
      organization_id: org.id,
      type: "group",
      name: "Sock Dev Team",
      created_by: alice.id,
    });
    createdConversationIds.push(groupConversation.id);
    await ConversationMember.bulkCreate([
      { conversation_id: groupConversation.id, user_id: alice.id },
      { conversation_id: groupConversation.id, user_id: bob.id },
    ]);

    // A second group conversation, for the "no leak to another conversation"
    // test -- alice + bob again, but a DIFFERENT conversation id/room.
    secondGroupConversation = await Conversation.create({
      organization_id: org.id,
      type: "group",
      name: "Sock Other Team",
      created_by: alice.id,
    });
    createdConversationIds.push(secondGroupConversation.id);
    await ConversationMember.bulkCreate([
      { conversation_id: secondGroupConversation.id, user_id: alice.id },
      { conversation_id: secondGroupConversation.id, user_id: bob.id },
    ]);

    // org_wide HumanCare Team, provisioned via the real Step 5/6 service --
    // auto-adds alice, bob, carol, frank (active) as ConversationMembers.
    orgWideConversation = await ensureOrganizationChat(org.id);
    createdConversationIds.push(orgWideConversation.id);

    // Simulate "active org member, no ConversationMember row" for carol on
    // the org_wide conversation specifically (test 7) -- ensureOrganizationChat
    // would otherwise always keep her a member since she's active.
    await ConversationMember.destroy({
      where: { conversation_id: orgWideConversation.id, user_id: carol.id },
    });

    // otherOrg's own group conversation, for the cross-org leak test.
    otherOrgConversation = await Conversation.create({
      organization_id: otherOrg.id,
      type: "group",
      name: "Other Org Team",
      created_by: erin.id,
    });
    createdConversationIds.push(otherOrgConversation.id);
    await ConversationMember.create({
      conversation_id: otherOrgConversation.id,
      user_id: erin.id,
    });

    httpServer = http.createServer();
    initSocket(httpServer);
    await new Promise((resolve) => httpServer.listen(0, resolve));
    port = httpServer.address().port;

    assert.ok(port > 0, "test socket.io server is listening");
  });

  // ── AUTHORIZATION ──────────────────────────────────────────────────────

  await t.test("1: unauthenticated socket cannot join conversation", async () => {
    await assert.rejects(() => connectClient(port, undefined));
  });

  await t.test("2: inactive organization member cannot join", async () => {
    const client = await connectClient(port, tokenFor(dave.id, org.id, "member"));
    openClients.push(client);
    await orgChatJoinAndExpect(client, groupConversation.id, false);
  });

  await t.test("3: user from another organization cannot join", async () => {
    const client = await connectClient(port, tokenFor(erin.id, otherOrg.id, "member"));
    openClients.push(client);
    await orgChatJoinAndExpect(client, groupConversation.id, false);
  });

  await t.test("4: organization member who is not a ConversationMember cannot join", async () => {
    const client = await connectClient(port, tokenFor(carol.id, org.id, "member"));
    openClients.push(client);
    await orgChatJoinAndExpect(client, groupConversation.id, false);
  });

  await t.test("5: ConversationMember can join own conversation", async () => {
    const client = await connectClient(port, tokenFor(bob.id, org.id, "member"));
    openClients.push(client);
    await orgChatJoinAndExpect(client, groupConversation.id, true);
  });

  await t.test("6: org_wide ConversationMember can join HumanCare Team", async () => {
    const client = await connectClient(port, tokenFor(bob.id, org.id, "member"));
    openClients.push(client);
    await orgChatJoinAndExpect(client, orgWideConversation.id, true);
  });

  await t.test("7: org_wide organization member without ConversationMember row cannot join", async () => {
    const client = await connectClient(port, tokenFor(carol.id, org.id, "member"));
    openClients.push(client);
    await orgChatJoinAndExpect(client, orgWideConversation.id, false);
  });

  // ── ROOM ISOLATION ──────────────────────────────────────────────────────

  await t.test("8+10+11: uses conversation:<id>, never task:<id> or task-chat:<id>", async () => {
    const client = await connectClient(port, tokenFor(bob.id, org.id, "member"));
    openClients.push(client);
    await orgChatJoinAndExpect(client, groupConversation.id, true);

    // 8
    assert.equal(
      await isSocketInRoom(`conversation:${groupConversation.id}`, client.id),
      true,
    );
    // 10+11: bob never called task:join/task:chat:join, so he must not be a
    // member of either Task Chat room namespace as a side effect of orgchat.
    assert.equal(await isSocketInRoom("task:999999999", client.id), false);
    assert.equal(await isSocketInRoom("task-chat:999999999", client.id), false);
  });

  await t.test("9: organization chat message does not go to organization:<orgId>", async () => {
    // Every connected socket auto-joins organization:<orgId> (the Activity
    // room) regardless of Organization Chat. Prove that org-chat messages
    // are routed ONLY to conversation:<id>, not (also) broadcast there.
    const client = await connectClient(port, tokenFor(carol.id, org.id, "member"));
    openClients.push(client);
    // carol never joins any conversation room, but IS in organization:<orgId>.
    assert.equal(
      await isSocketInRoom(`organization:${org.id}`, client.id),
      true,
      "sanity check: every socket auto-joins the org activity room",
    );

    let received = false;
    client.once("orgchat:message:new", () => { received = true; });

    const req = mockReq({
      params: { conversationId: groupConversation.id },
      body: { body: "Room isolation probe." },
      user: { id: alice.id, organization_id: org.id, role: "owner" },
    });
    const res = mockRes();
    await createMessage(req, res);
    assert.equal(res.statusCode, 201, JSON.stringify(res.body));
    await Message.destroy({ where: { id: res.body.message.id } });

    await new Promise((r) => setTimeout(r, 200));
    assert.equal(
      received,
      false,
      "a socket only in organization:<orgId> must not receive orgchat:message:new",
    );
  });

  // ── MESSAGE DELIVERY ────────────────────────────────────────────────────

  await t.test("12+13+16: REST-created message emits orgchat:message:new to conversation members with the safe REST shape", async () => {
    const client = await connectClient(port, tokenFor(bob.id, org.id, "member"));
    openClients.push(client);
    await orgChatJoinAndExpect(client, groupConversation.id, true);

    const received = new Promise((resolve) => {
      client.once("orgchat:message:new", resolve);
    });

    const req = mockReq({
      params: { conversationId: groupConversation.id },
      body: { body: "Hello via socket." },
      user: { id: alice.id, organization_id: org.id, role: "owner" },
    });
    const res = mockRes();
    await createMessage(req, res);
    assert.equal(res.statusCode, 201, JSON.stringify(res.body));

    const socketPayload = await received;
    const restMessage = res.body.message;

    // 16: same safe shape as REST.
    assert.equal(socketPayload.id, restMessage.id);
    assert.equal(socketPayload.conversation_id, restMessage.conversation_id);
    assert.equal(socketPayload.organization_id, restMessage.organization_id);
    assert.equal(socketPayload.sender_id, restMessage.sender_id);
    assert.equal(socketPayload.body, restMessage.body);
    assert.equal(
      new Date(socketPayload.created_at).getTime(),
      new Date(restMessage.created_at).getTime(),
    );
    assert.equal(
      new Date(socketPayload.updated_at).getTime(),
      new Date(restMessage.updated_at).getTime(),
    );
    assert.equal(socketPayload.sender.id, alice.id);
    assert.equal(socketPayload.sender.email, alice.email);
    assert.ok("first_name" in socketPayload.sender);
    assert.ok("avatar_url" in socketPayload.sender);
    assert.ok("job_title" in socketPayload.sender);

    // No unsafe fields must ever be present.
    assert.equal(socketPayload.sender.password_hash, undefined);
    assert.equal(socketPayload.sender.password, undefined);

    await Message.destroy({ where: { id: restMessage.id } });
  });

  await t.test("14: message event does not leak to another conversation", async () => {
    const client = await connectClient(port, tokenFor(bob.id, org.id, "member"));
    openClients.push(client);
    // bob joins ONLY groupConversation, not secondGroupConversation.
    await orgChatJoinAndExpect(client, groupConversation.id, true);

    let received = false;
    client.once("orgchat:message:new", () => { received = true; });

    const req = mockReq({
      params: { conversationId: secondGroupConversation.id },
      body: { body: "Should not leak to the other conversation." },
      user: { id: alice.id, organization_id: org.id, role: "owner" },
    });
    const res = mockRes();
    await createMessage(req, res);
    assert.equal(res.statusCode, 201, JSON.stringify(res.body));
    await Message.destroy({ where: { id: res.body.message.id } });

    await new Promise((r) => setTimeout(r, 200));
    assert.equal(received, false, "message for a different conversation must not leak");
  });

  await t.test("15: message event does not leak across organizations", async () => {
    const otherOrgClient = await connectClient(port, tokenFor(erin.id, otherOrg.id, "member"));
    openClients.push(otherOrgClient);
    await orgChatJoinAndExpect(otherOrgClient, otherOrgConversation.id, true);

    let received = false;
    otherOrgClient.once("orgchat:message:new", () => { received = true; });

    const req = mockReq({
      params: { conversationId: groupConversation.id },
      body: { body: "Should not cross organization boundaries." },
      user: { id: alice.id, organization_id: org.id, role: "owner" },
    });
    const res = mockRes();
    await createMessage(req, res);
    assert.equal(res.statusCode, 201, JSON.stringify(res.body));
    await Message.destroy({ where: { id: res.body.message.id } });

    await new Promise((r) => setTimeout(r, 200));
    assert.equal(received, false, "message must not leak to another organization's conversation");
  });

  await t.test("17: failed message creation emits no event", async () => {
    const client = await connectClient(port, tokenFor(bob.id, org.id, "member"));
    openClients.push(client);
    await orgChatJoinAndExpect(client, groupConversation.id, true);

    let received = false;
    client.once("orgchat:message:new", () => { received = true; });

    const req = mockReq({
      params: { conversationId: groupConversation.id },
      body: { body: "   " }, // whitespace-only -> rejected
      user: { id: alice.id, organization_id: org.id, role: "owner" },
    });
    const res = mockRes();
    await createMessage(req, res);
    assert.equal(res.statusCode, 400, JSON.stringify(res.body));

    await new Promise((r) => setTimeout(r, 200));
    assert.equal(received, false, "a failed message creation must not emit an event");
  });

  // ── ATTACHMENT DELIVERY (Step 28) ───────────────────────────────────────

  await t.test("23: attachment upload emits orgchat:attachment:new to conversation members with the safe REST shape", async () => {
    const client = await connectClient(port, tokenFor(bob.id, org.id, "member"));
    openClients.push(client);
    await orgChatJoinAndExpect(client, groupConversation.id, true);

    const msgReq = mockReq({
      params: { conversationId: groupConversation.id },
      body: { body: "Message for an attachment." },
      user: { id: alice.id, organization_id: org.id, role: "owner" },
    });
    const msgRes = mockRes();
    await createMessage(msgReq, msgRes);
    assert.equal(msgRes.statusCode, 201, JSON.stringify(msgRes.body));
    const messageId = msgRes.body.message.id;

    const received = new Promise((resolve) => {
      client.once("orgchat:attachment:new", resolve);
    });

    const uploadReq = mockReq({
      params: { conversationId: groupConversation.id, messageId },
      user: { id: alice.id, organization_id: org.id, role: "owner" },
      file: fakeUploadedFile(),
    });
    const uploadRes = mockRes();
    await uploadOrgChatAttachment(uploadReq, uploadRes);
    assert.equal(uploadRes.statusCode, 201, JSON.stringify(uploadRes.body));
    const restAttachment = uploadRes.body.attachment;

    const socketPayload = await received;

    // Same envelope the frontend hook/Chat.jsx expect: conversation_id +
    // message_id alongside the attachment, using the exact REST-response
    // serialization (no second serialization format).
    assert.equal(socketPayload.conversation_id, Number(groupConversation.id));
    assert.equal(socketPayload.message_id, Number(messageId));

    // Same safe shape as REST (mirrors the message test's field-by-field
    // comparison above -- created_at round-trips through JSON as a string
    // over the socket, unlike the in-memory REST response object).
    assert.equal(socketPayload.attachment.id, restAttachment.id);
    assert.equal(socketPayload.attachment.file_name, restAttachment.file_name);
    assert.equal(socketPayload.attachment.file_size, restAttachment.file_size);
    assert.equal(socketPayload.attachment.mime_type, restAttachment.mime_type);
    assert.equal(socketPayload.attachment.uploaded_by, restAttachment.uploaded_by);
    assert.equal(socketPayload.attachment.url, restAttachment.url);
    assert.equal(
      new Date(socketPayload.attachment.created_at).getTime(),
      new Date(restAttachment.created_at).getTime(),
    );
    assert.ok(!("file_path" in socketPayload.attachment));

    await Attachment.destroy({ where: { id: restAttachment.id } });
    await Message.destroy({ where: { id: messageId } });
    fs.unlinkSync(path.join(UPLOAD_DIR, uploadReq.file.filename));
  });

  await t.test("24: attachment event does not leak to another conversation", async () => {
    const client = await connectClient(port, tokenFor(bob.id, org.id, "member"));
    openClients.push(client);
    // bob joins ONLY groupConversation, not secondGroupConversation.
    await orgChatJoinAndExpect(client, groupConversation.id, true);

    const msgReq = mockReq({
      params: { conversationId: secondGroupConversation.id },
      body: { body: "Message in the other conversation." },
      user: { id: alice.id, organization_id: org.id, role: "owner" },
    });
    const msgRes = mockRes();
    await createMessage(msgReq, msgRes);
    assert.equal(msgRes.statusCode, 201, JSON.stringify(msgRes.body));
    const messageId = msgRes.body.message.id;

    let received = false;
    client.once("orgchat:attachment:new", () => { received = true; });

    const uploadReq = mockReq({
      params: { conversationId: secondGroupConversation.id, messageId },
      user: { id: alice.id, organization_id: org.id, role: "owner" },
      file: fakeUploadedFile(),
    });
    const uploadRes = mockRes();
    await uploadOrgChatAttachment(uploadReq, uploadRes);
    assert.equal(uploadRes.statusCode, 201, JSON.stringify(uploadRes.body));

    await new Promise((r) => setTimeout(r, 200));
    assert.equal(received, false, "attachment for a different conversation must not leak");

    await Attachment.destroy({ where: { id: uploadRes.body.attachment.id } });
    await Message.destroy({ where: { id: messageId } });
    fs.unlinkSync(path.join(UPLOAD_DIR, uploadReq.file.filename));
  });

  // ── MEMBERSHIP REMOVAL ──────────────────────────────────────────────────

  await t.test("18+19+20: removing a member evicts their socket and blocks further delivery, bystanders unaffected", async () => {
    // A dedicated conversation for this test so eviction doesn't disturb
    // earlier/later tests' membership.
    const removalConversation = await Conversation.create({
      organization_id: org.id,
      type: "group",
      name: "Sock Removal Team",
      created_by: alice.id,
    });
    createdConversationIds.push(removalConversation.id);
    await ConversationMember.bulkCreate([
      { conversation_id: removalConversation.id, user_id: alice.id },
      { conversation_id: removalConversation.id, user_id: bob.id },
      { conversation_id: removalConversation.id, user_id: frank.id },
    ]);

    const bobClient = await connectClient(port, tokenFor(bob.id, org.id, "member"));
    const frankClient = await connectClient(port, tokenFor(frank.id, org.id, "member"));
    openClients.push(bobClient, frankClient);

    await orgChatJoinAndExpect(bobClient, removalConversation.id, true);
    await orgChatJoinAndExpect(frankClient, removalConversation.id, true);

    const removedEvent = new Promise((resolve) => {
      bobClient.once("orgchat:conversation:membership-removed", resolve);
    });

    const req = mockReq({
      params: { conversationId: removalConversation.id, userId: bob.id },
      user: { id: alice.id, organization_id: org.id, role: "owner" },
    });
    const res = mockRes();
    await removeConversationMember(req, res);
    assert.equal(res.statusCode, 200, JSON.stringify(res.body));

    // 18: bob's socket is evicted from the room and notified.
    const payload = await removedEvent;
    assert.equal(payload.conversation_id, Number(removalConversation.id));
    assert.equal(
      await isSocketInRoom(`conversation:${removalConversation.id}`, bobClient.id),
      false,
      "removed member must be evicted from the conversation room",
    );
    assert.equal(bobClient.connected, true, "the socket connection itself must remain open");

    // 19+20: alice sends another message -- bob must not receive it, frank must.
    let bobReceived = false;
    bobClient.once("orgchat:message:new", () => { bobReceived = true; });
    const frankReceived = new Promise((resolve) => {
      frankClient.once("orgchat:message:new", resolve);
    });

    const msgReq = mockReq({
      params: { conversationId: removalConversation.id },
      body: { body: "After removal." },
      user: { id: alice.id, organization_id: org.id, role: "owner" },
    });
    const msgRes = mockRes();
    await createMessage(msgReq, msgRes);
    assert.equal(msgRes.statusCode, 201, JSON.stringify(msgRes.body));

    const frankPayload = await frankReceived;
    assert.equal(frankPayload.body, "After removal.");

    await new Promise((r) => setTimeout(r, 200));
    assert.equal(bobReceived, false, "evicted member must not receive further messages via the room");

    await Message.destroy({ where: { id: msgRes.body.message.id } });
  });

  // ── REGRESSION: organization:<id> Activity behavior ─────────────────────

  await t.test("22: existing organization:<id> Activity socket behavior still works", async () => {
    const client = await connectClient(port, tokenFor(alice.id, org.id, "owner"));
    openClients.push(client);

    const received = new Promise((resolve) => {
      client.once("activity:new", resolve);
    });

    const activity = await createActivity({
      organization_id: org.id,
      user_id: alice.id,
      entity_type: "project",
      action: "created",
      description: "Socket regression probe activity",
    });
    assert.ok(activity && activity.id, "activity row created");

    const payload = await received;
    assert.equal(payload.description, "Socket regression probe activity");

    const { Activity } = require("../models");
    await Activity.destroy({ where: { id: activity.id } });
  });
});
