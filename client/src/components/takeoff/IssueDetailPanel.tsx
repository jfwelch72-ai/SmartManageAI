import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { X, Trash2, Send, MessageSquare } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";

interface IssueDetailPanelProps {
  issue: any;
  sheetId: string;
  currentUser: any;
  orgUsers: any[];
  onClose: () => void;
  onDelete: () => void;
}

const STATUS_COLORS: Record<string, string> = {
  OPEN: "bg-red-500",
  IN_REVIEW: "bg-amber-500",
  RESOLVED: "bg-green-500",
};

const STATUS_LABELS: Record<string, string> = {
  OPEN: "Open",
  IN_REVIEW: "In Review",
  RESOLVED: "Resolved",
};

const CATEGORY_LABELS: Record<string, string> = {
  QUESTION: "Question",
  CONFLICT: "Conflict",
  RFI: "RFI",
  OBSERVATION: "Observation",
};

const SEVERITY_LABELS: Record<string, string> = {
  LOW: "Low",
  MEDIUM: "Medium",
  HIGH: "High",
  CRITICAL: "Critical",
};

const SEVERITY_COLORS: Record<string, string> = {
  LOW: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  MEDIUM: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
  HIGH: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400",
  CRITICAL: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
};

function canWrite(role: string): boolean {
  return ["ADMIN", "MANAGER", "ESTIMATOR", "SUPERINTENDENT", "SUPER_ADMIN"].includes(role);
}

