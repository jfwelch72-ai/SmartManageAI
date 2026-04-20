import { useEffect, useState } from "react";
import { Phone, PhoneOff, Video } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Avatar, ColoredAvatarFallback } from "@/components/ui/avatar";
import type { VideoCallData } from "@/components/messaging/types";

interface GlobalIncomingCallModalProps {
  call: VideoCallData;
  conversationName: string;
  onAccept: () => void;
  onDecline: () => void;
}

export function GlobalIncomingCallModal({
  call,
  conversationName,
  onAccept,
  onDecline,
}: GlobalIncomingCallModalProps) {
  const [countdown, setCountdown] = useState(30);

  useEffect(() => {
    const AudioCtx = window.AudioContext || ((window as unknown as Record<string, typeof AudioContext>).webkitAudioContext);
    const ctx = new AudioCtx();
    let stopped = false;

    const playRing = () => {
      if (stopped) return;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = 440;
      gain.gain.value = 0.15;
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.3);
      const osc2 = ctx.createOscillator();
      const gain2 = ctx.createGain();
      osc2.connect(gain2);
      gain2.connect(ctx.destination);
      osc2.frequency.value = 520;
      gain2.gain.value = 0.15;
      osc2.start(ctx.currentTime + 0.35);
      osc2.stop(ctx.currentTime + 0.65);
    };

    playRing();
    const ringInterval = setInterval(playRing, 2000);

    const countdownInterval = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) return 0;
        return prev - 1;
      });
    }, 1000);

    return () => {
      stopped = true;
      clearInterval(ringInterval);
      clearInterval(countdownInterval);
      ctx.close().catch(() => {});
    };
  }, []);

  return (
    <div
      className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/60 backdrop-blur-sm"
      data-testid="global-incoming-call-modal"
    >
      <div className="relative bg-card border border-border rounded-2xl shadow-2xl p-8 w-[360px] max-w-[90vw] flex flex-col items-center gap-6 animate-in fade-in zoom-in-95 duration-300">
        <div className="relative">
          <div className="absolute inset-0 rounded-full animate-ping bg-green-500/20" />
          <div className="absolute -inset-2 rounded-full animate-pulse bg-green-500/10" />
          <Avatar className="h-20 w-20 relative z-10 ring-4 ring-green-500/30">
            <ColoredAvatarFallback
              className="text-2xl"
              name={`${call.initiator?.firstName ?? "Unknown"} ${call.initiator?.lastName ?? ""}`}
            />
          </Avatar>
        </div>

        <div className="text-center space-y-1">
          <div className="flex items-center justify-center gap-2 text-muted-foreground text-sm">
            <Video className="w-4 h-4" />
            <span>Incoming Video Call</span>
          </div>
          <h2 className="text-xl font-semibold" data-testid="text-modal-caller-name">
            {call.initiator?.firstName ?? "Unknown"} {call.initiator?.lastName ?? "Caller"}
          </h2>
          <p className="text-sm text-muted-foreground" data-testid="text-modal-conversation-name">
            {conversationName}
          </p>
        </div>

        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
          </span>
          Ringing... {countdown > 0 && <span className="tabular-nums">({countdown}s)</span>}
        </div>

        <div className="flex items-center gap-6">
          <div className="flex flex-col items-center gap-2">
            <Button
              size="icon"
              variant="destructive"
              className="h-14 w-14 rounded-full shadow-lg"
              onClick={onDecline}
              data-testid="button-modal-decline-call"
            >
              <PhoneOff className="w-6 h-6" />
            </Button>
            <span className="text-xs text-muted-foreground">Decline</span>
          </div>

          <div className="flex flex-col items-center gap-2">
            <Button
              size="icon"
              className="h-14 w-14 rounded-full bg-green-600 hover:bg-green-700 text-white shadow-lg"
              onClick={onAccept}
              data-testid="button-modal-accept-call"
            >
              <Phone className="w-6 h-6" />
            </Button>
            <span className="text-xs text-muted-foreground">Accept</span>
          </div>
        </div>
      </div>
    </div>
  );
}
