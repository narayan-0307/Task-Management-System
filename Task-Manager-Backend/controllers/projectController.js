const { Project, ProjectMember, User, Task, Tag, TaskMember } = require("../models");
const { sequelize } = require("../config/db");
const { createNotification } = require("../utils/notify");
const { createActivity } = require("../utils/activity");
const { getIO } = require("../socket");
const { sendEmail } = require("../services/email/emailService");
const { taskCreatedEmail } = require("../services/email/emailTemplates");

async function loadTaskForBoard(taskId) {
  return Task.findOne({
    where: { id: taskId },
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

// POST /api/projects
exports.createProject = async (req, res) => {
  try {
    const { name, description, status, priority, start_date, due_date } =
      req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({
        message: "Project name is required.",
      });
    }

    const project = await Project.create({
      organization_id: req.user.organization_id,
      created_by: req.user.id,
      name: name.trim(),
      description: description || null,
      status: status || "planned",
      priority: priority || "medium",
      start_date: start_date || null,
      due_date: due_date || null,
    });

    await createActivity({
      organization_id: req.user.organization_id,
      project_id: project.id,
      user_id: req.user.id,
      entity_type: "project",
      entity_id: project.id,
      action: "created",
      description: `Created project "${project.name}"`,
      metadata: {
        project_name: project.name,
      },
    });

    return res.status(201).json({
      message: "Project created successfully.",
      project,
    });
  } catch (error) {
    console.error("Create project error:", error);

    return res.status(500).json({
      message: "Server error while creating project.",
    });
  }
};

// GET /api/projects
exports.getProjects = async (req, res) => {
  try {
    const projects = await Project.findAll({
      where: {
        organization_id: req.user.organization_id,
      },
      order: [["created_at", "DESC"]],
    });

    return res.json({
      projects,
    });
  } catch (error) {
    console.error("Get projects error:", error);

    return res.status(500).json({
      message: "Server error while fetching projects.",
    });
  }
};

// GET /api/projects/:id
exports.getProjectById = async (req, res) => {
  try {
    const project = await Project.findOne({
      where: {
        id: req.params.id,
        organization_id: req.user.organization_id,
      },
    });

    if (!project) {
      return res.status(404).json({
        message: "Project not found.",
      });
    }
    return res.json({
      project,
    });
  } catch (error) {
    console.error("Get project error:", error);

    return res.status(500).json({
      message: "Server error while fetching project.",
    });
  }
};

// GET /api/projects/:id/members
exports.getProjectMembers = async (req, res) => {
  try {
    const project = await Project.findOne({
      where: {
        id: req.params.id,
        organization_id: req.user.organization_id,
      },
    });

    if (!project) {
      return res.status(404).json({
        message: "Project not found.",
      });
    }

    const members = await ProjectMember.findAll({
      where: {
        project_id: req.params.id,
      },
      include: [
        {
          model: User,
          as: "user",
          attributes: ["id", "first_name", "last_name", "email", "avatar_url"],
        },
      ],
      order: [["created_at", "ASC"]],
    });

    return res.json({
      members,
    });
  } catch (error) {
    console.error("Get project members error:", error);

    return res.status(500).json({
      message: "Server error while fetching project members.",
    });
  }
};

// PUT /api/projects/:id
exports.updateProject = async (req, res) => {
  try {
    const project = await Project.findOne({
      where: {
        id: req.params.id,
        organization_id: req.user.organization_id,
      },
    });

    if (!project) {
      return res.status(404).json({
        message: "Project not found.",
      });
    }

    const { name, description, status, priority, start_date, due_date } =
      req.body;

    if (name !== undefined) {
      if (!name.trim()) {
        return res.status(400).json({
          message: "Project name cannot be empty.",
        });
      }

      project.name = name.trim();
    }

    if (description !== undefined) {
      project.description = description;
    }

    if (status !== undefined) {
      project.status = status;
    }

    if (priority !== undefined) {
      project.priority = priority;
    }

    if (start_date !== undefined) {
      project.start_date = start_date;
    }

    if (due_date !== undefined) {
      project.due_date = due_date;
    }

    await project.save();

    await createActivity({
      organization_id: req.user.organization_id,
      project_id: project.id,
      user_id: req.user.id,
      entity_type: "project",
      entity_id: project.id,
      action: "updated",
      description: `Updated project "${project.name}"`,
      metadata: {
        project_name: project.name,
      },
    });

    return res.json({
      message: "Project updated successfully.",
      project,
    });
  } catch (error) {
    console.error("Update project error:", error);

    return res.status(500).json({
      message: "Server error while updating project.",
    });
  }
};

// DELETE /api/projects/:id
exports.deleteProject = async (req, res) => {
  try {
    const project = await Project.findOne({
      where: {
        id: req.params.id,
        organization_id: req.user.organization_id,
      },
    });

    if (!project) {
      return res.status(404).json({
        message: "Project not found.",
      });
    }

    // Capture identifying values before the row (and its FK-referenced id) is gone.
    const deletedProjectId = project.id;
    const deletedProjectName = project.name;

    await project.destroy();

    await createActivity({
      organization_id: req.user.organization_id,
      // project_id stays null: the activities.project_id FK cascades on project
      // deletion, so the deleted project's id is preserved in entity_id/metadata.
      project_id: null,
      user_id: req.user.id,
      entity_type: "project",
      entity_id: deletedProjectId,
      action: "deleted",
      description: `Deleted project "${deletedProjectName}"`,
      metadata: {
        project_id: deletedProjectId,
        project_name: deletedProjectName,
      },
    });

    return res.json({
      message: "Project deleted successfully.",
    });
  } catch (error) {
    console.error("Delete project error:", error);

    return res.status(500).json({
      message: "Server error while deleting project.",
    });
  }
};

// PUT /api/projects/:id/members/:userId
exports.updateProjectMember = async (req, res) => {
  try {
    const { id, userId } = req.params;
    const { role } = req.body;

    const allowedRoles = ["manager", "member", "viewer"];

    if (!role || !allowedRoles.includes(role)) {
      return res.status(400).json({
        message: "Valid role is required: manager, member, or viewer.",
      });
    }

    // Make sure the project belongs to the current organization
    const project = await Project.findOne({
      where: {
        id,
        organization_id: req.user.organization_id,
      },
    });

    if (!project) {
      return res.status(404).json({
        message: "Project not found.",
      });
    }

    // Find the project membership
    const projectMember = await ProjectMember.findOne({
      where: {
        project_id: id,
        user_id: userId,
      },
    });

    if (!projectMember) {
      return res.status(404).json({
        message: "Project member not found.",
      });
    }

    const previousRole = projectMember.role;
    projectMember.role = role;

    await projectMember.save();

    const memberUser = await User.findByPk(userId, {
      attributes: ["id", "first_name", "last_name"],
    });
    const memberName = memberUser
      ? `${memberUser.first_name ?? ""} ${memberUser.last_name ?? ""}`.trim()
      : "A member";

    await createActivity({
      organization_id: req.user.organization_id,
      project_id: project.id,
      task_id: null,
      user_id: req.user.id,
      entity_type: "member",
      entity_id: projectMember.id,
      action: "updated",
      description: `Updated ${memberName}'s role`,
      metadata: {
        member_id: projectMember.id,
        member_user_id: userId,
        member_name: memberName,
        project_id: project.id,
        previous_role: previousRole,
        new_role: role,
      },
    });

    return res.json({
      message: "Project member role updated successfully.",
      member: projectMember,
    });
  } catch (error) {
    console.error("Update project member error:", error);

    return res.status(500).json({
      message: "Server error while updating project member.",
    });
  }
};

// DELETE /api/projects/:id/members/:userId
exports.removeProjectMember = async (req, res) => {
  try {
    const { id, userId } = req.params;

    const project = await Project.findOne({
      where: {
        id,
        organization_id: req.user.organization_id,
      },
    });

    if (!project) {
      return res.status(404).json({
        message: "Project not found.",
      });
    }

    const projectMember = await ProjectMember.findOne({
      where: {
        project_id: id,
        user_id: userId,
      },
    });

    if (!projectMember) {
      return res.status(404).json({
        message: "Project member not found.",
      });
    }

    const removedMemberId = projectMember.id;
    const removedMemberRole = projectMember.role;

    const memberUser = await User.findByPk(userId, {
      attributes: ["id", "first_name", "last_name"],
    });
    const memberName = memberUser
      ? `${memberUser.first_name ?? ""} ${memberUser.last_name ?? ""}`.trim()
      : "A member";

    await projectMember.destroy();

    await createActivity({
      organization_id: req.user.organization_id,
      project_id: project.id,
      task_id: null,
      user_id: req.user.id,
      entity_type: "member",
      entity_id: removedMemberId,
      action: "deleted",
      description: `Removed ${memberName} from the project`,
      metadata: {
        member_id: removedMemberId,
        member_user_id: userId,
        member_name: memberName,
        project_id: project.id,
        role: removedMemberRole,
      },
    });

    return res.json({
      message: "Project member removed successfully.",
    });
  } catch (error) {
    console.error("Remove project member error:", error);

    return res.status(500).json({
      message: "Server error while removing project member.",
    });
  }
};

// POST /api/projects/:projectId/tasks
exports.createTask = async (req, res) => {
  try {
    const { projectId } = req.params;

    const {
      title,
      description,
      status,
      priority,
      assigned_to,
      due_date,
      tags,
    } = req.body;

    // 1. Validate title
    if (!title || !title.trim()) {
      return res.status(400).json({
        message: "Task title is required.",
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

    // 3. If assigning a user, verify they are a project member
    if (assigned_to) {
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
    }

    // 4. Create task + automatic task membership (creator, then assignee)
    // atomically, so a membership failure never leaves a task with no
    // members behind.
    const task = await sequelize.transaction(async (transaction) => {
      const createdTask = await Task.create(
        {
          organization_id: req.user.organization_id,
          project_id: projectId,
          title: title.trim(),
          description: description || null,
          status: status || "todo",
          priority: priority || "medium",
          assigned_to: assigned_to || null,
          created_by: req.user.id,
          due_date: due_date || null,
        },
        { transaction },
      );

      // Creator always becomes a task member.
      await TaskMember.findOrCreate({
        where: { task_id: createdTask.id, user_id: req.user.id },
        defaults: { added_by: req.user.id },
        transaction,
      });

      // If assigned, the assignee becomes a task member too. UNIQUE(task_id,
      // user_id) + findOrCreate keeps a creator === assignee task at one row.
      if (assigned_to) {
        await TaskMember.findOrCreate({
          where: { task_id: createdTask.id, user_id: assigned_to },
          defaults: { added_by: req.user.id },
          transaction,
        });
      }

      return createdTask;
    });

    // 5. Handle tags
    if (Array.isArray(tags) && tags.length > 0) {
      const tagRecords = await Promise.all(
        tags.map((name) =>
          Tag.findOrCreate({
            where: {
              name: name.trim().toLowerCase(),
              organization_id: req.user.organization_id,
            },
            defaults: {
              name: name.trim().toLowerCase(),
              organization_id: req.user.organization_id,
            },
          }).then(([tag]) => tag),
        ),
      );
      await task.setTags(tagRecords);
    }

    // 6. Reload task with tags
    const full = await Task.findOne({
      where: { id: task.id },
      include: [
        {
          model: Tag,
          as: "tags",
          attributes: ["id", "name"],
          through: { attributes: [] },
        },
      ],
    });

    if (full.assigned_to) {
      const actor = await User.findByPk(req.user.id, {
        attributes: ["first_name"],
      });
      await createNotification({
        organizationId: req.user.organization_id,
        userId: full.assigned_to,
        actorId: req.user.id,
        type: "task_assigned",
        taskId: full.id,
        projectId: projectId,
        message: `${actor?.first_name || "Someone"} assigned you to "${full.title}"`,
      });
    }

    if (full.assigned_to) {
      const assignee = await User.findByPk(full.assigned_to, {
        attributes: ["id", "first_name", "last_name", "email"],
      });

      const creator = await User.findByPk(req.user.id, {
        attributes: ["id", "first_name", "last_name", "email"],
      });

      if (assignee?.email) {
        const creatorName =
          `${creator?.first_name || ""} ${creator?.last_name || ""}`.trim() ||
          creator?.email ||
          "Someone";

        const recipientName =
          `${assignee?.first_name || ""} ${assignee?.last_name || ""}`.trim() ||
          assignee.email;

        const taskUrl = `${process.env.FRONTEND_URL}/projects/${projectId}/tasks/${full.id}`;

        const emailContent = taskCreatedEmail({
          recipientName,
          taskTitle: full.title,
          taskUrl,
          creatorName,
        });

        try {
          await sendEmail({
            to: assignee.email,
            subject: emailContent.subject,
            text: emailContent.text,
            html: emailContent.html,
          });
        } catch (emailError) {
          console.error(
            `Task assignment email failed for ${assignee.email}:`,
            emailError.message,
          );
        }
      }
    }

    try {
      const boardTask = await loadTaskForBoard(full.id);
      getIO().to(`project:${projectId}`).emit("task:created", boardTask);
    } catch (err) {
      console.error("Socket emit failed:", err.message);
    }

    await createActivity({
      organization_id: req.user.organization_id,
      project_id: task.project_id,
      task_id: task.id,
      user_id: req.user.id,
      entity_type: "task",
      entity_id: task.id,
      action: "created",
      description: `Created task "${task.title}"`,
      metadata: {
        task_title: task.title,
        project_id: task.project_id,
      },
    });

    return res.status(201).json({
      message: "Task created successfully.",
      task: full,
    });
  } catch (error) {
    console.error("Create task error:", error);

    return res.status(500).json({
      message: "Server error while creating task.",
    });
  }
};

// GET /api/projects/:projectId/tasks
exports.getProjectTasks = async (req, res) => {
  try {
    const { projectId } = req.params;

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

    // 2. Get all tasks for this project
    const tasks = await Task.findAll({
      where: {
        project_id: projectId,
        organization_id: req.user.organization_id,
      },
      include: [
        {
          model: require("../models").User,
          as: "assignee",
          attributes: ["id", "first_name", "last_name", "email", "avatar_url"],
        },
        {
          model: require("../models").User,
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
      order: [["created_at", "DESC"]],
    });

    return res.json({
      tasks,
    });
  } catch (error) {
    console.error("Get project tasks error:", error);

    return res.status(500).json({
      message: "Server error while fetching project tasks.",
    });
  }
};

// GET /api/projects/:projectId/tasks/:taskId
exports.getTaskById = async (req, res) => {
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

    // 2. Find task inside this project and organization
    const task = await Task.findOne({
      where: {
        id: taskId,
        project_id: projectId,
        organization_id: req.user.organization_id,
      },
      include: [
        {
          model: require("../models").User,
          as: "assignee",
          attributes: ["id", "first_name", "last_name", "email", "avatar_url"],
        },
        {
          model: require("../models").User,
          as: "creator",
          attributes: ["id", "first_name", "last_name", "email"],
        },
        {
          model: Tag,
          as: "tags",
          attributes: ["id", "name"],
          through: { attributes: [] },
        },
        {
          model: Project,
          as: "project",
          attributes: ["id", "name"],
        },
      ],
    });

    if (!task) {
      return res.status(404).json({
        message: "Task not found.",
      });
    }

    return res.json({
      task,
    });
  } catch (error) {
    console.error("Get task error:", error);

    return res.status(500).json({
      message: "Server error while fetching task.",
    });
  }
};

// PUT /api/projects/:projectId/tasks/:taskId
exports.updateTask = async (req, res) => {
  try {
    const { projectId, taskId } = req.params;

    const {
      title,
      description,
      status,
      priority,
      assigned_to,
      due_date,
      tags,
    } = req.body;

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

    // 2. Find task inside project and organization
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

    const isOwnerOrAdmin = ["owner", "admin"].includes(req.user.role);

    const isAssignedMember =
      task.assigned_to === req.user.id &&
      ["manager", "member"].includes(req.user.role);

    // 3. Check whether the user has permission to update this task
    if (!isOwnerOrAdmin && !isAssignedMember) {
      return res.status(403).json({
        message: "You do not have permission to update this task.",
      });
    }

    // ============================================================
    // ASSIGNED MEMBER
    // Can ONLY update task status
    // ============================================================

    if (!isOwnerOrAdmin && isAssignedMember) {
      const allowedStatuses = ["todo", "in_progress", "review", "completed"];

      if (status === undefined) {
        return res.status(400).json({
          message: "Assigned members can only update task status.",
        });
      }

      if (!allowedStatuses.includes(status)) {
        return res.status(400).json({
          message: "Invalid task status.",
        });
      }

      // Prevent member from modifying any other field
      const hasOtherChanges =
        title !== undefined ||
        description !== undefined ||
        priority !== undefined ||
        assigned_to !== undefined ||
        due_date !== undefined;

      if (hasOtherChanges) {
        return res.status(403).json({
          message: "You can only update the task status.",
        });
      }

      task.status = status;

      await task.save();

      // Handle tags update
      if (Array.isArray(tags)) {
        if (tags.length === 0) {
          await task.setTags([]);
        } else {
          const tagRecords = await Promise.all(
            tags.map((name) =>
              Tag.findOrCreate({
                where: {
                  name: name.trim().toLowerCase(),
                  organization_id: req.user.organization_id,
                },
                defaults: {
                  name: name.trim().toLowerCase(),
                  organization_id: req.user.organization_id,
                },
              }).then(([tag]) => tag),
            ),
          );
          await task.setTags(tagRecords);
        }
      }

      // Reload with tags
      const full = await Task.findOne({
        where: { id: task.id },
        include: [
          {
            model: Tag,
            as: "tags",
            attributes: ["id", "name"],
            through: { attributes: [] },
          },
        ],
      });

      try {
        const boardTask = await loadTaskForBoard(full.id);
        getIO().to(`project:${projectId}`).emit("task:updated", boardTask);
      } catch (err) {
        console.error("Socket emit failed:", err.message);
      }

      await createActivity({
        organization_id: req.user.organization_id,
        project_id: task.project_id,
        task_id: task.id,
        user_id: req.user.id,
        entity_type: "task",
        entity_id: task.id,
        action: "updated",
        description: `Updated task "${task.title}"`,
        metadata: {
          task_title: task.title,
          project_id: task.project_id,
        },
      });

      return res.json({
        message: "Task updated successfully.",
        task: full,
      });
    }

    // ============================================================
    // OWNER / ADMIN
    // Can update the complete task
    // ============================================================

    // 4. Validate title if provided
    if (title !== undefined) {
      if (!title.trim()) {
        return res.status(400).json({
          message: "Task title cannot be empty.",
        });
      }

      task.title = title.trim();
    }

    // 5. Update fields
    if (description !== undefined) {
      task.description = description;
    }

    if (status !== undefined) {
      const allowedStatuses = ["todo", "in_progress", "review", "completed"];

      if (!allowedStatuses.includes(status)) {
        return res.status(400).json({
          message: "Invalid task status.",
        });
      }

      task.status = status;
    }

    if (priority !== undefined) {
      task.priority = priority;
    }

    if (due_date !== undefined) {
      task.due_date = due_date;
    }

    const previousAssignee = task.assigned_to;

    // 6. Validate new assignee
    if (assigned_to !== undefined) {
      if (assigned_to === null) {
        task.assigned_to = null;
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

        task.assigned_to = assigned_to;
      }
    }

    await task.save();

    // New assignee automatically becomes a task member. The previous
    // assignee's membership is intentionally left untouched -- assignment
    // and membership are separate concepts (see TaskMember policy).
    if (
      assigned_to !== undefined &&
      task.assigned_to &&
      task.assigned_to !== previousAssignee
    ) {
      await TaskMember.findOrCreate({
        where: { task_id: task.id, user_id: task.assigned_to },
        defaults: { added_by: req.user.id },
      });
    }

    if (
      assigned_to !== undefined &&
      task.assigned_to &&
      task.assigned_to !== previousAssignee
    ) {
      const actor = await User.findByPk(req.user.id, {
        attributes: ["first_name"],
      });
      await createNotification({
        organizationId: req.user.organization_id,
        userId: task.assigned_to,
        actorId: req.user.id,
        type: "task_assigned",
        taskId: task.id,
        projectId: projectId,
        message: `${actor?.first_name || "Someone"} assigned you to "${task.title}"`,
      });
    }

    try {
      const boardTask = await loadTaskForBoard(task.id);
      getIO().to(`project:${projectId}`).emit("task:updated", boardTask);
    } catch (err) {
      console.error("Socket emit failed:", err.message);
    }

    await createActivity({
      organization_id: req.user.organization_id,
      project_id: task.project_id,
      task_id: task.id,
      user_id: req.user.id,
      entity_type: "task",
      entity_id: task.id,
      action: "updated",
      description: `Updated task "${task.title}"`,
      metadata: {
        task_title: task.title,
        project_id: task.project_id,
      },
    });

    return res.json({
      message: "Task updated successfully.",
      task,
    });
  } catch (error) {
    console.error("Update task error:", error);

    return res.status(500).json({
      message: "Server error while updating task.",
    });
  }
};

// DELETE /api/projects/:projectId/tasks/:taskId
exports.deleteTask = async (req, res) => {
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

    // 2. Find task inside project and organization
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

    // 3. Delete task
    const deletedTaskId = task.id;
    const deletedTaskTitle = task.title;
    const deletedProjectId = task.project_id;
    await task.destroy();

    try {
      getIO()
        .to(`project:${projectId}`)
        .emit("task:deleted", { taskId: deletedTaskId });
    } catch (err) {
      console.error("Socket emit failed:", err.message);
    }

    await createActivity({
      organization_id: req.user.organization_id,
      // task_id stays null: activities.task_id FK cascades on task deletion,
      // so the deleted task id is preserved in entity_id / metadata instead.
      project_id: deletedProjectId,
      task_id: null,
      user_id: req.user.id,
      entity_type: "task",
      entity_id: deletedTaskId,
      action: "deleted",
      description: `Deleted task "${deletedTaskTitle}"`,
      metadata: {
        task_id: deletedTaskId,
        task_title: deletedTaskTitle,
        project_id: deletedProjectId,
      },
    });

    return res.json({
      message: "Task deleted successfully.",
    });
  } catch (error) {
    console.error("Delete task error:", error);

    return res.status(500).json({
      message: "Server error while deleting task.",
    });
  }
};
