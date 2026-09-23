import api from "./client.js";

// GET /api/chat/conversations — conversations the current user belongs to,
// scoped to their organization automatically by the backend (JWT).
export const listConversations = ({ page = 1, limit = 50 } = {}) =>
  api.get("/chat/conversations", { params: { page, limit } });

// GET /api/chat/conversations/:conversationId
export const getConversation = (conversationId) =>
  api.get(`/chat/conversations/${conversationId}`);

// POST /api/chat/conversations — type: "direct"
export const createDirectConversation = (userIds) =>
  api.post("/chat/conversations", {
    type: "direct",
    user_ids: userIds,
  });

// POST /api/chat/conversations — type: "group"
export const createGroupConversation = (name, userIds) =>
  api.post("/chat/conversations", {
    type: "group",
    name,
    user_ids: userIds,
  });

// POST /api/chat/conversations/:conversationId/members
export const addConversationMembers = (conversationId, userIds) =>
  api.post(`/chat/conversations/${conversationId}/members`, {
    user_ids: userIds,
  });

// DELETE /api/chat/conversations/:conversationId/members/:userId
export const removeConversationMember = (conversationId, userId) =>
  api.delete(`/chat/conversations/${conversationId}/members/${userId}`);

// GET /api/chat/conversations/:conversationId/messages
export const listMessages = (conversationId, { page = 1, limit = 50 } = {}) =>
  api.get(`/chat/conversations/${conversationId}/messages`, {
    params: { page, limit },
  });

// POST /api/chat/conversations/:conversationId/messages
// The backend derives sender_id and organization_id from the authenticated
// request/conversation context -- never sent from here.
export const sendMessage = (conversationId, body) =>
  api.post(`/chat/conversations/${conversationId}/messages`, { body });

// Step 27: Organization Chat message attachments. An attachment always
// belongs to an already-created message -- there is no endpoint to create
// one without a messageId, so callers must call sendMessage() first and use
// its returned message.id here.

// POST /api/chat/conversations/:conversationId/messages/:messageId/attachments
export const uploadOrgChatAttachment = (conversationId, messageId, file) => {
  const formData = new FormData();
  formData.append("file", file);
  return api.post(
    `/chat/conversations/${conversationId}/messages/${messageId}/attachments`,
    formData,
    { headers: { "Content-Type": "multipart/form-data" } },
  );
};

// GET /api/chat/conversations/:conversationId/messages/:messageId/attachments
export const listOrgChatAttachments = (conversationId, messageId) =>
  api.get(
    `/chat/conversations/${conversationId}/messages/${messageId}/attachments`,
  );

// GET /api/chat/conversations/:conversationId/messages/:messageId/attachments/:attachmentId
// The download endpoint requires auth and returns the raw file, not JSON --
// callers must go through the authenticated `api` client (never a plain
// <a href>) and build a Blob URL from the binary response themselves.
export const downloadOrgChatAttachment = (conversationId, messageId, attachmentId) =>
  api.get(
    `/chat/conversations/${conversationId}/messages/${messageId}/attachments/${attachmentId}`,
    { responseType: "blob" },
  );

// DELETE /api/chat/conversations/:conversationId/messages/:messageId/attachments/:attachmentId
export const deleteOrgChatAttachment = (conversationId, messageId, attachmentId) =>
  api.delete(
    `/chat/conversations/${conversationId}/messages/${messageId}/attachments/${attachmentId}`,
  );
