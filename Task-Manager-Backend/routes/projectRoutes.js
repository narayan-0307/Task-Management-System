const express = require("express");
const router = express.Router();

const { requireAuth } = require("../middleware/authMiddleware");
const { requireRole } = require("../middleware/roleMiddleware");

const {
  createProject,
  getProjects,
  getProjectById,
  getProjectMembers,
  updateProjectMember,
  removeProjectMember,
  createTask,
  getProjectTasks,
  getTaskById,
  updateTask,
  deleteTask,
  updateProject,
  deleteProject,
} = require("../controllers/projectController");
const { addProjectMember } = require("../controllers/projectMemberController");
const {
  getTaskMembers,
  addTaskMember,
  removeTaskMember,
} = require("../controllers/taskMemberController");
const { createSubtask, getSubtasks, updateSubtask, deleteSubtask } = require("../controllers/subtaskController");
const { getComments, createComment, deleteComment } = require("../controllers/commentController");
const { uploadAttachment, getAttachments, deleteAttachment } = require("../controllers/attachmentController");
const { getMyTasks, getMySubtasks } = require("../controllers/taskController");
const {
  getMessages,
  createMessage,
} = require("../controllers/taskChatController");
const upload = require("../middleware/upload");
const questionRoutes = require("./questionRoute");

// All project routes require authentication
router.use(requireAuth);

// Create project
router.post(
  "/",
  requireRole("owner", "admin", "manager"),
  createProject
);
// Get all projects for current organization
router.get(
  "/",
  requireRole("owner", "admin", "manager", "member", "client"),
  getProjects
);

// Get members assigned to a project
router.get(
  "/:id/members",
  requireRole("owner", "admin", "manager", "member", "client"),
  getProjectMembers
);

// Update project member role
router.put(
  "/:id/members/:userId",
  requireRole("owner", "admin", "manager"),
  updateProjectMember
);

// delete project member role
router.delete(
  "/:id/members/:userId",
  requireRole("owner", "admin", "manager"),
  removeProjectMember
);

// Create task under a project
router.post(
  "/:projectId/tasks",
  requireRole("owner", "admin", "manager", "member"),
  createTask
);

router.get(
  "/my-tasks",
  requireRole("owner", "admin", "manager", "member", "client"),
  getMyTasks
);

// Get subtasks assigned to the logged-in user
router.get(
  "/my-subtasks",
  requireRole("owner", "admin", "manager", "member", "client"),
  getMySubtasks
);

// Get all tasks under a project
router.get(
  "/:projectId/tasks",
  requireRole("owner", "admin", "manager", "member", "client"),
  getProjectTasks
);

// Get single task under a project
router.get(
  "/:projectId/tasks/:taskId",
  requireRole("owner", "admin", "manager", "member", "client"),
  getTaskById
);

// Update task under a project
router.put("/:projectId/tasks/:taskId",
  requireRole("owner", "admin", "manager", "member"),
  updateTask
);

// Delete task under a project
router.delete(
  "/:projectId/tasks/:taskId",
  requireRole("owner", "admin", "manager"),
  deleteTask
);

// GET /api/projects/:projectId/tasks/:taskId/members
router.get(
  "/:projectId/tasks/:taskId/members",
  requireRole("owner", "admin", "manager", "member", "client"),
  getTaskMembers
);

// POST /api/projects/:projectId/tasks/:taskId/members
router.post(
  "/:projectId/tasks/:taskId/members",
  requireRole("owner", "admin", "manager", "member"),
  addTaskMember
);

// DELETE /api/projects/:projectId/tasks/:taskId/members/:userId
router.delete(
  "/:projectId/tasks/:taskId/members/:userId",
  requireRole("owner", "admin", "manager", "member"),
  removeTaskMember
);

// Get single project
router.get(
  "/:id",
  requireRole("owner", "admin", "manager", "member", "client"),
  getProjectById
);

// Update project
router.put(
  "/:id",
  requireRole("owner", "admin", "manager"),
  updateProject
);

// Delete project
router.delete(
  "/:id",
  requireRole("owner", "admin"),
  deleteProject
);

router.post(
  "/:projectId/members",
  requireRole("owner", "admin", "manager"),
  addProjectMember
);

// POST /api/projects/:projectId/tasks/:taskId/subtasks 
router.post(
  "/:projectId/tasks/:taskId/subtasks",
  requireRole("owner", "admin", "manager", "member"),
  createSubtask
);

// GET /api/projects/:projectId/tasks/:taskId/subtasks
router.get(
  "/:projectId/tasks/:taskId/subtasks",
  requireRole("owner", "admin", "manager", "member", "client"),
  getSubtasks
);

