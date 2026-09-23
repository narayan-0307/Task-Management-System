const test = require("node:test");
const assert = require("node:assert/strict");

const {
  Organization,
  OrganizationMember,
  User,
  Conversation,
  ConversationMember,
  Message,
  Attachment,
} = require("../models");

const { requireAuth } = require("../middleware/authMiddleware");
const {
  listConversations,
  getConversation,
  createConversation,
  addConversationMembers,
  removeConversationMember,
} = require("../controllers/organizationChatController");
const {
  listMessages,
  createMessage,
} = require("../controllers/organizationMessageController");
const { ensureOrganizationChat } = require("../services/organizationChatProvisioning");

// Minimal req/res doubles, matching the pattern used by
// taskChatRestAuthorization.test.js -- the controllers only touch
// params/query/body/user and res.status().json().
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

function mockReq({ params = {}, query = {}, body = {}, headers = {}, user }) {
  return { params, query, body, headers, user };
}

function asUser(user, org) {
  return { id: user.id, organization_id: org.id, role: "member" };
}

test("Organization Chat REST API foundation — Step 4", async (t) => {
  const suffix = Date.now();

  let org, otherOrg;
  let alice, bob, carol, dave, frank, erin;
  // Step 24: additional users spanning the full OrganizationMember role set,
  // used only by the GROUP MEMBER MANAGEMENT AUTHORIZATION section below.
  let owner1, admin1, manager1, member2, client1, targetA, targetB, targetC, targetD;
  const createdConversationIds = [];
  const createdAttachmentIds = [];

  t.after(async () => {
    if (createdAttachmentIds.length) {
      await Attachment.destroy({ where: { id: createdAttachmentIds } });
    }
    if (createdConversationIds.length) {
      await Message.destroy({
        where: { conversation_id: createdConversationIds },
      });
      await ConversationMember.destroy({
        where: { conversation_id: createdConversationIds },
      });
      await Conversation.destroy({ where: { id: createdConversationIds } });
    }
    if (org) await OrganizationMember.destroy({ where: { organization_id: org.id } });
    if (otherOrg) await OrganizationMember.destroy({ where: { organization_id: otherOrg.id } });
    const userIds = [
      alice, bob, carol, dave, frank, erin,
      owner1, admin1, manager1, member2, client1, targetA, targetB, targetC, targetD,
    ]
      .filter(Boolean)
      .map((u) => u.id);
    if (userIds.length) await User.destroy({ where: { id: userIds } });
    if (org) await Organization.destroy({ where: { id: org.id } });
    if (otherOrg) await Organization.destroy({ where: { id: otherOrg.id } });
  });

  await t.test("fixtures set up", async () => {
    org = await Organization.create({
      name: `OrgChatRest Test Org ${suffix}`,
      slug: `orgchatrest-test-org-${suffix}`,
    });
    otherOrg = await Organization.create({
      name: `OrgChatRest Other Org ${suffix}`,
      slug: `orgchatrest-other-org-${suffix}`,
    });

    async function makeUser(label) {
      return User.create({
        first_name: label,
        last_name: "Test",
        email: `${label.toLowerCase()}-${suffix}@example.test`,
      });
    }

    alice = await makeUser("ChatAlice");
    bob = await makeUser("ChatBob");
    carol = await makeUser("ChatCarol");
    dave = await makeUser("ChatDave");
    frank = await makeUser("ChatFrank");
    erin = await makeUser("ChatErin");

    owner1 = await makeUser("ChatOwner1");
    admin1 = await makeUser("ChatAdmin1");
    manager1 = await makeUser("ChatManager1");
    member2 = await makeUser("ChatMember2");
    client1 = await makeUser("ChatClient1");
    targetA = await makeUser("ChatTargetA");
    targetB = await makeUser("ChatTargetB");
    targetC = await makeUser("ChatTargetC");
    targetD = await makeUser("ChatTargetD");

    await OrganizationMember.bulkCreate([
      { organization_id: org.id, user_id: alice.id, role: "member", is_active: true },
      { organization_id: org.id, user_id: bob.id, role: "member", is_active: true },
      { organization_id: org.id, user_id: carol.id, role: "member", is_active: true },
      { organization_id: org.id, user_id: dave.id, role: "member", is_active: false },
      { organization_id: org.id, user_id: frank.id, role: "member", is_active: true },
      { organization_id: otherOrg.id, user_id: erin.id, role: "member", is_active: true },
      { organization_id: org.id, user_id: owner1.id, role: "owner", is_active: true },
      { organization_id: org.id, user_id: admin1.id, role: "admin", is_active: true },
      { organization_id: org.id, user_id: manager1.id, role: "manager", is_active: true },
      { organization_id: org.id, user_id: member2.id, role: "member", is_active: true },
      { organization_id: org.id, user_id: client1.id, role: "client", is_active: true },
      { organization_id: org.id, user_id: targetA.id, role: "member", is_active: true },
      { organization_id: org.id, user_id: targetB.id, role: "member", is_active: true },
      { organization_id: org.id, user_id: targetC.id, role: "member", is_active: true },
      { organization_id: org.id, user_id: targetD.id, role: "member", is_active: true },
    ]);

    assert.ok(org.id && otherOrg.id, "fixtures created");
  });

  // ---------------------------------------------------------------
  // AUTH / ORG SECURITY
  // ---------------------------------------------------------------

  await t.test("1: unauthenticated conversation list rejected", () => {
    const req = { headers: {} };
    const res = mockRes();
    requireAuth(req, res, () => {
      throw new Error("next() must not be called without a token");
    });
    assert.equal(res.statusCode, 401);
  });

  await t.test("2: unauthenticated conversation creation rejected", () => {
    const req = { headers: {} };
    const res = mockRes();
    requireAuth(req, res, () => {
      throw new Error("next() must not be called without a token");
    });
    assert.equal(res.statusCode, 401);
  });

  await t.test("3: inactive organization member rejected", async () => {
    const req = mockReq({ user: asUser(dave, org) });
    const res = mockRes();
    await listConversations(req, res);
    assert.equal(res.statusCode, 403);
  });

  let directConversationId;
  let groupConversationId;

  await t.test("10: direct conversation creation works", async () => {
    const req = mockReq({
      user: asUser(alice, org),
      body: { type: "direct", user_ids: [bob.id] },
    });
    const res = mockRes();
    await createConversation(req, res);
    assert.equal(res.statusCode, 201, JSON.stringify(res.body));
    assert.equal(res.body.conversation.type, "direct");
    assert.equal(res.body.created, true);
    directConversationId = res.body.conversation.id;
    createdConversationIds.push(directConversationId);
  });

  await t.test("11: duplicate direct conversation returns existing", async () => {
    const req = mockReq({
      user: asUser(alice, org),
      body: { type: "direct", user_ids: [bob.id] },
    });
    const res = mockRes();
    await createConversation(req, res);
    assert.equal(res.statusCode, 200, JSON.stringify(res.body));
    assert.equal(res.body.created, false);
    assert.equal(res.body.conversation.id, directConversationId);
  });

  await t.test("16: invalid conversation type rejected", async () => {
    const req = mockReq({
      user: asUser(alice, org),
      body: { type: "org_wide", user_ids: [bob.id] },
    });
    const res = mockRes();
    await createConversation(req, res);
    assert.equal(res.statusCode, 400);
  });

  await t.test("17: direct conversation with wrong member count rejected", async () => {
    const req = mockReq({
      user: asUser(alice, org),
      body: { type: "direct", user_ids: [bob.id, carol.id] },
    });
    const res = mockRes();
    await createConversation(req, res);
    assert.equal(res.statusCode, 400);
  });

  await t.test("18: group conversation without required name rejected", async () => {
    const req = mockReq({
      user: asUser(alice, org),
      body: { type: "group", user_ids: [bob.id, carol.id] },
    });
    const res = mockRes();
    await createConversation(req, res);
    assert.equal(res.statusCode, 400);
  });

  await t.test("15: cross-org invited user is rejected", async () => {
    const req = mockReq({
      user: asUser(alice, org),
      body: { type: "group", name: "Should Fail", user_ids: [bob.id, erin.id] },
    });
    const res = mockRes();
    await createConversation(req, res);
    assert.equal(res.statusCode, 400);
  });

  await t.test("12+13+14: group conversation creation, creator + invitees become members", async () => {
    const req = mockReq({
      user: asUser(alice, org),
      body: {
        type: "group",
        name: "Dev Team",
        user_ids: [bob.id, carol.id],
      },
    });
    const res = mockRes();
    await createConversation(req, res);
    assert.equal(res.statusCode, 201, JSON.stringify(res.body));
    assert.equal(res.body.conversation.type, "group");
    assert.equal(res.body.conversation.name, "Dev Team");
    groupConversationId = res.body.conversation.id;
    createdConversationIds.push(groupConversationId);

    const members = await ConversationMember.findAll({
      where: { conversation_id: groupConversationId },
    });
    const memberIds = members.map((m) => Number(m.user_id)).sort();
    assert.deepEqual(memberIds, [alice.id, bob.id, carol.id].sort());
  });

  await t.test("7: member can list own conversations", async () => {
    const req = mockReq({ user: asUser(alice, org) });
    const res = mockRes();
    await listConversations(req, res);
    assert.equal(res.statusCode, 200, JSON.stringify(res.body));
    const ids = res.body.conversations.map((c) => c.id);
    assert.ok(ids.includes(directConversationId));
    assert.ok(ids.includes(groupConversationId));
  });

  // ---------------------------------------------------------------
  // LIST — direct_participant (Step 21)
  // ---------------------------------------------------------------

  await t.test("33: org_wide conversation is listed without direct_participant", async () => {
    const orgWide = await ensureOrganizationChat(org.id);
    createdConversationIds.push(orgWide.id);

    const req = mockReq({ user: asUser(alice, org) });
    const res = mockRes();
    await listConversations(req, res);
    assert.equal(res.statusCode, 200, JSON.stringify(res.body));

    const row = res.body.conversations.find((c) => c.id === orgWide.id);
    assert.ok(row, "org_wide conversation present in list");
    assert.equal(row.type, "org_wide");
    assert.equal("direct_participant" in row, false);
  });

  await t.test("34: group conversation is listed without direct_participant", async () => {
    const req = mockReq({ user: asUser(alice, org) });
    const res = mockRes();
    await listConversations(req, res);
    assert.equal(res.statusCode, 200, JSON.stringify(res.body));

    const row = res.body.conversations.find((c) => c.id === groupConversationId);
    assert.ok(row, "group conversation present in list");
    assert.equal(row.type, "group");
    assert.equal("direct_participant" in row, false);
  });

  await t.test("35: direct conversation lists the OTHER participant, never the current user, safe fields only", async () => {
    const reqAsAlice = mockReq({ user: asUser(alice, org) });
    const resAsAlice = mockRes();
    await listConversations(reqAsAlice, resAsAlice);
    assert.equal(resAsAlice.statusCode, 200, JSON.stringify(resAsAlice.body));

    const rowForAlice = resAsAlice.body.conversations.find(
      (c) => c.id === directConversationId,
    );
    assert.ok(rowForAlice.direct_participant, "direct_participant present");
    assert.equal(rowForAlice.direct_participant.id, bob.id);
    assert.equal(rowForAlice.direct_participant.first_name, bob.first_name);
    assert.equal(rowForAlice.direct_participant.email, bob.email);
    assert.ok("avatar_url" in rowForAlice.direct_participant);
    // Safe fields only -- no password/hash/token-shaped keys leaked.
    assert.deepEqual(
      Object.keys(rowForAlice.direct_participant).sort(),
      ["avatar_url", "email", "first_name", "id", "last_name"].sort(),
    );

    // From bob's side, the OTHER participant is alice -- never bob himself.
    const reqAsBob = mockReq({ user: asUser(bob, org) });
    const resAsBob = mockRes();
    await listConversations(reqAsBob, resAsBob);
    const rowForBob = resAsBob.body.conversations.find(
      (c) => c.id === directConversationId,
    );
    assert.equal(rowForBob.direct_participant.id, alice.id);
    assert.notEqual(rowForBob.direct_participant.id, bob.id);
  });

  await t.test("36: multiple direct conversations resolve correctly in one list call (no N+1)", async () => {
    const createReq = mockReq({
      user: asUser(alice, org),
      body: { type: "direct", user_ids: [frank.id] },
    });
    const createRes = mockRes();
    await createConversation(createReq, createRes);
    assert.equal(createRes.statusCode, 201, JSON.stringify(createRes.body));
    const secondDirectConversationId = createRes.body.conversation.id;
    createdConversationIds.push(secondDirectConversationId);

    const req = mockReq({ user: asUser(alice, org) });
    const res = mockRes();
    await listConversations(req, res);
    assert.equal(res.statusCode, 200, JSON.stringify(res.body));

    const firstRow = res.body.conversations.find((c) => c.id === directConversationId);
    const secondRow = res.body.conversations.find(
      (c) => c.id === secondDirectConversationId,
    );
    assert.equal(firstRow.direct_participant.id, bob.id);
    assert.equal(secondRow.direct_participant.id, frank.id);
  });

  await t.test("8: non-member cannot read conversation", async () => {
    const req = mockReq({
      user: asUser(frank, org),
      params: { conversationId: groupConversationId },
    });
    const res = mockRes();
    await getConversation(req, res);
    assert.equal(res.statusCode, 403);
  });

  await t.test("9: member can read conversation details", async () => {
    const req = mockReq({
      user: asUser(alice, org),
      params: { conversationId: groupConversationId },
    });
    const res = mockRes();
    await getConversation(req, res);
    assert.equal(res.statusCode, 200, JSON.stringify(res.body));
    assert.equal(res.body.conversation.id, groupConversationId);
    assert.equal(res.body.members.length, 3);
  });

  await t.test("4: user from another organization cannot access conversation", async () => {
    const req = mockReq({
      user: asUser(erin, otherOrg),
      params: { conversationId: groupConversationId },
    });
    const res = mockRes();
    await getConversation(req, res);
    assert.equal(res.statusCode, 403);
  });

  // ---------------------------------------------------------------
  // GROUP MEMBER MANAGEMENT
  // ---------------------------------------------------------------

  await t.test("19: group creator can add active org member (Step 24 authorization)", async () => {
    // Step 24: adding members is now restricted to the creator or an
    // owner/admin/manager -- bob (a normal member) is no longer authorized,
    // so this uses alice, the group's creator, instead.
    const req = mockReq({
      user: asUser(alice, org),
      params: { conversationId: groupConversationId },
      body: { user_ids: [frank.id] },
    });
    const res = mockRes();
    await addConversationMembers(req, res);
    assert.equal(res.statusCode, 200, JSON.stringify(res.body));
    assert.deepEqual(res.body.added_user_ids, [frank.id]);
  });

  await t.test("20: cross-org member cannot be added", async () => {
    const req = mockReq({
      user: asUser(alice, org),
      params: { conversationId: groupConversationId },
      body: { user_ids: [erin.id] },
    });
    const res = mockRes();
    await addConversationMembers(req, res);
    assert.equal(res.statusCode, 400);
  });

  await t.test("21: duplicate member is not duplicated", async () => {
    const beforeCount = await ConversationMember.count({
      where: { conversation_id: groupConversationId },
    });

    const req = mockReq({
      user: asUser(alice, org),
      params: { conversationId: groupConversationId },
      body: { user_ids: [bob.id] },
    });
    const res = mockRes();
    await addConversationMembers(req, res);
    assert.equal(res.statusCode, 200, JSON.stringify(res.body));
    assert.deepEqual(res.body.added_user_ids, []);

    const afterCount = await ConversationMember.count({
      where: { conversation_id: groupConversationId },
    });
    assert.equal(afterCount, beforeCount);
  });

  await t.test("22: group creator can remove another member from group", async () => {
    // alice is groupConversationId's creator (see test 12+13+14).
    const req = mockReq({
      user: asUser(alice, org),
      params: { conversationId: groupConversationId, userId: carol.id },
    });
    const res = mockRes();
    await removeConversationMember(req, res);
    assert.equal(res.statusCode, 200, JSON.stringify(res.body));

    const stillMember = await ConversationMember.findOne({
      where: { conversation_id: groupConversationId, user_id: carol.id },
    });
    assert.equal(stillMember, null);
  });

  await t.test("23: direct conversation member removal rejected", async () => {
    const req = mockReq({
      user: asUser(alice, org),
      params: { conversationId: directConversationId, userId: bob.id },
    });
    const res = mockRes();
    await removeConversationMember(req, res);
    assert.equal(res.statusCode, 400);
  });

  // ---------------------------------------------------------------
  // STEP 24 — GROUP MEMBER MANAGEMENT AUTHORIZATION
  // ---------------------------------------------------------------

  let membershipAuditGroupId;

  await t.test("Step 24 fixtures: membership audit group created", async () => {
    const req = mockReq({
      user: asUser(alice, org),
      body: {
        type: "group",
        name: "Membership Audit Group",
        user_ids: [owner1.id, admin1.id, manager1.id, member2.id, client1.id],
      },
    });
    const res = mockRes();
    await createConversation(req, res);
    assert.equal(res.statusCode, 201, JSON.stringify(res.body));
    membershipAuditGroupId = res.body.conversation.id;
    createdConversationIds.push(membershipAuditGroupId);
  });

  await t.test("Step24-1: group creator can add member", async () => {
    const req = mockReq({
      user: asUser(alice, org),
      params: { conversationId: membershipAuditGroupId },
      body: { user_ids: [targetA.id] },
    });
    const res = mockRes();
    await addConversationMembers(req, res);
    assert.equal(res.statusCode, 200, JSON.stringify(res.body));
    assert.deepEqual(res.body.added_user_ids, [targetA.id]);
  });

  await t.test("Step24-2: group creator can remove member", async () => {
    const req = mockReq({
      user: asUser(alice, org),
      params: { conversationId: membershipAuditGroupId, userId: targetA.id },
    });
    const res = mockRes();
    await removeConversationMember(req, res);
    assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  });

  await t.test("Step24-3: organization owner can add member", async () => {
    const req = mockReq({
      user: asUser(owner1, org),
      params: { conversationId: membershipAuditGroupId },
      body: { user_ids: [targetB.id] },
    });
    const res = mockRes();
    await addConversationMembers(req, res);
    assert.equal(res.statusCode, 200, JSON.stringify(res.body));
    assert.deepEqual(res.body.added_user_ids, [targetB.id]);
  });

  await t.test("Step24-4: organization admin can add member", async () => {
    const req = mockReq({
      user: asUser(admin1, org),
      params: { conversationId: membershipAuditGroupId },
      body: { user_ids: [targetC.id] },
    });
    const res = mockRes();
    await addConversationMembers(req, res);
    assert.equal(res.statusCode, 200, JSON.stringify(res.body));
    assert.deepEqual(res.body.added_user_ids, [targetC.id]);
  });

  await t.test("Step24-5: organization manager can add member", async () => {
    const req = mockReq({
      user: asUser(manager1, org),
      params: { conversationId: membershipAuditGroupId },
      body: { user_ids: [targetD.id] },
    });
    const res = mockRes();
    await addConversationMembers(req, res);
    assert.equal(res.statusCode, 200, JSON.stringify(res.body));
    assert.deepEqual(res.body.added_user_ids, [targetD.id]);
  });

  await t.test("Step24-6: organization owner can remove member", async () => {
    const req = mockReq({
      user: asUser(owner1, org),
      params: { conversationId: membershipAuditGroupId, userId: targetB.id },
    });
    const res = mockRes();
    await removeConversationMember(req, res);
    assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  });

  await t.test("Step24-7: organization admin can remove member", async () => {
    const req = mockReq({
      user: asUser(admin1, org),
      params: { conversationId: membershipAuditGroupId, userId: targetC.id },
    });
    const res = mockRes();
    await removeConversationMember(req, res);
    assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  });

  await t.test("Step24-8: organization manager can remove member", async () => {
    const req = mockReq({
      user: asUser(manager1, org),
      params: { conversationId: membershipAuditGroupId, userId: targetD.id },
    });
    const res = mockRes();
    await removeConversationMember(req, res);
    assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  });

  // At this point membershipAuditGroupId members are back to:
  // alice (creator), owner1, admin1, manager1, member2, client1.

  await t.test("Step24-9: normal member cannot add member", async () => {
    const req = mockReq({
      user: asUser(member2, org),
      params: { conversationId: membershipAuditGroupId },
      body: { user_ids: [frank.id] },
    });
    const res = mockRes();
    await addConversationMembers(req, res);
    assert.equal(res.statusCode, 403, JSON.stringify(res.body));
  });

  await t.test("Step24-10: normal member cannot remove another member", async () => {
    const req = mockReq({
      user: asUser(member2, org),
      params: { conversationId: membershipAuditGroupId, userId: owner1.id },
    });
    const res = mockRes();
    await removeConversationMember(req, res);
    assert.equal(res.statusCode, 403, JSON.stringify(res.body));

    const stillMember = await ConversationMember.findOne({
      where: { conversation_id: membershipAuditGroupId, user_id: owner1.id },
    });
    assert.ok(stillMember, "owner1 must remain a member after a rejected removal");
  });

  await t.test("Step24-11: normal client cannot add member", async () => {
    const req = mockReq({
      user: asUser(client1, org),
      params: { conversationId: membershipAuditGroupId },
      body: { user_ids: [frank.id] },
    });
    const res = mockRes();
    await addConversationMembers(req, res);
    assert.equal(res.statusCode, 403, JSON.stringify(res.body));
  });

  await t.test("Step24-12: normal client cannot remove another member", async () => {
    const req = mockReq({
      user: asUser(client1, org),
      params: { conversationId: membershipAuditGroupId, userId: manager1.id },
    });
    const res = mockRes();
    await removeConversationMember(req, res);
    assert.equal(res.statusCode, 403, JSON.stringify(res.body));
  });

  await t.test("Step24-13: non-creator member can remove themselves", async () => {
    const req = mockReq({
      user: asUser(member2, org),
      params: { conversationId: membershipAuditGroupId, userId: member2.id },
    });
    const res = mockRes();
    await removeConversationMember(req, res);
    assert.equal(res.statusCode, 200, JSON.stringify(res.body));

    const stillMember = await ConversationMember.findOne({
      where: { conversation_id: membershipAuditGroupId, user_id: member2.id },
    });
    assert.equal(stillMember, null);
  });

  await t.test("Step24-14: creator cannot remove themselves", async () => {
    const req = mockReq({
      user: asUser(alice, org),
      params: { conversationId: membershipAuditGroupId, userId: alice.id },
    });
    const res = mockRes();
    await removeConversationMember(req, res);
    assert.equal(res.statusCode, 400, JSON.stringify(res.body));
    assert.equal(res.body.message, "Group creator cannot be removed.");
  });

  await t.test("Step24-15: creator cannot be removed by another member", async () => {
    const req = mockReq({
      user: asUser(client1, org),
      params: { conversationId: membershipAuditGroupId, userId: alice.id },
    });
    const res = mockRes();
    await removeConversationMember(req, res);
    assert.equal(res.statusCode, 400, JSON.stringify(res.body));
    assert.equal(res.body.message, "Group creator cannot be removed.");
  });

  await t.test("Step24-16: creator cannot be removed by organization manager/admin/owner", async () => {
    for (const actor of [manager1, admin1, owner1]) {
      const req = mockReq({
        user: asUser(actor, org),
        params: { conversationId: membershipAuditGroupId, userId: alice.id },
      });
      const res = mockRes();
      await removeConversationMember(req, res);
      assert.equal(res.statusCode, 400, JSON.stringify(res.body));
      assert.equal(res.body.message, "Group creator cannot be removed.");
    }

    const stillMember = await ConversationMember.findOne({
      where: { conversation_id: membershipAuditGroupId, user_id: alice.id },
    });
    assert.ok(stillMember, "creator must remain a member");
  });

  await t.test("Step24-17: direct conversation still rejects add", async () => {
    const req = mockReq({
      user: asUser(alice, org),
      params: { conversationId: directConversationId },
      body: { user_ids: [carol.id] },
    });
    const res = mockRes();
    await addConversationMembers(req, res);
    assert.equal(res.statusCode, 400, JSON.stringify(res.body));
  });

  await t.test("Step24-18: direct conversation still rejects remove", async () => {
    // Same behavior already covered by test 23 above; re-asserted here
    // under the Step 24 authorization changes to confirm no regression.
    const req = mockReq({
      user: asUser(alice, org),
      params: { conversationId: directConversationId, userId: bob.id },
    });
    const res = mockRes();
    await removeConversationMember(req, res);
    assert.equal(res.statusCode, 400, JSON.stringify(res.body));
  });

  await t.test("Step24-19: org_wide conversation still rejects add", async () => {
    const orgWide = await ensureOrganizationChat(org.id);
    const req = mockReq({
      user: asUser(alice, org),
      params: { conversationId: orgWide.id },
      body: { user_ids: [carol.id] },
    });
    const res = mockRes();
    await addConversationMembers(req, res);
    assert.equal(res.statusCode, 400, JSON.stringify(res.body));
  });

  await t.test("Step24-20: org_wide conversation still rejects remove", async () => {
    const orgWide = await ensureOrganizationChat(org.id);
    const req = mockReq({
      user: asUser(alice, org),
      params: { conversationId: orgWide.id, userId: bob.id },
    });
    const res = mockRes();
    await removeConversationMember(req, res);
    assert.equal(res.statusCode, 400, JSON.stringify(res.body));
  });

  // Step24-21 (cross-organization target still rejected) is covered by
  // test 20 above; Step24-22 (duplicate member behavior still works) is
  // covered by test 21 above -- both re-verified against the Step 24
  // authorization path since they now run through the new `canManage`
  // check first (alice is groupConversationId's creator, so those calls
  // still reach the same duplicate/cross-org logic as before).

  await t.test("Step24-23: last-member protection still works", async () => {
    // Synthetic setup: the last-remaining-member guard can no longer be
    // reached through a creator (creators are never removable at all, see
    // Step24-14), so this simulates a group whose creator row is already
    // gone (e.g. legacy data) to exercise the guard on a non-creator sole
    // member, via a member with an org role that would otherwise be
    // authorized to remove others.
    const soloReq = mockReq({
      user: asUser(owner1, org),
      body: { type: "group", name: "Solo Group", user_ids: [admin1.id] },
    });
    const soloRes = mockRes();
    await createConversation(soloReq, soloRes);
    assert.equal(soloRes.statusCode, 201, JSON.stringify(soloRes.body));
    const soloGroupId = soloRes.body.conversation.id;
    createdConversationIds.push(soloGroupId);

    await ConversationMember.destroy({
      where: { conversation_id: soloGroupId, user_id: owner1.id },
    });

    const req = mockReq({
      user: asUser(admin1, org),
      params: { conversationId: soloGroupId, userId: admin1.id },
    });
    const res = mockRes();
    await removeConversationMember(req, res);
    assert.equal(res.statusCode, 400, JSON.stringify(res.body));
    assert.equal(res.body.message, "Cannot remove the last remaining member.");
  });

  // ---------------------------------------------------------------
  // MESSAGES
  // ---------------------------------------------------------------

  let firstMessageId;

  await t.test("26: conversation member can send message", async () => {
    const req = mockReq({
      user: asUser(bob, org),
      params: { conversationId: groupConversationId },
      body: { body: "Hello team" },
    });
    const res = mockRes();
    await createMessage(req, res);
    assert.equal(res.statusCode, 201, JSON.stringify(res.body));
    assert.equal(res.body.message.body, "Hello team");
    assert.equal(res.body.message.sender_id, bob.id);
    firstMessageId = res.body.message.id;
  });

  await t.test("27: sender_id from client is ignored", async () => {
    const req = mockReq({
      user: asUser(bob, org),
      params: { conversationId: groupConversationId },
      body: { body: "Trying to spoof sender", sender_id: alice.id },
    });
    const res = mockRes();
    await createMessage(req, res);
    assert.equal(res.statusCode, 201, JSON.stringify(res.body));
    assert.equal(res.body.message.sender_id, bob.id);
  });

  await t.test("28: organization_id from client is ignored", async () => {
    const req = mockReq({
      user: asUser(bob, org),
      params: { conversationId: groupConversationId },
      body: { body: "Trying to spoof org", organization_id: otherOrg.id },
    });
    const res = mockRes();
    await createMessage(req, res);
    assert.equal(res.statusCode, 201, JSON.stringify(res.body));
    assert.equal(Number(res.body.message.organization_id), Number(org.id));
  });

  await t.test("29: empty message rejected", async () => {
    const req = mockReq({
      user: asUser(bob, org),
      params: { conversationId: groupConversationId },
      body: { body: "" },
    });
    const res = mockRes();
    await createMessage(req, res);
    assert.equal(res.statusCode, 400);
  });

  await t.test("30: whitespace-only message rejected", async () => {
    const req = mockReq({
      user: asUser(bob, org),
      params: { conversationId: groupConversationId },
      body: { body: "     " },
    });
    const res = mockRes();
    await createMessage(req, res);
    assert.equal(res.statusCode, 400);
  });

  await t.test("31: oversized message rejected", async () => {
    const req = mockReq({
      user: asUser(bob, org),
      params: { conversationId: groupConversationId },
      body: { body: "a".repeat(10001) },
    });
    const res = mockRes();
    await createMessage(req, res);
    assert.equal(res.statusCode, 400);
  });

  await t.test("24: conversation member can list messages", async () => {
    const req = mockReq({
      user: asUser(alice, org),
      params: { conversationId: groupConversationId },
    });
    const res = mockRes();
    await listMessages(req, res);
    assert.equal(res.statusCode, 200, JSON.stringify(res.body));
    const ids = res.body.messages.map((m) => m.id);
    assert.ok(ids.includes(firstMessageId));
  });

  // ---------------------------------------------------------------
  // MESSAGE ATTACHMENTS (Step 29) -- listMessages() now includes each
  // message's attachments via a single query (the existing
  // Message.hasMany(Attachment, { foreignKey: "org_message_id" }) include),
  // reusing organizationChatAttachmentController.js's serializeAttachment()
  // for the exact same shape the attachment API itself returns.
  // ---------------------------------------------------------------

  await t.test("37: message with no attachment returns attachments: []", async () => {
    const req = mockReq({
      user: asUser(alice, org),
      params: { conversationId: groupConversationId },
    });
    const res = mockRes();
    await listMessages(req, res);
    assert.equal(res.statusCode, 200, JSON.stringify(res.body));

    const message = res.body.messages.find((m) => m.id === firstMessageId);
    assert.ok(message, "message present in the list");
    assert.deepEqual(message.attachments, []);
  });

  await t.test("38: message with one attachment returns its metadata, no file_path, correct url", async () => {
    const msgReq = mockReq({
      user: asUser(bob, org),
      params: { conversationId: groupConversationId },
      body: { body: "Message with one attachment" },
    });
    const msgRes = mockRes();
    await createMessage(msgReq, msgRes);
    assert.equal(msgRes.statusCode, 201, JSON.stringify(msgRes.body));
    const messageId = msgRes.body.message.id;

    const attachment = await Attachment.create({
      org_message_id: messageId,
      organization_id: org.id,
      uploaded_by: bob.id,
      file_name: "single-file.txt",
      file_path: "should-never-be-exposed.txt",
      file_size: 1234,
      mime_type: "text/plain",
    });
    createdAttachmentIds.push(attachment.id);

    const req = mockReq({
      user: asUser(alice, org),
      params: { conversationId: groupConversationId },
    });
    const res = mockRes();
    await listMessages(req, res);
    assert.equal(res.statusCode, 200, JSON.stringify(res.body));

    const message = res.body.messages.find((m) => m.id === messageId);
    assert.ok(message, "message with attachment present in the list");
    assert.equal(message.attachments.length, 1);

    const returned = message.attachments[0];
    assert.equal(returned.id, attachment.id);
    assert.equal(returned.file_name, "single-file.txt");
    assert.equal(returned.file_size, 1234);
    assert.equal(returned.mime_type, "text/plain");
    assert.equal(
      returned.url,
      `/api/chat/conversations/${groupConversationId}/messages/${messageId}/attachments/${attachment.id}`,
    );
    assert.equal("file_path" in returned, false, "file_path must never be exposed");
  });

  await t.test("39: message with multiple attachments returns all of them", async () => {
    const msgReq = mockReq({
      user: asUser(bob, org),
      params: { conversationId: groupConversationId },
      body: { body: "Message with two attachments" },
    });
    const msgRes = mockRes();
    await createMessage(msgReq, msgRes);
    assert.equal(msgRes.statusCode, 201, JSON.stringify(msgRes.body));
    const messageId = msgRes.body.message.id;

    const firstAttachment = await Attachment.create({
      org_message_id: messageId,
      organization_id: org.id,
      uploaded_by: bob.id,
      file_name: "first.txt",
      file_path: "first-internal.txt",
      file_size: 10,
      mime_type: "text/plain",
    });
    const secondAttachment = await Attachment.create({
      org_message_id: messageId,
      organization_id: org.id,
      uploaded_by: bob.id,
      file_name: "second.pdf",
      file_path: "second-internal.pdf",
      file_size: 20,
      mime_type: "application/pdf",
    });
    createdAttachmentIds.push(firstAttachment.id, secondAttachment.id);

    const req = mockReq({
      user: asUser(alice, org),
      params: { conversationId: groupConversationId },
    });
    const res = mockRes();
    await listMessages(req, res);
    assert.equal(res.statusCode, 200, JSON.stringify(res.body));

    const message = res.body.messages.find((m) => m.id === messageId);
    assert.ok(message, "message with two attachments present in the list");
    assert.equal(message.attachments.length, 2);

    const ids = message.attachments.map((a) => a.id).sort();
    assert.deepEqual(ids, [firstAttachment.id, secondAttachment.id].sort());
    for (const returned of message.attachments) {
      assert.equal("file_path" in returned, false);
    }
  });

  await t.test("40: pagination total count is not inflated by attachments (distinct)", async () => {
    // groupConversationId now has messages 26,27,28,38,39-created plus the
    // two attachment test messages -- each with 0-2 attachments. Without
    // `distinct: true` on the Attachment include, `count` would be inflated
    // by the joined attachment rows.
    const req = mockReq({
      user: asUser(alice, org),
      params: { conversationId: groupConversationId },
      query: { limit: 1, page: 1 },
    });
    const res = mockRes();
    await listMessages(req, res);
    assert.equal(res.statusCode, 200, JSON.stringify(res.body));

    const actualMessageCount = await Message.count({
      where: { conversation_id: groupConversationId },
    });
    assert.equal(res.body.pagination.total, actualMessageCount);
    assert.equal(res.body.messages.length, 1, "limit=1 must return exactly one message");
  });

  await t.test("25: non-member cannot list messages", async () => {
    // carol was removed from the group conversation in test 22, and is
    // still an active member of `org` -- this exercises the
    // "active org member but not a conversation member" path, distinct
    // from the cross-org checks below.
    const req = mockReq({
      user: asUser(carol, org),
      params: { conversationId: groupConversationId },
    });
    const res = mockRes();
    await listMessages(req, res);
    assert.equal(res.statusCode, 403);
  });

  await t.test("5: user from another organization cannot read messages", async () => {
    const req = mockReq({
      user: asUser(erin, otherOrg),
      params: { conversationId: groupConversationId },
    });
    const res = mockRes();
    await listMessages(req, res);
    assert.equal(res.statusCode, 403);
  });

  await t.test("6+32: user from another organization cannot send messages", async () => {
    const req = mockReq({
      user: asUser(erin, otherOrg),
      params: { conversationId: groupConversationId },
      body: { body: "I should not be able to post this." },
    });
    const res = mockRes();
    await createMessage(req, res);
    assert.equal(res.statusCode, 403);
  });
});
