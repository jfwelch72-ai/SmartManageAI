import { useState, useMemo, useEffect, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Plus, Loader2, Edit, Clock, Eye,
  Check, ChevronDown, Send, AlertTriangle
} from "lucide-react";
import { type SocialPost, type SocialAccount, PLATFORMS, CHAR_LIMITS, getPlatformInfo } from "./types";
import { PlatformPreview } from "./SocialPlatformPreview";
import { SocialPostMediaSection } from "./SocialPostMediaSection";
import { SocialPostScheduleSection } from "./SocialPostScheduleSection";
import { SocialAiContentGenerator } from "./SocialAiContentGenerator";

export function SocialPostEditor({ open, onClose, editingPost, prefilledDate }: {
  open: boolean;
  onClose: () => void;
  editingPost: SocialPost | null;
  prefilledDate?: Date | null;
}) {
  const { toast } = useToast();

  interface PlatformStatus {
    FACEBOOK: boolean;
    INSTAGRAM: boolean;
    LINKEDIN: boolean;
    TWITTER: boolean;
    TIKTOK: boolean;
    YOUTUBE: boolean;
    PINTEREST: boolean;
  }

  const { data: platformStatus } = useQuery<PlatformStatus>({
    queryKey: ["/api/social/auth/platform-status"],
  });

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
  const [aiGenerated, setAiGenerated] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
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
    setAiGenerated(false);
    setShowPreview(false);
    setPlatformDropdownOpen(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey]);

  const unconfiguredPlatforms = useMemo(() => {
    if (!platformStatus) return [];
    return form.platforms.filter(p => !(platformStatus[p as keyof PlatformStatus] ?? false));
  }, [form.platforms, platformStatus]);

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
      payload.aiGenerated = aiGenerated;
      payload.aiPrompt = null;
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
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
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
                        const PIcon = pInfo.icon;
                        return <PIcon key={pv} className="h-4 w-4 shrink-0" style={{ color: pInfo.color }} />;
                      })
                    )}
                    {form.platforms.length > 3 && <span className="text-xs text-muted-foreground ml-1">+{form.platforms.length - 3}</span>}
                  </span>
                  <ChevronDown className="h-4 w-4 shrink-0 opacity-50" />
                </button>
                {platformDropdownOpen && (
                  <div className="absolute z-50 mt-1 w-full rounded-md border bg-popover p-1 shadow-md">
                    {PLATFORMS.map(p => {
                      const PIcon = p.icon;
                      const isSelected = form.platforms.includes(p.value);
                      const isConfigured = platformStatus ? (platformStatus[p.value as keyof PlatformStatus] ?? false) : true;
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
                          <PIcon className="h-3.5 w-3.5" style={{ color: p.color }} />
                          <span className={!isConfigured ? "text-muted-foreground" : ""}>{p.label}</span>
                          {!isConfigured && <span className="ml-auto text-xs text-amber-500">Not configured</span>}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
              {unconfiguredPlatforms.length > 0 && (
                <div className="flex items-start gap-2 mt-2 p-2 rounded-md bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800" data-testid="platform-config-warning">
                  <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
                  <p className="text-xs text-amber-700 dark:text-amber-300">
                    {unconfiguredPlatforms.length === 1
                      ? `${getPlatformInfo(unconfiguredPlatforms[0]).label} API credentials are not configured. Posts to this platform will fail to publish.`
                      : `${unconfiguredPlatforms.map(p => getPlatformInfo(p).label).join(", ")} API credentials are not configured. Posts to these platforms will fail to publish.`
                    }
                  </p>
                </div>
              )}
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
                        const PIcon = pInfo.icon;
                        return <Badge key={pv} variant="outline" className="text-xs"><PIcon className="h-3 w-3 mr-1" style={{ color: pInfo.color }} />{pInfo.label}</Badge>;
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

          <SocialPostMediaSection
            mediaUrls={form.mediaUrls}
            onMediaUrlsChange={(urls) => setForm(prev => ({ ...prev, mediaUrls: urls }))}
          />

          <SocialAiContentGenerator
            platform={form.platforms[0] || "FACEBOOK"}
            tone={form.tone}
            onContentGenerated={(data) => {
              setAiGenerated(true);
              setForm(prev => ({
                ...prev,
                content: data.content || prev.content,
                hashtags: data.hashtags || prev.hashtags,
                title: data.title || prev.title,
              }));
            }}
          />

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

          <SocialPostScheduleSection
            scheduleMode={form.scheduleMode}
            scheduledAt={form.scheduledAt}
            isRecurring={form.isRecurring}
            recurringFrequency={form.recurringFrequency}
            recurringInterval={form.recurringInterval}
            notes={form.notes}
            onScheduleModeChange={(mode) => setForm(prev => ({ ...prev, scheduleMode: mode }))}
            onScheduledAtChange={(val) => setForm(prev => ({ ...prev, scheduledAt: val }))}
            onIsRecurringChange={(val) => setForm(prev => ({ ...prev, isRecurring: val }))}
            onRecurringFrequencyChange={(val) => setForm(prev => ({ ...prev, recurringFrequency: val }))}
            onRecurringIntervalChange={(val) => setForm(prev => ({ ...prev, recurringInterval: val }))}
            onNotesChange={(val) => setForm(prev => ({ ...prev, notes: val }))}
            hashtags={form.hashtags}
            hashtagInput={form.hashtagInput}
            campaignTag={form.campaignTag}
            onHashtagsChange={(tags) => setForm(prev => ({ ...prev, hashtags: tags }))}
            onHashtagInputChange={(val) => setForm(prev => ({ ...prev, hashtagInput: val }))}
            onCampaignTagChange={(val) => setForm(prev => ({ ...prev, campaignTag: val }))}
          />
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
          <Button
            variant="outline"
            onClick={() => handleSubmit("PENDING_APPROVAL")}
            disabled={isPending || !form.content.trim() || isOverLimit}
            data-testid="button-submit-for-approval"
            className="border-amber-500 text-amber-600 hover:bg-amber-50 hover:text-amber-700 dark:border-amber-400 dark:text-amber-400 dark:hover:bg-amber-950"
          >
            {isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Send className="h-4 w-4 mr-2" />}
            Submit for Approval
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
