import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Plus, Send, Copy, Trash2, Pencil, ArrowLeft, Users,
  Mail, Calendar, Loader2, BarChart3, Clock, X
} from "lucide-react";

interface Campaign {
  id: string;
  name: string;
  subject: string;
  htmlContent: string;
  textContent?: string;
  fromName?: string;
  replyTo?: string;
  status: string;
  scheduledAt?: string;
  sentAt?: string;
  totalRecipients: number;
  totalSent: number;
  totalOpened: number;
  totalClicked: number;
  totalBounced: number;
  totalUnsubscribed: number;
  tags?: string[];
  createdAt: string;
  updatedAt: string;
}

interface CampaignContact {
  id: string;
  campaignId: string;
  email: string;
  name?: string;
  status: string;
  sentAt?: string;
  openedAt?: string;
  clickedAt?: string;
  errorMessage?: string;
}

interface CampaignDetail extends Campaign {
  contacts: CampaignContact[];
}

interface Template {
  id: string;
  name: string;
  subject?: string;
  htmlContent: string;
  category: string;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

const STATUS_COLORS: Record<string, string> = {
  DRAFT: "secondary",
  SCHEDULED: "outline",
  SENDING: "default",
  SENT: "default",
  CANCELLED: "destructive",
};

const CONTACT_STATUS_COLORS: Record<string, string> = {
  PENDING: "secondary",
  SENT: "default",
  OPENED: "default",
  CLICKED: "default",
  BOUNCED: "destructive",
  UNSUBSCRIBED: "outline",
  FAILED: "destructive",
};

function StatusBadge({ status }: { status: string }) {
  const variant = STATUS_COLORS[status] || "secondary";
  return <Badge variant={variant as any} data-testid={`badge-status-${status}`}>{status}</Badge>;
}

function ContactStatusBadge({ status }: { status: string }) {
  const variant = CONTACT_STATUS_COLORS[status] || "secondary";
  return <Badge variant={variant as any} data-testid={`badge-contact-status-${status}`}>{status}</Badge>;
}

export default function EmailCampaignsPage() {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState("campaigns");
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showTemplateDialog, setShowTemplateDialog] = useState(false);
  const [showContactsDialog, setShowContactsDialog] = useState(false);
  const [showScheduleDialog, setShowScheduleDialog] = useState(false);
  const [editingCampaign, setEditingCampaign] = useState<Campaign | null>(null);
  const [editingTemplate, setEditingTemplate] = useState<Template | null>(null);
  const [selectedCampaignId, setSelectedCampaignId] = useState<string | null>(null);
  const [contactsCampaignId, setContactsCampaignId] = useState<string | null>(null);
  const [scheduleCampaignId, setScheduleCampaignId] = useState<string | null>(null);

  const [campaignForm, setCampaignForm] = useState({ name: "", subject: "", htmlContent: "", textContent: "", fromName: "", replyTo: "" });
  const [templateForm, setTemplateForm] = useState({ name: "", subject: "", htmlContent: "", category: "GENERAL" });
  const [bulkEmails, setBulkEmails] = useState("");
  const [scheduleDate, setScheduleDate] = useState("");

  const campaignsQuery = useQuery<{ data: Campaign[]; total: number }>({
    queryKey: ["/api/email-campaigns"],
  });

  const templatesQuery = useQuery<Template[]>({
    queryKey: ["/api/email-campaigns/templates"],
  });

  const campaignDetailQuery = useQuery<CampaignDetail>({
    queryKey: ["/api/email-campaigns", selectedCampaignId],
    enabled: !!selectedCampaignId,
  });

