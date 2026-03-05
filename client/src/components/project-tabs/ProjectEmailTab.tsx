import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Mail, XCircle, ExternalLink, MessageSquare, Loader2, Sparkles } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { apiRequest } from "@/lib/queryClient";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";

interface ProjectEmailThread {
  id: string;
  subject: string;
  snippet: string | null;
  primaryClassification: string | null;
  status: string;
  messageCount: number;
  unreadCount: number;
  lastMessageAt: string;
  aiSummary: string | null;
}

interface ProjectEmailTabProps {
  projectId: string;
  projectCode: string;
  userRole: string;
}

const classificationColors: Record<string, string> = {
  BID_INVITE: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  CHANGE_ORDER: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200",
  SUBMITTAL_REQUEST: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200",
  DELAY_NOTICE: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
  SAFETY_ISSUE: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
  APPROVAL_NEEDED: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
  GENERAL: "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200",
};

export default function ProjectEmailTab({ projectId, projectCode, userRole }: ProjectEmailTabProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedThread, setSelectedThread] = useState<ProjectEmailThread | null>(null);

  const { data: emailThreads = [], isLoading } = useQuery<ProjectEmailThread[]>({
    queryKey: ["/api/email/threads", { projectId }],
  });

  const linkEmailMutation = useMutation({
    mutationFn: async (threadId: string) => {
      const res = await apiRequest("POST", `/api/email/threads/${threadId}/link`, { projectId });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Email linked", description: "Email thread linked to this project" });
      queryClient.invalidateQueries({ queryKey: ["/api/email/threads", { projectId }] });
    },
    onError: () => {
      toast({ title: "Failed to link email", variant: "destructive" });
    },
  });

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Mail className="w-5 h-5" />
                Project Emails
              </CardTitle>
              <CardDescription>
                Email threads linked to project {projectCode}
              </CardDescription>
            </div>
            <div className="w-full sm:w-auto flex gap-2">
              <Button variant="outline" size="sm" asChild data-testid="link-email-assistant" className="w-full sm:w-auto">
                <Link href="/email-assistant">
                  <ExternalLink className="w-4 h-4 mr-2" />
                  Open Email Assistant
                </Link>
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {emailThreads.length === 0 ? (
            <div className="text-center py-12">
              <Mail className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
              <h3 className="font-medium text-lg mb-2">No emails linked</h3>
              <p className="text-sm text-muted-foreground mb-4">
                Link email threads to this project from the Email Assistant
              </p>
              <Button variant="outline" asChild data-testid="button-go-email-assistant">
                <Link href="/email-assistant">Go to Email Assistant</Link>
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              {emailThreads.map((thread) => (
                <div
                  key={thread.id}
                  className="p-4 border rounded-lg hover-elevate cursor-pointer"
                  onClick={() => setSelectedThread(thread)}
                  data-testid={`email-thread-${thread.id}`}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <h4 className="font-medium truncate">{thread.subject}</h4>
                        {thread.unreadCount > 0 && (
                          <Badge variant="default" className="text-xs">
                            {thread.unreadCount} new
                          </Badge>
                        )}
                      </div>
                      <p className="text-sm text-muted-foreground line-clamp-2">
                        {thread.snippet || thread.aiSummary || "No preview available"}
                      </p>
                      <div className="flex items-center gap-2 mt-2">
                        {thread.primaryClassification && (
                          <Badge 
                            variant="outline" 
                            className={classificationColors[thread.primaryClassification] || ""}
                          >
                            {thread.primaryClassification.replace(/_/g, " ")}
                          </Badge>
                        )}
                        <span className="text-xs text-muted-foreground flex items-center gap-1">
                          <MessageSquare className="w-3 h-3" />
                          {thread.messageCount} messages
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {format(new Date(thread.lastMessageAt), "MMM d, h:mm a")}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {selectedThread && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-4">
            <CardTitle>{selectedThread.subject}</CardTitle>
            <Button 
              variant="ghost" 
              size="sm" 
              onClick={() => setSelectedThread(null)}
              data-testid="button-close-thread-detail"
            >
              <XCircle className="w-4 h-4" />
            </Button>
          </CardHeader>
          <CardContent>
            {selectedThread.aiSummary && (
              <div className="p-4 bg-muted/50 rounded-lg mb-4">
                <div className="flex items-center gap-2 mb-2">
                  <Sparkles className="w-4 h-4 text-primary" />
                  <span className="font-medium text-sm">AI Summary</span>
                </div>
                <p className="text-sm text-muted-foreground">{selectedThread.aiSummary}</p>
              </div>
            )}
            <p className="text-sm text-muted-foreground">
              View full thread details in the Email Assistant for complete message history and actions.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
