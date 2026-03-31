import { Video, Phone, PhoneOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { VideoCallData } from "@/components/messaging/types";

interface GlobalIncomingCallBannerProps {
  call: VideoCallData;
  onAccept: () => void;
  onDecline: () => void;
}

export function GlobalIncomingCallBanner({ call, onAccept, onDecline }: GlobalIncomingCallBannerProps) {
  return (
    <div
      className="fixed top-4 left-1/2 -translate-x-1/2 z-[9999] w-full max-w-md"
      data-testid="global-incoming-call-banner"
    >
      <div className="flex items-center gap-3 px-4 py-3 bg-background border border-primary/30 rounded-lg shadow-lg animate-pulse">
        <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center shrink-0">
          <Video className="w-5 h-5 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate" data-testid="text-global-call-name">
            {call.initiator.firstName} {call.initiator.lastName} is calling
          </p>
          <p className="text-xs text-muted-foreground" data-testid="text-global-call-info">Incoming video call</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button
            size="sm"
            variant="destructive"
            onClick={onDecline}
            className="h-8"
            data-testid="button-global-decline-call"
          >
            <PhoneOff className="w-4 h-4 mr-1" />
            Decline
          </Button>
          <Button
            size="sm"
            onClick={onAccept}
            className="h-8 bg-green-600 hover:bg-green-700 text-white"
            data-testid="button-global-accept-call"
          >
            <Phone className="w-4 h-4 mr-1" />
            Accept
          </Button>
        </div>
      </div>
    </div>
  );
}
