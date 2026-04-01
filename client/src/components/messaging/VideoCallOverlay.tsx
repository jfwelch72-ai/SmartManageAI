import { useState, useEffect, useRef, useCallback } from "react";
import {
  Video, VideoOff, Mic, MicOff, MonitorUp, PhoneOff,
  FileText, Users, Maximize2, Minimize2, Clock, Loader2, WifiOff, RefreshCw
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { apiRequest } from "@/lib/queryClient";
import { CallNotesPanel } from "./CallNotesPanel";
import { getInitials, type VideoCallData, type Conversation } from "./types";
import { cn } from "@/lib/utils";

const FALLBACK_ICE_SERVERS: RTCConfiguration = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
    { urls: "stun:stun2.l.google.com:19302" },
    { urls: "stun:stun3.l.google.com:19302" },
    { urls: "stun:stun4.l.google.com:19302" },
  ],
};

const ICE_RETRY_BACKOFF = [1000, 3000, 5000];
const MAX_ICE_RETRIES = 3;

interface SignalMessage {
  type: "offer" | "answer" | "ice-candidate" | "camera-state";
  sdp?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit;
  cameraOff?: boolean;
}

interface VideoCallOverlayProps {
  call: VideoCallData;
  conversation: Conversation;
  currentUserId: string;
  onEndCall: () => void;
  onLeaveCall: () => void;
  registerSignalHandler?: (handler: (fromUserId: string, signal: unknown) => void) => void;
  unregisterSignalHandler?: () => void;
}

