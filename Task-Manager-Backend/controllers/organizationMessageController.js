const { Message, User, Attachment } = require("../models");
const { isActiveOrgMember } = require("../utils/organizationAccess");
const { canAccessConversation } = require("../utils/organizationChatAccess");
const { emitOrgChatMessage } = require("../socket");
const { serializeAttachment } = require("./organizationChatAttachmentController");

const SAFE_USER_ATTRIBUTES = [
    "id",
    "first_name",
    "last_name",
    "email",
    "avatar_url",
    "job_title",
];

// Mirrors organizationChatAttachmentController.js's own SAFE_USER_ATTRIBUTES
// exactly -- the "uploader" shape returned alongside a message's attachments
// must stay identical to what GET .../attachments already returns.
const ATTACHMENT_UPLOADER_ATTRIBUTES = ["id", "first_name", "last_name", "email"];

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;
const MAX_BODY_LENGTH = 10000;

// Mirrors activityController.js / organizationChatController.js.
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

// Shared "may this user touch this conversation's messages" gate. Returns
// the access result on success, or writes an error response and returns
// null on failure.
async function requireConversationAccess(req, res) {
    const isOrgMember = await isActiveOrgMember(
        req.user.id,
        req.user.organization_id,
    );

    if (!isOrgMember) {
        res.status(403).json({
            message: "You are not an active member of this organization.",
        });
        return null;
    }

    const { conversationId } = req.params;
    const access = await canAccessConversation(req.user.id, conversationId);

    if (!access.allowed) {
        if (access.reason === "CONVERSATION_NOT_FOUND") {
            res.status(404).json({ message: "Conversation not found." });
        } else {
            res.status(403).json({
                message: "You do not have access to this conversation.",
            });
        }
        return null;
    }

    if (
        Number(access.conversation.organization_id) !==
        Number(req.user.organization_id)
    ) {
        res.status(404).json({ message: "Conversation not found." });
        return null;
    }

    return access;
}

// GET /api/chat/conversations/:conversationId/messages
exports.listMessages = async (req, res) => {
    try {
        const access = await requireConversationAccess(req, res);
        if (!access) return;

        const pagination = parsePagination(req.query);
        if (pagination.error) {
            return res.status(400).json({ message: pagination.error });
        }
        const { limit, page, offset } = pagination;

        // Step 29: a single query with an Attachment include -- reusing the
        // existing Message.hasMany(Attachment, { foreignKey: "org_message_id",
        // as: "attachments" }) association -- rather than one
        // Attachment.findAll() per message. `distinct: true` keeps `count`
        // accurate now that a hasMany include is present (without it, a
        // message with N attachments would inflate the JOINed row count);
        // Sequelize already applies limit/offset to the distinct parent
        // (Message) rows for a hasMany include, not to the joined rows.
        const { count, rows } = await Message.findAndCountAll({
            where: {
                conversation_id: access.conversation.id,
                organization_id: req.user.organization_id,
            },
            include: [
                {
                    model: User,
                    as: "sender",
                    attributes: SAFE_USER_ATTRIBUTES,
                },
                {
                    model: Attachment,
                    as: "attachments",
                    attributes: [
                        "id",
                        "file_name",
                        "file_size",
                        "mime_type",
                        "uploaded_by",
                        "created_at",
                    ],
                    include: [
                        {
                            model: User,
                            as: "uploader",
                            attributes: ATTACHMENT_UPLOADER_ATTRIBUTES,
                        },
                    ],
                },
            ],
            order: [
                ["id", "DESC"],
                [{ model: Attachment, as: "attachments" }, "created_at", "ASC"],
            ],
            distinct: true,
            limit,
            offset,
        });

        // Reuse the exact same attachment serialization the attachment API
        // itself returns (id, file_name, file_size, mime_type, uploaded_by,
        // created_at, url) -- never file_path, never a second incompatible
        // shape. A message with no attachments yields `attachments: []`,
        // never `undefined`, since the hasMany association always resolves
        // to an array.
        const messages = rows.map((row) => {
            const plainMessage = row.toJSON();
            return {
                ...plainMessage,
                attachments: (row.attachments || []).map((attachment) =>
                    serializeAttachment(
                        attachment,
                        access.conversation.id,
                        row.id,
                    ),
                ),
            };
        });

        return res.json({
            messages,
            pagination: {
                total: count,
                page,
                limit,
                total_pages: Math.ceil(count / limit),
            },
        });
    } catch (error) {
        console.error("List conversation messages error:", error);
        return res.status(500).json({
            message: "Server error while fetching messages.",
        });
    }
};

// POST /api/chat/conversations/:conversationId/messages
exports.createMessage = async (req, res) => {
    try {
        const access = await requireConversationAccess(req, res);
        if (!access) return;

        const { body } = req.body;

        if (typeof body !== "string" || !body.trim()) {
            return res.status(400).json({ message: "Message body is required." });
        }

        const trimmedBody = body.trim();

        if (trimmedBody.length > MAX_BODY_LENGTH) {
            return res.status(400).json({
                message: `Message body must be at most ${MAX_BODY_LENGTH} characters.`,
            });
        }

        // sender_id and organization_id are always derived from the
        // authenticated session and the conversation itself -- never from
        // the request body.
        const message = await Message.create({
            conversation_id: access.conversation.id,
            organization_id: access.conversation.organization_id,
            sender_id: req.user.id,
            body: trimmedBody,
        });

        const createdMessage = await Message.findByPk(message.id, {
            include: [
                {
                    model: User,
                    as: "sender",
                    attributes: SAFE_USER_ATTRIBUTES,
                },
            ],
        });

        // Realtime delivery is best-effort and only happens after the
        // message is successfully persisted above. If Socket.IO is not
        // initialized (e.g. in tests) or emitting otherwise fails,
        // emitOrgChatMessage logs and returns false -- it never throws, so
        // the message stays saved and the REST response still succeeds.
        emitOrgChatMessage(access.conversation.id, createdMessage);

        return res.status(201).json({ message: createdMessage });
    } catch (error) {
        console.error("Create conversation message error:", error);
        return res.status(500).json({
            message: "Server error while creating message.",
        });
    }
};
