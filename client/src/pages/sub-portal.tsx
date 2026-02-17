import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  FileText,
  Send,
  MessageSquare,
  Upload,
  CheckCircle2,
  Clock,
  AlertTriangle,
  Paperclip,
  Building2,
  FolderOpen,
  Download,
  Loader2,
  Shield,
  Eye,
  ExternalLink,
} from "lucide-react";

function getStatusBadgeClass(status: string) {
  const s = (status || "").toUpperCase().replace(/\s+/g, "_");
  if (s === "DRAFT") return "";
  if (["OPEN", "SUBMITTED", "SENT"].includes(s))
    return "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200";
  if (["IN_REVIEW", "UNDER_REVIEW"].includes(s))
    return "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200";
  if (["ANSWERED", "APPROVED", "ACKNOWLEDGED"].includes(s))
    return "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200";
  if (["CLOSED", "SUPERSEDED"].includes(s))
    return "bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200";
  if (s === "REJECTED")
    return "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200";
  return "";
}

function StatusBadge({ status }: { status: string }) {
  const cls = getStatusBadgeClass(status);
  return (
    <Badge
      variant={cls ? "outline" : "default"}
      className={cls}
      data-testid={`badge-status-${status}`}
    >
      {(status || "").replace(/_/g, " ")}
    </Badge>
  );
}

function formatDate(d: string | null | undefined) {
  if (!d) return "N/A";
  try {
    return new Date(d).toLocaleDateString();
  } catch {
    return d;
  }
}

