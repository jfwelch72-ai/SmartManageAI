import { useState, useEffect, useRef, useCallback } from "react";
import {
  Video, VideoOff, Mic, MicOff, MonitorUp, PhoneOff,
  FileText, Users, Maximize2, Minimize2, Clock, Loader2, WifiOff, RefreshCw, AlertTriangle
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { apiRequest } from "@/lib/queryClient";
import { CallNotesPanel } from "./CallNotesPanel";
import { getInitials, type VideoCallData, type Conversation } from "./types";
import { cn } from "@/lib/utils";

const FALLBACK_ICE_SERVERS: RTCConfiguration = {
  iceServers: [
    { urls: "stun:stun.relay.metered.ca:80" },
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
  ],
};

const ICE_RETRY_BACKOFF = [1000, 3000, 5000];
const MAX_ICE_RETRIES = 3;
const PARTICIPANT_POLL_INTERVAL_MS = 3000;
const ICE_TIMEOUT_WITH_TURN_MS = 15000;
const ICE_TIMEOUT_STUN_ONLY_MS = 8000;
const ICE_SLOW_CHECK_MS = 3000;
const CONNECTED_NO_TRACKS_TIMEOUT_MS = 5000;

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
  onUpdateCall?: (updater: (prev: VideoCallData | null) => VideoCallData | null) => void;
  registerSignalHandler?: (handler: (fromUserId: string, signal: unknown) => void) => void;
  unregisterSignalHandler?: () => void;
}

