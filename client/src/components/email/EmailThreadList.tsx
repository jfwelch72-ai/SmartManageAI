import { useState, useMemo, useEffect } from "react";
import { formatDistanceToNow } from "date-fns";
import {
  Inbox,
  Search,
  Archive,
  ArchiveRestore,
  MailOpen,
  X,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { useUpdateThreadState } from "@/hooks/useEmailMutations";

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
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const updateThreadMutation = useUpdateThreadState();

  const filteredThreads = useMemo(
    () =>
      threads?.filter((thread) => {
        if (searchQuery) {
          const query = searchQuery.toLowerCase();
          if (!thread.subject.toLowerCase().includes(query)) {
            return false;
          }
        }
        return true;
      }),
    [threads, searchQuery],
  );

  const visibleIds = useMemo(
    () => filteredThreads?.map((t) => t.id) ?? [],
    [filteredThreads],
  );

  // Drop selections that are no longer visible (e.g. after filter change)
  useEffect(() => {
    if (selectedIds.size === 0) return;
    const visibleSet = new Set(visibleIds);
    let changed = false;
    const next = new Set<string>();
    selectedIds.forEach((id) => {
      if (visibleSet.has(id)) next.add(id);
      else changed = true;
    });
    if (changed) setSelectedIds(next);
  }, [visibleIds, selectedIds]);

  const allVisibleSelected =
    visibleIds.length > 0 && visibleIds.every((id) => selectedIds.has(id));
  const someVisibleSelected =
    visibleIds.some((id) => selectedIds.has(id)) && !allVisibleSelected;

  const toggleAll = () => {
    if (allVisibleSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(visibleIds));
    }
  };

  const toggleOne = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const runBulk = async (action: "read" | "archive" | "unarchive") => {
    const ids = Array.from(selectedIds);
    if (!ids.length) return;
    await Promise.all(
      ids.map((threadId) => {
        if (action === "read") {
          return updateThreadMutation.mutateAsync({ threadId, isRead: true });
        }
        if (action === "archive") {
          return updateThreadMutation.mutateAsync({ threadId, isArchived: true });
        }
        return updateThreadMutation.mutateAsync({ threadId, isArchived: false });
      }),
    );
    setSelectedIds(new Set());
  };

  const selectionAllArchived =
    selectedIds.size > 0 &&
    Array.from(selectedIds).every((id) => {
      const t = threads?.find((x) => x.id === id);
      return t?.status === "ARCHIVED";
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
        {visibleIds.length > 0 && (
          <div className="flex items-center justify-between gap-2 pt-1">
            <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer select-none">
              <Checkbox
                checked={allVisibleSelected ? true : someVisibleSelected ? "indeterminate" : false}
                onCheckedChange={toggleAll}
                data-testid="checkbox-select-all-threads"
                aria-label="Select all visible threads"
              />
              <span data-testid="text-selection-count">
                {selectedIds.size > 0
                  ? `${selectedIds.size} selected`
                  : "Select all"}
              </span>
            </label>
            {selectedIds.size > 0 && (
              <div className="flex items-center gap-1">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 px-2 text-xs"
                  disabled={updateThreadMutation.isPending}
                  onClick={() => runBulk("read")}
                  data-testid="button-bulk-mark-read"
                >
                  <MailOpen className="w-3.5 h-3.5 mr-1" />
                  Mark read
                </Button>
                {selectionAllArchived ? (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 px-2 text-xs"
                    disabled={updateThreadMutation.isPending}
                    onClick={() => runBulk("unarchive")}
                    data-testid="button-bulk-unarchive"
                  >
                    <ArchiveRestore className="w-3.5 h-3.5 mr-1" />
                    Restore
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 px-2 text-xs"
                    disabled={updateThreadMutation.isPending}
                    onClick={() => runBulk("archive")}
                    data-testid="button-bulk-archive"
                  >
                    <Archive className="w-3.5 h-3.5 mr-1" />
                    Archive
                  </Button>
                )}
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7"
                  onClick={() => setSelectedIds(new Set())}
                  data-testid="button-bulk-clear"
                  aria-label="Clear selection"
                >
                  <X className="w-3.5 h-3.5" />
                </Button>
              </div>
            )}
          </div>
        )}
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
            {filteredThreads.map((thread) => {
              const isArchived = thread.status === "ARCHIVED";
              const isSelected = selectedIds.has(thread.id);
              return (
                <div
                  key={thread.id}
                  className={`group relative w-full ${
                    selectedThread?.id === thread.id ? "bg-muted" : ""
                  } ${isSelected ? "bg-muted/40" : ""}`}
                >
                  <div className="absolute top-4 left-3 z-10">
                    <Checkbox
                      checked={isSelected}
                      onCheckedChange={() => toggleOne(thread.id)}
                      onClick={(e) => e.stopPropagation()}
                      data-testid={`checkbox-thread-${thread.id}`}
                      aria-label="Select thread"
                      className={isSelected ? "opacity-100" : "opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity"}
                    />
                  </div>
                  <button
                    onClick={() => onSelectThread(thread)}
                    className="w-full pl-10 pr-4 py-4 text-left hover:bg-muted/50 transition-colors"
                    data-testid={`thread-item-${thread.id}`}
                  >
                    <div className="flex items-start justify-between gap-2 mb-1 pr-16">
                      <span className={`font-medium text-sm line-clamp-1 ${thread.unreadCount > 0 ? "font-semibold" : ""}`}>
                        {thread.subject}
                      </span>
                      {thread.unreadCount > 0 && (
                        <Badge variant="default" className="text-xs shrink-0" data-testid={`badge-thread-unread-${thread.id}`}>
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
                  <div className="absolute top-2 right-2 flex items-center gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                    {thread.unreadCount > 0 && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={(e) => {
                          e.stopPropagation();
                          updateThreadMutation.mutate({ threadId: thread.id, isRead: true });
                        }}
                        disabled={updateThreadMutation.isPending}
                        data-testid={`button-list-mark-read-${thread.id}`}
                        title="Mark thread as read"
                      >
                        <MailOpen className="w-4 h-4" />
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={(e) => {
                        e.stopPropagation();
                        updateThreadMutation.mutate({ threadId: thread.id, isArchived: !isArchived });
                      }}
                      disabled={updateThreadMutation.isPending}
                      data-testid={`button-list-archive-${thread.id}`}
                      title={isArchived ? "Restore thread" : "Archive thread"}
                    >
                      {isArchived ? (
                        <ArchiveRestore className="w-4 h-4" />
                      ) : (
                        <Archive className="w-4 h-4" />
                      )}
                    </Button>
                  </div>
                </div>
              );
            })}
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