// PUT /api/projects/:projectId/tasks/:taskId/subtasks/:subtaskId
router.put(
  "/:projectId/tasks/:taskId/subtasks/:subtaskId",
  requireRole("owner", "admin", "manager", "member"),
  updateSubtask
);


// DELETE /api/projects/:projectId/tasks/:taskId/subtasks/:subtaskId
router.delete(
  "/:projectId/tasks/:taskId/subtasks/:subtaskId",
  requireRole("owner", "admin", "manager"),
  deleteSubtask
);


// GET /api/projects/:projectId/tasks/:taskId/comments
router.get(
  "/:projectId/tasks/:taskId/comments",
  requireRole("owner", "admin", "manager", "member"),
  getComments
);

// POST /api/projects/:projectId/tasks/:taskId/comments
router.post(
  "/:projectId/tasks/:taskId/comments",
  requireRole("owner", "admin", "manager", "member"),
  createComment
);

// DELETE /api/projects/:projectId/tasks/:taskId/comments/:commentId
router.delete(
  "/:projectId/tasks/:taskId/comments/:commentId",
  requireRole("owner", "admin", "manager", "member"),
  deleteComment
);

// GET /api/projects/:projectId/tasks/:taskId/subtasks/:subtaskId/comments
router.get(
  "/:projectId/tasks/:taskId/subtasks/:subtaskId/comments",
  requireRole("owner", "admin", "manager", "member"),
  getComments
);

// POST /api/projects/:projectId/tasks/:taskId/subtasks/:subtaskId/comments
router.post(
  "/:projectId/tasks/:taskId/subtasks/:subtaskId/comments",
  requireRole("owner", "admin", "manager", "member"),
  createComment
);

// DELETE /api/projects/:projectId/tasks/:taskId/subtasks/:subtaskId/comments/:commentId
router.delete(
  "/:projectId/tasks/:taskId/subtasks/:subtaskId/comments/:commentId",
  requireRole("owner", "admin", "manager", "member"),
  deleteComment
);

// GET /api/projects/:projectId/tasks/:taskId/attachments
router.get(
  "/:projectId/tasks/:taskId/attachments",
  requireRole("owner", "admin", "manager", "member"),
  getAttachments
);

// POST /api/projects/:projectId/tasks/:taskId/attachments
router.post(
  "/:projectId/tasks/:taskId/attachments",
  requireRole("owner", "admin", "manager", "member"),
  upload.single("file"),
  uploadAttachment
);

// DELETE /api/projects/:projectId/tasks/:taskId/attachments/:attachmentId
router.delete(
  "/:projectId/tasks/:taskId/attachments/:attachmentId",
  requireRole("owner", "admin", "manager", "member"),
  deleteAttachment
);

// GET /api/projects/:projectId/tasks/:taskId/subtasks/:subtaskId/attachments
router.get(
  "/:projectId/tasks/:taskId/subtasks/:subtaskId/attachments",
  requireRole("owner", "admin", "manager", "member"),
  getAttachments
);

// POST /api/projects/:projectId/tasks/:taskId/subtasks/:subtaskId/attachments
router.post(
  "/:projectId/tasks/:taskId/subtasks/:subtaskId/attachments",
  requireRole("owner", "admin", "manager", "member"),
  upload.single("file"),
  uploadAttachment
);

// DELETE /api/projects/:projectId/tasks/:taskId/subtasks/:subtaskId/attachments/:attachmentId
router.delete(
  "/:projectId/tasks/:taskId/subtasks/:subtaskId/attachments/:attachmentId",
  requireRole("owner", "admin", "manager", "member"),
  deleteAttachment
);


// GET comment attachments
router.get(
  "/:projectId/tasks/:taskId/comments/:commentId/attachments",
  requireRole("owner", "admin", "manager", "member"),
  getAttachments
);

// POST comment attachment
router.post(
  "/:projectId/tasks/:taskId/comments/:commentId/attachments",
  requireRole("owner", "admin", "manager", "member"),
  upload.single("file"),
  uploadAttachment
);

// GET /api/projects/:projectId/tasks/:taskId/messages
router.get(
  "/:projectId/tasks/:taskId/messages",
  requireRole("owner", "admin", "manager", "member", "client"),
  getMessages
);

// POST /api/projects/:projectId/tasks/:taskId/messages
router.post(
  "/:projectId/tasks/:taskId/messages",
  requireRole("owner", "admin", "manager", "member"),
  createMessage
);
module.exports = router;