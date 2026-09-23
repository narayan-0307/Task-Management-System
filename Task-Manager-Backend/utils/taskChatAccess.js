const {
    Task,
    ProjectMember,
    OrganizationMember,
    TaskMember,
} = require("../models");
const { isActiveOrgMember } = require("./organizationAccess");

/**
 * Check whether a user is allowed to access a task's chat.
 *
 * Access is granted when the user is:
 * - an active organization owner/admin
 * - the task creator
 * - the task assignee
 * - an active member of the task's project
 *
 * The user must first belong to the task's organization.
 *
 * @param {number} userId
 * @param {number} taskId
 * @returns {Promise<{
 *   allowed: boolean,
 *   task: object|null,
 *   reason: string
 * }>}
 */
async function canAccessTaskChat(userId, taskId) {
    const task = await Task.findByPk(taskId);

    if (!task) {
        return {
            allowed: false,
            task: null,
            reason: "TASK_NOT_FOUND",
        };
    }

    // The user must be an active member of the task's organization.
    const organizationMember = await OrganizationMember.findOne({
        where: {
            organization_id: task.organization_id,
            user_id: userId,
            is_active: true,
        },
    });

    if (!organizationMember) {
        return {
            allowed: false,
            task,
            reason: "NOT_ORGANIZATION_MEMBER",
        };
    }

    // Organization owners and admins can access task chat.
    if (
        organizationMember.role === "owner" ||
        organizationMember.role === "admin"
    ) {
        return {
            allowed: true,
            task,
            reason: "ORGANIZATION_ADMIN",
        };
    }

    // Task creator can access the task chat.
    if (Number(task.created_by) === Number(userId)) {
        return {
            allowed: true,
            task,
            reason: "TASK_CREATOR",
        };
    }

    // Assigned user can access the task chat.
    if (
        task.assigned_to !== null &&
        Number(task.assigned_to) === Number(userId)
    ) {
        return {
            allowed: true,
            task,
            reason: "TASK_ASSIGNEE",
        };
    }

    // Active project members can access the task chat.
    const projectMember = await ProjectMember.findOne({
        where: {
            project_id: task.project_id,
            user_id: userId,
        },
    });

    if (projectMember) {
        return {
            allowed: true,
            task,
            reason: "PROJECT_MEMBER",
        };
    }

    return {
        allowed: false,
        task,
        reason: "TASK_CHAT_ACCESS_DENIED",
    };
}

/**
 * Step 2C-1: TaskMember-only Task Chat authorization, used by the REST
 * message endpoints ONLY.
 *
 * Unlike canAccessTaskChat() above (still used by Socket.IO's task:join and
 * left unchanged in this step), this grants access SOLELY on an explicit
 * TaskMember row for this exact task. Organization owner/admin, task
 * creator, current/previous assignee, and plain project membership do NOT
 * bypass this check -- a previous assignee or admin only passes if they
 * also hold a TaskMember row.
 *
 * @param {number} userId
 * @param {number} taskId
 * @returns {Promise<{
 *   allowed: boolean,
 *   task: object|null,
 *   reason: string
 * }>}
 */
async function canAccessTaskChatViaMembership(userId, taskId) {
    const task = await Task.findByPk(taskId);

    if (!task) {
        return {
            allowed: false,
            task: null,
            reason: "TASK_NOT_FOUND",
        };
    }

    // The user must be an active member of the task's organization.
    const isOrgMember = await isActiveOrgMember(userId, task.organization_id);

    if (!isOrgMember) {
        return {
            allowed: false,
            task,
            reason: "NOT_ORGANIZATION_MEMBER",
        };
    }

    // TaskMember is the sole source of truth for chat access in this step --
    // no organization-role, creator, assignee, or project-member bypass.
    const taskMember = await TaskMember.findOne({
        where: {
            task_id: task.id,
            user_id: userId,
        },
    });

    if (!taskMember) {
        return {
            allowed: false,
            task,
            reason: "NOT_TASK_MEMBER",
        };
    }

    return {
        allowed: true,
        task,
        reason: "TASK_MEMBER",
    };
}

module.exports = {
    canAccessTaskChat,
    canAccessTaskChatViaMembership,
};