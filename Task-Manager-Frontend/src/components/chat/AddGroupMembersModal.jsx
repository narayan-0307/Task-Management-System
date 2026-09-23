import { useEffect, useMemo, useState } from "react";
import { Check } from "lucide-react";
import Modal from "../common/Modal.jsx";
import Spinner from "../common/Spinner.jsx";
import ErrorState from "../common/ErrorState.jsx";
import SearchInput from "../ui/SearchInput.jsx";
import Avatar from "../ui/Avatar.jsx";
import Button from "../ui/Button.jsx";
import { listOrganizationMembers } from "../../api/organizationMembers.js";
import { addConversationMembers } from "../../api/organizationChat.js";

// Step 25 — "Add Members" for an existing GROUP conversation. Mirrors
// NewChatModal's group-mode member picker (same multi-select + client-side
// search UX, same listOrganizationMembers() reuse -- one fetch per open,
// no per-keystroke or per-candidate requests), but targets an EXISTING
// conversation via addConversationMembers() instead of creating one.
//
// Frontend-only gating: this modal is only ever opened from
// GroupMembersPanel when the current user *appears* authorized (creator or
// owner/admin/manager). The backend (Step 24) is the real security
// boundary -- a 403 here is handled as a normal error, not a bug.
export default function AddGroupMembersModal({
  open,
  onClose,
  conversationId,
  currentUserId,
  existingMemberUserIds,
  onAdded,
}) {
  const [members, setMembers] = useState([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [membersError, setMembersError] = useState("");
  const [search, setSearch] = useState("");

  const [selectedUserIds, setSelectedUserIds] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");

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

  // Reset transient state and (re-)load members each time the modal opens.
  useEffect(() => {
    if (!open) return;
    setSearch("");
    setSelectedUserIds([]);
    setSubmitting(false);
    setSubmitError("");
    fetchMembers();
  }, [open]);

  const existingIdSet = useMemo(
    () => new Set((existingMemberUserIds ?? []).map((id) => Number(id))),
    [existingMemberUserIds],
  );

  const candidates = useMemo(() => {
    return members.filter(
      (m) =>
        Number(m.user_id) !== Number(currentUserId) &&
        !existingIdSet.has(Number(m.user_id)),
    );
  }, [members, currentUserId, existingIdSet]);

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

  function toggleMember(member) {
    if (submitting) return;
    setSubmitError("");
    setSelectedUserIds((prev) =>
      prev.includes(member.user_id)
        ? prev.filter((id) => id !== member.user_id)
        : [...prev, member.user_id],
    );
  }

  function handleSubmit() {
    if (submitting || selectedUserIds.length === 0) return;

    setSubmitting(true);
    setSubmitError("");

    addConversationMembers(conversationId, selectedUserIds)
      .then((res) => {
        // The backend returns the FULL current member list in one response
        // -- reuse it directly instead of a follow-up getConversation() call.
        onAdded?.(res.data?.members ?? null);
        onClose();
      })
      .catch((err) => {
        const status = err.response?.status;
        if (status === 403) {
          setSubmitError("You don't have permission to manage this group.");
        } else {
          setSubmitError(
            err.response?.data?.message || "Failed to add members. Please try again.",
          );
        }
        // Keep the panel open and preserve the user's selections on failure.
      })
      .finally(() => setSubmitting(false));
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add Members"
      size="md"
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={handleSubmit}
            disabled={submitting || selectedUserIds.length === 0}
          >
            {submitting ? "Adding..." : "Add Members"}
          </Button>
        </>
      }
    >
      <div className="mb-3">
        <SearchInput
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search members..."
          disabled={membersLoading || !!membersError}
        />
      </div>

      {submitError && (
        <p className="mb-3 text-xs text-red-600 dark:text-red-400">{submitError}</p>
      )}

      {membersLoading ? (
        <Spinner label="Loading members..." />
      ) : membersError ? (
        <ErrorState message={membersError} onRetry={fetchMembers} />
      ) : filteredCandidates.length === 0 ? (
        <div className="rounded-lg border border-dashed border-hair px-3 py-6 text-center text-xs text-txt-muted">
          {candidates.length === 0
            ? "Every active organization member is already in this group."
            : "No members match your search."}
        </div>
      ) : (
        <div className="max-h-72 overflow-y-auto rounded-lg border border-hair">
          {filteredCandidates.map((member) => {
            const isSelected = selectedUserIds.includes(member.user_id);
            return (
              <button
                key={member.user_id}
                type="button"
                disabled={submitting}
                onClick={() => toggleMember(member)}
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
    </Modal>
  );
}
