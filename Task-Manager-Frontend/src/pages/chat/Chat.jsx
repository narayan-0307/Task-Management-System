import { useEffect, useRef, useState } from "react";
import { MessageSquare, Paperclip, Plus, Users, X } from "lucide-react";
import AppLayout from "../../components/layout/AppLayout.jsx";
import SearchInput from "../../components/ui/SearchInput.jsx";
import Button from "../../components/ui/Button.jsx";
import Spinner from "../../components/common/Spinner.jsx";
import ErrorState from "../../components/common/ErrorState.jsx";
import Avatar from "../../components/ui/Avatar.jsx";
import { useAuth } from "../../context/AuthContext.jsx";
import {
  listConversations,
  getConversation,
  listMessages,
  sendMessage,
  uploadOrgChatAttachment,
  downloadOrgChatAttachment,
} from "../../api/organizationChat.js";
import { useOrganizationChatSocket } from "../../hooks/useOrganizationChatSocket.js";
import NewChatModal from "../../components/chat/NewChatModal.jsx";
import GroupMembersPanel from "../../components/chat/GroupMembersPanel.jsx";
import formatFileSize from "../../utils/formatFileSize.js";

// Step 27: client-side-only guard, matching the backend's multer limit
// (middleware/upload.js). The backend remains the final authority -- this
// only avoids an obviously-doomed upload round trip.
const MAX_ATTACHMENT_SIZE = 10 * 1024 * 1024;

// Step 21: shared "display name for a lightweight user object" helper --
// first_name + last_name, falling back to email, falling back to null.
// Used for both the list's `direct_participant` (below) and the selected
// header's `members`-derived participant (directConversationParticipantName
// below), so there's only one naming rule, not two.
function participantDisplayName(user) {
  if (!user) return null;
  const fullName = `${user.first_name || ""} ${user.last_name || ""}`.trim();
  if (fullName) return fullName;
  if (user.email) return user.email;
  return null;
}

// The list endpoint (Step 21) now includes `direct_participant` -- the
// other member's lightweight display info -- directly on each direct
// conversation row, in the same single request as the rest of the list
// (no per-row getConversation() call). Used for both the sidebar label and
// search matching (Step 12A), and it's also what `getConversation()`'s
// fuller `conversation` object falls back through if `direct_participant`
// happens to be present on it too, since both share the same
// {id, type, name, ...} shape.
function conversationLabel(conversation) {
  if (!conversation) return "Untitled conversation";
  if (conversation.name && conversation.name.trim()) return conversation.name;
  if (conversation.type === "org_wide") return "HumanCare Team";
  if (conversation.type === "direct") {
    const participantName = participantDisplayName(conversation.direct_participant);
    if (participantName) return participantName;
    return "Direct message";
  }
  return "Untitled conversation";
}

function conversationTypeLabel(type) {
  if (type === "org_wide") return "Organization-wide";
  if (type === "direct") return "Direct message";
  if (type === "group") return "Group conversation";
  return "";
}

// Step 16: the OTHER participant of a direct conversation, derived from
// getConversation()'s `members` (never fetched for list rows -- see the
// note on conversationLabel() above, which stays the list/search fallback).
// Defensive by design: a missing/empty members array, a missing `user`
// include, an unmatched current user, or missing name/email fields all fall
// through to `null` rather than throwing.
function directConversationParticipantName(members, currentUserId) {
  if (!Array.isArray(members) || currentUserId == null) return null;

  const other = members.find(
    (member) => member?.user && Number(member.user_id) !== Number(currentUserId),
  );
  return participantDisplayName(other?.user);
}

// Header-only label for the SELECTED conversation. Identical to
// conversationLabel() for org_wide/group (HumanCare Team / the group's own
// name), but for a direct conversation prefers the other participant's real
// name when getConversation()'s members are available, falling back to the
// same generic "Direct message" conversationLabel() already uses.
function selectedConversationLabel(conversation, members, currentUserId) {
  if (!conversation) return "Untitled conversation";
  if (conversation.type === "direct") {
    const participantName = directConversationParticipantName(
      members,
      currentUserId,
    );
    if (participantName) return participantName;
  }
  return conversationLabel(conversation);
}

// Mirrors TaskChatTab.jsx's getSenderName/formatTimestamp -- same
// conventions, kept local to this file rather than extracted, since this
// step only touches Chat.jsx.
function getSenderName(sender) {
  if (!sender) return "Unknown";
  return (
    `${sender.first_name || ""} ${sender.last_name || ""}`.trim() ||
    sender.email ||
    "Unknown"
  );
}

