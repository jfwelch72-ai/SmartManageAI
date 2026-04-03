import { createContext, useContext, useState, useRef, useCallback, type ReactNode } from "react";
import type { VideoCallData, Conversation } from "@/components/messaging/types";
import { apiRequest } from "@/lib/queryClient";

interface GlobalVideoCallContextType {
  activeCall: VideoCallData | null;
  activeCallConversation: Conversation | null;
  startGlobalCall: (call: VideoCallData, conversation: Conversation) => void;
  endGlobalCall: () => Promise<void>;
  leaveGlobalCall: () => Promise<void>;
  clearGlobalCall: () => void;
  updateActiveCall: (updater: (prev: VideoCallData | null) => VideoCallData | null) => void;
}

const GlobalVideoCallContext = createContext<GlobalVideoCallContextType | null>(null);

export function GlobalVideoCallProvider({ children }: { children: ReactNode }) {
  const [activeCall, setActiveCall] = useState<VideoCallData | null>(null);
  const [activeCallConversation, setActiveCallConversation] = useState<Conversation | null>(null);
  const activeCallRef = useRef<VideoCallData | null>(null);

  const updateActiveCallRef = (call: VideoCallData | null) => {
    activeCallRef.current = call;
    setActiveCall(call);
  };

  const startGlobalCall = useCallback((call: VideoCallData, conversation: Conversation) => {
    updateActiveCallRef(call);
    setActiveCallConversation(conversation);
  }, []);

  const endGlobalCall = useCallback(async () => {
    const call = activeCallRef.current;
    if (!call) return;
    try {
      await apiRequest("POST", `/api/calls/${call.id}/end`);
    } catch (err) {
      console.error("Failed to end call:", err);
    }
    updateActiveCallRef(null);
    setActiveCallConversation(null);
  }, []);

  const leaveGlobalCall = useCallback(async () => {
    const call = activeCallRef.current;
    if (!call) return;
    try {
      await apiRequest("POST", `/api/calls/${call.id}/leave`);
    } catch (err) {
      console.error("Failed to leave call:", err);
    }
    updateActiveCallRef(null);
    setActiveCallConversation(null);
  }, []);

  const clearGlobalCall = useCallback(() => {
    updateActiveCallRef(null);
    setActiveCallConversation(null);
  }, []);

  const updateActiveCall = useCallback((updater: (prev: VideoCallData | null) => VideoCallData | null) => {
    setActiveCall(prev => {
      const next = updater(prev);
      activeCallRef.current = next;
      if (next === null) {
        setActiveCallConversation(null);
      }
      return next;
    });
  }, []);

  return (
    <GlobalVideoCallContext.Provider value={{
      activeCall,
      activeCallConversation,
      startGlobalCall,
      endGlobalCall,
      leaveGlobalCall,
      clearGlobalCall,
      updateActiveCall,
    }}>
      {children}
    </GlobalVideoCallContext.Provider>
  );
}

export function useGlobalVideoCall() {
  const ctx = useContext(GlobalVideoCallContext);
  if (!ctx) throw new Error("useGlobalVideoCall must be used within GlobalVideoCallProvider");
  return ctx;
}
