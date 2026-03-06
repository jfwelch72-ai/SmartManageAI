import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Plus, Calendar as CalendarIcon, List, LayoutDashboard, Loader2,
  AlertCircle, Megaphone, Users, Filter, Search
} from "lucide-react";
import { type SocialPost } from "@/components/social-media/types";
import { PLATFORMS } from "@/components/social-media/types";
import { SocialStatsPanel } from "@/components/social-media/SocialStatsPanel";
import { SocialAccountsPanel } from "@/components/social-media/SocialAccountsPanel";
import { SocialCalendarView } from "@/components/social-media/SocialCalendarView";
import { SocialPostEditor } from "@/components/social-media/SocialPostEditor";
import { PostCard } from "@/components/social-media/SocialPostCard";

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

  const handleRejectClick = (id: string) => {
    setRejectPostId(id);
    setRejectReason("");
    setShowRejectDialog(true);
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
          <SocialStatsPanel />
          <SocialAccountsPanel />
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
                    onReject={handleRejectClick}
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
                  onReject={handleRejectClick}
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
              <SocialCalendarView
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
        <SocialAccountsPanel />
      )}

      {showCreateDialog && (
        <SocialPostEditor
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
