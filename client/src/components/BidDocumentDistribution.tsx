import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Send, Plus, Eye, MessageSquare, Clock } from "lucide-react";
import { format } from "date-fns";

interface BidDocumentDistributionProps {
  bidId?: string;
  projectId?: string;
  projectName?: string;
  userRole: string;
}

interface Distribution {
  id: string;
  contactName: string;
  contactEmail: string;
  documentTitle: string;
  documentType: string;
  status: string;
  sentAt: string;
  viewedAt: string | null;
  respondedAt: string | null;
  responseNotes: string | null;
  sentByName: string | null;
  portalTokenId: string | null;
}

interface CrmOrg {
  id: string;
  name: string;
  type: string;
}

const DOCUMENT_TYPES = [
  { value: "RFI", label: "RFI" },
  { value: "Submittal", label: "Submittal" },
  { value: "Transmittal", label: "Transmittal" },
  { value: "Bid Package", label: "Bid Package" },
  { value: "Plans", label: "Plans" },
  { value: "Specs", label: "Specs" },
];

const EXPIRATION_OPTIONS = [
  { value: "30", label: "30 days" },
  { value: "60", label: "60 days" },
  { value: "90", label: "90 days" },
  { value: "180", label: "180 days" },
];

function getStatusVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
  switch (status) {
    case "sent": return "default";
    case "viewed": return "secondary";
    case "responded": return "default";
    case "expired": return "outline";
    default: return "secondary";
  }
}

function getStatusClass(status: string): string {
  switch (status) {
    case "sent": return "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200";
    case "viewed": return "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200";
    case "responded": return "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200";
    case "expired": return "bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300";
    default: return "";
  }
}

