const {
    Task,
    ProjectMember,
    OrganizationMember,
} = require("../models");

/**
 * Load the task and the caller's active organization membership for it, in
 * one place, so both access checks below start from the same ground truth.
 */
async function loadTaskAndOrgMembership(userId, taskId) {
    const task = await Task.findByPk(taskId);

    if (!task) {
        return { task: null, organizationMember: null };
    }

    const organizationMember = await OrganizationMember.findOne({
        where: {
            organization_id: task.organization_id,
            user_id: userId,
            is_active: true,
        },
    });

    return { task, organizationMember };
}

/**
 * Check whether a user is allowed to VIEW a task's member list.
 *
 * Access is granted when the user is:
 * - an active organization owner/admin
 * - the task creator
 * - the task assignee
 * - an active member of the task's project
 *
 * The user must first belong to the task's organization. This intentionally
 * mirrors canAccessTaskChat()'s "legitimate access" definition so an
 * unrelated organization member cannot enumerate task membership.
 *
 * @param {number} userId
 * @param {number} taskId
 * @returns {Promise<{ allowed: boolean, task: object|null, reason: string }>}
 */
async function canViewTaskMembers(userId, taskId) {
    const { task, organizationMember } = await loadTaskAndOrgMembership(
        userId,
        taskId,
    );

    if (!task) {
        return {
            allowed: false,
            task: null,
            reason: "TASK_NOT_FOUND",
        };
    }

    if (!organizationMember) {
        return {
            allowed: false,
            task,
            reason: "NOT_ORGANIZATION_MEMBER",
        };
    }

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

    if (Number(task.created_by) === Number(userId)) {
        return {
            allowed: true,
            task,
            reason: "TASK_CREATOR",
        };
    }

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
        reason: "TASK_MEMBER_VIEW_DENIED",
    };
}

/**
 * Check whether a user is allowed to ADD/REMOVE a task's members.
 *
 * Access is granted when the user is:
 * - an active organization owner/admin
 * - the task creator
 * - a ProjectMember of the task's project with role === "manager"
 *
 * This is intentionally the first authorization check in the codebase that
 * relies on ProjectMember.role rather than the organization-level role.
 * Being a plain project member (role "member"/"viewer") or the current task
 * assignee does NOT grant management rights on its own.
 *
 * @param {number} userId
 * @param {number} taskId
 * @returns {Promise<{ allowed: boolean, task: object|null, reason: string }>}
 */
async function canManageTaskMembers(userId, taskId) {
    const { task, organizationMember } = await loadTaskAndOrgMembership(
        userId,
        taskId,
    );

    if (!task) {
        return {
            allowed: false,
            task: null,
            reason: "TASK_NOT_FOUND",
        };
    }

    if (!organizationMember) {
        return {
            allowed: false,
            task,
            reason: "NOT_ORGANIZATION_MEMBER",
        };
    }

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

    if (Number(task.created_by) === Number(userId)) {
        return {
            allowed: true,
            task,
            reason: "TASK_CREATOR",
        };
    }

    const projectManager = await ProjectMember.findOne({
        where: {
            project_id: task.project_id,
            user_id: userId,
            role: "manager",
        },
    });

    if (projectManager) {
        return {
            allowed: true,
            task,
            reason: "PROJECT_MANAGER",
        };
    }

    return {
        allowed: false,
        task,
        reason: "TASK_MEMBER_MANAGEMENT_DENIED",
    };
}

module.exports = {
    canViewTaskMembers,
    canManageTaskMembers,
};
