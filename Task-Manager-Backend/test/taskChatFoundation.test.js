const test = require("node:test");
const assert = require("node:assert/strict");

const { sequelize } = require("../config/db");
const {
  Task,
  TaskMessage,
  TaskChatRead,
  Attachment,
  Organization,
  User,
} = require("../models");

test("Task Chat DB foundation — Step 1", async (t) => {
  await t.test("models load and are registered", () => {
    assert.ok(TaskMessage, "TaskMessage model should load");
    assert.ok(TaskChatRead, "TaskChatRead model should load");
    assert.equal(TaskMessage.getTableName(), "task_messages");
    assert.equal(TaskChatRead.getTableName(), "task_chat_reads");
  });

  await t.test("associations are wired", () => {
    assert.equal(TaskMessage.associations.task.target, Task);
    assert.equal(TaskMessage.associations.sender.target, User);
    assert.equal(TaskMessage.associations.organization.target, Organization);
    assert.equal(TaskMessage.associations.attachments.target, Attachment);

    assert.equal(TaskChatRead.associations.task.target, Task);
    assert.equal(TaskChatRead.associations.user.target, User);

    assert.equal(Task.associations.messages.target, TaskMessage);
    assert.equal(Task.associations.chatReads.target, TaskChatRead);
    assert.equal(Attachment.associations.message.target, TaskMessage);
  });

  await t.test("body is not nullable on TaskMessage", () => {
    const bodyAttr = TaskMessage.rawAttributes.body;
    assert.equal(bodyAttr.allowNull, false);
  });

  await t.test(
    "unique constraint on task_chat_reads(task_id, user_id) is enforced",
    async () => {
      // Use IDs unlikely to collide with real dev data, wrapped in a
      // transaction that is always rolled back so nothing persists.
      const txn = await sequelize.transaction();
      try {
        const [orgRows] = await sequelize.query(
          "SELECT id FROM organizations LIMIT 1",
          { transaction: txn },
        );
        const [userRows] = await sequelize.query(
          "SELECT id FROM users LIMIT 1",
          { transaction: txn },
        );
        const [taskRows] = await sequelize.query(
          "SELECT id, organization_id FROM tasks LIMIT 1",
          { transaction: txn },
        );

        if (!orgRows[0] || !userRows[0] || !taskRows[0]) {
          // No seed data in this DB to exercise the FK/unique constraint
          // against — skip rather than fail the whole suite.
          t.skip("no existing organization/user/task rows to test against");
          return;
        }

        const taskId = taskRows[0].id;
        const userId = userRows[0].id;

        await TaskChatRead.create(
          { task_id: taskId, user_id: userId, last_read_at: new Date() },
          { transaction: txn },
        );

        await assert.rejects(
          () =>
            TaskChatRead.create(
              { task_id: taskId, user_id: userId, last_read_at: new Date() },
              { transaction: txn },
            ),
          /Unique|SequelizeUniqueConstraintError/i,
        );
      } finally {
        await txn.rollback();
      }
    },
  );

  await t.test("TaskMessage rejects a null body (DB-level NOT NULL)", async () => {
    const txn = await sequelize.transaction();
    try {
      const [orgRows] = await sequelize.query(
        "SELECT id FROM organizations LIMIT 1",
        { transaction: txn },
      );
      const [userRows] = await sequelize.query(
        "SELECT id FROM users LIMIT 1",
        { transaction: txn },
      );
      const [taskRows] = await sequelize.query(
        "SELECT id FROM tasks LIMIT 1",
        { transaction: txn },
      );

      if (!orgRows[0] || !userRows[0] || !taskRows[0]) {
        t.skip("no existing organization/user/task rows to test against");
        return;
      }

      await assert.rejects(() =>
        sequelize.query(
          "INSERT INTO task_messages (task_id, organization_id, sender_id, body, created_at, updated_at) VALUES (?, ?, ?, NULL, NOW(), NOW())",
          {
            replacements: [taskRows[0].id, orgRows[0].id, userRows[0].id],
            transaction: txn,
          },
        ),
      );
    } finally {
      await txn.rollback();
    }
  });
});
