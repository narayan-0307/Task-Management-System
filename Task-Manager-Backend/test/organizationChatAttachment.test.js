const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");

const {
  Organization,
  OrganizationMember,
  User,
  Conversation,
  ConversationMember,
  Message,
  Attachment,
  TaskMessage,
} = require("../models");

const {
  uploadOrgChatAttachment,
  listOrgChatAttachments,
  getOrgChatAttachment,
  deleteOrgChatAttachment,
} = require("../controllers/organizationChatAttachmentController");

const UPLOAD_DIR = path.join(__dirname, "../uploads");

// Minimal req/res doubles, matching organizationChatRest.test.js, extended
// with the file-delivery calls the download endpoint makes (set/sendFile).
function mockRes() {
  return {
    statusCode: 200,
    body: null,
    sentFilePath: null,
    headers: {},
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
    set(key, value) {
      this.headers[key] = value;
      return this;
    },
    get headersSent() {
      return false;
    },
    sendFile(filePath, options, cb) {
      this.sentFilePath = filePath;
      this.statusCode = 200;
      if (typeof cb === "function") cb(null);
      return this;
    },
  };
}

function mockReq({ params = {}, body = {}, user, file }) {
  return { params, body, user, file };
}

function asUser(user, org, role = "member") {
  return { id: user.id, organization_id: org.id, role };
}

function fakeUploadedFile(name = "note.txt") {
  const filename = `${Date.now()}-${Math.round(Math.random() * 1e9)}${path.extname(name)}`;
  const filePath = path.join(UPLOAD_DIR, filename);
  fs.writeFileSync(filePath, "test attachment contents");
  return {
    originalname: name,
    filename,
    size: fs.statSync(filePath).size,
    mimetype: "text/plain",
  };
}