export function IssueDetailPanel({ issue, sheetId, currentUser, orgUsers, onClose, onDelete }: IssueDetailPanelProps) {
  const { toast } = useToast();
  const [commentText, setCommentText] = useState("");
  const issuesQueryKey = [`/api/takeoff/sheets/${sheetId}/issues`];

  const updateMutation = useMutation({
    mutationFn: (updates: any) => apiRequest("PATCH", `/api/takeoff/issues/${issue.id}`, updates),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: issuesQueryKey });
    },
    onError: () => toast({ title: "Error", description: "Failed to update issue", variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: () => apiRequest("DELETE", `/api/takeoff/issues/${issue.id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: issuesQueryKey });
      onDelete();
    },
    onError: () => toast({ title: "Error", description: "Failed to delete issue", variant: "destructive" }),
  });

  const addCommentMutation = useMutation({
    mutationFn: (body: string) => apiRequest("POST", `/api/takeoff/issues/${issue.id}/comments`, { body }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: issuesQueryKey });
      setCommentText("");
    },
    onError: () => toast({ title: "Error", description: "Failed to add comment", variant: "destructive" }),
  });

  const deleteCommentMutation = useMutation({
    mutationFn: (commentId: string) => apiRequest("DELETE", `/api/takeoff/issue-comments/${commentId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: issuesQueryKey });
    },
    onError: () => toast({ title: "Error", description: "Failed to delete comment", variant: "destructive" }),
  });

  const userCanWrite = canWrite(currentUser?.role);
  const isAdmin = ["ADMIN", "MANAGER", "SUPER_ADMIN"].includes(currentUser?.role);
  const isCreator = issue.createdById === currentUser?.id;

  const comments = issue.comments || [];

  return (
    <div className="fixed inset-y-0 right-0 z-50 flex flex-col w-full max-w-md bg-card border-l shadow-xl" data-testid="issue-detail-panel">
      <div className="flex items-center justify-between px-4 py-3 border-b">
        <div className="flex items-center gap-2">
          <div className={cn("w-3 h-3 rounded-full", STATUS_COLORS[issue.status])} />
          <h2 className="font-semibold text-base" data-testid="text-issue-number">Issue #{issue.issueNumber}</h2>
          <Badge variant="outline" className="text-xs" data-testid="badge-issue-category">
            {CATEGORY_LABELS[issue.category] || issue.category}
          </Badge>
        </div>
        <div className="flex gap-1">
          {(isAdmin || isCreator) && (
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-destructive hover:text-destructive"
              onClick={() => {
                if (confirm("Delete this issue? This cannot be undone.")) {
                  deleteMutation.mutate();
                }
              }}
              disabled={deleteMutation.isPending}
              data-testid="button-delete-issue"
            >
              <Trash2 className="w-4 h-4" />
            </Button>
          )}
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onClose} data-testid="button-close-issue-panel">
            <X className="w-4 h-4" />
          </Button>
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-4 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Status</Label>
              {userCanWrite ? (
                <Select
                  value={issue.status}
                  onValueChange={(v) => updateMutation.mutate({ status: v })}
                  disabled={updateMutation.isPending}
                >
                  <SelectTrigger className="h-8 text-sm" data-testid="select-issue-status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="OPEN">Open</SelectItem>
                    <SelectItem value="IN_REVIEW">In Review</SelectItem>
                    <SelectItem value="RESOLVED">Resolved</SelectItem>
                  </SelectContent>
                </Select>
              ) : (
                <Badge variant="outline" className="text-xs">{STATUS_LABELS[issue.status]}</Badge>
              )}
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Severity</Label>
              {userCanWrite ? (
                <Select
                  value={issue.severity}
                  onValueChange={(v) => updateMutation.mutate({ severity: v })}
                  disabled={updateMutation.isPending}
                >
                  <SelectTrigger className="h-8 text-sm" data-testid="select-issue-severity">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="LOW">Low</SelectItem>
                    <SelectItem value="MEDIUM">Medium</SelectItem>
                    <SelectItem value="HIGH">High</SelectItem>
                    <SelectItem value="CRITICAL">Critical</SelectItem>
                  </SelectContent>
                </Select>
              ) : (
                <Badge className={cn("text-xs border-0", SEVERITY_COLORS[issue.severity])}>{SEVERITY_LABELS[issue.severity]}</Badge>
              )}
            </div>
          </div>

          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Category</Label>
            {userCanWrite ? (
              <Select
                value={issue.category}
                onValueChange={(v) => updateMutation.mutate({ category: v })}
                disabled={updateMutation.isPending}
              >
                <SelectTrigger className="h-8 text-sm" data-testid="select-issue-category">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="QUESTION">Question</SelectItem>
                  <SelectItem value="CONFLICT">Conflict</SelectItem>
                  <SelectItem value="RFI">RFI</SelectItem>
                  <SelectItem value="OBSERVATION">Observation</SelectItem>
                </SelectContent>
              </Select>
            ) : (
              <span className="text-sm">{CATEGORY_LABELS[issue.category]}</span>
            )}
          </div>

          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Assignee</Label>
            {userCanWrite ? (
              <Select
                value={issue.assigneeId || "unassigned"}
                onValueChange={(v) => updateMutation.mutate({ assigneeId: v === "unassigned" ? null : v })}
                disabled={updateMutation.isPending}
              >
                <SelectTrigger className="h-8 text-sm" data-testid="select-issue-assignee">
                  <SelectValue placeholder="Unassigned" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="unassigned">Unassigned</SelectItem>
                  {orgUsers.map((u) => (
                    <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <span className="text-sm">
                {issue.assigneeId ? (orgUsers.find(u => u.id === issue.assigneeId)?.name || "Unknown") : "Unassigned"}
              </span>
            )}
          </div>

          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Description</Label>
            {userCanWrite ? (
              <Textarea
                defaultValue={issue.description}
                onBlur={(e) => {
                  if (e.target.value !== issue.description) {
                    updateMutation.mutate({ description: e.target.value });
                  }
                }}
                rows={3}
                className="text-sm resize-none"
                placeholder="Describe the issue..."
                data-testid="input-issue-description"
              />
            ) : (
              <p className="text-sm text-muted-foreground">{issue.description || "No description"}</p>
            )}
          </div>

          <Separator />

          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <MessageSquare className="w-4 h-4 text-muted-foreground" />
              <h3 className="font-medium text-sm">Comments ({comments.length})</h3>
            </div>

            <div className="space-y-3">
              {comments.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-2">No comments yet</p>
              ) : (
                comments.map((comment: any) => (
                  <div key={comment.id} className="flex gap-2 group" data-testid={`comment-item-${comment.id}`}>
                    <Avatar className="h-7 w-7 shrink-0">
                      <AvatarImage src={comment.authorAvatarUrl} />
                      <AvatarFallback className="text-xs">
                        {(comment.authorName || "?").charAt(0).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-1">
                        <span className="text-xs font-medium">{comment.authorName || "Unknown"}</span>
                        <div className="flex items-center gap-1">
                          <span className="text-[10px] text-muted-foreground">
                            {comment.createdAt ? formatDistanceToNow(new Date(comment.createdAt), { addSuffix: true }) : ""}
                          </span>
                          {(isAdmin || comment.authorId === currentUser?.id) && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-5 w-5 opacity-0 group-hover:opacity-100"
                              onClick={() => deleteCommentMutation.mutate(comment.id)}
                              data-testid={`button-delete-comment-${comment.id}`}
                            >
                              <X className="w-3 h-3" />
                            </Button>
                          )}
                        </div>
                      </div>
                      <p className="text-sm mt-0.5 break-words">{comment.body}</p>
                    </div>
                  </div>
                ))
              )}
            </div>

            <div className="flex gap-2 pt-1">
              <Textarea
                value={commentText}
                onChange={(e) => setCommentText(e.target.value)}
                placeholder="Add a comment..."
                rows={2}
                className="text-sm resize-none flex-1"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey && commentText.trim()) {
                    e.preventDefault();
                    addCommentMutation.mutate(commentText.trim());
                  }
                }}
                data-testid="input-issue-comment"
              />
              <Button
                size="icon"
                className="self-end h-9 w-9"
                disabled={!commentText.trim() || addCommentMutation.isPending}
                onClick={() => addCommentMutation.mutate(commentText.trim())}
                data-testid="button-submit-comment"
              >
                <Send className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </div>
      </ScrollArea>
    </div>
  );
}
