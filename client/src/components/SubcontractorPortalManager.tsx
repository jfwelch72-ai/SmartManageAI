import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Send, Shield, UserPlus, RotateCcw, XCircle, Eye, Clock,
  Copy, Check, ExternalLink, Loader2, Users,
} from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { format, formatDistanceToNow } from "date-fns";

interface SubcontractorPortalManagerProps {
  projectId: string;
  projectCode: string;
  userRole: string;
}

interface PortalToken {
  id: string;
  organizationId: string;
  projectId: string;
  crmOrganisationId: string;
  contactEmail: string;
  contactName: string;
  permissions: string[];
  status: string;
  expiresAt: string;
  lastAccessedAt: string | null;
  invitedByName: string | null;
  createdAt: string;
  revokedAt: string | null;
  project: { id: string; name: string; code: string } | null;
  subcontractor: { id: string; name: string } | null;
}

interface CrmOrganisation {
  id: string;
  name: string;
  type: string;
  isActive: boolean;
}

interface ActivityEntry {
  id: string;
  portalTokenId: string;
  action: string;
  entityType: string | null;
  entityId: string | null;
  ipAddress: string | null;
  createdAt: string;
}

const ACTION_LABELS: Record<string, string> = {
  viewed_rfis_list: "Viewed RFI List",
  viewed_rfi_detail: "Viewed RFI Detail",
  commented_on_rfi: "Posted Comment on RFI",
  viewed_submittals_list: "Viewed Submittals List",
  viewed_submittal_detail: "Viewed Submittal Detail",
  commented_on_submittal: "Posted Comment on Submittal",
  uploaded_submittal_file: "Uploaded File to Submittal",
  viewed_transmittals_list: "Viewed Transmittals List",
  viewed_transmittal_detail: "Viewed Transmittal Detail",
  acknowledged_transmittal: "Acknowledged Transmittal",
};

