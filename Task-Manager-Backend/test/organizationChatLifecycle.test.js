const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");

const {
  Organization,
  OrganizationMember,
  OrganizationInvitation,
  User,
  AuthIdentity,
  Conversation,
  ConversationMember,
} = require("../models");

const { register, registerWithInvitation } = require("../controllers/authController");
const { acceptInvitation } = require("../controllers/organizationController");
const {
  ensureOrganizationChat,
  ORG_WIDE_CONVERSATION_NAME,
} = require("../services/organizationChatProvisioning");

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

function makeToken() {
  return crypto.randomBytes(16).toString("hex");
}

test("Organization Chat lifecycle wiring — Step 6", async (t) => {
  const suffix = Date.now();
  const createdOrgIds = [];
  const createdUserIds = [];
  const createdInvitationIds = [];

  t.after(async () => {
    if (createdOrgIds.length) {
      const conversations = await Conversation.findAll({
        where: { organization_id: createdOrgIds },
        attributes: ["id"],
      });
      const conversationIds = conversations.map((c) => c.id);
      if (conversationIds.length) {
        await ConversationMember.destroy({ where: { conversation_id: conversationIds } });
        await Conversation.destroy({ where: { id: conversationIds } });
      }
    }
    if (createdInvitationIds.length) {
      await OrganizationInvitation.destroy({ where: { id: createdInvitationIds } });
    }
    if (createdOrgIds.length) {
      await OrganizationMember.destroy({ where: { organization_id: createdOrgIds } });
    }
    if (createdUserIds.length) {
      await AuthIdentity.destroy({ where: { user_id: createdUserIds } });
      await User.destroy({ where: { id: createdUserIds } });
    }
    if (createdOrgIds.length) {
      await Organization.destroy({ where: { id: createdOrgIds } });
    }
  });

  async function makeExistingUser(label) {
    const user = await User.create({
      first_name: label,
      last_name: "Test",
      email: `${label.toLowerCase()}-${suffix}@example.test`,
    });
    createdUserIds.push(user.id);
    return user;
  }

  // -----------------------------------------------------------------
  // 1, 2, 8: registering a brand new organization provisions exactly one
  // HumanCare Team conversation with the owner as a member, and
  // registration itself still succeeds normally.
  // -----------------------------------------------------------------
  let orgId, ownerId, orgWideConversationId;

  await t.test("1+2+8: register() provisions HumanCare Team with the owner as a member", async () => {
    const req = mockReq({
      body: {
        company_name: `OrgChatLifecycle Co ${suffix}`,
        first_name: "LifecycleOwner",
        last_name: "Test",
        email: `lifecycle-owner-${suffix}@example.test`,
        password: "Password123!",
      },
    });
    const res = mockRes();

    await register(req, res);

    assert.equal(res.statusCode, 201, JSON.stringify(res.body));
    orgId = res.body.user.organization_id;
    ownerId = res.body.user.id;
    createdOrgIds.push(orgId);
    createdUserIds.push(ownerId);

    const conversations = await Conversation.findAll({
      where: { organization_id: orgId, type: "org_wide" },
    });
    assert.equal(conversations.length, 1, "exactly one org_wide conversation");
    orgWideConversationId = conversations[0].id;
    assert.equal(conversations[0].name, ORG_WIDE_CONVERSATION_NAME);

    const members = await ConversationMember.findAll({
      where: { conversation_id: orgWideConversationId },
    });
    assert.deepEqual(members.map((m) => Number(m.user_id)), [ownerId]);
  });

  // -----------------------------------------------------------------
  // 3, 4, 7, 9: a new user who accepts an invitation (via
  // registerWithInvitation, the "new account" invitation-acceptance path)
  // is added to the SAME existing org-wide conversation, and the
  // existing invitation/registration behavior still works end to end.
  // -----------------------------------------------------------------
  let invitedNewUserId;

  await t.test("3+4+7+9: registerWithInvitation() adds the new member to the existing HumanCare Team conversation", async () => {
    const invitation = await OrganizationInvitation.create({
      organization_id: orgId,
      email: `lifecycle-invitee-${suffix}@example.test`,
      role: "member",
      token: makeToken(),
      invited_by: ownerId,
      status: "pending",
      expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000),
    });
    createdInvitationIds.push(invitation.id);

    const req = mockReq({
      body: {
        token: invitation.token,
        first_name: "LifecycleInvitee",
        last_name: "Test",
        password: "Password123!",
      },
    });
    const res = mockRes();

    await registerWithInvitation(req, res);

    assert.equal(res.statusCode, 201, JSON.stringify(res.body));
    invitedNewUserId = res.body.user.id;
    createdUserIds.push(invitedNewUserId);

    // 9: existing invitation/registration behavior intact.
    const refreshedInvitation = await OrganizationInvitation.findByPk(invitation.id);
    assert.equal(refreshedInvitation.status, "accepted");

    // 7: still exactly one org_wide conversation for this org (reused, not
    // duplicated).
    const conversationCount = await Conversation.count({
      where: { organization_id: orgId, type: "org_wide" },
    });
    assert.equal(conversationCount, 1);

    // 3+4: both the original owner and the newly invited member are now
    // ConversationMembers of that same conversation.
    const members = await ConversationMember.findAll({
      where: { conversation_id: orgWideConversationId },
    });
    const memberIds = members.map((m) => Number(m.user_id)).sort();
    assert.deepEqual(memberIds, [ownerId, invitedNewUserId].sort());
  });

  // -----------------------------------------------------------------
  // 4, 9 (existing-user variant): an already-registered user accepting an
  // invitation via organizationController.acceptInvitation is also added.
  // -----------------------------------------------------------------
  await t.test("4+9 (existing user): acceptInvitation() adds the member to HumanCare Team", async () => {
    const existingUser = await makeExistingUser("LifecycleExisting");

    const invitation = await OrganizationInvitation.create({
      organization_id: orgId,
      email: existingUser.email,
      role: "member",
      token: makeToken(),
      invited_by: ownerId,
      status: "pending",
      expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000),
    });
    createdInvitationIds.push(invitation.id);

    const req = mockReq({
      params: { token: invitation.token },
      user: { id: existingUser.id },
    });
    const res = mockRes();

    await acceptInvitation(req, res);

    assert.equal(res.statusCode, 200, JSON.stringify(res.body));

    const conversationCount = await Conversation.count({
      where: { organization_id: orgId, type: "org_wide" },
    });
    assert.equal(conversationCount, 1, "still no duplicate conversation");

    const membership = await ConversationMember.findOne({
      where: { conversation_id: orgWideConversationId, user_id: existingUser.id },
    });
    assert.ok(membership, "existing user must be added to HumanCare Team");
  });

  // -----------------------------------------------------------------
  // 5: inactive organization membership must not add the user.
  // -----------------------------------------------------------------
  await t.test("5: inactive organization membership does not add the user", async () => {
    const inactiveUser = await makeExistingUser("LifecycleInactive");

    // Created directly (bypassing controllers, which never create inactive
    // memberships) to simulate a member who is not currently active.
    await OrganizationMember.create({
      organization_id: orgId,
      user_id: inactiveUser.id,
      role: "member",
      is_active: false,
    });

    // Trigger the wiring again via a fresh acceptance from another user, so
    // the flow re-runs ensureOrganizationChat for this organization.
    const anotherUser = await makeExistingUser("LifecycleAnother");
    const invitation = await OrganizationInvitation.create({
      organization_id: orgId,
      email: anotherUser.email,
      role: "member",
      token: makeToken(),
      invited_by: ownerId,
      status: "pending",
      expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000),
    });
    createdInvitationIds.push(invitation.id);

    const req = mockReq({
      params: { token: invitation.token },
      user: { id: anotherUser.id },
    });
    const res = mockRes();
    await acceptInvitation(req, res);
    assert.equal(res.statusCode, 200, JSON.stringify(res.body));

    const inactiveMembership = await ConversationMember.findOne({
      where: { conversation_id: orgWideConversationId, user_id: inactiveUser.id },
    });
    assert.equal(inactiveMembership, null, "inactive member must not be added");

    const activeMembership = await ConversationMember.findOne({
      where: { conversation_id: orgWideConversationId, user_id: anotherUser.id },
    });
    assert.ok(activeMembership, "the newly active member must be added");
  });

  // -----------------------------------------------------------------
  // 6: repeated provisioning does not duplicate ConversationMember rows.
  // -----------------------------------------------------------------
  await t.test("6: repeated provisioning does not duplicate ConversationMember rows", async () => {
    const beforeCount = await ConversationMember.count({
      where: { conversation_id: orgWideConversationId },
    });

    await ensureOrganizationChat(orgId);
    await ensureOrganizationChat(orgId);

    const afterCount = await ConversationMember.count({
      where: { conversation_id: orgWideConversationId },
    });
    assert.equal(afterCount, beforeCount);

    const conversationCount = await Conversation.count({
      where: { organization_id: orgId, type: "org_wide" },
    });
    assert.equal(conversationCount, 1);
  });

  // -----------------------------------------------------------------
  // 10a: provisioning failure inside a TRANSACTIONAL flow rolls back the
  // whole request (existing error-handling convention: rollback + log +
  // 500), not just the chat piece.
  // -----------------------------------------------------------------
  await t.test("10a: provisioning failure rolls back the whole transactional invitation acceptance", async () => {
    const targetUser = await makeExistingUser("LifecycleRollback");

    const invitation = await OrganizationInvitation.create({
      organization_id: orgId,
      email: targetUser.email,
      role: "member",
      token: makeToken(),
      invited_by: ownerId,
      status: "pending",
      expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000),
    });
    createdInvitationIds.push(invitation.id);

    // Stub findOne (not create) because the org-wide conversation already
    // exists by this point in the suite -- provisioning here takes the
    // "repair"/add-missing-members path, which never calls Conversation.create.
    const originalFindOne = Conversation.findOne;
    Conversation.findOne = () => {
      throw new Error("Simulated chat provisioning failure");
    };

    const originalConsoleError = console.error;
    let loggedFailure = false;
    console.error = (...args) => {
      if (String(args[0] || "").includes("Accept invitation error")) {
        loggedFailure = true;
      }
    };

    try {
      const req = mockReq({
        params: { token: invitation.token },
        user: { id: targetUser.id },
      });
      const res = mockRes();
      await acceptInvitation(req, res);

      assert.equal(res.statusCode, 500, JSON.stringify(res.body));
      assert.ok(loggedFailure, "failure must be logged via the existing error-handling convention");
    } finally {
      Conversation.findOne = originalFindOne;
      console.error = originalConsoleError;
    }

    // The whole transaction must have rolled back: no membership, and the
    // invitation must still be pending, not accepted.
    const membership = await OrganizationMember.findOne({
      where: { organization_id: orgId, user_id: targetUser.id },
    });
    assert.equal(membership, null, "membership must not have been created");

    const refreshedInvitation = await OrganizationInvitation.findByPk(invitation.id);
    assert.equal(refreshedInvitation.status, "pending", "invitation must still be pending");
  });

  // -----------------------------------------------------------------
  // 10b: provisioning failure inside the NON-transactional register() flow
  // is logged but does not fail registration itself.
  // -----------------------------------------------------------------
  await t.test("10b: provisioning failure does not fail non-transactional registration", async () => {
    const originalFindAll = OrganizationMember.findAll;
    OrganizationMember.findAll = () => {
      throw new Error("Simulated chat provisioning failure");
    };

    const originalConsoleError = console.error;
    let loggedFailure = false;
    console.error = (...args) => {
      if (String(args[0] || "").includes("Organization chat provisioning failed")) {
        loggedFailure = true;
      }
    };

    let newOrgId, newOwnerId;
    try {
      const req = mockReq({
        body: {
          company_name: `OrgChatLifecycle FailCo ${suffix}`,
          first_name: "LifecycleFailOwner",
          last_name: "Test",
          email: `lifecycle-fail-owner-${suffix}@example.test`,
          password: "Password123!",
        },
      });
      const res = mockRes();

      await register(req, res);

      assert.equal(res.statusCode, 201, JSON.stringify(res.body));
      newOrgId = res.body.user.organization_id;
      newOwnerId = res.body.user.id;
      assert.ok(loggedFailure, "provisioning failure must be logged, not swallowed silently");
    } finally {
      OrganizationMember.findAll = originalFindAll;
      console.error = originalConsoleError;
    }

    createdOrgIds.push(newOrgId);
    createdUserIds.push(newOwnerId);

    // Registration succeeded despite the provisioning failure -- the org
    // and owner membership exist even though no chat could be provisioned.
    const membership = await OrganizationMember.findOne({
      where: { organization_id: newOrgId, user_id: newOwnerId },
    });
    assert.ok(membership, "owner membership must still exist");

    const conversationCount = await Conversation.count({
      where: { organization_id: newOrgId, type: "org_wide" },
    });
    assert.equal(conversationCount, 0, "no conversation should exist after a provisioning failure");
  });
});