export function VideoCallOverlay({
  call,
  conversation,
  currentUserId,
  onEndCall,
  onLeaveCall,
  registerSignalHandler,
  unregisterSignalHandler,
}: VideoCallOverlayProps) {
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(false);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [showNotes, setShowNotes] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [callDuration, setCallDuration] = useState(0);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStreams, setRemoteStreams] = useState<Record<string, MediaStream>>({});
  const [remoteCameraOff, setRemoteCameraOff] = useState<Record<string, boolean>>({});
  const [peerStates, setPeerStates] = useState<Record<string, RTCIceConnectionState | "retrying" | "checking_slow" | "peer_unreachable">>({});
  const [iceConfig, setIceConfig] = useState<RTCConfiguration>(FALLBACK_ICE_SERVERS);

  const localVideoRef = useRef<HTMLVideoElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const durationTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const peerConnectionsRef = useRef<Record<string, RTCPeerConnection>>({});
  const localStreamRef = useRef<MediaStream | null>(null);
  const pendingCandidatesRef = useRef<Record<string, RTCIceCandidateInit[]>>({});
  const makingOfferRef = useRef<Record<string, boolean>>({});
  const deferredConnectionsRef = useRef<Set<string>>(new Set());
  const deferredOffersRef = useRef<Record<string, RTCSessionDescriptionInit>>({});
  const iceTimeoutRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const retryCountRef = useRef<Record<string, number>>({});
  const iceConfigRef = useRef<RTCConfiguration>(FALLBACK_ICE_SERVERS);
  const signalHandlerRegisteredRef = useRef(false);
  const [noTurnServers, setNoTurnServers] = useState(false);

  useEffect(() => {
    const startTime = new Date(call.startedAt).getTime();
    durationTimerRef.current = setInterval(() => {
      setCallDuration(Math.floor((Date.now() - startTime) / 1000));
    }, 1000);
    return () => {
      if (durationTimerRef.current) clearInterval(durationTimerRef.current);
    };
  }, [call.startedAt]);

  useEffect(() => {
    let stream: MediaStream | null = null;
    const initMedia = async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        setLocalStream(stream);
        localStreamRef.current = stream;
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = stream;
        }
      } catch (err) {
        console.error("Failed to access media devices:", err);
        try {
          stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          setLocalStream(stream);
          localStreamRef.current = stream;
          setIsVideoOff(true);
        } catch (audioErr) {
          console.error("Failed to access audio:", audioErr);
        }
      }
    };
    initMedia();
    return () => {
      stream?.getTracks().forEach(t => t.stop());
    };
  }, []);

  useEffect(() => {
    if (localVideoRef.current && localStream) {
      localVideoRef.current.srcObject = localStream;
    }
  }, [localStream]);

  useEffect(() => {
    fetch("/api/calls/ice-config", { credentials: "include" })
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        if (data?.iceServers) {
          const config: RTCConfiguration = { iceServers: data.iceServers };
          setIceConfig(config);
          iceConfigRef.current = config;
          const turnCount = data.iceServers.filter((s: { urls: string | string[] }) => {
            const urls = Array.isArray(s.urls) ? s.urls : [s.urls];
            return urls.some((u: string) => u.startsWith("turn:") || u.startsWith("turns:"));
          }).length;
          console.log(`[WebRTC] Loaded ICE config: ${data.iceServers.length} servers (${turnCount} TURN)`);
          if (turnCount === 0) {
            console.warn("[WebRTC] No TURN servers configured. Calls may fail behind restrictive NATs. Set TURN_SERVER_URL, TURN_SERVER_USERNAME, TURN_SERVER_CREDENTIAL env vars to enable TURN relay.");
            setNoTurnServers(true);
          } else {
            setNoTurnServers(false);
          }
        } else {
          setNoTurnServers(true);
        }
      })
      .catch(err => {
        console.warn("[WebRTC] Failed to fetch ICE config, using STUN-only fallback:", err);
        setNoTurnServers(true);
      });
  }, []);

  const sendSignal = useCallback(async (targetUserId: string, signal: unknown) => {
    try {
      const res = await apiRequest("POST", `/api/calls/${call.id}/signal`, {
        targetUserId,
        signal,
      });
      const data = await res.json();
      if (data.delivered === false) {
        console.warn(`[WebRTC] Signal not delivered to ${targetUserId}: ${data.reason}`);
        const signalObj = signal as SignalMessage;
        if (signalObj.type === "offer") {
          setPeerStates(prev => ({ ...prev, [targetUserId]: "peer_unreachable" }));
        }
      }
    } catch (err) {
      console.error("Failed to send signal:", err);
    }
  }, [call.id]);

  const createPeerConnection = useCallback((remoteUserId: string, overrideConfig?: RTCConfiguration): RTCPeerConnection => {
    if (peerConnectionsRef.current[remoteUserId]) {
      peerConnectionsRef.current[remoteUserId].close();
    }

    const pc = new RTCPeerConnection(overrideConfig || iceConfigRef.current);
    peerConnectionsRef.current[remoteUserId] = pc;

    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => {
        pc.addTrack(track, localStreamRef.current!);
      });
    }

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        sendSignal(remoteUserId, { type: "ice-candidate", candidate: event.candidate.toJSON() });
      }
    };

    pc.ontrack = (event) => {
      let remoteStream = event.streams[0];
      if (!remoteStream) {
        remoteStream = new MediaStream();
        remoteStream.addTrack(event.track);
      }
      setRemoteStreams(prev => {
        const existing = prev[remoteUserId];
        if (existing && event.streams[0]) {
          return { ...prev, [remoteUserId]: event.streams[0] };
        }
        if (existing && !event.streams[0]) {
          const hasTrack = existing.getTracks().some(t => t.id === event.track.id);
          if (!hasTrack) {
            existing.addTrack(event.track);
          }
          return { ...prev, [remoteUserId]: new MediaStream(existing.getTracks()) };
        }
        return { ...prev, [remoteUserId]: remoteStream };
      });
    };

    pc.oniceconnectionstatechange = () => {
      const state = pc.iceConnectionState;
      console.log(`[WebRTC] ICE state for ${remoteUserId}: ${state}`);
      setPeerStates(prev => ({ ...prev, [remoteUserId]: state }));

      if (state === "connected" || state === "completed") {
        if (iceTimeoutRef.current[remoteUserId]) {
          clearTimeout(iceTimeoutRef.current[remoteUserId]);
          delete iceTimeoutRef.current[remoteUserId];
        }
        if (iceTimeoutRef.current[`${remoteUserId}_slow`]) {
          clearTimeout(iceTimeoutRef.current[`${remoteUserId}_slow`]);
          delete iceTimeoutRef.current[`${remoteUserId}_slow`];
        }
        retryCountRef.current[remoteUserId] = 0;
      }

      if (state === "failed") {
        if (iceTimeoutRef.current[remoteUserId]) {
          clearTimeout(iceTimeoutRef.current[remoteUserId]);
          delete iceTimeoutRef.current[remoteUserId];
        }
        const retries = retryCountRef.current[remoteUserId] || 0;
        if (retries < MAX_ICE_RETRIES) {
          retryCountRef.current[remoteUserId] = retries + 1;
          const backoffMs = ICE_RETRY_BACKOFF[retries] || ICE_RETRY_BACKOFF[ICE_RETRY_BACKOFF.length - 1];
          console.log(`[WebRTC] Auto-retrying connection to ${remoteUserId} (attempt ${retries + 2}/${MAX_ICE_RETRIES + 1}, backoff ${backoffMs}ms)`);
          setPeerStates(prev => ({ ...prev, [remoteUserId]: "retrying" }));
          setTimeout(() => {
            retryConnection(remoteUserId);
          }, backoffMs);
        } else {
          setRemoteStreams(prev => {
            const next = { ...prev };
            delete next[remoteUserId];
            return next;
          });
        }
      } else if (state === "disconnected") {
        if (iceTimeoutRef.current[remoteUserId]) {
          clearTimeout(iceTimeoutRef.current[remoteUserId]);
          delete iceTimeoutRef.current[remoteUserId];
        }
        iceTimeoutRef.current[remoteUserId] = setTimeout(() => {
          if (pc.iceConnectionState === "disconnected") {
            console.warn(`[WebRTC] ICE disconnected timeout for ${remoteUserId}, removing stream`);
            setRemoteStreams(prev => {
              const next = { ...prev };
              delete next[remoteUserId];
              return next;
            });
          }
        }, 5000);
      }

      if (state === "checking") {
        iceTimeoutRef.current[`${remoteUserId}_slow`] = setTimeout(() => {
          if (pc.iceConnectionState === "checking") {
            console.warn(`[WebRTC] ICE connection to ${remoteUserId} taking longer than expected`);
            setPeerStates(prev => ({ ...prev, [remoteUserId]: "checking_slow" }));
          }
        }, 5000);
        iceTimeoutRef.current[remoteUserId] = setTimeout(() => {
          if (pc.iceConnectionState === "checking") {
            console.warn(`[WebRTC] ICE checking timeout for ${remoteUserId}`);
            pc.close();
            setPeerStates(prev => ({ ...prev, [remoteUserId]: "failed" }));
          }
        }, 15000);
      }
    };

    return pc;
  }, [sendSignal]);

  const flushPendingCandidates = useCallback(async (remoteUserId: string) => {
    const pc = peerConnectionsRef.current[remoteUserId];
    const pending = pendingCandidatesRef.current[remoteUserId];
    if (pc && pending && pending.length > 0) {
      delete pendingCandidatesRef.current[remoteUserId];
      for (const candidate of pending) {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(candidate));
        } catch {}
      }
    }
  }, []);

  const initiateConnection = useCallback(async (remoteUserId: string) => {
    if (!localStreamRef.current) {
      console.log(`[WebRTC] Deferring connection to ${remoteUserId} — local stream not ready`);
      deferredConnectionsRef.current.add(remoteUserId);
      return;
    }
    if (makingOfferRef.current[remoteUserId]) return;
    makingOfferRef.current[remoteUserId] = true;

    try {
      console.log(`[WebRTC] Creating offer for ${remoteUserId}`);
      setPeerStates(prev => ({ ...prev, [remoteUserId]: "new" }));
      const pc = createPeerConnection(remoteUserId);
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await sendSignal(remoteUserId, { type: "offer", sdp: pc.localDescription });
      console.log(`[WebRTC] Offer sent to ${remoteUserId}`);
    } catch (err) {
      console.error("[WebRTC] Failed to create offer:", err);
    } finally {
      makingOfferRef.current[remoteUserId] = false;
    }
  }, [createPeerConnection, sendSignal]);

  const retryConnection = useCallback(async (remoteUserId: string) => {
    if (!localStreamRef.current) return;
    makingOfferRef.current[remoteUserId] = false;

    try {
      const currentConfig = iceConfigRef.current;
      const hasTurnServers = currentConfig.iceServers?.some(
        (s) => {
          const urls = Array.isArray(s.urls) ? s.urls : [s.urls];
          return urls.some(u => u.startsWith("turn:") || u.startsWith("turns:"));
        }
      );

      const retryCount = retryCountRef.current[remoteUserId] || 0;
      const useRelayOnly = retryCount === 1 && hasTurnServers;

      const retryConfig: RTCConfiguration = {
        ...currentConfig,
        iceCandidatePoolSize: 4,
        bundlePolicy: "max-bundle",
        ...(useRelayOnly ? { iceTransportPolicy: "relay" } : {}),
      };

      console.log(`[WebRTC] Retrying connection to ${remoteUserId} (attempt ${retryCount}, relay-only: ${useRelayOnly})`);
      setPeerStates(prev => ({ ...prev, [remoteUserId]: "retrying" }));
      const pc = createPeerConnection(remoteUserId, retryConfig);
      const offer = await pc.createOffer({ iceRestart: true });
      await pc.setLocalDescription(offer);
      await sendSignal(remoteUserId, { type: "offer", sdp: pc.localDescription });
      console.log(`[WebRTC] Retry offer sent to ${remoteUserId}`);
    } catch (err) {
      console.error("[WebRTC] Retry failed:", err);
      setPeerStates(prev => ({ ...prev, [remoteUserId]: "failed" }));
    }
  }, [createPeerConnection, sendSignal]);

  const handleRetryConnection = useCallback((remoteUserId: string) => {
    retryCountRef.current[remoteUserId] = 0;
    retryConnection(remoteUserId);
  }, [retryConnection]);

  const handleSignal = useCallback(async (fromUserId: string, signal: SignalMessage) => {
    if (fromUserId === currentUserId) return;

    if (signal.type === "camera-state") {
      setRemoteCameraOff(prev => ({ ...prev, [fromUserId]: !!signal.cameraOff }));
      return;
    }

    if (signal.type === "offer") {
      if (!localStreamRef.current) {
        console.log(`[WebRTC] Received offer from ${fromUserId} but local stream not ready, deferring`);
        deferredOffersRef.current[fromUserId] = signal.sdp!;
        return;
      }

      const existingPc = peerConnectionsRef.current[fromUserId];
      const isPolite = currentUserId < fromUserId;

      if (existingPc && existingPc.signalingState === "have-local-offer") {
        if (!isPolite) {
          console.log(`[WebRTC] Glare: impolite peer ignoring offer from ${fromUserId}`);
          return;
        }
        console.log(`[WebRTC] Glare: polite peer rolling back for ${fromUserId}`);
      }

      console.log(`[WebRTC] Handling offer from ${fromUserId}`);
      const pc = existingPc && isPolite && existingPc.signalingState === "have-local-offer"
        ? existingPc
        : createPeerConnection(fromUserId);
      try {
        if (pc.signalingState === "have-local-offer") {
          await pc.setLocalDescription({ type: "rollback" });
        }
        await pc.setRemoteDescription(new RTCSessionDescription(signal.sdp!));
        await flushPendingCandidates(fromUserId);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        await sendSignal(fromUserId, { type: "answer", sdp: pc.localDescription });
        console.log(`[WebRTC] Answer sent to ${fromUserId}`);
      } catch (err) {
        console.error("[WebRTC] Failed to handle offer:", err);
      }
    } else if (signal.type === "answer") {
      const pc = peerConnectionsRef.current[fromUserId];
      if (pc) {
        try {
          await pc.setRemoteDescription(new RTCSessionDescription(signal.sdp!));
          await flushPendingCandidates(fromUserId);
        } catch (err) {
          console.error("Failed to handle answer:", err);
        }
      }
    } else if (signal.type === "ice-candidate") {
      const pc = peerConnectionsRef.current[fromUserId];
      if (pc && pc.remoteDescription) {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(signal.candidate!));
        } catch (err) {
          console.error("Failed to add ICE candidate:", err);
        }
      } else {
        if (!pendingCandidatesRef.current[fromUserId]) {
          pendingCandidatesRef.current[fromUserId] = [];
        }
        pendingCandidatesRef.current[fromUserId].push(signal.candidate!);
      }
    }
  }, [currentUserId, createPeerConnection, sendSignal, flushPendingCandidates]);

  const handleSignalRef = useRef(handleSignal);
  useEffect(() => { handleSignalRef.current = handleSignal; }, [handleSignal]);

  const processDeferredItems = useCallback(() => {
    if (!localStreamRef.current || !signalHandlerRegisteredRef.current) return;

    const deferredOffers = { ...deferredOffersRef.current };
    deferredOffersRef.current = {};
    const deferredOfferUserIds = Object.keys(deferredOffers);
    if (deferredOfferUserIds.length > 0) {
      console.log(`[WebRTC] Processing ${deferredOfferUserIds.length} deferred offer(s)`);
      for (const userId of deferredOfferUserIds) {
        const sdp = deferredOffers[userId];
        const pc = createPeerConnection(userId);
        pc.setRemoteDescription(new RTCSessionDescription(sdp))
          .then(() => flushPendingCandidates(userId))
          .then(() => pc.createAnswer())
          .then(answer => pc.setLocalDescription(answer))
          .then(() => sendSignal(userId, { type: "answer", sdp: pc.localDescription }))
          .then(() => console.log(`[WebRTC] Deferred answer sent to ${userId}`))
          .catch(err => console.error(`[WebRTC] Failed to process deferred offer from ${userId}:`, err));
      }
    }

    const deferred = Array.from(deferredConnectionsRef.current);
    if (deferred.length > 0) {
      console.log(`[WebRTC] Processing ${deferred.length} deferred connection(s)`);
      deferredConnectionsRef.current.clear();
      for (const userId of deferred) {
        initiateConnection(userId);
      }
    }
  }, [createPeerConnection, flushPendingCandidates, sendSignal, initiateConnection]);

  useEffect(() => {
    if (!registerSignalHandler || !unregisterSignalHandler) return;
    const handler = (fromUserId: string, signal: unknown) => {
      handleSignalRef.current(fromUserId, signal as SignalMessage);
    };
    registerSignalHandler(handler);
    signalHandlerRegisteredRef.current = true;
    processDeferredItems();
    return () => {
      unregisterSignalHandler();
      signalHandlerRegisteredRef.current = false;
    };
  }, [registerSignalHandler, unregisterSignalHandler, processDeferredItems]);

  useEffect(() => {
    if (!localStreamRef.current) return;

    processDeferredItems();

    const activeParticipants = call.participants.filter(p => !p.leftAt && p.userId !== currentUserId);
    for (const participant of activeParticipants) {
      const existingPc = peerConnectionsRef.current[participant.userId];
      if (existingPc) {
        const hasSenders = existingPc.getSenders().some(s => s.track !== null);
        if (!hasSenders) {
          localStreamRef.current.getTracks().forEach(track => {
            existingPc.addTrack(track, localStreamRef.current!);
          });
          existingPc.createOffer()
            .then(offer => existingPc.setLocalDescription(offer))
            .then(() => sendSignal(participant.userId, { type: "offer", sdp: existingPc.localDescription }))
            .catch(err => console.error("[WebRTC] Renegotiation failed:", err));
        }
      } else {
        initiateConnection(participant.userId);
      }
    }
  }, [call.participants, currentUserId, localStream, initiateConnection, sendSignal, createPeerConnection, flushPendingCandidates, processDeferredItems]);

  useEffect(() => {
    return () => {
      Object.values(peerConnectionsRef.current).forEach(pc => pc.close());
      peerConnectionsRef.current = {};
      Object.values(iceTimeoutRef.current).forEach(t => clearTimeout(t));
      iceTimeoutRef.current = {};
    };
  }, []);

  const toggleMute = useCallback(() => {
    if (localStream) {
      localStream.getAudioTracks().forEach(t => { t.enabled = !t.enabled; });
      setIsMuted(prev => !prev);
    }
  }, [localStream]);

  const toggleVideo = useCallback(() => {
    if (localStream) {
      const newState = !isVideoOff;
      localStream.getVideoTracks().forEach(t => { t.enabled = !newState; });
      setIsVideoOff(newState);
      const otherParticipants = call.participants.filter(p => !p.leftAt && p.userId !== currentUserId);
      for (const p of otherParticipants) {
        sendSignal(p.userId, { type: "camera-state", cameraOff: newState });
      }
    }
  }, [localStream, isVideoOff, call.participants, currentUserId, sendSignal]);

  const toggleScreenShare = useCallback(async () => {
    if (isScreenSharing) {
      localStream?.getVideoTracks().forEach(t => t.stop());
      try {
        const newStream = await navigator.mediaDevices.getUserMedia({ video: true });
        const newVideoTrack = newStream.getVideoTracks()[0];
        if (localStream && newVideoTrack) {
          const oldVideoTrack = localStream.getVideoTracks()[0];
          if (oldVideoTrack) localStream.removeTrack(oldVideoTrack);
          localStream.addTrack(newVideoTrack);
          Object.entries(peerConnectionsRef.current).forEach(([, pc]) => {
            const sender = pc.getSenders().find(s => s.track?.kind === "video");
            if (sender) sender.replaceTrack(newVideoTrack);
          });
        }
        if (localVideoRef.current) localVideoRef.current.srcObject = localStream;
      } catch {}
      setIsScreenSharing(false);
    } else {
      try {
        const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
        const screenTrack = screenStream.getVideoTracks()[0];
        if (localStream && screenTrack) {
          const oldVideoTrack = localStream.getVideoTracks()[0];
          if (oldVideoTrack) {
            oldVideoTrack.stop();
            localStream.removeTrack(oldVideoTrack);
          }
          localStream.addTrack(screenTrack);
          Object.entries(peerConnectionsRef.current).forEach(([, pc]) => {
            const sender = pc.getSenders().find(s => s.track?.kind === "video");
            if (sender) sender.replaceTrack(screenTrack);
          });
          screenTrack.onended = () => {
            setIsScreenSharing(false);
          };
        }
        if (localVideoRef.current) localVideoRef.current.srcObject = localStream;
        setIsScreenSharing(true);
      } catch {}
    }
  }, [isScreenSharing, localStream]);

  const toggleFullscreen = useCallback(() => {
    if (!overlayRef.current) return;
    if (!document.fullscreenElement) {
      overlayRef.current.requestFullscreen().then(() => setIsFullscreen(true)).catch(() => {});
    } else {
      document.exitFullscreen().then(() => setIsFullscreen(false)).catch(() => {});
    }
  }, []);

  const handleEndCall = () => {
    Object.values(peerConnectionsRef.current).forEach(pc => pc.close());
    peerConnectionsRef.current = {};
    localStream?.getTracks().forEach(t => t.stop());
    onEndCall();
  };

  const handleLeaveCall = () => {
    Object.values(peerConnectionsRef.current).forEach(pc => pc.close());
    peerConnectionsRef.current = {};
    localStream?.getTracks().forEach(t => t.stop());
    onLeaveCall();
  };

  const formatDuration = (seconds: number) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
    return `${m}:${String(s).padStart(2, "0")}`;
  };

  const getConversationName = () => {
    if (conversation.isCompanyChannel) return "Company Chat";
    if (conversation.name) return conversation.name;
    if (conversation.type === "DIRECT") {
      const other = conversation.participants.find(p => p.userId !== currentUserId);
      if (other) return `${other.user.firstName} ${other.user.lastName}`;
    }
    return "Video Call";
  };

  const activeParticipants = call.participants.filter(p => !p.leftAt);
  const otherParticipants = activeParticipants.filter(p => p.userId !== currentUserId);
  const isInitiator = call.initiatorId === currentUserId;

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 bg-gray-900 flex flex-col"
      data-testid="video-call-overlay"
    >
      <div className="flex items-center justify-between px-4 py-2 bg-gray-800/80">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 text-white">
            <Video className="w-4 h-4 text-green-400" />
            <span className="text-sm font-medium">{getConversationName()}</span>
          </div>
          <div className="flex items-center gap-1 text-gray-400 text-xs">
            <Clock className="w-3 h-3" />
            <span data-testid="text-call-duration">{formatDuration(callDuration)}</span>
          </div>
          <div className="flex items-center gap-1 text-gray-400 text-xs">
            <Users className="w-3 h-3" />
            <span data-testid="text-participant-count">{activeParticipants.length}</span>
          </div>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-gray-400 hover:text-white"
          onClick={toggleFullscreen}
          data-testid="button-fullscreen"
        >
          {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
        </Button>
      </div>

      <div className="flex flex-1 min-h-0">
        <div className="flex-1 p-4 flex flex-col">
          <div className={cn(
            "flex-1 grid gap-3",
            otherParticipants.length === 0 && "grid-cols-1",
            otherParticipants.length === 1 && "grid-cols-1",
            otherParticipants.length >= 2 && otherParticipants.length <= 4 && "grid-cols-2",
            otherParticipants.length > 4 && "grid-cols-3",
          )}>
            {otherParticipants.length === 0 && (
              <div className="flex items-center justify-center rounded-xl bg-gray-800 border border-gray-700">
                <div className="text-center">
                  <div className="w-20 h-20 rounded-full bg-gray-700 flex items-center justify-center mx-auto mb-3">
                    <Users className="w-10 h-10 text-gray-500" />
                  </div>
                  <p className="text-gray-400 text-sm">Waiting for others to join...</p>
                </div>
              </div>
            )}
            {otherParticipants.map(p => {
              const remoteStream = remoteStreams[p.userId];
              const peerCameraOff = remoteCameraOff[p.userId] ?? false;
              const iceState = peerStates[p.userId];
              const isRetrying = iceState === "retrying";
              const isCheckingSlow = iceState === "checking_slow";
              const isConnecting = iceState === "new" || iceState === "checking" || isCheckingSlow;
              const isFailed = iceState === "failed";
              const isPeerUnreachable = iceState === "peer_unreachable";
              return (
                <div
                  key={p.userId}
                  className="relative rounded-xl bg-gray-800 border border-gray-700 flex items-center justify-center overflow-hidden"
                  data-testid={`video-feed-${p.userId}`}
                >
                  {isPeerUnreachable ? (
                    <div className="flex flex-col items-center gap-2 text-center px-4">
                      <WifiOff className="w-10 h-10 text-amber-400" />
                      <p className="text-amber-400 text-sm font-medium" data-testid="text-peer-unreachable">Peer unreachable</p>
                      <p className="text-gray-500 text-xs">The other participant may not be connected yet. Retrying automatically...</p>
                      <Button
                        variant="secondary"
                        size="sm"
                        className="mt-2 gap-1.5"
                        onClick={() => handleRetryConnection(p.userId)}
                        data-testid={`button-retry-unreachable-${p.userId}`}
                      >
                        <RefreshCw className="w-3.5 h-3.5" />
                        Retry Now
                      </Button>
                    </div>
                  ) : isFailed ? (
                    <div className="flex flex-col items-center gap-2 text-center px-4">
                      <WifiOff className="w-10 h-10 text-red-400" />
                      <p className="text-red-400 text-sm font-medium" data-testid="text-connection-failed">Connection failed</p>
                      <p className="text-gray-500 text-xs">
                        {noTurnServers
                          ? "A relay (TURN) server is needed but not configured. Direct connection could not be established."
                          : "This may be due to network restrictions or firewall settings"}
                      </p>
                      <Button
                        variant="secondary"
                        size="sm"
                        className="mt-2 gap-1.5"
                        onClick={() => handleRetryConnection(p.userId)}
                        data-testid={`button-retry-connection-${p.userId}`}
                      >
                        <RefreshCw className="w-3.5 h-3.5" />
                        Retry
                      </Button>
                    </div>
                  ) : remoteStream && !peerCameraOff && remoteStream.getVideoTracks().length > 0 ? (
                    <RemoteVideo stream={remoteStream} participant={p} />
                  ) : isRetrying ? (
                    <div className="flex flex-col items-center gap-2">
                      <RefreshCw className="w-10 h-10 text-amber-400 animate-spin" />
                      <p className="text-amber-400 text-sm" data-testid="text-retrying">Retrying connection...</p>
                    </div>
                  ) : isConnecting ? (
                    <div className="flex flex-col items-center gap-2">
                      <Loader2 className="w-10 h-10 text-blue-400 animate-spin" />
                      <p className="text-blue-400 text-sm" data-testid="text-connecting">Connecting...</p>
                      {isCheckingSlow && (
                        <p className="text-amber-400 text-xs" data-testid="text-slow-connection">Taking longer than expected...</p>
                      )}
                    </div>
                  ) : (
                    <Avatar className="h-20 w-20">
                      <AvatarFallback className="text-2xl bg-gray-700 text-gray-300">
                        {getInitials(p.user?.firstName ?? "", p.user?.lastName ?? "")}
                      </AvatarFallback>
                    </Avatar>
                  )}
                  <div className="absolute bottom-2 left-2 bg-black/60 rounded px-2 py-0.5 text-xs text-white">
                    {p.user?.firstName ?? ""} {p.user?.lastName ?? ""}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="mt-3 flex justify-end">
            <div className="relative w-48 h-36 rounded-lg overflow-hidden bg-gray-800 border border-gray-700">
              {isVideoOff ? (
                <div className="flex items-center justify-center h-full">
                  <Avatar className="h-12 w-12">
                    <AvatarFallback className="text-lg bg-gray-700 text-gray-300">You</AvatarFallback>
                  </Avatar>
                </div>
              ) : (
                <video
                  ref={localVideoRef}
                  autoPlay
                  muted
                  playsInline
                  className="w-full h-full object-cover [transform:rotateY(180deg)]"
                  data-testid="video-local-feed"
                />
              )}
              <div className="absolute bottom-1 left-1 bg-black/60 rounded px-1.5 py-0.5 text-[10px] text-white">
                You {isMuted && "(muted)"}
              </div>
            </div>
          </div>
        </div>

        {showNotes && (
          <CallNotesPanel callId={call.id} onClose={() => setShowNotes(false)} />
        )}
      </div>

      <div className="flex items-center justify-center gap-3 px-4 py-4 bg-gray-800/80">
        <Button
          variant={isMuted ? "destructive" : "secondary"}
          size="icon"
          className="h-12 w-12 rounded-full"
          onClick={toggleMute}
          data-testid="button-toggle-mute"
        >
          {isMuted ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
        </Button>

        <Button
          variant={isVideoOff ? "destructive" : "secondary"}
          size="icon"
          className="h-12 w-12 rounded-full"
          onClick={toggleVideo}
          data-testid="button-toggle-video"
        >
          {isVideoOff ? <VideoOff className="w-5 h-5" /> : <Video className="w-5 h-5" />}
        </Button>

        <Button
          variant={isScreenSharing ? "default" : "secondary"}
          size="icon"
          className="h-12 w-12 rounded-full"
          onClick={toggleScreenShare}
          data-testid="button-screen-share"
        >
          <MonitorUp className="w-5 h-5" />
        </Button>

        <Button
          variant={showNotes ? "default" : "secondary"}
          size="icon"
          className="h-12 w-12 rounded-full"
          onClick={() => setShowNotes(!showNotes)}
          data-testid="button-toggle-notes"
        >
          <FileText className="w-5 h-5" />
        </Button>

        <div className="w-px h-8 bg-gray-600 mx-2" />

        <Button
          variant="destructive"
          size="icon"
          className="h-14 w-14 rounded-full"
          onClick={(activeParticipants.length === 2 || isInitiator) ? handleEndCall : handleLeaveCall}
          data-testid="button-end-call"
        >
          <PhoneOff className="w-6 h-6" />
        </Button>
      </div>
    </div>
  );
}

function RemoteVideo({
  stream,
  participant,
}: {
  stream: MediaStream;
  participant: { user: { firstName: string; lastName: string } };
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamIdRef = useRef<string>("");

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;

    const currentStreamId = stream.id + "_" + stream.getTracks().map(t => t.id).join(",");
    if (streamIdRef.current !== currentStreamId || el.srcObject !== stream) {
      streamIdRef.current = currentStreamId;
      el.srcObject = stream;
      el.play().catch(() => {});
    }
  }, [stream]);

  useEffect(() => {
    const el = videoRef.current;
    if (!el || !stream) return;

    const handleTrackChange = () => {
      if (el.srcObject !== stream) {
        el.srcObject = stream;
        el.play().catch(() => {});
      }
    };

    stream.addEventListener("addtrack", handleTrackChange);
    stream.addEventListener("removetrack", handleTrackChange);
    return () => {
      stream.removeEventListener("addtrack", handleTrackChange);
      stream.removeEventListener("removetrack", handleTrackChange);
    };
  }, [stream]);

  return (
    <video
      ref={videoRef}
      autoPlay
      playsInline
      className="w-full h-full object-cover"
      data-testid="video-remote-feed"
    />
  );
}
