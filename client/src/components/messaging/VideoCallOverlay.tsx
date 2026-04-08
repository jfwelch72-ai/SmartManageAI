import { useState, useEffect, useRef, useCallback } from "react";
import {
  Video, VideoOff, Mic, MicOff, MonitorUp, PhoneOff,
  FileText, Users, Maximize2, Minimize2, Clock, Loader2
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { CallNotesPanel } from "./CallNotesPanel";
import { getInitials, type VideoCallData, type Conversation } from "./types";
import { cn } from "@/lib/utils";
import { useGlobalVideoCall } from "@/contexts/GlobalVideoCallContext";
import {
  LiveKitRoom,
  VideoTrack,
  AudioTrack,
  useLocalParticipant,
  useRemoteParticipants,
  useTracks,
  useRoomContext,
} from "@livekit/components-react";
import {
  Track,
  RoomEvent,
  type RemoteParticipant,
  type LocalParticipant,
  type RemoteTrackPublication,
  type LocalTrackPublication,
} from "livekit-client";

const PARTICIPANT_POLL_INTERVAL_MS = 3000;

interface VideoCallOverlayProps {
  call: VideoCallData;
  conversation: Conversation;
  currentUserId: string;
  onEndCall: () => void;
  onLeaveCall: () => void;
  onUpdateCall?: (updater: (prev: VideoCallData | null) => VideoCallData | null) => void;
}

export function VideoCallOverlay({
  call,
  conversation,
  currentUserId,
  onEndCall,
  onLeaveCall,
  onUpdateCall,
}: VideoCallOverlayProps) {
  const [livekitToken, setLivekitToken] = useState<string | null>(null);
  const [livekitUrl, setLivekitUrl] = useState<string | null>(null);
  const [tokenError, setTokenError] = useState<string | null>(null);

  useEffect(() => {
    const fetchToken = async () => {
      try {
        const res = await fetch(`/api/calls/${call.id}/livekit-token`, { credentials: "include" });
        if (!res.ok) {
          const errData = await res.json().catch(() => ({ error: "Failed to get token" }));
          if (res.status === 503) {
            setTokenError("Video calling is not available — the service is not configured. Please contact your administrator.");
          } else if (res.status === 403) {
            setTokenError("Video calling is not enabled for your organization.");
          } else {
            setTokenError(errData.error || "Failed to get call token");
          }
          return;
        }
        const data = await res.json();
        setLivekitToken(data.token);
        setLivekitUrl(data.url);
      } catch (err) {
        console.error("[LiveKit] Failed to fetch token:", err);
        setTokenError("Failed to connect to call server. Please try again later.");
      }
    };
    fetchToken();
  }, [call.id]);

  if (tokenError) {
    return (
      <div className="fixed inset-0 z-50 bg-gray-900 flex items-center justify-center" data-testid="video-call-overlay">
        <div className="text-center">
          <p className="text-red-400 text-lg mb-4">{tokenError}</p>
          <Button variant="destructive" onClick={onLeaveCall} data-testid="button-end-call">
            <PhoneOff className="w-5 h-5 mr-2" />
            Leave Call
          </Button>
        </div>
      </div>
    );
  }

  if (!livekitToken || !livekitUrl) {
    return (
      <div className="fixed inset-0 z-50 bg-gray-900 flex items-center justify-center" data-testid="video-call-overlay">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="w-10 h-10 text-blue-400 animate-spin" />
          <p className="text-gray-400 text-sm">Connecting to call...</p>
        </div>
      </div>
    );
  }

  return (
    <LiveKitRoom
      token={livekitToken}
      serverUrl={livekitUrl}
      connect={true}
      video={true}
      audio={true}
      data-testid="video-call-overlay"
    >
      <CallContent
        call={call}
        conversation={conversation}
        currentUserId={currentUserId}
        onEndCall={onEndCall}
        onLeaveCall={onLeaveCall}
        onUpdateCall={onUpdateCall}
      />
    </LiveKitRoom>
  );
}

function CallContent({
  call,
  conversation,
  currentUserId,
  onEndCall,
  onLeaveCall,
  onUpdateCall,
}: VideoCallOverlayProps) {
  const [showNotes, setShowNotes] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [callDuration, setCallDuration] = useState(0);
  const [latestScreenShareIdentity, setLatestScreenShareIdentity] = useState<string | null>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const durationTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const room = useRoomContext();
  const { roomRef } = useGlobalVideoCall();
  const { localParticipant } = useLocalParticipant();
  const remoteParticipants = useRemoteParticipants();

  useEffect(() => {
    roomRef.current = room;
    return () => {
      if (roomRef.current === room) {
        roomRef.current = null;
      }
    };
  }, [room, roomRef]);

  const isMuted = !localParticipant.isMicrophoneEnabled;
  const isVideoOff = !localParticipant.isCameraEnabled;
  const isScreenSharing = localParticipant.isScreenShareEnabled;

  const tracks = useTracks(
    [
      { source: Track.Source.Camera, withPlaceholder: true },
      { source: Track.Source.ScreenShare, withPlaceholder: false },
      { source: Track.Source.Microphone, withPlaceholder: true },
    ],
    { onlySubscribed: false }
  );

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
            return { ...prev, status: callData.status, participants: serverActive };
          });
        }
      } catch (err) {
        console.warn("[LiveKit] Participant poll failed:", err);
      }
    };
    const interval = setInterval(pollParticipants, PARTICIPANT_POLL_INTERVAL_MS);
    pollParticipants();
    return () => clearInterval(interval);
  }, [call.id, onUpdateCall]);

  useEffect(() => {
    if (!room) return;
    const handleDisconnected = () => {
      console.log("[LiveKit] Room disconnected");
    };
    const handleTrackPublished = (pub: RemoteTrackPublication, participant: RemoteParticipant) => {
      if (pub.source === Track.Source.ScreenShare) {
        setLatestScreenShareIdentity(participant.identity);
      }
    };
    const handleTrackUnpublished = (pub: RemoteTrackPublication, participant: RemoteParticipant) => {
      if (pub.source === Track.Source.ScreenShare) {
        setLatestScreenShareIdentity(prev =>
          prev === participant.identity ? null : prev
        );
      }
    };
    const handleLocalTrackPublished = (pub: LocalTrackPublication) => {
      if (pub.source === Track.Source.ScreenShare) {
        setLatestScreenShareIdentity(localParticipant.identity);
      }
    };
    const handleLocalTrackUnpublished = (pub: LocalTrackPublication) => {
      if (pub.source === Track.Source.ScreenShare) {
        setLatestScreenShareIdentity(prev =>
          prev === localParticipant.identity ? null : prev
        );
      }
    };
    room.on(RoomEvent.Disconnected, handleDisconnected);
    room.on(RoomEvent.TrackPublished, handleTrackPublished);
    room.on(RoomEvent.TrackUnpublished, handleTrackUnpublished);
    room.on(RoomEvent.LocalTrackPublished, handleLocalTrackPublished);
    room.on(RoomEvent.LocalTrackUnpublished, handleLocalTrackUnpublished);
    return () => {
      room.off(RoomEvent.Disconnected, handleDisconnected);
      room.off(RoomEvent.TrackPublished, handleTrackPublished);
      room.off(RoomEvent.TrackUnpublished, handleTrackUnpublished);
      room.off(RoomEvent.LocalTrackPublished, handleLocalTrackPublished);
      room.off(RoomEvent.LocalTrackUnpublished, handleLocalTrackUnpublished);
    };
  }, [room, localParticipant.identity]);

  const toggleMute = useCallback(async () => {
    await localParticipant.setMicrophoneEnabled(isMuted);
  }, [localParticipant, isMuted]);

  const toggleVideo = useCallback(async () => {
    await localParticipant.setCameraEnabled(isVideoOff);
  }, [localParticipant, isVideoOff]);

  const toggleScreenShare = useCallback(async () => {
    await localParticipant.setScreenShareEnabled(!isScreenSharing);
  }, [localParticipant, isScreenSharing]);

  const toggleFullscreen = useCallback(() => {
    if (!overlayRef.current) return;
    if (!document.fullscreenElement) {
      overlayRef.current.requestFullscreen().then(() => setIsFullscreen(true)).catch(() => {});
    } else {
      document.exitFullscreen().then(() => setIsFullscreen(false)).catch(() => {});
    }
  }, []);

  const handleEndCall = async () => {
    try {
      await room?.disconnect();
    } catch {}
    onEndCall();
  };

  const handleLeaveCall = async () => {
    try {
      await room?.disconnect();
    } catch {}
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

  const localScreenTrack = tracks.find(
    t => t.participant?.identity === localParticipant.identity &&
      t.source === Track.Source.ScreenShare &&
      t.publication?.track
  );

  const localCameraTrack = tracks.find(
    t => t.participant?.identity === localParticipant.identity &&
      t.source === Track.Source.Camera &&
      t.publication?.track
  );

  const allScreenShareTracks = tracks.filter(
    t => t.source === Track.Source.ScreenShare && t.publication?.track
  );

  const activeScreenShareTrack = allScreenShareTracks.length > 0
    ? (latestScreenShareIdentity
        ? allScreenShareTracks.find(t => t.participant?.identity === latestScreenShareIdentity)
        : null
      ) || allScreenShareTracks[allScreenShareTracks.length - 1]
    : null;

  const activeScreenShareParticipant = activeScreenShareTrack?.participant;
  const isLocalScreenShareActive = activeScreenShareParticipant?.identity === localParticipant.identity;

  const getScreenSharerName = () => {
    if (!activeScreenShareParticipant) return "";
    if (isLocalScreenShareActive) return "Your screen";
    const matched = otherParticipants.find(p => p.userId === activeScreenShareParticipant.identity);
    if (matched) return `${matched.user.firstName}'s screen`;
    return `${activeScreenShareParticipant.identity}'s screen`;
  };

  const showLocalInSidebar = !!activeScreenShareTrack && !isLocalScreenShareActive;

  const localVideoTrack = localScreenTrack || localCameraTrack;

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
        <div className="flex-1 p-4 flex flex-col lg:flex-row gap-3 min-h-0">
          <div className="flex-1 min-h-0 relative rounded-xl bg-gray-800 border border-gray-700 overflow-hidden flex items-center justify-center" data-testid="video-local-main">
            {activeScreenShareTrack ? (
              <VideoTrack
                trackRef={activeScreenShareTrack as Parameters<typeof VideoTrack>[0]["trackRef"]}
                className="w-full h-full object-contain"
                data-testid="video-screenshare-main"
              />
            ) : otherParticipants.length === 0 && remoteParticipants.length === 0 ? (
              <div className="text-center">
                <div className="w-20 h-20 rounded-full bg-gray-700 flex items-center justify-center mx-auto mb-3">
                  <Users className="w-10 h-10 text-gray-500" />
                </div>
                <p className="text-gray-400 text-sm">Waiting for others to join...</p>
              </div>
            ) : (isVideoOff && !isScreenSharing) || !localVideoTrack?.publication?.track ? (
              <div className="flex items-center justify-center h-full">
                <Avatar className="h-20 w-20">
                  <AvatarFallback className="text-2xl bg-gray-700 text-gray-300">You</AvatarFallback>
                </Avatar>
              </div>
            ) : (
              <VideoTrack
                trackRef={localVideoTrack}
                className={cn(
                  "w-full h-full object-cover",
                  !isScreenSharing && "[transform:rotateY(180deg)]"
                )}
                data-testid="video-local-feed"
              />
            )}
            <div className="absolute bottom-2 left-2 bg-black/60 rounded px-2 py-0.5 text-xs text-white" data-testid="text-main-label">
              {activeScreenShareTrack ? (
                <span className="flex items-center gap-1">
                  <MonitorUp className="w-3 h-3" />
                  {getScreenSharerName()}
                </span>
              ) : (
                <>You {isMuted && "(muted)"} {isScreenSharing && "(sharing)"}</>
              )}
            </div>
          </div>

          {(remoteParticipants.length > 0 || otherParticipants.length > 0 || showLocalInSidebar) && (
            <div className="flex flex-row lg:flex-col gap-3 overflow-x-auto lg:overflow-x-hidden lg:overflow-y-auto min-h-0 lg:w-56 shrink-0 max-h-32 lg:max-h-none" data-testid="remote-participants-panel">
              {showLocalInSidebar && (
                <div
                  className="relative rounded-xl bg-gray-800 border border-gray-700 flex items-center justify-center overflow-hidden aspect-video shrink-0 w-40 lg:w-auto"
                  data-testid="video-local-sidebar"
                >
                  {(isVideoOff || !localCameraTrack?.publication?.track) ? (
                    <Avatar className="h-12 w-12">
                      <AvatarFallback className="text-lg bg-gray-700 text-gray-300">You</AvatarFallback>
                    </Avatar>
                  ) : (
                    <VideoTrack
                      trackRef={localCameraTrack}
                      className="w-full h-full object-cover [transform:rotateY(180deg)]"
                      data-testid="video-local-feed"
                    />
                  )}
                  <div className="absolute bottom-2 left-2 bg-black/60 rounded px-2 py-0.5 text-xs text-white">
                    You {isMuted && "(muted)"}
                  </div>
                </div>
              )}
              {remoteParticipants.length > 0 ? (
                remoteParticipants.map(rp => (
                  <RemoteParticipantTile
                    key={rp.identity}
                    participant={rp}
                    callParticipants={otherParticipants}
                    tracks={tracks}
                    isScreenShareActive={activeScreenShareTrack?.participant?.identity === rp.identity}
                  />
                ))
              ) : (
                otherParticipants.map(p => (
                  <div
                    key={p.userId}
                    className="relative rounded-xl bg-gray-800 border border-gray-700 flex items-center justify-center overflow-hidden aspect-video shrink-0 w-40 lg:w-auto"
                    data-testid={`video-feed-${p.userId}`}
                  >
                    <div className="flex flex-col items-center gap-2">
                      <Loader2 className="w-10 h-10 text-blue-400 animate-spin" />
                      <p className="text-blue-400 text-sm" data-testid="text-connecting">Connecting...</p>
                    </div>
                    <div className="absolute bottom-2 left-2 bg-black/60 rounded px-2 py-0.5 text-xs text-white">
                      {p.user?.firstName ?? ""} {p.user?.lastName ?? ""}
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
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
          onClick={(conversation.participants.length <= 2 || isInitiator) ? handleEndCall : handleLeaveCall}
          data-testid="button-end-call"
        >
          <PhoneOff className="w-6 h-6" />
        </Button>
      </div>
    </div>
  );
}

function RemoteParticipantTile({
  participant,
  callParticipants,
  tracks,
  isScreenShareActive,
}: {
  participant: RemoteParticipant;
  callParticipants: { userId: string; user: { firstName: string; lastName: string } }[];
  tracks: { participant?: LocalParticipant | RemoteParticipant; source: Track.Source; publication?: { track?: unknown } }[];
  isScreenShareActive?: boolean;
}) {
  const matchedParticipant = callParticipants.find(p => p.userId === participant.identity);
  const displayName = matchedParticipant
    ? `${matchedParticipant.user.firstName} ${matchedParticipant.user.lastName}`
    : participant.identity;

  const videoTrack = tracks.find(
    t => t.participant?.identity === participant.identity &&
      t.source === Track.Source.Camera &&
      t.publication?.track
  );

  const screenTrack = tracks.find(
    t => t.participant?.identity === participant.identity &&
      t.source === Track.Source.ScreenShare &&
      t.publication?.track
  );

  const audioTrack = tracks.find(
    t => t.participant?.identity === participant.identity &&
      t.source === Track.Source.Microphone &&
      t.publication?.track
  );

  const activeVideoTrack = isScreenShareActive ? videoTrack : (screenTrack || videoTrack);
  const isCameraOff = !participant.isCameraEnabled;
  const isMuted = !participant.isMicrophoneEnabled;

  return (
    <div
      className="relative rounded-xl bg-gray-800 border border-gray-700 flex items-center justify-center overflow-hidden aspect-video shrink-0 w-40 lg:w-auto"
      data-testid={`video-feed-${participant.identity}`}
    >
      {activeVideoTrack?.publication?.track ? (
        <VideoTrack
          trackRef={activeVideoTrack as Parameters<typeof VideoTrack>[0]["trackRef"]}
          className="w-full h-full object-cover"
          data-testid="video-remote-feed"
        />
      ) : isCameraOff ? (
        <Avatar className="h-20 w-20">
          <AvatarFallback className="text-2xl bg-gray-700 text-gray-300">
            {matchedParticipant
              ? getInitials(matchedParticipant.user.firstName, matchedParticipant.user.lastName)
              : participant.identity.substring(0, 2).toUpperCase()}
          </AvatarFallback>
        </Avatar>
      ) : (
        <div className="flex flex-col items-center gap-2">
          <Loader2 className="w-10 h-10 text-blue-400 animate-spin" />
          <p className="text-blue-400 text-sm" data-testid="text-connecting">Connecting...</p>
        </div>
      )}

      {audioTrack?.publication?.track && (
        <AudioTrack
          trackRef={audioTrack as Parameters<typeof AudioTrack>[0]["trackRef"]}
        />
      )}

      {isMuted && (
        <div className="absolute top-2 right-2 bg-red-500/80 rounded-lg px-2 py-1 flex items-center gap-1.5">
          <MicOff className="w-3.5 h-3.5 text-white" />
        </div>
      )}

      <div className="absolute bottom-2 left-2 bg-black/60 rounded px-2 py-0.5 text-xs text-white">
        {displayName}
      </div>
    </div>
  );
}
