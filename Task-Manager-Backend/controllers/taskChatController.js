const {
  TaskMessage,
  User,
} = require("../models");

const { canAccessTaskChatViaMembership } = require("../utils/taskChatAccess");
const { emitTaskMessage } = require("../socket");

exports.getMessages = async (req, res) => {
  try {
    const { projectId, taskId } = req.params;

    const access = await canAccessTaskChatViaMembership(req.user.id, taskId);

    if (!access.allowed) {
      if (access.reason === "TASK_NOT_FOUND") {
        return res.status(404).json({
          message: "Task not found.",
        });
      }

      return res.status(403).json({
        message: "You do not have access to this task chat.",
      });
    }

    if (Number(access.task.project_id) !== Number(projectId)) {
      return res.status(404).json({
        message: "Task not found in this project.",
      });
    }

    const messages = await TaskMessage.findAll({
      where: {
        task_id: taskId,
      },
      include: [
        {
          model: User,
          as: "sender",
          attributes: [
            "id",
            "first_name",
            "last_name",
            "email",
            "avatar_url",
          ],
        },
      ],
      order: [["created_at", "ASC"]],
    });

    return res.json({
      messages,
    });
  } catch (error) {
    console.error("Get task chat messages error:", error);

    return res.status(500).json({
      message: "Server error while fetching task chat messages.",
    });
  }
};

exports.createMessage = async (req, res) => {
  try {
    const { projectId, taskId } = req.params;
    const { body } = req.body;

    const access = await canAccessTaskChatViaMembership(req.user.id, taskId);

    if (!access.allowed) {
      if (access.reason === "TASK_NOT_FOUND") {
        return res.status(404).json({
          message: "Task not found.",
        });
      }

      return res.status(403).json({
        message: "You do not have access to this task chat.",
      });
    }

    if (Number(access.task.project_id) !== Number(projectId)) {
      return res.status(404).json({
        message: "Task not found in this project.",
      });
    }

    if (typeof body !== "string" || !body.trim()) {
      return res.status(400).json({
        message: "Message body is required.",
      });
    }

    const message = await TaskMessage.create({
      task_id: taskId,
      organization_id: access.task.organization_id,
      sender_id: req.user.id,
      body: body.trim(),
    });

    const createdMessage = await TaskMessage.findByPk(message.id, {
      include: [
        {
          model: User,
          as: "sender",
          attributes: [
            "id",
            "first_name",
            "last_name",
            "email",
            "avatar_url",
          ],
        },
      ],
    });

    emitTaskMessage(taskId, createdMessage);

return res.status(201).json({
  message: createdMessage,
});
  } catch (error) {
    console.error("Create task chat message error:", error);

    return res.status(500).json({
      message: "Server error while creating task chat message.",
    });
  }
};