  const createCampaignMutation = useMutation({
    mutationFn: async (data: typeof campaignForm) => {
      const res = await apiRequest("POST", "/api/email-campaigns", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/email-campaigns"] });
      toast({ title: "Campaign created" });
      setShowCreateDialog(false);
      resetCampaignForm();
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const updateCampaignMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<typeof campaignForm> }) => {
      const res = await apiRequest("PATCH", `/api/email-campaigns/${id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/email-campaigns"] });
      toast({ title: "Campaign updated" });
      setShowCreateDialog(false);
      setEditingCampaign(null);
      resetCampaignForm();
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const deleteCampaignMutation = useMutation({
    mutationFn: async (id: string) => apiRequest("DELETE", `/api/email-campaigns/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/email-campaigns"] });
      toast({ title: "Campaign deleted" });
      if (selectedCampaignId) setSelectedCampaignId(null);
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const sendCampaignMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("POST", `/api/email-campaigns/${id}/send`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/email-campaigns"] });
      toast({ title: "Campaign sending started" });
    },
    onError: (e: Error) => toast({ title: "Send failed", description: e.message, variant: "destructive" }),
  });

  const scheduleCampaignMutation = useMutation({
    mutationFn: async ({ id, scheduledAt }: { id: string; scheduledAt: string }) => {
      const res = await apiRequest("POST", `/api/email-campaigns/${id}/schedule`, { scheduledAt });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/email-campaigns"] });
      toast({ title: "Campaign scheduled" });
      setShowScheduleDialog(false);
      setScheduleCampaignId(null);
      setScheduleDate("");
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const cancelCampaignMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("POST", `/api/email-campaigns/${id}/cancel`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/email-campaigns"] });
      toast({ title: "Campaign cancelled" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const duplicateCampaignMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("POST", `/api/email-campaigns/${id}/duplicate`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/email-campaigns"] });
      toast({ title: "Campaign duplicated" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const addContactsMutation = useMutation({
    mutationFn: async ({ id, contacts }: { id: string; contacts: { email: string; name?: string }[] }) => {
      const res = await apiRequest("POST", `/api/email-campaigns/${id}/contacts`, { contacts });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/email-campaigns"] });
      if (selectedCampaignId) queryClient.invalidateQueries({ queryKey: ["/api/email-campaigns", selectedCampaignId] });
      toast({ title: "Contacts added" });
      setShowContactsDialog(false);
      setContactsCampaignId(null);
      setBulkEmails("");
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const removeContactMutation = useMutation({
    mutationFn: async ({ campaignId, contactId }: { campaignId: string; contactId: string }) => {
      await apiRequest("DELETE", `/api/email-campaigns/${campaignId}/contacts/${contactId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/email-campaigns"] });
      if (selectedCampaignId) queryClient.invalidateQueries({ queryKey: ["/api/email-campaigns", selectedCampaignId] });
      toast({ title: "Contact removed" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const createTemplateMutation = useMutation({
    mutationFn: async (data: typeof templateForm) => {
      const res = await apiRequest("POST", "/api/email-campaigns/templates", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/email-campaigns/templates"] });
      toast({ title: "Template created" });
      setShowTemplateDialog(false);
      resetTemplateForm();
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const updateTemplateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<typeof templateForm> }) => {
      const res = await apiRequest("PATCH", `/api/email-campaigns/templates/${id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/email-campaigns/templates"] });
      toast({ title: "Template updated" });
      setShowTemplateDialog(false);
      setEditingTemplate(null);
      resetTemplateForm();
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const deleteTemplateMutation = useMutation({
    mutationFn: async (id: string) => apiRequest("DELETE", `/api/email-campaigns/templates/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/email-campaigns/templates"] });
      toast({ title: "Template deleted" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  function resetCampaignForm() {
    setCampaignForm({ name: "", subject: "", htmlContent: "", textContent: "", fromName: "", replyTo: "" });
  }

  function resetTemplateForm() {
    setTemplateForm({ name: "", subject: "", htmlContent: "", category: "GENERAL" });
  }

  function openCreateCampaign() {
    setEditingCampaign(null);
    resetCampaignForm();
    setShowCreateDialog(true);
  }

  function openEditCampaign(c: Campaign) {
    setEditingCampaign(c);
    setCampaignForm({
      name: c.name,
      subject: c.subject,
      htmlContent: c.htmlContent,
      textContent: c.textContent || "",
      fromName: c.fromName || "",
      replyTo: c.replyTo || "",
    });
    setShowCreateDialog(true);
  }

  function openCreateTemplate() {
    setEditingTemplate(null);
    resetTemplateForm();
    setShowTemplateDialog(true);
  }

  function openEditTemplate(t: Template) {
    setEditingTemplate(t);
    setTemplateForm({
      name: t.name,
      subject: t.subject || "",
      htmlContent: t.htmlContent,
      category: t.category || "GENERAL",
    });
    setShowTemplateDialog(true);
  }

  function handleCampaignSubmit() {
    if (editingCampaign) {
      updateCampaignMutation.mutate({ id: editingCampaign.id, data: campaignForm });
    } else {
      createCampaignMutation.mutate(campaignForm);
    }
  }

  function handleTemplateSubmit() {
    if (editingTemplate) {
      updateTemplateMutation.mutate({ id: editingTemplate.id, data: templateForm });
    } else {
      createTemplateMutation.mutate(templateForm);
    }
  }

  function handleAddContacts() {
    if (!contactsCampaignId) return;
    const entries = bulkEmails.split(/[,\n]/).map(e => e.trim()).filter(Boolean);
    const contacts = entries.map(entry => {
      const match = entry.match(/^(.+?)\s*<(.+?)>$/);
      if (match) return { name: match[1].trim(), email: match[2].trim() };
      return { email: entry };
    });
    addContactsMutation.mutate({ id: contactsCampaignId, contacts });
  }

  if (selectedCampaignId) {
    return (
      <div className="px-3 sm:px-6 py-4 sm:py-6 space-y-6" data-testid="page-email-campaign-detail">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => setSelectedCampaignId(null)} data-testid="button-back">
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="flex-1">
            <h1 className="text-2xl font-bold" data-testid="text-campaign-name">
              {campaignDetailQuery.data?.name || "Campaign Details"}
            </h1>
            {campaignDetailQuery.data && (
              <div className="flex items-center gap-2 mt-1">
                <StatusBadge status={campaignDetailQuery.data.status} />
                <span className="text-sm text-muted-foreground">
                  Created {new Date(campaignDetailQuery.data.createdAt).toLocaleDateString()}
                </span>
              </div>
            )}
          </div>
          {campaignDetailQuery.data?.status === "DRAFT" && (
            <div className="flex items-center gap-2">
              <Button variant="outline" onClick={() => { setContactsCampaignId(selectedCampaignId); setShowContactsDialog(true); }} data-testid="button-add-contacts">
                <Users className="h-4 w-4 mr-2" />
                Add Contacts
              </Button>
              <Button onClick={() => sendCampaignMutation.mutate(selectedCampaignId)} disabled={sendCampaignMutation.isPending} data-testid="button-send-campaign">
                {sendCampaignMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Send className="h-4 w-4 mr-2" />}
                Send
              </Button>
            </div>
          )}
        </div>

        {campaignDetailQuery.isLoading ? (
          <div className="space-y-4">
            <Skeleton className="h-32" />
            <Skeleton className="h-64" />
          </div>
        ) : campaignDetailQuery.data ? (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <Card>
                <CardContent className="pt-4">
                  <div className="text-2xl font-bold" data-testid="stat-recipients">{campaignDetailQuery.data.totalRecipients}</div>
                  <p className="text-xs text-muted-foreground">Recipients</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4">
                  <div className="text-2xl font-bold" data-testid="stat-sent">{campaignDetailQuery.data.totalSent}</div>
                  <p className="text-xs text-muted-foreground">Sent</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4">
                  <div className="text-2xl font-bold" data-testid="stat-open-rate">
                    {campaignDetailQuery.data.totalSent > 0
                      ? `${((campaignDetailQuery.data.totalOpened / campaignDetailQuery.data.totalSent) * 100).toFixed(1)}%`
                      : "0%"}
                  </div>
                  <p className="text-xs text-muted-foreground">Open Rate</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4">
                  <div className="text-2xl font-bold" data-testid="stat-bounce-rate">
                    {campaignDetailQuery.data.totalSent > 0
                      ? `${((campaignDetailQuery.data.totalBounced / campaignDetailQuery.data.totalSent) * 100).toFixed(1)}%`
                      : "0%"}
                  </div>
                  <p className="text-xs text-muted-foreground">Bounce Rate</p>
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between gap-2">
                <CardTitle className="text-base">Contacts ({campaignDetailQuery.data.contacts.length})</CardTitle>
                {campaignDetailQuery.data.status === "DRAFT" && (
                  <Button variant="outline" size="sm" onClick={() => { setContactsCampaignId(selectedCampaignId); setShowContactsDialog(true); }} data-testid="button-add-more-contacts">
                    <Plus className="h-4 w-4 mr-1" /> Add
                  </Button>
                )}
              </CardHeader>
              <CardContent>
                {campaignDetailQuery.data.contacts.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    <Users className="h-12 w-12 mx-auto mb-3 opacity-30" />
                    <p className="text-sm">No contacts added yet</p>
                  </div>
                ) : (
                  <div className="space-y-2 max-h-96 overflow-y-auto">
                    {campaignDetailQuery.data.contacts.map((contact) => (
                      <div key={contact.id} className="flex items-center justify-between gap-2 py-2 border-b last:border-0" data-testid={`contact-row-${contact.id}`}>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate" data-testid={`text-contact-email-${contact.id}`}>{contact.email}</p>
                          {contact.name && <p className="text-xs text-muted-foreground">{contact.name}</p>}
                        </div>
                        <ContactStatusBadge status={contact.status} />
                        {campaignDetailQuery.data!.status === "DRAFT" && (
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => removeContactMutation.mutate({ campaignId: selectedCampaignId, contactId: contact.id })}
                            data-testid={`button-remove-contact-${contact.id}`}
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Email Content</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  <p className="text-sm"><span className="font-medium">Subject:</span> {campaignDetailQuery.data.subject}</p>
                  <div className="border rounded-md p-4 text-sm bg-muted/30 max-h-64 overflow-y-auto" data-testid="text-campaign-content">
                    <div dangerouslySetInnerHTML={{ __html: campaignDetailQuery.data.htmlContent }} />
                  </div>
                </div>
              </CardContent>
            </Card>
          </>
        ) : (
          <Card><CardContent className="py-12 text-center text-muted-foreground">Campaign not found</CardContent></Card>
        )}
      </div>
    );
  }

  return (
    <div className="px-3 sm:px-6 py-4 sm:py-6 space-y-6" data-testid="page-email-campaigns">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-page-title">Email Campaigns</h1>
          <p className="text-muted-foreground text-sm">Create and manage email marketing campaigns</p>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList data-testid="tabs-email-campaigns">
          <TabsTrigger value="campaigns" data-testid="tab-campaigns">Campaigns</TabsTrigger>
          <TabsTrigger value="templates" data-testid="tab-templates">Templates</TabsTrigger>
        </TabsList>

        <TabsContent value="campaigns" className="space-y-4">
          <div className="flex justify-end">
            <Button onClick={openCreateCampaign} data-testid="button-create-campaign">
              <Plus className="h-4 w-4 mr-2" />
              New Campaign
            </Button>
          </div>

          {campaignsQuery.isLoading ? (
            <div className="space-y-2">
              {[1, 2, 3].map(i => <Skeleton key={i} className="h-24" />)}
            </div>
          ) : (campaignsQuery.data?.data || []).length > 0 ? (
            <div className="space-y-3">
              {(campaignsQuery.data?.data || []).map((campaign) => (
                <Card key={campaign.id} className="hover-elevate cursor-pointer" data-testid={`card-campaign-${campaign.id}`}>
                  <CardContent className="py-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0" onClick={() => setSelectedCampaignId(campaign.id)}>
                        <div className="flex items-center gap-2 flex-wrap">
                          <h3 className="font-medium" data-testid={`text-campaign-name-${campaign.id}`}>{campaign.name}</h3>
                          <StatusBadge status={campaign.status} />
                        </div>
                        <p className="text-sm text-muted-foreground mt-1 truncate">{campaign.subject}</p>
                        <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground flex-wrap">
                          <span className="flex items-center gap-1"><Users className="h-3 w-3" /> {campaign.totalRecipients} recipients</span>
                          {campaign.totalSent > 0 && <span className="flex items-center gap-1"><Send className="h-3 w-3" /> {campaign.totalSent} sent</span>}
                          {campaign.status === "SCHEDULED" && campaign.scheduledAt && (
                            <span className="flex items-center gap-1"><Clock className="h-3 w-3" /> {new Date(campaign.scheduledAt).toLocaleString()}</span>
                          )}
                          <span className="flex items-center gap-1"><Calendar className="h-3 w-3" /> {new Date(campaign.createdAt).toLocaleDateString()}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        {campaign.status === "DRAFT" && (
                          <>
                            <Button variant="ghost" size="icon" onClick={(e) => { e.stopPropagation(); openEditCampaign(campaign); }} data-testid={`button-edit-campaign-${campaign.id}`}>
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button variant="ghost" size="icon" onClick={(e) => { e.stopPropagation(); setContactsCampaignId(campaign.id); setShowContactsDialog(true); }} data-testid={`button-contacts-campaign-${campaign.id}`}>
                              <Users className="h-4 w-4" />
                            </Button>
                            <Button variant="ghost" size="icon" onClick={(e) => { e.stopPropagation(); setScheduleCampaignId(campaign.id); setShowScheduleDialog(true); }} data-testid={`button-schedule-campaign-${campaign.id}`}>
                              <Clock className="h-4 w-4" />
                            </Button>
                            <Button variant="ghost" size="icon" onClick={(e) => { e.stopPropagation(); sendCampaignMutation.mutate(campaign.id); }} disabled={sendCampaignMutation.isPending} data-testid={`button-send-campaign-${campaign.id}`}>
                              <Send className="h-4 w-4" />
                            </Button>
                            <Button variant="ghost" size="icon" onClick={(e) => { e.stopPropagation(); deleteCampaignMutation.mutate(campaign.id); }} data-testid={`button-delete-campaign-${campaign.id}`}>
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </>
                        )}
                        {campaign.status === "SCHEDULED" && (
                          <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); cancelCampaignMutation.mutate(campaign.id); }} data-testid={`button-cancel-campaign-${campaign.id}`}>
                            Cancel
                          </Button>
                        )}
                        <Button variant="ghost" size="icon" onClick={(e) => { e.stopPropagation(); duplicateCampaignMutation.mutate(campaign.id); }} data-testid={`button-duplicate-campaign-${campaign.id}`}>
                          <Copy className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (
            <Card>
              <CardContent className="py-12 text-center">
                <Mail className="h-12 w-12 mx-auto mb-3 opacity-30 text-muted-foreground" />
                <p className="text-muted-foreground">No campaigns yet</p>
                <p className="text-xs text-muted-foreground mt-1">Create your first email campaign to get started</p>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="templates" className="space-y-4">
          <div className="flex justify-end">
            <Button onClick={openCreateTemplate} data-testid="button-create-template">
              <Plus className="h-4 w-4 mr-2" />
              New Template
            </Button>
          </div>

          {templatesQuery.isLoading ? (
            <div className="space-y-2">
              {[1, 2, 3].map(i => <Skeleton key={i} className="h-20" />)}
            </div>
          ) : (templatesQuery.data || []).length > 0 ? (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {(templatesQuery.data || []).map((template) => (
                <Card key={template.id} data-testid={`card-template-${template.id}`}>
                  <CardContent className="py-4">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <h3 className="font-medium truncate" data-testid={`text-template-name-${template.id}`}>{template.name}</h3>
                        <div className="flex items-center gap-2 mt-1">
                          <Badge variant="secondary">{template.category}</Badge>
                          {template.isDefault && <Badge variant="outline">Default</Badge>}
                        </div>
                        {template.subject && <p className="text-xs text-muted-foreground mt-1 truncate">{template.subject}</p>}
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <Button variant="ghost" size="icon" onClick={() => openEditTemplate(template)} data-testid={`button-edit-template-${template.id}`}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="icon" onClick={() => deleteTemplateMutation.mutate(template.id)} data-testid={`button-delete-template-${template.id}`}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (
            <Card>
              <CardContent className="py-12 text-center">
                <Mail className="h-12 w-12 mx-auto mb-3 opacity-30 text-muted-foreground" />
                <p className="text-muted-foreground">No templates yet</p>
                <p className="text-xs text-muted-foreground mt-1">Create reusable email templates</p>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>

      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle data-testid="dialog-title-campaign">{editingCampaign ? "Edit Campaign" : "Create Campaign"}</DialogTitle>
            <DialogDescription>Fill in the campaign details below.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Campaign Name</Label>
              <Input value={campaignForm.name} onChange={e => setCampaignForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Monthly Newsletter" data-testid="input-campaign-name" />
            </div>
            <div>
              <Label>Subject Line</Label>
              <Input value={campaignForm.subject} onChange={e => setCampaignForm(f => ({ ...f, subject: e.target.value }))} placeholder="e.g. Check out our latest updates" data-testid="input-campaign-subject" />
            </div>
            <div>
              <Label>HTML Content</Label>
              <Textarea value={campaignForm.htmlContent} onChange={e => setCampaignForm(f => ({ ...f, htmlContent: e.target.value }))} placeholder="<h1>Hello!</h1><p>Your email content here...</p>" className="min-h-[200px] font-mono text-sm" data-testid="input-campaign-html" />
            </div>
            <div>
              <Label>Text Content (optional)</Label>
              <Textarea value={campaignForm.textContent} onChange={e => setCampaignForm(f => ({ ...f, textContent: e.target.value }))} placeholder="Plain text version of your email" className="min-h-[80px]" data-testid="input-campaign-text" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>From Name (optional)</Label>
                <Input value={campaignForm.fromName} onChange={e => setCampaignForm(f => ({ ...f, fromName: e.target.value }))} placeholder="e.g. Your Company" data-testid="input-campaign-from" />
              </div>
              <div>
                <Label>Reply-To (optional)</Label>
                <Input value={campaignForm.replyTo} onChange={e => setCampaignForm(f => ({ ...f, replyTo: e.target.value }))} placeholder="reply@example.com" data-testid="input-campaign-reply-to" />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreateDialog(false)} data-testid="button-cancel-campaign-dialog">Cancel</Button>
            <Button
              onClick={handleCampaignSubmit}
              disabled={!campaignForm.name || !campaignForm.subject || !campaignForm.htmlContent || createCampaignMutation.isPending || updateCampaignMutation.isPending}
              data-testid="button-submit-campaign"
            >
              {(createCampaignMutation.isPending || updateCampaignMutation.isPending) && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {editingCampaign ? "Update" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showTemplateDialog} onOpenChange={setShowTemplateDialog}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle data-testid="dialog-title-template">{editingTemplate ? "Edit Template" : "Create Template"}</DialogTitle>
            <DialogDescription>Create a reusable email template.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Template Name</Label>
              <Input value={templateForm.name} onChange={e => setTemplateForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Welcome Email" data-testid="input-template-name" />
            </div>
            <div>
              <Label>Subject (optional)</Label>
              <Input value={templateForm.subject} onChange={e => setTemplateForm(f => ({ ...f, subject: e.target.value }))} placeholder="Default subject line" data-testid="input-template-subject" />
            </div>
            <div>
              <Label>Category</Label>
              <Select value={templateForm.category} onValueChange={v => setTemplateForm(f => ({ ...f, category: v }))}>
                <SelectTrigger data-testid="select-template-category">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="GENERAL">General</SelectItem>
                  <SelectItem value="NEWSLETTER">Newsletter</SelectItem>
                  <SelectItem value="PROMOTION">Promotion</SelectItem>
                  <SelectItem value="ANNOUNCEMENT">Announcement</SelectItem>
                  <SelectItem value="FOLLOW_UP">Follow Up</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>HTML Content</Label>
              <Textarea value={templateForm.htmlContent} onChange={e => setTemplateForm(f => ({ ...f, htmlContent: e.target.value }))} placeholder="<h1>Hello!</h1><p>Your template content here...</p>" className="min-h-[200px] font-mono text-sm" data-testid="input-template-html" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowTemplateDialog(false)} data-testid="button-cancel-template-dialog">Cancel</Button>
            <Button
              onClick={handleTemplateSubmit}
              disabled={!templateForm.name || !templateForm.htmlContent || createTemplateMutation.isPending || updateTemplateMutation.isPending}
              data-testid="button-submit-template"
            >
              {(createTemplateMutation.isPending || updateTemplateMutation.isPending) && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {editingTemplate ? "Update" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showContactsDialog} onOpenChange={setShowContactsDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle data-testid="dialog-title-contacts">Add Contacts</DialogTitle>
            <DialogDescription>Enter email addresses separated by commas or new lines. Format: email or Name {"<email>"}.</DialogDescription>
          </DialogHeader>
          <div>
            <Label>Email Addresses</Label>
            <Textarea
              value={bulkEmails}
              onChange={e => setBulkEmails(e.target.value)}
              placeholder={"john@example.com\nJane Doe <jane@example.com>\nteam@example.com"}
              className="min-h-[150px]"
              data-testid="input-bulk-emails"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowContactsDialog(false)} data-testid="button-cancel-contacts-dialog">Cancel</Button>
            <Button
              onClick={handleAddContacts}
              disabled={!bulkEmails.trim() || addContactsMutation.isPending}
              data-testid="button-submit-contacts"
            >
              {addContactsMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Add Contacts
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showScheduleDialog} onOpenChange={setShowScheduleDialog}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle data-testid="dialog-title-schedule">Schedule Campaign</DialogTitle>
            <DialogDescription>Choose when to send this campaign.</DialogDescription>
          </DialogHeader>
          <div>
            <Label>Send Date & Time</Label>
            <Input type="datetime-local" value={scheduleDate} onChange={e => setScheduleDate(e.target.value)} data-testid="input-schedule-date" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowScheduleDialog(false)} data-testid="button-cancel-schedule-dialog">Cancel</Button>
            <Button
              onClick={() => { if (scheduleCampaignId && scheduleDate) scheduleCampaignMutation.mutate({ id: scheduleCampaignId, scheduledAt: new Date(scheduleDate).toISOString() }); }}
              disabled={!scheduleDate || scheduleCampaignMutation.isPending}
              data-testid="button-submit-schedule"
            >
              {scheduleCampaignMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Schedule
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
