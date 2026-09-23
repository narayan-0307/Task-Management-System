const express = require("express");
const router = express.Router();
const { requireAuth } = require("../middleware/authMiddleware");
const upload = require("../middleware/upload");
const {
    uploadOrgChatAttachment,
    listOrgChatAttachments,
    getOrgChatAttachment,
    deleteOrgChatAttachment,
} = require("../controllers/organizationChatAttachmentController");

router.use(requireAuth);

router.post(
    "/conversations/:conversationId/messages/:messageId/attachments",
    upload.single("file"),
    uploadOrgChatAttachment,
);

router.get(
    "/conversations/:conversationId/messages/:messageId/attachments",
    listOrgChatAttachments,
);

router.get(
    "/conversations/:conversationId/messages/:messageId/attachments/:attachmentId",
    getOrgChatAttachment,
);

router.delete(
    "/conversations/:conversationId/messages/:messageId/attachments/:attachmentId",
    deleteOrgChatAttachment,
);

module.exports = router;
