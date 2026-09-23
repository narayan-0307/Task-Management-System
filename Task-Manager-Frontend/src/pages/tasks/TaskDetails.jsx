import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Download,
  MessageSquare,
  MoreVertical,
  Pencil,
  Paperclip,
  Plus,
  Share2,
  Trash2,
  Upload,
  X,
} from "lucide-react";

import AppLayout from "../../components/layout/AppLayout.jsx";
import Button from "../../components/ui/Button.jsx";
import Avatar from "../../components/ui/Avatar.jsx";
import Spinner from "../../components/common/Spinner.jsx";
import ErrorState from "../../components/common/ErrorState.jsx";
import ConfirmDialog from "../../components/common/ConfirmDialog.jsx";
import TaskStatusBadge from "../../components/tasks/TaskStatusBadge.jsx";
import TaskPriorityBadge from "../../components/tasks/TaskPriorityBadge.jsx";
import TaskFormModal from "../../components/tasks/TaskFormModal.jsx";
import SubtaskFormModal from "../../components/subtasks/SubtaskFormModal.jsx";
import SubtaskDetailPanel from "../../components/subtasks/SubtaskDetailPanel.jsx";
import { getTask, updateTask, deleteTask } from "../../api/tasks.js";
import {
  listAttachments,
  uploadAttachment,
  deleteAttachment,
  uploadCommentAttachment,
} from "../../api/attachments.js";

import {
  listComments,
  createComment,
  deleteComment,
} from "../../api/comments.js";
import {
  listSubtasks,
  updateSubtask,
  deleteSubtask,
} from "../../api/subtasks.js";
import { listProjectMembers } from "../../api/projectMembers.js";
import { listTaskMembers } from "../../api/taskMembers.js";
import { getSocket } from "../../lib/socket.js";
import { useAuth } from "../../context/AuthContext.jsx";
import { useToast } from "../../context/ToastContext.jsx";
import {
  canEditTask,
  canDeleteTask,
  canEditSubtaskFully,
  canUpdateSubtaskStatus,
  canDeleteComment,
  canManageTaskMembers,
} from "../../config/permissions.js";
import { API_ORIGIN } from "../../api/client.js";
import TaskActivityTab from "../../components/tasks/TaskActivityTab.jsx";
import TaskChatDrawer from "../../components/tasks/TaskChatDrawer.jsx";
import TaskMembersTab from "../../components/tasks/TaskMembersTab.jsx";

// ─── helpers ────────────────────────────────────────────────────────────────

