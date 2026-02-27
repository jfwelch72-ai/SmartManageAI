import { useState, useMemo, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Plus, Calendar as CalendarIcon, List, LayoutDashboard, Loader2, Sparkles,
  Copy, Trash2, Edit, MoreHorizontal, ExternalLink, RefreshCw, Clock,
  CheckCircle, AlertCircle, Send, Eye, ChevronLeft, ChevronRight,
  Hash, Image, Link2, Megaphone, TrendingUp, Users, Filter, Search
} from "lucide-react";
import { SiFacebook, SiInstagram, SiLinkedin, SiYoutube, SiTiktok, SiPinterest } from "react-icons/si";
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isSameDay, isSameMonth, addMonths, subMonths, startOfWeek, endOfWeek, isToday } from "date-fns";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";

const PLATFORMS = [
  { value: "FACEBOOK", label: "Facebook", icon: SiFacebook, color: "#1877F2" },
  { value: "INSTAGRAM", label: "Instagram", icon: SiInstagram, color: "#E4405F" },
  { value: "LINKEDIN", label: "LinkedIn", icon: SiLinkedin, color: "#0A66C2" },
  { value: "TWITTER", label: "X (Twitter)", icon: () => <span className="font-bold text-sm">𝕏</span>, color: "#000000" },
  { value: "TIKTOK", label: "TikTok", icon: SiTiktok, color: "#000000" },
  { value: "YOUTUBE", label: "YouTube", icon: SiYoutube, color: "#FF0000" },
  { value: "PINTEREST", label: "Pinterest", icon: SiPinterest, color: "#BD081C" },
];

const CHAR_LIMITS: Record<string, number> = {
  TWITTER: 280,
  LINKEDIN: 1300,
  INSTAGRAM: 2200,
  FACEBOOK: 63206,
  TIKTOK: 2200,
  YOUTUBE: 5000,
  PINTEREST: 500,
};

const STATUS_COLORS: Record<string, string> = {
  DRAFT: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
  PENDING_APPROVAL: "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300",
  APPROVED: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300",
  SCHEDULED: "bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300",
  QUEUED: "bg-indigo-100 text-indigo-700 dark:bg-indigo-900 dark:text-indigo-300",
  POSTED: "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300",
  FAILED: "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300",
};

function getPlatformInfo(platform: string) {
  return PLATFORMS.find(p => p.value === platform) || PLATFORMS[0];
}

interface SocialPost {
  id: string;
  title: string | null;
  content: string;
  platform: string | null;
  platforms: string[] | null;
  status: string;
  mediaUrls: string[] | null;
  hashtags: string[] | null;
  scheduledAt: string | null;
  publishedAt: string | null;
  campaignTag: string | null;
  tone: string | null;
  notes: string | null;
  isRecurring: boolean;
  recurringPattern: any;
  aiGenerated: boolean;
  createdAt: string;
  updatedAt: string;
}

interface SocialAccount {
  id: string;
  platform: string;
  accountName: string | null;
  status: string;
  profileImageUrl: string | null;
  lastSyncAt: string | null;
}

