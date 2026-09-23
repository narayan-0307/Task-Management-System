const test = require("node:test");
const assert = require("node:assert/strict");

const { sequelize } = require("../config/db");
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

const {
  canViewTaskMembers,
  canManageTaskMembers,
} = require("../utils/taskMemberAccess");

const {
  getTaskMembers,
  addTaskMember,
  removeTaskMember,
} = require("../controllers/taskMemberController");

const { createTask, updateTask } = require("../controllers/projectController");

// Minimal req/res doubles -- controllers only touch params/body/user and
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

test("Task Member management — Step 2B", async (t) => {
  const suffix = Date.now();

  // ---------------------------------------------------------------------
  // Fixtures: a dedicated throwaway organization + a second, unrelated
  // organization, so cross-org checks exercise real, committed rows
  // (an uncommitted transaction would be invisible to the connections the
  // controllers/helpers use, so real create/cleanup is required here).
  // ---------------------------------------------------------------------
  let org, otherOrg;
  let owner, admin, creator, assignee1, assignee2, explicitMember;
  let projectManagerUser, outsiderOrgMember, otherOrgUser;
  let project, otherProject;
  let createdTaskIds = [];

  t.after(async () => {
    // Clean up in FK-safe order. Task deletion cascades to task_members,
    // task_messages, etc. via the existing schema.
    if (createdTaskIds.length) {
      await Task.destroy({ where: { id: createdTaskIds } });
    }
    if (project) await Project.destroy({ where: { id: project.id } });
    if (otherProject) await Project.destroy({ where: { id: otherProject.id } });
    if (org) {
      await OrganizationMember.destroy({ where: { organization_id: org.id } });
    }
    if (otherOrg) {
      await OrganizationMember.destroy({ where: { organization_id: otherOrg.id } });
    }
    const userIds = [
      owner, admin, creator, assignee1, assignee2, explicitMember,
      projectManagerUser, outsiderOrgMember, otherOrgUser,
    ].filter(Boolean).map((u) => u.id);
    if (userIds.length) await User.destroy({ where: { id: userIds } });
    if (org) await Organization.destroy({ where: { id: org.id } });
    if (otherOrg) await Organization.destroy({ where: { id: otherOrg.id } });
  });

  await t.test("fixtures set up", async () => {
    org = await Organization.create({
      name: `TaskMember Test Org ${suffix}`,
      slug: `taskmember-test-org-${suffix}`,
    });
    otherOrg = await Organization.create({
      name: `TaskMember Other Org ${suffix}`,
      slug: `taskmember-other-org-${suffix}`,
    });

    async function makeUser(label) {
      return User.create({
        first_name: label,
        last_name: "Test",
        email: `${label.toLowerCase()}-${suffix}@example.test`,
      });
    }

    owner = await makeUser("Owner");
    admin = await makeUser("Admin");
    creator = await makeUser("Creator");
    assignee1 = await makeUser("Assignee1");
    assignee2 = await makeUser("Assignee2");
    explicitMember = await makeUser("ExplicitMember");
    projectManagerUser = await makeUser("ProjectManager");
    outsiderOrgMember = await makeUser("OutsiderOrgMember");
    otherOrgUser = await makeUser("OtherOrgUser");

    await OrganizationMember.bulkCreate([
      { organization_id: org.id, user_id: owner.id, role: "owner", is_active: true },
      { organization_id: org.id, user_id: admin.id, role: "admin", is_active: true },
      { organization_id: org.id, user_id: creator.id, role: "member", is_active: true },
      { organization_id: org.id, user_id: assignee1.id, role: "member", is_active: true },
      { organization_id: org.id, user_id: assignee2.id, role: "member", is_active: true },
      { organization_id: org.id, user_id: explicitMember.id, role: "member", is_active: true },
      // Org role is deliberately "member" -- authority must come from
      // ProjectMember.role === "manager", not the org role.
      { organization_id: org.id, user_id: projectManagerUser.id, role: "member", is_active: true },
      { organization_id: org.id, user_id: outsiderOrgMember.id, role: "member", is_active: true },
      { organization_id: otherOrg.id, user_id: otherOrgUser.id, role: "member", is_active: true },
    ]);

    project = await Project.create({
      organization_id: org.id,
      created_by: owner.id,
      name: `TaskMember Test Project ${suffix}`,
      status: "planned",
      priority: "medium",
    });
    otherProject = await Project.create({
      organization_id: org.id,
      created_by: owner.id,
      name: `TaskMember Other Project ${suffix}`,
      status: "planned",
      priority: "medium",
    });

    // outsiderOrgMember is intentionally NOT added to `project`.
    await ProjectMember.bulkCreate([
      { project_id: project.id, user_id: creator.id, role: "member" },
      { project_id: project.id, user_id: assignee1.id, role: "member" },
      { project_id: project.id, user_id: assignee2.id, role: "member" },
      { project_id: project.id, user_id: explicitMember.id, role: "member" },
      { project_id: project.id, user_id: projectManagerUser.id, role: "manager" },
    ]);

    assert.ok(org.id && project.id, "fixtures created");
  });

  await t.test("1+2+3: createTask makes creator AND assignee members; creator===assignee is one row", async () => {
    const req = mockReq({
      params: { projectId: project.id },
      body: { title: "Task with assignee", assigned_to: assignee1.id },
      user: { id: creator.id, organization_id: org.id, role: "member" },
    });
    const res = mockRes();
    await createTask(req, res);

    assert.equal(res.statusCode, 201, JSON.stringify(res.body));
    const taskId = res.body.task.id;
    createdTaskIds.push(taskId);

    const members = await TaskMember.findAll({ where: { task_id: taskId } });
    const userIds = members.map((m) => m.user_id).sort();
    assert.deepEqual(userIds.sort(), [creator.id, assignee1.id].sort());

    // Creator === assignee case
    const req2 = mockReq({
      params: { projectId: project.id },
      body: { title: "Self-assigned task", assigned_to: creator.id },
      user: { id: creator.id, organization_id: org.id, role: "member" },
    });
    const res2 = mockRes();
    await createTask(req2, res2);
    assert.equal(res2.statusCode, 201, JSON.stringify(res2.body));
    const taskId2 = res2.body.task.id;
    createdTaskIds.push(taskId2);

    const members2 = await TaskMember.findAll({ where: { task_id: taskId2 } });
    assert.equal(members2.length, 1, "creator===assignee must yield exactly one TaskMember row");
    assert.equal(members2[0].user_id, creator.id);
  });

  let reassignTaskId;

  await t.test("4+5: reassignment adds new assignee as member, keeps old assignee as member", async () => {
    const createReq = mockReq({
      params: { projectId: project.id },
      body: { title: "Reassignment task", assigned_to: assignee1.id },
      user: { id: creator.id, organization_id: org.id, role: "member" },
    });
    const createRes = mockRes();
    await createTask(createReq, createRes);
    reassignTaskId = createRes.body.task.id;
    createdTaskIds.push(reassignTaskId);

    // Owner reassigns to assignee2.
    const updateReq = mockReq({
      params: { projectId: project.id, taskId: reassignTaskId },
      body: { assigned_to: assignee2.id },
      user: { id: owner.id, organization_id: org.id, role: "owner" },
    });
    const updateRes = mockRes();
    await updateTask(updateReq, updateRes);
    assert.equal(updateRes.statusCode, 200, JSON.stringify(updateRes.body));

    const members = await TaskMember.findAll({ where: { task_id: reassignTaskId } });
    const userIds = members.map((m) => m.user_id).sort((a, b) => a - b);
    assert.deepEqual(
      userIds.sort((a, b) => a - b),
      [creator.id, assignee1.id, assignee2.id].sort((a, b) => a - b),
      "creator, old assignee, and new assignee must all remain/become members",
    );
  });

  let manageTaskId;

  await t.test("access helper + add/remove member scenarios", async (t) => {
    const createReq = mockReq({
      params: { projectId: project.id },
      body: { title: "Membership management task", assigned_to: assignee1.id },
      user: { id: creator.id, organization_id: org.id, role: "member" },
    });
    const createRes = mockRes();
    await createTask(createReq, createRes);
    manageTaskId = createRes.body.task.id;
    createdTaskIds.push(manageTaskId);

    await t.test("9: non-manager project member cannot add", async () => {
      const req = mockReq({
        params: { projectId: project.id, taskId: manageTaskId },
        body: { user_id: explicitMember.id },
        user: { id: assignee2.id, organization_id: org.id, role: "member" },
      });
      const res = mockRes();
      await addTaskMember(req, res);
      assert.equal(res.statusCode, 403);
    });

    await t.test("10+6: ProjectMember.role=manager can add explicit member", async () => {
      const req = mockReq({
        params: { projectId: project.id, taskId: manageTaskId },
        body: { user_id: explicitMember.id },
        user: { id: projectManagerUser.id, organization_id: org.id, role: "member" },
      });
      const res = mockRes();
      await addTaskMember(req, res);
      assert.equal(res.statusCode, 201, JSON.stringify(res.body));
      assert.equal(res.body.member.added_by, projectManagerUser.id);

      // 20: no password/auth fields ever returned
      const userKeys = Object.keys(res.body.member.user.dataValues ?? res.body.member.user);
      assert.deepEqual(
        userKeys.sort(),
        ["id", "first_name", "last_name", "email", "avatar_url"].sort(),
      );
    });

    await t.test("7: duplicate add is rejected with 409", async () => {
      const req = mockReq({
        params: { projectId: project.id, taskId: manageTaskId },
        body: { user_id: explicitMember.id },
        user: { id: projectManagerUser.id, organization_id: org.id, role: "member" },
      });
      const res = mockRes();
      await addTaskMember(req, res);
      assert.equal(res.statusCode, 409);
    });

    await t.test("8: user outside the organization cannot be added", async () => {
      const req = mockReq({
        params: { projectId: project.id, taskId: manageTaskId },
        body: { user_id: otherOrgUser.id },
        user: { id: creator.id, organization_id: org.id, role: "member" },
      });
      const res = mockRes();
      await addTaskMember(req, res);
      assert.equal(res.statusCode, 400);
    });

    await t.test("11: task creator can add", async () => {
      const newUser = await User.create({
        first_name: "CreatorAdded",
        last_name: "Test",
        email: `creator-added-${suffix}@example.test`,
      });
      await OrganizationMember.create({
        organization_id: org.id,
        user_id: newUser.id,
        role: "member",
        is_active: true,
      });

      const req = mockReq({
        params: { projectId: project.id, taskId: manageTaskId },
        body: { user_id: newUser.id },
        user: { id: creator.id, organization_id: org.id, role: "member" },
      });
      const res = mockRes();
      await addTaskMember(req, res);
      assert.equal(res.statusCode, 201, JSON.stringify(res.body));

      await User.destroy({ where: { id: newUser.id } });
    });

    await t.test("12: organization admin can add", async () => {
      const req = mockReq({
        params: { projectId: project.id, taskId: manageTaskId },
        body: { user_id: assignee2.id },
        user: { id: admin.id, organization_id: org.id, role: "admin" },
      });
      const res = mockRes();
      await addTaskMember(req, res);
      // assignee2 was already added via reassignment in another task, but is
      // NOT yet a member of THIS task, so this should succeed.
      assert.equal(res.statusCode, 201, JSON.stringify(res.body));
    });

    await t.test("13: unrelated organization user cannot add", async () => {
      const req = mockReq({
        params: { projectId: project.id, taskId: manageTaskId },
        body: { user_id: assignee1.id },
        user: { id: outsiderOrgMember.id, organization_id: org.id, role: "member" },
      });
      const res = mockRes();
      await addTaskMember(req, res);
      assert.equal(res.statusCode, 403);
    });

    await t.test("14+15: remove authorized vs unauthorized", async () => {
      const unauthorizedReq = mockReq({
        params: { projectId: project.id, taskId: manageTaskId, userId: explicitMember.id },
        user: { id: outsiderOrgMember.id, organization_id: org.id, role: "member" },
      });
      const unauthorizedRes = mockRes();
      await removeTaskMember(unauthorizedReq, unauthorizedRes);
      assert.equal(unauthorizedRes.statusCode, 403);

      const authorizedReq = mockReq({
        params: { projectId: project.id, taskId: manageTaskId, userId: explicitMember.id },
        user: { id: projectManagerUser.id, organization_id: org.id, role: "member" },
      });
      const authorizedRes = mockRes();
      await removeTaskMember(authorizedReq, authorizedRes);
      assert.equal(authorizedRes.statusCode, 200, JSON.stringify(authorizedRes.body));

      const stillThere = await TaskMember.findOne({
        where: { task_id: manageTaskId, user_id: explicitMember.id },
      });
      assert.equal(stillThere, null);
    });

    await t.test("16: removing membership does not delete chat messages", async () => {
      const message = await TaskMessage.create({
        task_id: manageTaskId,
        organization_id: org.id,
        sender_id: assignee1.id,
        body: "This message must survive membership removal.",
      });

      const req = mockReq({
        params: { projectId: project.id, taskId: manageTaskId, userId: assignee1.id },
        user: { id: creator.id, organization_id: org.id, role: "member" },
      });
      const res = mockRes();
      await removeTaskMember(req, res);
      assert.equal(res.statusCode, 200, JSON.stringify(res.body));

      const stillExists = await TaskMessage.findByPk(message.id);
      assert.ok(stillExists, "TaskMessage must not be deleted by member removal");

      await TaskMessage.destroy({ where: { id: message.id } });
    });

    await t.test("19+20: GET member list respects authorization and returns only safe fields", async () => {
      const deniedReq = mockReq({
        params: { projectId: project.id, taskId: manageTaskId },
        user: { id: outsiderOrgMember.id, organization_id: org.id, role: "member" },
      });
      const deniedRes = mockRes();
      await getTaskMembers(deniedReq, deniedRes);
      assert.equal(deniedRes.statusCode, 403);

      const allowedReq = mockReq({
        params: { projectId: project.id, taskId: manageTaskId },
        user: { id: creator.id, organization_id: org.id, role: "member" },
      });
      const allowedRes = mockRes();
      await getTaskMembers(allowedReq, allowedRes);
      assert.equal(allowedRes.statusCode, 200, JSON.stringify(allowedRes.body));
      assert.ok(Array.isArray(allowedRes.body.members));
      for (const member of allowedRes.body.members) {
        const userObj = member.user?.dataValues ?? member.user;
        if (userObj) {
          assert.ok(!("password_hash" in userObj));
          const keys = Object.keys(userObj);
          assert.deepEqual(
            keys.sort(),
            ["id", "first_name", "last_name", "email", "avatar_url"].sort(),
          );
        }
      }
    });

    await t.test("17: cross-project task id is rejected (404)", async () => {
      const req = mockReq({
        params: { projectId: otherProject.id, taskId: manageTaskId },
        user: { id: creator.id, organization_id: org.id, role: "member" },
      });
      const res = mockRes();
      await getTaskMembers(req, res);
      assert.equal(res.statusCode, 404);
    });

    await t.test("18: cross-organization access is rejected at the access-helper level", async () => {
      const view = await canViewTaskMembers(otherOrgUser.id, manageTaskId);
      assert.equal(view.allowed, false);
      assert.equal(view.reason, "NOT_ORGANIZATION_MEMBER");

      const manage = await canManageTaskMembers(otherOrgUser.id, manageTaskId);
      assert.equal(manage.allowed, false);
      assert.equal(manage.reason, "NOT_ORGANIZATION_MEMBER");
    });
  });

  await t.test("2 (again): initial assignee auto-membership via createTask", async () => {
    const req = mockReq({
      params: { projectId: project.id },
      body: { title: "Initial assignee only", assigned_to: assignee2.id },
      user: { id: creator.id, organization_id: org.id, role: "member" },
    });
    const res = mockRes();
    await createTask(req, res);
    assert.equal(res.statusCode, 201);
    createdTaskIds.push(res.body.task.id);

    const assigneeMembership = await TaskMember.findOne({
      where: { task_id: res.body.task.id, user_id: assignee2.id },
    });
    assert.ok(assigneeMembership, "initial assignee must be an automatic TaskMember");
  });
});