function parseAttachments(json: unknown): Array<{ name: string; url: string; size?: number }> {
  if (!json) return [];
  if (Array.isArray(json)) return json;
  if (typeof json === "string") {
    try {
      const parsed = JSON.parse(json);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

export default function SubPortalPage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const token = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get("token") || "";
  }, []);

  const [selectedRfi, setSelectedRfi] = useState<any>(null);
  const [selectedSubmittal, setSelectedSubmittal] = useState<any>(null);
  const [selectedTransmittal, setSelectedTransmittal] = useState<any>(null);
  const [rfiComment, setRfiComment] = useState("");
  const [submittalComment, setSubmittalComment] = useState("");
  const [chatMessage, setChatMessage] = useState("");
  const [selectedThread, setSelectedThread] = useState<any>(null);
  const [newThreadSubject, setNewThreadSubject] = useState("");
  const [newThreadMessage, setNewThreadMessage] = useState("");
  const [showNewThread, setShowNewThread] = useState(false);

  const {
    data: portalInfo,
    isLoading: infoLoading,
    isError: infoError,
  } = useQuery({
    queryKey: ["/api/portal/info", { token }],
    queryFn: async () => {
      const res = await fetch(`/api/portal/info?token=${token}`);
      if (!res.ok) throw new Error("Invalid token");
      return res.json();
    },
    enabled: !!token,
  });

  const { data: rfis = [], isLoading: rfisLoading } = useQuery({
    queryKey: ["/api/portal/rfis", { token }],
    queryFn: async () => {
      const res = await fetch(`/api/portal/rfis?token=${token}`);
      if (!res.ok) throw new Error("Failed to load RFIs");
      return res.json();
    },
    enabled: !!token && !!portalInfo,
  });

  const { data: submittals = [], isLoading: submittalsLoading } = useQuery({
    queryKey: ["/api/portal/submittals", { token }],
    queryFn: async () => {
      const res = await fetch(`/api/portal/submittals?token=${token}`);
      if (!res.ok) throw new Error("Failed to load submittals");
      return res.json();
    },
    enabled: !!token && !!portalInfo,
  });

  const { data: transmittals = [], isLoading: transmittalsLoading } = useQuery({
    queryKey: ["/api/portal/transmittals", { token }],
    queryFn: async () => {
      const res = await fetch(`/api/portal/transmittals?token=${token}`);
      if (!res.ok) throw new Error("Failed to load transmittals");
      return res.json();
    },
    enabled: !!token && !!portalInfo,
  });

  const rfiCommentMutation = useMutation({
    mutationFn: async ({ id, comment }: { id: string; comment: string }) => {
      const res = await fetch(`/api/portal/rfis/${id}/comment`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-portal-token": token,
        },
        body: JSON.stringify({ comment }),
      });
      if (!res.ok) throw new Error("Failed to post comment");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/portal/rfis"] });
      toast({ title: "Comment posted" });
      setRfiComment("");
    },
    onError: () => {
      toast({ title: "Failed to post comment", variant: "destructive" });
    },
  });

  const submittalCommentMutation = useMutation({
    mutationFn: async ({ id, comment }: { id: string; comment: string }) => {
      const res = await fetch(`/api/portal/submittals/${id}/comment`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-portal-token": token,
        },
        body: JSON.stringify({ comment }),
      });
      if (!res.ok) throw new Error("Failed to post comment");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/portal/submittals"] });
      toast({ title: "Comment posted" });
      setSubmittalComment("");
    },
    onError: () => {
      toast({ title: "Failed to post comment", variant: "destructive" });
    },
  });

  const uploadMutation = useMutation({
    mutationFn: async (data: {
      id: string;
      fileUrl: string;
      fileName: string;
      fileSize: number;
      mimeType: string;
    }) => {
      const res = await fetch(`/api/portal/submittals/${data.id}/upload`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-portal-token": token,
        },
        body: JSON.stringify({
          fileUrl: data.fileUrl,
          fileName: data.fileName,
          fileSize: data.fileSize,
          mimeType: data.mimeType,
        }),
      });
      if (!res.ok) throw new Error("Failed to upload");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/portal/submittals"] });
      toast({ title: "File uploaded successfully" });
    },
    onError: () => {
      toast({ title: "Failed to upload file", variant: "destructive" });
    },
  });

  const acknowledgeMutation = useMutation({
    mutationFn: async ({ id }: { id: string }) => {
      const res = await fetch(`/api/portal/transmittals/${id}/acknowledge`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-portal-token": token,
        },
      });
      if (!res.ok) throw new Error("Failed to acknowledge");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["/api/portal/transmittals"],
      });
      toast({ title: "Receipt acknowledged" });
    },
    onError: () => {
      toast({ title: "Failed to acknowledge receipt", variant: "destructive" });
    },
  });

  const { data: chatThreads = [], isLoading: chatLoading } = useQuery({
    queryKey: ["/api/portal/chat/threads", { token }],
    queryFn: async () => {
      const res = await fetch(`/api/portal/chat/threads`, {
        headers: { "x-portal-token": token },
      });
      if (!res.ok) throw new Error("Failed to load chat threads");
      return res.json();
    },
    enabled: !!token && !!portalInfo,
  });

  const { data: threadMessages = [], isLoading: messagesLoading } = useQuery({
    queryKey: ["/api/portal/chat/threads", selectedThread?.id, "messages"],
    queryFn: async () => {
      const res = await fetch(`/api/portal/chat/threads/${selectedThread.id}/messages`, {
        headers: { "x-portal-token": token },
      });
      if (!res.ok) throw new Error("Failed to load messages");
      return res.json();
    },
    enabled: !!token && !!selectedThread,
  });

  const createThreadMutation = useMutation({
    mutationFn: async (data: { subject: string; message: string }) => {
      const res = await fetch(`/api/portal/chat/threads`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-portal-token": token },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Failed to create thread");
      return res.json();
    },
    onSuccess: (result: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/portal/chat/threads", { token }] });
      setSelectedThread(result);
      setShowNewThread(false);
      setNewThreadSubject("");
      setNewThreadMessage("");
      toast({ title: "Conversation started" });
    },
    onError: () => {
      toast({ title: "Failed to start conversation", variant: "destructive" });
    },
  });

  const sendMessageMutation = useMutation({
    mutationFn: async (data: { threadId: string; content: string }) => {
      const res = await fetch(`/api/portal/chat/threads/${data.threadId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-portal-token": token },
        body: JSON.stringify({ content: data.content }),
      });
      if (!res.ok) throw new Error("Failed to send message");
      return res.json();
    },
    onSuccess: (_: any, vars: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/portal/chat/threads", vars.threadId, "messages"] });
      queryClient.invalidateQueries({ queryKey: ["/api/portal/chat/threads", { token }] });
      setChatMessage("");
    },
    onError: () => {
      toast({ title: "Failed to send message", variant: "destructive" });
    },
  });

  const markReadMutation = useMutation({
    mutationFn: async (threadId: string) => {
      const res = await fetch(`/api/portal/chat/threads/${threadId}/read`, {
        method: "POST",
        headers: { "x-portal-token": token },
      });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/portal/chat/threads", { token }] });
    },
  });

  if (!token) {
    return (
      <div
        className="min-h-screen flex items-center justify-center bg-background p-4"
        data-testid="container-no-token"
      >
        <Card className="max-w-md w-full">
          <CardHeader className="text-center">
            <div className="mx-auto mb-4">
              <Shield className="h-12 w-12 text-muted-foreground" />
            </div>
            <CardTitle className="text-xl">Access Link Required</CardTitle>
          </CardHeader>
          <CardContent>
            <p
              className="text-muted-foreground text-center text-sm"
              data-testid="text-no-token-message"
            >
              This page requires a valid access link. Please check the
              invitation email you received.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (infoLoading) {
    return (
      <div
        className="min-h-screen flex items-center justify-center bg-background"
        data-testid="container-loading"
      >
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          <p className="text-muted-foreground text-sm">
            Validating access...
          </p>
        </div>
      </div>
    );
  }

  if (infoError || !portalInfo) {
    return (
      <div
        className="min-h-screen flex items-center justify-center bg-background p-4"
        data-testid="container-invalid-token"
      >
        <Card className="max-w-md w-full">
          <CardHeader className="text-center">
            <div className="mx-auto mb-4">
              <AlertTriangle className="h-12 w-12 text-destructive" />
            </div>
            <CardTitle className="text-xl">Access Denied</CardTitle>
          </CardHeader>
          <CardContent>
            <p
              className="text-muted-foreground text-center text-sm"
              data-testid="text-invalid-token-message"
            >
              Your access link has expired or been revoked. Please contact your
              general contractor for a new invitation.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background" data-testid="container-portal">
      <header
        className="border-b bg-card"
        data-testid="header-portal"
      >
        <div className="max-w-6xl mx-auto px-4 py-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Shield className="h-6 w-6 text-primary" />
            <div>
              <h1
                className="text-lg font-semibold"
                data-testid="text-portal-title"
              >
                Subcontractor Portal
              </h1>
              <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                {portalInfo.projectName && (
                  <span
                    className="flex items-center gap-1"
                    data-testid="text-project-name"
                  >
                    <Building2 className="h-3.5 w-3.5" />
                    {portalInfo.projectName}
                  </span>
                )}
                {portalInfo.companyName && (
                  <span data-testid="text-company-name">
                    {portalInfo.companyName}
                  </span>
                )}
              </div>
            </div>
          </div>
          <Badge
            variant="outline"
            className="bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-300"
            data-testid="badge-secure-access"
          >
            <Shield className="h-3 w-3 mr-1" />
            Secure Access
          </Badge>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-6">
        <Tabs defaultValue="rfis" data-testid="tabs-portal">
          <TabsList data-testid="tabs-list">
            <TabsTrigger value="rfis" data-testid="tab-rfis">
              <FileText className="h-4 w-4 mr-1.5" />
              RFIs
            </TabsTrigger>
            <TabsTrigger value="submittals" data-testid="tab-submittals">
              <FolderOpen className="h-4 w-4 mr-1.5" />
              Submittals
            </TabsTrigger>
            <TabsTrigger value="transmittals" data-testid="tab-transmittals">
              <Send className="h-4 w-4 mr-1.5" />
              Transmittals
            </TabsTrigger>
            <TabsTrigger value="chat" data-testid="tab-chat">
              <MessageSquare className="h-4 w-4 mr-1.5" />
              Chat
              {chatThreads.some((t: any) => t.portalUnreadCount > 0) && (
                <span className="ml-1 inline-flex items-center justify-center h-4 min-w-[1rem] rounded-full bg-destructive text-destructive-foreground text-xs px-1">
                  {chatThreads.reduce((sum: number, t: any) => sum + (t.portalUnreadCount || 0), 0)}
                </span>
              )}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="rfis" data-testid="content-rfis">
            {rfisLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : rfis.length === 0 ? (
              <Card data-testid="empty-rfis">
                <CardContent className="py-12 text-center">
                  <FileText className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
                  <p className="text-muted-foreground text-sm">
                    No RFIs found for this project.
                  </p>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-2">
                {rfis.map((rfi: any) => (
                  <Card
                    key={rfi.id}
                    className="cursor-pointer hover-elevate"
                    onClick={() => setSelectedRfi(rfi)}
                    data-testid={`card-rfi-${rfi.id}`}
                  >
                    <CardContent className="p-4">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <div className="flex flex-wrap items-center gap-2 mb-1">
                            <span
                              className="font-medium text-sm"
                              data-testid={`text-rfi-number-${rfi.id}`}
                            >
                              {rfi.rfiNumber}
                            </span>
                            <StatusBadge status={rfi.status} />
                            {rfi.priority && (
                              <Badge
                                variant="outline"
                                className="text-xs"
                                data-testid={`badge-rfi-priority-${rfi.id}`}
                              >
                                {rfi.priority}
                              </Badge>
                            )}
                          </div>
                          <p
                            className="text-sm truncate"
                            data-testid={`text-rfi-subject-${rfi.id}`}
                          >
                            {rfi.subject}
                          </p>
                        </div>
                        <span
                          className="text-xs text-muted-foreground flex items-center gap-1"
                          data-testid={`text-rfi-date-${rfi.id}`}
                        >
                          <Clock className="h-3 w-3" />
                          {formatDate(rfi.dateSubmitted)}
                        </span>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="submittals" data-testid="content-submittals">
            {submittalsLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : submittals.length === 0 ? (
              <Card data-testid="empty-submittals">
                <CardContent className="py-12 text-center">
                  <FolderOpen className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
                  <p className="text-muted-foreground text-sm">
                    No submittals found for this project.
                  </p>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-2">
                {submittals.map((sub: any) => (
                  <Card
                    key={sub.id}
                    className="cursor-pointer hover-elevate"
                    onClick={() => setSelectedSubmittal(sub)}
                    data-testid={`card-submittal-${sub.id}`}
                  >
                    <CardContent className="p-4">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <div className="flex flex-wrap items-center gap-2 mb-1">
                            <span
                              className="font-medium text-sm"
                              data-testid={`text-submittal-number-${sub.id}`}
                            >
                              {sub.submittalNumber}
                            </span>
                            <StatusBadge status={sub.status} />
                            {sub.submittalType && (
                              <Badge
                                variant="outline"
                                className="text-xs"
                                data-testid={`badge-submittal-type-${sub.id}`}
                              >
                                {sub.submittalType}
                              </Badge>
                            )}
                          </div>
                          <p
                            className="text-sm truncate"
                            data-testid={`text-submittal-subject-${sub.id}`}
                          >
                            {sub.subject}
                          </p>
                        </div>
                        {sub.phase && (
                          <span
                            className="text-xs text-muted-foreground"
                            data-testid={`text-submittal-phase-${sub.id}`}
                          >
                            {sub.phase}
                          </span>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="transmittals" data-testid="content-transmittals">
            {transmittalsLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : transmittals.length === 0 ? (
              <Card data-testid="empty-transmittals">
                <CardContent className="py-12 text-center">
                  <Send className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
                  <p className="text-muted-foreground text-sm">
                    No transmittals found for this project.
                  </p>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-2">
                {transmittals.map((tr: any) => (
                  <Card
                    key={tr.id}
                    className="cursor-pointer hover-elevate"
                    onClick={() => setSelectedTransmittal(tr)}
                    data-testid={`card-transmittal-${tr.id}`}
                  >
                    <CardContent className="p-4">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <div className="flex flex-wrap items-center gap-2 mb-1">
                            <span
                              className="font-medium text-sm"
                              data-testid={`text-transmittal-number-${tr.id}`}
                            >
                              {tr.transmittalNumber}
                            </span>
                            <StatusBadge status={tr.status} />
                            {tr.documentType && (
                              <Badge
                                variant="outline"
                                className="text-xs"
                                data-testid={`badge-transmittal-doctype-${tr.id}`}
                              >
                                {tr.documentType}
                              </Badge>
                            )}
                          </div>
                          <p
                            className="text-sm truncate"
                            data-testid={`text-transmittal-subject-${tr.id}`}
                          >
                            {tr.subject}
                          </p>
                        </div>
                        <span
                          className="text-xs text-muted-foreground flex items-center gap-1"
                          data-testid={`text-transmittal-date-${tr.id}`}
                        >
                          <Clock className="h-3 w-3" />
                          {formatDate(tr.dateSent)}
                        </span>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="chat" data-testid="content-chat">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="md:col-span-1 space-y-2">
                <Button
                  className="w-full"
                  onClick={() => { setShowNewThread(true); setSelectedThread(null); }}
                  data-testid="button-new-thread"
                >
                  <MessageSquare className="h-4 w-4 mr-1.5" />
                  New Conversation
                </Button>
                {chatLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                  </div>
                ) : chatThreads.length === 0 && !showNewThread ? (
                  <Card data-testid="empty-chat">
                    <CardContent className="py-8 text-center">
                      <MessageSquare className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
                      <p className="text-muted-foreground text-sm">No conversations yet.</p>
                      <p className="text-muted-foreground text-xs mt-1">Start one to communicate with the project team.</p>
                    </CardContent>
                  </Card>
                ) : (
                  chatThreads.map((thread: any) => (
                    <Card
                      key={thread.id}
                      className={`cursor-pointer hover-elevate ${selectedThread?.id === thread.id ? "ring-2 ring-primary" : ""}`}
                      onClick={() => {
                        setSelectedThread(thread);
                        setShowNewThread(false);
                        if (thread.portalUnreadCount > 0) markReadMutation.mutate(thread.id);
                      }}
                      data-testid={`card-thread-${thread.id}`}
                    >
                      <CardContent className="p-3">
                        <div className="flex flex-wrap items-start justify-between gap-1">
                          <span className="font-medium text-sm truncate flex-1 min-w-0" data-testid={`text-thread-subject-${thread.id}`}>
                            {thread.subject}
                          </span>
                          {thread.portalUnreadCount > 0 && (
                            <Badge variant="destructive" className="text-xs" data-testid={`badge-unread-${thread.id}`}>
                              {thread.portalUnreadCount}
                            </Badge>
                          )}
                        </div>
                        {thread.lastMessagePreview && (
                          <p className="text-xs text-muted-foreground mt-1 truncate" data-testid={`text-thread-preview-${thread.id}`}>
                            {thread.lastMessagePreview}
                          </p>
                        )}
                        <div className="flex flex-wrap items-center gap-2 mt-1">
                          <Badge variant="outline" className="text-xs">{thread.status}</Badge>
                          <span className="text-xs text-muted-foreground">
                            {formatDate(thread.lastMessageAt)}
                          </span>
                        </div>
                      </CardContent>
                    </Card>
                  ))
                )}
              </div>

              <div className="md:col-span-2">
                {showNewThread ? (
                  <Card data-testid="card-new-thread">
                    <CardHeader>
                      <CardTitle className="text-base">Start a Conversation</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <div>
                        <Label>Subject</Label>
                        <input
                          className="w-full mt-1 rounded-md border border-input bg-background px-3 py-2 text-sm"
                          placeholder="What is this about?"
                          value={newThreadSubject}
                          onChange={(e) => setNewThreadSubject(e.target.value)}
                          data-testid="input-thread-subject"
                        />
                      </div>
                      <div>
                        <Label>Message</Label>
                        <Textarea
                          placeholder="Type your message..."
                          value={newThreadMessage}
                          onChange={(e) => setNewThreadMessage(e.target.value)}
                          className="mt-1"
                          data-testid="input-thread-message"
                        />
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <Button
                          onClick={() => createThreadMutation.mutate({ subject: newThreadSubject, message: newThreadMessage })}
                          disabled={!newThreadSubject.trim() || !newThreadMessage.trim() || createThreadMutation.isPending}
                          data-testid="button-create-thread"
                        >
                          {createThreadMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                          Send
                        </Button>
                        <Button variant="outline" onClick={() => setShowNewThread(false)} data-testid="button-cancel-thread">
                          Cancel
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ) : selectedThread ? (
                  <Card data-testid="card-thread-detail">
                    <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
                      <CardTitle className="text-base" data-testid="text-selected-thread-subject">{selectedThread.subject}</CardTitle>
                      <Badge variant="outline">{selectedThread.status}</Badge>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-3 max-h-[400px] overflow-y-auto mb-4 pr-1" data-testid="messages-container">
                        {messagesLoading ? (
                          <div className="flex items-center justify-center py-8">
                            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                          </div>
                        ) : threadMessages.length === 0 ? (
                          <p className="text-sm text-muted-foreground text-center py-4">No messages yet.</p>
                        ) : (
                          threadMessages.map((msg: any) => (
                            <div
                              key={msg.id}
                              className={`rounded-md p-3 text-sm ${msg.senderType === "portal" ? "bg-primary/10 ml-8" : "bg-muted mr-8"}`}
                              data-testid={`message-${msg.id}`}
                            >
                              <div className="flex flex-wrap items-center justify-between gap-1 mb-1">
                                <span className="font-medium text-xs" data-testid={`text-msg-sender-${msg.id}`}>
                                  {msg.senderName || (msg.senderType === "portal" ? "You" : "Project Team")}
                                </span>
                                <span className="text-xs text-muted-foreground">{formatDate(msg.createdAt)}</span>
                              </div>
                              <p className="whitespace-pre-wrap" data-testid={`text-msg-content-${msg.id}`}>{msg.content}</p>
                            </div>
                          ))
                        )}
                      </div>
                      {selectedThread.status !== "CLOSED" && (
                        <div className="flex gap-2">
                          <Textarea
                            placeholder="Type a reply..."
                            value={chatMessage}
                            onChange={(e) => setChatMessage(e.target.value)}
                            className="flex-1"
                            data-testid="input-chat-reply"
                          />
                          <Button
                            size="icon"
                            onClick={() => sendMessageMutation.mutate({ threadId: selectedThread.id, content: chatMessage })}
                            disabled={!chatMessage.trim() || sendMessageMutation.isPending}
                            data-testid="button-send-reply"
                          >
                            {sendMessageMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                          </Button>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                ) : (
                  <Card>
                    <CardContent className="py-12 text-center">
                      <MessageSquare className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
                      <p className="text-muted-foreground text-sm">Select a conversation or start a new one.</p>
                    </CardContent>
                  </Card>
                )}
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </main>

      <Dialog
        open={!!selectedRfi}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedRfi(null);
            setRfiComment("");
          }
        }}
      >
        <DialogContent
          className="max-w-2xl max-h-[85vh] overflow-y-auto"
          data-testid="dialog-rfi-detail"
        >
          {selectedRfi && (
            <>
              <DialogHeader>
                <DialogTitle className="flex flex-wrap items-center gap-2">
                  <FileText className="h-5 w-5" />
                  <span data-testid="text-rfi-detail-number">
                    {selectedRfi.rfiNumber}
                  </span>
                  <StatusBadge status={selectedRfi.status} />
                </DialogTitle>
              </DialogHeader>

              <div className="space-y-4">
                <div>
                  <Label className="text-xs text-muted-foreground">
                    Subject
                  </Label>
                  <p
                    className="text-sm font-medium"
                    data-testid="text-rfi-detail-subject"
                  >
                    {selectedRfi.subject}
                  </p>
                </div>

                {selectedRfi.question && (
                  <div>
                    <Label className="text-xs text-muted-foreground">
                      Question
                    </Label>
                    <p
                      className="text-sm whitespace-pre-wrap"
                      data-testid="text-rfi-detail-question"
                    >
                      {selectedRfi.question}
                    </p>
                  </div>
                )}

                <div className="flex flex-wrap gap-4">
                  {selectedRfi.priority && (
                    <div>
                      <Label className="text-xs text-muted-foreground">
                        Priority
                      </Label>
                      <p
                        className="text-sm"
                        data-testid="text-rfi-detail-priority"
                      >
                        {selectedRfi.priority}
                      </p>
                    </div>
                  )}
                  <div>
                    <Label className="text-xs text-muted-foreground">
                      Date Submitted
                    </Label>
                    <p
                      className="text-sm"
                      data-testid="text-rfi-detail-date"
                    >
                      {formatDate(selectedRfi.dateSubmitted)}
                    </p>
                  </div>
                  {selectedRfi.dateRequired && (
                    <div>
                      <Label className="text-xs text-muted-foreground">
                        Date Required
                      </Label>
                      <p className="text-sm">
                        {formatDate(selectedRfi.dateRequired)}
                      </p>
                    </div>
                  )}
                </div>

                {selectedRfi.impactDescription && (
                  <div>
                    <Label className="text-xs text-muted-foreground">
                      Impact
                    </Label>
                    <p className="text-sm whitespace-pre-wrap">
                      {selectedRfi.impactDescription}
                    </p>
                  </div>
                )}

                {selectedRfi.answer && (
                  <div className="rounded-md border p-3 bg-green-50 dark:bg-green-950">
                    <Label className="text-xs text-muted-foreground flex items-center gap-1">
                      <CheckCircle2 className="h-3 w-3" />
                      Answer
                    </Label>
                    <p
                      className="text-sm whitespace-pre-wrap mt-1"
                      data-testid="text-rfi-detail-answer"
                    >
                      {selectedRfi.answer}
                    </p>
                  </div>
                )}

                {parseAttachments(selectedRfi.attachmentsJson).length > 0 && (
                  <div>
                    <Label className="text-xs text-muted-foreground flex items-center gap-1 mb-2">
                      <Paperclip className="h-3 w-3" />
                      Attachments
                    </Label>
                    <div className="space-y-1">
                      {parseAttachments(selectedRfi.attachmentsJson).map(
                        (att, i) => (
                          <a
                            key={i}
                            href={att.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-2 text-sm text-primary hover:underline"
                            data-testid={`link-rfi-attachment-${i}`}
                          >
                            <Download className="h-3.5 w-3.5" />
                            {att.name || `Attachment ${i + 1}`}
                          </a>
                        )
                      )}
                    </div>
                  </div>
                )}

                {selectedRfi.activity &&
                  Array.isArray(selectedRfi.activity) &&
                  selectedRfi.activity.length > 0 && (
                    <div>
                      <Label className="text-xs text-muted-foreground flex items-center gap-1 mb-2">
                        <MessageSquare className="h-3 w-3" />
                        Activity
                      </Label>
                      <div className="space-y-2 max-h-48 overflow-y-auto">
                        {selectedRfi.activity.map((act: any, i: number) => (
                          <div
                            key={i}
                            className="rounded-md border p-2 text-sm"
                            data-testid={`rfi-activity-${i}`}
                          >
                            <div className="flex flex-wrap items-center justify-between gap-1 mb-1">
                              <span className="font-medium text-xs">
                                {act.author || act.user || "User"}
                              </span>
                              <span className="text-xs text-muted-foreground">
                                {formatDate(act.date || act.createdAt)}
                              </span>
                            </div>
                            <p className="whitespace-pre-wrap">
                              {act.comment || act.message || act.text}
                            </p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                <div>
                  <Label
                    htmlFor="rfi-comment"
                    className="text-xs text-muted-foreground"
                  >
                    Add Comment
                  </Label>
                  <div className="flex gap-2 mt-1">
                    <Textarea
                      id="rfi-comment"
                      value={rfiComment}
                      onChange={(e) => setRfiComment(e.target.value)}
                      placeholder="Type your comment..."
                      className="text-sm"
                      data-testid="input-rfi-comment"
                    />
                  </div>
                </div>
              </div>

              <DialogFooter>
                <Button
                  onClick={() =>
                    rfiCommentMutation.mutate({
                      id: selectedRfi.id,
                      comment: rfiComment,
                    })
                  }
                  disabled={
                    !rfiComment.trim() || rfiCommentMutation.isPending
                  }
                  data-testid="button-rfi-send-comment"
                >
                  {rfiCommentMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Send className="h-4 w-4" />
                  )}
                  Send
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!selectedSubmittal}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedSubmittal(null);
            setSubmittalComment("");
          }
        }}
      >
        <DialogContent
          className="max-w-2xl max-h-[85vh] overflow-y-auto"
          data-testid="dialog-submittal-detail"
        >
          {selectedSubmittal && (
            <>
              <DialogHeader>
                <DialogTitle className="flex flex-wrap items-center gap-2">
                  <FolderOpen className="h-5 w-5" />
                  <span data-testid="text-submittal-detail-number">
                    {selectedSubmittal.submittalNumber}
                  </span>
                  <StatusBadge status={selectedSubmittal.status} />
                </DialogTitle>
              </DialogHeader>

              <div className="space-y-4">
                <div>
                  <Label className="text-xs text-muted-foreground">
                    Subject
                  </Label>
                  <p
                    className="text-sm font-medium"
                    data-testid="text-submittal-detail-subject"
                  >
                    {selectedSubmittal.subject}
                  </p>
                </div>

                {selectedSubmittal.description && (
                  <div>
                    <Label className="text-xs text-muted-foreground">
                      Description
                    </Label>
                    <p className="text-sm whitespace-pre-wrap">
                      {selectedSubmittal.description}
                    </p>
                  </div>
                )}

                <div className="flex flex-wrap gap-4">
                  {selectedSubmittal.submittalType && (
                    <div>
                      <Label className="text-xs text-muted-foreground">
                        Type
                      </Label>
                      <p className="text-sm">
                        {selectedSubmittal.submittalType}
                      </p>
                    </div>
                  )}
                  {selectedSubmittal.phase && (
                    <div>
                      <Label className="text-xs text-muted-foreground">
                        Phase
                      </Label>
                      <p className="text-sm">{selectedSubmittal.phase}</p>
                    </div>
                  )}
                  {selectedSubmittal.specSection && (
                    <div>
                      <Label className="text-xs text-muted-foreground">
                        Spec Section
                      </Label>
                      <p className="text-sm">
                        {selectedSubmittal.specSection}
                      </p>
                    </div>
                  )}
                </div>

                {selectedSubmittal.reviewComment && (
                  <div className="rounded-md border p-3">
                    <Label className="text-xs text-muted-foreground flex items-center gap-1">
                      <Eye className="h-3 w-3" />
                      Review Comment
                    </Label>
                    <p className="text-sm whitespace-pre-wrap mt-1">
                      {selectedSubmittal.reviewComment}
                    </p>
                  </div>
                )}

                {parseAttachments(selectedSubmittal.attachmentsJson).length >
                  0 && (
                  <div>
                    <Label className="text-xs text-muted-foreground flex items-center gap-1 mb-2">
                      <Paperclip className="h-3 w-3" />
                      Attachments
                    </Label>
                    <div className="space-y-1">
                      {parseAttachments(selectedSubmittal.attachmentsJson).map(
                        (att, i) => (
                          <a
                            key={i}
                            href={att.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-2 text-sm text-primary hover:underline"
                            data-testid={`link-submittal-attachment-${i}`}
                          >
                            <Download className="h-3.5 w-3.5" />
                            {att.name || `Attachment ${i + 1}`}
                          </a>
                        )
                      )}
                    </div>
                  </div>
                )}

                {selectedSubmittal.activity &&
                  Array.isArray(selectedSubmittal.activity) &&
                  selectedSubmittal.activity.length > 0 && (
                    <div>
                      <Label className="text-xs text-muted-foreground flex items-center gap-1 mb-2">
                        <MessageSquare className="h-3 w-3" />
                        Activity
                      </Label>
                      <div className="space-y-2 max-h-48 overflow-y-auto">
                        {selectedSubmittal.activity.map(
                          (act: any, i: number) => (
                            <div
                              key={i}
                              className="rounded-md border p-2 text-sm"
                              data-testid={`submittal-activity-${i}`}
                            >
                              <div className="flex flex-wrap items-center justify-between gap-1 mb-1">
                                <span className="font-medium text-xs">
                                  {act.author || act.user || "User"}
                                </span>
                                <span className="text-xs text-muted-foreground">
                                  {formatDate(act.date || act.createdAt)}
                                </span>
                              </div>
                              <p className="whitespace-pre-wrap">
                                {act.comment || act.message || act.text}
                              </p>
                            </div>
                          )
                        )}
                      </div>
                    </div>
                  )}

                <div>
                  <Label className="text-xs text-muted-foreground flex items-center gap-1 mb-2">
                    <Upload className="h-3 w-3" />
                    Upload File
                  </Label>
                  <div
                    className="rounded-md border border-dashed p-4 text-center"
                    data-testid="container-submittal-upload"
                  >
                    <Upload className="h-6 w-6 mx-auto text-muted-foreground mb-2" />
                    <p className="text-xs text-muted-foreground mb-2">
                      Drag and drop or click to upload files
                    </p>
                    <input
                      type="file"
                      className="hidden"
                      id="submittal-file-input"
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        if (!file || !selectedSubmittal) return;
                        const formData = new FormData();
                        formData.append("file", file);
                        try {
                          const res = await fetch(
                            `/api/portal/submittals/${selectedSubmittal.id}/upload`,
                            {
                              method: "POST",
                              headers: {
                                "x-portal-token": token,
                              },
                              body: formData,
                            }
                          );
                          if (!res.ok) throw new Error("Upload failed");
                          queryClient.invalidateQueries({
                            queryKey: ["/api/portal/submittals"],
                          });
                          toast({ title: "File uploaded successfully" });
                        } catch {
                          toast({
                            title: "Failed to upload file",
                            variant: "destructive",
                          });
                        }
                        e.target.value = "";
                      }}
                      data-testid="input-submittal-file"
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        document
                          .getElementById("submittal-file-input")
                          ?.click()
                      }
                      data-testid="button-submittal-upload"
                    >
                      <Upload className="h-4 w-4" />
                      Choose File
                    </Button>
                  </div>
                </div>

                <div>
                  <Label
                    htmlFor="submittal-comment"
                    className="text-xs text-muted-foreground"
                  >
                    Add Comment
                  </Label>
                  <div className="flex gap-2 mt-1">
                    <Textarea
                      id="submittal-comment"
                      value={submittalComment}
                      onChange={(e) => setSubmittalComment(e.target.value)}
                      placeholder="Type your comment..."
                      className="text-sm"
                      data-testid="input-submittal-comment"
                    />
                  </div>
                </div>
              </div>

              <DialogFooter>
                <Button
                  onClick={() =>
                    submittalCommentMutation.mutate({
                      id: selectedSubmittal.id,
                      comment: submittalComment,
                    })
                  }
                  disabled={
                    !submittalComment.trim() ||
                    submittalCommentMutation.isPending
                  }
                  data-testid="button-submittal-send-comment"
                >
                  {submittalCommentMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Send className="h-4 w-4" />
                  )}
                  Send
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!selectedTransmittal}
        onOpenChange={(open) => {
          if (!open) setSelectedTransmittal(null);
        }}
      >
        <DialogContent
          className="max-w-2xl max-h-[85vh] overflow-y-auto"
          data-testid="dialog-transmittal-detail"
        >
          {selectedTransmittal && (
            <>
              <DialogHeader>
                <DialogTitle className="flex flex-wrap items-center gap-2">
                  <ExternalLink className="h-5 w-5" />
                  <span data-testid="text-transmittal-detail-number">
                    {selectedTransmittal.transmittalNumber}
                  </span>
                  <StatusBadge status={selectedTransmittal.status} />
                </DialogTitle>
              </DialogHeader>

              <div className="space-y-4">
                <div>
                  <Label className="text-xs text-muted-foreground">
                    Subject
                  </Label>
                  <p
                    className="text-sm font-medium"
                    data-testid="text-transmittal-detail-subject"
                  >
                    {selectedTransmittal.subject}
                  </p>
                </div>

                {selectedTransmittal.description && (
                  <div>
                    <Label className="text-xs text-muted-foreground">
                      Description
                    </Label>
                    <p className="text-sm whitespace-pre-wrap">
                      {selectedTransmittal.description}
                    </p>
                  </div>
                )}

                <div className="flex flex-wrap gap-4">
                  {selectedTransmittal.documentType && (
                    <div>
                      <Label className="text-xs text-muted-foreground">
                        Document Type
                      </Label>
                      <p className="text-sm">
                        {selectedTransmittal.documentType}
                      </p>
                    </div>
                  )}
                  <div>
                    <Label className="text-xs text-muted-foreground">
                      Date Sent
                    </Label>
                    <p className="text-sm">
                      {formatDate(selectedTransmittal.dateSent)}
                    </p>
                  </div>
                </div>

                {selectedTransmittal.recipients &&
                  Array.isArray(selectedTransmittal.recipients) &&
                  selectedTransmittal.recipients.length > 0 && (
                    <div>
                      <Label className="text-xs text-muted-foreground mb-2 block">
                        Recipients
                      </Label>
                      <div className="space-y-1">
                        {selectedTransmittal.recipients.map(
                          (r: any, i: number) => (
                            <div
                              key={i}
                              className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-2 text-sm"
                              data-testid={`transmittal-recipient-${i}`}
                            >
                              <span>
                                {r.name || r.email || `Recipient ${i + 1}`}
                              </span>
                              {r.acknowledged ? (
                                <Badge
                                  variant="outline"
                                  className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200 text-xs"
                                >
                                  <CheckCircle2 className="h-3 w-3 mr-1" />
                                  Acknowledged
                                </Badge>
                              ) : (
                                <Badge
                                  variant="outline"
                                  className="text-xs"
                                >
                                  <Clock className="h-3 w-3 mr-1" />
                                  Pending
                                </Badge>
                              )}
                            </div>
                          )
                        )}
                      </div>
                    </div>
                  )}

                {parseAttachments(selectedTransmittal.attachmentsJson)
                  .length > 0 && (
                  <div>
                    <Label className="text-xs text-muted-foreground flex items-center gap-1 mb-2">
                      <Paperclip className="h-3 w-3" />
                      Attachments
                    </Label>
                    <div className="space-y-1">
                      {parseAttachments(
                        selectedTransmittal.attachmentsJson
                      ).map((att, i) => (
                        <a
                          key={i}
                          href={att.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-2 text-sm text-primary hover:underline"
                          data-testid={`link-transmittal-attachment-${i}`}
                        >
                          <Download className="h-3.5 w-3.5" />
                          {att.name || `Attachment ${i + 1}`}
                        </a>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <DialogFooter>
                <Button
                  onClick={() =>
                    acknowledgeMutation.mutate({
                      id: selectedTransmittal.id,
                    })
                  }
                  disabled={acknowledgeMutation.isPending}
                  data-testid="button-transmittal-acknowledge"
                >
                  {acknowledgeMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <CheckCircle2 className="h-4 w-4" />
                  )}
                  Acknowledge Receipt
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
