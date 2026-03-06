import { useState } from "react";
import { formatDistanceToNow } from "date-fns";
import {
  Inbox,
  Search,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { ClassificationBadge, CLASSIFICATION_LABELS } from "./shared";
import type { EmailThread } from "./shared";

interface EmailThreadListProps {
  threads: EmailThread[] | undefined;
  threadsLoading: boolean;
  selectedThread: EmailThread | null;
  onSelectThread: (thread: EmailThread) => void;
  filterStatus: string;
  onFilterStatusChange: (status: string) => void;
  filterClassification: string;
  onFilterClassificationChange: (classification: string) => void;
}

export function EmailThreadList({
  threads,
  threadsLoading,
  selectedThread,
  onSelectThread,
  filterStatus,
  onFilterStatusChange,
  filterClassification,
  onFilterClassificationChange,
}: EmailThreadListProps) {
  const [searchQuery, setSearchQuery] = useState("");

  const filteredThreads = threads?.filter((thread) => {
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      if (!thread.subject.toLowerCase().includes(query)) {
        return false;
      }
    }
    return true;
  });

  return (
    <>
      <div className="p-4 border-b space-y-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search emails..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
            data-testid="input-search-emails"
          />
        </div>
        <div className="flex gap-2">
          <Select value={filterStatus} onValueChange={onFilterStatusChange}>
            <SelectTrigger className="flex-1" data-testid="select-status-filter">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="OPEN">Open</SelectItem>
              <SelectItem value="ARCHIVED">Archived</SelectItem>
              <SelectItem value="IGNORED">Ignored</SelectItem>
            </SelectContent>
          </Select>
          <Select value={filterClassification} onValueChange={onFilterClassificationChange}>
            <SelectTrigger className="flex-1" data-testid="select-classification-filter">
              <SelectValue placeholder="Type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Types</SelectItem>
              {Object.entries(CLASSIFICATION_LABELS).map(([key, config]) => (
                <SelectItem key={key} value={key}>
                  {config.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <ScrollArea className="flex-1">
        {threadsLoading ? (
          <div className="p-4 space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="space-y-2">
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-3 w-1/2" />
              </div>
            ))}
          </div>
        ) : filteredThreads && filteredThreads.length > 0 ? (
          <div className="divide-y">
            {filteredThreads.map((thread) => (
              <button
                key={thread.id}
                onClick={() => onSelectThread(thread)}
                className={`w-full p-4 text-left hover:bg-muted/50 transition-colors ${
                  selectedThread?.id === thread.id ? "bg-muted" : ""
                }`}
                data-testid={`thread-item-${thread.id}`}
              >
                <div className="flex items-start justify-between gap-2 mb-1">
                  <span className={`font-medium text-sm line-clamp-1 ${thread.unreadCount > 0 ? "font-semibold" : ""}`}>
                    {thread.subject}
                  </span>
                  {thread.unreadCount > 0 && (
                    <Badge variant="default" className="text-xs shrink-0">
                      {thread.unreadCount}
                    </Badge>
                  )}
                </div>
                <div className="flex items-center gap-2 mb-2">
                  <ClassificationBadge classification={thread.primaryClassification} />
                </div>
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>{thread.messageCount} messages</span>
                  <span>{formatDistanceToNow(new Date(thread.lastMessageAt))} ago</span>
                </div>
              </button>
            ))}
          </div>
        ) : (
          <div className="p-8 text-center text-muted-foreground">
            <Inbox className="w-12 h-12 mx-auto mb-3 opacity-50" />
            <p>No email threads found</p>
            <p className="text-sm mt-1">
              {searchQuery ? "Try a different search" : "Sync your email to get started"}
            </p>
          </div>
        )}
      </ScrollArea>
    </>
  );
}
