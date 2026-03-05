import { useState, useMemo, useEffect, useRef } from "react";
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
  Hash, Image, Link2, Megaphone, TrendingUp, Users, Filter, Search,
  Upload, Check, ChevronDown, Wand2
} from "lucide-react";
import { SiFacebook, SiInstagram, SiLinkedin, SiYoutube, SiTiktok, SiPinterest } from "react-icons/si";
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isSameDay, isSameMonth, addMonths, subMonths, startOfWeek, endOfWeek, isToday } from "date-fns";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import { ObjectUploader } from "@/components/ObjectUploader";

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
  socialAccountId: string | null;
  externalPostUrl: string | null;
  rejectionReason: string | null;
  approvalStatus: string | null;
  lastError: string | null;
  warning?: string;
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

function PostCard({ post, onEdit, onDelete, onPublish, onDuplicate, onReject }: {
  post: SocialPost;
  onEdit: (post: SocialPost) => void;
  onDelete: (id: string) => void;
  onPublish: (id: string) => void;
  onDuplicate: (id: string) => void;
  onReject: (id: string) => void;
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
              {post.mediaUrls && post.mediaUrls.length > 0 && (
                <div className="flex gap-1 mt-2">
                  {post.mediaUrls.slice(0, 4).map((url, i) => (
                    <div key={i} className="w-10 h-10 rounded border overflow-hidden shrink-0">
                      <img src={url} alt="" className="w-full h-full object-cover" />
                    </div>
                  ))}
                  {post.mediaUrls.length > 4 && (
                    <div className="w-10 h-10 rounded border flex items-center justify-center text-xs text-muted-foreground">+{post.mediaUrls.length - 4}</div>
                  )}
                </div>
              )}
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
                {post.externalPostUrl && (
                  <a href={post.externalPostUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-primary hover:underline" onClick={e => e.stopPropagation()}>
                    <ExternalLink className="h-3 w-3" />View Post
                  </a>
                )}
              </div>
              {post.rejectionReason && post.approvalStatus === "rejected" && (
                <div className="mt-2 px-2 py-1.5 rounded bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 text-xs text-red-700 dark:text-red-400" data-testid={`rejection-reason-${post.id}`}>
                  <strong>Rejected:</strong> {post.rejectionReason}
                </div>
              )}
              {post.status === "FAILED" && post.lastError && (
                <div className="mt-2 px-2 py-1.5 rounded bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 text-xs text-red-700 dark:text-red-400">
                  <strong>Error:</strong> {post.lastError}
                </div>
              )}
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
                  <Send className="h-4 w-4 mr-2" />Publish Now
                </DropdownMenuItem>
              )}
              {post.status === "PENDING_APPROVAL" && (
                <DropdownMenuItem onClick={() => onReject(post.id)} className="text-amber-600" data-testid={`reject-post-${post.id}`}>
                  <AlertCircle className="h-4 w-4 mr-2" />Reject
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
  const [connectForm, setConnectForm] = useState({ accountName: "", accountId: "", accessToken: "", refreshToken: "" });
  const [tokenStatuses, setTokenStatuses] = useState<Record<string, { valid: boolean; error?: string; expiresAt?: string }>>({});

  const connectMutation = useMutation({
    mutationFn: async (data: any) => apiRequest("POST", "/api/social/accounts", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/social/accounts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/social/stats"] });
      toast({ title: "Account connected" });
      setShowConnectDialog(false);
      setConnectForm({ accountName: "", accountId: "", accessToken: "", refreshToken: "" });
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
                const isExpired = account?.status === "EXPIRED";
                const tokenStatus = account ? tokenStatuses[account.id] : undefined;

                return (
                  <div
                    key={p.value}
                    className={`flex flex-col items-center gap-2 p-3 rounded-lg border transition-colors ${isConnected ? "border-green-200 bg-green-50/50 dark:border-green-900 dark:bg-green-950/30" : isExpired ? "border-amber-200 bg-amber-50/50 dark:border-amber-900 dark:bg-amber-950/30" : "border-dashed"}`}
                    data-testid={`account-${p.value.toLowerCase()}`}
                  >
                    <Icon className="h-6 w-6" style={{ color: p.color }} />
                    <span className="text-xs font-medium text-center">{p.label}</span>
                    {account ? (
                      <>
                        <Badge variant={isConnected ? "default" : isExpired ? "destructive" : "secondary"} className="text-[10px]">
                          {account.status}
                        </Badge>
                        {account.accountName && (
                          <span className="text-[10px] text-muted-foreground truncate max-w-full">{account.accountName}</span>
                        )}
                        {tokenStatus && (
                          <div className={`w-2 h-2 rounded-full ${tokenStatus.valid ? "bg-green-500" : "bg-red-500"}`} title={tokenStatus.valid ? "Token valid" : tokenStatus.error || "Token invalid"} />
                        )}
                        {isExpired ? (
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-6 text-xs text-amber-600"
                            onClick={() => { setConnectPlatform(p.value); setShowConnectDialog(true); }}
                            data-testid={`reconnect-${p.value.toLowerCase()}`}
                          >
                            Reconnect
                          </Button>
                        ) : (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 text-xs text-destructive"
                            onClick={() => disconnectMutation.mutate(account.id)}
                            data-testid={`disconnect-${p.value.toLowerCase()}`}
                          >
                            Disconnect
                          </Button>
                        )}
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
            <div>
              <Label>Refresh Token (optional)</Label>
              <Input
                type="password"
                placeholder="Your refresh token for auto-renewal"
                value={connectForm.refreshToken}
                onChange={e => setConnectForm(prev => ({ ...prev, refreshToken: e.target.value }))}
                data-testid="input-refresh-token"
              />
              <p className="text-xs text-muted-foreground mt-1">Used to automatically renew access tokens before they expire.</p>
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
                refreshToken: connectForm.refreshToken || undefined,
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

function PlatformPreview({ platform, content, hashtags, mediaUrls }: { platform: string; content: string; hashtags: string[]; mediaUrls: string[] }) {
  const info = getPlatformInfo(platform);
  const Icon = info.icon;
  const fullContent = content + (hashtags.length > 0 ? "\n\n" + hashtags.map(h => `#${h}`).join(" ") : "");
  const charLimit = CHAR_LIMITS[platform] || 5000;
  const isOver = fullContent.length > charLimit;

  if (platform === "TWITTER") {
    return (
      <div className="rounded-xl border p-4 max-w-sm bg-background">
        <div className="flex gap-3">
          <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center shrink-0"><Icon className="h-5 w-5" /></div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1">
              <span className="text-sm font-bold">Your Company</span>
              <span className="text-xs text-muted-foreground">@company · now</span>
            </div>
            <p className={`text-sm mt-1 whitespace-pre-wrap ${isOver ? "text-destructive" : ""}`}>{fullContent || "Your tweet will appear here..."}</p>
            {mediaUrls.length > 0 && (
              <div className={`mt-2 grid gap-1 ${mediaUrls.length === 1 ? "grid-cols-1" : "grid-cols-2"} rounded-xl overflow-hidden`}>
                {mediaUrls.slice(0, 4).map((url, i) => <img key={i} src={url} alt="" className="w-full h-32 object-cover" />)}
              </div>
            )}
            <div className="flex justify-between mt-3 text-muted-foreground max-w-[250px]">
              {["💬", "🔁", "❤️", "📤"].map((e, i) => <span key={i} className="text-xs">{e}</span>)}
            </div>
          </div>
        </div>
        <p className={`text-xs mt-2 ${isOver ? "text-destructive font-medium" : "text-muted-foreground"}`}>{fullContent.length}/{charLimit}</p>
      </div>
    );
  }

  if (platform === "INSTAGRAM") {
    return (
      <div className="rounded-xl border max-w-sm bg-background overflow-hidden">
        <div className="flex items-center gap-2 px-3 py-2">
          <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-yellow-400 via-pink-500 to-purple-600 p-0.5"><div className="w-full h-full rounded-full bg-background flex items-center justify-center"><Icon className="h-3.5 w-3.5" style={{ color: info.color }} /></div></div>
          <span className="text-xs font-semibold">your_company</span>
        </div>
        <div className="aspect-square bg-muted flex items-center justify-center">
          {mediaUrls.length > 0 ? <img src={mediaUrls[0]} alt="" className="w-full h-full object-cover" /> : <Image className="h-12 w-12 text-muted-foreground/30" />}
        </div>
        <div className="px-3 py-2">
          <div className="flex gap-3 mb-2 text-lg">❤️ 💬 📤</div>
          <p className="text-xs"><strong>your_company</strong> {content || "Caption..."}</p>
          {hashtags.length > 0 && <p className="text-xs text-blue-500 mt-1">{hashtags.map(h => `#${h}`).join(" ")}</p>}
        </div>
      </div>
    );
  }

  if (platform === "LINKEDIN") {
    return (
      <div className="rounded-xl border max-w-md bg-background p-4">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center"><Icon className="h-6 w-6" style={{ color: info.color }} /></div>
          <div>
            <p className="text-sm font-semibold">Your Company</p>
            <p className="text-xs text-muted-foreground">Construction · Just now</p>
          </div>
        </div>
        <p className="text-sm whitespace-pre-wrap">{fullContent || "Your post will appear here..."}</p>
        {mediaUrls.length > 0 && (
          <div className="mt-3 rounded-lg overflow-hidden border">
            <img src={mediaUrls[0]} alt="" className="w-full h-48 object-cover" />
          </div>
        )}
        <Separator className="my-3" />
        <div className="flex justify-around text-xs text-muted-foreground">
          {["👍 Like", "💬 Comment", "🔁 Repost", "📤 Send"].map(a => <span key={a}>{a}</span>)}
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border max-w-md bg-background p-4">
      <div className="flex items-center gap-3 mb-3">
        <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center"><Icon className="h-5 w-5" style={{ color: info.color }} /></div>
        <div>
          <p className="text-sm font-semibold">Your Company</p>
          <p className="text-xs text-muted-foreground">Just now · 🌐</p>
        </div>
      </div>
      <p className="text-sm whitespace-pre-wrap">{fullContent || "Your post will appear here..."}</p>
      {mediaUrls.length > 0 && (
        <div className={`mt-3 grid gap-1 ${mediaUrls.length === 1 ? "grid-cols-1" : "grid-cols-2"} rounded-lg overflow-hidden`}>
          {mediaUrls.slice(0, 4).map((url, i) => <img key={i} src={url} alt="" className="w-full h-40 object-cover" />)}
        </div>
      )}
      <Separator className="my-3" />
      <div className="flex justify-around text-xs text-muted-foreground">
        {["👍 Like", "💬 Comment", "↗ Share"].map(a => <span key={a}>{a}</span>)}
      </div>
      {isOver && <p className="text-xs text-destructive mt-2">{fullContent.length}/{charLimit} characters</p>}
    </div>
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
    platforms: ["FACEBOOK"] as string[],
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
    mediaUrls: [] as string[],
    socialAccountId: "" as string,
  });

  const [form, setForm] = useState(getDefaultForm());
  const [aiTopic, setAiTopic] = useState("");
  const [aiResult, setAiResult] = useState<any>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [mediaUrlInput, setMediaUrlInput] = useState("");
  const [mediaMode, setMediaMode] = useState<"none" | "url" | "ai">("none");
  const [aiImagePrompt, setAiImagePrompt] = useState("");
  const [platformDropdownOpen, setPlatformDropdownOpen] = useState(false);
  const platformDropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!platformDropdownOpen) return;
    const handler = (e: MouseEvent) => {
      if (platformDropdownRef.current && !platformDropdownRef.current.contains(e.target as Node)) {
        setPlatformDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [platformDropdownOpen]);

  const { data: accounts } = useQuery<SocialAccount[]>({
    queryKey: ["/api/social/accounts"],
    enabled: open,
  });

  const platformAccounts = useMemo(() => {
    if (!accounts) return [];
    return accounts.filter(a => form.platforms.includes(a.platform) && a.status === "CONNECTED");
  }, [accounts, form.platforms]);

  const isEditing = !!editingPost;

  const resetKey = open ? (editingPost?.id || "new") + (prefilledDate?.toISOString() || "") : "";
  useEffect(() => {
    if (!open) return;
    if (editingPost) {
      setForm({
        title: editingPost.title || "",
        content: editingPost.content || "",
        platforms: (editingPost.platforms && editingPost.platforms.length > 0) ? editingPost.platforms : (editingPost.platform ? [editingPost.platform] : ["FACEBOOK"]),
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
        mediaUrls: editingPost.mediaUrls || [],
        socialAccountId: editingPost.socialAccountId || "",
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
    setShowPreview(false);
    setMediaUrlInput("");
    setMediaMode("none");
    setAiImagePrompt("");
    setPlatformDropdownOpen(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey]);

  const charLimit = form.platforms.length > 0 ? Math.min(...form.platforms.map(p => CHAR_LIMITS[p] || 5000)) : 5000;
  const charCount = form.content.length;
  const isOverLimit = charCount > charLimit;

  const createMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("POST", "/api/social/posts", data);
      return res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/social/posts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/social/calendar"] });
      queryClient.invalidateQueries({ queryKey: ["/api/social/stats"] });
      toast({ title: "Post created" });
      if (data?.warning) {
        toast({ title: "Note", description: data.warning });
      }
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
        platform: form.platforms[0] || "FACEBOOK",
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

  const generateImageMutation = useMutation({
    mutationFn: async (prompt: string) => {
      const res = await apiRequest("POST", "/api/social/posts/generate-image", { prompt });
      return res.json();
    },
    onSuccess: (data: any) => {
      if (data.imageUrl) {
        setForm(prev => ({ ...prev, mediaUrls: [...prev.mediaUrls, data.imageUrl] }));
        setAiImagePrompt("");
        setMediaMode("none");
        toast({ title: "Image generated" });
      }
    },
    onError: (e: Error) => toast({ title: "Image generation failed", description: e.message, variant: "destructive" }),
  });

  const onGetUploadParameters = async () => {
    const response = await apiRequest("POST", "/api/objects/upload");
    const data = await response.json();
    return { method: "PUT" as const, url: data.uploadURL };
  };

  const handleUploadComplete = (result: any) => {
    if (!result.successful || result.successful.length === 0) {
      toast({ title: "Upload failed", variant: "destructive" });
      return;
    }
    const fileUrl = result.successful[0].uploadURL;
    if (fileUrl) {
      setForm(prev => ({ ...prev, mediaUrls: [...prev.mediaUrls, fileUrl] }));
      toast({ title: "Image uploaded" });
    }
  };

  const handleSubmit = (saveStatus: string) => {
    if (form.platforms.length === 0) {
      toast({ title: "Select at least one platform", variant: "destructive" });
      return;
    }
    if (saveStatus === "SCHEDULED" && !form.socialAccountId && platformAccounts.length > 0) {
      toast({ title: "Please select an account", description: "Select which connected account to publish to before scheduling.", variant: "destructive" });
      return;
    }

    const payload: any = {
      title: form.title || null,
      content: form.content,
      platform: form.platforms[0] || null,
      platforms: form.platforms,
      status: saveStatus,
      hashtags: form.hashtags.length > 0 ? form.hashtags : null,
      campaignTag: form.campaignTag || null,
      tone: form.tone,
      notes: form.notes || null,
      isRecurring: form.isRecurring,
      utmSource: form.utmSource || null,
      utmMedium: form.utmMedium || null,
      utmCampaign: form.utmCampaign || null,
      mediaUrls: form.mediaUrls.length > 0 ? form.mediaUrls : null,
      socialAccountId: form.socialAccountId || null,
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
              <Label>Platforms</Label>
              <div className="relative" ref={platformDropdownRef}>
                <button
                  type="button"
                  className="flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                  onClick={() => setPlatformDropdownOpen(!platformDropdownOpen)}
                  data-testid="select-platform"
                >
                  <span className="flex items-center gap-1 overflow-hidden">
                    {form.platforms.length === 0 ? (
                      <span className="text-muted-foreground">Select platforms...</span>
                    ) : (
                      form.platforms.slice(0, 3).map(pv => {
                        const pInfo = getPlatformInfo(pv);
                        const Icon = pInfo.icon;
                        return <Icon key={pv} className="h-4 w-4 shrink-0" style={{ color: pInfo.color }} />;
                      })
                    )}
                    {form.platforms.length > 3 && <span className="text-xs text-muted-foreground ml-1">+{form.platforms.length - 3}</span>}
                  </span>
                  <ChevronDown className="h-4 w-4 shrink-0 opacity-50" />
                </button>
                {platformDropdownOpen && (
                  <div className="absolute z-50 mt-1 w-full rounded-md border bg-popover p-1 shadow-md">
                    {PLATFORMS.map(p => {
                      const Icon = p.icon;
                      const isSelected = form.platforms.includes(p.value);
                      return (
                        <button
                          key={p.value}
                          type="button"
                          className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground"
                          onClick={() => {
                            setForm(prev => {
                              const next = isSelected
                                ? prev.platforms.filter(v => v !== p.value)
                                : [...prev.platforms, p.value];
                              return { ...prev, platforms: next.length === 0 ? prev.platforms : next };
                            });
                          }}
                          data-testid={`platform-option-${p.value.toLowerCase()}`}
                        >
                          <div className={`flex h-4 w-4 items-center justify-center rounded-sm border ${isSelected ? "bg-primary border-primary" : "border-muted-foreground/30"}`}>
                            {isSelected && <Check className="h-3 w-3 text-primary-foreground" />}
                          </div>
                          <Icon className="h-3.5 w-3.5" style={{ color: p.color }} />
                          <span>{p.label}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
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
              <div className="flex items-center gap-2">
                <Label>Content</Label>
                <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={() => setShowPreview(!showPreview)} data-testid="toggle-preview">
                  <Eye className="h-3 w-3 mr-1" />{showPreview ? "Edit" : "Preview"}
                </Button>
              </div>
              <span className={`text-xs ${isOverLimit ? "text-destructive font-medium" : "text-muted-foreground"}`}>
                {charCount}/{charLimit}
              </span>
            </div>
            {showPreview ? (
              <div className="flex justify-center p-4 bg-muted/30 rounded-lg min-h-[200px]">
                <div className="w-full space-y-2">
                  {form.platforms.length > 1 && (
                    <div className="flex gap-1 justify-center mb-2">
                      {form.platforms.map(pv => {
                        const pInfo = getPlatformInfo(pv);
                        const Icon = pInfo.icon;
                        return <Badge key={pv} variant="outline" className="text-xs"><Icon className="h-3 w-3 mr-1" style={{ color: pInfo.color }} />{pInfo.label}</Badge>;
                      })}
                    </div>
                  )}
                  <PlatformPreview platform={form.platforms[0] || "FACEBOOK"} content={form.content} hashtags={form.hashtags} mediaUrls={form.mediaUrls} />
                </div>
              </div>
            ) : (
              <Textarea
                placeholder="Write your post content..."
                value={form.content}
                onChange={e => setForm(prev => ({ ...prev, content: e.target.value }))}
                className="min-h-[120px]"
                data-testid="input-post-content"
              />
            )}
          </div>

          {platformAccounts.length > 0 && (
            <div>
              <Label>Post to Account</Label>
              <Select value={form.socialAccountId} onValueChange={v => setForm(prev => ({ ...prev, socialAccountId: v }))}>
                <SelectTrigger data-testid="select-account">
                  <SelectValue placeholder="Select an account..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">No account selected</SelectItem>
                  {platformAccounts.map(a => (
                    <SelectItem key={a.id} value={a.id}>{a.accountName || a.platform}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {form.scheduleMode === "schedule" && !form.socialAccountId && (
                <p className="text-xs text-amber-600 mt-1">Select an account to enable publishing when scheduled</p>
              )}
            </div>
          )}

          <div>
            <Label>Media ({form.mediaUrls.length}/4)</Label>
            {form.mediaUrls.length > 0 && (
              <div className="flex gap-2 mb-2 flex-wrap">
                {form.mediaUrls.map((url, i) => (
                  <div key={i} className="relative w-16 h-16 rounded-lg border overflow-hidden group">
                    <img src={url} alt="" className="w-full h-full object-cover" />
                    <button
                      className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center"
                      onClick={() => setForm(prev => ({ ...prev, mediaUrls: prev.mediaUrls.filter((_, j) => j !== i) }))}
                      data-testid={`remove-media-${i}`}
                    >
                      <Trash2 className="h-4 w-4 text-white" />
                    </button>
                  </div>
                ))}
              </div>
            )}
            {form.mediaUrls.length < 4 && (
              <div className="space-y-2">
                <div className="flex gap-2">
                  <ObjectUploader
                    maxNumberOfFiles={1}
                    maxFileSize={10485760}
                    allowedFileTypes={["image/*"]}
                    onGetUploadParameters={onGetUploadParameters}
                    onComplete={handleUploadComplete}
                    testId="button-upload-media"
                  >
                    <Button variant="outline" size="sm" type="button" className="gap-1.5" data-testid="button-upload-media">
                      <Upload className="h-3.5 w-3.5" />
                      Upload
                    </Button>
                  </ObjectUploader>
                  <Button
                    variant={mediaMode === "url" ? "secondary" : "outline"}
                    size="sm"
                    type="button"
                    className="gap-1.5"
                    onClick={() => setMediaMode(mediaMode === "url" ? "none" : "url")}
                    data-testid="button-media-url-toggle"
                  >
                    <Link2 className="h-3.5 w-3.5" />
                    URL
                  </Button>
                  <Button
                    variant={mediaMode === "ai" ? "secondary" : "outline"}
                    size="sm"
                    type="button"
                    className="gap-1.5"
                    onClick={() => setMediaMode(mediaMode === "ai" ? "none" : "ai")}
                    data-testid="button-media-ai-toggle"
                  >
                    <Wand2 className="h-3.5 w-3.5" />
                    Generate
                  </Button>
                </div>
                {mediaMode === "url" && (
                  <div className="flex gap-2">
                    <Input
                      placeholder="Paste an image URL..."
                      value={mediaUrlInput}
                      onChange={e => setMediaUrlInput(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          if (mediaUrlInput.trim()) {
                            setForm(prev => ({ ...prev, mediaUrls: [...prev.mediaUrls, mediaUrlInput.trim()] }));
                            setMediaUrlInput("");
                          }
                        }
                      }}
                      data-testid="input-media-url"
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        if (mediaUrlInput.trim()) {
                          setForm(prev => ({ ...prev, mediaUrls: [...prev.mediaUrls, mediaUrlInput.trim()] }));
                          setMediaUrlInput("");
                        }
                      }}
                      disabled={!mediaUrlInput.trim()}
                      data-testid="button-add-media-url"
                    >
                      <Plus className="h-4 w-4" />
                    </Button>
                  </div>
                )}
                {mediaMode === "ai" && (
                  <div className="flex gap-2">
                    <Input
                      placeholder="Describe the image you want..."
                      value={aiImagePrompt}
                      onChange={e => setAiImagePrompt(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          if (aiImagePrompt.trim().length >= 3) generateImageMutation.mutate(aiImagePrompt.trim());
                        }
                      }}
                      data-testid="input-ai-image-prompt"
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => generateImageMutation.mutate(aiImagePrompt.trim())}
                      disabled={generateImageMutation.isPending || aiImagePrompt.trim().length < 3}
                      data-testid="button-generate-image"
                    >
                      {generateImageMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                    </Button>
                  </div>
                )}
              </div>
            )}
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
  const [showRejectDialog, setShowRejectDialog] = useState(false);
  const [rejectPostId, setRejectPostId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");

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

  const rejectMutation = useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason: string }) => apiRequest("POST", `/api/social/posts/${id}/reject`, { reason }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/social/posts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/social/calendar"] });
      queryClient.invalidateQueries({ queryKey: ["/api/social/stats"] });
      toast({ title: "Post rejected" });
      setShowRejectDialog(false);
      setRejectPostId(null);
      setRejectReason("");
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
                    onReject={id => { setRejectPostId(id); setRejectReason(""); setShowRejectDialog(true); }}
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
                  onReject={id => { setRejectPostId(id); setRejectReason(""); setShowRejectDialog(true); }}
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

      <Dialog open={showRejectDialog} onOpenChange={setShowRejectDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Reject Post</DialogTitle>
            <DialogDescription>Provide a reason for rejecting this post. The creator will see this feedback.</DialogDescription>
          </DialogHeader>
          <div>
            <Label>Rejection Reason</Label>
            <Textarea
              placeholder="Explain why this post is being rejected..."
              value={rejectReason}
              onChange={e => setRejectReason(e.target.value)}
              className="min-h-[80px]"
              data-testid="input-reject-reason"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowRejectDialog(false)}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={() => { if (rejectPostId) rejectMutation.mutate({ id: rejectPostId, reason: rejectReason }); }}
              disabled={rejectMutation.isPending}
              data-testid="button-confirm-reject"
            >
              {rejectMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <AlertCircle className="h-4 w-4 mr-2" />}
              Reject Post
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