function formatTimestamp(value) {
  if (!value) return "";
  return new Date(value).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

// Step 27: attachments are attached locally to a message (see
// uploadAttachmentForMessage in Chat()) as `message.attachments` -- never
// part of the listMessages()/sendMessage()/socket payload shapes
// themselves. Rendered as a simple name + size + download row; no preview.
function MessageAttachment({ attachment, isOwn, isDownloading, onDownload }) {
  return (
    <button
      type="button"
      onClick={() => onDownload(attachment)}
      disabled={isDownloading}
      title="Open attachment"
      className={`flex w-full items-center gap-2 rounded-lg border px-2.5 py-1.5 text-left text-xs transition disabled:cursor-wait disabled:opacity-70 ${
        isOwn
          ? "border-white/25 bg-white/10 text-white hover:bg-white/15"
          : "border-hair bg-surface-1 text-txt-primary hover:bg-surface-2"
      }`}
    >
      <Paperclip size={13} className="shrink-0" />
      <span className="min-w-0 flex-1 truncate font-medium">
        {attachment.file_name}
      </span>
      <span className={isOwn ? "shrink-0 text-white/70" : "shrink-0 text-txt-muted"}>
        {isDownloading ? "Opening..." : formatFileSize(attachment.file_size)}
      </span>
    </button>
  );
}

function MessageRow({
  message,
  isOwn,
  downloadingAttachmentId,
  onDownloadAttachment,
}) {
  const attachments = message.attachments ?? [];

  return (
    <div className={`flex items-end gap-2 ${isOwn ? "justify-end" : "justify-start"}`}>
      {!isOwn && (
        <div className="shrink-0">
          <Avatar
            firstName={message.sender?.first_name}
            lastName={message.sender?.last_name}
            avatarUrl={message.sender?.avatar_url}
            size="sm"
          />
        </div>
      )}

      <div
        className={`flex max-w-[80%] min-w-0 flex-col sm:max-w-[70%] lg:max-w-[60%] ${
          isOwn ? "items-end" : "items-start"
        }`}
      >
        {!isOwn && (
          <span className="mb-1 px-1 text-xs font-semibold text-txt-primary">
            {getSenderName(message.sender)}
          </span>
        )}

        <div
          className={`rounded-2xl px-3.5 py-2 text-sm leading-6 break-words ${
            isOwn
              ? "rounded-br-sm bg-accentblue text-white"
              : "rounded-bl-sm bg-surface-2 text-txt-primary"
          }`}
        >
          {message.body}
        </div>

        {attachments.length > 0 && (
          <div className="mt-1.5 flex w-full min-w-[10rem] flex-col gap-1">
            {attachments.map((attachment) => (
              <MessageAttachment
                key={attachment.id}
                attachment={attachment}
                isOwn={isOwn}
                isDownloading={downloadingAttachmentId === attachment.id}
                onDownload={() => onDownloadAttachment(message, attachment)}
              />
            ))}
          </div>
        )}

        <span className="mt-1 px-1 text-xs text-txt-muted">
          {formatTimestamp(message.created_at)}
        </span>
      </div>
    </div>
  );
}

function ConversationRow({ conversation, isSelected, onSelect }) {
  return (
    <button
      type="button"
      onClick={() => onSelect(conversation.id)}
      className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition-colors ${
        isSelected
          ? "bg-accentblue text-white"
          : "text-txt-primary hover:bg-surface-2"
      }`}
    >
      <span
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
          isSelected ? "bg-white/20" : "bg-surface-2"
        }`}
      >
        {conversation.type === "org_wide" ? (
          <Users size={15} className={isSelected ? "text-white" : "text-txt-muted"} />
        ) : (
          <MessageSquare
            size={15}
            className={isSelected ? "text-white" : "text-txt-muted"}
          />
        )}
      </span>
      <span className="min-w-0 flex-1 truncate font-medium">
        {conversationLabel(conversation)}
      </span>
    </button>
  );
}

