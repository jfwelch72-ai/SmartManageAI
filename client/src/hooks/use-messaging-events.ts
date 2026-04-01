import { useEffect, useRef, useState, useCallback } from "react";
import { queryClient } from "@/lib/queryClient";
import { useGlobalSSE } from "@/contexts/GlobalSSEContext";
import type { VideoCallData } from "@/components/messaging/types";

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

interface CallStartedEvent {
  conversationId: string;
  call: VideoCallData;
}

interface CallJoinedEvent {
  conversationId: string;
  callId: string;
  userId: string;
  userName: string;
}

interface CallLeftEvent {
  conversationId: string;
  callId: string;
  userId: string;
}

interface CallEndedEvent {
  conversationId: string;
  callId: string;
}

export type CallEventHandler = {
  onCallStarted?: (data: CallStartedEvent) => void;
  onCallJoined?: (data: CallJoinedEvent) => void;
  onCallLeft?: (data: CallLeftEvent) => void;
  onCallEnded?: (data: CallEndedEvent) => void;
};

export type OlderMessageUpdater = (messageId: string, updater: (m: Message) => Message) => void;

export function useMessagingEvents(
  activeConversationId: string | null,
  onUpdateOlderMessage?: OlderMessageUpdater,
  callEventHandler?: CallEventHandler,
): {
  sseLive: boolean;
  typingNames: Record<string, string>;
} {
  const { addListener, removeListener, isConnected } = useGlobalSSE();
  const [typingNames, setTypingNames] = useState<Record<string, string>>({});
  const callHandlerRef = useRef<CallEventHandler | undefined>(callEventHandler);
  useEffect(() => { callHandlerRef.current = callEventHandler; }, [callEventHandler]);

  const activeConvIdRef = useRef<string | null>(activeConversationId);
  const updaterRef = useRef<OlderMessageUpdater | undefined>(onUpdateOlderMessage);
  const typingTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  useEffect(() => { activeConvIdRef.current = activeConversationId; }, [activeConversationId]);
  useEffect(() => { updaterRef.current = onUpdateOlderMessage; }, [onUpdateOlderMessage]);

  useEffect(() => { setTypingNames({}); }, [activeConversationId]);

  useEffect(() => {
    if (!isConnected) return;

    const handleMessageNew = (e: MessageEvent) => {
      try {
        const { conversationId: convId, message } = JSON.parse(e.data) as MessageNewEvent;

        if (convId === activeConvIdRef.current) {
          queryClient.setQueryData<Message[]>(
            ["/api/conversations", convId, "messages"],
            (prev = []) => {
              const exists = prev.some(m => m.id === message.id);
              return exists ? prev : [...prev, { ...message, reactions: message.reactions ?? [] }];
            }
          );
        }

        queryClient.invalidateQueries({ queryKey: ["/api/conversations"] });
      } catch {}
    };

    const handleMessageEdited = (e: MessageEvent) => {
      try {
        const { conversationId: convId, message } = JSON.parse(e.data) as MessageEditedEvent;
        if (convId !== activeConvIdRef.current) return;

        const applyEdit = (m: Message) =>
          m.id === message.id ? { ...m, ...message, reactions: message.reactions ?? m.reactions ?? [] } : m;

        queryClient.setQueryData<Message[]>(
          ["/api/conversations", convId, "messages"],
          (prev = []) => prev.map(applyEdit)
        );

        updaterRef.current?.(message.id, (m) => applyEdit(m));
      } catch {}
    };

    const handleMessageDeleted = (e: MessageEvent) => {
      try {
        const { conversationId: convId, messageId } = JSON.parse(e.data) as MessageDeletedEvent;
        if (convId !== activeConvIdRef.current) return;

        const applyDelete = (m: Message) =>
          m.id === messageId ? { ...m, isDeleted: true, content: "", reactions: [] } : m;

        queryClient.setQueryData<Message[]>(
          ["/api/conversations", convId, "messages"],
          (prev = []) => prev.map(applyDelete)
        );

        updaterRef.current?.(messageId, (m) => applyDelete(m));
      } catch {}
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
      } catch {}
    };

    const handleTyping = (e: MessageEvent) => {
      try {
        const { conversationId: convId, userId: uid, firstName, lastName } =
          JSON.parse(e.data) as TypingEvent;

        if (convId !== activeConvIdRef.current) return;

        const name = `${firstName} ${lastName}`.trim();
        setTypingNames(prev => ({ ...prev, [uid]: name }));

        if (typingTimersRef.current[uid]) clearTimeout(typingTimersRef.current[uid]);
        typingTimersRef.current[uid] = setTimeout(() => {
          setTypingNames(prev => {
            const next = { ...prev };
            delete next[uid];
            return next;
          });
          delete typingTimersRef.current[uid];
        }, 3000);
      } catch {}
    };

    const handleCallStarted = (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data) as CallStartedEvent;
        callHandlerRef.current?.onCallStarted?.(data);
      } catch {}
    };

    const handleCallJoined = (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data) as CallJoinedEvent;
        callHandlerRef.current?.onCallJoined?.(data);
      } catch {}
    };

    const handleCallLeft = (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data) as CallLeftEvent;
        callHandlerRef.current?.onCallLeft?.(data);
      } catch {}
    };

    const handleCallEnded = (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data) as CallEndedEvent;
        callHandlerRef.current?.onCallEnded?.(data);
      } catch {}
    };

    addListener("message_new", handleMessageNew);
    addListener("message_edited", handleMessageEdited);
    addListener("message_deleted", handleMessageDeleted);
    addListener("message_reaction", handleMessageReaction);
    addListener("user_typing", handleTyping);
    addListener("call_started", handleCallStarted);
    addListener("call_joined", handleCallJoined);
    addListener("call_left", handleCallLeft);
    addListener("call_ended", handleCallEnded);

    return () => {
      removeListener("message_new", handleMessageNew);
      removeListener("message_edited", handleMessageEdited);
      removeListener("message_deleted", handleMessageDeleted);
      removeListener("message_reaction", handleMessageReaction);
      removeListener("user_typing", handleTyping);
      removeListener("call_started", handleCallStarted);
      removeListener("call_joined", handleCallJoined);
      removeListener("call_left", handleCallLeft);
      removeListener("call_ended", handleCallEnded);
    };
  }, [isConnected, addListener, removeListener]);

  return { sseLive: isConnected, typingNames };
}
