import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import { Users, UserPlus, Mail, X, Copy, Link2, Loader2 } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import type { HustlerLinkRequest } from "./types";

export function CompanyUserInviteTab() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [showInviteHustlerDialog, setShowInviteHustlerDialog] = useState(false);
  const [hustlerEmail, setHustlerEmail] = useState("");
  const [hustlerMessage, setHustlerMessage] = useState("");
  const [hustlerRoleOverride, setHustlerRoleOverride] = useState<string>("");
  const [copiedLink, setCopiedLink] = useState<string | null>(null);

  const { data: hustlerLinkRequests = { requests: [] }, isLoading: loadingHustlerRequests } = useQuery<{ requests: HustlerLinkRequest[] }>({
    queryKey: ["/api/hustler/link-requests/organization"],
    enabled: !!user && user.role === "ADMIN"
  });

  const inviteHustlerMutation = useMutation({
    mutationFn: async (data: { hustlerEmail: string; message?: string; roleOverride?: string }) => {
      return await apiRequest("POST", "/api/hustler/link-requests/invite", data);
    },
    onSuccess: async (response) => {
      const data = await response.json();
      queryClient.invalidateQueries({ queryKey: ["/api/hustler/link-requests/organization"] });
      toast({ title: "Invite sent!", description: `An invite has been created for ${hustlerEmail}` });
      if (data.inviteLink) setCopiedLink(data.inviteLink);
      setShowInviteHustlerDialog(false);
      setHustlerEmail("");
      setHustlerMessage("");
      setHustlerRoleOverride("");
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to create invite", variant: "destructive" });
    }
  });

  const revokeInviteMutation = useMutation({
    mutationFn: async (requestId: string) => {
      return await apiRequest("POST", `/api/hustler/link-requests/${requestId}/revoke`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/hustler/link-requests/organization"] });
      toast({ title: "Invite revoked" });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to revoke invite", variant: "destructive" });
    }
  });

  return (
    <>
      <div className="space-y-6">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div>
            <h2 className="text-xl font-semibold">Hustler Oversight</h2>
            <p className="text-sm text-muted-foreground">
              Invite business owners (HUSTLERs) to have oversight access to your organization
            </p>
          </div>
          <Button onClick={() => setShowInviteHustlerDialog(true)} data-testid="button-invite-hustler">
            <UserPlus className="h-4 w-4 mr-2" /> Invite HUSTLER
          </Button>
        </div>

        {copiedLink && (
          <Alert>
            <Link2 className="h-4 w-4" />
            <AlertDescription className="flex items-center justify-between flex-wrap gap-2">
              <span>Invite link created! Share this with your HUSTLER:</span>
              <div className="flex items-center gap-2">
                <code className="bg-muted px-2 py-1 rounded text-sm">{window.location.origin}{copiedLink}</code>
                <Button size="sm" variant="outline" onClick={() => { navigator.clipboard.writeText(`${window.location.origin}${copiedLink}`); toast({ title: "Link copied to clipboard!" }); }} data-testid="button-copy-link">
                  <Copy className="h-3 w-3" />
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setCopiedLink(null)} data-testid="button-dismiss-link">
                  <X className="h-3 w-3" />
                </Button>
              </div>
            </AlertDescription>
          </Alert>
        )}

        {loadingHustlerRequests ? (
          <div className="space-y-4">
            <Skeleton className="h-24" />
            <Skeleton className="h-24" />
          </div>
        ) : hustlerLinkRequests.requests.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center">
              <Users className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
              <p className="text-muted-foreground">
                No HUSTLER invites or requests yet. Invite a business owner to give them oversight access.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {hustlerLinkRequests.requests.map((request) => (
              <Card key={request.id}>
                <CardContent className="py-4">
                  <div className="flex items-center justify-between flex-wrap gap-4">
                    <div className="flex items-center gap-4">
                      <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
                        <Mail className="h-5 w-5 text-primary" />
                      </div>
                      <div>
                        <p className="font-medium">{request.hustlerEmail}</p>
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                          <span>
                            {request.requestType === "INVITE" ? "Invited" : "Requested"}{" "}
                            {formatDistanceToNow(new Date(request.createdAt), { addSuffix: true })}
                          </span>
                          {request.roleOverride && (
                            <Badge variant="secondary" className="text-xs">Role: {request.roleOverride}</Badge>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge 
                        variant={request.status === "PENDING" ? "secondary" : request.status === "APPROVED" ? "default" : "destructive"}
                        data-testid={`badge-status-${request.id}`}
                      >
                        {request.status}
                      </Badge>
                      {request.status === "PENDING" && (
                        <Button size="sm" variant="ghost" onClick={() => revokeInviteMutation.mutate(request.id)} disabled={revokeInviteMutation.isPending} data-testid={`button-revoke-${request.id}`}>
                          <X className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </div>
                  {request.message && (
                    <p className="mt-2 text-sm text-muted-foreground pl-14">"{request.message}"</p>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      <Dialog open={showInviteHustlerDialog} onOpenChange={setShowInviteHustlerDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Invite HUSTLER</DialogTitle>
            <DialogDescription>Send an invite to a business owner to give them oversight access to your organization</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="hustler-email">HUSTLER Email</Label>
              <Input id="hustler-email" type="email" value={hustlerEmail} onChange={(e) => setHustlerEmail(e.target.value)} placeholder="Enter email address" data-testid="input-hustler-email" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="hustler-role">Role Override (Optional)</Label>
              <Select value={hustlerRoleOverride} onValueChange={setHustlerRoleOverride}>
                <SelectTrigger data-testid="select-hustler-role"><SelectValue placeholder="Default: Read-only oversight" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="NONE">Read-only oversight (default)</SelectItem>
                  <SelectItem value="ADMIN">Admin</SelectItem>
                  <SelectItem value="MANAGER">Manager</SelectItem>
                  <SelectItem value="SUPERINTENDENT">Superintendent</SelectItem>
                  <SelectItem value="ESTIMATOR">Estimator</SelectItem>
                  <SelectItem value="FIELD_WORKER">Field Worker</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="hustler-message">Message (Optional)</Label>
              <Textarea id="hustler-message" value={hustlerMessage} onChange={(e) => setHustlerMessage(e.target.value)} placeholder="Add a personal message..." rows={2} data-testid="input-hustler-message" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowInviteHustlerDialog(false)}>Cancel</Button>
            <Button
              onClick={() => inviteHustlerMutation.mutate({
                hustlerEmail,
                message: hustlerMessage || undefined,
                roleOverride: hustlerRoleOverride && hustlerRoleOverride !== "NONE" ? hustlerRoleOverride : undefined,
              })}
              disabled={!hustlerEmail || inviteHustlerMutation.isPending}
              data-testid="button-send-invite"
            >
              {inviteHustlerMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Send Invite
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
