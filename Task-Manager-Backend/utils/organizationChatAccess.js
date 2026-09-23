const { Op } = require("sequelize");
const { Conversation, ConversationMember, OrganizationMember } = require("../models");
const { isActiveOrgMember } = require("./organizationAccess");

/**
 * Check whether a user is allowed to access a specific Organization Chat
 * conversation.
 *
 * Access requires BOTH:
 * - an active OrganizationMember row for the conversation's organization
 * - an explicit ConversationMember row for this exact conversation
 *
 * This applies uniformly to direct, group, and org_wide conversations --
 * org_wide conversations are not treated as an unrestricted bypass: a user
 * must still hold a ConversationMember row for them (provisioning that row
 * for active organization members is a separate, later step).
 *
 * No role, task, or project logic belongs here.
 *
 * @param {number} userId
 * @param {number} conversationId
 * @returns {Promise<{
 *   allowed: boolean,
 *   conversation: object|null,
 *   conversationMember: object|null,
 *   reason: string
 * }>}
 */
async function canAccessConversation(userId, conversationId) {
    const conversation = await Conversation.findByPk(conversationId);

    if (!conversation) {
        return {
            allowed: false,
            conversation: null,
            conversationMember: null,
            reason: "CONVERSATION_NOT_FOUND",
        };
    }

    const isOrgMember = await isActiveOrgMember(
        userId,
        conversation.organization_id,
    );

    if (!isOrgMember) {
        return {
            allowed: false,
            conversation,
            conversationMember: null,
            reason: "NOT_ORGANIZATION_MEMBER",
        };
    }

    const conversationMember = await ConversationMember.findOne({
        where: {
            conversation_id: conversation.id,
            user_id: userId,
        },
    });

    if (!conversationMember) {
        return {
            allowed: false,
            conversation,
            conversationMember: null,
            reason: "NOT_CONVERSATION_MEMBER",
        };
    }

    return {
        allowed: true,
        conversation,
        conversationMember,
        reason: "CONVERSATION_MEMBER",
    };
}

/**
 * Verify that every user ID in a list is an active member of the given
 * organization.
 *
 * Normalizes input (coerces to integers, drops duplicates) and rejects an
 * empty list outright. Does not perform any role/task/project checks.
 *
 * @param {Array<number|string>} userIds
 * @param {number} organizationId
 * @returns {Promise<{
 *   valid: boolean,
 *   userIds: number[],
 *   missingUserIds: number[]
 * }>}
 */
async function areActiveOrgMembers(userIds, organizationId) {
    const normalized = Array.from(
        new Set(
            (Array.isArray(userIds) ? userIds : [])
                .map((id) => Number(id))
                .filter((id) => Number.isInteger(id) && id > 0),
        ),
    );

    if (normalized.length === 0) {
        return {
            valid: false,
            userIds: [],
            missingUserIds: [],
        };
    }

    const activeMembers = await OrganizationMember.findAll({
        where: {
            organization_id: organizationId,
            user_id: { [Op.in]: normalized },
            is_active: true,
        },
        attributes: ["user_id"],
    });

    const activeUserIds = new Set(activeMembers.map((m) => Number(m.user_id)));
    const missingUserIds = normalized.filter((id) => !activeUserIds.has(id));

    return {
        valid: missingUserIds.length === 0,
        userIds: normalized,
        missingUserIds,
    };
}

module.exports = {
    canAccessConversation,
    areActiveOrgMembers,
};
