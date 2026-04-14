import { useEffect, useState, useCallback, useRef } from "react";
import { useAuth } from "@/hooks/use-auth";
import { apiRequest } from "@/lib/queryClient";
import { useGlobalSSE } from "@/contexts/GlobalSSEContext";
import { useGlobalVideoCall } from "@/contexts/GlobalVideoCallContext";
import { useLocation } from "wouter";
import type { VideoCallData, Conversation } from "@/components/messaging/types";

const INCOMING_CALL_TIMEOUT_MS = 30000;
const ACTIVE_CALLS_POLL_INTERVAL_MS = 15000;
const IDLE_CALLS_POLL_INTERVAL_MS = 60000;

const MESSAGING_PATHS = ["/messages", "/portal-chat"];

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
  const { startGlobalCall, updateActiveCall, activeCall, roomRef } = useGlobalVideoCall();
  const { addListener, removeListener, isConnected } = useGlobalSSE();
  const [location] = useLocation();
  const userRef = useRef(user);
  const activeCallRef = useRef(activeCall);
  const locationRef = useRef(location);
  useEffect(() => { locationRef.current = location; }, [location]);
  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastPolledCallIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => { userRef.current = user; }, [user]);
  useEffect(() => { activeCallRef.current = activeCall; }, [activeCall]);

  useEffect(() => {
    if (!user || !isConnected) return;

    const handleCallStarted = (e: MessageEvent) => {
      try {
        console.log("[CallEvents] Received call_started SSE event");
        const data = JSON.parse(e.data);
        console.log("[CallEvents] call_started data:", { callId: data?.call?.id, initiatorId: data?.call?.initiatorId, status: data?.call?.status });
        const call = data.call as VideoCallData;
        if (!call || !call.id) {
          console.warn("[CallEvents] Received call_started with invalid call data", data);
          return;
        }
        if (call.initiatorId === userRef.current?.id) {
          console.log("[CallEvents] Ignoring call_started from self");
          return;
        }
        if (activeCallRef.current) {
          console.log("[CallEvents] Ignoring call_started while already in a call");
          return;
        }

        if (!call.initiator || !call.initiator.firstName) {
          call.initiator = call.initiator || { id: call.initiatorId, firstName: "Unknown", lastName: "Caller", role: "" };
          if (!call.initiator.firstName) call.initiator.firstName = "Unknown";
          if (!call.initiator.lastName) call.initiator.lastName = "Caller";
        }

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
          .catch((err) => {
            console.error("[CallEvents] Failed to fetch conversations for call notification:", err);
            setConversationName("Video Call");
          });
      } catch (err) {
        console.error("[CallEvents] Error handling call_started event:", err);
      }
    };

    const handleCallEnded = (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data);
        setIncomingCall(prev => {
          if (prev?.id === data.callId) return null;
          return prev;
        });
        if (roomRef.current) {
          try {
            roomRef.current.disconnect();
          } catch (err) {
            console.warn("[CallEvents] Failed to disconnect room on call_ended:", err);
          }
        }
        updateActiveCall(prev => {
          if (prev?.id === data.callId) return null;
          return prev;
        });
      } catch (err) {
        console.error("[CallEvents] Error handling call_ended event:", err);
      }
    };

    const handleCallJoined = (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data);
        console.log(`[CallEvents] SSE call_joined received: userId=${data.userId}, callId=${data.callId}, userName=${data.userName}`);
        updateActiveCall(prev => {
          if (!prev || prev.id !== data.callId) {
            console.log(`[CallEvents] call_joined ignored: active call mismatch (active=${prev?.id}, event=${data.callId})`);
            return prev;
          }
          const alreadyIn = prev.participants.some((p: { userId: string }) => p.userId === data.userId);
          if (alreadyIn) {
            console.log(`[CallEvents] call_joined: user ${data.userId} already in participant list`);
            return prev;
          }
          const nameParts = (data.userName || "").split(" ");
          const newParticipant = {
            id: `temp-${data.userId}`,
            callId: data.callId,
            userId: data.userId,
            joinedAt: new Date().toISOString(),
            leftAt: null,
            user: {
              id: data.userId,
              firstName: nameParts[0] || "User",
              lastName: nameParts.slice(1).join(" ") || "",
              role: "",
            },
          };
          console.log(`[CallEvents] call_joined: adding participant ${data.userId} to call ${data.callId}`);
          return { ...prev, status: "ACTIVE" as const, participants: [...prev.participants, newParticipant] };
        });
      } catch (err) {
        console.error("[CallEvents] Error handling call_joined event:", err);
      }
    };

    const handleCallLeft = (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data);
        updateActiveCall(prev => {
          if (!prev || prev.id !== data.callId) return prev;
          return { ...prev, participants: prev.participants.filter((p: { userId: string }) => p.userId !== data.userId) };
        });
      } catch (err) {
        console.error("[CallEvents] Error handling call_left event:", err);
      }
    };

    addListener("call_started", handleCallStarted);
    addListener("call_ended", handleCallEnded);
    addListener("call_joined", handleCallJoined);
    addListener("call_left", handleCallLeft);

    return () => {
      removeListener("call_started", handleCallStarted);
      removeListener("call_ended", handleCallEnded);
      removeListener("call_joined", handleCallJoined);
      removeListener("call_left", handleCallLeft);
    };
  }, [user, isConnected, addListener, removeListener, updateActiveCall]);

  useEffect(() => {
    if (incomingCall) {
      if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current);
      dismissTimerRef.current = setTimeout(() => {
        console.log("[CallEvents] Auto-dismissing incoming call after timeout");
        setIncomingCall(null);
        setConversationName("");
      }, INCOMING_CALL_TIMEOUT_MS);
    } else {
      if (dismissTimerRef.current) {
        clearTimeout(dismissTimerRef.current);
        dismissTimerRef.current = null;
      }
    }
    return () => {
      if (dismissTimerRef.current) {
        clearTimeout(dismissTimerRef.current);
        dismissTimerRef.current = null;
      }
    };
  }, [incomingCall]);

  useEffect(() => {
    if (!user) return;

    const pollActiveCalls = async () => {
      try {
        const res = await fetch("/api/conversations/active-calls", { credentials: "include" });
        if (!res.ok) return;
        const calls: VideoCallData[] = await res.json();

        const ringingCalls = calls.filter(
          (c) => c.status === "RINGING" && c.initiatorId !== userRef.current?.id
        );

        if (ringingCalls.length > 0 && !activeCallRef.current) {
          const call = ringingCalls[0];
          if (!lastPolledCallIdsRef.current.has(call.id)) {
            lastPolledCallIdsRef.current.add(call.id);

            if (!call.initiator || !call.initiator.firstName) {
              call.initiator = call.initiator || { id: call.initiatorId, firstName: "Unknown", lastName: "Caller", role: "" };
              if (!call.initiator.firstName) call.initiator.firstName = "Unknown";
              if (!call.initiator.lastName) call.initiator.lastName = "Caller";
            }

            setIncomingCall((prev) => {
              if (prev) return prev;
              console.log("[CallEvents] Detected ringing call via polling:", call.id);
              return call;
            });

            fetch("/api/conversations", { credentials: "include" })
              .then((r) => (r.ok ? r.json() : []))
              .then((convs: Conversation[]) => {
                const conv = convs.find((c) => c.id === call.conversationId);
                if (conv) {
                  if (conv.isCompanyChannel) setConversationName("Company Chat");
                  else if (conv.name) setConversationName(conv.name);
                  else if (conv.type === "DIRECT") {
                    const other = conv.participants.find((p) => p.userId !== userRef.current?.id);
                    if (other) setConversationName(`${other.user.firstName} ${other.user.lastName}`);
                    else setConversationName("Direct Message");
                  } else setConversationName("Group Conversation");
                } else {
                  setConversationName("Video Call");
                }
              })
              .catch(() => setConversationName("Video Call"));
          }
        }

        const activeCallIds = new Set(calls.map((c) => c.id));
        for (const id of lastPolledCallIdsRef.current) {
          if (!activeCallIds.has(id)) {
            lastPolledCallIdsRef.current.delete(id);
          }
        }
      } catch (err) {
        console.error("[CallEvents] Polling active calls failed:", err);
      }
    };

    const isOnMessagingPage = MESSAGING_PATHS.some(p => locationRef.current.startsWith(p));
    const hasActiveCall = !!activeCall;
    const pollInterval = isOnMessagingPage || hasActiveCall
      ? ACTIVE_CALLS_POLL_INTERVAL_MS
      : IDLE_CALLS_POLL_INTERVAL_MS;

    const interval = setInterval(pollActiveCalls, pollInterval);
    pollActiveCalls();

    return () => clearInterval(interval);
  }, [user, location, activeCall]);

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