export function VideoCallOverlay({
  call,
  conversation,
  currentUserId,
  onEndCall,
  onLeaveCall,
  onUpdateCall,
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
  const [peerStates, setPeerStates] = useState<Record<string, RTCIceConnectionState | "retrying" | "checking_slow" | "peer_unreachable" | "connected_no_video">>({});
  const [iceFailureReasons, setIceFailureReasons] = useState<Record<string, "turn_unreachable" | "network_blocked">>({});
  const iceFailureReasonsRef = useRef<Record<string, "turn_unreachable" | "network_blocked">>({});
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
  const connectedNoTracksRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const retryConnectionRef = useRef<(remoteUserId: string) => void>(() => {});
  const [turnPreCheckStatus, setTurnPreCheckStatus] = useState<"pending" | "ok" | "stun_only" | "no_connectivity">("pending");

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
    const checkStunConnectivity = async (stunServers: Array<{ urls: string | string[] }>): Promise<boolean> => {
      try {
        const testConfig: RTCConfiguration = { iceServers: stunServers };
        const testPc = new RTCPeerConnection(testConfig);
        let foundSrflx = false;
        const stunPromise = new Promise<boolean>((resolve) => {
          const timeout = setTimeout(() => {
            testPc.close();
            resolve(false);
          }, 5000);
          testPc.onicecandidate = (e) => {
            if (e.candidate) {
              const isSrflx = e.candidate.type === "srflx" ||
                (e.candidate.candidate && e.candidate.candidate.includes(" typ srflx"));
              if (isSrflx) {
                foundSrflx = true;
                clearTimeout(timeout);
                testPc.close();
                resolve(true);
              }
            }
            if (!e.candidate && !foundSrflx) {
              clearTimeout(timeout);
              testPc.close();
              resolve(false);
            }
          };
        });
        testPc.createDataChannel("stun-test");
        const offer = await testPc.createOffer();
        await testPc.setLocalDescription(offer);
        return await stunPromise;
      } catch {
        return false;
      }
    };

    const runTurnPreCheck = async (
      turnServers: Array<{ urls: string | string[]; username?: string; credential?: string }>,
      stunServers: Array<{ urls: string | string[] }>
    ) => {
      try {
        const testConfig: RTCConfiguration = {
          iceServers: turnServers,
          iceTransportPolicy: "relay",
        };
        const testPc = new RTCPeerConnection(testConfig);
        let foundRelay = false;
        const preCheckPromise = new Promise<boolean>((resolve) => {
          const timeout = setTimeout(() => {
            testPc.close();
            resolve(false);
          }, 8000);
          testPc.onicecandidate = (e) => {
            if (e.candidate) {
              const isRelay = e.candidate.type === "relay" ||
                (e.candidate.candidate && e.candidate.candidate.includes(" typ relay"));
              if (isRelay) {
                foundRelay = true;
                clearTimeout(timeout);
                testPc.close();
                resolve(true);
              }
            }
            if (!e.candidate && !foundRelay) {
              clearTimeout(timeout);
              testPc.close();
              resolve(false);
            }
          };
        });
        testPc.createDataChannel("connectivity-test");
        const offer = await testPc.createOffer();
        await testPc.setLocalDescription(offer);
        const reachable = await preCheckPromise;
        if (reachable) {
          console.log("[WebRTC] TURN server connectivity pre-check: OK");
          setTurnPreCheckStatus("ok");
        } else {
          console.warn("[WebRTC] TURN server connectivity pre-check: UNREACHABLE — checking STUN fallback");
          const stunWorks = await checkStunConnectivity(stunServers);
          if (stunWorks) {
            console.log("[WebRTC] STUN connectivity OK — calls can still work via direct connection");
            setTurnPreCheckStatus("stun_only");
          } else {
            console.error("[WebRTC] Neither TURN nor STUN connectivity available");
            setTurnPreCheckStatus("no_connectivity");
          }
        }
      } catch (err) {
        console.warn("[WebRTC] TURN server connectivity pre-check failed:", err);
        const stunWorks = await checkStunConnectivity(stunServers);
        setTurnPreCheckStatus(stunWorks ? "stun_only" : "no_connectivity");
      }
    };

    fetch("/api/calls/ice-config", { credentials: "include" })
      .then(res => res.ok ? res.json() : null)
      .then(async (data) => {
        if (data?.iceServers) {
          const config: RTCConfiguration = { iceServers: data.iceServers };
          setIceConfig(config);
          iceConfigRef.current = config;
          const turnServers = data.iceServers.filter((s: { urls: string | string[] }) => {
            const urls = Array.isArray(s.urls) ? s.urls : [s.urls];
            return urls.some((u: string) => u.startsWith("turn:") || u.startsWith("turns:"));
          });
          const stunServers = data.iceServers.filter((s: { urls: string | string[] }) => {
            const urls = Array.isArray(s.urls) ? s.urls : [s.urls];
            return urls.some((u: string) => u.startsWith("stun:"));
          });
          const turnCount = turnServers.length;
          console.log(`[WebRTC] Loaded ICE config: ${data.iceServers.length} servers (${turnCount} TURN, hasTurn: ${data.hasTurn}, tier: ${data.turnTier})`);
          if (turnCount === 0) {
            console.warn("[WebRTC] No TURN servers in ICE config — checking STUN connectivity");
            const stunWorks = await checkStunConnectivity(stunServers);
            setTurnPreCheckStatus(stunWorks ? "stun_only" : "no_connectivity");
          } else {
            await runTurnPreCheck(turnServers, stunServers);
          }
        } else {
          console.warn("[WebRTC] Backend returned no ICE config, using STUN-only fallback");
          const fallbackStun = FALLBACK_ICE_SERVERS.iceServers!.filter(s => {
            const urls = Array.isArray(s.urls) ? s.urls : [s.urls];
            return urls.some((u: string) => u.startsWith("stun:"));
          });
          const stunWorks = await checkStunConnectivity(fallbackStun);
          setTurnPreCheckStatus(stunWorks ? "stun_only" : "no_connectivity");
        }
      })
      .catch(async (err) => {
        console.warn("[WebRTC] Failed to fetch ICE config, using STUN-only fallback:", err);
        const fallbackStun = FALLBACK_ICE_SERVERS.iceServers!.filter(s => {
          const urls = Array.isArray(s.urls) ? s.urls : [s.urls];
          return urls.some((u: string) => u.startsWith("stun:"));
        });
        const stunWorks = await checkStunConnectivity(fallbackStun);
        setTurnPreCheckStatus(stunWorks ? "stun_only" : "no_connectivity");
      });
  }, []);

  useEffect(() => {
    if (!onUpdateCall) return;
    const pollParticipants = async () => {
      try {
        const res = await fetch(`/api/calls/${call.id}`, { credentials: "include" });
        if (!res.ok) return;
        const callData = await res.json();
        if (callData?.participants) {
          const serverActive = callData.participants.filter(
            (p: { leftAt: string | null }) => !p.leftAt
          );
          onUpdateCall(prev => {
            if (!prev || prev.id !== call.id) return prev;
            const prevIds = new Set(prev.participants.map((p: { userId: string }) => p.userId));
            const serverIds = new Set(serverActive.map((p: { userId: string }) => p.userId));
            const added = serverActive.filter((p: { userId: string }) => !prevIds.has(p.userId));
            const removed = prev.participants.filter((p: { userId: string }) => !serverIds.has(p.userId));
            if (added.length === 0 && removed.length === 0 && prev.status === callData.status) {
              return prev;
            }
            if (added.length > 0) {
              console.log(`[WebRTC] Participant poll: ${added.length} new participant(s) detected`, added.map((p: { userId: string }) => p.userId));
            }
            if (removed.length > 0) {
              console.log(`[WebRTC] Participant poll: ${removed.length} participant(s) removed`, removed.map((p: { userId: string }) => p.userId));
            }
            return { ...prev, status: callData.status, participants: serverActive };
          });
        }
      } catch (err) {
        console.warn("[WebRTC] Participant poll failed:", err);
      }
    };
    const interval = setInterval(pollParticipants, PARTICIPANT_POLL_INTERVAL_MS);
    pollParticipants();
    return () => clearInterval(interval);
  }, [call.id, onUpdateCall]);

  const signalRetryTimerRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const sendSignal = useCallback(async (targetUserId: string, signal: unknown, retryAttempt = 0) => {
    try {
      const res = await apiRequest("POST", `/api/calls/${call.id}/signal`, {
        targetUserId,
        signal,
      });
      const data = await res.json();
      if (data.delivered === false) {
        console.warn(`[WebRTC] Signal not delivered to ${targetUserId}: ${data.reason} (attempt ${retryAttempt + 1})`);
        const signalObj = signal as SignalMessage;
        const maxRetries = 3;
        if (retryAttempt < maxRetries) {
          const retryKey = `${targetUserId}_${signalObj.type}_${retryAttempt}`;
          const delay = [1000, 2000, 3000][retryAttempt] || 3000;
          console.log(`[WebRTC] Scheduling signal retry for ${targetUserId} (${signalObj.type}) in ${delay}ms`);
          signalRetryTimerRef.current[retryKey] = setTimeout(() => {
            delete signalRetryTimerRef.current[retryKey];
            sendSignal(targetUserId, signal, retryAttempt + 1);
          }, delay);
        } else {
          console.warn(`[WebRTC] Signal delivery to ${targetUserId} failed after ${maxRetries + 1} attempts`);
          if (signalObj.type === "offer" || signalObj.type === "answer") {
            setPeerStates(prev => ({ ...prev, [targetUserId]: "peer_unreachable" }));
          }
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
    if (connectedNoTracksRef.current[remoteUserId]) {
      clearTimeout(connectedNoTracksRef.current[remoteUserId]);
      delete connectedNoTracksRef.current[remoteUserId];
    }

    let config = overrideConfig || iceConfigRef.current;
    if (turnPreCheckStatus === "stun_only" && !overrideConfig) {
      config = {
        ...config,
        iceCandidatePoolSize: 6,
        bundlePolicy: "max-bundle",
      };
      console.log(`[WebRTC] STUN-only mode: using aggressive ICE gathering for ${remoteUserId}`);
    }

    const pc = new RTCPeerConnection(config);
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
      console.log(`[WebRTC] Track received from ${remoteUserId}: kind=${event.track.kind}, id=${event.track.id}, readyState=${event.track.readyState}, muted=${event.track.muted}, hasStream=${!!event.streams[0]}`);

      event.track.onended = () => {
        console.warn(`[WebRTC] Remote track ended: kind=${event.track.kind}, id=${event.track.id}, peer=${remoteUserId} — scheduling cleanup/retry`);
        setRemoteStreams(prev => {
          const existing = prev[remoteUserId];
          if (!existing) return prev;
          const liveTracks = existing.getTracks().filter(t => t.readyState === "live");
          if (liveTracks.length === 0) {
            console.log(`[WebRTC] All tracks ended for ${remoteUserId}, removing stream and retrying`);
            const next = { ...prev };
            delete next[remoteUserId];
            setTimeout(() => {
              const pc = peerConnectionsRef.current[remoteUserId];
              if (pc && (pc.iceConnectionState === "connected" || pc.iceConnectionState === "completed")) {
                console.log(`[WebRTC] Renegotiating with ${remoteUserId} after all tracks ended`);
                retryConnectionRef.current(remoteUserId);
              }
            }, 1000);
            return next;
          }
          return { ...prev, [remoteUserId]: new MediaStream(liveTracks) };
        });
      };
      event.track.onmute = () => {
        console.log(`[WebRTC] Remote track muted: kind=${event.track.kind}, peer=${remoteUserId}`);
      };
      event.track.onunmute = () => {
        console.log(`[WebRTC] Remote track unmuted: kind=${event.track.kind}, peer=${remoteUserId}`);
      };

      if (event.track.kind === "video" && event.track.readyState === "live" && connectedNoTracksRef.current[remoteUserId]) {
        clearTimeout(connectedNoTracksRef.current[remoteUserId]);
        delete connectedNoTracksRef.current[remoteUserId];
        console.log(`[WebRTC] Live video track received from ${remoteUserId}, clearing connected_no_video timer`);
      }

      setRemoteStreams(prev => {
        const existing = prev[remoteUserId];
        if (existing) {
          const hasTrack = existing.getTracks().some(t => t.id === event.track.id);
          if (!hasTrack) {
            existing.addTrack(event.track);
            console.log(`[WebRTC] Added ${event.track.kind} track to existing stream for ${remoteUserId} (total tracks: ${existing.getTracks().length})`);
          }
          return { ...prev, [remoteUserId]: new MediaStream(existing.getTracks()) };
        }
        const newStream = event.streams[0] || new MediaStream();
        if (!event.streams[0]) {
          newStream.addTrack(event.track);
        }
        console.log(`[WebRTC] Created new stream for ${remoteUserId} with ${newStream.getTracks().length} track(s)`);
        return { ...prev, [remoteUserId]: newStream };
      });

      if (event.track.kind === "video" && event.track.readyState === "live") {
        setPeerStates(prev => {
          if (prev[remoteUserId] === "connected_no_video") {
            console.log(`[WebRTC] Live video track received from ${remoteUserId}, clearing connected_no_video state`);
            return { ...prev, [remoteUserId]: "connected" };
          }
          return prev;
        });
      }
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

        if (connectedNoTracksRef.current[remoteUserId]) {
          clearTimeout(connectedNoTracksRef.current[remoteUserId]);
        }
        connectedNoTracksRef.current[remoteUserId] = setTimeout(() => {
          setRemoteStreams(currentStreams => {
            const stream = currentStreams[remoteUserId];
            const hasVideoTracks = stream && stream.getVideoTracks().length > 0;
            if (!hasVideoTracks) {
              console.warn(`[WebRTC] Connected to ${remoteUserId} but no video tracks received after ${CONNECTED_NO_TRACKS_TIMEOUT_MS / 1000}s`);
              setPeerStates(prev => ({ ...prev, [remoteUserId]: "connected_no_video" }));
            }
            return currentStreams;
          });
          delete connectedNoTracksRef.current[remoteUserId];
        }, CONNECTED_NO_TRACKS_TIMEOUT_MS);
      }

      if (state === "failed") {
        if (connectedNoTracksRef.current[remoteUserId]) {
          clearTimeout(connectedNoTracksRef.current[remoteUserId]);
          delete connectedNoTracksRef.current[remoteUserId];
        }
        if (iceTimeoutRef.current[remoteUserId]) {
          clearTimeout(iceTimeoutRef.current[remoteUserId]);
          delete iceTimeoutRef.current[remoteUserId];
        }
        if (!iceFailureReasonsRef.current[remoteUserId]) {
          const hasTurn = iceConfigRef.current.iceServers?.some(s => {
            const urls = Array.isArray(s.urls) ? s.urls : [s.urls];
            return urls.some((u: string) => u.startsWith("turn:") || u.startsWith("turns:"));
          });
          pc.getStats().then(stats => {
            let hasRelay = false;
            stats.forEach(report => {
              if (report.type === "local-candidate" && report.candidateType === "relay") {
                hasRelay = true;
              }
            });
            let reason: "turn_unreachable" | "network_blocked";
            if (!hasTurn || !hasRelay) {
              reason = "turn_unreachable";
            } else {
              reason = "network_blocked";
            }
            iceFailureReasonsRef.current[remoteUserId] = reason;
            setIceFailureReasons(prev => ({ ...prev, [remoteUserId]: reason }));
          }).catch(() => {});
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
        if (connectedNoTracksRef.current[remoteUserId]) {
          clearTimeout(connectedNoTracksRef.current[remoteUserId]);
          delete connectedNoTracksRef.current[remoteUserId];
        }
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
            console.warn(`[WebRTC] ICE connection to ${remoteUserId} taking longer than expected (>${ICE_SLOW_CHECK_MS / 1000}s in checking state)`);
            try {
              pc.getStats().then(stats => {
                const candidatePairs: string[] = [];
                stats.forEach(report => {
                  if (report.type === "candidate-pair") {
                    candidatePairs.push(`  pair: state=${report.state}, local=${report.localCandidateId}, remote=${report.remoteCandidateId}, nominated=${report.nominated}`);
                  }
                });
                if (candidatePairs.length > 0) {
                  console.log(`[WebRTC] ICE candidate pairs for ${remoteUserId}:\n${candidatePairs.join("\n")}`);
                } else {
                  console.warn(`[WebRTC] No ICE candidate pairs found for ${remoteUserId} — candidates may not be exchanged`);
                }
              });
            } catch {}
            setPeerStates(prev => ({ ...prev, [remoteUserId]: "checking_slow" }));
          }
        }, ICE_SLOW_CHECK_MS);
        const hasTurnConfig = turnPreCheckStatus === "ok" || (turnPreCheckStatus !== "stun_only" && iceConfigRef.current.iceServers?.some(s => {
          const urls = Array.isArray(s.urls) ? s.urls : [s.urls];
          return urls.some((u: string) => u.startsWith("turn:") || u.startsWith("turns:"));
        }));
        const iceTimeoutMs = (hasTurnConfig && turnPreCheckStatus !== "stun_only") ? ICE_TIMEOUT_WITH_TURN_MS : ICE_TIMEOUT_STUN_ONLY_MS;
        iceTimeoutRef.current[remoteUserId] = setTimeout(async () => {
          if (pc.iceConnectionState === "checking") {
            let hasRelayCandidates = false;
            try {
              const stats = await pc.getStats();
              stats.forEach(report => {
                if (report.type === "local-candidate" && report.candidateType === "relay") {
                  hasRelayCandidates = true;
                }
              });
            } catch {}
            if (!hasTurnConfig) {
              console.error(`[WebRTC] ICE checking timeout for ${remoteUserId}: TURN relay not reachable — direct connection failed`);
              iceFailureReasonsRef.current[remoteUserId] = "turn_unreachable";
              setIceFailureReasons(prev => ({ ...prev, [remoteUserId]: "turn_unreachable" }));
            } else if (!hasRelayCandidates) {
              console.error(`[WebRTC] ICE checking timeout for ${remoteUserId}: TURN server configured but no relay candidates gathered — TURN server appears unreachable`);
              iceFailureReasonsRef.current[remoteUserId] = "turn_unreachable";
              setIceFailureReasons(prev => ({ ...prev, [remoteUserId]: "turn_unreachable" }));
            } else {
              console.error(`[WebRTC] ICE checking timeout for ${remoteUserId}: TURN relay candidates exist but connection still failed — network may be blocking all paths`);
              iceFailureReasonsRef.current[remoteUserId] = "network_blocked";
              setIceFailureReasons(prev => ({ ...prev, [remoteUserId]: "network_blocked" }));
            }
            pc.close();
            setPeerStates(prev => ({ ...prev, [remoteUserId]: "failed" }));
          }
        }, iceTimeoutMs);
      }
    };

    return pc;
  }, [sendSignal, turnPreCheckStatus]);

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

  retryConnectionRef.current = retryConnection;

  const handleRetryConnection = useCallback((remoteUserId: string) => {
    retryCountRef.current[remoteUserId] = 0;
    retryConnection(remoteUserId);
  }, [retryConnection]);

  const handleSignal = useCallback(async (fromUserId: string, signal: SignalMessage) => {
    if (fromUserId === currentUserId) return;

    if (signal.type === "offer" || signal.type === "answer") {
      const isKnownParticipant = call.participants.some(
        (p: { userId: string; leftAt: string | null }) => p.userId === fromUserId && !p.leftAt
      );
      if (!isKnownParticipant && onUpdateCall) {
        console.log(`[WebRTC] Auto-adding unknown peer ${fromUserId} from incoming ${signal.type}`);
        onUpdateCall(prev => {
          if (!prev || prev.id !== call.id) return prev;
          const alreadyIn = prev.participants.some((p: { userId: string }) => p.userId === fromUserId);
          if (alreadyIn) return prev;
          const newParticipant = {
            id: `signal-${fromUserId}`,
            callId: call.id,
            userId: fromUserId,
            joinedAt: new Date().toISOString(),
            leftAt: null,
            user: { id: fromUserId, firstName: "Participant", lastName: "", role: "" },
          };
          return { ...prev, participants: [...prev.participants, newParticipant] };
        });
      }
    }

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
  }, [currentUserId, createPeerConnection, sendSignal, flushPendingCandidates, call.id, call.participants, onUpdateCall]);

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
      Object.values(signalRetryTimerRef.current).forEach(t => clearTimeout(t));
      signalRetryTimerRef.current = {};
      Object.values(connectedNoTracksRef.current).forEach(t => clearTimeout(t));
      connectedNoTracksRef.current = {};
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

      {turnPreCheckStatus === "stun_only" && (
        <div className="mx-4 mt-2 px-3 py-2 bg-blue-900/30 border border-blue-700/40 rounded-lg flex items-center gap-2" data-testid="banner-stun-only">
          <AlertTriangle className="w-4 h-4 text-blue-400 shrink-0" />
          <p className="text-blue-300 text-xs">
            Direct connection mode — relay servers not needed. Most calls will work fine on your current network.
          </p>
        </div>
      )}
      {turnPreCheckStatus === "no_connectivity" && (
        <div className="mx-4 mt-2 px-3 py-2 bg-red-900/30 border border-red-700/40 rounded-lg flex items-center gap-2" data-testid="banner-no-connectivity">
          <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
          <p className="text-red-300 text-xs">
            No network connectivity detected. Calls are unlikely to connect. Check your network connection or try switching to a different network.
          </p>
        </div>
      )}

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
              const isConnectedNoVideo = iceState === "connected_no_video";
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
                      {(() => {
                        const reason = iceFailureReasons[p.userId];
                        if (reason === "turn_unreachable") {
                          return (
                            <div className="flex flex-col items-center gap-1">
                              <p className="text-amber-400 text-sm font-medium" data-testid="text-connection-failed">Connection couldn't be established</p>
                              <p className="text-gray-500 text-xs">
                                The relay server wasn't reachable, and a direct connection couldn't be made either. Try again — if the problem persists, switching networks may help.
                              </p>
                            </div>
                          );
                        }
                        if (reason === "network_blocked") {
                          return (
                            <div className="flex flex-col items-center gap-1">
                              <p className="text-red-400 text-sm font-medium" data-testid="text-connection-failed">Unable to connect — network blocked</p>
                              <p className="text-gray-500 text-xs">
                                Both direct and relay connection paths were blocked. Your network firewall may be preventing all WebRTC traffic. Try switching to a different network (e.g., mobile hotspot) or contact your network administrator.
                              </p>
                            </div>
                          );
                        }
                        return (
                          <div className="flex flex-col items-center gap-1">
                            <p className="text-red-400 text-sm font-medium" data-testid="text-connection-failed">Connection failed</p>
                            <p className="text-gray-500 text-xs">
                              Could not establish a connection. This may be due to network restrictions or firewall settings. Try again or switch to a different network.
                            </p>
                          </div>
                        );
                      })()}
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
                  ) : isConnectedNoVideo ? (
                    <div className="flex flex-col items-center gap-2 text-center px-4">
                      <Video className="w-10 h-10 text-amber-400" />
                      <p className="text-amber-400 text-sm font-medium" data-testid="text-connected-no-video">Connected — waiting for video</p>
                      <p className="text-gray-500 text-xs">The connection was established but no video has been received yet. The other participant may have their camera off.</p>
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
  const [autoplayBlocked, setAutoplayBlocked] = useState(false);
  const [trackEnded, setTrackEnded] = useState(false);
  const [prolongedMuted, setProlongedMuted] = useState(false);

  const attemptPlay = useCallback((el: HTMLVideoElement) => {
    el.play().then(() => {
      setAutoplayBlocked(false);
    }).catch((err) => {
      if (err.name === "NotAllowedError") {
        console.warn(`[WebRTC] Autoplay blocked for remote video from ${participant.user.firstName}`);
        setAutoplayBlocked(true);
      } else {
        console.warn(`[WebRTC] Play failed for remote video:`, err.message);
      }
    });
  }, [participant.user.firstName]);

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;

    const currentStreamId = stream.id + "_" + stream.getTracks().map(t => t.id).join(",");
    if (streamIdRef.current !== currentStreamId || el.srcObject !== stream) {
      streamIdRef.current = currentStreamId;
      el.srcObject = stream;
      attemptPlay(el);
    }
  }, [stream, attemptPlay]);

  useEffect(() => {
    const el = videoRef.current;
    if (!el || !stream) return;

    const handleTrackChange = () => {
      el.srcObject = stream;
      attemptPlay(el);
    };

    stream.addEventListener("addtrack", handleTrackChange);
    stream.addEventListener("removetrack", handleTrackChange);
    return () => {
      stream.removeEventListener("addtrack", handleTrackChange);
      stream.removeEventListener("removetrack", handleTrackChange);
    };
  }, [stream, attemptPlay]);

  useEffect(() => {
    if (!stream) return;

    const videoTracks = stream.getVideoTracks();
    const hasLiveTracks = videoTracks.some(t => t.readyState === "live");
    if (hasLiveTracks) {
      setTrackEnded(false);
    }

    const cleanups: (() => void)[] = [];

    for (const track of videoTracks) {
      const handleEnded = () => {
        console.warn(`[WebRTC] Video track ended for ${participant.user.firstName}: id=${track.id}`);
        const allEnded = stream.getVideoTracks().every(t => t.readyState === "ended");
        if (allEnded) {
          setTrackEnded(true);
        }
      };
      track.addEventListener("ended", handleEnded);
      cleanups.push(() => track.removeEventListener("ended", handleEnded));
    }

    const allEndedNow = videoTracks.length > 0 && videoTracks.every(t => t.readyState === "ended");
    if (allEndedNow) {
      setTrackEnded(true);
    }

    const interval = setInterval(() => {
      const vTracks = stream.getVideoTracks();
      const allEnded = vTracks.length > 0 && vTracks.every(t => t.readyState === "ended");
      if (allEnded) {
        setTrackEnded(true);
      } else if (vTracks.some(t => t.readyState === "live")) {
        setTrackEnded(false);
      }
    }, 3000);

    return () => {
      cleanups.forEach(fn => fn());
      clearInterval(interval);
    };
  }, [stream, participant.user.firstName]);

  useEffect(() => {
    if (!stream) return;
    let mutedSinceMs = 0;
    const PROLONGED_MUTE_THRESHOLD_MS = 10000;

    const checkMuted = () => {
      const vTracks = stream.getVideoTracks();
      const allMuted = vTracks.length > 0 && vTracks.every(t => t.muted && t.readyState === "live");
      if (allMuted) {
        if (mutedSinceMs === 0) {
          mutedSinceMs = Date.now();
        } else if (Date.now() - mutedSinceMs >= PROLONGED_MUTE_THRESHOLD_MS) {
          console.warn(`[WebRTC] Video tracks muted for >${PROLONGED_MUTE_THRESHOLD_MS / 1000}s for ${participant.user.firstName}`);
          setProlongedMuted(true);
        }
      } else {
        mutedSinceMs = 0;
        setProlongedMuted(false);
      }
    };

    const interval = setInterval(checkMuted, 2000);
    return () => clearInterval(interval);
  }, [stream, participant.user.firstName]);

  const handleClickToPlay = useCallback(() => {
    const el = videoRef.current;
    if (el) {
      attemptPlay(el);
    }
  }, [attemptPlay]);

  return (
    <div className="relative w-full h-full">
      <video
        ref={videoRef}
        autoPlay
        playsInline
        className="w-full h-full object-cover"
        data-testid="video-remote-feed"
      />
      {autoplayBlocked && (
        <div
          className="absolute inset-0 flex flex-col items-center justify-center bg-black/70 cursor-pointer"
          onClick={handleClickToPlay}
          data-testid="overlay-click-to-play"
        >
          <Video className="w-10 h-10 text-white mb-2" />
          <p className="text-white text-sm font-medium">Click to play</p>
          <p className="text-gray-400 text-xs mt-1">Browser blocked autoplay</p>
        </div>
      )}
      {trackEnded && !autoplayBlocked && (
        <div className="absolute top-2 right-2 bg-amber-900/80 rounded px-2 py-1 text-xs text-amber-300" data-testid="badge-track-ended">
          Video track ended
        </div>
      )}
      {prolongedMuted && !trackEnded && !autoplayBlocked && (
        <div className="absolute top-2 right-2 bg-amber-900/80 rounded px-2 py-1 text-xs text-amber-300" data-testid="badge-prolonged-muted">
          Video signal paused
        </div>
      )}
    </div>
  );
}
