const test = require("node:test");
const assert = require("node:assert/strict");

const {
  Organization,
  OrganizationMember,
  Project,
  ProjectMember,
  Task,
  TaskMember,
  TaskMessage,
  User,
} = require("../models");

const { getMessages, createMessage } = require("../controllers/taskChatController");

// Minimal req/res doubles -- the controllers only touch params/body/user and
// res.status().json(), so a full Express app is unnecessary for this suite.
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

test("Task Chat REST authorization — Step 2C-1 (TaskMember-only)", async (t) => {
  const suffix = Date.now();

  let org, otherOrg;
  let owner, admin, creator, assignee, previousAssignee, taskMemberUser;
  let nonMemberProjectUser, outsiderOrgMember, otherOrgUser;
  let project, otherProject, task;

  t.after(async () => {
    if (task) await Task.destroy({ where: { id: task.id } }); // cascades TaskMember + TaskMessage
    if (project) await Project.destroy({ where: { id: project.id } });
    if (otherProject) await Project.destroy({ where: { id: otherProject.id } });
    if (org) await OrganizationMember.destroy({ where: { organization_id: org.id } });
    if (otherOrg) await OrganizationMember.destroy({ where: { organization_id: otherOrg.id } });
    const userIds = [
      owner, admin, creator, assignee, previousAssignee, taskMemberUser,
      nonMemberProjectUser, outsiderOrgMember, otherOrgUser,
    ].filter(Boolean).map((u) => u.id);
    if (userIds.length) await User.destroy({ where: { id: userIds } });
    if (org) await Organization.destroy({ where: { id: org.id } });
    if (otherOrg) await Organization.destroy({ where: { id: otherOrg.id } });
  });

  await t.test("fixtures set up", async () => {
    org = await Organization.create({
      name: `TaskChatRest Test Org ${suffix}`,
      slug: `taskchatrest-test-org-${suffix}`,
    });
    otherOrg = await Organization.create({
      name: `TaskChatRest Other Org ${suffix}`,
      slug: `taskchatrest-other-org-${suffix}`,
    });

    async function makeUser(label) {
      return User.create({
        first_name: label,
        last_name: "Test",
        email: `${label.toLowerCase()}-${suffix}@example.test`,
      });
    }

    owner = await makeUser("ChatOwner");
    admin = await makeUser("ChatAdmin");
    creator = await makeUser("ChatCreator");
    assignee = await makeUser("ChatAssignee");
    previousAssignee = await makeUser("ChatPrevAssignee");
    taskMemberUser = await makeUser("ChatTaskMember");
    nonMemberProjectUser = await makeUser("ChatNonMemberProjUser");
    outsiderOrgMember = await makeUser("ChatOutsiderOrg");
    otherOrgUser = await makeUser("ChatOtherOrgUser");

    await OrganizationMember.bulkCreate([
      { organization_id: org.id, user_id: owner.id, role: "owner", is_active: true },
      { organization_id: org.id, user_id: admin.id, role: "admin", is_active: true },
      { organization_id: org.id, user_id: creator.id, role: "member", is_active: true },
      { organization_id: org.id, user_id: assignee.id, role: "member", is_active: true },
      { organization_id: org.id, user_id: previousAssignee.id, role: "member", is_active: true },
      { organization_id: org.id, user_id: taskMemberUser.id, role: "member", is_active: true },
      { organization_id: org.id, user_id: nonMemberProjectUser.id, role: "member", is_active: true },
      { organization_id: org.id, user_id: outsiderOrgMember.id, role: "member", is_active: true },
      { organization_id: otherOrg.id, user_id: otherOrgUser.id, role: "member", is_active: true },
    ]);

    project = await Project.create({
      organization_id: org.id,
      created_by: owner.id,
      name: `TaskChatRest Test Project ${suffix}`,
      status: "planned",
      priority: "medium",
    });
    otherProject = await Project.create({
      organization_id: org.id,
      created_by: owner.id,
      name: `TaskChatRest Other Project ${suffix}`,
      status: "planned",
      priority: "medium",
    });

    await ProjectMember.bulkCreate([
      { project_id: project.id, user_id: creator.id, role: "member" },
      { project_id: project.id, user_id: assignee.id, role: "member" },
      { project_id: project.id, user_id: taskMemberUser.id, role: "member" },
      // In the project, but deliberately never given a TaskMember row.
      { project_id: project.id, user_id: nonMemberProjectUser.id, role: "member" },
    ]);

    task = await Task.create({
      organization_id: org.id,
      project_id: project.id,
      title: `Chat auth task ${suffix}`,
      created_by: creator.id,
      assigned_to: assignee.id,
    });

    // Explicit TaskMember rows. NOTE: creator and assignee are deliberately
    // NOT given TaskMember rows here, so tests G/H exercise "creator/assignee
    // status alone must not grant chat access" -- the exact regression this
    // step guards against. previousAssignee keeps a TaskMember row even
    // though task.assigned_to no longer points at them (test K).
    await TaskMember.bulkCreate([
      { task_id: task.id, user_id: taskMemberUser.id, added_by: creator.id },
      { task_id: task.id, user_id: previousAssignee.id, added_by: creator.id },
    ]);

    assert.ok(org.id && project.id && task.id, "fixtures created");
  });

  await t.test("A: TaskMember can GET messages", async () => {
    const req = mockReq({
      params: { projectId: project.id, taskId: task.id },
      user: { id: taskMemberUser.id, organization_id: org.id, role: "member" },
    });
    const res = mockRes();
    await getMessages(req, res);
    assert.equal(res.statusCode, 200, JSON.stringify(res.body));
    assert.ok(Array.isArray(res.body.messages));
  });

  await t.test("B: TaskMember can POST message", async () => {
    const req = mockReq({
      params: { projectId: project.id, taskId: task.id },
      body: { body: "Hello from a real task member." },
      user: { id: taskMemberUser.id, organization_id: org.id, role: "member" },
    });
    const res = mockRes();
    await createMessage(req, res);
    assert.equal(res.statusCode, 201, JSON.stringify(res.body));
    assert.equal(res.body.message.sender_id, taskMemberUser.id);

    await TaskMessage.destroy({ where: { id: res.body.message.id } });
  });

  await t.test("C: non-member project member cannot GET", async () => {
    const req = mockReq({
      params: { projectId: project.id, taskId: task.id },
      user: { id: nonMemberProjectUser.id, organization_id: org.id, role: "member" },
    });
    const res = mockRes();
    await getMessages(req, res);
    assert.equal(res.statusCode, 403);
  });

  await t.test("D: non-member project member cannot POST", async () => {
    const req = mockReq({
      params: { projectId: project.id, taskId: task.id },
      body: { body: "I should not be allowed to send this." },
      user: { id: nonMemberProjectUser.id, organization_id: org.id, role: "member" },
    });
    const res = mockRes();
    await createMessage(req, res);
    assert.equal(res.statusCode, 403);
  });

  await t.test("E: org admin who is NOT a TaskMember cannot GET", async () => {
    const req = mockReq({
      params: { projectId: project.id, taskId: task.id },
      user: { id: admin.id, organization_id: org.id, role: "admin" },
    });
    const res = mockRes();
    await getMessages(req, res);
    assert.equal(res.statusCode, 403);
  });

  await t.test("F: org admin who is NOT a TaskMember cannot POST", async () => {
    const req = mockReq({
      params: { projectId: project.id, taskId: task.id },
      body: { body: "Admin override attempt." },
      user: { id: admin.id, organization_id: org.id, role: "admin" },
    });
    const res = mockRes();
    await createMessage(req, res);
    assert.equal(res.statusCode, 403);
  });

  await t.test("G: task creator who is NOT a TaskMember cannot GET", async () => {
    const req = mockReq({
      params: { projectId: project.id, taskId: task.id },
      user: { id: creator.id, organization_id: org.id, role: "member" },
    });
    const res = mockRes();
    await getMessages(req, res);
    assert.equal(res.statusCode, 403);
  });

  await t.test("H: task assignee who is NOT a TaskMember cannot GET", async () => {
    const req = mockReq({
      params: { projectId: project.id, taskId: task.id },
      user: { id: assignee.id, organization_id: org.id, role: "member" },
    });
    const res = mockRes();
    await getMessages(req, res);
    assert.equal(res.statusCode, 403);
  });

  await t.test("I+J: removed TaskMember immediately loses GET and POST access", async () => {
    const removable = await User.create({
      first_name: "ChatRemovable",
      last_name: "Test",
      email: `chat-removable-${suffix}@example.test`,
    });
    await OrganizationMember.create({
      organization_id: org.id,
      user_id: removable.id,
      role: "member",
      is_active: true,
    });
    const membership = await TaskMember.create({
      task_id: task.id,
      user_id: removable.id,
      added_by: creator.id,
    });

    const beforeReq = mockReq({
      params: { projectId: project.id, taskId: task.id },
      user: { id: removable.id, organization_id: org.id, role: "member" },
    });
    const beforeRes = mockRes();
    await getMessages(beforeReq, beforeRes);
    assert.equal(beforeRes.statusCode, 200, "must have access while still a TaskMember");

    await membership.destroy();

    const afterGetReq = mockReq({
      params: { projectId: project.id, taskId: task.id },
      user: { id: removable.id, organization_id: org.id, role: "member" },
    });
    const afterGetRes = mockRes();
    await getMessages(afterGetReq, afterGetRes);
    assert.equal(afterGetRes.statusCode, 403, "must lose GET access immediately after removal");

    const afterPostReq = mockReq({
      params: { projectId: project.id, taskId: task.id },
      body: { body: "Should be rejected after removal." },
      user: { id: removable.id, organization_id: org.id, role: "member" },
    });
    const afterPostRes = mockRes();
    await createMessage(afterPostReq, afterPostRes);
    assert.equal(afterPostRes.statusCode, 403, "must lose POST access immediately after removal");

    await User.destroy({ where: { id: removable.id } });
  });

  await t.test("K: previous assignee who remains a TaskMember can GET", async () => {
    const req = mockReq({
      params: { projectId: project.id, taskId: task.id },
      user: { id: previousAssignee.id, organization_id: org.id, role: "member" },
    });
    const res = mockRes();
    await getMessages(req, res);
    assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  });

  await t.test("L: cross-project task access is rejected", async () => {
    const req = mockReq({
      params: { projectId: otherProject.id, taskId: task.id },
      user: { id: taskMemberUser.id, organization_id: org.id, role: "member" },
    });
    const res = mockRes();
    await getMessages(req, res);
    assert.equal(res.statusCode, 404);
  });

  await t.test("M: cross-organization access is rejected", async () => {
    const req = mockReq({
      params: { projectId: project.id, taskId: task.id },
      user: { id: otherOrgUser.id, organization_id: otherOrg.id, role: "member" },
    });
    const res = mockRes();
    await getMessages(req, res);
    assert.equal(res.statusCode, 403);
  });
});
