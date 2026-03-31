import { useEffect, useState, useCallback } from "react";
import { useAuth } from "@/hooks/use-auth";
import { apiRequest } from "@/lib/queryClient";
import type { VideoCallData, Conversation } from "@/components/messaging/types";

interface GlobalCallState {
  incomingCall: VideoCallData | null;
  conversationName: string;
  acceptCall: () => void;
  declineCall: () => void;
}

export function useGlobalCallEvents(): GlobalCallState {
  const { user } = useAuth();
  const [incomingCall, setIncomingCall] = useState<VideoCallData | null>(null);
  const [conversationName, setConversationName] = useState("");

  useEffect(() => {
    if (!user) return;

    const es = new EventSource("/api/messaging/events", { withCredentials: true } as EventSourceInit);

    const handleCallStarted = (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data);
        const call = data.call as VideoCallData;
        if (call.initiatorId === user.id) return;
        const overlay = document.querySelector('[data-testid="video-call-overlay"]');
        if (overlay) return;
        setIncomingCall(call);

        fetch("/api/conversations", { credentials: "include" })
          .then(res => res.ok ? res.json() : [])
          .then((convs: Conversation[]) => {
            const conv = convs.find(c => c.id === call.conversationId);
            if (conv) {
              if (conv.isCompanyChannel) {
                setConversationName("Company Chat");
              } else if (conv.name) {
                setConversationName(conv.name);
              } else if (conv.type === "DIRECT") {
                const other = conv.participants.find(p => p.userId !== user.id);
                if (other) setConversationName(`${other.user.firstName} ${other.user.lastName}`);
                else setConversationName("Direct Message");
              } else {
                setConversationName("Group Conversation");
              }
            } else {
              setConversationName("Video Call");
            }
          })
          .catch(() => setConversationName("Video Call"));
      } catch {}
    };

    const handleCallEnded = (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data);
        setIncomingCall(prev => {
          if (prev?.id === data.callId) return null;
          return prev;
        });
      } catch {}
    };

    es.addEventListener("call_started", handleCallStarted);
    es.addEventListener("call_ended", handleCallEnded);

    return () => {
      es.removeEventListener("call_started", handleCallStarted);
      es.removeEventListener("call_ended", handleCallEnded);
      es.close();
    };
  }, [user]);

  const acceptCall = useCallback(async () => {
    if (!incomingCall) return;
    const callToAccept = incomingCall;
    try {
      await apiRequest("POST", `/api/calls/${callToAccept.id}/join`);

      ((window as unknown as Record<string, unknown>).__pendingCallAccept) = {
        conversationId: callToAccept.conversationId,
        callId: callToAccept.id,
      };

      window.dispatchEvent(
        new CustomEvent("open-messaging-widget", {
          detail: {
            tab: "team",
            conversationId: callToAccept.conversationId,
            callId: callToAccept.id,
          },
        })
      );

      const dispatchSelect = (attempt: number) => {
        if (attempt > 10) return;
        window.dispatchEvent(
          new CustomEvent("select-conversation", {
            detail: { conversationId: callToAccept.conversationId, callId: callToAccept.id },
          })
        );
        setTimeout(() => {
          const overlay = document.querySelector('[data-testid="video-call-overlay"]');
          if (!overlay) dispatchSelect(attempt + 1);
        }, 200);
      };

      setTimeout(() => dispatchSelect(0), 100);

      setIncomingCall(null);
    } catch (err) {
      console.error("Failed to accept call:", err);
    }
  }, [incomingCall]);

  const declineCall = useCallback(() => {
    setIncomingCall(null);
  }, []);

  return { incomingCall, conversationName, acceptCall, declineCall };
}
