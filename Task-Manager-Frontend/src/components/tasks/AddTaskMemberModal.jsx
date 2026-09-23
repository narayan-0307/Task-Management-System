import { useEffect, useMemo, useState } from "react";
import Modal from "../common/Modal.jsx";
import Button from "../ui/Button.jsx";
import { addTaskMember } from "../../api/taskMembers.js";
import { useToast } from "../../context/ToastContext.jsx";

const selectClass =
  "w-full rounded-lg border border-hair bg-surface-1 px-3 py-2 text-sm text-txt-primary focus:border-accentblue focus:outline-none focus:ring-1 focus:ring-accentblue";

export default function AddTaskMemberModal({
  open,
  onClose,
  projectId,
  taskId,
  projectMembers = [],
  taskMembers = [],
  onAdded,
}) {
  const toast = useToast();
  const [userId, setUserId] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setUserId("");
  }, [open]);

  // Candidates come from the project's own member list (already loaded by
  // TaskDetails) -- never a fresh organization-members fetch -- filtered to
  // exclude anyone already a task member. Compared by user_id, the field
  // both /projects/:id/members and /projects/:id/tasks/:id/members key on.
  const candidates = useMemo(() => {
    const existingIds = new Set(taskMembers.map((m) => m.user_id));
    return projectMembers.filter((m) => !existingIds.has(m.user_id));
  }, [projectMembers, taskMembers]);

  function handleSubmit() {
    if (!userId) return;
    setSubmitting(true);
    addTaskMember(projectId, taskId, Number(userId))
      .then(() => {
        toast.success("Member added to task.");
        onAdded?.();
        onClose();
      })
      .catch((err) => {
        toast.error(err.response?.data?.message || "Failed to add task member.");
      })
      .finally(() => setSubmitting(false));
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add Task Member"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={submitting || !userId}>
            {submitting ? "Adding..." : "Add Member"}
          </Button>
        </>
      }
    >
      <p className="mb-4 text-sm text-txt-muted">
        Add a project member to this task so they can be part of its Task
        Chat and updates.
      </p>

      {candidates.length === 0 ? (
        <p className="text-sm text-txt-muted">
          All project members are already part of this task.
        </p>
      ) : (
        <div>
          <label className="mb-1.5 block text-sm font-medium text-txt-primary">
            User
          </label>
          <select
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
            className={selectClass}
          >
            <option value="">Select a user...</option>
            {candidates.map((m) => (
              <option key={m.user_id} value={m.user_id}>
                {m.user?.first_name} {m.user?.last_name} — {m.user?.email}
              </option>
            ))}
          </select>
        </div>
      )}
    </Modal>
  );
}
