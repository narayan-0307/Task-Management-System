import { useEffect, useRef } from "react";
import { getSocket } from "../lib/socket.js";

/**
 * Join an Organization Chat conversation's realtime room and subscribe to
 * its events, for the lifetime of the given `conversationId`.
 *
 * Mirrors useActivitySocket.js's pattern: callbacks are read through a ref
 * so re-renders never re-subscribe, and the effect only re-runs when
 * `conversationId` itself changes. Unlike Activity's `organization:<id>`
 * room (auto-joined server-side), a conversation room requires an explicit
 * join/leave, so this hook emits `orgchat:conversation:join` on mount (or
 * when `conversationId` changes) and `orgchat:conversation:leave` on
 * cleanup -- reusing the existing shared socket singleton (getSocket()),
 * never opening a second connection.
 *
 * This hook contains no UI and no message/conversation state of its own --
 * callers own their own state and decide what to do with each event.
 *
 * @param {object} options
 * @param {number|string|null} options.conversationId - pass null/undefined
 *   to stay unsubscribed (e.g. while no conversation is selected yet).
 * @param {(message: object) => void} [options.onMessage] - called with the
 *   raw `orgchat:message:new` payload for this conversation.
 * @param {(payload: { conversationId, message: string }) => void} [options.onJoinError] -
 *   called if the server rejects the join (not found / not authorized).
 * @param {(payload: { conversation_id: number }) => void} [options.onMembershipRemoved] -
 *   called if the current user is evicted from this conversation.
 * @param {(payload: { conversation_id: number, message_id: number, attachment: object }) => void} [options.onAttachment] -
 *   called with the raw `orgchat:attachment:new` payload for this
 *   conversation. This hook only filters by conversation -- matching the
 *   attachment to a specific message (and de-duplicating by attachment.id)
 *   is left entirely to the caller, same division of labor as onMessage.
 */
export function useOrganizationChatSocket({
  conversationId,
  onMessage,
  onJoinError,
  onMembershipRemoved,
  onAttachment,
}) {
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;

  const onJoinErrorRef = useRef(onJoinError);
  onJoinErrorRef.current = onJoinError;

  const onMembershipRemovedRef = useRef(onMembershipRemoved);
  onMembershipRemovedRef.current = onMembershipRemoved;

  const onAttachmentRef = useRef(onAttachment);
  onAttachmentRef.current = onAttachment;

  useEffect(() => {
    if (conversationId == null) return undefined;

    const socket = getSocket();

    function handleMessage(message) {
      if (!message || String(message.conversation_id) !== String(conversationId)) {
        return;
      }
      onMessageRef.current?.(message);
    }

    function handleJoinError(payload = {}) {
      if (String(payload.conversationId) !== String(conversationId)) return;
      onJoinErrorRef.current?.(payload);
    }

    function handleMembershipRemoved(payload = {}) {
      if (String(payload.conversation_id) !== String(conversationId)) return;
      onMembershipRemovedRef.current?.(payload);
    }

    function handleAttachment(payload = {}) {
      if (String(payload.conversation_id) !== String(conversationId)) {
        return;
      }
      onAttachmentRef.current?.(payload);
    }

    socket.on("orgchat:message:new", handleMessage);
    socket.on("orgchat:conversation:join:error", handleJoinError);
    socket.on("orgchat:conversation:membership-removed", handleMembershipRemoved);
    socket.on("orgchat:attachment:new", handleAttachment);
    socket.emit("orgchat:conversation:join", { conversationId });

    return () => {
      socket.off("orgchat:message:new", handleMessage);
      socket.off("orgchat:conversation:join:error", handleJoinError);
      socket.off("orgchat:conversation:membership-removed", handleMembershipRemoved);
      socket.off("orgchat:attachment:new", handleAttachment);
      socket.emit("orgchat:conversation:leave", { conversationId });
    };
  }, [conversationId]);
}