export default function SubcontractorPortalManager({
  projectId,
  projectCode,
  userRole,
}: SubcontractorPortalManagerProps) {
  const { toast } = useToast();

  const [showInviteDialog, setShowInviteDialog] = useState(false);
  const [showActivityDialog, setShowActivityDialog] = useState(false);
  const [showRevokeConfirm, setShowRevokeConfirm] = useState(false);
  const [selectedTokenId, setSelectedTokenId] = useState<string | null>(null);
  const [selectedTokenName, setSelectedTokenName] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [copyingLinkId, setCopyingLinkId] = useState<string | null>(null);
  const [portalLinkResult, setPortalLinkResult] = useState<string | null>(null);

  const [inviteForm, setInviteForm] = useState({
    crmOrganisationId: "",
    contactName: "",
    contactEmail: "",
    permissions: ["view", "comment", "upload", "acknowledge"] as string[],
    expiresInDays: "90",
  });

  const { data: tokens = [], isLoading: loadingTokens } = useQuery<PortalToken[]>({
    queryKey: ["/api/portal/manage/tokens", `?projectId=${projectId}`],
  });

  const { data: crmOrgs = [], isLoading: loadingOrgs } = useQuery<CrmOrganisation[]>({
    queryKey: ["/api/crm/organisations", "?type=SUBCONTRACTOR"],
    enabled: showInviteDialog,
  });

  const { data: activityLog = [], isLoading: loadingActivity } = useQuery<ActivityEntry[]>({
    queryKey: ["/api/portal/manage/activity", selectedTokenId],
    enabled: !!selectedTokenId && showActivityDialog,
  });

  const activeCount = tokens.filter((t) => t.status === "active").length;

  const inviteMutation = useMutation({
    mutationFn: async (data: typeof inviteForm) => {
      const res = await apiRequest("POST", "/api/portal/manage/invite", {
        projectId,
        crmOrganisationId: data.crmOrganisationId,
        contactEmail: data.contactEmail,
        contactName: data.contactName,
        permissions: data.permissions,
        expiresInDays: parseInt(data.expiresInDays),
      });
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/portal/manage/tokens"] });
      setPortalLinkResult(data.portalLink || null);
      toast({ title: "Invitation sent", description: `Portal access granted to ${inviteForm.contactName}` });
    },
    onError: (error: any) => {
      toast({ title: "Failed to send invitation", description: error.message, variant: "destructive" });
    },
  });

  const resendMutation = useMutation({
    mutationFn: async (tokenId: string) => {
      const res = await apiRequest("POST", `/api/portal/manage/resend/${tokenId}`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/portal/manage/tokens"] });
      toast({ title: "Invite resent", description: "A new portal link has been generated" });
    },
    onError: (error: any) => {
      toast({ title: "Failed to resend invite", description: error.message, variant: "destructive" });
    },
  });

  const revokeMutation = useMutation({
    mutationFn: async (tokenId: string) => {
      await apiRequest("POST", `/api/portal/manage/revoke/${tokenId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/portal/manage/tokens"] });
      toast({ title: "Access revoked", description: "Portal access has been revoked" });
      setShowRevokeConfirm(false);
      setSelectedTokenId(null);
    },
    onError: (error: any) => {
      toast({ title: "Failed to revoke access", description: error.message, variant: "destructive" });
    },
  });

  const handleInviteSubmit = () => {
    if (!inviteForm.crmOrganisationId || !inviteForm.contactEmail || !inviteForm.contactName) {
      toast({ title: "Missing fields", description: "Please fill in all required fields", variant: "destructive" });
      return;
    }
    inviteMutation.mutate(inviteForm);
  };

  const handleCloseInviteDialog = (open: boolean) => {
    if (!open) {
      setShowInviteDialog(false);
      setPortalLinkResult(null);
      setInviteForm({
        crmOrganisationId: "",
        contactName: "",
        contactEmail: "",
        permissions: ["view", "comment", "upload", "acknowledge"],
        expiresInDays: "90",
      });
    } else {
      setShowInviteDialog(true);
    }
  };

  const copyToClipboard = async (text: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
    }
  };

  const handleCopyLink = async (link: string, id: string) => {
    await copyToClipboard(link);
    setCopiedId(id);
    toast({ title: "Copied to clipboard" });
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleCopyTokenLink = async (tokenId: string) => {
    setCopyingLinkId(tokenId);
    try {
      const res = await apiRequest("POST", `/api/portal/manage/link/${tokenId}`);
      const data = await res.json();
      await copyToClipboard(data.portalLink);
      setCopiedId(tokenId);
      toast({ title: "Link Copied", description: "Portal link has been copied to clipboard" });
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      toast({ title: "Error", description: "Failed to copy portal link", variant: "destructive" });
    } finally {
      setCopyingLinkId(null);
    }
  };

  const togglePermission = (perm: string, checked: boolean) => {
    setInviteForm((prev) => ({
      ...prev,
      permissions: checked
        ? [...prev.permissions, perm]
        : prev.permissions.filter((p) => p !== perm),
    }));
  };

  const openActivityDialog = (token: PortalToken) => {
    setSelectedTokenId(token.id);
    setSelectedTokenName(token.subcontractor?.name || token.contactName);
    setShowActivityDialog(true);
  };

  const openRevokeConfirm = (token: PortalToken) => {
    setSelectedTokenId(token.id);
    setSelectedTokenName(token.subcontractor?.name || token.contactName);
    setShowRevokeConfirm(true);
  };

  const getStatusBadge = (token: PortalToken) => {
    const now = new Date();
    const expiresAt = new Date(token.expiresAt);

    if (token.status === "revoked") {
      return (
        <Badge variant="secondary" className="bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200" data-testid={`badge-status-${token.id}`}>
          Revoked
        </Badge>
      );
    }
    if (expiresAt < now) {
      return (
        <Badge variant="secondary" className="bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200" data-testid={`badge-status-${token.id}`}>
          Expired
        </Badge>
      );
    }
    return (
      <Badge variant="secondary" className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200" data-testid={`badge-status-${token.id}`}>
        Active
      </Badge>
    );
  };

  const getActionLabel = (action: string) => ACTION_LABELS[action] || action.replace(/_/g, " ");

  if (loadingTokens) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6" data-testid="portal-manager-container">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Shield className="w-5 h-5" />
              Subcontractor Portal Access
            </CardTitle>
            <p className="text-sm text-muted-foreground mt-1">
              Manage subcontractor access tokens for project {projectCode}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" data-testid="badge-active-count">
              <Users className="w-3 h-3 mr-1" />
              {activeCount} active
            </Badge>
            <Button onClick={() => setShowInviteDialog(true)} data-testid="button-invite-subcontractor">
              <UserPlus className="w-4 h-4 mr-2" />
              Invite Subcontractor
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {tokens.length === 0 ? (
            <div className="text-center py-12" data-testid="portal-empty-state">
              <Shield className="w-12 h-12 mx-auto text-muted-foreground mb-4 opacity-20" />
              <h3 className="font-medium text-lg mb-2">No portal access tokens</h3>
              <p className="text-sm text-muted-foreground mb-4">
                Invite subcontractors to give them access to RFIs, submittals, and transmittals
              </p>
              <Button onClick={() => setShowInviteDialog(true)} data-testid="button-invite-empty">
                <UserPlus className="w-4 h-4 mr-2" />
                Invite Subcontractor
              </Button>
            </div>
          ) : (
            <Table data-testid="portal-tokens-table">
              <TableHeader>
                <TableRow>
                  <TableHead>Subcontractor</TableHead>
                  <TableHead>Contact Email</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Last Accessed</TableHead>
                  <TableHead>Expires</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tokens.map((token) => (
                  <TableRow key={token.id} data-testid={`portal-token-row-${token.id}`}>
                    <TableCell className="font-medium" data-testid={`portal-name-${token.id}`}>
                      {token.subcontractor?.name || token.contactName}
                    </TableCell>
                    <TableCell className="text-muted-foreground" data-testid={`portal-email-${token.id}`}>
                      {token.contactEmail}
                    </TableCell>
                    <TableCell>{getStatusBadge(token)}</TableCell>
                    <TableCell className="text-muted-foreground" data-testid={`portal-last-accessed-${token.id}`}>
                      {token.lastAccessedAt
                        ? formatDistanceToNow(new Date(token.lastAccessedAt), { addSuffix: true })
                        : "Never"}
                    </TableCell>
                    <TableCell className="text-muted-foreground" data-testid={`portal-expires-${token.id}`}>
                      {format(new Date(token.expiresAt), "MMM d, yyyy")}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        {token.status === "active" && new Date(token.expiresAt) > new Date() && (
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => handleCopyTokenLink(token.id)}
                            disabled={copyingLinkId === token.id}
                            data-testid={`button-copy-link-${token.id}`}
                          >
                            {copiedId === token.id ? (
                              <Check className="w-4 h-4 text-green-500" />
                            ) : copyingLinkId === token.id ? (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                              <Copy className="w-4 h-4" />
                            )}
                          </Button>
                        )}
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => openActivityDialog(token)}
                          data-testid={`button-view-activity-${token.id}`}
                        >
                          <Eye className="w-4 h-4" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => resendMutation.mutate(token.id)}
                          disabled={resendMutation.isPending || token.status === "revoked"}
                          data-testid={`button-resend-${token.id}`}
                        >
                          <RotateCcw className="w-4 h-4" />
                        </Button>
                        {token.status !== "revoked" && (
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => openRevokeConfirm(token)}
                            data-testid={`button-revoke-${token.id}`}
                          >
                            <XCircle className="w-4 h-4 text-destructive" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={showInviteDialog} onOpenChange={handleCloseInviteDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Invite Subcontractor to Portal</DialogTitle>
          </DialogHeader>

          {portalLinkResult ? (
            <div className="space-y-4 py-4">
              <div className="p-4 border rounded-lg bg-muted/50">
                <Label className="text-sm font-medium mb-2 block">Portal Link</Label>
                <div className="flex items-center gap-2">
                  <Input
                    value={portalLinkResult}
                    readOnly
                    className="text-sm"
                    data-testid="input-portal-link-result"
                  />
                  <Button
                    size="icon"
                    variant="outline"
                    onClick={() => handleCopyLink(portalLinkResult, "result")}
                    data-testid="button-copy-portal-link"
                  >
                    {copiedId === "result" ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground mt-2">
                  This link has been emailed to the subcontractor. Save it now as it cannot be retrieved later.
                </p>
              </div>
              <DialogFooter>
                <Button onClick={() => handleCloseInviteDialog(false)} data-testid="button-close-invite-success">
                  Done
                </Button>
              </DialogFooter>
            </div>
          ) : (
            <div className="space-y-4 py-4 max-h-[60vh] overflow-y-auto">
              <div className="space-y-2">
                <Label>CRM Organisation *</Label>
                <Select
                  value={inviteForm.crmOrganisationId}
                  onValueChange={(v) => setInviteForm((prev) => ({ ...prev, crmOrganisationId: v }))}
                >
                  <SelectTrigger data-testid="select-crm-organisation">
                    <SelectValue placeholder={loadingOrgs ? "Loading..." : "Select subcontractor company"} />
                  </SelectTrigger>
                  <SelectContent>
                    {crmOrgs.map((org) => (
                      <SelectItem key={org.id} value={org.id}>
                        {org.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Contact Name *</Label>
                <Input
                  value={inviteForm.contactName}
                  onChange={(e) => setInviteForm((prev) => ({ ...prev, contactName: e.target.value }))}
                  placeholder="e.g., John Smith"
                  data-testid="input-contact-name"
                />
              </div>

              <div className="space-y-2">
                <Label>Contact Email *</Label>
                <Input
                  type="email"
                  value={inviteForm.contactEmail}
                  onChange={(e) => setInviteForm((prev) => ({ ...prev, contactEmail: e.target.value }))}
                  placeholder="e.g., john@example.com"
                  data-testid="input-contact-email"
                />
              </div>

              <div className="space-y-2">
                <Label>Permissions</Label>
                <div className="grid grid-cols-2 gap-3 p-3 border rounded-md">
                  {["view", "comment", "upload", "acknowledge"].map((perm) => (
                    <div key={perm} className="flex items-center gap-2">
                      <Checkbox
                        id={`perm-${perm}`}
                        checked={inviteForm.permissions.includes(perm)}
                        onCheckedChange={(checked) => togglePermission(perm, !!checked)}
                        data-testid={`checkbox-perm-${perm}`}
                      />
                      <label htmlFor={`perm-${perm}`} className="text-sm capitalize cursor-pointer">
                        {perm}
                      </label>
                    </div>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <Label>Expiration</Label>
                <Select
                  value={inviteForm.expiresInDays}
                  onValueChange={(v) => setInviteForm((prev) => ({ ...prev, expiresInDays: v }))}
                >
                  <SelectTrigger data-testid="select-expiration">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="30">30 days</SelectItem>
                    <SelectItem value="60">60 days</SelectItem>
                    <SelectItem value="90">90 days</SelectItem>
                    <SelectItem value="180">180 days</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => handleCloseInviteDialog(false)}
                  data-testid="button-cancel-invite"
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleInviteSubmit}
                  disabled={inviteMutation.isPending}
                  data-testid="button-send-invitation"
                >
                  {inviteMutation.isPending ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Sending...
                    </>
                  ) : (
                    <>
                      <Send className="w-4 h-4 mr-2" />
                      Send Invitation
                    </>
                  )}
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={showActivityDialog} onOpenChange={(open) => {
        setShowActivityDialog(open);
        if (!open) setSelectedTokenId(null);
      }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Activity Log - {selectedTokenName}</DialogTitle>
          </DialogHeader>
          <div className="max-h-[50vh] overflow-y-auto py-2">
            {loadingActivity ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
              </div>
            ) : activityLog.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground" data-testid="activity-empty-state">
                <Clock className="w-10 h-10 mx-auto mb-3 opacity-20" />
                <p>No activity recorded yet</p>
              </div>
            ) : (
              <div className="space-y-3" data-testid="activity-log-list">
                {activityLog.map((entry) => (
                  <div
                    key={entry.id}
                    className="flex items-start gap-3 p-3 border rounded-md"
                    data-testid={`activity-entry-${entry.id}`}
                  >
                    <div className="mt-0.5">
                      <Eye className="w-4 h-4 text-muted-foreground" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium" data-testid={`activity-action-${entry.id}`}>
                        {getActionLabel(entry.action)}
                      </p>
                      {entry.entityType && (
                        <p className="text-xs text-muted-foreground">
                          {entry.entityType}{entry.entityId ? ` #${entry.entityId.slice(0, 8)}` : ""}
                        </p>
                      )}
                      <p className="text-xs text-muted-foreground mt-1" data-testid={`activity-time-${entry.id}`}>
                        {format(new Date(entry.createdAt), "MMM d, yyyy h:mm a")}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowActivityDialog(false)} data-testid="button-close-activity">
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showRevokeConfirm} onOpenChange={(open) => {
        setShowRevokeConfirm(open);
        if (!open) setSelectedTokenId(null);
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Revoke Portal Access</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground py-4">
            Are you sure you want to revoke portal access for <strong>{selectedTokenName}</strong>?
            They will no longer be able to view RFIs, submittals, or transmittals through the portal.
          </p>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowRevokeConfirm(false)}
              data-testid="button-cancel-revoke"
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => selectedTokenId && revokeMutation.mutate(selectedTokenId)}
              disabled={revokeMutation.isPending}
              data-testid="button-confirm-revoke"
            >
              {revokeMutation.isPending ? "Revoking..." : "Revoke Access"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
