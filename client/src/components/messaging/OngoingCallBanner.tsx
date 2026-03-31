import { Video, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { VideoCallData } from "./types";

interface OngoingCallBannerProps {
  call: VideoCallData;
  onJoin: () => void;
}

export function OngoingCallBanner({ call, onJoin }: OngoingCallBannerProps) {
  const activeParticipants = call.participants.filter(p => !p.leftAt);
  return (
    <div
      className="mx-4 mt-2 flex items-center gap-3 px-4 py-3 bg-green-500/10 border border-green-500/20 rounded-lg"
      data-testid="ongoing-call-banner"
    >
      <div className="w-10 h-10 rounded-full bg-green-500/20 flex items-center justify-center">
        <Video className="w-5 h-5 text-green-600" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium" data-testid="text-ongoing-call">
          Ongoing call
        </p>
        <p className="text-xs text-muted-foreground flex items-center gap-1">
          <Users className="w-3 h-3" />
          {activeParticipants.length} participant{activeParticipants.length !== 1 ? "s" : ""}
        </p>
      </div>
      <Button
        size="sm"
        onClick={onJoin}
        className="h-8 bg-green-600 hover:bg-green-700 text-white"
        data-testid="button-join-ongoing-call"
      >
        <Video className="w-4 h-4 mr-1" />
        Join Call
      </Button>
    </div>
  );
}