export default function BidDocumentDistribution({ bidId, projectId, projectName, userRole }: BidDocumentDistributionProps) {
  const { toast } = useToast();
  const [showSendDialog, setShowSendDialog] = useState(false);
  const [selectedCrmOrgId, setSelectedCrmOrgId] = useState("");
  const [contactName, setContactName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [documentType, setDocumentType] = useState("");
  const [documentTitle, setDocumentTitle] = useState("");
  const [messageBody, setMessageBody] = useState("");
  const [createPortalAccess, setCreatePortalAccess] = useState(!!projectId);
  const [expiresInDays, setExpiresInDays] = useState("90");

  const queryParams = bidId ? `bidId=${bidId}` : projectId ? `projectId=${projectId}` : "";

  const { data: distributions = [], isLoading } = useQuery<Distribution[]>({
    queryKey: ["/api/bid-docs/distributions", `?${queryParams}`],
    enabled: !!(bidId || projectId),
  });

  const { data: crmOrgs = [] } = useQuery<CrmOrg[]>({
    queryKey: ["/api/crm/organisations", "?type=SUBCONTRACTOR"],
  });

  const sendMutation = useMutation({
    mutationFn: async (payload: Record<string, unknown>) => {
      const res = await apiRequest("POST", "/api/bid-docs/send", payload);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/bid-docs/distributions"] });
      toast({ title: "Success", description: "Document sent successfully" });
      resetForm();
      setShowSendDialog(false);
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to send document", variant: "destructive" });
    },
  });

  const updateStatusMutation = useMutation({
    mutationFn: async ({ id, status, responseNotes }: { id: string; status: string; responseNotes?: string }) => {
      const res = await apiRequest("PATCH", `/api/bid-docs/distributions/${id}/status`, { status, responseNotes });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/bid-docs/distributions"] });
      toast({ title: "Success", description: "Status updated" });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to update status", variant: "destructive" });
    },
  });

  function resetForm() {
    setSelectedCrmOrgId("");
    setContactName("");
    setContactEmail("");
    setDocumentType("");
    setDocumentTitle("");
    setMessageBody("");
    setCreatePortalAccess(!!projectId);
    setExpiresInDays("90");
  }

  function handleSend() {
    if (!selectedCrmOrgId || !contactName || !contactEmail || !documentType || !documentTitle) {
      toast({ title: "Error", description: "Please fill in all required fields", variant: "destructive" });
      return;
    }
    sendMutation.mutate({
      bidId: bidId || null,
      projectId: projectId || null,
      crmOrganisationId: selectedCrmOrgId,
      contactName,
      contactEmail,
      documentType,
      documentTitle,
      messageBody: messageBody || null,
      createPortalAccess,
      expiresInDays: parseInt(expiresInDays),
    });
  }

  const canManage = ["ADMIN", "MANAGER"].includes(userRole);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
        <div className="flex items-center gap-2">
          <Send className="w-5 h-5 text-muted-foreground" />
          <CardTitle>Document Distribution</CardTitle>
        </div>
        <Button onClick={() => setShowSendDialog(true)} data-testid="button-send-document">
          <Plus className="w-4 h-4 mr-2" />
          Send Document
        </Button>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <p className="text-sm text-muted-foreground">Loading distributions...</p>
          </div>
        ) : distributions.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <Send className="w-8 h-8 text-muted-foreground mb-2" />
            <p className="text-sm text-muted-foreground">No documents distributed yet</p>
            <p className="text-xs text-muted-foreground mt-1">Send bid packages, plans, or specs to prospective subcontractors</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Recipient</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Document</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Sent</TableHead>
                  {canManage && <TableHead>Actions</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {distributions.map((dist) => (
                  <TableRow key={dist.id} data-testid={`row-distribution-${dist.id}`}>
                    <TableCell className="font-medium" data-testid={`text-recipient-${dist.id}`}>{dist.contactName}</TableCell>
                    <TableCell className="text-sm text-muted-foreground" data-testid={`text-email-${dist.id}`}>{dist.contactEmail}</TableCell>
                    <TableCell data-testid={`text-doc-title-${dist.id}`}>{dist.documentTitle}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="no-default-hover-elevate no-default-active-elevate" data-testid={`badge-doc-type-${dist.id}`}>{dist.documentType}</Badge>
                    </TableCell>
                    <TableCell>
                      <Badge className={`no-default-hover-elevate no-default-active-elevate ${getStatusClass(dist.status)}`} data-testid={`badge-status-${dist.id}`}>
                        {dist.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground" data-testid={`text-sent-date-${dist.id}`}>
                      {dist.sentAt ? format(new Date(dist.sentAt), "MMM d, yyyy") : "N/A"}
                    </TableCell>
                    {canManage && (
                      <TableCell>
                        <div className="flex items-center gap-1">
                          {dist.status === "sent" && (
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={() => updateStatusMutation.mutate({ id: dist.id, status: "viewed" })}
                              data-testid={`button-mark-viewed-${dist.id}`}
                            >
                              <Eye className="w-4 h-4" />
                            </Button>
                          )}
                          {(dist.status === "sent" || dist.status === "viewed") && (
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={() => updateStatusMutation.mutate({ id: dist.id, status: "responded" })}
                              data-testid={`button-mark-responded-${dist.id}`}
                            >
                              <MessageSquare className="w-4 h-4" />
                            </Button>
                          )}
                          {dist.status !== "expired" && (
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={() => updateStatusMutation.mutate({ id: dist.id, status: "expired" })}
                              data-testid={`button-mark-expired-${dist.id}`}
                            >
                              <Clock className="w-4 h-4" />
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>

      <Dialog open={showSendDialog} onOpenChange={setShowSendDialog}>
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Send Document to Subcontractor</DialogTitle>
            <DialogDescription>
              Distribute bid documents, plans, or specifications to prospective subcontractors.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="crmOrg">Subcontractor Organization *</Label>
              <Select value={selectedCrmOrgId} onValueChange={setSelectedCrmOrgId}>
                <SelectTrigger id="crmOrg" data-testid="select-crm-org">
                  <SelectValue placeholder="Select organization" />
                </SelectTrigger>
                <SelectContent>
                  {crmOrgs.map((org) => (
                    <SelectItem key={org.id} value={org.id}>{org.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="contactName">Contact Name *</Label>
                <Input
                  id="contactName"
                  value={contactName}
                  onChange={(e) => setContactName(e.target.value)}
                  placeholder="John Smith"
                  data-testid="input-contact-name"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="contactEmail">Contact Email *</Label>
                <Input
                  id="contactEmail"
                  type="email"
                  value={contactEmail}
                  onChange={(e) => setContactEmail(e.target.value)}
                  placeholder="john@example.com"
                  data-testid="input-contact-email"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="documentType">Document Type *</Label>
                <Select value={documentType} onValueChange={setDocumentType}>
                  <SelectTrigger id="documentType" data-testid="select-document-type">
                    <SelectValue placeholder="Select type" />
                  </SelectTrigger>
                  <SelectContent>
                    {DOCUMENT_TYPES.map((dt) => (
                      <SelectItem key={dt.value} value={dt.value}>{dt.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="documentTitle">Document Title *</Label>
                <Input
                  id="documentTitle"
                  value={documentTitle}
                  onChange={(e) => setDocumentTitle(e.target.value)}
                  placeholder="Structural Plans Rev 2"
                  data-testid="input-document-title"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="messageBody">Message / Cover Letter</Label>
              <Textarea
                id="messageBody"
                value={messageBody}
                onChange={(e) => setMessageBody(e.target.value)}
                placeholder="Please review the attached documents and provide your quote by..."
                rows={4}
                data-testid="textarea-message-body"
              />
            </div>

            <div className="flex items-center gap-3">
              <Checkbox
                id="createPortalAccess"
                checked={createPortalAccess}
                onCheckedChange={(checked) => setCreatePortalAccess(!!checked)}
                data-testid="checkbox-portal-access"
              />
              <Label htmlFor="createPortalAccess" className="text-sm cursor-pointer">
                Create Portal Access
              </Label>
            </div>

            {createPortalAccess && (
              <div className="space-y-2">
                <Label htmlFor="expiresInDays">Portal Access Expiration</Label>
                <Select value={expiresInDays} onValueChange={setExpiresInDays}>
                  <SelectTrigger id="expiresInDays" data-testid="select-expiration">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {EXPIRATION_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => { resetForm(); setShowSendDialog(false); }} data-testid="button-cancel-send">
              Cancel
            </Button>
            <Button onClick={handleSend} disabled={sendMutation.isPending} data-testid="button-confirm-send">
              {sendMutation.isPending ? "Sending..." : "Send Document"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
