import { useState, useEffect, useRef, useCallback } from "react";
import {
  Video, VideoOff, Mic, MicOff, MonitorUp, PhoneOff,
  FileText, Users, Maximize2, Minimize2, Clock
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { apiRequest } from "@/lib/queryClient";
import { CallNotesPanel } from "./CallNotesPanel";
import { getInitials, type VideoCallData, type Conversation } from "./types";
import { cn } from "@/lib/utils";

interface VideoCallOverlayProps {
  call: VideoCallData;
  conversation: Conversation;
  currentUserId: string;
  onEndCall: () => void;
  onLeaveCall: () => void;
}

export function VideoCallOverlay({
  call,
  conversation,
  currentUserId,
  onEndCall,
  onLeaveCall,
}: VideoCallOverlayProps) {
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(false);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [showNotes, setShowNotes] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [callDuration, setCallDuration] = useState(0);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);

  const localVideoRef = useRef<HTMLVideoElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const durationTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

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
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = stream;
        }
      } catch (err) {
        console.error("Failed to access media devices:", err);
        try {
          stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          setLocalStream(stream);
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

  const toggleMute = useCallback(() => {
    if (localStream) {
      localStream.getAudioTracks().forEach(t => { t.enabled = !t.enabled; });
      setIsMuted(prev => !prev);
    }
  }, [localStream]);

  const toggleVideo = useCallback(() => {
    if (localStream) {
      localStream.getVideoTracks().forEach(t => { t.enabled = !t.enabled; });
      setIsVideoOff(prev => !prev);
    }
  }, [localStream]);

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
    localStream?.getTracks().forEach(t => t.stop());
    onEndCall();
  };

  const handleLeaveCall = () => {
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
            {otherParticipants.map(p => (
              <div
                key={p.userId}
                className="relative rounded-xl bg-gray-800 border border-gray-700 flex items-center justify-center overflow-hidden"
                data-testid={`video-feed-${p.userId}`}
              >
                <Avatar className="h-20 w-20">
                  <AvatarFallback className="text-2xl bg-gray-700 text-gray-300">
                    {getInitials(p.user.firstName, p.user.lastName)}
                  </AvatarFallback>
                </Avatar>
                <div className="absolute bottom-2 left-2 bg-black/60 rounded px-2 py-0.5 text-xs text-white">
                  {p.user.firstName} {p.user.lastName}
                </div>
              </div>
            ))}
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
          onClick={isInitiator ? handleEndCall : handleLeaveCall}
          data-testid="button-end-call"
        >
          <PhoneOff className="w-6 h-6" />
        </Button>
      </div>
    </div>
  );
}
