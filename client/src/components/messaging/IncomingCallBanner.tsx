import { Video, Phone, PhoneOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { VideoCallData } from "./types";

interface IncomingCallBannerProps {
  call: VideoCallData;
  conversationName: string;
  onAccept: () => void;
  onDecline: () => void;
}

export function IncomingCallBanner({ call, conversationName, onAccept, onDecline }: IncomingCallBannerProps) {
  return (
    <div
      className="mb-2 flex items-center gap-3 px-4 py-3 bg-primary/10 border border-primary/20 rounded-lg animate-pulse shadow-sm"
      data-testid="incoming-call-banner"
    >
      <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center shrink-0">
        <Video className="w-5 h-5 text-primary" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate" data-testid="text-incoming-call-name">
          {call.initiator.firstName} {call.initiator.lastName} is calling
        </p>
        <p className="text-xs text-muted-foreground truncate" data-testid="text-incoming-call-conversation">{conversationName}</p>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <Button
          size="sm"
          variant="destructive"
          onClick={onDecline}
          className="h-8"
          data-testid="button-decline-call"
        >
          <PhoneOff className="w-4 h-4 mr-1" />
          Decline
        </Button>
        <Button
          size="sm"
          onClick={onAccept}
          className="h-8 bg-green-600 hover:bg-green-700 text-white"
          data-testid="button-accept-call"
        >
          <Phone className="w-4 h-4 mr-1" />
          Accept
        </Button>
      </div>
    </div>
  );
}
