import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Video, Clock, Users, FileText, Search, Calendar, ChevronLeft, ChevronRight, Loader2, Sparkles } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { User, VideoCallNoteData, VideoCallParticipantData } from "./types";

interface CallNoteEntry {
  id: string;
  conversationId: string;
  conversationName: string | null;
  conversationType: string;
  initiatorId: string;
  status: string;
  startedAt: string;
  endedAt: string | null;
  durationSeconds: number | null;
  initiator: User;
  participants: (VideoCallParticipantData & { user: User })[];
  notes: (VideoCallNoteData & { author: { id: string; firstName: string; lastName: string } | null })[];
}

interface AllCallNotesResponse {
  calls: CallNoteEntry[];
  total: number;
  page: number;
  limit: number;
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

function hasAiSummary(content: string) {
  return content.includes("--- AI Summary ---");
}

interface AllCallNotesProps {
  onBack: () => void;
  onNavigateToConversation?: (conversationId: string) => void;
}

export function AllCallNotes({ onBack, onNavigateToConversation }: AllCallNotesProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(1);
  const [appliedSearch, setAppliedSearch] = useState("");
  const [appliedDateFrom, setAppliedDateFrom] = useState("");
  const [appliedDateTo, setAppliedDateTo] = useState("");

  const { data, isLoading } = useQuery<AllCallNotesResponse>({
    queryKey: ["/api/call-notes", { page, search: appliedSearch, dateFrom: appliedDateFrom, dateTo: appliedDateTo }],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set("page", String(page));
      params.set("limit", "20");
      if (appliedSearch) params.set("search", appliedSearch);
      if (appliedDateFrom) params.set("dateFrom", appliedDateFrom);
      if (appliedDateTo) params.set("dateTo", appliedDateTo);
      const res = await fetch(`/api/call-notes?${params.toString()}`, { credentials: "include" });
      if (!res.ok) return { calls: [], total: 0, page: 1, limit: 20 };
      return res.json();
    },
  });

