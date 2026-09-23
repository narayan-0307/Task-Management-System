import { useEffect, useState } from "react";
import { Crown, LogOut, UserPlus, UserX } from "lucide-react";
import Drawer from "../ui/Drawer.jsx";
import Avatar from "../ui/Avatar.jsx";
import Button from "../ui/Button.jsx";
import ConfirmDialog from "../common/ConfirmDialog.jsx";
import AddGroupMembersModal from "./AddGroupMembersModal.jsx";
import { removeConversationMember } from "../../api/organizationChat.js";

// Step 25 — Members panel for a GROUP conversation. Frontend/UX only: every
// permission decision here is a convenience for hiding buttons a user
// couldn't use anyway. The backend (Step 24) enforces the real rules --
// creator or organization owner/admin/manager can add/remove, no one can
// remove the creator, a non-creator member can remove themselves. A 403/400
// from the server is always handled gracefully here, never assumed away.
const MANAGEMENT_ROLES = new Set(["owner", "admin", "manager"]);

function memberDisplayName(user) {
  if (!user) return "Unknown user";
  const fullName = `${user.first_name || ""} ${user.last_name || ""}`.trim();
  return fullName || user.email || "Unknown user";
}

export default function GroupMembersPanel({
  open,
  onClose,
  conversation,
  members,
  currentUserId,
  currentUserRole,
  onMembersChanged,
  onLeft,
}) {
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [removeTarget, setRemoveTarget] = useState(null);
  const [leaveConfirmOpen, setLeaveConfirmOpen] = useState(false);
  const [pendingUserId, setPendingUserId] = useState(null); // in-flight remove/leave
  const [actionError, setActionError] = useState("");

  // Reset transient state whenever the panel opens/closes or the underlying
  // conversation changes, so a stale confirm dialog or error from a
  // previously-viewed group never lingers.
  useEffect(() => {
    setAddModalOpen(false);
    setRemoveTarget(null);
    setLeaveConfirmOpen(false);
    setPendingUserId(null);
    setActionError("");
  }, [open, conversation?.id]);

  if (!conversation) return null;

  const safeMembers = Array.isArray(members) ? members : [];
  const creatorId = conversation.created_by;
  const currentUserIsCreator = Number(creatorId) === Number(currentUserId);

  // UX-only "can this user manage members" signal -- see file header.
  const canManage =
    currentUserIsCreator ||
    (currentUserRole && MANAGEMENT_ROLES.has(currentUserRole));

  const existingMemberUserIds = safeMembers.map((m) => m.user_id);

  function describeError(err) {
    const status = err.response?.status;
    if (status === 403) {
      return "You don't have permission to manage this group.";
    }
    return err.response?.data?.message || "Something went wrong. Please try again.";
  }

  function handleMembersAdded(fullMembersList) {
    if (fullMembersList) {
      onMembersChanged?.(fullMembersList);
    }
  }

  function handleConfirmRemove() {
    if (!removeTarget) return;
    const targetUserId = removeTarget.user_id;

    setPendingUserId(targetUserId);
    setActionError("");

    removeConversationMember(conversation.id, targetUserId)
      .then(() => {
        onMembersChanged?.(
          safeMembers.filter((m) => Number(m.user_id) !== Number(targetUserId)),
        );
        setRemoveTarget(null);
      })
      .catch((err) => {
        setActionError(describeError(err));
      })
      .finally(() => setPendingUserId(null));
  }

  function handleConfirmLeave() {
    setPendingUserId(currentUserId);
    setActionError("");

    removeConversationMember(conversation.id, currentUserId)
      .then(() => {
        setLeaveConfirmOpen(false);
        onLeft?.();
      })
      .catch((err) => {
        setActionError(describeError(err));
      })
      .finally(() => setPendingUserId(null));
  }

  return (
    <>
      <Drawer
        open={open}
        onClose={onClose}
        title={conversation.name || "Group"}
        description={`${safeMembers.length} member${safeMembers.length === 1 ? "" : "s"}`}
        footer={
          canManage ? (
            <Button
              variant="primary"
              size="sm"
              icon={UserPlus}
              onClick={() => setAddModalOpen(true)}
            >
              Add Members
            </Button>
          ) : null
        }
      >
        {actionError && (
          <p className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-400">
            {actionError}
          </p>
        )}

        {safeMembers.length === 0 ? (
          <div className="rounded-lg border border-dashed border-hair px-3 py-6 text-center text-xs text-txt-muted">
            No members to show.
          </div>
        ) : (
          <div className="flex flex-col gap-1">
            {safeMembers.map((member) => {
              const isCreator = Number(member.user_id) === Number(creatorId);
              const isSelf = Number(member.user_id) === Number(currentUserId);
              const isPending = pendingUserId === member.user_id;

              return (
                <div
                  key={member.id ?? member.user_id}
                  className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-surface-2"
                >
                  <Avatar
                    firstName={member.user?.first_name}
                    lastName={member.user?.last_name}
                    avatarUrl={member.user?.avatar_url}
                    size="sm"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-txt-primary">
                      {memberDisplayName(member.user)}
                      {isSelf && <span className="text-txt-muted"> (you)</span>}
                    </p>
                    {isCreator ? (
                      <span className="mt-0.5 inline-flex items-center gap-1 text-xs font-medium text-accentblue">
                        <Crown size={12} /> Creator
                      </span>
                    ) : (
                      member.user?.email && (
                        <p className="truncate text-xs text-txt-muted">
                          {member.user.email}
                        </p>
                      )
                    )}
                  </div>

                  {/* Creator protection is reflected in the UI: no Remove
                      action is ever rendered for the creator's row, and the
                      creator's own row never gets a Leave action either --
                      the backend rejects both anyway (Step 24). */}
                  {isCreator ? (
                    isSelf && (
                      <span className="shrink-0 text-xs text-txt-muted">
                        You are the group creator
                      </span>
                    )
                  ) : isSelf ? (
                    <button
                      type="button"
                      onClick={() => setLeaveConfirmOpen(true)}
                      disabled={isPending}
                      className="flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50 dark:text-red-400 dark:hover:bg-red-950/30"
                    >
                      <LogOut size={13} /> Leave
                    </button>
                  ) : (
                    canManage && (
                      <button
                        type="button"
                        onClick={() => setRemoveTarget(member)}
                        disabled={isPending}
                        className="flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-txt-muted hover:bg-surface-2 hover:text-red-600 disabled:opacity-50 dark:hover:text-red-400"
                      >
                        <UserX size={13} /> Remove
                      </button>
                    )
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Drawer>

      <AddGroupMembersModal
        open={addModalOpen}
        onClose={() => setAddModalOpen(false)}
        conversationId={conversation.id}
        currentUserId={currentUserId}
        existingMemberUserIds={existingMemberUserIds}
        onAdded={handleMembersAdded}
      />

      <ConfirmDialog
        open={!!removeTarget}
        onClose={() => setRemoveTarget(null)}
        onConfirm={handleConfirmRemove}
        title="Remove Member"
        description={`Remove ${memberDisplayName(removeTarget?.user)} from "${conversation.name}"?`}
        confirmLabel="Remove"
        loading={pendingUserId === removeTarget?.user_id}
      />

      <ConfirmDialog
        open={leaveConfirmOpen}
        onClose={() => setLeaveConfirmOpen(false)}
        onConfirm={handleConfirmLeave}
        title="Leave Group"
        description={`Leave "${conversation.name}"? You will no longer receive messages from this group.`}
        confirmLabel="Leave Group"
        loading={pendingUserId === currentUserId}
      />
    </>
  );
}