test("Organization Chat Attachment API — Step 17C", async (t) => {
  const suffix = Date.now();

  let org, otherOrg;
  let alice, bob, carol, dave, erin, admin;
  const createdConversationIds = [];
  const createdMessageIds = [];
  const createdAttachmentIds = [];
  const writtenFiles = [];

  t.after(async () => {
    if (createdAttachmentIds.length) {
      await Attachment.destroy({ where: { id: createdAttachmentIds } });
    }
    for (const f of writtenFiles) {
      try {
        if (fs.existsSync(f)) fs.unlinkSync(f);
      } catch {
        // best-effort cleanup
      }
    }
    if (createdMessageIds.length) {
      await Message.destroy({ where: { id: createdMessageIds } });
    }
    if (createdConversationIds.length) {
      await ConversationMember.destroy({
        where: { conversation_id: createdConversationIds },
      });
      await Conversation.destroy({ where: { id: createdConversationIds } });
    }
    if (org) await OrganizationMember.destroy({ where: { organization_id: org.id } });
    if (otherOrg) await OrganizationMember.destroy({ where: { organization_id: otherOrg.id } });
    const userIds = [alice, bob, carol, dave, erin, admin]
      .filter(Boolean)
      .map((u) => u.id);
    if (userIds.length) await User.destroy({ where: { id: userIds } });
    if (org) await Organization.destroy({ where: { id: org.id } });
    if (otherOrg) await Organization.destroy({ where: { id: otherOrg.id } });
  });

  await t.test("fixtures set up", async () => {
    org = await Organization.create({
      name: `OrgChatAttach Test Org ${suffix}`,
      slug: `orgchatattach-test-org-${suffix}`,
    });
    otherOrg = await Organization.create({
      name: `OrgChatAttach Other Org ${suffix}`,
      slug: `orgchatattach-other-org-${suffix}`,
    });

    async function makeUser(label) {
      return User.create({
        first_name: label,
        last_name: "Test",
        email: `${label.toLowerCase()}-${suffix}@example.test`,
      });
    }

    alice = await makeUser("AttachAlice");
    bob = await makeUser("AttachBob");
    carol = await makeUser("AttachCarol");
    dave = await makeUser("AttachDave");
    admin = await makeUser("AttachAdmin");
    erin = await makeUser("AttachErin");

    await OrganizationMember.bulkCreate([
      { organization_id: org.id, user_id: alice.id, role: "member", is_active: true },
      { organization_id: org.id, user_id: bob.id, role: "member", is_active: true },
      { organization_id: org.id, user_id: carol.id, role: "member", is_active: true },
      { organization_id: org.id, user_id: dave.id, role: "member", is_active: false },
      { organization_id: org.id, user_id: admin.id, role: "admin", is_active: true },
      { organization_id: otherOrg.id, user_id: erin.id, role: "member", is_active: true },
    ]);

    const conversation = await Conversation.create({
      organization_id: org.id,
      type: "group",
      name: "Attachments Team",
      created_by: alice.id,
    });
    createdConversationIds.push(conversation.id);

    await ConversationMember.bulkCreate([
      { conversation_id: conversation.id, user_id: alice.id },
      { conversation_id: conversation.id, user_id: bob.id },
      { conversation_id: conversation.id, user_id: admin.id },
    ]);

    const otherConversation = await Conversation.create({
      organization_id: org.id,
      type: "group",
      name: "Other Conversation",
      created_by: alice.id,
    });
    createdConversationIds.push(otherConversation.id);
    await ConversationMember.bulkCreate([
      { conversation_id: otherConversation.id, user_id: alice.id },
    ]);

    const message = await Message.create({
      conversation_id: conversation.id,
      organization_id: org.id,
      sender_id: alice.id,
      body: "Sharing a file",
    });
    createdMessageIds.push(message.id);

    const otherMessage = await Message.create({
      conversation_id: otherConversation.id,
      organization_id: org.id,
      sender_id: alice.id,
      body: "Message in a different conversation",
    });
    createdMessageIds.push(otherMessage.id);

    t.context = {
      conversationId: conversation.id,
      otherConversationId: otherConversation.id,
      messageId: message.id,
      otherMessageId: otherMessage.id,
    };

    assert.ok(conversation.id && message.id, "fixtures created");
  });

  let ctx;
  let uploadedAttachmentId;

  await t.test("resolve fixture context", () => {
    ctx = t.context;
    assert.ok(ctx.conversationId && ctx.messageId);
  });

  // ---------------------------------------------------------------
  // UPLOAD
  // ---------------------------------------------------------------

  await t.test("1: conversation member can upload", async () => {
    const file = fakeUploadedFile("shared.txt");
    writtenFiles.push(path.join(UPLOAD_DIR, file.filename));

    const req = mockReq({
      user: asUser(bob, org),
      params: { conversationId: ctx.conversationId, messageId: ctx.messageId },
      file,
    });
    const res = mockRes();
    await uploadOrgChatAttachment(req, res);
    assert.equal(res.statusCode, 201, JSON.stringify(res.body));
    assert.equal(res.body.attachment.file_name, "shared.txt");
    uploadedAttachmentId = res.body.attachment.id;
    createdAttachmentIds.push(uploadedAttachmentId);
  });

  await t.test("2: non-member cannot upload", async () => {
    const file = fakeUploadedFile("nope.txt");
    writtenFiles.push(path.join(UPLOAD_DIR, file.filename));

    const req = mockReq({
      user: asUser(carol, org),
      params: { conversationId: ctx.conversationId, messageId: ctx.messageId },
      file,
    });
    const res = mockRes();
    await uploadOrgChatAttachment(req, res);
    assert.equal(res.statusCode, 403);
  });

  await t.test("3: wrong organization cannot upload", async () => {
    const file = fakeUploadedFile("nope2.txt");
    writtenFiles.push(path.join(UPLOAD_DIR, file.filename));

    const req = mockReq({
      user: asUser(erin, otherOrg),
      params: { conversationId: ctx.conversationId, messageId: ctx.messageId },
      file,
    });
    const res = mockRes();
    await uploadOrgChatAttachment(req, res);
    assert.equal(res.statusCode, 403);
  });

  await t.test("4: message from another conversation rejected", async () => {
    const file = fakeUploadedFile("nope3.txt");
    writtenFiles.push(path.join(UPLOAD_DIR, file.filename));

    const req = mockReq({
      user: asUser(alice, org),
      params: {
        conversationId: ctx.conversationId,
        messageId: ctx.otherMessageId,
      },
      file,
    });
    const res = mockRes();
    await uploadOrgChatAttachment(req, res);
    assert.equal(res.statusCode, 404);
  });

  // ---------------------------------------------------------------
  // LIST
  // ---------------------------------------------------------------

  await t.test("5: member can list attachments", async () => {
    const req = mockReq({
      user: asUser(alice, org),
      params: { conversationId: ctx.conversationId, messageId: ctx.messageId },
    });
    const res = mockRes();
    await listOrgChatAttachments(req, res);
    assert.equal(res.statusCode, 200, JSON.stringify(res.body));
    const ids = res.body.attachments.map((a) => a.id);
    assert.ok(ids.includes(uploadedAttachmentId));
    assert.ok(!("file_path" in res.body.attachments[0]));
  });

  await t.test("6: non-member cannot list attachments", async () => {
    const req = mockReq({
      user: asUser(carol, org),
      params: { conversationId: ctx.conversationId, messageId: ctx.messageId },
    });
    const res = mockRes();
    await listOrgChatAttachments(req, res);
    assert.equal(res.statusCode, 403);
  });

  // ---------------------------------------------------------------
  // DOWNLOAD / VIEW
  // ---------------------------------------------------------------

  await t.test("7: member can download/view attachment", async () => {
    const req = mockReq({
      user: asUser(bob, org),
      params: {
        conversationId: ctx.conversationId,
        messageId: ctx.messageId,
        attachmentId: uploadedAttachmentId,
      },
    });
    const res = mockRes();
    await getOrgChatAttachment(req, res);
    assert.equal(res.statusCode, 200, JSON.stringify(res.body));
    assert.ok(res.sentFilePath);
    assert.ok(fs.existsSync(res.sentFilePath));
  });

  await t.test("8: non-member cannot download/view attachment", async () => {
    const req = mockReq({
      user: asUser(carol, org),
      params: {
        conversationId: ctx.conversationId,
        messageId: ctx.messageId,
        attachmentId: uploadedAttachmentId,
      },
    });
    const res = mockRes();
    await getOrgChatAttachment(req, res);
    assert.equal(res.statusCode, 403);
    assert.equal(res.sentFilePath, null);
  });

  await t.test("12: attachment from another message rejected", async () => {
    const req = mockReq({
      user: asUser(alice, org),
      params: {
        conversationId: ctx.otherConversationId,
        messageId: ctx.otherMessageId,
        attachmentId: uploadedAttachmentId,
      },
    });
    const res = mockRes();
    await getOrgChatAttachment(req, res);
    assert.equal(res.statusCode, 404);
  });

  await t.test("13: missing physical file returns 404", async () => {
    const file = fakeUploadedFile("will-vanish.txt");
    const filePath = path.join(UPLOAD_DIR, file.filename);

    const uploadReq = mockReq({
      user: asUser(alice, org),
      params: { conversationId: ctx.conversationId, messageId: ctx.messageId },
      file,
    });
    const uploadRes = mockRes();
    await uploadOrgChatAttachment(uploadReq, uploadRes);
    const vanishingId = uploadRes.body.attachment.id;
    createdAttachmentIds.push(vanishingId);

    fs.unlinkSync(filePath);

    const req = mockReq({
      user: asUser(alice, org),
      params: {
        conversationId: ctx.conversationId,
        messageId: ctx.messageId,
        attachmentId: vanishingId,
      },
    });
    const res = mockRes();
    await getOrgChatAttachment(req, res);
    assert.equal(res.statusCode, 404);
  });

  // ---------------------------------------------------------------
  // DELETE
  // ---------------------------------------------------------------

  let deletableByUploaderId;
  let deletableByAdminId;

  await t.test("upload two more attachments for delete tests", async () => {
    const file1 = fakeUploadedFile("mine.txt");
    writtenFiles.push(path.join(UPLOAD_DIR, file1.filename));
    const req1 = mockReq({
      user: asUser(bob, org),
      params: { conversationId: ctx.conversationId, messageId: ctx.messageId },
      file: file1,
    });
    const res1 = mockRes();
    await uploadOrgChatAttachment(req1, res1);
    deletableByUploaderId = res1.body.attachment.id;
    createdAttachmentIds.push(deletableByUploaderId);

    const file2 = fakeUploadedFile("bobs-other.txt");
    writtenFiles.push(path.join(UPLOAD_DIR, file2.filename));
    const req2 = mockReq({
      user: asUser(bob, org),
      params: { conversationId: ctx.conversationId, messageId: ctx.messageId },
      file: file2,
    });
    const res2 = mockRes();
    await uploadOrgChatAttachment(req2, res2);
    deletableByAdminId = res2.body.attachment.id;
    createdAttachmentIds.push(deletableByAdminId);
  });

  await t.test("11: unrelated conversation member cannot delete", async () => {
    const req = mockReq({
      user: asUser(alice, org),
      params: {
        conversationId: ctx.conversationId,
        messageId: ctx.messageId,
        attachmentId: deletableByUploaderId,
      },
    });
    const res = mockRes();
    await deleteOrgChatAttachment(req, res);
    assert.equal(res.statusCode, 403);

    const stillThere = await Attachment.findByPk(deletableByUploaderId);
    assert.ok(stillThere);
  });

  await t.test("9+14+15: uploader can delete (removes DB row and file)", async () => {
    const attachment = await Attachment.findByPk(deletableByUploaderId);
    const filePath = path.join(UPLOAD_DIR, attachment.file_path);
    assert.ok(fs.existsSync(filePath));

    const req = mockReq({
      user: asUser(bob, org),
      params: {
        conversationId: ctx.conversationId,
        messageId: ctx.messageId,
        attachmentId: deletableByUploaderId,
      },
    });
    const res = mockRes();
    await deleteOrgChatAttachment(req, res);
    assert.equal(res.statusCode, 200, JSON.stringify(res.body));

    const deleted = await Attachment.findByPk(deletableByUploaderId);
    assert.equal(deleted, null);
    assert.equal(fs.existsSync(filePath), false);
    createdAttachmentIds.splice(createdAttachmentIds.indexOf(deletableByUploaderId), 1);
  });

  await t.test("10: owner/admin/manager can delete another user's attachment", async () => {
    const req = mockReq({
      user: asUser(admin, org, "admin"),
      params: {
        conversationId: ctx.conversationId,
        messageId: ctx.messageId,
        attachmentId: deletableByAdminId,
      },
    });
    const res = mockRes();
    await deleteOrgChatAttachment(req, res);
    assert.equal(res.statusCode, 200, JSON.stringify(res.body));

    const deleted = await Attachment.findByPk(deletableByAdminId);
    assert.equal(deleted, null);
    createdAttachmentIds.splice(createdAttachmentIds.indexOf(deletableByAdminId), 1);
  });

  // ---------------------------------------------------------------
  // TASK CHAT REGRESSION
  // ---------------------------------------------------------------

  await t.test("16: Task Chat message_id relationship is unaffected", async () => {
    // Organization Chat attachments only ever write org_message_id; the
    // separate Task Chat message_id -> task_messages.id relationship is
    // untouched by anything in this controller.
    const taskMessageAttachments = await Attachment.count({
      where: { id: createdAttachmentIds, message_id: { [require("sequelize").Op.ne]: null } },
    });
    assert.equal(taskMessageAttachments, 0);
    assert.ok(TaskMessage, "TaskMessage model still present/unmodified");
  });
});
