const {
  Subtask,
  Task,
  Project,
  ProjectMember,
  User,
  Tag,
} = require("../models");
const { getIO } = require("../socket");
const { createNotification } = require("../utils/notify");
const { createActivity } = require("../utils/activity");

async function loadSubtaskWithUsers(subtaskId) {
  return Subtask.findOne({
    where: { id: subtaskId },
    include: [
      {
        model: User,
        as: "assignee",
        attributes: ["id", "first_name", "last_name", "email", "avatar_url"],
      },
      {
        model: User,
        as: "creator",
        attributes: ["id", "first_name", "last_name", "email"],
      },
      {
        model: Tag,
        as: "tags",
        attributes: ["id", "name"],
        through: { attributes: [] },
      },
    ],
  });
}

async function resolveTagRecords(tagNames, organizationId) {
  const uniqueNames = [
    ...new Set(tagNames.map((name) => name.trim().toLowerCase())),
  ];

  const tags = [];
  for (const name of uniqueNames) {
    // Sequential, not Promise.all: concurrent findOrCreate calls for the same
    // name race past each other's uncommitted inserts and create duplicate rows.
    const [tag] = await Tag.findOrCreate({
      where: { name, organization_id: organizationId },
      defaults: { name, organization_id: organizationId },
    });
    tags.push(tag);
  }
  return tags;
}

exports.createSubtask = async (req, res) => {
  try {
    const { projectId, taskId } = req.params;
    const { title, description, assigned_to, priority, due_date, tags } =
      req.body;

    // 1. Validate title
    if (!title || !title.trim()) {
      return res.status(400).json({
        message: "Subtask title is required.",
      });
    }

    // 2. Verify project belongs to current organization
    const project = await Project.findOne({
      where: {
        id: projectId,
        organization_id: req.user.organization_id,
      },
    });

    if (!project) {
      return res.status(404).json({
        message: "Project not found.",
      });
    }

    // 3. Verify task belongs to this project and organization
    const task = await Task.findOne({
      where: {
        id: taskId,
        project_id: projectId,
        organization_id: req.user.organization_id,
      },
    });

    if (!task) {
      return res.status(404).json({
        message: "Task not found.",
      });
    }

    // 4. Verify current user has access to this project
    const projectMember = await ProjectMember.findOne({
      where: {
        project_id: projectId,
        user_id: req.user.id,
      },
    });

    if (
      !["owner", "admin", "manager"].includes(req.user.role) &&
      !projectMember
    ) {
      return res.status(403).json({
        message: "You are not a member of this project.",
      });
    }

    // 5. Validate assignee if provided
    if (assigned_to !== undefined && assigned_to !== null) {
      const assigneeMember = await ProjectMember.findOne({
        where: {
          project_id: projectId,
          user_id: assigned_to,
        },
      });

      if (!assigneeMember) {
        return res.status(400).json({
          message: "Assigned user is not a member of this project.",
        });
      }
    }

    // 6. Create subtask
    const subtask = await Subtask.create({
      task_id: task.id,
      organization_id: req.user.organization_id,
      title: title.trim(),
      description: description || null,
      assigned_to: assigned_to || null,
      created_by: req.user.id,
      status: "todo",
      priority: priority || "medium",
      due_date: due_date || null,
    });

    // 7. Handle tags
    if (Array.isArray(tags) && tags.length > 0) {
      const tagRecords = await resolveTagRecords(
        tags,
        req.user.organization_id,
      );
      await subtask.setTags(tagRecords);
    }

    // 8. Load complete subtask
    const full = await loadSubtaskWithUsers(subtask.id);

    // 9. Notify assignee
    if (full.assigned_to && full.assigned_to !== req.user.id) {
      const actor = await User.findByPk(req.user.id, {
        attributes: ["id", "first_name", "last_name", "email"],
      });
      await createNotification({
        organizationId: req.user.organization_id,
        userId: full.assigned_to,
        actorId: req.user.id,
        type: "subtask_assigned",
        taskId: task.id,
        projectId: projectId,
        message: `${actor?.first_name || "Someone"} assigned you to subtask "${full.title}"`,
      });
    }

    // 10. Real-time notification
    try {
      getIO().to(`task:${taskId}`).emit("subtask:created", full);
    } catch (err) {
      console.error("Socket emit failed:", err.message);
    }

    await createActivity({
      organization_id: req.user.organization_id,
      project_id: projectId,
      task_id: task.id,
      user_id: req.user.id,
      entity_type: "subtask",
      entity_id: subtask.id,
      action: "created",
      description: `Created subtask "${full.title}"`,
      metadata: {
        subtask_id: subtask.id,
        subtask_title: full.title,
        task_id: task.id,
        project_id: projectId,
      },
    });

    return res.status(201).json({
      message: "Subtask created successfully.",
      subtask: full,
    });
  } catch (error) {
    console.error("Create subtask error:", error);

    return res.status(500).json({
      message: "Server error while creating subtask.",
    });
  }
};

