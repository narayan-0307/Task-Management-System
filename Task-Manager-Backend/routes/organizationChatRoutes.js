const express = require("express");
const router = express.Router();
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

router.use(requireAuth);

router.get("/conversations", listConversations);
router.post("/conversations", createConversation);
router.get("/conversations/:conversationId", getConversation);

router.post("/conversations/:conversationId/members", addConversationMembers);
router.delete(
    "/conversations/:conversationId/members/:userId",
    removeConversationMember,
);

router.get("/conversations/:conversationId/messages", listMessages);
router.post("/conversations/:conversationId/messages", createMessage);

module.exports = router;
