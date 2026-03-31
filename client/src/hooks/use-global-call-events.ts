import { useEffect, useRef, useState, useCallback } from "react";
import { useAuth } from "@/hooks/use-auth";
import type { VideoCallData } from "@/components/messaging/types";
import { apiRequest } from "@/lib/queryClient";

interface CallStartedEvent {
  conversationId: string;
  call: VideoCallData;
}

interface CallEndedEvent {
  conversationId: string;
  callId: string;
}

interface GlobalCallState {
  incomingCall: VideoCallData | null;
  acceptCall: () => void;
  declineCall: () => void;
}

export interface PendingAcceptedCall {
  conversationId: string;
  callId: string;
}

let pendingAcceptedCall: PendingAcceptedCall | null = null;

export function getPendingAcceptedCall(): PendingAcceptedCall | null {
  return pendingAcceptedCall;
}

export function clearPendingAcceptedCall(): void {
  pendingAcceptedCall = null;
}

export function clearGlobalIncomingCall(): void {
  window.dispatchEvent(new CustomEvent("global-call-clear"));
}

export function useGlobalCallEvents(): GlobalCallState {
  const { user } = useAuth();
  const [incomingCall, setIncomingCall] = useState<VideoCallData | null>(null);
  const teamMessagesActiveRef = useRef(false);
  const incomingCallRef = useRef<VideoCallData | null>(null);

  useEffect(() => {
    incomingCallRef.current = incomingCall;
  }, [incomingCall]);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent)?.detail;
      teamMessagesActiveRef.current = !!detail?.teamActive;
    };
    window.addEventListener("messaging-widget-state", handler);
    return () => window.removeEventListener("messaging-widget-state", handler);
  }, []);

  useEffect(() => {
    const handler = () => {
      setIncomingCall(null);
    };
    window.addEventListener("global-call-clear", handler);
    return () => window.removeEventListener("global-call-clear", handler);
  }, []);

  useEffect(() => {
    if (!user) return;

    const es = new EventSource("/api/messaging/events", { withCredentials: true } as EventSourceInit);

    const handleCallStarted = (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data) as CallStartedEvent;
        if (data.call.initiatorId === user.id) return;
        if (teamMessagesActiveRef.current) return;
        setIncomingCall(data.call);
      } catch {}
    };

    const handleCallEnded = (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data) as CallEndedEvent;
        if (incomingCallRef.current?.id === data.callId) {
          setIncomingCall(null);
        }
      } catch {}
    };

    es.addEventListener("call_started", handleCallStarted);
    es.addEventListener("call_ended", handleCallEnded);

    return () => {
      es.removeEventListener("call_started", handleCallStarted);
      es.removeEventListener("call_ended", handleCallEnded);
      es.close();
    };
  }, [user?.id]);

  const acceptCall = useCallback(async () => {
    if (!incomingCall) return;
    try {
      await apiRequest("POST", `/api/calls/${incomingCall.id}/join`);
      pendingAcceptedCall = {
        conversationId: incomingCall.conversationId,
        callId: incomingCall.id,
      };
      setIncomingCall(null);
      window.dispatchEvent(
        new CustomEvent("open-messaging-widget", { detail: { tab: "team" } })
      );
    } catch (err) {
      console.error("Failed to join call:", err);
    }
  }, [incomingCall]);

  const declineCall = useCallback(() => {
    setIncomingCall(null);
  }, []);

  return {
    incomingCall,
    acceptCall,
    declineCall,
  };
}