function StatsView() {
  const { data: stats, isLoading } = useQuery<any>({
    queryKey: ["/api/social/stats"],
  });

  if (isLoading) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-28" />)}
      </div>
    );
  }

  const statCards = [
    { label: "Total Posts", value: stats?.total || 0, icon: Megaphone, color: "text-blue-600" },
    { label: "Scheduled", value: stats?.scheduled || 0, icon: Clock, color: "text-purple-600" },
    { label: "Published This Month", value: stats?.publishedThisMonth || 0, icon: CheckCircle, color: "text-green-600" },
    { label: "Drafts", value: stats?.drafts || 0, icon: Edit, color: "text-gray-600" },
    { label: "Pending Approval", value: stats?.pendingApproval || 0, icon: Eye, color: "text-amber-600" },
    { label: "Failed", value: stats?.failed || 0, icon: AlertCircle, color: "text-red-600" },
    { label: "Published This Week", value: stats?.publishedThisWeek || 0, icon: TrendingUp, color: "text-emerald-600" },
    { label: "Connected Accounts", value: stats?.connectedAccounts || 0, icon: Users, color: "text-indigo-600" },
  ];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {statCards.map((s, i) => (
          <Card key={i}>
            <CardContent className="pt-4 pb-3 px-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-muted-foreground">{s.label}</p>
                  <p className="text-2xl font-bold mt-1" data-testid={`stat-${s.label.toLowerCase().replace(/\s/g, '-')}`}>{s.value}</p>
                </div>
                <s.icon className={`h-5 w-5 ${s.color}`} />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {stats?.byPlatform && Object.keys(stats.byPlatform).length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Posts by Platform</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-3">
              {Object.entries(stats.byPlatform).map(([platform, count]) => {
                const info = getPlatformInfo(platform);
                const Icon = info.icon;
                return (
                  <div key={platform} className="flex items-center gap-2 px-3 py-2 rounded-lg border" data-testid={`platform-count-${platform.toLowerCase()}`}>
                    <Icon className="h-4 w-4" style={{ color: info.color }} />
                    <span className="text-sm font-medium">{info.label}</span>
                    <Badge variant="secondary" className="text-xs">{count as number}</Badge>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function PostCard({ post, onEdit, onDelete, onPublish, onDuplicate }: {
  post: SocialPost;
  onEdit: (post: SocialPost) => void;
  onDelete: (id: string) => void;
  onPublish: (id: string) => void;
  onDuplicate: (id: string) => void;
}) {
  const info = getPlatformInfo(post.platform || "FACEBOOK");
  const Icon = info.icon;

  return (
    <Card className="hover:shadow-md transition-shadow" data-testid={`post-card-${post.id}`}>
      <CardContent className="pt-4 pb-3 px-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3 flex-1 min-w-0">
            <div className="p-2 rounded-lg border shrink-0" style={{ borderColor: info.color + "40" }}>
              <Icon className="h-4 w-4" style={{ color: info.color }} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                {post.title && <p className="text-sm font-medium truncate">{post.title}</p>}
                <Badge className={`text-xs shrink-0 ${STATUS_COLORS[post.status] || ""}`} variant="secondary">
                  {post.status.replace(/_/g, " ")}
                </Badge>
                {post.aiGenerated && (
                  <Badge variant="outline" className="text-xs shrink-0">
                    <Sparkles className="h-3 w-3 mr-1" />AI
                  </Badge>
                )}
              </div>
              <p className="text-sm text-muted-foreground line-clamp-2">{post.content}</p>
              <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
                {post.scheduledAt && (
                  <span className="flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    {format(new Date(post.scheduledAt), "MMM d, h:mm a")}
                  </span>
                )}
                {post.publishedAt && (
                  <span className="flex items-center gap-1">
                    <CheckCircle className="h-3 w-3" />
                    {format(new Date(post.publishedAt), "MMM d, h:mm a")}
                  </span>
                )}
                {post.campaignTag && (
                  <span className="flex items-center gap-1">
                    <Megaphone className="h-3 w-3" />
                    {post.campaignTag}
                  </span>
                )}
                {post.hashtags && post.hashtags.length > 0 && (
                  <span className="flex items-center gap-1">
                    <Hash className="h-3 w-3" />
                    {post.hashtags.length} tags
                  </span>
                )}
              </div>
            </div>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="shrink-0" data-testid={`post-actions-${post.id}`}>
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => onEdit(post)} data-testid={`edit-post-${post.id}`}>
                <Edit className="h-4 w-4 mr-2" />Edit
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onDuplicate(post.id)} data-testid={`duplicate-post-${post.id}`}>
                <Copy className="h-4 w-4 mr-2" />Duplicate
              </DropdownMenuItem>
              {post.status !== "POSTED" && (
                <DropdownMenuItem onClick={() => onPublish(post.id)} data-testid={`publish-post-${post.id}`}>
                  <Send className="h-4 w-4 mr-2" />Mark as Published
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onClick={() => {
                navigator.clipboard.writeText(post.content + (post.hashtags?.length ? "\n\n" + post.hashtags.map(h => "#" + h).join(" ") : ""));
              }}>
                <Copy className="h-4 w-4 mr-2" />Copy Content
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onDelete(post.id)} className="text-destructive" data-testid={`delete-post-${post.id}`}>
                <Trash2 className="h-4 w-4 mr-2" />Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </CardContent>
    </Card>
  );
}

function CalendarView({ posts, currentDate, onDateChange, onEdit, onCreateForDate }: {
  posts: Record<string, SocialPost[]>;
  currentDate: Date;
  onDateChange: (d: Date) => void;
  onEdit: (post: SocialPost) => void;
  onCreateForDate: (date: Date) => void;
}) {
  const monthStart = startOfMonth(currentDate);
  const monthEnd = endOfMonth(currentDate);
  const calStart = startOfWeek(monthStart);
  const calEnd = endOfWeek(monthEnd);
  const days = eachDayOfInterval({ start: calStart, end: calEnd });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Button variant="outline" size="sm" onClick={() => onDateChange(subMonths(currentDate, 1))} data-testid="cal-prev-month">
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <h3 className="text-lg font-semibold" data-testid="cal-current-month">
          {format(currentDate, "MMMM yyyy")}
        </h3>
        <Button variant="outline" size="sm" onClick={() => onDateChange(addMonths(currentDate, 1))} data-testid="cal-next-month">
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>

      <div className="grid grid-cols-7 gap-px bg-border rounded-lg overflow-hidden">
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map(d => (
          <div key={d} className="bg-muted py-2 text-center text-xs font-medium text-muted-foreground">{d}</div>
        ))}
        {days.map((day, i) => {
          const key = format(day, "yyyy-MM-dd");
          const dayPosts = posts[key] || [];
          const isCurrentMonth = isSameMonth(day, currentDate);
          const isCurrentDay = isToday(day);

          return (
            <div
              key={i}
              className={`bg-background min-h-[100px] p-1.5 cursor-pointer hover:bg-muted/50 transition-colors ${!isCurrentMonth ? "opacity-40" : ""} ${isCurrentDay ? "ring-2 ring-primary ring-inset" : ""}`}
              onClick={() => onCreateForDate(day)}
              data-testid={`cal-day-${key}`}
            >
              <div className="flex items-center justify-between mb-1">
                <span className={`text-xs font-medium ${isCurrentDay ? "text-primary" : "text-muted-foreground"}`}>
                  {format(day, "d")}
                </span>
                {dayPosts.length > 0 && (
                  <Badge variant="secondary" className="text-[10px] h-4 px-1">{dayPosts.length}</Badge>
                )}
              </div>
              <div className="space-y-0.5">
                {dayPosts.slice(0, 3).map(post => {
                  const pInfo = getPlatformInfo(post.platform || "FACEBOOK");
                  const PIcon = pInfo.icon;
                  return (
                    <div
                      key={post.id}
                      className="flex items-center gap-1 px-1 py-0.5 rounded text-[10px] truncate cursor-pointer hover:bg-muted"
                      style={{ backgroundColor: pInfo.color + "15", color: pInfo.color }}
                      onClick={(e) => { e.stopPropagation(); onEdit(post); }}
                      data-testid={`cal-post-${post.id}`}
                    >
                      <PIcon className="h-2.5 w-2.5 shrink-0" />
                      <span className="truncate">{post.title || post.content.substring(0, 20)}</span>
                    </div>
                  );
                })}
                {dayPosts.length > 3 && (
                  <div className="text-[10px] text-muted-foreground text-center">+{dayPosts.length - 3} more</div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ConnectedAccountsSection() {
  const { toast } = useToast();
  const { data: accounts, isLoading } = useQuery<SocialAccount[]>({
    queryKey: ["/api/social/accounts"],
  });

  const [showConnectDialog, setShowConnectDialog] = useState(false);
  const [connectPlatform, setConnectPlatform] = useState("");
  const [connectForm, setConnectForm] = useState({ accountName: "", accountId: "", accessToken: "" });

  const connectMutation = useMutation({
    mutationFn: async (data: any) => apiRequest("POST", "/api/social/accounts", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/social/accounts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/social/stats"] });
      toast({ title: "Account connected" });
      setShowConnectDialog(false);
      setConnectForm({ accountName: "", accountId: "", accessToken: "" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const disconnectMutation = useMutation({
    mutationFn: async (id: string) => apiRequest("DELETE", `/api/social/accounts/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/social/accounts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/social/stats"] });
      toast({ title: "Account disconnected" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const getAccountForPlatform = (platform: string) => accounts?.find(a => a.platform === platform);

  return (
    <>
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Link2 className="h-4 w-4" />
            Connected Accounts
          </CardTitle>
          <CardDescription>Manage your social media account connections</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-20" />)}
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
              {PLATFORMS.map(p => {
                const account = getAccountForPlatform(p.value);
                const Icon = p.icon;
                const isConnected = account?.status === "CONNECTED";

                return (
                  <div
                    key={p.value}
                    className={`flex flex-col items-center gap-2 p-3 rounded-lg border transition-colors ${isConnected ? "border-green-200 bg-green-50/50 dark:border-green-900 dark:bg-green-950/30" : "border-dashed"}`}
                    data-testid={`account-${p.value.toLowerCase()}`}
                  >
                    <Icon className="h-6 w-6" style={{ color: p.color }} />
                    <span className="text-xs font-medium text-center">{p.label}</span>
                    {account ? (
                      <>
                        <Badge variant={isConnected ? "default" : "secondary"} className="text-[10px]">
                          {account.status}
                        </Badge>
                        {account.accountName && (
                          <span className="text-[10px] text-muted-foreground truncate max-w-full">{account.accountName}</span>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 text-xs text-destructive"
                          onClick={() => disconnectMutation.mutate(account.id)}
                          data-testid={`disconnect-${p.value.toLowerCase()}`}
                        >
                          Disconnect
                        </Button>
                      </>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-6 text-xs"
                        onClick={() => { setConnectPlatform(p.value); setShowConnectDialog(true); }}
                        data-testid={`connect-${p.value.toLowerCase()}`}
                      >
                        Connect
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={showConnectDialog} onOpenChange={setShowConnectDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Connect {getPlatformInfo(connectPlatform).label}</DialogTitle>
            <DialogDescription>
              Connect your {getPlatformInfo(connectPlatform).label} account. Direct OAuth integration is coming soon — for now you can enter your account details manually.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Account Name</Label>
              <Input
                placeholder="My Company Page"
                value={connectForm.accountName}
                onChange={e => setConnectForm(prev => ({ ...prev, accountName: e.target.value }))}
                data-testid="input-account-name"
              />
            </div>
            <div>
              <Label>Account / Page ID (optional)</Label>
              <Input
                placeholder="Platform account or page ID"
                value={connectForm.accountId}
                onChange={e => setConnectForm(prev => ({ ...prev, accountId: e.target.value }))}
                data-testid="input-account-id"
              />
            </div>
            <div>
              <Label>Access Token (optional)</Label>
              <Input
                type="password"
                placeholder="Your API access token"
                value={connectForm.accessToken}
                onChange={e => setConnectForm(prev => ({ ...prev, accessToken: e.target.value }))}
                data-testid="input-access-token"
              />
              <p className="text-xs text-muted-foreground mt-1">Tokens are stored encrypted. Leave blank to connect without auto-posting.</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowConnectDialog(false)}>Cancel</Button>
            <Button
              onClick={() => connectMutation.mutate({
                platform: connectPlatform,
                accountName: connectForm.accountName,
                accountId: connectForm.accountId,
                accessToken: connectForm.accessToken || undefined,
              })}
              disabled={connectMutation.isPending || !connectForm.accountName.trim()}
              data-testid="button-connect-account"
            >
              {connectMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Link2 className="h-4 w-4 mr-2" />}
              Connect
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function CreateEditPostDialog({ open, onClose, editingPost, prefilledDate }: {
  open: boolean;
  onClose: () => void;
  editingPost: SocialPost | null;
  prefilledDate?: Date | null;
}) {
  const { toast } = useToast();

  const getDefaultForm = () => ({
    title: "",
    content: "",
    platform: "FACEBOOK" as string,
    status: "DRAFT",
    hashtags: [] as string[],
    hashtagInput: "",
    scheduledAt: "",
    campaignTag: "",
    tone: "professional",
    notes: "",
    isRecurring: false,
    recurringFrequency: "weekly",
    recurringInterval: 1,
    utmSource: "",
    utmMedium: "social",
    utmCampaign: "",
    scheduleMode: "now" as "now" | "schedule",
  });

  const [form, setForm] = useState(getDefaultForm());
  const [aiTopic, setAiTopic] = useState("");
  const [aiResult, setAiResult] = useState<any>(null);

  const isEditing = !!editingPost;

  const resetKey = open ? (editingPost?.id || "new") + (prefilledDate?.toISOString() || "") : "";
  useEffect(() => {
    if (!open) return;
    if (editingPost) {
      setForm({
        title: editingPost.title || "",
        content: editingPost.content || "",
        platform: editingPost.platform || "FACEBOOK",
        status: editingPost.status,
        hashtags: editingPost.hashtags || [],
        hashtagInput: "",
        scheduledAt: editingPost.scheduledAt ? new Date(editingPost.scheduledAt).toISOString().slice(0, 16) : "",
        campaignTag: editingPost.campaignTag || "",
        tone: editingPost.tone || "professional",
        notes: editingPost.notes || "",
        isRecurring: editingPost.isRecurring || false,
        recurringFrequency: (editingPost.recurringPattern as any)?.frequency || "weekly",
        recurringInterval: (editingPost.recurringPattern as any)?.interval || 1,
        utmSource: "",
        utmMedium: "social",
        utmCampaign: "",
        scheduleMode: editingPost.scheduledAt ? "schedule" : "now",
      });
    } else if (prefilledDate) {
      const dateStr = new Date(prefilledDate.getFullYear(), prefilledDate.getMonth(), prefilledDate.getDate(), 9, 0)
        .toISOString().slice(0, 16);
      setForm({ ...getDefaultForm(), scheduledAt: dateStr, scheduleMode: "schedule" });
    } else {
      setForm(getDefaultForm());
    }
    setAiTopic("");
    setAiResult(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey]);

  const charLimit = CHAR_LIMITS[form.platform] || 5000;
  const charCount = form.content.length;
  const isOverLimit = charCount > charLimit;

  const createMutation = useMutation({
    mutationFn: async (data: any) => apiRequest("POST", "/api/social/posts", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/social/posts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/social/calendar"] });
      queryClient.invalidateQueries({ queryKey: ["/api/social/stats"] });
      toast({ title: "Post created" });
      onClose();
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: async (data: any) => apiRequest("PATCH", `/api/social/posts/${editingPost!.id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/social/posts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/social/calendar"] });
      queryClient.invalidateQueries({ queryKey: ["/api/social/stats"] });
      toast({ title: "Post updated" });
      onClose();
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const generateMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/social/posts/generate", {
        platform: form.platform,
        topic: aiTopic,
        tone: form.tone,
      });
      return res.json();
    },
    onSuccess: (data: any) => {
      setAiResult(data);
      setForm(prev => ({
        ...prev,
        content: data.content || prev.content,
        hashtags: data.hashtags || prev.hashtags,
        title: data.title || prev.title,
      }));
      toast({ title: "AI content generated" });
    },
    onError: (e: Error) => toast({ title: "Generation failed", description: e.message, variant: "destructive" }),
  });

  const handleSubmit = (saveStatus: string) => {
    const payload: any = {
      title: form.title || null,
      content: form.content,
      platform: form.platform,
      status: saveStatus,
      hashtags: form.hashtags.length > 0 ? form.hashtags : null,
      campaignTag: form.campaignTag || null,
      tone: form.tone,
      notes: form.notes || null,
      isRecurring: form.isRecurring,
      utmSource: form.utmSource || null,
      utmMedium: form.utmMedium || null,
      utmCampaign: form.utmCampaign || null,
    };

    if (form.scheduleMode === "schedule" && form.scheduledAt) {
      payload.scheduledAt = new Date(form.scheduledAt).toISOString();
      if (saveStatus === "DRAFT") payload.status = "SCHEDULED";
    }

    if (form.isRecurring) {
      payload.recurringPattern = {
        frequency: form.recurringFrequency,
        interval: form.recurringInterval,
      };
    }

    if (isEditing) {
      updateMutation.mutate(payload);
    } else {
      payload.aiGenerated = !!aiResult;
      payload.aiPrompt = aiTopic || null;
      createMutation.mutate(payload);
    }
  };

  const addHashtag = () => {
    const tag = form.hashtagInput.trim().replace(/^#/, "");
    if (tag && !form.hashtags.includes(tag)) {
      setForm(prev => ({ ...prev, hashtags: [...prev.hashtags, tag], hashtagInput: "" }));
    }
  };

  const isPending = createMutation.isPending || updateMutation.isPending;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEditing ? "Edit Post" : "Create New Post"}</DialogTitle>
          <DialogDescription>
            {isEditing ? "Update your social media post" : "Create and schedule a social media post"}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Platform</Label>
              <Select value={form.platform} onValueChange={v => setForm(prev => ({ ...prev, platform: v }))}>
                <SelectTrigger data-testid="select-platform">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PLATFORMS.map(p => {
                    const Icon = p.icon;
                    return (
                      <SelectItem key={p.value} value={p.value}>
                        <span className="flex items-center gap-2">
                          <Icon className="h-3.5 w-3.5" style={{ color: p.color }} />
                          {p.label}
                        </span>
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Tone</Label>
              <Select value={form.tone} onValueChange={v => setForm(prev => ({ ...prev, tone: v }))}>
                <SelectTrigger data-testid="select-tone">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="professional">Professional</SelectItem>
                  <SelectItem value="casual">Casual</SelectItem>
                  <SelectItem value="marketing">Marketing</SelectItem>
                  <SelectItem value="humorous">Humorous</SelectItem>
                  <SelectItem value="educational">Educational</SelectItem>
                  <SelectItem value="inspirational">Inspirational</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div>
            <Label>Title (internal label)</Label>
            <Input
              placeholder="Give your post a name for easy reference"
              value={form.title}
              onChange={e => setForm(prev => ({ ...prev, title: e.target.value }))}
              data-testid="input-post-title"
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <Label>Content</Label>
              <span className={`text-xs ${isOverLimit ? "text-destructive font-medium" : "text-muted-foreground"}`}>
                {charCount}/{charLimit}
              </span>
            </div>
            <Textarea
              placeholder="Write your post content..."
              value={form.content}
              onChange={e => setForm(prev => ({ ...prev, content: e.target.value }))}
              className="min-h-[120px]"
              data-testid="input-post-content"
            />
          </div>

          <div className="p-3 rounded-lg border bg-muted/30 space-y-3">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-amber-500" />
              <span className="text-sm font-medium">AI Content Generator</span>
            </div>
            <div className="flex gap-2">
              <Input
                placeholder="Enter a topic for AI to generate content..."
                value={aiTopic}
                onChange={e => setAiTopic(e.target.value)}
                data-testid="input-ai-topic"
              />
              <Button
                variant="outline"
                onClick={() => generateMutation.mutate()}
                disabled={generateMutation.isPending || !aiTopic.trim()}
                data-testid="button-generate-ai"
              >
                {generateMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              </Button>
            </div>
            {aiResult && (
              <div className="space-y-2 text-xs">
                {aiResult.bestTimeToPost && (
                  <p><strong>Best time:</strong> {aiResult.bestTimeToPost}</p>
                )}
                {aiResult.engagementTips && (
                  <p><strong>Tips:</strong> {aiResult.engagementTips}</p>
                )}
              </div>
            )}
          </div>

          <div>
            <Label>Hashtags</Label>
            <div className="flex gap-2 mb-2">
              <Input
                placeholder="Add hashtag..."
                value={form.hashtagInput}
                onChange={e => setForm(prev => ({ ...prev, hashtagInput: e.target.value }))}
                onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addHashtag(); } }}
                data-testid="input-hashtag"
              />
              <Button variant="outline" size="sm" onClick={addHashtag} data-testid="button-add-hashtag">
                <Plus className="h-4 w-4" />
              </Button>
            </div>
            {form.hashtags.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {form.hashtags.map((tag, i) => (
                  <Badge key={i} variant="secondary" className="text-xs cursor-pointer" onClick={() => setForm(prev => ({ ...prev, hashtags: prev.hashtags.filter((_, j) => j !== i) }))}>
                    #{tag} ×
                  </Badge>
                ))}
              </div>
            )}
          </div>

          <div>
            <Label>Campaign Tag</Label>
            <Input
              placeholder="e.g. Spring 2026 Campaign"
              value={form.campaignTag}
              onChange={e => setForm(prev => ({ ...prev, campaignTag: e.target.value }))}
              data-testid="input-campaign"
            />
          </div>

          <Separator />

          <div className="space-y-3">
            <Label className="font-medium">Scheduling</Label>
            <div className="flex gap-2">
              <Button
                variant={form.scheduleMode === "now" ? "default" : "outline"}
                size="sm"
                onClick={() => setForm(prev => ({ ...prev, scheduleMode: "now" }))}
                data-testid="btn-schedule-now"
              >
                Save as Draft
              </Button>
              <Button
                variant={form.scheduleMode === "schedule" ? "default" : "outline"}
                size="sm"
                onClick={() => setForm(prev => ({ ...prev, scheduleMode: "schedule" }))}
                data-testid="btn-schedule-later"
              >
                <Clock className="h-4 w-4 mr-1" />
                Schedule
              </Button>
            </div>
            {form.scheduleMode === "schedule" && (
              <div className="space-y-3">
                <div>
                  <Label>Schedule Date & Time</Label>
                  <Input
                    type="datetime-local"
                    value={form.scheduledAt}
                    onChange={e => setForm(prev => ({ ...prev, scheduledAt: e.target.value }))}
                    data-testid="input-schedule-date"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="recurring"
                    checked={form.isRecurring}
                    onChange={e => setForm(prev => ({ ...prev, isRecurring: e.target.checked }))}
                    className="rounded"
                    data-testid="checkbox-recurring"
                  />
                  <Label htmlFor="recurring" className="text-sm cursor-pointer">Recurring post</Label>
                </div>
                {form.isRecurring && (
                  <div className="flex gap-2">
                    <Select value={form.recurringFrequency} onValueChange={v => setForm(prev => ({ ...prev, recurringFrequency: v }))}>
                      <SelectTrigger className="w-32" data-testid="select-recurring-freq">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="daily">Daily</SelectItem>
                        <SelectItem value="weekly">Weekly</SelectItem>
                        <SelectItem value="monthly">Monthly</SelectItem>
                      </SelectContent>
                    </Select>
                    <span className="text-sm text-muted-foreground self-center">every</span>
                    <Input
                      type="number"
                      min={1}
                      max={30}
                      value={form.recurringInterval}
                      onChange={e => setForm(prev => ({ ...prev, recurringInterval: parseInt(e.target.value) || 1 }))}
                      className="w-16"
                      data-testid="input-recurring-interval"
                    />
                    <span className="text-sm text-muted-foreground self-center">
                      {form.recurringFrequency === "daily" ? "day(s)" : form.recurringFrequency === "weekly" ? "week(s)" : "month(s)"}
                    </span>
                  </div>
                )}
              </div>
            )}
          </div>

          <div>
            <Label>Internal Notes</Label>
            <Textarea
              placeholder="Any internal notes about this post..."
              value={form.notes}
              onChange={e => setForm(prev => ({ ...prev, notes: e.target.value }))}
              className="min-h-[60px]"
              data-testid="input-post-notes"
            />
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            variant="outline"
            onClick={() => handleSubmit("DRAFT")}
            disabled={isPending || !form.content.trim() || isOverLimit}
            data-testid="button-save-draft"
          >
            {isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Edit className="h-4 w-4 mr-2" />}
            Save as Draft
          </Button>
          {form.scheduleMode === "schedule" && form.scheduledAt && (
            <Button
              onClick={() => handleSubmit("SCHEDULED")}
              disabled={isPending || !form.content.trim() || isOverLimit}
              data-testid="button-schedule-post"
            >
              {isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Clock className="h-4 w-4 mr-2" />}
              Schedule Post
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function SocialMediaPage() {
  const { toast } = useToast();
  const [activeView, setActiveView] = useState<"dashboard" | "list" | "calendar" | "accounts">("dashboard");
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [editingPost, setEditingPost] = useState<SocialPost | null>(null);
  const [calendarDate, setCalendarDate] = useState(new Date());
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [filterPlatform, setFilterPlatform] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [prefilledDate, setPrefilledDate] = useState<Date | null>(null);

  const postsQuery = useQuery<{ data: SocialPost[]; total: number }>({
    queryKey: ["/api/social/posts", filterStatus, filterPlatform],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (filterStatus !== "all") params.set("status", filterStatus);
      if (filterPlatform !== "all") params.set("platform", filterPlatform);
      params.set("limit", "100");
      const res = await fetch(`/api/social/posts?${params}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch posts");
      return res.json();
    },
  });

  const calendarQuery = useQuery<{ posts: Record<string, SocialPost[]> }>({
    queryKey: ["/api/social/calendar", calendarDate.getMonth() + 1, calendarDate.getFullYear()],
    queryFn: async () => {
      const res = await fetch(`/api/social/calendar?month=${calendarDate.getMonth() + 1}&year=${calendarDate.getFullYear()}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch calendar");
      return res.json();
    },
    enabled: activeView === "calendar",
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => apiRequest("DELETE", `/api/social/posts/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/social/posts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/social/calendar"] });
      queryClient.invalidateQueries({ queryKey: ["/api/social/stats"] });
      toast({ title: "Post deleted" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const publishMutation = useMutation({
    mutationFn: async (id: string) => apiRequest("POST", `/api/social/posts/${id}/publish`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/social/posts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/social/calendar"] });
      queryClient.invalidateQueries({ queryKey: ["/api/social/stats"] });
      toast({ title: "Post marked as published" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const duplicateMutation = useMutation({
    mutationFn: async (id: string) => apiRequest("POST", `/api/social/posts/${id}/duplicate`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/social/posts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/social/stats"] });
      toast({ title: "Post duplicated" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const filteredPosts = useMemo(() => {
    const posts = postsQuery.data?.data || [];
    if (!searchQuery) return posts;
    const q = searchQuery.toLowerCase();
    return posts.filter(p =>
      (p.title?.toLowerCase().includes(q)) ||
      p.content.toLowerCase().includes(q) ||
      (p.campaignTag?.toLowerCase().includes(q))
    );
  }, [postsQuery.data, searchQuery]);

  const handleCreateForDate = (date: Date) => {
    setPrefilledDate(date);
    setEditingPost(null);
    setShowCreateDialog(true);
  };

  const handleEdit = (post: SocialPost) => {
    setEditingPost(post);
    setShowCreateDialog(true);
  };

  return (
    <div className="px-3 sm:px-6 py-4 sm:py-6 space-y-6" data-testid="page-social-media">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-page-title">Social Media Manager</h1>
          <p className="text-muted-foreground text-sm">Create, schedule, and manage your social media content</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center rounded-lg border p-0.5">
            <Button
              variant={activeView === "dashboard" ? "default" : "ghost"}
              size="sm"
              onClick={() => setActiveView("dashboard")}
              data-testid="view-dashboard"
            >
              <LayoutDashboard className="h-4 w-4" />
            </Button>
            <Button
              variant={activeView === "list" ? "default" : "ghost"}
              size="sm"
              onClick={() => setActiveView("list")}
              data-testid="view-list"
            >
              <List className="h-4 w-4" />
            </Button>
            <Button
              variant={activeView === "calendar" ? "default" : "ghost"}
              size="sm"
              onClick={() => setActiveView("calendar")}
              data-testid="view-calendar"
            >
              <CalendarIcon className="h-4 w-4" />
            </Button>
            <Button
              variant={activeView === "accounts" ? "default" : "ghost"}
              size="sm"
              onClick={() => setActiveView("accounts")}
              data-testid="view-accounts"
            >
              <Users className="h-4 w-4" />
            </Button>
          </div>
          <Button onClick={() => { setEditingPost(null); setPrefilledDate(null); setShowCreateDialog(true); }} data-testid="button-new-post">
            <Plus className="h-4 w-4 mr-2" />
            New Post
          </Button>
        </div>
      </div>

      {activeView === "dashboard" && (
        <div className="space-y-6">
          <StatsView />
          <ConnectedAccountsSection />
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Recent Posts</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {postsQuery.isLoading ? (
                <div className="space-y-2">
                  {[1, 2, 3].map(i => <Skeleton key={i} className="h-20" />)}
                </div>
              ) : filteredPosts.length > 0 ? (
                filteredPosts.slice(0, 5).map(post => (
                  <PostCard
                    key={post.id}
                    post={post}
                    onEdit={handleEdit}
                    onDelete={id => deleteMutation.mutate(id)}
                    onPublish={id => publishMutation.mutate(id)}
                    onDuplicate={id => duplicateMutation.mutate(id)}
                  />
                ))
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  <Megaphone className="h-12 w-12 mx-auto mb-3 opacity-30" />
                  <p className="text-sm">No posts yet</p>
                  <p className="text-xs mt-1">Create your first social media post to get started</p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {activeView === "list" && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[200px] max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search posts..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="pl-9"
                data-testid="input-search-posts"
              />
            </div>
            <Select value={filterStatus} onValueChange={setFilterStatus}>
              <SelectTrigger className="w-[150px]" data-testid="filter-status">
                <Filter className="h-3.5 w-3.5 mr-2" />
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="DRAFT">Draft</SelectItem>
                <SelectItem value="SCHEDULED">Scheduled</SelectItem>
                <SelectItem value="POSTED">Posted</SelectItem>
                <SelectItem value="PENDING_APPROVAL">Pending Approval</SelectItem>
                <SelectItem value="FAILED">Failed</SelectItem>
              </SelectContent>
            </Select>
            <Select value={filterPlatform} onValueChange={setFilterPlatform}>
              <SelectTrigger className="w-[150px]" data-testid="filter-platform">
                <SelectValue placeholder="Platform" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Platforms</SelectItem>
                {PLATFORMS.map(p => (
                  <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {postsQuery.isLoading ? (
            <div className="space-y-2">
              {[1, 2, 3, 4, 5].map(i => <Skeleton key={i} className="h-20" />)}
            </div>
          ) : filteredPosts.length > 0 ? (
            <div className="space-y-2">
              {filteredPosts.map(post => (
                <PostCard
                  key={post.id}
                  post={post}
                  onEdit={handleEdit}
                  onDelete={id => deleteMutation.mutate(id)}
                  onPublish={id => publishMutation.mutate(id)}
                  onDuplicate={id => duplicateMutation.mutate(id)}
                />
              ))}
            </div>
          ) : (
            <Card>
              <CardContent className="py-12 text-center">
                <Megaphone className="h-12 w-12 mx-auto mb-3 opacity-30 text-muted-foreground" />
                <p className="text-muted-foreground">No posts match your filters</p>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {activeView === "calendar" && (
        <Card>
          <CardContent className="pt-6">
            {calendarQuery.isLoading ? (
              <div className="space-y-4">
                <Skeleton className="h-8 w-48 mx-auto" />
                <Skeleton className="h-[500px]" />
              </div>
            ) : (
              <CalendarView
                posts={calendarQuery.data?.posts || {}}
                currentDate={calendarDate}
                onDateChange={setCalendarDate}
                onEdit={handleEdit}
                onCreateForDate={handleCreateForDate}
              />
            )}
          </CardContent>
        </Card>
      )}

      {activeView === "accounts" && (
        <ConnectedAccountsSection />
      )}

      {showCreateDialog && (
        <CreateEditPostDialog
          open={showCreateDialog}
          onClose={() => { setShowCreateDialog(false); setEditingPost(null); setPrefilledDate(null); }}
          editingPost={editingPost}
          prefilledDate={prefilledDate}
        />
      )}
    </div>
  );
}
