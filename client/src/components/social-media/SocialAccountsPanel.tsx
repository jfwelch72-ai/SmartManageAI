import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Link2, Loader2 } from "lucide-react";
import { type SocialAccount, PLATFORMS, getPlatformInfo } from "./types";

export function SocialAccountsPanel() {
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