exports.getSubtasks = async (req, res) => {
  try {
    const { projectId, taskId } = req.params;

    // 1. Verify project belongs to current organization
    const project = await Project.findOne({
      where: {
        id: projectId,
        organization_id: req.user.organization_id,
      },
    });

    if (!project) {
      return res.status(404).json({
        message: "Project not found.",
      });
    }

    // 2. Verify task belongs to this project and organization
    const task = await Task.findOne({
      where: {
        id: taskId,
        project_id: projectId,
        organization_id: req.user.organization_id,
      },
    });

    if (!task) {
      return res.status(404).json({
        message: "Task not found.",
      });
    }

    // 3. Get subtasks
    const subtasks = await Subtask.findAll({
      where: {
        task_id: taskId,
        organization_id: req.user.organization_id,
      },
      include: [
        {
          model: User,
          as: "assignee",
          attributes: ["id", "first_name", "last_name", "email", "avatar_url"],
        },
        {
          model: User,
          as: "creator",
          attributes: ["id", "first_name", "last_name", "email"],
        },
        {
          model: Tag,
          as: "tags",
          attributes: ["id", "name"],
          through: { attributes: [] },
        },
      ],
      order: [["created_at", "ASC"]],
    });

    return res.json({
      subtasks,
    });
  } catch (error) {
    console.error("Get subtasks error:", error);

    return res.status(500).json({
      message: "Server error while fetching subtasks.",
    });
  }
};

exports.updateSubtask = async (req, res) => {
  try {
    const { projectId, taskId, subtaskId } = req.params;
    const { title, description, status, assigned_to, tags } = req.body;

    // 1. Verify project belongs to current organization
    const project = await Project.findOne({
      where: {
        id: projectId,
        organization_id: req.user.organization_id,
      },
    });

    if (!project) {
      return res.status(404).json({
        message: "Project not found.",
      });
    }

    // 2. Verify task belongs to project
    const task = await Task.findOne({
      where: {
        id: taskId,
        project_id: projectId,
        organization_id: req.user.organization_id,
      },
    });

    if (!task) {
      return res.status(404).json({
        message: "Task not found.",
      });
    }

    // 3. Find subtask
    const subtask = await Subtask.findOne({
      where: {
        id: subtaskId,
        task_id: taskId,
        organization_id: req.user.organization_id,
      },
    });

    if (!subtask) {
      return res.status(404).json({
        message: "Subtask not found.",
      });
    }

    // 4. Assigned member can update status only
    const isAssignedMember =
      req.user.role === "member" && subtask.assigned_to === req.user.id;

    if (isAssignedMember) {
      const onlyStatusUpdate =
        title === undefined &&
        description === undefined &&
        assigned_to === undefined &&
        tags === undefined &&
        status !== undefined;

      if (!onlyStatusUpdate) {
        return res.status(403).json({
          message: "You can only update the subtask status.",
        });
      }

      const allowedStatuses = ["todo", "in_progress", "completed"];

      if (!allowedStatuses.includes(status)) {
        return res.status(400).json({
          message: "Invalid subtask status.",
        });
      }

      subtask.status = status;

      await subtask.save();

      const full = await loadSubtaskWithUsers(subtask.id);

      try {
        getIO().to(`task:${taskId}`).emit("subtask:updated", full);
      } catch (err) {
        console.error("Socket emit failed:", err.message);
      }

      await createActivity({
        organization_id: req.user.organization_id,
        project_id: projectId,
        task_id: task.id,
        user_id: req.user.id,
        entity_type: "subtask",
        entity_id: subtask.id,
        action: "updated",
        description: `Updated subtask "${full.title}"`,
        metadata: {
          subtask_id: subtask.id,
          subtask_title: full.title,
          task_id: task.id,
          project_id: projectId,
        },
      });

      return res.json({
        message: "Subtask status updated successfully.",
        subtask: full,
      });
    }

    // 5. Other users must have management permission
    if (!["owner", "admin", "manager"].includes(req.user.role)) {
      return res.status(403).json({
        message: "You do not have permission to update this subtask.",
      });
    }

    // 6. Validate title
    if (title !== undefined) {
      if (!title.trim()) {
        return res.status(400).json({
          message: "Subtask title cannot be empty.",
        });
      }

      subtask.title = title.trim();
    }

    // 7. Update description
    if (description !== undefined) {
      subtask.description = description;
    }

    // 8. Validate status
    if (status !== undefined) {
      const allowedStatuses = ["todo", "in_progress", "completed"];

      if (!allowedStatuses.includes(status)) {
        return res.status(400).json({
          message: "Invalid subtask status.",
        });
      }

      subtask.status = status;
    }

    // 9. Validate assignee
    const previousAssignee = subtask.assigned_to;
    if (assigned_to !== undefined) {
      if (assigned_to === null) {
        subtask.assigned_to = null;
      } else {
        const projectMember = await ProjectMember.findOne({
          where: {
            project_id: projectId,
            user_id: assigned_to,
          },
        });

        if (!projectMember) {
          return res.status(400).json({
            message: "Assigned user is not a member of this project.",
          });
        }

        subtask.assigned_to = assigned_to;
      }
    }

    await subtask.save();

    // 10. Handle tags update
    if (Array.isArray(tags)) {
      if (tags.length === 0) {
        await subtask.setTags([]);
      } else {
        const tagRecords = await resolveTagRecords(
          tags,
          req.user.organization_id,
        );
        await subtask.setTags(tagRecords);
      }
    }

    // 11. Notify newly assigned user
    if (
      assigned_to !== undefined &&
      subtask.assigned_to &&
      subtask.assigned_to !== previousAssignee &&
      subtask.assigned_to !== req.user.id
    ) {
      const actor = await User.findByPk(req.user.id, {
        attributes: ["first_name"],
      });
      await createNotification({
        organizationId: req.user.organization_id,
        userId: subtask.assigned_to,
        actorId: req.user.id,
        type: "subtask_assigned",
        taskId: task.id,
        projectId: projectId,
        message: `${actor?.first_name || "Someone"} assigned you to subtask "${subtask.title}"`,
      });
    }

    const full = await loadSubtaskWithUsers(subtask.id);

    try {
      getIO().to(`task:${taskId}`).emit("subtask:updated", full);
    } catch (err) {
      console.error("Socket emit failed:", err.message);
    }

    await createActivity({
      organization_id: req.user.organization_id,
      project_id: projectId,
      task_id: task.id,
      user_id: req.user.id,
      entity_type: "subtask",
      entity_id: subtask.id,
      action: "updated",
      description: `Updated subtask "${full.title}"`,
      metadata: {
        subtask_id: subtask.id,
        subtask_title: full.title,
        task_id: task.id,
        project_id: projectId,
      },
    });

    return res.json({
      message: "Subtask updated successfully.",
      subtask: full,
    });
  } catch (error) {
    console.error("Update subtask error:", error);

    return res.status(500).json({
      message: "Server error while updating subtask.",
    });
  }
};

