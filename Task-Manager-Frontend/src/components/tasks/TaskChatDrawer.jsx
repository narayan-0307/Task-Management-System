import { MessageSquare } from "lucide-react";
import Drawer from "../ui/Drawer.jsx";
import Avatar from "../ui/Avatar.jsx";
import TaskStatusBadge from "./TaskStatusBadge.jsx";
import TaskPriorityBadge from "./TaskPriorityBadge.jsx";
import TaskChatTab from "./TaskChatTab.jsx";

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
    person.email ||
    "--"
  );
}

function PersonRow({ label, person }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-sm text-txt-muted">{label}</span>
      {person ? (
        <div className="flex items-center gap-2">
          <Avatar
            firstName={person.first_name}
            lastName={person.last_name}
            avatarUrl={person.avatar_url}
            size="sm"
          />
          <span className="max-w-[150px] truncate text-sm font-medium text-txt-primary">
            {getUserName(person)}
          </span>
        </div>
      ) : (
        <span className="text-sm text-txt-muted">--</span>
      )}
    </div>
  );
}

// Task Chat Drawer — Step 3 (visual refinement). Left: read-only task info
// from the `task` prop already loaded by TaskDetails. Right: the existing
// TaskChatTab, with its layout made to fill the drawer's full height instead
// of a fixed pixel height, plus a small presentation-only chat header.
// Presentation-only wrapper — no chat logic lives here.
export default function TaskChatDrawer({
  open,
  onClose,
  projectId,
  taskId,
  task,
}) {
  const tags = Array.isArray(task?.tags) ? task.tags : [];

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Task Chat"
      width="w-full lg:w-[80vw] lg:max-w-[1400px]"
    >
      <div className="grid h-full grid-cols-1 gap-4 lg:grid-cols-[minmax(280px,0.4fr)_minmax(0,0.6fr)]">
        {/* ── LEFT: task information ── */}
        <div className="min-w-0 space-y-4 overflow-y-auto lg:pr-1">
          {/* Task header */}
          <div className="rounded-xl border border-hair bg-surface-2 p-4">
            <h3 className="text-sm font-semibold text-txt-primary">
              {task?.title || "Untitled task"}
            </h3>
          </div>

          {/* Basic details */}
          <div className="rounded-xl border border-hair bg-surface-2 p-4">
            <h4 className="mb-3 text-xs font-semibold uppercase tracking-wide text-txt-muted">
              Basic details
            </h4>
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-4">
                <span className="text-sm text-txt-muted">Status</span>
                <TaskStatusBadge status={task?.status} />
              </div>
              <div className="flex items-center justify-between gap-4">
                <span className="text-sm text-txt-muted">Priority</span>
                <TaskPriorityBadge priority={task?.priority} />
              </div>
              <div className="flex items-center justify-between gap-4">
                <span className="text-sm text-txt-muted">Due date</span>
                <span className="text-sm font-medium text-txt-primary">
                  {formatDate(task?.due_date)}
                </span>
              </div>
            </div>
          </div>

          {/* People */}
          <div className="rounded-xl border border-hair bg-surface-2 p-4">
            <h4 className="mb-3 text-xs font-semibold uppercase tracking-wide text-txt-muted">
              People
            </h4>
            <div className="space-y-3">
              <PersonRow label="Created by" person={task?.creator} />
              <PersonRow label="Assignee" person={task?.assignee} />
            </div>
          </div>

          {/* Project */}
          <div className="rounded-xl border border-hair bg-surface-2 p-4">
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-txt-muted">
              Project
            </h4>
            <span className="text-sm font-medium text-txt-primary">
              {task?.project?.name || "--"}
            </span>
          </div>

          {/* Description */}
          <div className="rounded-xl border border-hair bg-surface-2 p-4">
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-txt-muted">
              Description
            </h4>
            <p className="whitespace-pre-line text-sm leading-6 text-txt-muted">
              {task?.description || "No description provided."}
            </p>
          </div>

          {/* Tags */}
          {tags.length > 0 && (
            <div className="rounded-xl border border-hair bg-surface-2 p-4">
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-txt-muted">
                Tags
              </h4>
              <div className="flex flex-wrap gap-1.5">
                {tags.map((tag, index) => (
                  <span
                    key={tag.id || index}
                    className="rounded-full bg-surface-1 px-2.5 py-1 text-xs font-medium text-txt-muted"
                  >
                    {typeof tag === "string" ? tag : tag.name}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Metadata */}
          {(task?.created_at || task?.updated_at) && (
            <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-hair px-1 pt-3 text-xs text-txt-muted">
              {task?.created_at && <span>Created {formatDate(task.created_at)}</span>}
              {task?.updated_at && <span>Updated {formatDate(task.updated_at)}</span>}
            </div>
          )}
        </div>

        {/* ── RIGHT: task chat ── */}
        <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-hair bg-surface-1">
          {/* Chat header — presentation only; no member count shown since
              TaskChatTab has no member data to report. */}
          <div className="flex shrink-0 items-center gap-2 border-b border-hair px-4 py-3">
            <MessageSquare size={16} className="shrink-0 text-txt-muted" />
            <span className="text-sm font-semibold text-txt-primary">
              Task Chat
            </span>
            {task?.title && (
              <span className="truncate text-sm text-txt-muted">
                · {task.title}
              </span>
            )}
          </div>

          <div className="min-h-0 flex-1">
            <TaskChatTab projectId={projectId} taskId={taskId} />
          </div>
        </div>
      </div>
    </Drawer>
  );
}
