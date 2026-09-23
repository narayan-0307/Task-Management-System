const { Op } = require("sequelize");
const { sequelize } = require("../config/db");
const { Conversation, ConversationMember, OrganizationMember, User } = require("../models");
const { isActiveOrgMember } = require("../utils/organizationAccess");
const {
    canAccessConversation,
    areActiveOrgMembers,
} = require("../utils/organizationChatAccess");
const { evictUserFromConversationRoom } = require("../socket");

const SAFE_USER_ATTRIBUTES = [
    "id",
    "first_name",
    "last_name",
    "email",
    "avatar_url",
    "job_title",
];

// Step 24: who may add/remove members on a GROUP conversation. The creator
// always may; otherwise the caller's organization-level role must be one of
// these. Role comes from the OrganizationMember row (organization-level
// authorization), never from User -- a user's org role can differ per
// organization and the JWT's `role` claim is not re-verified here.
const GROUP_MANAGEMENT_ROLES = new Set(["owner", "admin", "manager"]);

async function canManageGroupMembership(userId, conversation) {
    if (Number(conversation.created_by) === Number(userId)) {
        return true;
    }

    const organizationMember = await OrganizationMember.findOne({
        where: {
            organization_id: conversation.organization_id,
            user_id: userId,
            is_active: true,
        },
        attributes: ["role"],
    });

    return !!organizationMember && GROUP_MANAGEMENT_ROLES.has(organizationMember.role);
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

// Parse a query value that must be a positive integer. Returns null if
// absent, or NaN if present but invalid (so the caller can reject it).
// Mirrors activityController.js's parsePositiveInt.
function parsePositiveInt(value) {
    if (value === undefined || value === null || value === "") {
        return null;
    }
    const num = Number(value);
    if (!Number.isInteger(num) || num <= 0) {
        return NaN;
    }
    return num;
}

function parsePagination(query) {
    let limit = parsePositiveInt(query.limit);
    if (Number.isNaN(limit)) return { error: "Invalid limit." };
    if (limit === null) limit = DEFAULT_LIMIT;
    if (limit > MAX_LIMIT) limit = MAX_LIMIT;

    let page = parsePositiveInt(query.page);
    if (Number.isNaN(page)) return { error: "Invalid page." };
    if (page === null) page = 1;

    return { limit, page, offset: (page - 1) * limit };
}

// GET /api/chat/conversations
exports.listConversations = async (req, res) => {
    try {
        const isOrgMember = await isActiveOrgMember(
            req.user.id,
            req.user.organization_id,
        );

        if (!isOrgMember) {
            return res.status(403).json({
                message: "You are not an active member of this organization.",
            });
        }

        const pagination = parsePagination(req.query);
        if (pagination.error) {
            return res.status(400).json({ message: pagination.error });
        }
        const { limit, page, offset } = pagination;

        const { count, rows } = await Conversation.findAndCountAll({
            where: { organization_id: req.user.organization_id },
            include: [
                {
                    model: ConversationMember,
                    as: "members",
                    where: { user_id: req.user.id },
                    attributes: ["joined_at", "last_read_at"],
                    required: true,
                },
            ],
            order: [["updated_at", "DESC"]],
            limit,
            offset,
            distinct: true,
        });

        // For direct conversations, the sidebar needs the OTHER
        // participant's display info (Step 21) -- fetched here in ONE
        // batched query across every direct conversation on this page,
        // never one getConversation()-style lookup per row. Keyed by
        // conversation_id -> that conversation's non-current-user member.
        const directConversationIds = rows
            .filter((conversation) => conversation.type === "direct")
            .map((conversation) => conversation.id);

        const directParticipantByConversationId = new Map();

        if (directConversationIds.length > 0) {
            const otherMembers = await ConversationMember.findAll({
                where: {
                    conversation_id: { [Op.in]: directConversationIds },
                    user_id: { [Op.ne]: req.user.id },
                },
                include: [
                    {
                        model: User,
                        as: "user",
                        attributes: SAFE_USER_ATTRIBUTES,
                    },
                ],
            });

            for (const member of otherMembers) {
                // A direct conversation has exactly two members; only one
                // (by construction) can have user_id !== req.user.id, so
                // the first/only match found per conversation_id is it --
                // no assumption about array ordering from the main query.
                if (!directParticipantByConversationId.has(member.conversation_id)) {
                    directParticipantByConversationId.set(
                        member.conversation_id,
                        member.user,
                    );
                }
            }
        }

        const conversations = rows.map((conversation) => {
            const membership = conversation.members[0];
            const base = {
                id: conversation.id,
                type: conversation.type,
                name: conversation.name,
                organization_id: conversation.organization_id,
                created_by: conversation.created_by,
                created_at: conversation.created_at,
                updated_at: conversation.updated_at,
                membership: {
                    joined_at: membership.joined_at,
                    last_read_at: membership.last_read_at,
                },
            };

            if (conversation.type === "direct") {
                const participant = directParticipantByConversationId.get(
                    conversation.id,
                );
                base.direct_participant = participant
                    ? {
                          id: participant.id,
                          first_name: participant.first_name,
                          last_name: participant.last_name,
                          email: participant.email,
                          avatar_url: participant.avatar_url,
                      }
                    : null;
            }

            return base;
        });

        return res.json({
            conversations,
            pagination: {
                total: count,
                page,
                limit,
                total_pages: Math.ceil(count / limit),
            },
        });
    } catch (error) {
        console.error("List conversations error:", error);
        return res.status(500).json({
            message: "Server error while fetching conversations.",
        });
    }
};

// GET /api/chat/conversations/:conversationId
exports.getConversation = async (req, res) => {
    try {
        const isOrgMember = await isActiveOrgMember(
            req.user.id,
            req.user.organization_id,
        );

        if (!isOrgMember) {
            return res.status(403).json({
                message: "You are not an active member of this organization.",
            });
        }

        const { conversationId } = req.params;
        const access = await canAccessConversation(req.user.id, conversationId);

        if (!access.allowed) {
            if (access.reason === "CONVERSATION_NOT_FOUND") {
                return res.status(404).json({ message: "Conversation not found." });
            }
            return res.status(403).json({
                message: "You do not have access to this conversation.",
            });
        }

        // The conversation's own organization is the source of truth for
        // canAccessConversation, but the current session is scoped to a
        // single organization -- reject anything outside it explicitly.
        if (
            Number(access.conversation.organization_id) !==
            Number(req.user.organization_id)
        ) {
            return res.status(404).json({ message: "Conversation not found." });
        }

        const members = await ConversationMember.findAll({
            where: { conversation_id: access.conversation.id },
            include: [
                {
                    model: User,
                    as: "user",
                    attributes: SAFE_USER_ATTRIBUTES,
                },
            ],
            order: [["created_at", "ASC"]],
        });

        return res.json({
            conversation: {
                id: access.conversation.id,
                type: access.conversation.type,
                name: access.conversation.name,
                organization_id: access.conversation.organization_id,
                created_by: access.conversation.created_by,
                created_at: access.conversation.created_at,
                updated_at: access.conversation.updated_at,
            },
            members,
        });
    } catch (error) {
        console.error("Get conversation error:", error);
        return res.status(500).json({
            message: "Server error while fetching conversation.",
        });
    }
};

// POST /api/chat/conversations
exports.createConversation = async (req, res) => {
    try {
        const isOrgMember = await isActiveOrgMember(
            req.user.id,
            req.user.organization_id,
        );

        if (!isOrgMember) {
            return res.status(403).json({
                message: "You are not an active member of this organization.",
            });
        }

        const { type, name, user_ids } = req.body;

        if (type !== "direct" && type !== "group") {
            return res.status(400).json({
                message: 'type must be "direct" or "group".',
            });
        }

        const organizationId = req.user.organization_id;

        // Normalize + dedupe requested member IDs, then split out the other
        // members (the creator is always added separately and is never
        // trusted from the client for membership-count purposes).
        const requestedIds = Array.from(
            new Set(
                (Array.isArray(user_ids) ? user_ids : [])
                    .map((id) => Number(id))
                    .filter((id) => Number.isInteger(id) && id > 0),
            ),
        );
        const otherUserIds = requestedIds.filter(
            (id) => id !== Number(req.user.id),
        );

        if (type === "direct" && otherUserIds.length !== 1) {
            return res.status(400).json({
                message: "A direct conversation requires exactly one other user.",
            });
        }

        if (type === "group" && otherUserIds.length < 1) {
            return res.status(400).json({
                message: "A group conversation requires at least one other member.",
            });
        }

        let conversationName = null;
        if (type === "group") {
            if (typeof name !== "string" || !name.trim()) {
                return res.status(400).json({
                    message: "name is required for a group conversation.",
                });
            }
            conversationName = name.trim();
        }

        const membershipCheck = await areActiveOrgMembers(
            otherUserIds,
            organizationId,
        );

        if (!membershipCheck.valid) {
            return res.status(400).json({
                message:
                    "One or more invited users are not active members of this organization.",
                missing_user_ids: membershipCheck.missingUserIds,
            });
        }

        // Direct conversations are deduplicated: reuse an existing one between
        // the exact same two users in this organization instead of creating a
        // second one.
        if (type === "direct") {
            const otherUserId = otherUserIds[0];

            const candidates = await Conversation.findAll({
                where: { organization_id: organizationId, type: "direct" },
                include: [
                    {
                        model: ConversationMember,
                        as: "members",
                        attributes: ["user_id"],
                    },
                ],
            });

            const existing = candidates.find((conversation) => {
                const memberIds = conversation.members.map((m) => Number(m.user_id));
                return (
                    memberIds.length === 2 &&
                    memberIds.includes(Number(req.user.id)) &&
                    memberIds.includes(otherUserId)
                );
            });

            if (existing) {
                return res.status(200).json({
                    conversation: existing,
                    created: false,
                });
            }
        }

        const allMemberIds = Array.from(
            new Set([Number(req.user.id), ...otherUserIds]),
        );

        const conversation = await sequelize.transaction(async (transaction) => {
            const createdConversation = await Conversation.create(
                {
                    organization_id: organizationId,
                    type,
                    name: conversationName,
                    created_by: req.user.id,
                },
                { transaction },
            );

            await ConversationMember.bulkCreate(
                allMemberIds.map((userId) => ({
                    conversation_id: createdConversation.id,
                    user_id: userId,
                })),
                { transaction },
            );

            return createdConversation;
        });

        return res.status(201).json({
            conversation,
            created: true,
        });
    } catch (error) {
        console.error("Create conversation error:", error);
        return res.status(500).json({
            message: "Server error while creating conversation.",
        });
    }
};

// POST /api/chat/conversations/:conversationId/members
exports.addConversationMembers = async (req, res) => {
    try {
        const isOrgMember = await isActiveOrgMember(
            req.user.id,
            req.user.organization_id,
        );

        if (!isOrgMember) {
            return res.status(403).json({
                message: "You are not an active member of this organization.",
            });
        }

        const { conversationId } = req.params;
        const access = await canAccessConversation(req.user.id, conversationId);

        if (!access.allowed) {
            if (access.reason === "CONVERSATION_NOT_FOUND") {
                return res.status(404).json({ message: "Conversation not found." });
            }
            return res.status(403).json({
                message: "You do not have access to this conversation.",
            });
        }

        if (
            Number(access.conversation.organization_id) !==
            Number(req.user.organization_id)
        ) {
            return res.status(404).json({ message: "Conversation not found." });
        }

        if (access.conversation.type !== "group") {
            return res.status(400).json({
                message: "Only group conversations support adding members.",
            });
        }

        const canManage = await canManageGroupMembership(
            req.user.id,
            access.conversation,
        );

        if (!canManage) {
            return res.status(403).json({
                message:
                    "Only the group creator or an organization owner, admin, or manager can add members.",
            });
        }

        const { user_ids } = req.body;
        const requestedIds = Array.from(
            new Set(
                (Array.isArray(user_ids) ? user_ids : [])
                    .map((id) => Number(id))
                    .filter((id) => Number.isInteger(id) && id > 0),
            ),
        );

        if (requestedIds.length === 0) {
            return res.status(400).json({ message: "user_ids is required." });
        }

        const membershipCheck = await areActiveOrgMembers(
            requestedIds,
            req.user.organization_id,
        );

        if (!membershipCheck.valid) {
            return res.status(400).json({
                message:
                    "One or more users are not active members of this organization.",
                missing_user_ids: membershipCheck.missingUserIds,
            });
        }

        const existingMembers = await ConversationMember.findAll({
            where: { conversation_id: access.conversation.id },
            attributes: ["user_id"],
        });
        const existingUserIds = new Set(
            existingMembers.map((m) => Number(m.user_id)),
        );

        const newUserIds = requestedIds.filter(
            (id) => !existingUserIds.has(id),
        );

        if (newUserIds.length > 0) {
            await ConversationMember.bulkCreate(
                newUserIds.map((userId) => ({
                    conversation_id: access.conversation.id,
                    user_id: userId,
                })),
            );
        }

        const members = await ConversationMember.findAll({
            where: { conversation_id: access.conversation.id },
            include: [
                {
                    model: User,
                    as: "user",
                    attributes: SAFE_USER_ATTRIBUTES,
                },
            ],
            order: [["created_at", "ASC"]],
        });

        return res.status(200).json({
            message: "Members added successfully.",
            added_user_ids: newUserIds,
            members,
        });
    } catch (error) {
        console.error("Add conversation members error:", error);
        return res.status(500).json({
            message: "Server error while adding conversation members.",
        });
    }
};

// DELETE /api/chat/conversations/:conversationId/members/:userId
exports.removeConversationMember = async (req, res) => {
    try {
        const isOrgMember = await isActiveOrgMember(
            req.user.id,
            req.user.organization_id,
        );

        if (!isOrgMember) {
            return res.status(403).json({
                message: "You are not an active member of this organization.",
            });
        }

        const { conversationId, userId } = req.params;
        const access = await canAccessConversation(req.user.id, conversationId);

        if (!access.allowed) {
            if (access.reason === "CONVERSATION_NOT_FOUND") {
                return res.status(404).json({ message: "Conversation not found." });
            }
            return res.status(403).json({
                message: "You do not have access to this conversation.",
            });
        }

        if (
            Number(access.conversation.organization_id) !==
            Number(req.user.organization_id)
        ) {
            return res.status(404).json({ message: "Conversation not found." });
        }

        if (access.conversation.type !== "group") {
            return res.status(400).json({
                message: "Members can only be removed from group conversations.",
            });
        }

        const targetMember = await ConversationMember.findOne({
            where: { conversation_id: access.conversation.id, user_id: userId },
        });

        if (!targetMember) {
            return res.status(404).json({
                message: "Member not found in this conversation.",
            });
        }

        // Step 24: the creator can never be removed -- by anyone, including
        // themselves -- since there is no ownership-transfer flow yet and an
        // ownerless group is not a state we want to allow.
        if (Number(userId) === Number(access.conversation.created_by)) {
            return res.status(400).json({
                message: "Group creator cannot be removed.",
            });
        }

        const isSelfRemoval = Number(userId) === Number(req.user.id);
        const canManage = await canManageGroupMembership(
            req.user.id,
            access.conversation,
        );

        if (!canManage && !isSelfRemoval) {
            return res.status(403).json({
                message:
                    "Only the group creator or an organization owner, admin, or manager can remove other members.",
            });
        }

        const memberCount = await ConversationMember.count({
            where: { conversation_id: access.conversation.id },
        });

        if (memberCount <= 1) {
            return res.status(400).json({
                message: "Cannot remove the last remaining member.",
            });
        }

        await targetMember.destroy();

        // Evict any already-connected socket(s) this user has open from the
        // conversation's realtime room so removal takes effect immediately,
        // not just on their next REST call. Best-effort: never fails the
        // primary request (mirrors evictUserFromTaskRoom for Task Chat,
        // which this does not touch).
        await evictUserFromConversationRoom(userId, access.conversation.id);

        return res.json({ message: "Member removed successfully." });
    } catch (error) {
        console.error("Remove conversation member error:", error);
        return res.status(500).json({
            message: "Server error while removing conversation member.",
        });
    }
};