exports.deleteSubtask = async (req, res) => {
  try {
    const { projectId, taskId, subtaskId } = req.params;

    // 1. Verify project belongs to current organization
    const project = await Project.findOne({
      where: {
        id: projectId,
        organization_id: req.user.organization_id,
      },
    });

    if (!project) {
      return res.status(404).json({
        message: "Project not found.",
      });
    }

    // 2. Verify task belongs to project
    const task = await Task.findOne({
      where: {
        id: taskId,
        project_id: projectId,
        organization_id: req.user.organization_id,
      },
    });

    if (!task) {
      return res.status(404).json({
        message: "Task not found.",
      });
    }

    // 3. Only management roles can delete subtasks
    if (!["owner", "admin", "manager"].includes(req.user.role)) {
      return res.status(403).json({
        message: "You do not have permission to delete this subtask.",
      });
    }

    // 4. Find subtask
    const subtask = await Subtask.findOne({
      where: {
        id: subtaskId,
        task_id: taskId,
        organization_id: req.user.organization_id,
      },
    });

    if (!subtask) {
      return res.status(404).json({
        message: "Subtask not found.",
      });
    }

    // 5. Delete subtask
    const deletedSubtaskId = subtask.id;
    const deletedSubtaskTitle = subtask.title;
    await subtask.destroy();

    try {
      getIO()
        .to(`task:${taskId}`)
        .emit("subtask:deleted", { subtaskId: deletedSubtaskId });
    } catch (err) {
      console.error("Socket emit failed:", err.message);
    }

    await createActivity({
      organization_id: req.user.organization_id,
      project_id: projectId,
      task_id: task.id,
      user_id: req.user.id,
      entity_type: "subtask",
      entity_id: deletedSubtaskId,
      action: "deleted",
      description: `Deleted subtask "${deletedSubtaskTitle}"`,
      metadata: {
        subtask_id: deletedSubtaskId,
        subtask_title: deletedSubtaskTitle,
        task_id: task.id,
        project_id: projectId,
      },
    });

    return res.json({
      message: "Subtask deleted successfully.",
    });
  } catch (error) {
    console.error("Delete subtask error:", error);

    return res.status(500).json({
      message: "Server error while deleting subtask.",
    });
  }
};
