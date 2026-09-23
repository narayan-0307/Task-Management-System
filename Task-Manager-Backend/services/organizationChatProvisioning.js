"use strict";

/**
 * Organization Chat — org-wide "HumanCare Team" conversation provisioning.
 *
 * ensureOrganizationChat() is idempotent: it can be called any number of
 * times for the same organization and will only ever create ONE org_wide
 * Conversation, self-heal its name/membership if needed, and never remove
 * historical or inactive ConversationMember rows.
 *
 * Wired (Step 6) into every place an active OrganizationMember row is
 * created: authController.js's register() and registerWithInvitation(),
 * config/passport.js's Google sign-up branch, and
 * organizationController.js's acceptInvitation().
 */

const { sequelize } = require("../config/db");
const {
    OrganizationMember,
    Conversation,
    ConversationMember,
} = require("../models");

const ORG_WIDE_CONVERSATION_NAME = "HumanCare Team";

/**
 * Deterministically pick the user who should be recorded as the org-wide
 * conversation's creator: the active "owner" if there is one, otherwise the
 * first active organization member. Never invents a user.
 *
 * @param {Array} activeMembers - active OrganizationMember rows
 * @returns {object|null}
 */
function selectCreator(activeMembers) {
    if (activeMembers.length === 0) {
        return null;
    }

    const owner = activeMembers.find((member) => member.role === "owner");
    return owner || activeMembers[0];
}

/**
 * Ensure that exactly one org_wide conversation ("HumanCare Team") exists
 * for the given organization, with every currently active
 * OrganizationMember represented as a ConversationMember.
 *
 * Idempotent and safe to call repeatedly:
 * - If the org_wide conversation already exists, it is reused (never
 *   duplicated), its name is corrected only if currently blank, and any
 *   active organization member missing a ConversationMember row is added.
 * - Historical/inactive ConversationMember rows are never removed.
 * - The conversation's type is never changed.
 *
 * @param {number} organizationId - MUST be a trusted, server-derived value;
 *   this function does not validate or look up the organization itself.
 * @param {object} [options]
 * @param {import("sequelize").Transaction} [options.transaction] - an
 *   already-open, caller-managed transaction to participate in (e.g. the
 *   same transaction a membership row was just created in), instead of
 *   opening a second one. The caller remains responsible for committing or
 *   rolling it back. When omitted, this function opens and manages its own
 *   transaction as before.
 * @returns {Promise<object>} the org_wide Conversation instance
 * @throws {Error} if the organization has no active OrganizationMember and
 *   no org_wide conversation exists yet (nothing is created in that case).
 */
async function ensureOrganizationChat(organizationId, options = {}) {
    const { transaction: externalTransaction } = options;

    const run = async (transaction) => {
        const activeMembers = await OrganizationMember.findAll({
            where: { organization_id: organizationId, is_active: true },
            order: [["created_at", "ASC"]],
            transaction,
        });

        let conversation = await Conversation.findOne({
            where: { organization_id: organizationId, type: "org_wide" },
            transaction,
        });

        if (!conversation) {
            const creator = selectCreator(activeMembers);

            if (!creator) {
                throw new Error(
                    `Cannot provision organization chat for organization ${organizationId}: no active organization members found.`,
                );
            }

            conversation = await Conversation.create(
                {
                    organization_id: organizationId,
                    type: "org_wide",
                    name: ORG_WIDE_CONVERSATION_NAME,
                    created_by: creator.user_id,
                },
                { transaction },
            );
        } else if (!conversation.name || !conversation.name.trim()) {
            // Repair path: self-heal a blank/null name without touching
            // anything else (type, created_by, historical members).
            conversation.name = ORG_WIDE_CONVERSATION_NAME;
            await conversation.save({ transaction });
        }

        if (activeMembers.length > 0) {
            const existingMembers = await ConversationMember.findAll({
                where: { conversation_id: conversation.id },
                attributes: ["user_id"],
                transaction,
            });
            const existingUserIds = new Set(
                existingMembers.map((member) => Number(member.user_id)),
            );

            const missingMembers = activeMembers.filter(
                (member) => !existingUserIds.has(Number(member.user_id)),
            );

            if (missingMembers.length > 0) {
                await ConversationMember.bulkCreate(
                    missingMembers.map((member) => ({
                        conversation_id: conversation.id,
                        user_id: member.user_id,
                    })),
                    { transaction },
                );
            }
        }

        return conversation;
    };

    if (externalTransaction) {
        return run(externalTransaction);
    }

    return sequelize.transaction(run);
}

module.exports = {
    ensureOrganizationChat,
    ORG_WIDE_CONVERSATION_NAME,
};
