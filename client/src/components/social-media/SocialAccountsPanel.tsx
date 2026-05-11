import { useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Link2, Link2Off, RefreshCw, CheckCircle2, AlertTriangle, Loader2, ExternalLink, Info } from "lucide-react";
import { type SocialAccount, PLATFORMS, getPlatformInfo } from "./types";

interface PlatformStatus {
  FACEBOOK: boolean;
  INSTAGRAM: boolean;
  LINKEDIN: boolean;
  TWITTER: boolean;
  TIKTOK: boolean;
  YOUTUBE: boolean;
  PINTEREST: boolean;
}

export function SocialAccountsPanel() {
  const { toast } = useToast();

  const { data: accounts, isLoading } = useQuery<SocialAccount[]>({
    queryKey: ["/api/social/accounts"],
  });

  const { data: platformStatus } = useQuery<PlatformStatus>({
    queryKey: ["/api/social/auth/platform-status"],
  });

  // Handle OAuth redirect results from URL params
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const connected = params.get("connected");
    const error = params.get("error");

    if (connected) {
      const info = getPlatformInfo(connected);
      toast({
        title: `${info.label} Connected`,
        description: `Your ${info.label} account was successfully connected.`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/social/accounts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/social/stats"] });
      window.history.replaceState({}, "", "/social-media");
    }

    if (error) {
      const messages: Record<string, string> = {
        facebook_denied: "Facebook connection was cancelled.",
        facebook_failed: "Facebook connection failed. Please try again.",
        facebook_not_configured: "Facebook app credentials are not configured yet.",
        linkedin_denied: "LinkedIn connection was cancelled.",
        linkedin_failed: "LinkedIn connection failed. Please try again.",
        linkedin_not_configured: "LinkedIn app credentials are not configured yet.",
        twitter_denied: "Twitter/X connection was cancelled.",
        twitter_failed: "Twitter/X connection failed. Please try again.",
        twitter_not_configured: "Twitter/X app credentials are not configured yet.",
        tiktok_denied: "TikTok connection was cancelled.",
        tiktok_failed: "TikTok connection failed. Please try again.",
        tiktok_not_configured: "TikTok app credentials are not configured. Contact your admin to set up TikTok integration.",
        youtube_denied: "YouTube connection was cancelled.",
        youtube_failed: "YouTube connection failed. Please try again.",
        youtube_not_configured: "YouTube/Google API credentials are not configured. Contact your admin to set up YouTube integration.",
        pinterest_denied: "Pinterest connection was cancelled.",
        pinterest_failed: "Pinterest connection failed. Please try again.",
        pinterest_not_configured: "Pinterest app credentials are not configured. Contact your admin to set up Pinterest integration.",
      };
      toast({
        title: "Connection Failed",
        description: messages[error] || "Social account connection failed.",
        variant: "destructive",
      });
      window.history.replaceState({}, "", "/social-media");
    }
  }, [toast]);

  const disconnectMutation = useMutation({
    mutationFn: async (id: string) => apiRequest("DELETE", `/api/social/accounts/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/social/accounts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/social/stats"] });
      toast({ title: "Account disconnected" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const refreshMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("POST", `/api/social/accounts/${id}/refresh`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/social/accounts"] });
      toast({ title: "Token refreshed", description: "Account token has been renewed." });
    },
    onError: (e: Error) => toast({ title: "Refresh failed", description: e.message, variant: "destructive" }),
  });

  const getAccountForPlatform = (platform: string) => accounts?.find(a => a.platform === platform);

  const getOAuthUrl = (platform: string): string | null => {
    switch (platform) {
      case "FACEBOOK": return "/api/social/auth/facebook";
      case "INSTAGRAM": return "/api/social/auth/facebook";
      case "LINKEDIN": return "/api/social/auth/linkedin";
      case "TWITTER": return "/api/social/auth/twitter";
      case "TIKTOK": return "/api/social/auth/tiktok";
      case "YOUTUBE": return "/api/social/auth/youtube";
      case "PINTEREST": return "/api/social/auth/pinterest";
      default: return null;
    }
  };

  const isOAuthConfigured = (platform: string): boolean => {
    if (!platformStatus) return false;
    return platformStatus[platform as keyof PlatformStatus] ?? false;
  };

  return (
    <TooltipProvider>
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Link2 className="h-4 w-4" />
            Connected Accounts
          </CardTitle>
          <CardDescription>Connect your social media accounts to enable publishing</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-24" />)}
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
              {PLATFORMS.map(p => {
                const account = getAccountForPlatform(p.value);
                const Icon = p.icon;
                const isConnected = account?.status === "CONNECTED";
                const isExpired = account?.status === "EXPIRED";
                const oauthUrl = getOAuthUrl(p.value);
                const configured = isOAuthConfigured(p.value);
                const comingSoon = !oauthUrl;

                return (
                  <div
                    key={p.value}
                    className={`flex flex-col items-center gap-2 p-3 rounded-lg border transition-colors ${
                      isConnected
                        ? "border-green-200 bg-green-50/50 dark:border-green-900 dark:bg-green-950/30"
                        : isExpired
                        ? "border-amber-200 bg-amber-50/50 dark:border-amber-900 dark:bg-amber-950/30"
                        : "border-dashed"
                    }`}
                    data-testid={`account-${p.value.toLowerCase()}`}
                  >
                    <div className="flex flex-col items-center gap-1">
                      <div style={{ color: isConnected ? p.color : undefined }} className={!isConnected ? "text-muted-foreground" : ""}>
                        <Icon className="h-6 w-6" />
                      </div>
                      <span className="text-xs font-medium text-center leading-tight">{p.label}</span>
                    </div>

                    {isConnected ? (
                      <div className="flex flex-col items-center gap-1.5 w-full">
                        <Badge variant="outline" className="text-xs text-green-600 border-green-300 gap-1 px-1.5 py-0">
                          <CheckCircle2 className="h-3 w-3" />
                          Connected
                        </Badge>
                        {account?.accountName && (
                          <span className="text-xs text-muted-foreground truncate w-full text-center" title={account.accountName}>
                            {account.accountName}
                          </span>
                        )}
                        <div className="flex gap-1 w-full">
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-6 px-1.5 flex-1 text-xs"
                                onClick={() => refreshMutation.mutate(account!.id)}
                                disabled={refreshMutation.isPending}
                                data-testid={`button-refresh-${p.value.toLowerCase()}`}
                              >
                                {refreshMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent><p>Refresh token</p></TooltipContent>
                          </Tooltip>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-6 px-1.5 flex-1 text-xs text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950"
                                onClick={() => disconnectMutation.mutate(account!.id)}
                                disabled={disconnectMutation.isPending}
                                data-testid={`button-disconnect-${p.value.toLowerCase()}`}
                              >
                                {disconnectMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Link2Off className="h-3 w-3" />}
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent><p>Disconnect</p></TooltipContent>
                          </Tooltip>
                        </div>
                      </div>
                    ) : isExpired ? (
                      <div className="flex flex-col items-center gap-1.5 w-full">
                        <Badge variant="outline" className="text-xs text-amber-600 border-amber-300 gap-1 px-1.5 py-0">
                          <AlertTriangle className="h-3 w-3" />
                          Expired
                        </Badge>
                        <div className="flex gap-1 w-full">
                          {oauthUrl && (
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-6 px-1.5 flex-1 text-xs"
                              onClick={() => { window.location.href = oauthUrl; }}
                              data-testid={`button-reconnect-${p.value.toLowerCase()}`}
                            >
                              Reconnect
                            </Button>
                          )}
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-6 px-1.5 text-xs text-red-500 hover:text-red-600"
                                onClick={() => disconnectMutation.mutate(account!.id)}
                                disabled={disconnectMutation.isPending}
                                data-testid={`button-remove-${p.value.toLowerCase()}`}
                              >
                                <Link2Off className="h-3 w-3" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent><p>Remove</p></TooltipContent>
                          </Tooltip>
                        </div>
                      </div>
                    ) : comingSoon ? (
                      <Badge variant="outline" className="text-xs text-muted-foreground gap-1 px-1.5 py-0 cursor-default">
                        <Info className="h-3 w-3" />
                        Not supported
                      </Badge>
                    ) : !configured ? (
                      <Tooltip>
                        <TooltipTrigger>
                          <Badge variant="outline" className="text-xs text-amber-600 border-amber-300 gap-1 px-1.5 py-0 cursor-default">
                            <Info className="h-3 w-3" />
                            Setup Needed
                          </Badge>
                        </TooltipTrigger>
                        <TooltipContent side="bottom" className="max-w-[200px]">
                          <p>{p.label} API credentials not configured. Add them in environment settings to enable OAuth.</p>
                        </TooltipContent>
                      </Tooltip>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 px-2 text-xs w-full gap-1"
                        onClick={() => { window.location.href = oauthUrl!; }}
                        data-testid={`button-connect-${p.value.toLowerCase()}`}
                      >
                        <ExternalLink className="h-3 w-3" />
                        Connect
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          <p className="text-xs text-muted-foreground mt-3">
            Clicking Connect redirects you to the platform's authorization page. All tokens are stored encrypted.
          </p>
        </CardContent>
      </Card>
    </TooltipProvider>
  );
}
