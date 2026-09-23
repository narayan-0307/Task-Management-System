import { useEffect, useRef, useState } from "react";
import api from "../../api/client.js";
import Avatar from "../ui/Avatar.jsx";
import Spinner from "../common/Spinner.jsx";
import ErrorState from "../common/ErrorState.jsx";
import { getSocket } from "../../lib/socket.js";
import { useAuth } from "../../context/AuthContext.jsx";

function getSenderName(sender) {
  if (!sender) return "--";
  return `${sender.first_name || ""} ${sender.last_name || ""}`.trim() || "--";
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

// Task Chat feed + composer (Step 6/9). Attachments, mentions, edit/delete,
// read-state, typing indicators, and pagination are deliberately out of
// scope for this step.
export default function TaskChatTab({ projectId, taskId }) {
  const { user } = useAuth();
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [messageBody, setMessageBody] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState("");

  const messagesEndRef = useRef(null);

  function fetchMessages() {
    setLoading(true);
    setError("");

    api
      .get(`/projects/${projectId}/tasks/${taskId}/messages`)
      .then((res) => {
        setMessages(res.data.messages ?? []);
      })
      .catch((err) => {
        setError(
          err.response?.data?.message || "Failed to load chat messages.",
        );
      })
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    fetchMessages();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, taskId]);

  useEffect(() => {
    const socket = getSocket();

    function handleTaskMessage(message) {
      if (!message || String(message.task_id) !== String(taskId)) return;
      setMessages((prev) =>
        prev.some((m) => m.id === message.id) ? prev : [...prev, message],
      );
    }

    function handleMembershipRemoved({ task_id } = {}) {
      if (String(task_id) !== String(taskId)) return;
      setError("You were removed from this task's chat.");
    }

    socket.on("message:new", handleTaskMessage);
    socket.on("task:membership-removed", handleMembershipRemoved);
    socket.emit("task:chat:join", taskId);

    return () => {
      socket.off("message:new", handleTaskMessage);
      socket.off("task:membership-removed", handleMembershipRemoved);
      socket.emit("task:chat:leave", taskId);
    };
  }, [taskId]);

  // Auto-scroll to the newest message — on initial load and whenever the
  // list changes (a new message arrives via the socket, or is sent).
  useEffect(() => {
    if (loading) return;
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  function handleSendMessage(e) {
    e.preventDefault();

    const trimmed = messageBody.trim();
    if (!trimmed) return;

    setSending(true);
    setSendError("");

    api
      .post(`/projects/${projectId}/tasks/${taskId}/messages`, {
        body: trimmed,
      })
      .then(() => {
        // The new message is added via the "message:new" socket listener,
        // not from this response, so every open tab (including this one)
        // renders it the same way.
        setMessageBody("");
      })
      .catch((err) => {
        setSendError(
          err.response?.data?.message || "Failed to send message.",
        );
      })
      .finally(() => setSending(false));
  }

  if (loading) {
    return <Spinner label="Loading chat..." />;
  }

  if (error) {
    return <ErrorState message={error} onRetry={fetchMessages} />;
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Message list — the only part that scrolls; sized by the flex
          parent (drawer or tab card), never a fixed pixel height. */}
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pt-4 pb-8 sm:px-5 sm:pb-10">
        {messages.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center text-center">
            <p className="text-sm font-medium text-txt-primary">
              No messages yet
            </p>
            <p className="mt-1 text-sm text-txt-muted">
              Start a conversation about this task.
            </p>
          </div>
        )}

        <div className="space-y-5">
          {messages.map((message) => {
            const isOwn = message.sender_id === user?.id;

            return (
              <div
                key={message.id}
                className={`flex items-end gap-2 ${
                  isOwn ? "justify-end" : "justify-start"
                }`}
              >
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

                  <span className="mt-1 px-1 text-xs text-txt-muted">
                    {formatTimestamp(message.created_at)}
                  </span>
                </div>

                {isOwn && (
                  <div className="shrink-0">
                    <Avatar
                      firstName={user?.first_name}
                      lastName={user?.last_name}
                      avatarUrl={user?.avatar_url}
                      size="sm"
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div ref={messagesEndRef} />
      </div>

      {/* Composer */}
      <form
        onSubmit={handleSendMessage}
        className="shrink-0 border-t border-hair px-4 py-3 sm:px-5 sm:py-4"
      >
        <div className="flex gap-3">
          {/* Current user avatar */}
          <div className="hidden shrink-0 sm:block">
            <Avatar
              firstName={user?.first_name}
              lastName={user?.last_name}
              avatarUrl={user?.avatar_url}
              size="sm"
            />
          </div>

          <div className="min-w-0 flex-1 rounded-xl border border-hair bg-surface-1 transition focus-within:border-accentblue focus-within:ring-1 focus-within:ring-accentblue/30">
            <textarea
              value={messageBody}
              onChange={(e) => setMessageBody(e.target.value)}
              placeholder="Write a message…"
              disabled={sending}
              rows={2}
              className="w-full resize-none rounded-t-xl px-3 pt-3 text-sm text-txt-primary placeholder:text-txt-muted outline-none"
            />

            {sendError && (
              <p className="px-3 pb-1 text-xs text-red-600 dark:text-red-400">
                {sendError}
              </p>
            )}

            {/* Toolbar */}
            <div className="flex items-center justify-end px-3 pb-2 pt-1">
              <button
                type="submit"
                disabled={!messageBody.trim() || sending}
                className="rounded-lg bg-accentblue px-4 py-1.5 text-xs font-semibold text-white transition hover:bg-accentblue disabled:opacity-40"
              >
                {sending ? "Sending…" : "Send"}
              </button>
            </div>
          </div>
        </div>
      </form>
    </div>
  );
}
