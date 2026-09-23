const { OrganizationMember } = require("../models");

/**
 * Check whether a user is an active member of a given organization.
 *
 * This is intentionally narrow: "user X is an active member of
 * organization Y" only. No role, task, or project logic belongs here --
 * callers that need role-based decisions must load the OrganizationMember
 * row themselves.
 *
 * @param {number} userId
 * @param {number} organizationId
 * @returns {Promise<boolean>}
 */
async function isActiveOrgMember(userId, organizationId) {
    const organizationMember = await OrganizationMember.findOne({
        where: {
            organization_id: organizationId,
            user_id: userId,
            is_active: true,
        },
    });

    return organizationMember !== null;
}

module.exports = {
    isActiveOrgMember,
};
