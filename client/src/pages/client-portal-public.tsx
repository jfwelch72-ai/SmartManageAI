import { useState } from "react";
import { useParams } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import {
  Loader2,
  Shield,
  Mail,
  Building2,
  Calendar,
  MapPin,
  Image,
  ClipboardList,
  CalendarDays,
  CheckCircle2,
  Clock,
  AlertCircle,
  Lock,
  MessageSquare,
  Send,
} from "lucide-react";
import { format } from "date-fns";

interface PortalPermissions {
  viewProgress: boolean;
  viewPhotos: boolean;
  viewSchedule: boolean;
  viewDocuments: boolean;
  viewInvoices: boolean;
  submitRequests: boolean;
}

interface VerifyResponse {
  verified: boolean;
  accessId: string;
  projectName: string;
  projectStatus: string;
  organizationName: string;
  accessType: string;
  name: string;
  permissions: PortalPermissions;
}

interface PortalData {
  project: {
    name: string;
    status: string;
    startDate: string | null;
    endDate: string | null;
    address: string | null;
    city: string | null;
    state: string | null;
  };
  progress?: Array<{
    description: string;
    status: string;
    completionPercentage: number | null;
    updatedAt: string | null;
  }>;
  photos?: Array<{
    id: string;
    fileName: string;
    fileUrl: string | null;
    fileType: string | null;
    description: string | null;
    createdAt: string;
  }>;
  schedule?: Array<{
    name: string;
    startDate: string | null;
    endDate: string | null;
    status: string | null;
    progress: number | null;
  }>;
}

const ACCESS_TYPE_LABELS: Record<string, string> = {
  OWNER_REP: "Owner Representative",
  GC_REP: "GC Representative",
  STAKEHOLDER: "Stakeholder",
  VIEWER: "Viewer",
};

const STATUS_COLORS: Record<string, string> = {
  COMPLETED: "text-green-600",
  IN_PROGRESS: "text-blue-600",
  NOT_STARTED: "text-muted-foreground",
  DELAYED: "text-red-600",
  ON_HOLD: "text-yellow-600",
};

function formatDate(dateStr: string | null | undefined) {
  if (!dateStr) return "";
  try {
    return format(new Date(dateStr), "MMM d, yyyy");
  } catch {
    return "";
  }
}

