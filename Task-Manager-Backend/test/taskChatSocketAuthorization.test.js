const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const jwt = require("jsonwebtoken");
const { io: ioClient } = require("socket.io-client");

require("dotenv").config();

const {
  Organization,
  OrganizationMember,
  Project,
  ProjectMember,
  Task,
  TaskMember,
  User,
} = require("../models");

const { initSocket, getIO } = require("../socket");
const { removeTaskMember } = require("../controllers/taskMemberController");
const { createMessage } = require("../controllers/taskChatController");

// This suite exercises the REAL Socket.IO server end-to-end (a real HTTP
// server + real socket.io-client connections, real room join/leave, real
// authorization functions) rather than mocking socket.on handlers -- room
// membership and cross-room isolation are exactly the things that must be
// proven against actual behavior, not a stand-in.

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

function mockReq({ params = {}, body = {}, user }) {
  return { params, body, user };
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

async function taskChatJoinAndExpect(client, taskId, expectAllowed) {
  const errorPromise = new Promise((resolve) => {
    const handler = (payload) => resolve(payload);
    client.once("task:chat:join:error", handler);
    setTimeout(() => {
      client.off("task:chat:join:error", handler);
      resolve(null);
    }, 300);
  });

  client.emit("task:chat:join", taskId);

  const room = `task-chat:${taskId}`;

  if (expectAllowed) {
    const inRoom = await waitUntil(() => isSocketInRoom(room, client.id));
    assert.ok(inRoom, "expected socket to be admitted to the task-chat room");
  } else {
    await errorPromise;
    await new Promise((r) => setTimeout(r, 150));
    const inRoom = await isSocketInRoom(room, client.id);
    assert.equal(inRoom, false, "expected socket to be rejected from the task-chat room");
  }
}

async function taskJoinAndExpect(client, taskId, expectAllowed) {
  const errorPromise = new Promise((resolve) => {
    const handler = (payload) => resolve(payload);
    client.once("task:join:error", handler);
    setTimeout(() => {
      client.off("task:join:error", handler);
      resolve(null);
    }, 300);
  });

  client.emit("task:join", taskId);

  const room = `task:${taskId}`;

  if (expectAllowed) {
    const inRoom = await waitUntil(() => isSocketInRoom(room, client.id));
    assert.ok(inRoom, "expected socket to be admitted to the general task room");
  } else {
    await errorPromise;
    await new Promise((r) => setTimeout(r, 150));
    const inRoom = await isSocketInRoom(room, client.id);
    assert.equal(inRoom, false, "expected socket to be rejected from the general task room");
  }
}

test("Task Chat / general task Socket.IO room separation — Step 2D", async (t) => {
  const suffix = Date.now();
  let httpServer;
  let port;

  let org, otherOrg;
  let taskMemberUser, nonMemberProjectUser, adminUser, creatorUser, assigneeUser;
  let prevAssigneeUser, removableUser, managerUser, otherOrgUser;
  let project, otherProject, task, otherTask;
  const openClients = [];

  t.after(async () => {
    for (const c of openClients) {
      try { c.disconnect(); } catch { /* ignore */ }
    }
    if (httpServer) {
      await new Promise((resolve) => httpServer.close(resolve));
    }

    if (task) await Task.destroy({ where: { id: task.id } });
    if (otherTask) await Task.destroy({ where: { id: otherTask.id } });
    if (project) await Project.destroy({ where: { id: project.id } });
    if (otherProject) await Project.destroy({ where: { id: otherProject.id } });
    if (org) await OrganizationMember.destroy({ where: { organization_id: org.id } });
    if (otherOrg) await OrganizationMember.destroy({ where: { organization_id: otherOrg.id } });
    const userIds = [
      taskMemberUser, nonMemberProjectUser, adminUser, creatorUser, assigneeUser,
      prevAssigneeUser, removableUser, managerUser, otherOrgUser,
    ].filter(Boolean).map((u) => u.id);
    if (userIds.length) await User.destroy({ where: { id: userIds } });
    if (org) await Organization.destroy({ where: { id: org.id } });
    if (otherOrg) await Organization.destroy({ where: { id: otherOrg.id } });
  });

  await t.test("fixtures + real Socket.IO server set up", async () => {
    org = await Organization.create({
      name: `TaskChatSocket2D Test Org ${suffix}`,
      slug: `taskchatsocket2d-test-org-${suffix}`,
    });
    otherOrg = await Organization.create({
      name: `TaskChatSocket2D Other Org ${suffix}`,
      slug: `taskchatsocket2d-other-org-${suffix}`,
    });

    async function makeUser(label) {
      return User.create({
        first_name: label,
        last_name: "Test",
        email: `${label.toLowerCase()}-${suffix}@example.test`,
      });
    }

    taskMemberUser = await makeUser("Sock2dTaskMember");
    nonMemberProjectUser = await makeUser("Sock2dNonMemberProj");
    adminUser = await makeUser("Sock2dAdmin");
    creatorUser = await makeUser("Sock2dCreator");
    assigneeUser = await makeUser("Sock2dAssignee");
    prevAssigneeUser = await makeUser("Sock2dPrevAssignee");
    removableUser = await makeUser("Sock2dRemovable");
    managerUser = await makeUser("Sock2dManager");
    otherOrgUser = await makeUser("Sock2dOtherOrgUser");

    await OrganizationMember.bulkCreate([
      { organization_id: org.id, user_id: taskMemberUser.id, role: "member", is_active: true },
      { organization_id: org.id, user_id: nonMemberProjectUser.id, role: "member", is_active: true },
      { organization_id: org.id, user_id: adminUser.id, role: "admin", is_active: true },
      { organization_id: org.id, user_id: creatorUser.id, role: "member", is_active: true },
      { organization_id: org.id, user_id: assigneeUser.id, role: "member", is_active: true },
      { organization_id: org.id, user_id: prevAssigneeUser.id, role: "member", is_active: true },
      { organization_id: org.id, user_id: removableUser.id, role: "member", is_active: true },
      { organization_id: org.id, user_id: managerUser.id, role: "member", is_active: true },
      { organization_id: otherOrg.id, user_id: otherOrgUser.id, role: "member", is_active: true },
    ]);

    project = await Project.create({
      organization_id: org.id,
      created_by: creatorUser.id,
      name: `TaskChatSocket2D Test Project ${suffix}`,
      status: "planned",
      priority: "medium",
    });
    otherProject = await Project.create({
      organization_id: org.id,
      created_by: creatorUser.id,
      name: `TaskChatSocket2D Other Project ${suffix}`,
      status: "planned",
      priority: "medium",
    });

    await ProjectMember.bulkCreate([
      { project_id: project.id, user_id: creatorUser.id, role: "member" },
      { project_id: project.id, user_id: assigneeUser.id, role: "member" },
      { project_id: project.id, user_id: nonMemberProjectUser.id, role: "member" },
      { project_id: project.id, user_id: managerUser.id, role: "manager" },
      // Also a project member, so the general task:join (broad rule) test
      // below can put them in task:${taskId} before their TaskMember row
      // (task-chat-only) is removed.
      { project_id: project.id, user_id: removableUser.id, role: "member" },
    ]);

    task = await Task.create({
      organization_id: org.id,
      project_id: project.id,
      title: `Socket room-split task ${suffix}`,
      created_by: creatorUser.id,
      assigned_to: assigneeUser.id,
    });
    otherTask = await Task.create({
      organization_id: org.id,
      project_id: otherProject.id,
      title: `Socket room-split other-project task ${suffix}`,
      created_by: creatorUser.id,
    });

    // taskMemberUser, prevAssigneeUser and removableUser are TaskMembers of
    // `task`. creatorUser and assigneeUser deliberately are NOT (regression
    // guard for the "creator/assignee must not bypass" rule).
    await TaskMember.bulkCreate([
      { task_id: task.id, user_id: taskMemberUser.id, added_by: creatorUser.id },
      { task_id: task.id, user_id: prevAssigneeUser.id, added_by: creatorUser.id },
      { task_id: task.id, user_id: removableUser.id, added_by: creatorUser.id },
    ]);

    httpServer = http.createServer();
    initSocket(httpServer);
    await new Promise((resolve) => httpServer.listen(0, resolve));
    port = httpServer.address().port;

    assert.ok(port > 0, "test socket.io server is listening");
  });

  // ── Task Chat room (task-chat:<id>) — TaskMember-only ─────────────────────

  await t.test("A: TaskMember can task:chat:join", async () => {
    const client = await connectClient(port, tokenFor(taskMemberUser.id, org.id, "member"));
    openClients.push(client);
    await taskChatJoinAndExpect(client, task.id, true);
  });

  await t.test("B: non-member project member cannot task:chat:join", async () => {
    const client = await connectClient(port, tokenFor(nonMemberProjectUser.id, org.id, "member"));
    openClients.push(client);
    await taskChatJoinAndExpect(client, task.id, false);
  });

  await t.test("C: org admin who is NOT TaskMember cannot task:chat:join", async () => {
    const client = await connectClient(port, tokenFor(adminUser.id, org.id, "admin"));
    openClients.push(client);
    await taskChatJoinAndExpect(client, task.id, false);
  });

  await t.test("D: task creator who is NOT TaskMember cannot task:chat:join", async () => {
    const client = await connectClient(port, tokenFor(creatorUser.id, org.id, "member"));
    openClients.push(client);
    await taskChatJoinAndExpect(client, task.id, false);
  });

  await t.test("E: current assignee who is NOT TaskMember cannot task:chat:join", async () => {
    const client = await connectClient(port, tokenFor(assigneeUser.id, org.id, "member"));
    openClients.push(client);
    await taskChatJoinAndExpect(client, task.id, false);
  });

  await t.test("F: previous assignee who remains TaskMember can task:chat:join", async () => {
    const client = await connectClient(port, tokenFor(prevAssigneeUser.id, org.id, "member"));
    openClients.push(client);
    await taskChatJoinAndExpect(client, task.id, true);
  });

  await t.test("H: TaskMember of Task A cannot task:chat:join Task B in the same project/org", async () => {
    const client = await connectClient(port, tokenFor(taskMemberUser.id, org.id, "member"));
    openClients.push(client);
    await taskChatJoinAndExpect(client, otherTask.id, false);
  });

  await t.test("I: cross-organization user cannot task:chat:join", async () => {
    const client = await connectClient(port, tokenFor(otherOrgUser.id, otherOrg.id, "member"));
    openClients.push(client);
    await taskChatJoinAndExpect(client, task.id, false);
  });

  await t.test(
    "G+J+K+L+M+N: removal evicts all task-chat sockets, blocks rejoin, spares bystander, keeps connection + general room intact",
    async () => {
      const deviceA = await connectClient(port, tokenFor(removableUser.id, org.id, "member"));
      const deviceB = await connectClient(port, tokenFor(removableUser.id, org.id, "member"));
      openClients.push(deviceA, deviceB);

      const bystander = await connectClient(port, tokenFor(taskMemberUser.id, org.id, "member"));
      openClients.push(bystander);

      // removableUser IS currently a TaskMember -- both devices can join
      // Task Chat, and (as a project member) the general task room too.
      await taskChatJoinAndExpect(deviceA, task.id, true);
      await taskChatJoinAndExpect(deviceB, task.id, true);
      await taskChatJoinAndExpect(bystander, task.id, true);

      // N (setup): also put deviceA in the GENERAL task room, to prove
      // removal from Task Chat does not touch it.
      await taskJoinAndExpect(deviceA, task.id, true);

      const removedEventA = new Promise((resolve) => {
        deviceA.once("task:membership-removed", resolve);
      });
      const removedEventB = new Promise((resolve) => {
        deviceB.once("task:membership-removed", resolve);
      });

      // An authorized manager removes removableUser's TaskMember row via the
      // real controller -- this is what triggers evictUserFromTaskRoom.
      const req = mockReq({
        params: { projectId: project.id, taskId: task.id, userId: removableUser.id },
        user: { id: managerUser.id, organization_id: org.id, role: "member" },
      });
      const res = mockRes();
      await removeTaskMember(req, res);
      assert.equal(res.statusCode, 200, JSON.stringify(res.body));

      // J: both of removableUser's sockets are evicted from task-chat...
      const [payloadA, payloadB] = await Promise.all([removedEventA, removedEventB]);
      assert.equal(payloadA.task_id, Number(task.id));
      assert.equal(payloadB.task_id, Number(task.id));

      const chatRoom = `task-chat:${task.id}`;
      const generalRoom = `task:${task.id}`;

      assert.equal(await isSocketInRoom(chatRoom, deviceA.id), false, "device A must be evicted from task-chat");
      assert.equal(await isSocketInRoom(chatRoom, deviceB.id), false, "device B must be evicted from task-chat");

      // K: neither connection was disconnected, only removed from the room.
      assert.equal(deviceA.connected, true, "device A socket connection must remain open");
      assert.equal(deviceB.connected, true, "device B socket connection must remain open");

      // N: deviceA's GENERAL task room membership is untouched by chat removal.
      assert.equal(
        await isSocketInRoom(generalRoom, deviceA.id),
        true,
        "removing a TaskMember must NOT evict the user from the general task room",
      );

      // M: an unrelated TaskMember's task-chat socket is untouched.
      assert.equal(
        await isSocketInRoom(chatRoom, bystander.id),
        true,
        "other TaskMembers must remain in the task-chat room",
      );

      // L: attempting to rejoin task-chat after removal is rejected (re-checked live).
      await taskChatJoinAndExpect(deviceA, task.id, false);
    },
  );

  // ── General task room (task:<id>) — broad rule, unaffected by Task Chat ──

  await t.test("O: general task:join still works under the old broad canAccessTaskChat rule", async () => {
    // nonMemberProjectUser is a plain ProjectMember, NOT a TaskMember -- they
    // were rejected from Task Chat in test B, but must be ALLOWED into the
    // general task room (comments/subtasks), since that rule was restored.
    const client = await connectClient(port, tokenFor(nonMemberProjectUser.id, org.id, "member"));
    openClients.push(client);
    await taskJoinAndExpect(client, task.id, true);
  });

  await t.test("P: general task:<id> room still delivers comment/subtask-style events", async () => {
    const client = await connectClient(port, tokenFor(creatorUser.id, org.id, "member"));
    openClients.push(client);
    // creatorUser is the task creator -- allowed into the general room under
    // canAccessTaskChat even though (per test D) they are NOT a TaskMember.
    await taskJoinAndExpect(client, task.id, true);

    const received = new Promise((resolve) => client.once("subtask:created", resolve));

    // Simulate exactly what subtaskController.js does on subtask creation:
    // getIO().to(`task:${taskId}`).emit("subtask:created", full). We call
    // the same room/event directly rather than driving the full subtask
    // creation flow, since this test is about room routing, not subtask
    // business logic (subtaskController.js is out of scope for this step
    // and was independently confirmed by audit to target this exact room).
    getIO().to(`task:${task.id}`).emit("subtask:created", { id: 999999, title: "probe" });

    const payload = await received;
    assert.equal(payload.title, "probe");
  });

  await t.test("Q+R: message:new goes to task-chat:<id> only, never to task:<id>", async () => {
    const chatMember = await connectClient(port, tokenFor(taskMemberUser.id, org.id, "member"));
    const generalOnly = await connectClient(port, tokenFor(nonMemberProjectUser.id, org.id, "member"));
    openClients.push(chatMember, generalOnly);

    await taskChatJoinAndExpect(chatMember, task.id, true);
    // generalOnly is deliberately only in the GENERAL room, never task-chat.
    await taskJoinAndExpect(generalOnly, task.id, true);

    let generalOnlyReceivedMessage = false;
    generalOnly.once("message:new", () => {
      generalOnlyReceivedMessage = true;
    });

    const chatMemberReceived = new Promise((resolve) => {
      chatMember.once("message:new", resolve);
    });

    const req = mockReq({
      params: { projectId: project.id, taskId: task.id },
      body: { body: "Room-separation probe message." },
      user: { id: taskMemberUser.id, organization_id: org.id, role: "member" },
    });
    const res = mockRes();
    await createMessage(req, res);
    assert.equal(res.statusCode, 201, JSON.stringify(res.body));

    // Q: the TaskMember in task-chat:<id> receives it.
    const message = await chatMemberReceived;
    assert.equal(message.body, "Room-separation probe message.");

    // R: give the general-room-only socket a moment, then confirm it never
    // received message:new -- it is only in task:<id>, not task-chat:<id>.
    await new Promise((r) => setTimeout(r, 200));
    assert.equal(
      generalOnlyReceivedMessage,
      false,
      "a socket only in the general task room must not receive message:new",
    );

    const { TaskMessage } = require("../models");
    await TaskMessage.destroy({ where: { id: res.body.message.id } });
  });
});
