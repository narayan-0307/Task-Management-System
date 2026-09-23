import { useEffect, useMemo, useState } from "react";
import { Check } from "lucide-react";
import Modal from "../common/Modal.jsx";
import Spinner from "../common/Spinner.jsx";
import ErrorState from "../common/ErrorState.jsx";
import SearchInput from "../ui/SearchInput.jsx";
import Avatar from "../ui/Avatar.jsx";
import Button from "../ui/Button.jsx";
import { listOrganizationMembers } from "../../api/organizationMembers.js";
import {
  createDirectConversation,
  createGroupConversation,
} from "../../api/organizationChat.js";

// "New Chat" modal — Step 20 added Direct Message creation. Step 22 adds
// Group conversation creation, reusing the same member list (one fetch per
// modal open, client-side search) and the same existing group API contract
// already supported by the backend (POST /api/chat/conversations with
// type: "group").
//
// Member data is reused from the existing GET /api/organization/members
// endpoint (already org-scoped + active-members-only server-side) instead
// of introducing a new API -- the same one Members.jsx already uses.
export default function NewChatModal({ open, onClose, currentUserId, onCreated }) {
  const [mode, setMode] = useState("direct"); // "direct" | "group"

  const [members, setMembers] = useState([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [membersError, setMembersError] = useState("");
  const [search, setSearch] = useState("");

  // Direct Message flow state (unchanged from Step 20).
  const [creatingUserId, setCreatingUserId] = useState(null);
  const [createError, setCreateError] = useState("");

  // Group flow state.
  const [groupName, setGroupName] = useState("");
  const [groupNameError, setGroupNameError] = useState("");
  const [selectedMemberIds, setSelectedMemberIds] = useState([]);
  const [groupMembersError, setGroupMembersError] = useState("");
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [groupCreateError, setGroupCreateError] = useState("");

  function fetchMembers() {
    setMembersLoading(true);
    setMembersError("");
    listOrganizationMembers()
      .then((res) => {
        setMembers(res.data?.members ?? []);
      })
      .catch((err) => {
        setMembersError(
          err.response?.data?.message || "Failed to load organization members.",
        );
      })
      .finally(() => setMembersLoading(false));
  }

  // Reset transient state and (re-)load members each time the modal opens,
  // so a stale list/error/form from a previous open never lingers.
  useEffect(() => {
    if (!open) return;
    setMode("direct");
    setSearch("");
    setCreatingUserId(null);
    setCreateError("");
    setGroupName("");
    setGroupNameError("");
    setSelectedMemberIds([]);
    setGroupMembersError("");
    setCreatingGroup(false);
    setGroupCreateError("");
    fetchMembers();
  }, [open]);

  const candidates = useMemo(() => {
    return members.filter((m) => Number(m.user_id) !== Number(currentUserId));
  }, [members, currentUserId]);

  const filteredCandidates = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return candidates;
    return candidates.filter((m) => {
      const fullName = `${m.first_name || ""} ${m.last_name || ""}`.toLowerCase();
      return (
        fullName.includes(query) || (m.email || "").toLowerCase().includes(query)
      );
    });
  }, [candidates, search]);

  function handleSelectMember(member) {
    if (creatingUserId != null) return; // prevent duplicate submissions

    setCreatingUserId(member.user_id);
    setCreateError("");

    createDirectConversation([member.user_id])
      .then((res) => {
        const conversation = res.data?.conversation;
        onCreated?.(conversation);
      })
      .catch((err) => {
        setCreateError(
          err.response?.data?.message || "Failed to start direct message.",
        );
        setCreatingUserId(null);
      });
    // No `.finally` reset of creatingUserId on success -- the modal closes
    // via onCreated(), so there's no stale "Creating..." row left behind.
  }

  function handleSwitchMode(nextMode) {
    if (nextMode === mode) return;
    setMode(nextMode);
  }

  function handleToggleGroupMember(member) {
    if (creatingGroup) return;
    setGroupMembersError("");
    setSelectedMemberIds((prev) =>
      prev.includes(member.user_id)
        ? prev.filter((id) => id !== member.user_id)
        : [...prev, member.user_id],
    );
  }

  function handleGroupNameChange(e) {
    setGroupName(e.target.value);
    if (groupNameError) setGroupNameError("");
  }

  function handleCreateGroup() {
    if (creatingGroup) return;

    const trimmedName = groupName.trim();
    let hasError = false;

    if (!trimmedName) {
      setGroupNameError("Group name is required.");
      hasError = true;
    }

    if (selectedMemberIds.length === 0) {
      setGroupMembersError("Select at least one other member.");
      hasError = true;
    }

    if (hasError) return;

    setCreatingGroup(true);
    setGroupCreateError("");

    createGroupConversation(trimmedName, selectedMemberIds)
      .then((res) => {
        const conversation = res.data?.conversation;
        onCreated?.(conversation);
      })
      .catch((err) => {
        setGroupCreateError(
          err.response?.data?.message || "Failed to create group.",
        );
        setCreatingGroup(false);
      });
    // No `.finally` reset of creatingGroup on success -- the modal closes
    // via onCreated(), so there's no stale loading state left behind.
  }

  const isGroupMode = mode === "group";

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New Chat"
      size="md"
      footer={
        isGroupMode ? (
          <>
            <Button variant="secondary" size="sm" onClick={onClose} disabled={creatingGroup}>
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={handleCreateGroup}
              disabled={creatingGroup}
            >
              {creatingGroup ? "Creating..." : "Create Group"}
            </Button>
          </>
        ) : null
      }
    >
      <div className="mb-4 flex gap-2">
        <button
          type="button"
          onClick={() => handleSwitchMode("direct")}
          className={`flex-1 rounded-lg border px-3 py-2 text-sm font-semibold transition-colors ${
            !isGroupMode
              ? "border-accentblue bg-accentblue-soft text-accentblue"
              : "border-hair text-txt-muted hover:bg-surface-2"
          }`}
        >
          Direct Message
        </button>
        <button
          type="button"
          onClick={() => handleSwitchMode("group")}
          className={`flex-1 rounded-lg border px-3 py-2 text-sm font-semibold transition-colors ${
            isGroupMode
              ? "border-accentblue bg-accentblue-soft text-accentblue"
              : "border-hair text-txt-muted hover:bg-surface-2"
          }`}
        >
          Group
        </button>
      </div>

      {isGroupMode ? (
        <>
          <div className="mb-3">
            <label
              htmlFor="new-chat-group-name"
              className="mb-1.5 block text-xs font-medium text-txt-muted"
            >
              Group Name
            </label>
            <input
              id="new-chat-group-name"
              type="text"
              value={groupName}
              onChange={handleGroupNameChange}
              disabled={creatingGroup}
              placeholder="e.g. Development Team"
              className="w-full rounded-lg border border-hair bg-surface-1 px-3 py-2 text-sm text-txt-primary placeholder:text-txt-muted focus:border-accentblue focus:outline-none focus:ring-1 focus:ring-accentblue disabled:cursor-not-allowed disabled:bg-surface-2 disabled:text-txt-muted"
            />
            {groupNameError && (
              <p className="mt-1 text-xs text-red-600 dark:text-red-400">
                {groupNameError}
              </p>
            )}
          </div>

          <p className="mb-1.5 text-xs font-medium text-txt-muted">Select Members</p>

          <div className="mb-3">
            <SearchInput
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search members..."
              disabled={membersLoading || !!membersError}
            />
          </div>

          {groupMembersError && (
            <p className="mb-3 text-xs text-red-600 dark:text-red-400">
              {groupMembersError}
            </p>
          )}

          {groupCreateError && (
            <p className="mb-3 text-xs text-red-600 dark:text-red-400">
              {groupCreateError}
            </p>
          )}

          {membersLoading ? (
            <Spinner label="Loading members..." />
          ) : membersError ? (
            <ErrorState message={membersError} onRetry={fetchMembers} />
          ) : filteredCandidates.length === 0 ? (
            <div className="rounded-lg border border-dashed border-hair px-3 py-6 text-center text-xs text-txt-muted">
              {candidates.length === 0
                ? "No other active organization members yet."
                : "No members match your search."}
            </div>
          ) : (
            <div className="max-h-72 overflow-y-auto rounded-lg border border-hair">
              {filteredCandidates.map((member) => {
                const isSelected = selectedMemberIds.includes(member.user_id);
                return (
                  <button
                    key={member.user_id}
                    type="button"
                    disabled={creatingGroup}
                    onClick={() => handleToggleGroupMember(member)}
                    className={`flex w-full items-center gap-3 border-b border-hair px-3 py-2.5 text-left last:border-b-0 hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-50 ${
                      isSelected ? "bg-accentblue-soft" : ""
                    }`}
                  >
                    <Avatar
                      firstName={member.first_name}
                      lastName={member.last_name}
                      avatarUrl={member.avatar_url}
                      size="sm"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-txt-primary">
                        {(member.first_name || member.last_name)
                          ? `${member.first_name || ""} ${member.last_name || ""}`.trim()
                          : member.email}
                      </span>
                      {(member.first_name || member.last_name) && (
                        <span className="block truncate text-xs text-txt-muted">
                          {member.email}
                        </span>
                      )}
                    </span>
                    <span
                      className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${
                        isSelected
                          ? "border-accentblue bg-accentblue text-white"
                          : "border-hair"
                      }`}
                    >
                      {isSelected && <Check size={13} strokeWidth={3} />}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </>
      ) : (
        <>
          <p className="mb-3 text-xs text-txt-muted">
            Select an organization member to start a direct message.
          </p>

          <div className="mb-3">
            <SearchInput
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search members..."
              disabled={membersLoading || !!membersError}
            />
          </div>

          {createError && (
            <p className="mb-3 text-xs text-red-600 dark:text-red-400">{createError}</p>
          )}

          {membersLoading ? (
            <Spinner label="Loading members..." />
          ) : membersError ? (
            <ErrorState message={membersError} onRetry={fetchMembers} />
          ) : filteredCandidates.length === 0 ? (
            <div className="rounded-lg border border-dashed border-hair px-3 py-6 text-center text-xs text-txt-muted">
              {candidates.length === 0
                ? "No other active organization members yet."
                : "No members match your search."}
            </div>
          ) : (
            <div className="max-h-72 overflow-y-auto rounded-lg border border-hair">
              {filteredCandidates.map((member) => {
                const isCreatingThis = creatingUserId === member.user_id;
                const disabled = creatingUserId != null;
                return (
                  <button
                    key={member.user_id}
                    type="button"
                    disabled={disabled}
                    onClick={() => handleSelectMember(member)}
                    className={`flex w-full items-center gap-3 border-b border-hair px-3 py-2.5 text-left last:border-b-0 hover:bg-surface-2 disabled:cursor-not-allowed ${
                      disabled && !isCreatingThis ? "opacity-50" : ""
                    }`}
                  >
                    <Avatar
                      firstName={member.first_name}
                      lastName={member.last_name}
                      avatarUrl={member.avatar_url}
                      size="sm"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-txt-primary">
                        {(member.first_name || member.last_name)
                          ? `${member.first_name || ""} ${member.last_name || ""}`.trim()
                          : member.email}
                      </span>
                      {(member.first_name || member.last_name) && (
                        <span className="block truncate text-xs text-txt-muted">
                          {member.email}
                        </span>
                      )}
                    </span>
                    {isCreatingThis && (
                      <span className="shrink-0 text-xs text-txt-muted">Creating...</span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </>
      )}
    </Modal>
  );
}