export default function ClientPortalPublic() {
  const params = useParams<{ projectId: string }>();
  const projectId = params.projectId;
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [email, setEmail] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [accessInfo, setAccessInfo] = useState<VerifyResponse | null>(null);
  const [portalData, setPortalData] = useState<PortalData | null>(null);
  const [loadingData, setLoadingData] = useState(false);

  const [selectedThread, setSelectedThread] = useState<any>(null);
  const [showNewThread, setShowNewThread] = useState(false);
  const [newThreadSubject, setNewThreadSubject] = useState("");
  const [newThreadMessage, setNewThreadMessage] = useState("");
  const [chatMessage, setChatMessage] = useState("");

  const clientHeaders: Record<string, string> = {
    "x-client-email": email,
    "x-client-project-id": projectId || "",
  };

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;

    setVerifying(true);
    setVerifyError(null);

    try {
      const res = await fetch("/api/ai-features/client-portal/public/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, email: email.trim() }),
      });

      if (!res.ok) {
        const err = await res.json();
        setVerifyError(err.error || "Access denied");
        setVerifying(false);
        return;
      }

      const data: VerifyResponse = await res.json();
      setAccessInfo(data);
      setVerifying(false);

      setLoadingData(true);
      const dataRes = await fetch("/api/ai-features/client-portal/public/data", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, email: email.trim() }),
      });

      if (dataRes.ok) {
        const portalDataResult: PortalData = await dataRes.json();
        setPortalData(portalDataResult);
      }
      setLoadingData(false);
    } catch {
      setVerifyError("Something went wrong. Please try again.");
      setVerifying(false);
      setLoadingData(false);
    }
  };

  const { data: chatThreads = [], isLoading: chatLoading } = useQuery({
    queryKey: ["/api/client-portal/chat/threads", { email, projectId }],
    queryFn: async () => {
      const res = await fetch("/api/client-portal/chat/threads", {
        headers: clientHeaders,
      });
      if (!res.ok) throw new Error("Failed to load chat threads");
      return res.json();
    },
    enabled: !!accessInfo && !!email && !!projectId,
    refetchInterval: 10000,
  });

  const { data: threadMessages = [], isLoading: messagesLoading } = useQuery({
    queryKey: ["/api/client-portal/chat/threads", selectedThread?.id, "messages"],
    queryFn: async () => {
      const res = await fetch(`/api/client-portal/chat/threads/${selectedThread.id}/messages`, {
        headers: clientHeaders,
      });
      if (!res.ok) throw new Error("Failed to load messages");
      return res.json();
    },
    enabled: !!accessInfo && !!selectedThread,
    refetchInterval: 4000,
  });

  const createThreadMutation = useMutation({
    mutationFn: async (data: { subject: string; message: string }) => {
      const res = await fetch("/api/client-portal/chat/threads", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...clientHeaders },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Failed to create thread");
      return res.json();
    },
    onSuccess: (result: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/client-portal/chat/threads", { email, projectId }] });
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
      const res = await fetch(`/api/client-portal/chat/threads/${data.threadId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...clientHeaders },
        body: JSON.stringify({ content: data.content }),
      });
      if (!res.ok) throw new Error("Failed to send message");
      return res.json();
    },
    onSuccess: (_: any, vars: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/client-portal/chat/threads", vars.threadId, "messages"] });
      queryClient.invalidateQueries({ queryKey: ["/api/client-portal/chat/threads", { email, projectId }] });
      setChatMessage("");
    },
    onError: () => {
      toast({ title: "Failed to send message", variant: "destructive" });
    },
  });

  const markReadMutation = useMutation({
    mutationFn: async (threadId: string) => {
      const res = await fetch(`/api/client-portal/chat/threads/${threadId}/read`, {
        method: "POST",
        headers: clientHeaders,
      });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/client-portal/chat/threads", { email, projectId }] });
    },
  });

  if (!accessInfo) {
    return (
      <div className="min-h-screen bg-muted/30 flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <div className="mx-auto mb-4 p-3 bg-primary/10 rounded-full w-fit">
              <Shield className="w-8 h-8 text-primary" />
            </div>
            <CardTitle className="text-2xl">Client Portal</CardTitle>
            <CardDescription>
              Enter your email address to access project information
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleVerify} className="space-y-4">
              <div>
                <Label htmlFor="portal-email">Email Address</Label>
                <div className="relative mt-1">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    id="portal-email"
                    type="email"
                    placeholder="your@email.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="pl-10"
                    required
                    data-testid="input-portal-email"
                  />
                </div>
              </div>

              {verifyError && (
                <div className="flex items-center gap-2 text-sm text-destructive bg-destructive/10 p-3 rounded-md">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{verifyError}</span>
                </div>
              )}

              <Button
                type="submit"
                className="w-full"
                disabled={verifying || !email.trim()}
                data-testid="button-portal-verify"
              >
                {verifying ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <Lock className="w-4 h-4 mr-2" />
                )}
                Access Portal
              </Button>
            </form>

            <p className="text-xs text-muted-foreground text-center mt-4">
              You must have been invited by your project team to access this portal.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (loadingData) {
    return (
      <div className="min-h-screen bg-muted/30 flex items-center justify-center">
        <div className="text-center space-y-4">
          <Loader2 className="w-10 h-10 animate-spin mx-auto text-primary" />
          <p className="text-muted-foreground">Loading project data...</p>
        </div>
      </div>
    );
  }

  const project = portalData?.project;
  const permissions = accessInfo.permissions;

  const availableTabs: { value: string; label: string; icon: any }[] = [];
  if (permissions.viewProgress) availableTabs.push({ value: "progress", label: "Progress", icon: ClipboardList });
  if (permissions.viewPhotos) availableTabs.push({ value: "photos", label: "Photos", icon: Image });
  if (permissions.viewSchedule) availableTabs.push({ value: "schedule", label: "Schedule", icon: CalendarDays });
  availableTabs.push({ value: "chat", label: "Chat", icon: MessageSquare });

  return (
    <div className="min-h-screen bg-muted/30">
      <header className="bg-card border-b sticky top-0 z-50">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-primary/10 rounded-lg">
              <Building2 className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h1 className="font-semibold text-lg leading-tight" data-testid="text-portal-project-name">
                {accessInfo.projectName}
              </h1>
              <p className="text-sm text-muted-foreground">
                {accessInfo.organizationName}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="secondary" data-testid="badge-portal-access-type">
              {ACCESS_TYPE_LABELS[accessInfo.accessType] || accessInfo.accessType}
            </Badge>
            <span className="text-sm text-muted-foreground hidden sm:inline">
              {accessInfo.name}
            </span>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-6 space-y-6">
        {project && (
          <Card>
            <CardContent className="pt-6">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="flex items-center gap-3">
                  <CheckCircle2 className="w-5 h-5 text-muted-foreground shrink-0" />
                  <div>
                    <p className="text-xs text-muted-foreground">Status</p>
                    <p className="font-medium" data-testid="text-portal-status">
                      {project.status?.replace(/_/g, " ") || "Active"}
                    </p>
                  </div>
                </div>
                {project.startDate && (
                  <div className="flex items-center gap-3">
                    <Calendar className="w-5 h-5 text-muted-foreground shrink-0" />
                    <div>
                      <p className="text-xs text-muted-foreground">Start Date</p>
                      <p className="font-medium">
                        {format(new Date(project.startDate), "MMM d, yyyy")}
                      </p>
                    </div>
                  </div>
                )}
                {project.endDate && (
                  <div className="flex items-center gap-3">
                    <Clock className="w-5 h-5 text-muted-foreground shrink-0" />
                    <div>
                      <p className="text-xs text-muted-foreground">End Date</p>
                      <p className="font-medium">
                        {format(new Date(project.endDate), "MMM d, yyyy")}
                      </p>
                    </div>
                  </div>
                )}
                {(project.address || project.city) && (
                  <div className="flex items-center gap-3">
                    <MapPin className="w-5 h-5 text-muted-foreground shrink-0" />
                    <div>
                      <p className="text-xs text-muted-foreground">Location</p>
                      <p className="font-medium">
                        {[project.address, project.city, project.state]
                          .filter(Boolean)
                          .join(", ")}
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {availableTabs.length > 0 ? (
          <Tabs defaultValue={availableTabs[0]?.value} className="space-y-4">
            <TabsList>
              {availableTabs.map((tab) => {
                const Icon = tab.icon;
                return (
                  <TabsTrigger key={tab.value} value={tab.value} data-testid={`tab-portal-${tab.value}`}>
                    <Icon className="w-4 h-4 mr-2" />
                    {tab.label}
                    {tab.value === "chat" && chatThreads.some((t: any) => t.portalUnreadCount > 0) && (
                      <span className="ml-1 inline-flex items-center justify-center h-4 min-w-[1rem] rounded-full bg-destructive text-destructive-foreground text-xs px-1">
                        {chatThreads.reduce((sum: number, t: any) => sum + (t.portalUnreadCount || 0), 0)}
                      </span>
                    )}
                  </TabsTrigger>
                );
              })}
            </TabsList>

            {permissions.viewProgress && (
              <TabsContent value="progress">
                <Card>
                  <CardHeader>
                    <CardTitle>Scope Progress</CardTitle>
                    <CardDescription>Current status of project scope items</CardDescription>
                  </CardHeader>
                  <CardContent>
                    {portalData?.progress && portalData.progress.length > 0 ? (
                      <ScrollArea className="max-h-[500px]">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Description</TableHead>
                              <TableHead>Status</TableHead>
                              <TableHead>Progress</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {portalData.progress.map((item, idx) => (
                              <TableRow key={idx}>
                                <TableCell className="font-medium">{item.description}</TableCell>
                                <TableCell>
                                  <span className={STATUS_COLORS[item.status] || "text-muted-foreground"}>
                                    {item.status?.replace(/_/g, " ") || "N/A"}
                                  </span>
                                </TableCell>
                                <TableCell>
                                  <div className="flex items-center gap-2 min-w-[120px]">
                                    <Progress value={item.completionPercentage || 0} className="h-2 flex-1" />
                                    <span className="text-sm text-muted-foreground w-10 text-right">
                                      {item.completionPercentage || 0}%
                                    </span>
                                  </div>
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </ScrollArea>
                    ) : (
                      <p className="text-muted-foreground text-center py-8">
                        No progress data available yet.
                      </p>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>
            )}

            {permissions.viewPhotos && (
              <TabsContent value="photos">
                <Card>
                  <CardHeader>
                    <CardTitle>Project Photos</CardTitle>
                    <CardDescription>Recent photos and media from the job site</CardDescription>
                  </CardHeader>
                  <CardContent>
                    {portalData?.photos && portalData.photos.length > 0 ? (
                      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                        {portalData.photos.map((photo) => (
                          <div key={photo.id} className="group relative aspect-square rounded-lg overflow-hidden bg-muted">
                            {photo.fileUrl ? (
                              <img
                                src={photo.fileUrl}
                                alt={photo.description || photo.fileName}
                                className="w-full h-full object-cover"
                              />
                            ) : (
                              <div className="flex items-center justify-center h-full">
                                <Image className="w-8 h-8 text-muted-foreground" />
                              </div>
                            )}
                            <div className="absolute bottom-0 left-0 right-0 bg-black/60 p-2 text-white text-xs opacity-0 group-hover:opacity-100 transition-opacity">
                              {photo.description || photo.fileName}
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-muted-foreground text-center py-8">
                        No photos available yet.
                      </p>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>
            )}

            {permissions.viewSchedule && (
              <TabsContent value="schedule">
                <Card>
                  <CardHeader>
                    <CardTitle>Project Schedule</CardTitle>
                    <CardDescription>Timeline and milestones for this project</CardDescription>
                  </CardHeader>
                  <CardContent>
                    {portalData?.schedule && portalData.schedule.length > 0 ? (
                      <ScrollArea className="max-h-[500px]">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Task</TableHead>
                              <TableHead>Start</TableHead>
                              <TableHead>End</TableHead>
                              <TableHead>Status</TableHead>
                              <TableHead>Progress</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {portalData.schedule.map((task, idx) => (
                              <TableRow key={idx}>
                                <TableCell className="font-medium">{task.name}</TableCell>
                                <TableCell>
                                  {task.startDate
                                    ? format(new Date(task.startDate), "MMM d")
                                    : "TBD"}
                                </TableCell>
                                <TableCell>
                                  {task.endDate
                                    ? format(new Date(task.endDate), "MMM d")
                                    : "TBD"}
                                </TableCell>
                                <TableCell>
                                  <span className={STATUS_COLORS[task.status || ""] || "text-muted-foreground"}>
                                    {task.status?.replace(/_/g, " ") || "Pending"}
                                  </span>
                                </TableCell>
                                <TableCell>
                                  <div className="flex items-center gap-2 min-w-[100px]">
                                    <Progress value={task.progress || 0} className="h-2 flex-1" />
                                    <span className="text-sm text-muted-foreground w-10 text-right">
                                      {task.progress || 0}%
                                    </span>
                                  </div>
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </ScrollArea>
                    ) : (
                      <p className="text-muted-foreground text-center py-8">
                        No schedule data available yet.
                      </p>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>
            )}

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
                          <Input
                            className="mt-1"
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
                            {createThreadMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : <Send className="h-4 w-4 mr-1.5" />}
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
                                className={`rounded-md p-3 text-sm ${msg.senderType === "client_portal" ? "bg-primary/10 ml-8" : "bg-muted mr-8"}`}
                                data-testid={`message-${msg.id}`}
                              >
                                <div className="flex flex-wrap items-center justify-between gap-1 mb-1">
                                  <span className="font-medium text-xs" data-testid={`text-msg-sender-${msg.id}`}>
                                    {msg.senderName || (msg.senderType === "client_portal" ? "You" : "Project Team")}
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
        ) : (
          <Card>
            <CardContent className="py-12 text-center">
              <Lock className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
              <p className="text-muted-foreground">
                Your current access level does not include detailed project views.
                Contact your project team for more information.
              </p>
            </CardContent>
          </Card>
        )}

        <footer className="text-center text-xs text-muted-foreground py-4">
          Powered by SmartManageAI Construction Management Platform
        </footer>
      </main>
    </div>
  );
}
