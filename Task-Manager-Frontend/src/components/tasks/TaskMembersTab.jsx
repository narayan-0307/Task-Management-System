import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Users, UserPlus, MoreVertical } from "lucide-react";
import ConfirmDialog from "../common/ConfirmDialog.jsx";
import Button from "../ui/Button.jsx";
import Avatar from "../ui/Avatar.jsx";
import AddTaskMemberModal from "./AddTaskMemberModal.jsx";
import { removeTaskMember } from "../../api/taskMembers.js";
import { useToast } from "../../context/ToastContext.jsx";

function getUserName(person) {
  if (!person) return "--";
  return (
    `${person.first_name || ""} ${person.last_name || ""}`.trim() ||
    person.email ||
    "--"
  );
}

// Portal-positioned row action menu -- same pattern as ProjectMembersTab's
// MemberActionsMenu, trimmed to the one action TaskMember rows support
// (there is no role to change on a task member).
function MemberActionsMenu({ isOpen, onToggle, onRemove }) {
  const btnRef = useRef(null);
  const menuRef = useRef(null);
  const [coords, setCoords] = useState({ top: 0, left: 0 });

  useEffect(() => {
    if (!isOpen) return undefined;
    function place() {
      const rect = btnRef.current?.getBoundingClientRect();
      if (rect) setCoords({ top: rect.bottom + 4, left: rect.right - 160 });
    }
    function onPointerDown(e) {
      if (
        !btnRef.current?.contains(e.target) &&
        !menuRef.current?.contains(e.target)
      ) {
        onToggle(false);
      }
    }
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    document.addEventListener("mousedown", onPointerDown);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
      document.removeEventListener("mousedown", onPointerDown);
    };
  }, [isOpen, onToggle]);

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={() => onToggle(!isOpen)}
        className="rounded-md p-1.5 text-txt-muted transition-colors hover:bg-surface-2 hover:text-txt-primary"
        aria-label="Task member actions"
        aria-haspopup="menu"
        aria-expanded={isOpen}
      >
        <MoreVertical size={16} />
      </button>

      {isOpen &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            style={{ position: "fixed", top: coords.top, left: coords.left }}
            className="z-50 w-40 overflow-hidden rounded-lg border border-hair bg-surface-1 py-1 shadow-lg"
          >
            <button
              type="button"
              role="menuitem"
              onClick={onRemove}
              className="block w-full px-3 py-2 text-left text-sm text-red-600 hover:bg-surface-2 dark:text-red-400"
            >
              Remove
            </button>
          </div>,
          document.body,
        )}
    </>
  );
}

export default function TaskMembersTab({
  projectId,
  taskId,
  projectMembers = [],
  taskMembers = [],
  onChanged,
  canManage,
}) {
  const toast = useToast();
  const [addOpen, setAddOpen] = useState(false);
  const [removeTarget, setRemoveTarget] = useState(null);
  const [removing, setRemoving] = useState(false);
  const [openMenuId, setOpenMenuId] = useState(null);

  const safeTaskMembers = Array.isArray(taskMembers) ? taskMembers : [];
  const safeProjectMembers = Array.isArray(projectMembers) ? projectMembers : [];

  function handleRemove() {
    setRemoving(true);
    removeTaskMember(projectId, taskId, removeTarget.user_id)
      .then(() => {
        toast.success("Member removed from task.");
        onChanged?.();
        setRemoveTarget(null);
      })
      .catch((err) => {
        toast.error(err.response?.data?.message || "Failed to remove task member.");
      })
      .finally(() => setRemoving(false));
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-display text-base font-semibold text-txt-primary">
            Task Members
          </h3>
          <p className="mt-0.5 text-sm text-txt-muted">
            Users who are members of this task and its Task Chat
          </p>
        </div>
        {canManage && (
          <Button icon={UserPlus} size="sm" onClick={() => setAddOpen(true)}>
            Add Member
          </Button>
        )}
      </div>

      {safeTaskMembers.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-hair bg-surface-1 px-6 py-14 text-center">
          <span className="flex h-11 w-11 items-center justify-center rounded-full bg-surface-2 text-txt-muted">
            <Users size={20} />
          </span>
          <p className="text-sm font-medium text-txt-primary">No task members</p>
          <p className="max-w-xs text-sm text-txt-muted">
            {canManage
              ? "Add members so they can collaborate in this task's chat."
              : "No one has been added to this task yet."}
          </p>
          {canManage && (
            <Button
              icon={UserPlus}
              size="sm"
              className="mt-2"
              onClick={() => setAddOpen(true)}
            >
              Add Member
            </Button>
          )}
        </div>
      ) : (
        <div className="rounded-xl border border-hair bg-surface-1">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-left text-sm">
              <thead>
                <tr className="border-b border-hair">
                  <th className="px-4 py-2.5 text-[10.5px] font-medium uppercase tracking-[0.06em] text-txt-muted">
                    Member
                  </th>
                  <th className="px-4 py-2.5 text-[10.5px] font-medium uppercase tracking-[0.06em] text-txt-muted">
                    Email
                  </th>
                  <th className="px-4 py-2.5 text-[10.5px] font-medium uppercase tracking-[0.06em] text-txt-muted">
                    Added By
                  </th>
                  {canManage && (
                    <th className="px-4 py-2.5 text-right text-[10.5px] font-medium uppercase tracking-[0.06em] text-txt-muted">
                      <span className="sr-only">Actions</span>
                    </th>
                  )}
                </tr>
              </thead>
              <tbody>
                {safeTaskMembers.map((member) => (
                  <tr
                    key={member.id ?? member.user_id}
                    className="border-b border-hair transition-colors last:border-0 hover:bg-surface-2"
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <Avatar
                          firstName={member.user?.first_name}
                          lastName={member.user?.last_name}
                          avatarUrl={member.user?.avatar_url}
                          size="sm"
                        />
                        <p className="font-medium text-txt-primary">
                          {getUserName(member.user)}
                        </p>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-txt-muted">
                      {member.user?.email || "--"}
                    </td>
                    <td className="px-4 py-3 text-txt-muted">
                      {member.addedBy ? getUserName(member.addedBy) : "--"}
                    </td>
                    {canManage && (
                      <td className="px-4 py-3 text-right">
                        <MemberActionsMenu
                          isOpen={openMenuId === (member.id ?? member.user_id)}
                          onToggle={(next) =>
                            setOpenMenuId(next ? (member.id ?? member.user_id) : null)
                          }
                          onRemove={() => {
                            setRemoveTarget(member);
                            setOpenMenuId(null);
                          }}
                        />
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <AddTaskMemberModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        projectId={projectId}
        taskId={taskId}
        projectMembers={safeProjectMembers}
        taskMembers={safeTaskMembers}
        onAdded={onChanged}
      />

      <ConfirmDialog
        open={!!removeTarget}
        onClose={() => setRemoveTarget(null)}
        onConfirm={handleRemove}
        title="Remove Task Member"
        description={`Remove ${getUserName(removeTarget?.user)} from this task? They will lose access to this task's chat, but the task itself and any messages already sent will not be deleted or changed.`}
        confirmLabel="Remove"
        loading={removing}
      />
    </div>
  );
}
