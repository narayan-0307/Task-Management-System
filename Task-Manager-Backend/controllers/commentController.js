const {
  Comment,
  Task,
  Subtask,
  Project,
  User,
  Attachment,
} = require("../models");
const { createNotification } = require("../utils/notify");
const { createActivity } = require("../utils/activity");
const { getIO } = require("../socket");
const { sendEmail } = require("../services/email/emailService");
const { mentionEmail } = require("../services/email/emailTemplates");

async function resolveContext(req) {
  const { projectId, taskId, subtaskId } = req.params;

  const project = await Project.findOne({
    where: { id: projectId, organization_id: req.user.organization_id },
  });
  if (!project)
    return { error: { status: 404, message: "Project not found." } };

  const task = await Task.findOne({
    where: {
      id: taskId,
      project_id: projectId,
      organization_id: req.user.organization_id,
    },
  });
  if (!task) return { error: { status: 404, message: "Task not found." } };

  let subtask = null;
  if (subtaskId) {
    subtask = await Subtask.findOne({
      where: {
        id: subtaskId,
        task_id: taskId,
        organization_id: req.user.organization_id,
      },
    });
    if (!subtask)
      return { error: { status: 404, message: "Subtask not found." } };
  }

  return { project, task, subtask };
}

function serializeComment(comment) {
  const json = comment.toJSON();
  return {
    ...json,
    attachments: (json.attachments || []).map((a) => ({
      id: a.id,
      file_name: a.file_name,
      file_size: a.file_size,
      mime_type: a.mime_type,
      url: `/uploads/${a.file_path}`,
      created_at: a.created_at,
    })),
  };
}

exports.getComments = async (req, res) => {
  try {
    const { taskId } = req.params;
    const { error, subtask } = await resolveContext(req);
    if (error) return res.status(error.status).json({ message: error.message });

    const comments = await Comment.findAll({
      where: subtask
        ? { subtask_id: subtask.id, organization_id: req.user.organization_id }
        : {
            task_id: taskId,
            subtask_id: null,
            organization_id: req.user.organization_id,
          },
      include: [
        {
          model: User,
          as: "author",
          attributes: ["id", "first_name", "last_name", "email", "avatar_url"],
        },
        {
          model: Attachment,
          as: "attachments",
        },
      ],
      order: [["created_at", "ASC"]],
    });

    return res.json({ comments: comments.map(serializeComment) });
  } catch (error) {
    console.error("Get comments error:", error);
    return res
      .status(500)
      .json({ message: "Server error while fetching comments." });
  }
};

