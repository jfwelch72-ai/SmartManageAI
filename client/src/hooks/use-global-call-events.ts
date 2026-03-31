import { useEffect, useState, useCallback, useRef } from "react";
import { useAuth } from "@/hooks/use-auth";
import { apiRequest } from "@/lib/queryClient";
import { useGlobalSSE } from "@/contexts/GlobalSSEContext";
import { useGlobalVideoCall } from "@/contexts/GlobalVideoCallContext";
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
  const { startGlobalCall, updateActiveCall, dispatchSignal } = useGlobalVideoCall();
  const { addListener, removeListener } = useGlobalSSE();
  const userRef = useRef(user);
  useEffect(() => { userRef.current = user; }, [user]);

  useEffect(() => {
    if (!user) return;

    const handleCallStarted = (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data);
        const call = data.call as VideoCallData;
        if (call.initiatorId === userRef.current?.id) return;
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
                const other = conv.participants.find(p => p.userId !== userRef.current?.id);
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
        updateActiveCall(prev => {
          if (prev?.id === data.callId) return null;
          return prev;
        });
      } catch {}
    };

    const handleCallJoined = (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data);
        updateActiveCall(prev => {
          if (!prev || prev.id !== data.callId) return prev;
          const alreadyIn = prev.participants.some((p: { userId: string }) => p.userId === data.userId);
          if (alreadyIn) return prev;
          const newParticipant = {
            id: "",
            callId: data.callId,
            userId: data.userId,
            joinedAt: new Date().toISOString(),
            leftAt: null,
            user: { id: data.userId, firstName: data.userName?.split(" ")[0] || "", lastName: data.userName?.split(" ").slice(1).join(" ") || "", role: "" },
          };
          return { ...prev, status: "ACTIVE" as const, participants: [...prev.participants, newParticipant] };
        });
      } catch {}
    };

    const handleCallLeft = (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data);
        updateActiveCall(prev => {
          if (!prev || prev.id !== data.callId) return prev;
          return { ...prev, participants: prev.participants.filter((p: { userId: string }) => p.userId !== data.userId) };
        });
      } catch {}
    };

    const handleWebRTCSignal = (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data);
        dispatchSignal(data);
      } catch {}
    };

    addListener("call_started", handleCallStarted);
    addListener("call_ended", handleCallEnded);
    addListener("call_joined", handleCallJoined);
    addListener("call_left", handleCallLeft);
    addListener("webrtc_signal", handleWebRTCSignal);

    return () => {
      removeListener("call_started", handleCallStarted);
      removeListener("call_ended", handleCallEnded);
      removeListener("call_joined", handleCallJoined);
      removeListener("call_left", handleCallLeft);
      removeListener("webrtc_signal", handleWebRTCSignal);
    };
  }, [user, addListener, removeListener, updateActiveCall, dispatchSignal]);

  const acceptCall = useCallback(async () => {
    if (!incomingCall) return;
    const callToAccept = incomingCall;
    try {
      const res = await apiRequest("POST", `/api/calls/${callToAccept.id}/join`);
      const fullCallData = await res.json();

      const convsRes = await fetch("/api/conversations", { credentials: "include" });
      const convs: Conversation[] = convsRes.ok ? await convsRes.json() : [];
      const conv = convs.find(c => c.id === callToAccept.conversationId);

      if (conv) {
        startGlobalCall(fullCallData, conv);
      } else {
        const fallbackConversation: Conversation = {
          id: callToAccept.conversationId,
          type: "DIRECT",
          name: conversationName || "Video Call",
          description: null,
          topic: null,
          channelSlug: null,
          projectId: null,
          crewId: null,
          rfiId: null,
          changeOrderId: null,
          taskId: null,
          isCompanyChannel: false,
          isArchived: false,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          participants: [],
          unreadCount: 0,
          lastMessage: null,
        };
        startGlobalCall(fullCallData, fallbackConversation);
      }

      setIncomingCall(null);
    } catch (err) {
      console.error("Failed to accept call:", err);
    }
  }, [incomingCall, conversationName, startGlobalCall]);

  const declineCall = useCallback(() => {
    setIncomingCall(null);
  }, []);

  return { incomingCall, conversationName, acceptCall, declineCall };
}
