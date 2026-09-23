const path = require("path");
const fs = require("fs");
const { Attachment, Message, User } = require("../models");
const { isActiveOrgMember } = require("../utils/organizationAccess");
const { canAccessConversation } = require("../utils/organizationChatAccess");
const { emitOrgChatAttachment } = require("../socket");

const UPLOAD_DIR = path.join(__dirname, "../uploads");

const SAFE_USER_ATTRIBUTES = ["id", "first_name", "last_name", "email"];

// Shared "may this user touch this conversation/message's attachments" gate.
// Mirrors requireConversationAccess() in organizationMessageController.js,
// with an added message-level check: the message must exist, belong to the
// conversation in the URL, and belong to the user's organization. On
// failure this writes the error response itself and returns null -- it
// never uses task/project resolveContext(), and organization membership
// alone is never treated as sufficient.
async function requireMessageAccess(req, res) {
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

    const { conversationId, messageId } = req.params;
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

    const message = await Message.findByPk(messageId);

    if (
        !message ||
        Number(message.conversation_id) !== Number(access.conversation.id) ||
        Number(message.organization_id) !== Number(req.user.organization_id)
    ) {
        res.status(404).json({ message: "Message not found." });
        return null;
    }

    return { conversation: access.conversation, message };
}

// Loads the attachment for a message-scoped attachment route, on top of
// requireMessageAccess(). Returns null (response already written) if
// access fails at any layer or the attachment does not belong to this
// exact message.
async function requireAttachmentAccess(req, res) {
    const access = await requireMessageAccess(req, res);
    if (!access) return null;

    const { attachmentId } = req.params;
    const attachment = await Attachment.findOne({
        where: {
            id: attachmentId,
            org_message_id: access.message.id,
        },
    });

    if (!attachment) {
        res.status(404).json({ message: "Attachment not found." });
        return null;
    }

    return { ...access, attachment };
}

// Takes explicit conversationId/messageId (rather than reading them off
// `req.params`) so this same serialization can be reused for a message
// fetched via listMessages() -- where the "current" messageId is per-row,
// not a single value on the request -- without inventing a second,
// incompatible attachment shape. Every call site in this file still has
// both ids on hand (from req.params or the already-resolved `access`
// object), so nothing here changes behavior for the existing attachment
// endpoints.
function serializeAttachment(attachment, conversationId, messageId) {
    return {
        id: attachment.id,
        file_name: attachment.file_name,
        file_size: attachment.file_size,
        mime_type: attachment.mime_type,
        uploaded_by: attachment.uploader
            ? attachment.uploader
            : attachment.uploaded_by,
        created_at: attachment.created_at,
        url: `/api/chat/conversations/${conversationId}/messages/${messageId}/attachments/${attachment.id}`,
    };
}

exports.serializeAttachment = serializeAttachment;

// POST /api/chat/conversations/:conversationId/messages/:messageId/attachments
exports.uploadOrgChatAttachment = async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ message: "No file uploaded." });
        }

        const access = await requireMessageAccess(req, res);
        if (!access) return;

        const attachment = await Attachment.create({
            org_message_id: access.message.id,
            organization_id: access.conversation.organization_id,
            uploaded_by: req.user.id,
            file_name: req.file.originalname,
            file_path: req.file.filename,
            file_size: req.file.size,
            mime_type: req.file.mimetype,
        });

        const serializedAttachment = serializeAttachment(
            attachment,
            access.conversation.id,
            access.message.id,
        );

        // Realtime delivery is best-effort and only happens after the
        // attachment is successfully persisted above -- mirrors
        // emitOrgChatMessage in organizationMessageController.js.
        // emitOrgChatAttachment never throws (Socket.IO not initialized is
        // logged and swallowed), so a socket failure can never fail this
        // REST request.
        emitOrgChatAttachment(
            access.conversation.id,
            access.message.id,
            serializedAttachment,
        );

        return res.status(201).json({
            message: "File uploaded successfully.",
            attachment: serializedAttachment,
        });
    } catch (error) {
        console.error("Upload organization chat attachment error:", error);
        return res.status(500).json({
            message: "Server error while uploading file.",
        });
    }
};

// GET /api/chat/conversations/:conversationId/messages/:messageId/attachments
exports.listOrgChatAttachments = async (req, res) => {
    try {
        const access = await requireMessageAccess(req, res);
        if (!access) return;

        const attachments = await Attachment.findAll({
            where: { org_message_id: access.message.id },
            include: [
                {
                    model: User,
                    as: "uploader",
                    attributes: SAFE_USER_ATTRIBUTES,
                },
            ],
            order: [["created_at", "ASC"]],
        });

        return res.json({
            attachments: attachments.map((a) =>
                serializeAttachment(a, access.conversation.id, access.message.id),
            ),
        });
    } catch (error) {
        console.error("List organization chat attachments error:", error);
        return res.status(500).json({
            message: "Server error while fetching attachments.",
        });
    }
};

// GET /api/chat/conversations/:conversationId/messages/:messageId/attachments/:attachmentId
// Protected file delivery endpoint -- the attachment ID resolves the DB row
// first, and the row's file_path (never request input) is what is joined
// onto the uploads directory.
exports.getOrgChatAttachment = async (req, res) => {
    try {
        const access = await requireAttachmentAccess(req, res);
        if (!access) return;

        const { attachment } = access;
        const resolvedUploadDir = path.resolve(UPLOAD_DIR);
        const resolvedPath = path.resolve(
            resolvedUploadDir,
            path.basename(attachment.file_path),
        );

        if (
            resolvedPath !== resolvedUploadDir &&
            !resolvedPath.startsWith(resolvedUploadDir + path.sep)
        ) {
            return res.status(404).json({ message: "Attachment not found." });
        }

        if (!fs.existsSync(resolvedPath)) {
            return res.status(404).json({ message: "Attachment file not found." });
        }

        res.set("Content-Type", attachment.mime_type);
        return res.sendFile(resolvedPath, {}, (err) => {
            if (err && !res.headersSent) {
                console.error("Send organization chat attachment error:", err);
                res.status(500).json({
                    message: "Server error while sending file.",
                });
            }
        });
    } catch (error) {
        console.error("Get organization chat attachment error:", error);
        return res.status(500).json({
            message: "Server error while fetching attachment.",
        });
    }
};

// DELETE /api/chat/conversations/:conversationId/messages/:messageId/attachments/:attachmentId
exports.deleteOrgChatAttachment = async (req, res) => {
    try {
        const access = await requireAttachmentAccess(req, res);
        if (!access) return;

        const { attachment } = access;

        const canDelete =
            attachment.uploaded_by === req.user.id ||
            ["owner", "admin", "manager"].includes(req.user.role);

        if (!canDelete) {
            return res.status(403).json({
                message: "You cannot delete this attachment.",
            });
        }

        const resolvedUploadDir = path.resolve(UPLOAD_DIR);
        const resolvedPath = path.resolve(
            resolvedUploadDir,
            path.basename(attachment.file_path),
        );

        if (
            (resolvedPath === resolvedUploadDir ||
                resolvedPath.startsWith(resolvedUploadDir + path.sep)) &&
            fs.existsSync(resolvedPath)
        ) {
            fs.unlinkSync(resolvedPath);
        }

        await attachment.destroy();

        return res.json({ message: "Attachment deleted." });
    } catch (error) {
        console.error("Delete organization chat attachment error:", error);
        return res.status(500).json({
            message: "Server error while deleting attachment.",
        });
    }
};