exports.createComment = async (req, res) => {
  try {
    const { projectId, taskId } = req.params;
    const { content } = req.body;

    if (!content || !content.trim()) {
      return res.status(400).json({ message: "Comment content is required." });
    }

    const { error, task, subtask } = await resolveContext(req);
    if (error) return res.status(error.status).json({ message: error.message });

    const comment = await Comment.create({
      task_id: taskId,
      subtask_id: subtask ? subtask.id : null,
      organization_id: req.user.organization_id,
      user_id: req.user.id,
      content: content.trim(),
    });

    // Reload with author so frontend gets full object back
    const full = await Comment.findOne({
      where: { id: comment.id },
      include: [
        {
          model: User,
          as: "author",
          attributes: ["id", "first_name", "last_name", "email", "avatar_url"],
        },
        {
          model: Attachment,
          as: "attachments",
        },
      ],
    });

    const serialized = serializeComment(full);

    // ─── Mention Processing ─────────────────────────────────────────────────
    try {
      const { OrganizationMember } = require("../models");

      const activeMembers = await OrganizationMember.findAll({
        where: {
          organization_id: req.user.organization_id,
          is_active: true,
        },
        include: [
          {
            model: User,
            as: "user",
            attributes: ["id", "first_name", "last_name", "email"],
          },
        ],
      });

      const mentionedUsers = [];
      const contentLower = content.toLowerCase();

      for (const member of activeMembers) {
        const u = member.user;
        if (u && u.id !== req.user.id) {
          const mentionKey = `@${u.first_name || ""}_${u.last_name || ""}`
            .trim()
            .replace(/\s+/g, "_")
            .toLowerCase();
          if (contentLower.includes(mentionKey)) {
            mentionedUsers.push(u);
          }
        }
      }

      const actor = await User.findByPk(req.user.id, {
        attributes: ["id", "first_name", "last_name", "email"],
      });
      const subject = subtask ? subtask.title : task.title;

      // Notify mentioned users
      for (const mentionedUser of mentionedUsers) {
        await createNotification({
          organizationId: req.user.organization_id,
          userId: mentionedUser.id,
          actorId: req.user.id,
          type: "comment_mention",
          taskId: task.id,
          projectId: projectId,
          message: `${actor?.first_name || "Someone"} mentioned you in a comment on "${subject}"`,
        });

        if (mentionedUser.email) {
          const mentionedBy =
            `${actor?.first_name || ""} ${actor?.last_name || ""}`.trim() ||
            actor?.email ||
            "Someone";

          const recipientName =
            `${mentionedUser.first_name || ""} ${mentionedUser.last_name || ""}`.trim() ||
            mentionedUser.email;

          const taskUrl = `${process.env.FRONTEND_URL}/projects/${projectId}/tasks/${task.id}`;

          const emailContent = mentionEmail({
            recipientName,
            mentionedBy,
            taskTitle: subject,
            message: content.trim(),
            taskUrl,
          });

          try {
            await sendEmail({
              to: mentionedUser.email,
              subject: emailContent.subject,
              text: emailContent.text,
              html: emailContent.html,
            });
          } catch (emailError) {
            console.error(
              `Mention email failed for ${mentionedUser.email}:`,
              emailError.message,
            );
          }
        }
      }

      // Notify assignee if not mentioned
      const notifyUserId = subtask
        ? subtask.assigned_to || task.assigned_to
        : task.assigned_to;

      const isMentioned = mentionedUsers.some((u) => u.id === notifyUserId);

      if (notifyUserId && notifyUserId !== req.user.id && !isMentioned) {
        await createNotification({
          organizationId: req.user.organization_id,
          userId: notifyUserId,
          actorId: req.user.id,
          type: subtask ? "subtask_comment_added" : "comment_added",
          taskId: task.id,
          projectId: projectId,
          message: `${actor?.first_name || "Someone"} commented on "${subject}"`,
        });
      }
    } catch (mentionErr) {
      console.error("Mention processing error:", mentionErr);
    }

    try {
      const eventName = subtask ? "subtask-comment:created" : "comment:created";
      getIO().to(`task:${taskId}`).emit(eventName, serialized);
    } catch (err) {
      console.error("Socket emit failed:", err.message);
    }

    await createActivity({
      organization_id: req.user.organization_id,
      project_id: projectId,
      task_id: task.id,
      user_id: req.user.id,
      entity_type: "comment",
      entity_id: comment.id,
      action: "created",
      description: `Created comment on "${subtask ? subtask.title : task.title}"`,
      metadata: {
        comment_id: comment.id,
        task_id: task.id,
        project_id: projectId,
        subtask_id: subtask ? subtask.id : null,
      },
    });

    return res
      .status(201)
      .json({ message: "Comment created.", comment: serialized });
  } catch (error) {
    console.error("Create comment error:", error);
    return res
      .status(500)
      .json({ message: "Server error while creating comment." });
  }
};

exports.deleteComment = async (req, res) => {
  try {
    const { projectId, taskId, commentId } = req.params;
    const { error, task, subtask } = await resolveContext(req);
    if (error) return res.status(error.status).json({ message: error.message });

    const comment = await Comment.findOne({
      where: subtask
        ? {
            id: commentId,
            subtask_id: subtask.id,
            organization_id: req.user.organization_id,
          }
        : {
            id: commentId,
            task_id: taskId,
            subtask_id: null,
            organization_id: req.user.organization_id,
          },
    });
    if (!comment)
      return res.status(404).json({ message: "Comment not found." });

    // Only the author or management can delete
    const canDelete =
      comment.user_id === req.user.id ||
      ["owner", "admin", "manager"].includes(req.user.role);

    if (!canDelete) {
      return res
        .status(403)
        .json({ message: "You cannot delete this comment." });
    }

    const deletedCommentId = comment.id;
    const deletedCommentContent = comment.content;
    await comment.destroy();

    try {
      const eventName = subtask ? "subtask-comment:deleted" : "comment:deleted";
      getIO()
        .to(`task:${taskId}`)
        .emit(eventName, {
          commentId: deletedCommentId,
          subtaskId: subtask ? subtask.id : undefined,
        });
    } catch (err) {
      console.error("Socket emit failed:", err.message);
    }

    await createActivity({
      organization_id: req.user.organization_id,
      project_id: projectId,
      task_id: taskId,
      user_id: req.user.id,
      entity_type: "comment",
      entity_id: deletedCommentId,
      action: "deleted",
      description: `Deleted comment on "${subtask ? subtask.title : task.title}"`,
      metadata: {
        comment_id: deletedCommentId,
        comment_content: deletedCommentContent,
        task_id: taskId,
        project_id: projectId,
        subtask_id: subtask ? subtask.id : null,
      },
    });

    return res.json({ message: "Comment deleted." });
  } catch (error) {
    console.error("Delete comment error:", error);
    return res
      .status(500)
      .json({ message: "Server error while deleting comment." });
  }
};
