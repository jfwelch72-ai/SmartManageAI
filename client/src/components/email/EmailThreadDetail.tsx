import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import {
  Sparkles,
  ChevronRight,
  CheckCircle2,
  Loader2,
  Send,
  Link2,
  User,
  Paperclip,
  ExternalLink,
  Clock,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { ClassificationBadge, StatusBadge, PriorityBadge } from "./shared";
import type { EmailThread, EmailMessage, EmailTask } from "./shared";
import {
  useSummarizeThread,
  useAnalyzeMessage,
  useSuggestReply,
  useUpdateTask,
} from "@/hooks/useEmailMutations";

interface ThreadDetailViewProps {
  thread: EmailThread;
  onClose: () => void;
}

export function EmailThreadDetail({ thread, onClose }: ThreadDetailViewProps) {
  const summarizeMutation = useSummarizeThread(thread.id);

  const { data: threadData, isLoading } = useQuery<{
    thread: EmailThread;
    messages: EmailMessage[];
    tasks: EmailTask[];
  }>({
    queryKey: ["/api/email/threads", thread.id],
  });

  const messages = threadData?.messages || [];
  const tasks = threadData?.tasks || [];

  return (
    <div className="flex-1 flex flex-col">
      <div className="border-b p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={onClose} data-testid="button-close-thread">
            <ChevronRight className="w-4 h-4 rotate-180" />
          </Button>
          <div>
            <h2 className="font-medium">{thread.subject}</h2>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              <ClassificationBadge classification={thread.primaryClassification} />
              <span className="text-xs text-muted-foreground">
                {thread.messageCount} messages
              </span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap ml-12 sm:ml-0">
          <Button
            variant="outline"
            size="sm"
            onClick={() => summarizeMutation.mutate()}
            disabled={summarizeMutation.isPending}
            data-testid="button-summarize-thread"
          >
            {summarizeMutation.isPending ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <Sparkles className="w-4 h-4 mr-2" />
            )}
            Summarize
          </Button>
          {thread.projectId && (
            <Button variant="outline" size="sm" asChild>
              <a href={`/projects/${thread.projectId}`} data-testid="link-view-project">
                <ExternalLink className="w-4 h-4 mr-2" />
                View Project
              </a>
            </Button>
          )}
        </div>
      </div>

      {thread.aiSummary && (
        <div className="mx-4 mt-4 p-4 bg-muted/50 rounded-lg border">
          <div className="flex items-center gap-2 mb-2">
            <Sparkles className="w-4 h-4 text-primary" />
            <span className="font-medium text-sm">AI Summary</span>
          </div>
          <p className="text-sm text-muted-foreground">{thread.aiSummary}</p>
        </div>
      )}

      <ScrollArea className="flex-1 p-4">
        {isLoading ? (
          <div className="space-y-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-32 w-full" />
            ))}
          </div>
        ) : (
          <div className="space-y-4">
            {messages.map((message) => (
              <MessageCard key={message.id} message={message} />
            ))}
          </div>
        )}
      </ScrollArea>

      {tasks.length > 0 && (
        <div className="border-t p-4">
          <h4 className="font-medium text-sm mb-3 flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4" />
            Related Tasks ({tasks.length})
          </h4>
          <div className="space-y-2">
            {tasks.slice(0, 2).map((task) => (
              <div key={task.id} className="flex items-center justify-between p-2 border rounded">
                <span className="text-sm">{task.title}</span>
                <StatusBadge status={task.status} />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function MessageCard({ message }: { message: EmailMessage }) {
  const [showReplySuggestions, setShowReplySuggestions] = useState(false);
  const analyzeMutation = useAnalyzeMessage();
  const suggestReplyMutation = useSuggestReply(message.id);

  return (
    <Card data-testid={`message-card-${message.id}`}>
      <CardHeader className="pb-2">
        <div className="flex flex-col sm:flex-row items-start justify-between gap-2">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center shrink-0">
              <User className="w-5 h-5 text-muted-foreground" />
            </div>
            <div>
              <div className="font-medium">
                {message.fromName || message.fromAddress}
              </div>
              <div className="text-xs text-muted-foreground">
                {format(new Date(message.receivedAt), "MMM d, yyyy 'at' h:mm a")}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <ClassificationBadge classification={message.classification} />
            {message.hasAttachments && (
              <Badge variant="outline" className="gap-1">
                <Paperclip className="w-3 h-3" />
                Attachments
              </Badge>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground whitespace-pre-wrap">
          {message.bodyText || message.snippet || "(No content)"}
        </p>
        <div className="flex items-center gap-2 mt-4 flex-wrap">
          <Button
            variant="outline"
            size="sm"
            onClick={() => analyzeMutation.mutate(message.id)}
            disabled={analyzeMutation.isPending}
            data-testid={`button-analyze-message-${message.id}`}
          >
            {analyzeMutation.isPending ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <Sparkles className="w-4 h-4 mr-2" />
            )}
            Analyze
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              suggestReplyMutation.mutate(undefined, {
                onSuccess: () => setShowReplySuggestions(true),
              });
            }}
            disabled={suggestReplyMutation.isPending}
            data-testid={`button-suggest-reply-${message.id}`}
          >
            {suggestReplyMutation.isPending ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <Send className="w-4 h-4 mr-2" />
            )}
            Suggest Reply
          </Button>
        </div>

        {showReplySuggestions && suggestReplyMutation.data && (
          <div className="mt-4 space-y-3">
            <Separator />
            <h4 className="font-medium text-sm flex items-center gap-2">
              <Send className="w-4 h-4" />
              Suggested Replies
            </h4>
            {(suggestReplyMutation.data as any).drafts?.map((draft: any, i: number) => (
              <div key={i} className="p-3 bg-muted/50 rounded-lg">
                <div className="flex items-center justify-between mb-2">
                  <Badge variant="outline">{draft.tone}</Badge>
                  <Button variant="ghost" size="sm">
                    Copy
                  </Button>
                </div>
                <p className="text-sm whitespace-pre-wrap">{draft.body}</p>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function TaskCard({ task }: { task: EmailTask }) {
  const updateTaskMutation = useUpdateTask();

  return (
    <Card data-testid={`task-card-${task.id}`}>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-1">
              <span className="font-medium">{task.title}</span>
              <PriorityBadge priority={task.priority} />
            </div>
            {task.description && (
              <p className="text-sm text-muted-foreground mb-2 line-clamp-2">
                {task.description}
              </p>
            )}
            <div className="flex items-center gap-4 text-xs text-muted-foreground">
              <StatusBadge status={task.status} />
              {task.dueDate && (
                <span className="flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  Due {format(new Date(task.dueDate), "MMM d")}
                </span>
              )}
              {task.emailThreadId && (
                <span className="flex items-center gap-1">
                  <Link2 className="w-3 h-3" />
                  Linked to email
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {task.status === "PENDING" && (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => updateTaskMutation.mutate({ taskId: task.id, status: "IN_PROGRESS" })}
                  disabled={updateTaskMutation.isPending}
                  data-testid={`button-start-task-${task.id}`}
                >
                  Start
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => updateTaskMutation.mutate({ taskId: task.id, status: "COMPLETED" })}
                  disabled={updateTaskMutation.isPending}
                  data-testid={`button-complete-task-${task.id}`}
                >
                  <CheckCircle2 className="w-4 h-4" />
                </Button>
              </>
            )}
            {task.status === "IN_PROGRESS" && (
              <Button
                size="sm"
                onClick={() => updateTaskMutation.mutate({ taskId: task.id, status: "COMPLETED" })}
                disabled={updateTaskMutation.isPending}
                data-testid={`button-complete-task-${task.id}`}
              >
                Complete
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
