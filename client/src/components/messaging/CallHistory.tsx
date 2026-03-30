import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Video, Clock, Users, FileText, ChevronDown, ChevronUp, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { CallHistoryEntry, VideoCallNoteData } from "./types";

interface CallHistoryProps {
  conversationId: string;
}

function formatDuration(seconds: number | null) {
  if (seconds === null) return "—";
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m >= 60) {
    const h = Math.floor(m / 60);
    return `${h}h ${m % 60}m`;
  }
  return `${m}m ${s}s`;
}

function NotesViewer({ notes }: { notes: VideoCallNoteData[] }) {
  const [expanded, setExpanded] = useState(false);

  if (notes.length === 0) return <span className="text-xs text-muted-foreground">No notes</span>;

  return (
    <div>
      <button
        onClick={() => setExpanded(!expanded)}
        className="text-xs text-primary hover:underline flex items-center gap-1"
        data-testid="button-toggle-call-notes"
      >
        <FileText className="w-3 h-3" />
        {notes.length} note(s)
        {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
      </button>
      {expanded && (
        <div className="mt-2 space-y-2">
          {notes.map(note => (
            <div key={note.id} className="text-xs bg-muted rounded p-2 whitespace-pre-wrap">
              {note.content || "(empty)"}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function CallHistory({ conversationId }: CallHistoryProps) {
  const { data: calls = [], isLoading } = useQuery<CallHistoryEntry[]>({
    queryKey: ["/api/conversations", conversationId, "calls"],
    queryFn: async () => {
      const res = await fetch(`/api/conversations/${conversationId}/calls`, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
  });

  const endedCalls = calls.filter(c => c.status === "ENDED");

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" data-testid="button-call-history">
          <Clock className="w-3 h-3" />
          Call History
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Call History</DialogTitle>
        </DialogHeader>
        <ScrollArea className="max-h-[400px]">
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          ) : endedCalls.length === 0 ? (
            <div className="text-center py-8 text-sm text-muted-foreground">
              No call history yet
            </div>
          ) : (
            <div className="space-y-3">
              {endedCalls.map(call => (
                <div key={call.id} className="border rounded-lg p-3" data-testid={`call-history-${call.id}`}>
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <Video className="w-4 h-4 text-primary" />
                      <span className="text-sm font-medium">
                        {call.initiator.firstName} {call.initiator.lastName}
                      </span>
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {new Date(call.startedAt).toLocaleDateString()} {new Date(call.startedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-muted-foreground mb-2">
                    <span className="flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {formatDuration(call.durationSeconds)}
                    </span>
                    <span className="flex items-center gap-1">
                      <Users className="w-3 h-3" />
                      {call.participants.length} participant(s)
                    </span>
                  </div>
                  <div className="text-xs text-muted-foreground mb-1">
                    {call.participants.map(p => `${p.user.firstName} ${p.user.lastName}`).join(", ")}
                  </div>
                  <NotesViewer notes={call.notes} />
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
