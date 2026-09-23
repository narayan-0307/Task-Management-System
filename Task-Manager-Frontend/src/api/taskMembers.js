import api from "./client.js";

export const listTaskMembers = (projectId, taskId) =>
  api.get(`/projects/${projectId}/tasks/${taskId}/members`);
export const addTaskMember = (projectId, taskId, userId) =>
  api.post(`/projects/${projectId}/tasks/${taskId}/members`, { user_id: userId });
export const removeTaskMember = (projectId, taskId, userId) =>
  api.delete(`/projects/${projectId}/tasks/${taskId}/members/${userId}`);