// A titled group of conversations (e.g. "Direct Messages"), with the
// existing Step 10 empty-state placeholder when there are none.
//
// `showEmptyPlaceholder` distinguishes "genuinely no conversations in this
// section" (Step 12 behavior, unchanged) from "a search is active and this
// section just has no matches" -- in the latter case we render nothing at
// all for the section rather than the misleading "No conversations yet"
// placeholder (that text is reserved for the real empty-API-response case).
function ConversationSection({ title, items, selectedId, onSelect, showEmptyPlaceholder }) {
  if (items.length === 0 && !showEmptyPlaceholder) {
    return null;
  }

  return (
    <div className="mb-4 last:mb-0">
      <p className="px-2 pb-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-txt-muted">
        {title}
      </p>
      {items.length === 0 ? (
        <div className="rounded-lg border border-dashed border-hair px-3 py-6 text-center text-xs text-txt-muted">
          No conversations yet
        </div>
      ) : (
        <div className="flex flex-col gap-0.5">
          {items.map((conversation) => (
            <ConversationRow
              key={conversation.id}
              conversation={conversation}
              isSelected={conversation.id === selectedId}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// Organization Chat — conversation list (Step 12) + selecting a conversation
// to load and display its details/messages (Step 13). Everything else stays
// exactly as the Step 10/11 shell.
//
// Still deliberately NOT wired: sendMessage(), useOrganizationChatSocket(),
// unread counts, and conversation creation/member management.
export default function Chat() {
  const { user } = useAuth();

  const [search, setSearch] = useState("");
  const [conversations, setConversations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedId, setSelectedId] = useState(null);

  // Step 20: "+ New Chat" modal (Direct Message creation only).
  const [newChatOpen, setNewChatOpen] = useState(false);

  // Step 25: Members panel, group conversations only.
  const [membersPanelOpen, setMembersPanelOpen] = useState(false);

  // Step 13: the selected conversation's own detail + its messages.
  const [selectedConversation, setSelectedConversation] = useState(null);
  // Step 16: getConversation()'s `members`, used only to derive the other
  // participant's name for a selected direct conversation's header -- never
  // fetched per conversation-list row.
  const [selectedConversationMembers, setSelectedConversationMembers] = useState([]);
  const [messages, setMessages] = useState([]);
  const [conversationLoading, setConversationLoading] = useState(false);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [conversationError, setConversationError] = useState("");
  const [messagesError, setMessagesError] = useState("");

  // Step 15: the composer for the selected conversation.
  const [messageInput, setMessageInput] = useState("");
  const [sendingMessage, setSendingMessage] = useState(false);
  const [sendError, setSendError] = useState("");
  const messageInputRef = useRef(null);

  // Step 27: attachment composer state. `pendingAttachment` is the File the
  // user picked but hasn't sent yet -- nothing is uploaded until
  // handleSendMessage() creates the text message first. `attachmentError`
  // is the client-side validation message (size only; MIME/type is left to
  // the backend). `uploadingAttachment` covers the upload call that runs
  // after a successful sendMessage(). `failedAttachmentUpload` holds enough
  // state (conversationId, messageId, file) to retry an upload whose
  // message was already sent successfully -- the message itself is never
  // rolled back when only the attachment fails.
  const [pendingAttachment, setPendingAttachment] = useState(null);
  const [attachmentError, setAttachmentError] = useState("");
  const [uploadingAttachment, setUploadingAttachment] = useState(false);
  const [failedAttachmentUpload, setFailedAttachmentUpload] = useState(null);
  const [downloadingAttachmentId, setDownloadingAttachmentId] = useState(null);
  const attachmentInputRef = useRef(null);

  // Step 28: attachments that arrived via `orgchat:attachment:new` before
  // their message existed in local `messages` state yet (e.g. the
  // conversation's initial listMessages() REST call was still in flight).
  // Keyed by message_id -> attachment[]; never discarded, only drained once
  // the matching message enters state (see applyPendingAttachments below).
  const pendingRealtimeAttachmentsRef = useRef(new Map());

  // Shared dedupe rule for every path that can add an attachment to a
  // message (the sender's own optimistic POST-response merge, and the
  // realtime socket event) -- attachment.id is the only identifier used.
  function addAttachmentIfMissing(message, attachment) {
    const attachments = message.attachments ?? [];
    const alreadyPresent = attachments.some(
      (item) => Number(item.id) === Number(attachment.id),
    );
    if (alreadyPresent) return message;
    return { ...message, attachments: [...attachments, attachment] };
  }

  // Drains any attachments buffered for this message (by id) into it. Safe
  // to call for every message that enters state, whether or not anything is
  // actually pending for it.
  function applyPendingAttachments(message) {
    const pending = pendingRealtimeAttachmentsRef.current.get(message.id);
    if (!pending || pending.length === 0) return message;
    pendingRealtimeAttachmentsRef.current.delete(message.id);
    return pending.reduce(
      (current, attachment) => addAttachmentIfMissing(current, attachment),
      message,
    );
  }

  // Race-condition guard: identifies which conversationId's requests are
  // still "current". A response is only applied if this ref still matches
  // the conversationId it was fetched for -- so if the user clicks
  // Conversation A then quickly B, A's late-arriving response is dropped
  // instead of overwriting B's state.
  const activeConversationIdRef = useRef(null);

  function fetchConversations() {
    setLoading(true);
    setError("");

    listConversations()
      .then((res) => {
        setConversations(res.data?.conversations ?? []);
      })
      .catch((err) => {
        setError(
          err.response?.data?.message || "Failed to load conversations.",
        );
      })
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    fetchConversations();
  }, []);

  function loadConversation(conversationId) {
    activeConversationIdRef.current = conversationId;

    setConversationLoading(true);
    setMessagesLoading(true);
    setConversationError("");
    setMessagesError("");

    getConversation(conversationId)
      .then((res) => {
        if (activeConversationIdRef.current !== conversationId) return;
        setSelectedConversation(res.data?.conversation ?? null);
        setSelectedConversationMembers(res.data?.members ?? []);
      })
      .catch((err) => {
        if (activeConversationIdRef.current !== conversationId) return;
        setConversationError(
          err.response?.data?.message || "Failed to load conversation.",
        );
      })
      .finally(() => {
        if (activeConversationIdRef.current !== conversationId) return;
        setConversationLoading(false);
      });

    listMessages(conversationId, { page: 1, limit: 50 })
      .then((res) => {
        if (activeConversationIdRef.current !== conversationId) return;
        const rows = res.data?.messages ?? [];
        // The backend returns newest-first (its pagination convention);
        // reverse here for the standard oldest-to-newest chat reading order.
        const chronological = [...rows].reverse();

        // Step 28: these messages are entering local state for the first
        // time -- drain any attachment(s) that arrived via
        // orgchat:attachment:new before this REST response resolved.
        const chronologicalWithPendingAttachments = chronological.map((m) =>
          applyPendingAttachments(m),
        );

        // Merge rather than overwrite: a realtime message for this same
        // conversation may have already arrived (via the socket) while this
        // REST request was still in flight and gotten appended to state.
        // Keep it instead of discarding it when this response commits.
        setMessages((prev) => {
          const knownIds = new Set(
            chronologicalWithPendingAttachments.map((m) => m.id),
          );
          const notYetInResponse = prev.filter((m) => !knownIds.has(m.id));
          return [...chronologicalWithPendingAttachments, ...notYetInResponse];
        });
      })
      .catch((err) => {
        if (activeConversationIdRef.current !== conversationId) return;
        setMessagesError(
          err.response?.data?.message || "Failed to load messages.",
        );
      })
      .finally(() => {
        if (activeConversationIdRef.current !== conversationId) return;
        setMessagesLoading(false);
      });
  }

  function handleSelectConversation(conversationId) {
    // Already selected -- avoid re-fetching on a redundant click.
    if (conversationId === selectedId) return;

    setSelectedId(conversationId);
    setSelectedConversation(null);
    setSelectedConversationMembers([]);
    setMessages([]);
    // A send in flight for the previous conversation is still guarded by
    // activeConversationIdRef (see handleSendMessage), but the composer's
    // own UI state belongs to whichever conversation is now selected.
    setMessageInput("");
    setSendingMessage(false);
    setSendError("");
    // Step 27: a pending/failed attachment belongs to the composer of
    // whichever conversation was selected when it was picked/failed -- never
    // carry it over to a new selection.
    setPendingAttachment(null);
    setAttachmentError("");
    setUploadingAttachment(false);
    setFailedAttachmentUpload(null);
    // Step 28: any attachment(s) still waiting on a message from the
    // PREVIOUS conversation belong to that conversation's messages, which
    // are about to be discarded (setMessages([]) above) -- never carry them
    // into the newly selected conversation's state.
    pendingRealtimeAttachmentsRef.current = new Map();
    // Step 25: the Members panel belongs to whichever conversation was
    // selected when it was opened -- never carry it over to a new selection.
    setMembersPanelOpen(false);
    loadConversation(conversationId);
  }

  function handleRetrySelectedConversation() {
    if (selectedId == null) return;
    loadConversation(selectedId);
  }

  // Step 20: called by NewChatModal after createDirectConversation()
  // succeeds -- whether it created a brand new direct conversation or the
  // backend returned an existing one (its own dedup, not re-implemented
  // here). Either way: refresh the list (a single list call, not one
  // getConversation() per row) and select/open the conversation using the
  // existing Step 13 loadConversation() flow.
  function handleConversationCreated(conversation) {
    setNewChatOpen(false);
    if (!conversation?.id) return;
    fetchConversations();
    handleSelectConversation(conversation.id);
  }

  // ── Step 14: realtime message delivery ─────────────────────────────────
  // The scrollable message list -- read synchronously (not via state) to
  // decide, at the moment a realtime message arrives, whether the user is
  // near the bottom and should be auto-scrolled to the new message.
  const messagesContainerRef = useRef(null);
  const pendingAutoScrollRef = useRef(false);

  function isNearBottom() {
    const el = messagesContainerRef.current;
    if (!el) return true;
    return el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  }

  // After `messages` re-renders, scroll to the bottom ONLY if the realtime
  // handler below asked for it (i.e. the user was already near the bottom
  // when the new message arrived). A user who scrolled up to read history
  // is never forcibly jumped back down.
  useEffect(() => {
    if (!pendingAutoScrollRef.current) return;
    pendingAutoScrollRef.current = false;
    const el = messagesContainerRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages]);

  function handleRealtimeMessage(message) {
    if (!message || message.id == null) return;

    const shouldAutoScroll = isNearBottom();

    // Functional update + id check: never reads stale `messages`, and never
    // appends a message that's already in the list (e.g. one this same tab
    // just sent and got back from listMessages(), or a duplicate delivery).
    setMessages((prev) => {
      if (prev.some((m) => m.id === message.id)) return prev;
      // Step 28: this message is entering state for the first time here --
      // drain any attachment(s) that arrived via orgchat:attachment:new
      // before this message did.
      return [...prev, applyPendingAttachments(message)];
    });

    if (shouldAutoScroll) {
      pendingAutoScrollRef.current = true;
    }
  }

  function handleMembershipRemoved() {
    // Return to the pre-selection state entirely -- do not navigate away
    // from /chat, just clear the selection so the right pane falls back to
    // the existing "Select a conversation" empty state.
    setSelectedId(null);
    setSelectedConversation(null);
    setSelectedConversationMembers([]);
    setMessages([]);
    setConversationError("");
    setMessagesError("");
    setMessageInput("");
    setSendingMessage(false);
    setSendError("");
    setPendingAttachment(null);
    setAttachmentError("");
    setUploadingAttachment(false);
    setFailedAttachmentUpload(null);
    pendingRealtimeAttachmentsRef.current = new Map();
    // Step 25: whether membership was removed remotely (realtime event) or
    // via this same tab's own "Leave Group"/removal flow, the Members panel
    // has nothing left to show -- close it along with the conversation.
    setMembersPanelOpen(false);
    // Also refresh the conversation list so a group the user just left (or
    // was removed from) drops out of the sidebar immediately.
    fetchConversations();
  }

  function handleJoinError() {
    // This is the realtime socket room join failing, separate from the
    // REST getConversation()/listMessages() calls above. If REST content
    // for this conversation hasn't finished loading yet, surface it as the
    // conversation error (consistent existing error state). If REST already
    // loaded successfully and the conversation is visibly working, don't
    // replace a working view over a realtime-only failure -- just note it.
    if (conversationLoading || messagesLoading) {
      setConversationError("You do not have access to this conversation.");
      setConversationLoading(false);
      setMessagesLoading(false);
    } else {
      console.warn(
        "Organization Chat: realtime join failed for the selected conversation.",
      );
    }
  }

  // ── Step 15: sending a message ──────────────────────────────────────────
  function handleMessageInputChange(e) {
    setMessageInput(e.target.value);
    // Clear a previous send error as soon as the user starts editing again.
    if (sendError) setSendError("");
  }

  function handleComposerKeyDown(e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
    // Shift+Enter: no special handling needed -- the browser's default
    // textarea behavior already inserts a newline.
  }

  // ── Step 27: attachment selection ───────────────────────────────────────
  function handleAttachmentButtonClick() {
    attachmentInputRef.current?.click();
  }

  function handleAttachmentFileChange(e) {
    const file = e.target.files[0];
    // Always reset so picking the same file again still fires onChange.
    e.target.value = "";
    if (!file) return;

    if (file.size > MAX_ATTACHMENT_SIZE) {
      setAttachmentError("File is too large. Maximum size is 10 MB.");
      return;
    }

    setAttachmentError("");
    setPendingAttachment(file);
  }

  function handleRemovePendingAttachment() {
    setPendingAttachment(null);
    setAttachmentError("");
  }

  // Uploads `file` against an already-created message. Only ever called
  // after sendMessage() has succeeded -- there is no backend path to create
  // an attachment without a messageId (see api/organizationChat.js). Race
  // guard mirrors the rest of this file: a response for a conversation the
  // user has since navigated away from is dropped rather than applied.
  function uploadAttachmentForMessage(conversationIdAtSend, messageId, file) {
    setUploadingAttachment(true);
    setFailedAttachmentUpload(null);

    uploadOrgChatAttachment(conversationIdAtSend, messageId, file)
      .then((res) => {
        if (activeConversationIdRef.current !== conversationIdAtSend) return;

        const attachment = res.data?.attachment;
        if (!attachment) return;

        // Step 28: this same attachment will also arrive back over
        // orgchat:attachment:new (emitted by the backend right after this
        // same upload). Dedupe by attachment.id so it's never added twice
        // for the sender's own tab.
        setMessages((prev) =>
          prev.map((m) =>
            m.id === messageId ? addAttachmentIfMissing(m, attachment) : m,
          ),
        );
      })
      .catch((err) => {
        if (activeConversationIdRef.current !== conversationIdAtSend) return;
        // The message itself already succeeded and stays visible -- only
        // the attachment failed, so keep just enough to retry it.
        setFailedAttachmentUpload({
          conversationId: conversationIdAtSend,
          messageId,
          file,
          error:
            err.response?.data?.message || "Failed to upload attachment.",
        });
      })
      .finally(() => {
        if (activeConversationIdRef.current !== conversationIdAtSend) return;
        setUploadingAttachment(false);
      });
  }

  function handleRetryAttachmentUpload() {
    if (!failedAttachmentUpload) return;
    if (uploadingAttachment) return;
    const { conversationId, messageId, file } = failedAttachmentUpload;
    uploadAttachmentForMessage(conversationId, messageId, file);
  }

  function handleDismissFailedAttachmentUpload() {
    setFailedAttachmentUpload(null);
  }

  function handleSendMessage() {
    const trimmed = messageInput.trim();
    if (!trimmed) return;
    if (selectedId == null) return;
    if (sendingMessage || uploadingAttachment) return; // prevent duplicate clicks

    // Captured so a slow request can't apply its result to a conversation
    // the user has since navigated away from (mirrors activeConversationIdRef
    // usage in loadConversation()).
    const conversationIdAtSend = selectedId;
    // Captured up front: the text message is created first regardless of
    // whether a file is attached, and the attachment upload (if any) only
    // starts after that succeeds -- never before.
    const fileToSend = pendingAttachment;

    setSendingMessage(true);
    setSendError("");

    sendMessage(conversationIdAtSend, trimmed)
      .then((res) => {
        if (activeConversationIdRef.current !== conversationIdAtSend) return;

        // The server response is authoritative -- no client-constructed
        // fake message object. It's appended through the same id-dedupe
        // path Step 14 uses, since the server's `orgchat:message:new`
        // broadcast may deliver this exact message back to this same tab.
        const sentMessage = res.data?.message;
        if (sentMessage) {
          const shouldAutoScroll = isNearBottom();
          setMessages((prev) => {
            if (prev.some((m) => m.id === sentMessage.id)) return prev;
            return [...prev, sentMessage];
          });
          if (shouldAutoScroll) {
            pendingAutoScrollRef.current = true;
          }
        }

        setMessageInput("");
        messageInputRef.current?.focus();

        // Message creation succeeded -- now, and only now, upload the
        // attachment against the message id the backend just returned.
        if (fileToSend && sentMessage) {
          setPendingAttachment(null);
          uploadAttachmentForMessage(
            conversationIdAtSend,
            sentMessage.id,
            fileToSend,
          );
        }
      })
      .catch((err) => {
        if (activeConversationIdRef.current !== conversationIdAtSend) return;
        // Preserve the user's input AND the selected file on failure so
        // they can retry manually -- the attachment is never uploaded when
        // the message itself failed to send.
        setSendError(err.response?.data?.message || "Failed to send message.");
      })
      .finally(() => {
        if (activeConversationIdRef.current !== conversationIdAtSend) return;
        setSendingMessage(false);
      });
  }

  // ── Step 27: authenticated attachment download ──────────────────────────
  // The download endpoint requires auth and returns the raw file, so a plain
  // <a href> would 401 -- fetch it through the authenticated api client as a
  // blob, then hand the browser a short-lived local object URL to open.
  function handleDownloadAttachment(message, attachment) {
    if (downloadingAttachmentId != null) return;
    if (selectedId == null) return;

    setDownloadingAttachmentId(attachment.id);

    downloadOrgChatAttachment(selectedId, message.id, attachment.id)
      .then((res) => {
        const blobUrl = URL.createObjectURL(
          new Blob([res.data], { type: attachment.mime_type }),
        );
        window.open(blobUrl, "_blank", "noopener,noreferrer");
        // Give the new tab time to actually load the blob before revoking.
        setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);
      })
      .catch((err) => {
        console.error("Failed to download attachment:", err);
      })
      .finally(() => {
        setDownloadingAttachmentId(null);
      });
  }

  // ── Step 28: realtime attachment delivery ───────────────────────────────
  // Handles `orgchat:attachment:new` for the currently selected conversation
  // (the hook already filtered by conversation_id before calling this). The
  // matching message may already be in state (merge immediately) or may not
  // have arrived yet (buffer it -- see pendingRealtimeAttachmentsRef).
  function handleRealtimeAttachment({ message_id, attachment } = {}) {
    if (message_id == null || attachment?.id == null) return;

    setMessages((prev) => {
      const index = prev.findIndex(
        (m) => Number(m.id) === Number(message_id),
      );

      if (index === -1) {
        // Message not in state yet -- stash for applyPendingAttachments()
        // to pick up once it arrives (via realtime or the REST fetch).
        const existingPending =
          pendingRealtimeAttachmentsRef.current.get(message_id) ?? [];
        const alreadyPending = existingPending.some(
          (item) => Number(item.id) === Number(attachment.id),
        );
        if (!alreadyPending) {
          pendingRealtimeAttachmentsRef.current.set(message_id, [
            ...existingPending,
            attachment,
          ]);
        }
        return prev;
      }

      const updatedMessage = addAttachmentIfMissing(prev[index], attachment);
      if (updatedMessage === prev[index]) return prev; // already present

      const next = [...prev];
      next[index] = updatedMessage;
      return next;
    });
  }

  // Single abstraction for Organization Chat realtime events, exactly as
  // it already exists -- no second socket connection, no manual
  // socket.on/off here. Passing `selectedId` re-joins/leaves the
  // conversation room automatically as the selection changes; passing
  // `null` (no conversation selected) keeps the hook unsubscribed.
  //
  // Known limitation (unchanged, not solved here): if the underlying
  // socket singleton reconnects (e.g. after a network drop), this hook
  // does not automatically re-emit `orgchat:conversation:join` for a room
  // it had previously joined -- selecting the conversation again (or a
  // page reload) restores it. Solving that belongs to socket.js/the hook,
  // not this page.
  useOrganizationChatSocket({
    conversationId: selectedId,
    onMessage: handleRealtimeMessage,
    onJoinError: handleJoinError,
    onMembershipRemoved: handleMembershipRemoved,
    onAttachment: handleRealtimeAttachment,
  });

  // Local, client-side search only -- filters the already-loaded
  // `conversations` array; never sent to the backend, never triggers a
  // network request.
  const trimmedSearch = search.trim().toLowerCase();
  const isSearching = trimmedSearch.length > 0;

  function matchesSearch(conversation) {
    if (!isSearching) return true;
    return conversationLabel(conversation).toLowerCase().includes(trimmedSearch);
  }

  const orgWideConversations = conversations
    .filter((c) => c.type === "org_wide")
    .filter(matchesSearch);
  const directConversations = conversations
    .filter((c) => c.type === "direct")
    .filter(matchesSearch);
  const groupConversations = conversations
    .filter((c) => c.type === "group")
    .filter(matchesSearch);

  const hasAnyMatches =
    orgWideConversations.length +
      directConversations.length +
      groupConversations.length >
    0;

  return (
    <AppLayout title="Chat">
      <div className="flex h-[calc(100vh-8rem)] min-h-[520px] flex-col overflow-hidden rounded-xl border border-hair bg-surface-1 sm:flex-row">
        {/* ── LEFT PANE: conversation list ───────────────────────────── */}
        <aside className="flex min-h-0 shrink-0 flex-col border-b border-hair sm:w-[320px] sm:border-b-0 sm:border-r lg:w-[360px]">
          {/* Header */}
          <div className="flex shrink-0 items-center justify-between gap-2 border-b border-hair px-4 py-3.5">
            <h2 className="text-base font-display font-bold text-txt-primary">
              Chat
            </h2>
            <Button
              variant="secondary"
              size="sm"
              icon={Plus}
              onClick={() => setNewChatOpen(true)}
            >
              New Chat
            </Button>
          </div>

          {/* Search */}
          <div className="shrink-0 border-b border-hair px-3 py-3">
            <SearchInput
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search conversations..."
            />
          </div>

          {/* Conversation sections */}
          <div className="min-h-0 flex-1 overflow-y-auto px-2 py-3">
            {loading ? (
              <Spinner label="Loading conversations..." />
            ) : error ? (
              <ErrorState message={error} onRetry={fetchConversations} />
            ) : isSearching && !hasAnyMatches ? (
              <div className="rounded-lg border border-dashed border-hair px-3 py-6 text-center text-xs text-txt-muted">
                No conversations found
              </div>
            ) : (
              <>
                <ConversationSection
                  title="HumanCare Team"
                  items={orgWideConversations}
                  selectedId={selectedId}
                  onSelect={handleSelectConversation}
                  showEmptyPlaceholder={!isSearching}
                />
                <ConversationSection
                  title="Direct Messages"
                  items={directConversations}
                  selectedId={selectedId}
                  onSelect={handleSelectConversation}
                  showEmptyPlaceholder={!isSearching}
                />
                <ConversationSection
                  title="Groups"
                  items={groupConversations}
                  selectedId={selectedId}
                  onSelect={handleSelectConversation}
                  showEmptyPlaceholder={!isSearching}
                />
              </>
            )}
          </div>
        </aside>

        {/* ── RIGHT PANE: active conversation ────────────────────────── */}
        <section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          {selectedId == null ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 px-6 py-10 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-surface-2">
                <MessageSquare size={24} className="text-txt-muted" />
              </div>
              <p className="text-sm font-semibold text-txt-primary">
                Select a conversation
              </p>
              <p className="max-w-xs text-sm text-txt-muted">
                Choose a conversation from the list, or start a new one, to see
                messages here.
              </p>
            </div>
          ) : conversationLoading || messagesLoading ? (
            <div className="flex h-full items-center justify-center p-6">
              <Spinner label="Loading conversation..." />
            </div>
          ) : conversationError || messagesError ? (
            <div className="flex h-full items-center justify-center p-6">
              <ErrorState
                message={conversationError || messagesError}
                onRetry={handleRetrySelectedConversation}
              />
            </div>
          ) : (
            <div className="flex h-full min-h-0 flex-col">
              {/* Conversation header */}
              <div className="flex shrink-0 items-center justify-between gap-2 border-b border-hair px-4 py-3.5">
                <div className="min-w-0">
                  <h3 className="truncate text-sm font-semibold text-txt-primary">
                    {selectedConversationLabel(
                      selectedConversation,
                      selectedConversationMembers,
                      user?.id,
                    )}
                  </h3>
                  <p className="mt-0.5 text-xs text-txt-muted">
                    {conversationTypeLabel(selectedConversation?.type)}
                  </p>
                </div>
                {/* Step 25: Members control -- group conversations only.
                    Never shown for HumanCare Team (org_wide) or Direct
                    Message, whose membership is not user-managed. */}
                {selectedConversation?.type === "group" && (
                  <Button
                    variant="secondary"
                    size="sm"
                    icon={Users}
                    onClick={() => setMembersPanelOpen(true)}
                  >
                    Members
                  </Button>
                )}
              </div>

              {/* Messages — scrollable, oldest to newest */}
              <div
                ref={messagesContainerRef}
                className="min-h-0 flex-1 overflow-y-auto px-4 py-4"
              >
                {messages.length === 0 ? (
                  <div className="flex h-full flex-col items-center justify-center text-center">
                    <p className="text-sm font-medium text-txt-primary">
                      No messages yet
                    </p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {messages.map((message) => (
                      <MessageRow
                        key={message.id}
                        message={message}
                        isOwn={message.sender_id === user?.id}
                        downloadingAttachmentId={downloadingAttachmentId}
                        onDownloadAttachment={handleDownloadAttachment}
                      />
                    ))}
                  </div>
                )}
              </div>

              {/* Composer */}
              <div className="shrink-0 border-t border-hair px-4 py-3">
                {sendError && (
                  <p className="mb-2 text-xs text-red-600 dark:text-red-400">
                    {sendError}
                  </p>
                )}

                {attachmentError && (
                  <p className="mb-2 text-xs text-red-600 dark:text-red-400">
                    {attachmentError}
                  </p>
                )}

                {/* Step 27: a message that sent successfully but whose
                    attachment upload failed. The message itself is never
                    rolled back -- only the attachment is retryable here. */}
                {failedAttachmentUpload && (
                  <div className="mb-2 flex items-center justify-between gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
                    <span className="min-w-0 flex-1">
                      Message sent, but attachment upload failed
                      {failedAttachmentUpload.error
                        ? `: ${failedAttachmentUpload.error}`
                        : "."}
                    </span>
                    <div className="flex shrink-0 items-center gap-2">
                      <button
                        type="button"
                        onClick={handleRetryAttachmentUpload}
                        disabled={uploadingAttachment}
                        className="font-semibold underline-offset-2 hover:underline disabled:opacity-50"
                      >
                        {uploadingAttachment ? "Retrying..." : "Retry"}
                      </button>
                      <button
                        type="button"
                        onClick={handleDismissFailedAttachmentUpload}
                        disabled={uploadingAttachment}
                        className="rounded p-0.5 hover:bg-amber-500/10 disabled:opacity-50"
                        title="Dismiss"
                      >
                        <X size={13} />
                      </button>
                    </div>
                  </div>
                )}

                {/* Step 27: the file selected for the NEXT message, shown
                    before it's uploaded (upload only starts once
                    sendMessage() itself has succeeded). */}
                {pendingAttachment && (
                  <div className="mb-2 flex items-center gap-2 rounded-lg border border-hair bg-surface-2 px-2.5 py-1.5 text-xs">
                    <Paperclip size={13} className="shrink-0 text-txt-muted" />
                    <span className="min-w-0 flex-1 truncate font-medium text-txt-primary">
                      {pendingAttachment.name}
                    </span>
                    <span className="shrink-0 text-txt-muted">
                      {formatFileSize(pendingAttachment.size)}
                    </span>
                    <button
                      type="button"
                      onClick={handleRemovePendingAttachment}
                      disabled={sendingMessage || uploadingAttachment}
                      className="shrink-0 rounded p-0.5 text-txt-muted hover:bg-surface-1 hover:text-txt-primary disabled:opacity-50"
                      title="Remove attachment"
                    >
                      <X size={13} />
                    </button>
                  </div>
                )}

                <div className="flex items-end gap-2">
                  <input
                    ref={attachmentInputRef}
                    type="file"
                    className="hidden"
                    onChange={handleAttachmentFileChange}
                  />
                  <button
                    type="button"
                    onClick={handleAttachmentButtonClick}
                    disabled={sendingMessage || uploadingAttachment}
                    title="Attach a file"
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-hair text-txt-muted transition hover:bg-surface-2 hover:text-txt-primary disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Paperclip size={16} />
                  </button>
                  <textarea
                    ref={messageInputRef}
                    value={messageInput}
                    onChange={handleMessageInputChange}
                    onKeyDown={handleComposerKeyDown}
                    placeholder="Write a message..."
                    rows={2}
                    disabled={sendingMessage}
                    className="w-full min-w-0 flex-1 resize-none rounded-lg border border-hair bg-surface-1 px-3 py-2 text-sm text-txt-primary placeholder:text-txt-muted focus:border-accentblue focus:outline-none focus:ring-1 focus:ring-accentblue disabled:cursor-not-allowed disabled:bg-surface-2 disabled:text-txt-muted"
                  />
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={handleSendMessage}
                    disabled={
                      sendingMessage ||
                      uploadingAttachment ||
                      !messageInput.trim()
                    }
                  >
                    {sendingMessage
                      ? "Sending..."
                      : uploadingAttachment
                        ? "Uploading..."
                        : "Send"}
                  </Button>
                </div>
              </div>
            </div>
          )}
        </section>
      </div>

      <NewChatModal
        open={newChatOpen}
        onClose={() => setNewChatOpen(false)}
        currentUserId={user?.id}
        onCreated={handleConversationCreated}
      />

      {selectedConversation?.type === "group" && (
        <GroupMembersPanel
          open={membersPanelOpen}
          onClose={() => setMembersPanelOpen(false)}
          conversation={selectedConversation}
          members={selectedConversationMembers}
          currentUserId={user?.id}
          currentUserRole={user?.role}
          onMembersChanged={setSelectedConversationMembers}
          onLeft={handleMembershipRemoved}
        />
      )}
    </AppLayout>
  );
}