  const calls = data?.calls ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / 20));

  const handleApplyFilters = () => {
    setAppliedSearch(searchQuery);
    setAppliedDateFrom(dateFrom);
    setAppliedDateTo(dateTo);
    setPage(1);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleApplyFilters();
  };

  return (
    <div className="flex flex-col h-full" data-testid="all-call-notes-view">
      <div className="flex items-center gap-3 px-4 py-3 border-b">
        <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={onBack} data-testid="button-back-from-call-notes">
          <ChevronLeft className="w-4 h-4" />
        </Button>
        <div className="flex items-center gap-2">
          <FileText className="w-5 h-5 text-primary" />
          <h2 className="font-semibold text-base" data-testid="text-call-notes-title">Call Notes</h2>
        </div>
        <Badge variant="secondary" className="text-xs" data-testid="badge-total-calls">{total} call{total !== 1 ? "s" : ""}</Badge>
      </div>

      <div className="px-4 py-3 border-b space-y-2">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <Input
              placeholder="Search notes..."
              className="pl-8 h-8 text-sm"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              data-testid="input-search-call-notes"
            />
          </div>
          <Button size="sm" className="h-8" onClick={handleApplyFilters} data-testid="button-apply-filters">
            Search
          </Button>
        </div>
        <div className="flex gap-2 items-center">
          <div className="flex items-center gap-1.5">
            <Calendar className="w-3.5 h-3.5 text-muted-foreground" />
            <Input
              type="date"
              className="h-7 text-xs w-[130px]"
              value={dateFrom}
              onChange={e => setDateFrom(e.target.value)}
              data-testid="input-date-from"
            />
            <span className="text-xs text-muted-foreground">to</span>
            <Input
              type="date"
              className="h-7 text-xs w-[130px]"
              value={dateTo}
              onChange={e => setDateTo(e.target.value)}
              data-testid="input-date-to"
            />
          </div>
          {(appliedSearch || appliedDateFrom || appliedDateTo) && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              onClick={() => {
                setSearchQuery("");
                setDateFrom("");
                setDateTo("");
                setAppliedSearch("");
                setAppliedDateFrom("");
                setAppliedDateTo("");
                setPage(1);
              }}
              data-testid="button-clear-filters"
            >
              Clear filters
            </Button>
          )}
        </div>
      </div>

      <ScrollArea className="flex-1">
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : calls.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center px-4">
            <FileText className="w-10 h-10 text-muted-foreground/40 mb-3" />
            <p className="text-sm font-medium text-muted-foreground">No call notes found</p>
            <p className="text-xs text-muted-foreground mt-1">
              {appliedSearch || appliedDateFrom || appliedDateTo
                ? "Try adjusting your search or date filters"
                : "Call notes will appear here after video calls end"}
            </p>
          </div>
        ) : (
          <div className="p-4 space-y-3">
            {calls.map(call => (
              <div key={call.id} className="border rounded-lg p-4 bg-card" data-testid={`call-note-entry-${call.id}`}>
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <Video className="w-4 h-4 text-primary shrink-0" />
                    <div>
                      <span className="text-sm font-medium" data-testid={`text-call-initiator-${call.id}`}>
                        {call.initiator.firstName} {call.initiator.lastName}
                      </span>
                      <button
                        className="ml-2 text-xs text-primary hover:underline"
                        onClick={() => onNavigateToConversation?.(call.conversationId)}
                        data-testid={`link-conversation-${call.id}`}
                      >
                        in {call.conversationName || (call.conversationType === "DIRECT" ? "Direct Message" : "Group Chat")}
                      </button>
                    </div>
                  </div>
                  <span className="text-xs text-muted-foreground shrink-0" data-testid={`text-call-date-${call.id}`}>
                    {new Date(call.startedAt).toLocaleDateString()} {new Date(call.startedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </span>
                </div>

                <div className="flex items-center gap-3 text-xs text-muted-foreground mb-3">
                  <span className="flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    {formatDuration(call.durationSeconds)}
                  </span>
                  <span className="flex items-center gap-1">
                    <Users className="w-3 h-3" />
                    {call.participants.length} participant{call.participants.length !== 1 ? "s" : ""}
                  </span>
                  <span className="text-muted-foreground/70">
                    {call.participants.map(p => `${p.user.firstName} ${p.user.lastName}`).join(", ")}
                  </span>
                </div>

                {call.notes.length === 0 ? (
                  <p className="text-xs text-muted-foreground italic">No notes taken</p>
                ) : (
                  <div className="space-y-2">
                    {call.notes.map(note => {
                      const isAi = hasAiSummary(note.content);
                      return (
                        <div key={note.id} className="rounded-md border bg-muted/50 p-3" data-testid={`note-content-${note.id}`}>
                          <div className="flex items-center gap-2 mb-1.5">
                            {note.author && (
                              <span className="text-xs font-medium text-foreground">
                                {note.author.firstName} {note.author.lastName}
                              </span>
                            )}
                            {isAi && (
                              <Badge variant="secondary" className="text-[10px] px-1.5 py-0 gap-1" data-testid={`badge-ai-summary-${note.id}`}>
                                <Sparkles className="w-2.5 h-2.5" />
                                AI Summary
                              </Badge>
                            )}
                            <span className="text-[10px] text-muted-foreground ml-auto">
                              {new Date(note.updatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                            </span>
                          </div>
                          <div className="text-xs text-foreground/80 whitespace-pre-wrap leading-relaxed">
                            {note.content || "(empty)"}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </ScrollArea>

      {totalPages > 1 && (
        <div className="flex items-center justify-between px-4 py-2 border-t">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs gap-1"
            onClick={() => setPage(p => Math.max(1, p - 1))}
            disabled={page <= 1}
            data-testid="button-prev-page"
          >
            <ChevronLeft className="w-3 h-3" /> Previous
          </Button>
          <span className="text-xs text-muted-foreground" data-testid="text-page-info">
            Page {page} of {totalPages}
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs gap-1"
            onClick={() => setPage(p => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages}
            data-testid="button-next-page"
          >
            Next <ChevronRight className="w-3 h-3" />
          </Button>
        </div>
      )}
    </div>
  );
}
