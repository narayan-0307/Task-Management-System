const test = require("node:test");
const assert = require("node:assert/strict");

const { Organization, OrganizationMember, User } = require("../models");
const { isActiveOrgMember } = require("../utils/organizationAccess");

test("isActiveOrgMember", async (t) => {
  const suffix = Date.now();

  let org, otherOrg;
  let activeUser, inactiveUser, nonMemberUser, wrongOrgUser;

  t.after(async () => {
    if (org) await OrganizationMember.destroy({ where: { organization_id: org.id } });
    if (otherOrg) await OrganizationMember.destroy({ where: { organization_id: otherOrg.id } });
    const userIds = [activeUser, inactiveUser, nonMemberUser, wrongOrgUser]
      .filter(Boolean)
      .map((u) => u.id);
    if (userIds.length) await User.destroy({ where: { id: userIds } });
    if (org) await Organization.destroy({ where: { id: org.id } });
    if (otherOrg) await Organization.destroy({ where: { id: otherOrg.id } });
  });

  await t.test("fixtures set up", async () => {
    org = await Organization.create({
      name: `OrgAccess Test Org ${suffix}`,
      slug: `orgaccess-test-org-${suffix}`,
    });
    otherOrg = await Organization.create({
      name: `OrgAccess Other Org ${suffix}`,
      slug: `orgaccess-other-org-${suffix}`,
    });

    async function makeUser(label) {
      return User.create({
        first_name: label,
        last_name: "Test",
        email: `${label.toLowerCase()}-${suffix}@example.test`,
      });
    }

    activeUser = await makeUser("OrgAccessActive");
    inactiveUser = await makeUser("OrgAccessInactive");
    nonMemberUser = await makeUser("OrgAccessNonMember");
    wrongOrgUser = await makeUser("OrgAccessWrongOrg");

    await OrganizationMember.bulkCreate([
      { organization_id: org.id, user_id: activeUser.id, role: "member", is_active: true },
      { organization_id: org.id, user_id: inactiveUser.id, role: "member", is_active: false },
      { organization_id: otherOrg.id, user_id: wrongOrgUser.id, role: "member", is_active: true },
    ]);

    assert.ok(org.id && otherOrg.id, "fixtures created");
  });

  await t.test("active member => true", async () => {
    const result = await isActiveOrgMember(activeUser.id, org.id);
    assert.equal(result, true);
  });

  await t.test("inactive member => false", async () => {
    const result = await isActiveOrgMember(inactiveUser.id, org.id);
    assert.equal(result, false);
  });

  await t.test("non-member => false", async () => {
    const result = await isActiveOrgMember(nonMemberUser.id, org.id);
    assert.equal(result, false);
  });

  await t.test("wrong organization => false", async () => {
    // wrongOrgUser is active, but only in otherOrg, not org.
    const result = await isActiveOrgMember(wrongOrgUser.id, org.id);
    assert.equal(result, false);
  });
});
