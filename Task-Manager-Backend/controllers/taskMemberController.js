const { Task, TaskMember, User, OrganizationMember } = require("../models");
const {
  canViewTaskMembers,
  canManageTaskMembers,
} = require("../utils/taskMemberAccess");
const { evictUserFromTaskRoom } = require("../socket");

const SAFE_USER_ATTRIBUTES = [
  "id",
  "first_name",
  "last_name",
  "email",
  "avatar_url",
];

// Shared "does this task belong to this project, in this organization"
// lookup, matching the pattern used by getTaskById/updateTask/deleteTask.
async function findTaskInProject(req) {
  const { projectId, taskId } = req.params;

  const task = await Task.findOne({
    where: {
      id: taskId,
      project_id: projectId,
      organization_id: req.user.organization_id,
    },
  });

  return task;
}

// GET /api/projects/:projectId/tasks/:taskId/members
exports.getTaskMembers = async (req, res) => {
  try {
    const task = await findTaskInProject(req);

    if (!task) {
      return res.status(404).json({
        message: "Task not found.",
      });
    }

    const access = await canViewTaskMembers(req.user.id, task.id);

    if (!access.allowed) {
      return res.status(403).json({
        message: "You do not have access to this task's members.",
      });
    }

    const members = await TaskMember.findAll({
      where: { task_id: task.id },
      include: [
        {
          model: User,
          as: "user",
          attributes: SAFE_USER_ATTRIBUTES,
        },
        {
          model: User,
          as: "addedBy",
          attributes: SAFE_USER_ATTRIBUTES,
        },
      ],
      order: [["created_at", "ASC"]],
    });

    return res.json({
      members,
    });
  } catch (error) {
    console.error("Get task members error:", error);

    return res.status(500).json({
      message: "Server error while fetching task members.",
    });
  }
};

// POST /api/projects/:projectId/tasks/:taskId/members
exports.addTaskMember = async (req, res) => {
  try {
    const { user_id } = req.body;

    if (!user_id) {
      return res.status(400).json({
        message: "user_id is required.",
      });
    }

    const task = await findTaskInProject(req);

    if (!task) {
      return res.status(404).json({
        message: "Task not found.",
      });
    }

    const access = await canManageTaskMembers(req.user.id, task.id);

    if (!access.allowed) {
      return res.status(403).json({
        message: "You do not have permission to manage this task's members.",
      });
    }

    // Target user must exist and be an active member of the task's
    // organization -- this also rejects users from another organization.
    const targetOrgMember = await OrganizationMember.findOne({
      where: {
        organization_id: task.organization_id,
        user_id,
        is_active: true,
      },
    });

    if (!targetOrgMember) {
      return res.status(400).json({
        message: "User is not an active member of this organization.",
      });
    }

    const existingMember = await TaskMember.findOne({
      where: {
        task_id: task.id,
        user_id,
      },
    });

    if (existingMember) {
      return res.status(409).json({
        message: "User is already a member of this task.",
      });
    }

    const member = await TaskMember.create({
      task_id: task.id,
      user_id,
      added_by: req.user.id,
    });

    const full = await TaskMember.findByPk(member.id, {
      include: [
        {
          model: User,
          as: "user",
          attributes: SAFE_USER_ATTRIBUTES,
        },
        {
          model: User,
          as: "addedBy",
          attributes: SAFE_USER_ATTRIBUTES,
        },
      ],
    });

    return res.status(201).json({
      message: "Task member added successfully.",
      member: full,
    });
  } catch (error) {
    console.error("Add task member error:", error);

    return res.status(500).json({
      message: "Server error while adding task member.",
    });
  }
};

// DELETE /api/projects/:projectId/tasks/:taskId/members/:userId
exports.removeTaskMember = async (req, res) => {
  try {
    const { userId } = req.params;

    const task = await findTaskInProject(req);

    if (!task) {
      return res.status(404).json({
        message: "Task not found.",
      });
    }

    const access = await canManageTaskMembers(req.user.id, task.id);

    if (!access.allowed) {
      return res.status(403).json({
        message: "You do not have permission to manage this task's members.",
      });
    }

    const member = await TaskMember.findOne({
      where: {
        task_id: task.id,
        user_id: userId,
      },
    });

    if (!member) {
      return res.status(404).json({
        message: "Task member not found.",
      });
    }

    // Only the membership row is removed -- messages, attachments, the task
    // itself and the current assignment are untouched.
    await member.destroy();

    // Evict any already-connected socket(s) this user has open from the
    // task's realtime room so removal takes effect immediately, not just on
    // their next REST call. Best-effort: never fails the primary request.
    await evictUserFromTaskRoom(userId, task.id);

    return res.json({
      message: "Task member removed successfully.",
    });
  } catch (error) {
    console.error("Remove task member error:", error);

    return res.status(500).json({
      message: "Server error while removing task member.",
    });
  }
};