function formatDate(value) {
  if (!value) return "--";
  return new Date(value).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function getUserName(person) {
  if (!person) return "--";
  return (
    `${person.first_name || ""} ${person.last_name || ""}`.trim() ||
    person.name ||
    person.email ||
    "--"
  );
}

function renderCommentContent(content, members = []) {
  if (!content) return null;

  const mentionMap = {};
  members.forEach((member) => {
    const u = member.user;
    if (u) {
      const nameStr = `@${u.first_name || ""}_${u.last_name || ""}`
        .trim()
        .replace(/\s+/g, "_");
      mentionMap[nameStr.toLowerCase()] = {
        mention: nameStr,
        displayName: `${u.first_name || ""} ${u.last_name || ""}`.trim(),
      };
    }
  });

  const sortedMentions = Object.keys(mentionMap).sort(
    (a, b) => b.length - a.length,
  );
  if (sortedMentions.length === 0) return content;

  const escapedMentions = sortedMentions.map((m) =>
    m.replace(/[-\/\\^$*+?.()|[\]{}]/g, "\\$&"),
  );
  const pattern = new RegExp(`(${escapedMentions.join("|")})`, "gi");

  const parts = content.split(pattern);
  return parts.map((part, index) => {
    const lowerPart = part.toLowerCase();
    if (mentionMap[lowerPart]) {
      const { displayName } = mentionMap[lowerPart];
      return (
        <span
          key={index}
          className="inline-flex items-center rounded bg-accentblue-soft px-1.5 py-0.5 text-xs font-semibold text-accentblue mx-0.5 hover:bg-accentblue-soft transition cursor-default"
        >
          @{displayName}
        </span>
      );
    }
    return part;
  });
}

/** Cycle: todo → in_progress → completed → todo */
function nextStatus(current) {
  if (current === "todo") return "in_progress";
  if (current === "in_progress") return "completed";
  return "todo";
}

const STATUS_CYCLE_LABEL = {
  todo: "Mark in progress",
  in_progress: "Mark completed",
  completed: "Reset to to-do",
};

// ─── component ──────────────────────────────────────────────────────────────

export default function TaskDetails() {
  const { projectId, taskId } = useParams();
  const { user } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();

  // ── task state ──
  const [task, setTask] = useState(null);
  const [members, setMembers] = useState([]);
  const [taskMembers, setTaskMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // ── task modal/dialog state ──
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [chatDrawerOpen, setChatDrawerOpen] = useState(false);

  // ── subtask modal/dialog state ──
  const [subtaskModalOpen, setSubtaskModalOpen] = useState(false);
  const [editingSubtask, setEditingSubtask] = useState(null);

  // ── tabs ──
  const [activeTab, setActiveTab] = useState("subtasks");

  // ── subtask state ──
  const [subtasks, setSubtasks] = useState([]);
  const [subtaskUpdating, setSubtaskUpdating] = useState({}); // { [id]: true }
  const [subtaskDeleting, setSubtaskDeleting] = useState({}); // { [id]: true }
  const [subtaskToDelete, setSubtaskToDelete] = useState(null); // subtask object
  const [expandedSubtaskId, setExpandedSubtaskId] = useState(null);

  // ── attachment state ──
  const [attachments, setAttachments] = useState([]);
  const [attachmentUploading, setAttachmentUploading] = useState(false);
  const [attachmentToDelete, setAttachmentToDelete] = useState(null);
  const [attachmentDeleting, setAttachmentDeleting] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef(null);

  // ── comment state ──
  const [comments, setComments] = useState([]);
  const [commentText, setCommentText] = useState("");
  const [commentSending, setCommentSending] = useState(false);
  const [commentToDelete, setCommentToDelete] = useState(null);
  const [commentFile, setCommentFile] = useState(null);
  const commentFileInputRef = useRef(null);
  const commentTextAreaRef = useRef(null);
  const [commentDeleting, setCommentDeleting] = useState(false);

  // ── mention autocomplete state ──
  const [showMentionDropdown, setShowMentionDropdown] = useState(false);
  const [mentionSearch, setMentionSearch] = useState("");
  const [mentionTriggerIndex, setMentionTriggerIndex] = useState(-1);
  const [activeMentionIndex, setActiveMentionIndex] = useState(0);

  const filteredMembers = useMemo(() => {
    if (!mentionSearch) return members;
    return members.filter((member) => {
      const u = member.user;
      if (!u) return false;
      const fullName =
        `${u.first_name || ""} ${u.last_name || ""}`.toLowerCase();
      const email = (u.email || "").toLowerCase();
      const query = mentionSearch.toLowerCase();
      return fullName.includes(query) || email.includes(query);
    });
  }, [members, mentionSearch]);

  // ─── data loading ────────────────────────────────────────────────────────

  function fetchAll() {
    setLoading(true);
    setError("");

    Promise.all([
      getTask(projectId, taskId),
      listProjectMembers(projectId),
      listTaskMembers(projectId, taskId),
      listSubtasks(projectId, taskId),
      listComments(projectId, taskId),
      listAttachments(projectId, taskId),
    ])
      .then(
        ([
          taskRes,
          membersRes,
          taskMembersRes,
          subtasksRes,
          commentsRes,
          attachmentsRes,
        ]) => {
          setTask(taskRes.data.task);
          setMembers(membersRes.data.members);
          setTaskMembers(taskMembersRes.data.members);
          setSubtasks(subtasksRes.data.subtasks);
          setComments(commentsRes.data.comments);
          setAttachments(attachmentsRes.data.attachments);
        },
      )
      .catch((err) => {
        setError(err.response?.data?.message || "Failed to load task details.");
      })
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    fetchAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, taskId]);

  useEffect(() => {
    const socket = getSocket();
    socket.emit("task:join", taskId);

    function handleSubtaskCreated(subtask) {
      setSubtasks((prev) =>
        prev.some((s) => s.id === subtask.id) ? prev : [...prev, subtask],
      );
    }
    function handleSubtaskUpdated(subtask) {
      setSubtasks((prev) =>
        prev.map((s) => (s.id === subtask.id ? subtask : s)),
      );
    }
    function handleSubtaskDeleted({ subtaskId }) {
      setSubtasks((prev) => prev.filter((s) => s.id !== subtaskId));
    }

    function handleCommentCreated(comment) {
      setComments((prev) =>
        prev.some((c) => c.id === comment.id) ? prev : [...prev, comment],
      );
    }
    function handleCommentDeleted({ commentId }) {
      setComments((prev) => prev.filter((c) => c.id !== commentId));
    }

    socket.on("subtask:created", handleSubtaskCreated);
    socket.on("subtask:updated", handleSubtaskUpdated);
    socket.on("subtask:deleted", handleSubtaskDeleted);
    socket.on("comment:created", handleCommentCreated);
    socket.on("comment:deleted", handleCommentDeleted);

    return () => {
      socket.emit("task:leave", taskId);
      socket.off("subtask:created", handleSubtaskCreated);
      socket.off("subtask:updated", handleSubtaskUpdated);
      socket.off("subtask:deleted", handleSubtaskDeleted);
      socket.off("comment:created", handleCommentCreated);
      socket.off("comment:deleted", handleCommentDeleted);
    };
  }, [taskId]);

  // ─── task actions ─────────────────────────────────────────────────────────

  function handleDelete() {
    setDeleting(true);
    deleteTask(projectId, taskId)
      .then(() => {
        toast.success("Task deleted.");
        navigate(`/projects/${projectId}`);
      })
      .catch((err) =>
        toast.error(err.response?.data?.message || "Failed to delete task."),
      )
      .finally(() => setDeleting(false));
  }

  function handleStatusChange(e) {
    updateTask(projectId, taskId, { status: e.target.value })
      .then(() => {
        toast.success("Task status updated.");
        fetchAll();
      })
      .catch((err) =>
        toast.error(
          err.response?.data?.message || "Failed to update task status.",
        ),
      );
  }

  function handleComplete() {
    updateTask(projectId, taskId, { status: "completed" })
      .then(() => {
        toast.success("Task marked as completed.");
        fetchAll();
      })
      .catch((err) =>
        toast.error(err.response?.data?.message || "Failed to complete task."),
      );
  }

  // ─── subtask actions ──────────────────────────────────────────────────────

  /** Cycle a subtask's status optimistically */
  function handleSubtaskStatusToggle(subtask) {
    if (subtaskUpdating[subtask.id]) return;

    // Members can only toggle subtasks assigned to them
    if (user?.role === "member" && subtask.assigned_to !== user?.id) {
      toast.error("You can only update subtasks assigned to you.");
      return;
    }

    const next = nextStatus(subtask.status);
    const previous = subtask.status;

    // optimistic update
    setSubtasks((prev) =>
      prev.map((s) => (s.id === subtask.id ? { ...s, status: next } : s)),
    );
    setSubtaskUpdating((prev) => ({ ...prev, [subtask.id]: true }));

    updateSubtask(projectId, taskId, subtask.id, { status: next })
      .then((res) => {
        // Sync with server response (server is source of truth)
        setSubtasks((prev) =>
          prev.map((s) =>
            s.id === subtask.id ? { ...s, ...res.data.subtask } : s,
          ),
        );
      })
      .catch((err) => {
        // Roll back
        setSubtasks((prev) =>
          prev.map((s) =>
            s.id === subtask.id ? { ...s, status: previous } : s,
          ),
        );
        toast.error(
          err.response?.data?.message || "Failed to update subtask status.",
        );
      })
      .finally(() =>
        setSubtaskUpdating((prev) => ({ ...prev, [subtask.id]: false })),
      );
  }

  /** Confirm-delete a subtask */
  function handleSubtaskDeleteConfirm() {
    if (!subtaskToDelete) return;

    const id = subtaskToDelete.id;
    setSubtaskDeleting((prev) => ({ ...prev, [id]: true }));

    deleteSubtask(projectId, taskId, id)
      .then(() => {
        setSubtasks((prev) => prev.filter((s) => s.id !== id));
        toast.success("Subtask deleted.");
      })
      .catch((err) =>
        toast.error(err.response?.data?.message || "Failed to delete subtask."),
      )
      .finally(() => {
        setSubtaskDeleting((prev) => ({ ...prev, [id]: false }));
        setSubtaskToDelete(null);
      });
  }

  // ─── attachment actions ───────────────────────────────────────────────────

  function handleFileUpload(file) {
    if (!file) return;
    setAttachmentUploading(true);
    uploadAttachment(projectId, taskId, file)
      .then((res) => {
        setAttachments((prev) => [...prev, res.data.attachment]);
        toast.success("File uploaded.");
      })
      .catch((err) =>
        toast.error(err.response?.data?.message || "Failed to upload file."),
      )
      .finally(() => setAttachmentUploading(false));
  }

  function handleFileInputChange(e) {
    handleFileUpload(e.target.files[0]);
    e.target.value = "";
  }

  function handleDrop(e) {
    e.preventDefault();
    setDragOver(false);
    handleFileUpload(e.dataTransfer.files[0]);
  }

  function handleAttachmentDeleteConfirm() {
    if (!attachmentToDelete) return;
    setAttachmentDeleting(true);
    deleteAttachment(projectId, taskId, attachmentToDelete.id)
      .then(() => {
        setAttachments((prev) =>
          prev.filter((a) => a.id !== attachmentToDelete.id),
        );
        toast.success("Attachment deleted.");
      })
      .catch((err) =>
        toast.error(
          err.response?.data?.message || "Failed to delete attachment.",
        ),
      )
      .finally(() => {
        setAttachmentDeleting(false);
        setAttachmentToDelete(null);
      });
  }

  function formatFileSize(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  // ─── comment actions ──────────────────────────────────────────────────────

  function handleSendComment() {
    const content = commentText.trim();
    if (!content) return;

    setCommentSending(true);

    createComment(projectId, taskId, content)
      .then((res) => {
        const comment = res.data.comment;

        if (commentFile) {
          return uploadCommentAttachment(
            projectId,
            taskId,
            comment.id,
            commentFile,
          )
            .then((attachRes) => ({
              ...comment,
              attachments: [attachRes.data.attachment],
            }))
            .catch((err) => {
              toast.error(
                err.response?.data?.message ||
                  "Comment sent, but file failed to upload.",
              );
              return comment;
            });
        }

        return comment;
      })
      .then((comment) => {
        setComments((prev) =>
          prev.some((c) => c.id === comment.id) ? prev : [...prev, comment],
        );
        setCommentText("");
        setCommentFile(null);
      })
      .catch((err) =>
        toast.error(err.response?.data?.message || "Failed to send comment."),
      )
      .finally(() => setCommentSending(false));
  }

  function handleTriggerMention() {
    setCommentText((prev) => {
      const updated = prev.endsWith(" ") || !prev ? `${prev}@` : `${prev} @`;
      setMentionTriggerIndex(updated.length - 1);
      setMentionSearch("");
      setShowMentionDropdown(true);
      return updated;
    });
    setTimeout(() => {
      commentTextAreaRef.current?.focus();
    }, 50);
  }

  function handleCommentChange(e) {
    const value = e.target.value;
    setCommentText(value);

    const cursor = e.target.selectionStart;
    const textBeforeCursor = value.slice(0, cursor);
    const lastAtIdx = textBeforeCursor.lastIndexOf("@");

    if (lastAtIdx !== -1) {
      const chunk = textBeforeCursor.slice(lastAtIdx + 1);
      if (!/\s/.test(chunk)) {
        setShowMentionDropdown(true);
        setMentionSearch(chunk);
        setMentionTriggerIndex(lastAtIdx);
        setActiveMentionIndex(0);
        return;
      }
    }

    setShowMentionDropdown(false);
    setMentionSearch("");
    setMentionTriggerIndex(-1);
  }

  function selectMentionedMember(member) {
    if (mentionTriggerIndex === -1) return;
    const u = member.user || member;
    const nameStr = `${u.first_name || ""}_${u.last_name || ""}`
      .trim()
      .replace(/\s+/g, "_");
    const beforeMention = commentText.slice(0, mentionTriggerIndex);
    const afterCursor = commentText.slice(
      mentionTriggerIndex + mentionSearch.length + 1,
    );

    setCommentText(`${beforeMention}@${nameStr} ${afterCursor}`);
    setShowMentionDropdown(false);
    setMentionSearch("");
    setMentionTriggerIndex(-1);
  }

  function handleCommentKeyDown(e) {
    if (showMentionDropdown && filteredMembers.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveMentionIndex((prev) => (prev + 1) % filteredMembers.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveMentionIndex(
          (prev) =>
            (prev - 1 + filteredMembers.length) % filteredMembers.length,
        );
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        selectMentionedMember(filteredMembers[activeMentionIndex]);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setShowMentionDropdown(false);
        return;
      }
    }

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendComment();
    }
  }

  function handleCommentFileChange(e) {
    setCommentFile(e.target.files[0] || null);
    e.target.value = "";
  }

  function handleCommentDeleteConfirm() {
    if (!commentToDelete) return;

    setCommentDeleting(true);

    deleteComment(projectId, taskId, commentToDelete.id)
      .then(() => {
        setComments((prev) => prev.filter((c) => c.id !== commentToDelete.id));
        toast.success("Comment deleted.");
      })
      .catch((err) =>
        toast.error(err.response?.data?.message || "Failed to delete comment."),
      )
      .finally(() => {
        setCommentDeleting(false);
        setCommentToDelete(null);
      });
  }

  function timeAgo(dateStr) {
    const diff = Math.floor((Date.now() - new Date(dateStr)) / 1000);
    if (diff < 60) return "just now";
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return `${Math.floor(diff / 86400)}d ago`;
  }

  // ─── derived values ───────────────────────────────────────────────────────

  const tags = Array.isArray(task?.tags) ? task.tags : [];

  const completedSubtasks = useMemo(
    () => subtasks.filter((s) => s.status === "completed").length,
    [subtasks],
  );

  const calculatedProgress =
    subtasks.length > 0
      ? Math.round((completedSubtasks / subtasks.length) * 100)
      : typeof task?.progress === "number"
        ? task.progress
        : null;

  const isAssignedUser =
    user?.id === task?.assigned_to &&
    ["member", "manager"].includes(user?.role);

  const canManage = canEditSubtaskFully(user);

  // ─── render ───────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <AppLayout title="Task Details">
        <Spinner label="Loading task..." />
      </AppLayout>
    );
  }

  if (error) {
    return (
      <AppLayout title="Task Details">
        <ErrorState message={error} onRetry={fetchAll} />
      </AppLayout>
    );
  }

  if (!task) return null;

  return (
    <AppLayout title="Task Details">
      <div className="min-h-full bg-page">
        <div className="space-y-5">
          {/* Breadcrumb */}
          <div className="flex items-center gap-2 text-sm">
            <Link
              to={`/projects/${projectId}`}
              className="inline-flex items-center gap-2 text-txt-muted transition hover:text-txt-primary"
            >
              <ArrowLeft size={15} />
              Tasks
            </Link>
            <span className="text-txt-muted">›</span>
            <span className="text-txt-primary">Task Details</span>
          </div>

          {/* Main Layout */}
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
            {/* ── LEFT ── */}
            <div className="space-y-4">
              {/* Task Main Card */}
              <div className="rounded-2xl border border-hair bg-surface-1 shadow-sm">
                {/* Header */}
                <div className="border-b border-hair px-5 py-5">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="mb-3">
                        {isAssignedUser ? (
                          <select
                            value={task.status}
                            onChange={handleStatusChange}
                            className="rounded-full border border-hair bg-surface-2 px-3 py-1 text-xs font-semibold text-txt-primary outline-none focus:border-accentblue"
                          >
                            <option value="todo">To Do</option>
                            <option value="in_progress">In Progress</option>
                            <option value="review">Review</option>
                            <option value="completed">Completed</option>
                          </select>
                        ) : (
                          <TaskStatusBadge status={task.status} />
                        )}
                      </div>

                      <h1 className="text-xl font-semibold tracking-tight text-txt-primary">
                        {task.title}
                      </h1>

                      <div className="mt-1 text-sm text-txt-muted">
                        {task.project?.name || task.project_name || "Project"} ·
                        Created {formatDate(task.created_at)}
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex shrink-0 items-center gap-1">
                      {canEditTask(user) && (
                        <button
                          type="button"
                          onClick={() => setEditOpen(true)}
                          className="rounded-lg p-2 text-txt-muted transition hover:bg-surface-2 hover:text-txt-primary"
                          title="Edit task"
                        >
                          <Pencil size={17} />
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => setChatDrawerOpen(true)}
                        aria-label="Open task chat"
                        title="Task Chat"
                        className="rounded-lg p-2 text-txt-muted transition hover:bg-surface-2 hover:text-txt-primary"
                      >
                        <MessageSquare size={17} />
                      </button>
                      <button
                        type="button"
                        className="rounded-lg p-2 text-txt-muted transition hover:bg-surface-2 hover:text-txt-primary"
                        title="Share task"
                      >
                        <Share2 size={17} />
                      </button>
                      <button
                        type="button"
                        className="rounded-lg p-2 text-txt-muted transition hover:bg-surface-2 hover:text-txt-primary"
                        title="More options"
                      >
                        <MoreVertical size={17} />
                      </button>
                    </div>
                  </div>
                </div>

                {/* Attachments */}
                <div className="px-5 py-5">
                  {/* Header */}
                  <div className="mb-3 flex items-center justify-between">
                    <h2 className="text-sm font-semibold text-txt-primary">
                      Attachments
                      {attachments.length > 0 && (
                        <span className="ml-1.5 text-txt-muted">
                          ({attachments.length})
                        </span>
                      )}
                    </h2>
                    {canManage && (
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        disabled={attachmentUploading}
                        className="flex items-center gap-1 text-xs font-medium text-accentblue hover:text-accentblue disabled:opacity-40"
                      >
                        <Upload size={13} />
                        {attachmentUploading ? "Uploading…" : "Upload"}
                      </button>
                    )}
                  </div>

                  {/* Hidden file input */}
                  <input
                    ref={fileInputRef}
                    type="file"
                    className="hidden"
                    onChange={handleFileInputChange}
                    accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.txt"
                  />

                  {/* File list */}
                  {attachments.length > 0 && (
                    <div className="mb-3 grid grid-cols-1 gap-2 md:grid-cols-2">
                      {attachments.map((file) => (
                        <div
                          key={file.id}
                          className="group flex items-center justify-between rounded-xl border border-hair px-3 py-3 transition hover:border-hair hover:bg-surface-2"
                        >
                          <div className="flex min-w-0 items-center gap-3">
                            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-surface-2">
                              <Paperclip size={17} className="text-txt-muted" />
                            </div>
                            <div className="min-w-0">
                              <p className="truncate text-sm font-medium text-txt-primary">
                                {file.file_name}
                              </p>
                              <p className="text-xs text-txt-muted">
                                {formatFileSize(file.file_size)}
                              </p>
                            </div>
                          </div>
                          <div className="flex shrink-0 items-center gap-1">
                            <a
                              href={`${API_ORIGIN}${file.url}`}
                              target="_blank"
                              rel="noreferrer"
                              className="rounded-md p-1.5 text-txt-muted hover:bg-surface-2 hover:text-txt-primary"
                              title="Download"
                            >
                              <Download size={15} />
                            </a>
                            {canManage && (
                              <button
                                type="button"
                                onClick={() => setAttachmentToDelete(file)}
                                className="hidden rounded-md p-1.5 text-txt-muted hover:bg-red-500/10 hover:text-red-500 group-hover:block"
                                title="Delete"
                              >
                                <Trash2 size={15} />
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Drag & drop zone */}
                  {canManage && (
                    <div
                      onDragOver={(e) => {
                        e.preventDefault();
                        setDragOver(true);
                      }}
                      onDragLeave={() => setDragOver(false)}
                      onDrop={handleDrop}
                      onClick={() => fileInputRef.current?.click()}
                      className={`cursor-pointer rounded-xl border-2 border-dashed px-4 py-5 text-center transition ${
                        dragOver
                          ? "border-accentblue bg-accentblue-soft"
                          : "border-hair hover:border-hair"
                      }`}
                    >
                      <Upload
                        size={18}
                        className={`mx-auto mb-1 ${dragOver ? "text-accentblue" : "text-txt-muted"}`}
                      />
                      <p className="text-xs text-txt-muted">
                        {attachmentUploading
                          ? "Uploading…"
                          : "Drop a file here or click to upload"}
                      </p>
                      <p className="mt-0.5 text-xs text-txt-muted">
                        PNG, JPG, PDF, DOC, XLS up to 10MB
                      </p>
                    </div>
                  )}

                  {/* Empty state for non-managers */}
                  {!canManage && attachments.length === 0 && (
                    <div className="rounded-xl border border-dashed border-hair px-4 py-4 text-center">
                      <Paperclip
                        size={18}
                        className="mx-auto mb-1 text-txt-muted"
                      />
                      <p className="text-xs text-txt-muted">No attachments</p>
                    </div>
                  )}
                </div>

                {/* Description */}
                <div className="border-t border-hair px-5 py-5">
                  <h2 className="mb-2 text-sm font-semibold text-txt-primary">
                    Description
                  </h2>
                  <p className="whitespace-pre-line text-sm leading-6 text-txt-muted">
                    {task.description || "No description provided."}
                  </p>
                </div>
              </div>

              {/* ── Subtasks / Comments / Activity card ── */}
              <div className="rounded-2xl border border-hair bg-surface-1 shadow-sm">
                {/* Tabs */}
                <div className="border-b border-hair px-5 pt-4">
                  <div className="flex items-center gap-6">
                    {[
                      ["subtasks", "Subtasks"],
                      ["comments", "Comments"],
                      ["activity", "Activity"],
                      ["members", "Members"],
                    ].map(([key, label]) => (
                      <button
                        key={key}
                        type="button"
                        onClick={() => setActiveTab(key)}
                        className={`relative pb-3 text-sm font-medium transition ${
                          activeTab === key
                            ? "text-accentblue"
                            : "text-txt-muted hover:text-txt-primary"
                        }`}
                      >
                        {label}
                        {key === "subtasks" && subtasks.length > 0 && (
                          <span className="ml-1.5 text-xs text-txt-muted">
                            ({subtasks.length})
                          </span>
                        )}
                        {activeTab === key && (
                          <span className="absolute bottom-0 left-0 right-0 h-0.5 rounded-full bg-accentblue" />
                        )}
                      </button>
                    ))}
                  </div>
                </div>

                {/* ── SUBTASKS TAB ── */}
                {activeTab === "subtasks" && (
                  <div className="px-5 py-5">
                    {subtasks.length > 0 && (
                      <>
                        {/* Header row */}
                        <div className="mb-4 flex items-center justify-between">
                          <div>
                            <h3 className="text-sm font-semibold text-txt-primary">
                              Task Subtasks
                            </h3>

                            <span className="text-xs text-txt-muted">
                              {completedSubtasks} / {subtasks.length} completed
                            </span>
                          </div>

                          {["owner", "admin", "manager", "member"].includes(
                            user?.role,
                          ) && (
                            <Button
                              onClick={() => {
                                setEditingSubtask(null);
                                setSubtaskModalOpen(true);
                              }}
                            >
                              + Add Subtask
                            </Button>
                          )}
                        </div>

                        {/* Progress bar */}
                        <div className="mb-4 h-1.5 overflow-hidden rounded-full bg-surface-2">
                          <div
                            className="h-full rounded-full bg-accentblue transition-all duration-300"
                            style={{ width: `${calculatedProgress}%` }}
                          />
                        </div>
                      </>
                    )}

                    {/* Subtask list */}
                    {subtasks.length === 0 && (
                      <div className="py-6 text-center">
                        <p className="text-sm text-txt-muted">
                          No subtasks yet.
                        </p>
                      </div>
                    )}

                    {subtasks.length > 0 && (
                      <div className="space-y-2">
                        {subtasks.map((subtask) => {
                          const completed = subtask.status === "completed";
                          const isUpdating = !!subtaskUpdating[subtask.id];
                          const isDeleting = !!subtaskDeleting[subtask.id];

                          // Only assigned member or managers can toggle status
                          const canToggle = canUpdateSubtaskStatus(
                            user,
                            subtask,
                          );

                          // Warn owner if task is due within 2 days and subtask is incomplete
                          const isDueSoon =
                            !completed &&
                            task?.due_date &&
                            (() => {
                              const diff = new Date(task.due_date) - new Date();
                              return diff > 0 && diff < 2 * 24 * 60 * 60 * 1000;
                            })();

                          const isExpanded = expandedSubtaskId === subtask.id;

                          return (
                            <div key={subtask.id}>
                              <div
                                className={`group flex items-center justify-between gap-3 rounded-lg border px-3 py-3 transition ${
                                  isUpdating || isDeleting
                                    ? "border-hair opacity-60"
                                    : isDueSoon
                                      ? "border-amber-500/30 bg-amber-500/10"
                                      : "border-hair bg-surface-2 hover:border-hair hover:bg-surface-3"
                                }`}
                              >
                                {/* Left: checkbox + text */}
                                <button
                                  type="button"
                                  disabled={
                                    isUpdating || isDeleting || !canToggle
                                  }
                                  onClick={() =>
                                    handleSubtaskStatusToggle(subtask)
                                  }
                                  title={
                                    canToggle
                                      ? STATUS_CYCLE_LABEL[subtask.status]
                                      : "Not assigned to you"
                                  }
                                  className={`flex min-w-0 flex-1 items-center gap-3 text-left ${
                                    !canToggle ? "cursor-default" : ""
                                  }`}
                                >
                                  {/* Checkbox */}
                                  <div
                                    className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border transition ${
                                      completed
                                        ? "border-accentblue bg-accentblue"
                                        : subtask.status === "in_progress"
                                          ? "border-blue-400 bg-blue-500/15"
                                          : "border-hair bg-surface-1"
                                    }`}
                                  >
                                    {completed && (
                                      <CheckCircle2
                                        size={12}
                                        className="text-white"
                                      />
                                    )}
                                    {subtask.status === "in_progress" && (
                                      <div className="h-2 w-2 rounded-full bg-blue-400" />
                                    )}
                                  </div>

                                  {/* Title + description */}
                                  <div className="min-w-0">
                                    <div className="flex items-center gap-1.5">
                                      <p
                                        className={`text-sm ${
                                          completed
                                            ? "text-txt-muted line-through"
                                            : "text-txt-primary"
                                        }`}
                                      >
                                        {subtask.title}
                                      </p>
                                      {/* Due-soon pill — visible to everyone */}
                                      {isDueSoon && (
                                        <span className="rounded-full bg-amber-500/15 px-1.5 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-300">
                                          Due soon
                                        </span>
                                      )}
                                    </div>
                                    {subtask.description && (
                                      <p className="mt-0.5 truncate text-xs text-txt-muted">
                                        {subtask.description}
                                      </p>
                                    )}
                                    {Array.isArray(subtask.tags) &&
                                      subtask.tags.length > 0 && (
                                        <div className="mt-1 flex flex-wrap gap-1">
                                          {subtask.tags.map((tag) => (
                                            <span
                                              key={tag.id}
                                              className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-medium text-txt-muted"
                                            >
                                              {tag.name}
                                            </span>
                                          ))}
                                        </div>
                                      )}
                                  </div>
                                </button>

                                {/* Right: assignee avatar + status badge + delete */}
                                <div className="flex shrink-0 items-center gap-2">
                                  {/* Assignee avatar — owners/admins/managers see who owns this */}
                                  {canManage && subtask.assignee && (
                                    <div title={getUserName(subtask.assignee)}>
                                      <Avatar
                                        firstName={subtask.assignee.first_name}
                                        lastName={subtask.assignee.last_name}
                                        avatarUrl={subtask.assignee.avatar_url}
                                        size="xs"
                                      />
                                    </div>
                                  )}

                                  {/* Unassigned warning — nudges owner to assign someone */}
                                  {canManage && !subtask.assignee && (
                                    <span className="rounded-full bg-surface-2 px-2 py-0.5 text-xs text-txt-muted">
                                      Unassigned
                                    </span>
                                  )}

                                  <span
                                    className={`rounded-full px-2 py-1 text-xs font-medium ${
                                      completed
                                        ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                                        : subtask.status === "in_progress"
                                          ? "bg-blue-500/15 text-blue-700 dark:text-blue-300"
                                          : "bg-surface-2 text-txt-muted"
                                    }`}
                                  >
                                    {completed
                                      ? "Completed"
                                      : subtask.status === "in_progress"
                                        ? "In Progress"
                                        : "To Do"}
                                  </span>

                                  {/* Delete — management roles only */}
                                  {canManage && (
                                    <button
                                      type="button"
                                      disabled={isDeleting}
                                      onClick={() =>
                                        setSubtaskToDelete(subtask)
                                      }
                                      className="hidden rounded p-1 text-txt-muted transition hover:bg-red-500/10 hover:text-red-500 group-hover:flex"
                                      title="Delete subtask"
                                    >
                                      <Trash2 size={13} />
                                    </button>
                                  )}

                                  {/* Expand/collapse — comments & attachments */}
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setExpandedSubtaskId((prev) =>
                                        prev === subtask.id ? null : subtask.id,
                                      )
                                    }
                                    className="rounded p-1 text-txt-muted transition hover:bg-surface-2 hover:text-txt-primary"
                                    title={
                                      isExpanded
                                        ? "Hide comments & attachments"
                                        : "Show comments & attachments"
                                    }
                                  >
                                    {isExpanded ? (
                                      <ChevronDown size={14} />
                                    ) : (
                                      <ChevronRight size={14} />
                                    )}
                                  </button>
                                </div>
                              </div>

                              {isExpanded && (
                                <div className="mt-1.5">
                                  <SubtaskDetailPanel
                                    projectId={projectId}
                                    taskId={taskId}
                                    subtask={subtask}
                                  />
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {/* Add button — management roles only */}
                    {canManage && (
                      <button
                        type="button"
                        onClick={() => {
                          setEditingSubtask(null);
                          setSubtaskModalOpen(true);
                        }}
                        className="mt-3 flex w-full items-center gap-2 rounded-lg border border-dashed border-hair px-3 py-2.5 text-sm text-txt-muted transition hover:border-hair hover:text-txt-primary"
                      >
                        <Plus size={14} />
                        Add subtask
                      </button>
                    )}
                  </div>
                )}

                {/* Comments tab */}
                {activeTab === "comments" && (
                  <div className="flex flex-col">
                    {/* Comment list */}
                    <div className="space-y-5 px-5 py-5">
                      {comments.length === 0 && (
                        <p className="text-center text-sm text-txt-muted">
                          No comments yet. Be the first to comment.
                        </p>
                      )}

                      {comments.map((comment) => {
                        const canDelete = canDeleteComment(user, comment);

                        return (
                          <div key={comment.id} className="group flex gap-3">
                            {/* Avatar */}
                            <div className="shrink-0">
                              <Avatar
                                firstName={comment.author?.first_name}
                                lastName={comment.author?.last_name}
                                avatarUrl={comment.author?.avatar_url}
                                size="sm"
                              />
                            </div>

                            {/* Body */}
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-semibold text-txt-primary">
                                  {getUserName(comment.author)}
                                </span>
                                <span className="text-xs text-txt-muted">
                                  {timeAgo(comment.created_at)}
                                </span>

                                {/* Delete button */}
                                {canDelete && (
                                  <button
                                    type="button"
                                    onClick={() => setCommentToDelete(comment)}
                                    className="ml-auto hidden rounded p-1 text-txt-muted transition hover:bg-red-500/10 hover:text-red-500 group-hover:block"
                                    title="Delete comment"
                                  >
                                    <Trash2 size={13} />
                                  </button>
                                )}
                              </div>

                              <p className="mt-0.5 text-sm leading-6 text-txt-muted">
                                {renderCommentContent(comment.content, members)}
                              </p>

                              {comment.attachments?.length > 0 && (
                                <div className="mt-2 flex flex-col gap-1.5">
                                  {comment.attachments.map((file) => (
                                    <a
                                      key={file.id}
                                      href={`${API_ORIGIN}${file.url}`}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="flex w-fit items-center gap-2 rounded-lg border border-hair bg-surface-2 px-2.5 py-1.5 text-xs text-txt-muted transition hover:border-accentblue hover:bg-accentblue-soft hover:text-accentblue"
                                    >
                                      <Paperclip
                                        size={13}
                                        className="shrink-0 text-txt-muted"
                                      />
                                      <span className="max-w-[200px] truncate">
                                        {file.file_name}
                                      </span>
                                      <span className="shrink-0 text-txt-muted">
                                        {formatFileSize(file.file_size)}
                                      </span>
                                    </a>
                                  ))}
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {/* Composer */}
                    <div className="border-t border-hair px-5 py-4">
                      <div className="flex gap-3">
                        {/* Current user avatar */}
                        <div className="shrink-0">
                          <Avatar
                            firstName={user?.first_name}
                            lastName={user?.last_name}
                            avatarUrl={user?.avatar_url}
                            size="sm"
                          />
                        </div>

                        <div className="relative flex-1 rounded-xl border border-hair bg-surface-1 transition focus-within:border-accentblue focus-within:ring-1 focus-within:ring-accentblue/30">
                          {showMentionDropdown &&
                            filteredMembers.length > 0 && (
                              <div className="absolute bottom-full left-0 z-50 mb-1 max-h-48 w-64 overflow-y-auto rounded-lg border border-hair bg-surface-1 py-1 shadow-lg">
                                {filteredMembers.map((member, idx) => {
                                  const u = member.user;
                                  if (!u) return null;
                                  const isSelected = idx === activeMentionIndex;
                                  return (
                                    <div
                                      key={member.id}
                                      onClick={() =>
                                        selectMentionedMember(member)
                                      }
                                      onMouseEnter={() =>
                                        setActiveMentionIndex(idx)
                                      }
                                      className={`flex cursor-pointer items-center gap-2 px-3 py-1.5 text-xs transition ${
                                        isSelected
                                          ? "bg-accentblue-soft text-txt-primary"
                                          : "text-txt-primary hover:bg-surface-2"
                                      }`}
                                    >
                                      <Avatar
                                        firstName={u.first_name}
                                        lastName={u.last_name}
                                        avatarUrl={u.avatar_url}
                                        size="xs"
                                      />
                                      <div className="min-w-0 flex-1">
                                        <p className="font-semibold truncate">
                                          {u.first_name} {u.last_name}
                                        </p>
                                        <p className="text-[10px] text-txt-muted truncate">
                                          {u.email}
                                        </p>
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          <textarea
                            ref={commentTextAreaRef}
                            value={commentText}
                            onChange={handleCommentChange}
                            onKeyDown={handleCommentKeyDown}
                            placeholder="Write a comment…"
                            disabled={commentSending}
                            rows={2}
                            className="w-full resize-none rounded-t-xl px-3 pt-3 text-sm text-txt-primary placeholder:text-txt-muted outline-none"
                          />

                          {commentFile && (
                            <div className="flex items-center gap-2 px-3 pb-1">
                              <span className="flex items-center gap-1.5 rounded-lg border border-accentblue bg-accentblue-soft px-2 py-1 text-xs text-accentblue">
                                <Paperclip size={12} />
                                <span className="max-w-[180px] truncate">
                                  {commentFile.name}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => setCommentFile(null)}
                                  className="text-accentblue hover:text-accentblue"
                                  title="Remove file"
                                >
                                  <X size={12} />
                                </button>
                              </span>
                            </div>
                          )}

                          {/* Toolbar */}
                          <div className="flex items-center justify-between px-3 pb-2 pt-1">
                            <div className="flex items-center gap-3 text-txt-muted">
                              <input
                                ref={commentFileInputRef}
                                type="file"
                                className="hidden"
                                onChange={handleCommentFileChange}
                              />
                              <button
                                type="button"
                                onClick={() =>
                                  commentFileInputRef.current?.click()
                                }
                                className="transition hover:text-txt-primary"
                                title="Attach file"
                              >
                                <Paperclip size={15} />
                              </button>
                              <button
                                type="button"
                                onClick={handleTriggerMention}
                                className="transition hover:text-txt-primary flex h-5 w-5 items-center justify-center rounded hover:bg-surface-2 font-semibold text-txt-muted text-sm"
                                title="Mention a user"
                              >
                                @
                              </button>
                            </div>

                            <button
                              type="button"
                              onClick={handleSendComment}
                              disabled={!commentText.trim() || commentSending}
                              className="rounded-lg bg-accentblue px-4 py-1.5 text-xs font-semibold text-white transition hover:bg-accentblue disabled:opacity-40"
                            >
                              {commentSending ? "Sending…" : "Send"}
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Activity tab */}
                {activeTab === "activity" && (
                  <div className="px-5 py-6">
                    <TaskActivityTab taskId={taskId} />
                  </div>
                )}

                {/* Members tab */}
                {activeTab === "members" && (
                  <div className="px-5 py-6">
                    <TaskMembersTab
                      projectId={projectId}
                      taskId={taskId}
                      projectMembers={members}
                      taskMembers={taskMembers}
                      onChanged={fetchAll}
                      canManage={canManageTaskMembers(user, task, members)}
                    />
                  </div>
                )}
              </div>
            </div>

            {/* ── RIGHT DETAILS ── */}
            <div>
              <div className="rounded-2xl border border-hair bg-surface-1 shadow-sm">
                <div className="px-5 py-5">
                  <h2 className="mb-5 text-sm font-semibold text-txt-primary">
                    Details
                  </h2>

                  <div className="space-y-5">
                    {/* Status */}
                    <div className="flex items-center justify-between gap-4">
                      <span className="text-sm text-txt-muted">Status</span>
                      <TaskStatusBadge status={task.status} />
                    </div>

                    {/* Priority */}
                    <div className="flex items-center justify-between gap-4">
                      <span className="text-sm text-txt-muted">Priority</span>
                      <TaskPriorityBadge priority={task.priority} />
                    </div>

                    {/* Assignee */}
                    <div className="flex items-center justify-between gap-4">
                      <span className="text-sm text-txt-muted">Assignee</span>
                      <div className="flex items-center gap-2">
                        {task.assignee ? (
                          <>
                            <Avatar
                              firstName={task.assignee.first_name}
                              lastName={task.assignee.last_name}
                              avatarUrl={task.assignee.avatar_url}
                              size="sm"
                            />
                            <span className="max-w-[150px] truncate text-sm font-medium text-txt-primary">
                              {getUserName(task.assignee)}
                            </span>
                          </>
                        ) : (
                          <span className="text-sm text-txt-muted">
                            Unassigned
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Start Date */}
                    {task.start_date && (
                      <div className="flex items-center justify-between gap-4">
                        <span className="text-sm text-txt-muted">
                          Start Date
                        </span>
                        <span className="text-sm font-medium text-txt-primary">
                          {formatDate(task.start_date)}
                        </span>
                      </div>
                    )}

                    {/* Due Date */}
                    <div className="flex items-center justify-between gap-4">
                      <span className="text-sm text-txt-muted">Due Date</span>
                      <span className="text-sm font-medium text-txt-primary">
                        {formatDate(task.due_date)}
                      </span>
                    </div>

                    {/* Tags */}
                    {tags.length > 0 && (
                      <div className="flex items-start justify-between gap-4">
                        <span className="pt-1 text-sm text-txt-muted">
                          Tags
                        </span>
                        <div className="flex max-w-[200px] flex-wrap justify-end gap-1.5">
                          {tags.map((tag, index) => (
                            <span
                              key={tag.id || index}
                              className="rounded-full bg-surface-2 px-2.5 py-1 text-xs font-medium text-txt-muted"
                            >
                              {typeof tag === "string" ? tag : tag.name}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Overall progress */}
                {calculatedProgress !== null && (
                  <div className="border-t border-hair px-5 py-5">
                    <div className="mb-2 flex items-center justify-between">
                      <span className="text-sm text-txt-muted">
                        Overall progress
                      </span>
                      <span className="text-sm font-semibold text-txt-primary">
                        {calculatedProgress}%
                      </span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-surface-2">
                      <div
                        className="h-full rounded-full bg-accentblue transition-all duration-300"
                        style={{ width: `${calculatedProgress}%` }}
                      />
                    </div>
                  </div>
                )}

                {/* Mark complete */}
                {task.status !== "completed" && (
                  <div className="px-5 pb-5">
                    <button
                      type="button"
                      onClick={handleComplete}
                      className="flex w-full items-center justify-center gap-2 rounded-xl bg-accentblue px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-accentblue"
                    >
                      <CheckCircle2 size={16} />
                      Mark Complete
                    </button>
                  </div>
                )}

                {/* Delete task */}
                {canDeleteTask(user) && (
                  <div className="border-t border-hair px-5 py-4">
                    <button
                      type="button"
                      onClick={() => setDeleteOpen(true)}
                      className="flex w-full items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-red-500 transition hover:bg-red-500/10"
                    >
                      <Trash2 size={15} />
                      Delete Task
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Edit Task Modal */}
      <TaskFormModal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        projectId={projectId}
        mode="edit"
        task={task}
        projectMembers={members}
        onSaved={() => {
          setEditOpen(false);
          fetchAll();
        }}
      />

      {/* Delete Attachment Dialog */}
      <ConfirmDialog
        open={!!attachmentToDelete}
        onClose={() => setAttachmentToDelete(null)}
        onConfirm={handleAttachmentDeleteConfirm}
        title="Delete Attachment"
        description={`Delete "${attachmentToDelete?.file_name}"? This cannot be undone.`}
        confirmLabel="Delete"
        loading={attachmentDeleting}
      />

      {/* Delete Comment Dialog */}
      <ConfirmDialog
        open={!!commentToDelete}
        onClose={() => setCommentToDelete(null)}
        onConfirm={handleCommentDeleteConfirm}
        title="Delete Comment"
        description="Delete this comment? This cannot be undone."
        confirmLabel="Delete"
        loading={commentDeleting}
      />

      {/* Delete Task Dialog */}
      <ConfirmDialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        onConfirm={handleDelete}
        title="Delete Task"
        description={`Delete "${task.title}"? This cannot be undone.`}
        confirmLabel="Delete"
        loading={deleting}
      />

      {/* Delete Subtask Dialog */}
      <ConfirmDialog
        open={!!subtaskToDelete}
        onClose={() => setSubtaskToDelete(null)}
        onConfirm={handleSubtaskDeleteConfirm}
        title="Delete Subtask"
        description={`Delete "${subtaskToDelete?.title}"? This cannot be undone.`}
        confirmLabel="Delete"
        loading={!!subtaskDeleting[subtaskToDelete?.id]}
      />

      <SubtaskFormModal
        open={subtaskModalOpen}
        onClose={() => {
          setSubtaskModalOpen(false);
          setEditingSubtask(null);
        }}
        projectId={projectId}
        taskId={taskId}
        mode={editingSubtask ? "edit" : "create"}
        subtask={editingSubtask}
        parentTaskTitle={task?.title}
        projectMembers={members}
        onSaved={fetchAll}
      />

      <TaskChatDrawer
        open={chatDrawerOpen}
        onClose={() => setChatDrawerOpen(false)}
        projectId={projectId}
        taskId={taskId}
        task={task}
      />
    </AppLayout>
  );
}
