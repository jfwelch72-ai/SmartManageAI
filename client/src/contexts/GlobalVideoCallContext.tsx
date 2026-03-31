import { createContext, useContext, useState, useRef, useCallback, type ReactNode } from "react";
import type { VideoCallData, Conversation } from "@/components/messaging/types";
import { apiRequest } from "@/lib/queryClient";

interface WebRTCSignalData {
  callId: string;
  fromUserId: string;
  signal: unknown;
}

type SignalHandler = (fromUserId: string, signal: unknown) => void;

interface GlobalVideoCallContextType {
  activeCall: VideoCallData | null;
  activeCallConversation: Conversation | null;
  startGlobalCall: (call: VideoCallData, conversation: Conversation) => void;
  endGlobalCall: () => Promise<void>;
  leaveGlobalCall: () => Promise<void>;
  clearGlobalCall: () => void;
  updateActiveCall: (updater: (prev: VideoCallData | null) => VideoCallData | null) => void;
  registerSignalHandler: (handler: SignalHandler) => void;
  unregisterSignalHandler: () => void;
  dispatchSignal: (data: WebRTCSignalData) => void;
}

const GlobalVideoCallContext = createContext<GlobalVideoCallContextType | null>(null);

export function GlobalVideoCallProvider({ children }: { children: ReactNode }) {
  const [activeCall, setActiveCall] = useState<VideoCallData | null>(null);
  const [activeCallConversation, setActiveCallConversation] = useState<Conversation | null>(null);
  const signalHandlerRef = useRef<SignalHandler | null>(null);
  const activeCallRef = useRef<VideoCallData | null>(null);
  const signalQueueRef = useRef<WebRTCSignalData[]>([]);

  const updateActiveCallRef = (call: VideoCallData | null) => {
    activeCallRef.current = call;
    setActiveCall(call);
  };

  const flushSignalQueue = useCallback(() => {
    const handler = signalHandlerRef.current;
    const callId = activeCallRef.current?.id;
    if (!handler || !callId) return;
    const queued = signalQueueRef.current.filter(s => s.callId === callId);
    signalQueueRef.current = [];
    for (const s of queued) {
      handler(s.fromUserId, s.signal);
    }
  }, []);

  const startGlobalCall = useCallback((call: VideoCallData, conversation: Conversation) => {
    updateActiveCallRef(call);
    setActiveCallConversation(conversation);
    if (signalHandlerRef.current) {
      setTimeout(flushSignalQueue, 0);
    }
  }, [flushSignalQueue]);

  const endGlobalCall = useCallback(async () => {
    const call = activeCallRef.current;
    if (!call) return;
    try {
      await apiRequest("POST", `/api/calls/${call.id}/end`);
    } catch (err) {
      console.error("Failed to end call:", err);
    }
    signalQueueRef.current = [];
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
    signalQueueRef.current = [];
    updateActiveCallRef(null);
    setActiveCallConversation(null);
  }, []);

  const clearGlobalCall = useCallback(() => {
    signalQueueRef.current = [];
    updateActiveCallRef(null);
    setActiveCallConversation(null);
  }, []);

  const updateActiveCall = useCallback((updater: (prev: VideoCallData | null) => VideoCallData | null) => {
    setActiveCall(prev => {
      const next = updater(prev);
      activeCallRef.current = next;
      if (next === null) {
        signalQueueRef.current = [];
        setActiveCallConversation(null);
      }
      return next;
    });
  }, []);

  const registerSignalHandler = useCallback((handler: SignalHandler) => {
    signalHandlerRef.current = handler;
    setTimeout(flushSignalQueue, 0);
  }, [flushSignalQueue]);

  const unregisterSignalHandler = useCallback(() => {
    signalHandlerRef.current = null;
  }, []);

  const dispatchSignal = useCallback((data: WebRTCSignalData) => {
    if (signalHandlerRef.current && activeCallRef.current?.id === data.callId) {
      signalHandlerRef.current(data.fromUserId, data.signal);
    } else if (activeCallRef.current?.id === data.callId || !activeCallRef.current) {
      signalQueueRef.current.push(data);
    }
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
      registerSignalHandler,
      unregisterSignalHandler,
      dispatchSignal,
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
