import { useEffect, useRef, useState } from "react";
import { queryClient } from "@/lib/queryClient";

export interface MessageReaction {
  emoji: string;
  count: number;
  userIds: string[];
}

export interface Message {
  id: string;
  conversationId: string;
  senderId: string;
  content: string;
  attachmentUrl: string | null;
  attachmentName: string | null;
  attachmentType: string | null;
  attachmentSize: number | null;
  voiceUrl: string | null;
  voiceDurationSeconds: number | null;
  mentionedTaskIds: string[] | null;
  isEdited: boolean;
  editedAt: string | null;
  isDeleted: boolean;
  reactions: MessageReaction[];
  createdAt: string;
  sender: {
    id: string;
    firstName: string;
    lastName: string;
    role: string;
  };
}

interface TypingEvent {
  conversationId: string;
  userId: string;
  firstName: string;
  lastName: string;
}

interface MessageNewEvent {
  conversationId: string;
  message: Message;
}

interface MessageEditedEvent {
  conversationId: string;
  message: Message;
}

interface MessageDeletedEvent {
  conversationId: string;
  messageId: string;
}

interface MessageReactionEvent {
  conversationId: string;
  messageId: string;
  reactions: MessageReaction[];
}

/** Called when a message in olderMessages needs updating (SSE events for historical messages). */
export type OlderMessageUpdater = (messageId: string, updater: (m: Message) => Message) => void;

/**
 * Opens a single SSE connection to /api/messaging/events and provides:
 * - `sseLive` — true when the SSE stream is connected
 * - `typingNames` — map of userId → display name for users currently typing in the active conversation
 *
 * Pass `activeConversationId` to scope typing and message updates to the open conversation.
 * Pass `onUpdateOlderMessage` to propagate SSE-driven edits/deletes/reactions to olderMessages state.
 * New messages for any conversation will also invalidate the conversations sidebar query.
 */
export function useMessagingEvents(
  activeConversationId: string | null,
  onUpdateOlderMessage?: OlderMessageUpdater,
): {
  sseLive: boolean;
  typingNames: Record<string, string>;
} {
  const [sseLive, setSseLive] = useState(false);
  const [typingNames, setTypingNames] = useState<Record<string, string>>({});

  // Keep stable refs so SSE callbacks always read the latest values
  const activeConvIdRef = useRef<string | null>(activeConversationId);
  const updaterRef = useRef<OlderMessageUpdater | undefined>(onUpdateOlderMessage);
  const typingTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  // Sync refs on each render
  useEffect(() => { activeConvIdRef.current = activeConversationId; }, [activeConversationId]);
  useEffect(() => { updaterRef.current = onUpdateOlderMessage; }, [onUpdateOlderMessage]);

  // Clear typing state on conversation switch
  useEffect(() => { setTypingNames({}); }, [activeConversationId]);

  useEffect(() => {
    const es = new EventSource("/api/messaging/events", { withCredentials: true } as EventSourceInit);

    const handleConnected = () => setSseLive(true);

    const handleMessageNew = (e: MessageEvent) => {
      try {
        const { conversationId: convId, message } = JSON.parse(e.data) as MessageNewEvent;

        // Append to active conversation cache — de-duplicate by id
        if (convId === activeConvIdRef.current) {
          queryClient.setQueryData<Message[]>(
            ["/api/conversations", convId, "messages"],
            (prev = []) => {
              const exists = prev.some(m => m.id === message.id);
              return exists ? prev : [...prev, { ...message, reactions: message.reactions ?? [] }];
            }
          );
        }

        // Refresh sidebar conversation list (unread counts, last message preview)
        queryClient.invalidateQueries({ queryKey: ["/api/conversations"] });
      } catch {
        // malformed event — ignore
      }
    };

    const handleMessageEdited = (e: MessageEvent) => {
      try {
        const { conversationId: convId, message } = JSON.parse(e.data) as MessageEditedEvent;
        if (convId !== activeConvIdRef.current) return;

        const applyEdit = (m: Message) =>
          m.id === message.id ? { ...m, ...message, reactions: message.reactions ?? m.reactions ?? [] } : m;

        // Update latestMessages (TanStack Query cache)
        queryClient.setQueryData<Message[]>(
          ["/api/conversations", convId, "messages"],
          (prev = []) => prev.map(applyEdit)
        );

        // Update olderMessages if provided
        updaterRef.current?.(message.id, (m) => applyEdit(m));
      } catch {
        // malformed event — ignore
      }
    };

    const handleMessageDeleted = (e: MessageEvent) => {
      try {
        const { conversationId: convId, messageId } = JSON.parse(e.data) as MessageDeletedEvent;
        if (convId !== activeConvIdRef.current) return;

        // Clear content, set deleted, and clear reactions (deleted messages show no reactions)
        const applyDelete = (m: Message) =>
          m.id === messageId ? { ...m, isDeleted: true, content: "", reactions: [] } : m;

        queryClient.setQueryData<Message[]>(
          ["/api/conversations", convId, "messages"],
          (prev = []) => prev.map(applyDelete)
        );

        updaterRef.current?.(messageId, (m) => applyDelete(m));
      } catch {
        // malformed event — ignore
      }
    };

    const handleMessageReaction = (e: MessageEvent) => {
      try {
        const { conversationId: convId, messageId, reactions } = JSON.parse(e.data) as MessageReactionEvent;
        if (convId !== activeConvIdRef.current) return;

        const applyReaction = (m: Message) => m.id === messageId ? { ...m, reactions } : m;

        queryClient.setQueryData<Message[]>(
          ["/api/conversations", convId, "messages"],
          (prev = []) => prev.map(applyReaction)
        );

        updaterRef.current?.(messageId, (m) => applyReaction(m));
      } catch {
        // malformed event — ignore
      }
    };

    const handleTyping = (e: MessageEvent) => {
      try {
        const { conversationId: convId, userId: uid, firstName, lastName } =
          JSON.parse(e.data) as TypingEvent;

        if (convId !== activeConvIdRef.current) return;

        const name = `${firstName} ${lastName}`.trim();
        setTypingNames(prev => ({ ...prev, [uid]: name }));

        // Clear any existing 3s timer for this user and reset it
        if (typingTimersRef.current[uid]) clearTimeout(typingTimersRef.current[uid]);
        typingTimersRef.current[uid] = setTimeout(() => {
          setTypingNames(prev => {
            const next = { ...prev };
            delete next[uid];
            return next;
          });
          delete typingTimersRef.current[uid];
        }, 3000);
      } catch {
        // malformed event — ignore
      }
    };

    es.addEventListener("connected", handleConnected);
    es.addEventListener("message_new", handleMessageNew);
    es.addEventListener("message_edited", handleMessageEdited);
    es.addEventListener("message_deleted", handleMessageDeleted);
    es.addEventListener("message_reaction", handleMessageReaction);
    es.addEventListener("user_typing", handleTyping);
    es.onerror = () => setSseLive(false);

    return () => {
      es.removeEventListener("connected", handleConnected);
      es.removeEventListener("message_new", handleMessageNew);
      es.removeEventListener("message_edited", handleMessageEdited);
      es.removeEventListener("message_deleted", handleMessageDeleted);
      es.removeEventListener("message_reaction", handleMessageReaction);
      es.removeEventListener("user_typing", handleTyping);
      es.close();
      setSseLive(false);
    };
  }, []); // mount once — uses refs for active conversation

  return { sseLive, typingNames };
}
