const test = require("node:test");
const assert = require("node:assert/strict");

const {
  Organization,
  OrganizationMember,
  User,
  Conversation,
  ConversationMember,
} = require("../models");

const {
  ensureOrganizationChat,
  ORG_WIDE_CONVERSATION_NAME,
} = require("../services/organizationChatProvisioning");

test("Organization Chat provisioning — Step 5", async (t) => {
  const suffix = Date.now();
  const createdOrgIds = [];
  const createdUserIds = [];

  t.after(async () => {
    if (createdOrgIds.length) {
      const conversations = await Conversation.findAll({
        where: { organization_id: createdOrgIds },
        attributes: ["id"],
      });
      const conversationIds = conversations.map((c) => c.id);
      if (conversationIds.length) {
        await ConversationMember.destroy({
          where: { conversation_id: conversationIds },
        });
        await Conversation.destroy({ where: { id: conversationIds } });
      }
      await OrganizationMember.destroy({
        where: { organization_id: createdOrgIds },
      });
    }
    if (createdUserIds.length) {
      await User.destroy({ where: { id: createdUserIds } });
    }
    if (createdOrgIds.length) {
      await Organization.destroy({ where: { id: createdOrgIds } });
    }
  });

  async function makeOrg(label) {
    const org = await Organization.create({
      name: `OrgChatProvisioning ${label} ${suffix}`,
      slug: `orgchatprov-${label.toLowerCase()}-${suffix}`,
    });
    createdOrgIds.push(org.id);
    return org;
  }

  async function makeUser(label) {
    const user = await User.create({
      first_name: label,
      last_name: "Test",
      email: `${label.toLowerCase()}-${suffix}@example.test`,
    });
    createdUserIds.push(user.id);
    return user;
  }

  // -----------------------------------------------------------------
  // 1-6, 8: fresh organization, mixed roles, plus an unrelated user who
  // is NOT an OrganizationMember at all.
  // -----------------------------------------------------------------
  await t.test("1-6+8: creates org-wide conversation for a fresh organization", async () => {
    const org = await makeOrg("Fresh");
    const owner = await makeUser("ProvOwner");
    const member1 = await makeUser("ProvMember1");
    const member2 = await makeUser("ProvMember2");
    const nonMember = await makeUser("ProvNonMember"); // never added to org

    await OrganizationMember.bulkCreate([
      { organization_id: org.id, user_id: owner.id, role: "owner", is_active: true },
      { organization_id: org.id, user_id: member1.id, role: "member", is_active: true },
      { organization_id: org.id, user_id: member2.id, role: "member", is_active: true },
    ]);

    const conversation = await ensureOrganizationChat(org.id);

    // 1
    assert.ok(conversation && conversation.id, "conversation created");
    // 2
    assert.equal(conversation.type, "org_wide");
    // 3
    assert.equal(conversation.name, ORG_WIDE_CONVERSATION_NAME);
    // 4
    assert.equal(Number(conversation.organization_id), Number(org.id));
    // 5: created_by must be the owner (deterministic owner-first selection)
    assert.equal(Number(conversation.created_by), Number(owner.id));

    const members = await ConversationMember.findAll({
      where: { conversation_id: conversation.id },
    });
    const memberIds = members.map((m) => Number(m.user_id)).sort();

    // 6: all active org members present
    assert.deepEqual(memberIds, [owner.id, member1.id, member2.id].sort());
    // 8: the never-added user must not appear
    assert.ok(!memberIds.includes(nonMember.id));

    // Exactly one org_wide conversation exists for this org.
    const count = await Conversation.count({
      where: { organization_id: org.id, type: "org_wide" },
    });
    assert.equal(count, 1);
  });

  // -----------------------------------------------------------------
  // 7: inactive members excluded from initial creation
  // -----------------------------------------------------------------
  await t.test("7: inactive organization members are excluded", async () => {
    const org = await makeOrg("Inactive");
    const owner = await makeUser("ProvOwner2");
    const inactiveUser = await makeUser("ProvInactive");

    await OrganizationMember.bulkCreate([
      { organization_id: org.id, user_id: owner.id, role: "owner", is_active: true },
      { organization_id: org.id, user_id: inactiveUser.id, role: "member", is_active: false },
    ]);

    const conversation = await ensureOrganizationChat(org.id);

    const members = await ConversationMember.findAll({
      where: { conversation_id: conversation.id },
    });
    const memberIds = members.map((m) => Number(m.user_id));

    assert.deepEqual(memberIds, [owner.id]);
    assert.ok(!memberIds.includes(inactiveUser.id));
  });

  // -----------------------------------------------------------------
  // 5 (no owner case): first active member selected when no owner exists
  // -----------------------------------------------------------------
  await t.test("5 (no owner): first active member becomes created_by when no owner exists", async () => {
    const org = await makeOrg("NoOwner");
    const first = await makeUser("ProvFirst");
    const second = await makeUser("ProvSecond");

    await OrganizationMember.bulkCreate([
      { organization_id: org.id, user_id: first.id, role: "member", is_active: true },
      { organization_id: org.id, user_id: second.id, role: "manager", is_active: true },
    ]);

    const conversation = await ensureOrganizationChat(org.id);
    assert.equal(Number(conversation.created_by), Number(first.id));
  });

  // -----------------------------------------------------------------
  // 9-10: idempotency
  // -----------------------------------------------------------------
  await t.test("9+10: running provisioning twice does not duplicate conversation or members", async () => {
    const org = await makeOrg("Idempotent");
    const owner = await makeUser("ProvIdemOwner");
    const member = await makeUser("ProvIdemMember");

    await OrganizationMember.bulkCreate([
      { organization_id: org.id, user_id: owner.id, role: "owner", is_active: true },
      { organization_id: org.id, user_id: member.id, role: "member", is_active: true },
    ]);

    const first = await ensureOrganizationChat(org.id);
    const second = await ensureOrganizationChat(org.id);

    // 9
    assert.equal(first.id, second.id);
    const conversationCount = await Conversation.count({
      where: { organization_id: org.id, type: "org_wide" },
    });
    assert.equal(conversationCount, 1);

    // 10
    const memberCount = await ConversationMember.count({
      where: { conversation_id: first.id },
    });
    assert.equal(memberCount, 2);
  });

  // -----------------------------------------------------------------
  // 11: repair a missing member
  // -----------------------------------------------------------------
  await t.test("11: existing org-wide conversation with missing member gets repaired", async () => {
    const org = await makeOrg("Repair");
    const owner = await makeUser("ProvRepairOwner");
    const lateMember = await makeUser("ProvRepairLate");

    await OrganizationMember.create({
      organization_id: org.id,
      user_id: owner.id,
      role: "owner",
      is_active: true,
    });

    const conversation = await ensureOrganizationChat(org.id);

    let members = await ConversationMember.findAll({
      where: { conversation_id: conversation.id },
    });
    assert.equal(members.length, 1);

    // A new active member joins the organization AFTER the conversation
    // was first provisioned.
    await OrganizationMember.create({
      organization_id: org.id,
      user_id: lateMember.id,
      role: "member",
      is_active: true,
    });

    const repaired = await ensureOrganizationChat(org.id);
    assert.equal(repaired.id, conversation.id, "must reuse the same conversation");

    members = await ConversationMember.findAll({
      where: { conversation_id: conversation.id },
    });
    const memberIds = members.map((m) => Number(m.user_id)).sort();
    assert.deepEqual(memberIds, [owner.id, lateMember.id].sort());
  });

  // -----------------------------------------------------------------
  // 12: inactive member's historical membership is retained, not removed
  // -----------------------------------------------------------------
  await t.test("12: existing org-wide conversation with inactive member retains historical membership", async () => {
    const org = await makeOrg("Historical");
    const owner = await makeUser("ProvHistOwner");
    const laterInactive = await makeUser("ProvHistInactive");

    await OrganizationMember.bulkCreate([
      { organization_id: org.id, user_id: owner.id, role: "owner", is_active: true },
      { organization_id: org.id, user_id: laterInactive.id, role: "member", is_active: true },
    ]);

    const conversation = await ensureOrganizationChat(org.id);

    let members = await ConversationMember.findAll({
      where: { conversation_id: conversation.id },
    });
    assert.equal(members.length, 2);

    // The member is deactivated (e.g. removed from the org) AFTER joining
    // the conversation -- their historical ConversationMember row must
    // survive a re-run.
    await OrganizationMember.update(
      { is_active: false },
      { where: { organization_id: org.id, user_id: laterInactive.id } },
    );

    await ensureOrganizationChat(org.id);

    members = await ConversationMember.findAll({
      where: { conversation_id: conversation.id },
    });
    const memberIds = members.map((m) => Number(m.user_id)).sort();
    assert.deepEqual(
      memberIds,
      [owner.id, laterInactive.id].sort(),
      "the now-inactive member's ConversationMember row must not be removed",
    );
  });

  // -----------------------------------------------------------------
  // 13: no active members at all -- fails cleanly, creates nothing
  // -----------------------------------------------------------------
  await t.test("13: organization with no active members fails cleanly and creates nothing", async () => {
    const org = await makeOrg("NoActive");
    const inactiveOnly = await makeUser("ProvNoActive");

    await OrganizationMember.create({
      organization_id: org.id,
      user_id: inactiveOnly.id,
      role: "member",
      is_active: false,
    });

    await assert.rejects(() => ensureOrganizationChat(org.id));

    const conversationCount = await Conversation.count({
      where: { organization_id: org.id, type: "org_wide" },
    });
    assert.equal(conversationCount, 0);
  });

  // -----------------------------------------------------------------
  // 14: blank name gets corrected
  // -----------------------------------------------------------------
  await t.test("14: existing org-wide conversation with blank name gets corrected", async () => {
    const org = await makeOrg("BlankName");
    const owner = await makeUser("ProvBlankOwner");

    await OrganizationMember.create({
      organization_id: org.id,
      user_id: owner.id,
      role: "owner",
      is_active: true,
    });

    // Simulate a pre-existing org_wide conversation created out-of-band
    // with a null name (e.g. by a future manual insert or a bug).
    const preExisting = await Conversation.create({
      organization_id: org.id,
      type: "org_wide",
      name: null,
      created_by: owner.id,
    });

    const repaired = await ensureOrganizationChat(org.id);

    assert.equal(repaired.id, preExisting.id, "must reuse the same conversation, not create a new one");
    assert.equal(repaired.name, ORG_WIDE_CONVERSATION_NAME);

    const conversationCount = await Conversation.count({
      where: { organization_id: org.id, type: "org_wide" },
    });
    assert.equal(conversationCount, 1);
  });
});
