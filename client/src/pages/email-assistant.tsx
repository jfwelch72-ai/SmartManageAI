import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { format, formatDistanceToNow } from "date-fns";
import {
  Mail,
  Inbox,
  Archive,
  Tag,
  Sparkles,
  RefreshCw,
  Search,
  Filter,
  ChevronRight,
  Clock,
  AlertCircle,
  CheckCircle2,
  FileText,
  Building,
  DollarSign,
  Loader2,
  Send,
  Link2,
  PlusCircle,
  LayoutList,
  Calendar,
  MessageSquare,
  User,
  Paperclip,
  ExternalLink,
  Settings,
  Power,
  PowerOff,
  Trash2,
  ChevronLeft,
  Server,
  Lock,
  Eye,
  EyeOff,
} from "lucide-react";
import { SiGmail } from "react-icons/si";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface EmailThread {
  id: string;
  subject: string;
  status: string;
  messageCount: number;
  unreadCount: number;
  lastMessageAt: string;
  primaryClassification: string | null;
  aiSummary: string | null;
  projectId: string | null;
  bidId: string | null;
}

interface EmailMessage {
  id: string;
  threadId: string;
  subject: string;
  fromAddress: string;
  fromName: string | null;
  bodyText: string | null;
  bodyHtml: string | null;
  snippet: string | null;
  receivedAt: string;
  isRead: boolean;
  classification: string | null;
  hasAttachments: boolean;
}

interface EmailTask {
  id: string;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  dueDate: string | null;
  emailThreadId: string | null;
  projectId: string | null;
}

interface EmailAccount {
  id: string;
  provider: string;
  emailAddress: string;
  displayName: string | null;
  isActive: boolean;
  lastSyncedAt: string | null;
}

interface EmailSummaryDigest {
  periodDescription: string;
  totalEmails: number;
  byClassification: Record<string, number>;
  highlights: { title: string; description: string; priority: string }[];
  actionNeeded: { title: string; description: string; dueDate?: string }[];
  summaryNarrative: string;
}

const CLASSIFICATION_LABELS: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  PROJECT_UPDATE: { label: "Project Update", color: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200", icon: <FileText className="w-3 h-3" /> },
  BID_INVITE: { label: "Bid Invite", color: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200", icon: <FileText className="w-3 h-3" /> },
  BID_RFI: { label: "Bid RFI", color: "bg-teal-100 text-teal-800 dark:bg-teal-900 dark:text-teal-200", icon: <MessageSquare className="w-3 h-3" /> },
  CHANGE_ORDER_REQUEST: { label: "Change Order", color: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200", icon: <FileText className="w-3 h-3" /> },
  SUBMITTAL_REQUEST: { label: "Submittal", color: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200", icon: <FileText className="w-3 h-3" /> },
  PAY_APP: { label: "Pay App", color: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200", icon: <DollarSign className="w-3 h-3" /> },
  INVOICE: { label: "Invoice", color: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200", icon: <DollarSign className="w-3 h-3" /> },
  DELAY_NOTICE: { label: "Delay Notice", color: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200", icon: <AlertCircle className="w-3 h-3" /> },
  SAFETY_ISSUE: { label: "Safety Issue", color: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200", icon: <AlertCircle className="w-3 h-3" /> },
  DELIVERY_NOTICE: { label: "Delivery", color: "bg-indigo-100 text-indigo-800 dark:bg-indigo-900 dark:text-indigo-200", icon: <Building className="w-3 h-3" /> },
  VENDOR_PRICING: { label: "Vendor Pricing", color: "bg-cyan-100 text-cyan-800 dark:bg-cyan-900 dark:text-cyan-200", icon: <DollarSign className="w-3 h-3" /> },
  GENERAL_COMMUNICATION: { label: "General", color: "bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200", icon: <Mail className="w-3 h-3" /> },
  SPAM_OR_IRRELEVANT: { label: "Spam", color: "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400", icon: <Archive className="w-3 h-3" /> },
  OTHER: { label: "Other", color: "bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300", icon: <Mail className="w-3 h-3" /> },
};

function ClassificationBadge({ classification }: { classification: string | null }) {
  if (!classification) return null;
  const config = CLASSIFICATION_LABELS[classification] || CLASSIFICATION_LABELS.OTHER;
  return (
    <Badge variant="secondary" className={`${config.color} gap-1 text-xs`}>
      {config.icon}
      {config.label}
    </Badge>
  );
}

function PriorityBadge({ priority }: { priority: string }) {
  const colors: Record<string, string> = {
    CRITICAL: "bg-red-600 text-white",
    HIGH: "bg-orange-500 text-white",
    MEDIUM: "bg-yellow-500 text-black",
    LOW: "bg-gray-400 text-white",
  };
  return (
    <Badge className={colors[priority] || colors.MEDIUM}>
      {priority}
    </Badge>
  );
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    PENDING: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
    IN_PROGRESS: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
    COMPLETED: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
    DISMISSED: "bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300",
  };
  return (
    <Badge variant="secondary" className={colors[status] || colors.PENDING}>
      {status.replace("_", " ")}
    </Badge>
  );
}

export default function EmailAssistantPage() {
  const { toast } = useToast();
  const [selectedThread, setSelectedThread] = useState<EmailThread | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterClassification, setFilterClassification] = useState<string>("all");
  const [filterStatus, setFilterStatus] = useState<string>("OPEN");
  const [showAccountsDialog, setShowAccountsDialog] = useState(false);
  const [showSummarySheet, setShowSummarySheet] = useState(false);
  const [summaryType, setSummaryType] = useState<"daily" | "weekly">("daily");
  
  // Add account form state
  const [showAddAccountForm, setShowAddAccountForm] = useState(false);
  const [selectedProvider, setSelectedProvider] = useState<"IMAP" | "GMAIL" | "OUTLOOK" | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [deleteAccountId, setDeleteAccountId] = useState<string | null>(null);
  
  // IMAP form fields
  const [imapFormData, setImapFormData] = useState({
    emailAddress: "",
    displayName: "",
    imapHost: "",
    imapPort: "993",
    imapSecure: true,
    smtpHost: "",
    smtpPort: "587",
    smtpSecure: true,
    imapUsername: "",
    imapPassword: "",
  });
  
  const resetImapForm = () => {
    setImapFormData({
      emailAddress: "",
      displayName: "",
      imapHost: "",
      imapPort: "993",
      imapSecure: true,
      smtpHost: "",
      smtpPort: "587",
      smtpSecure: true,
      imapUsername: "",
      imapPassword: "",
    });
    setShowPassword(false);
  };

  // Fetch email threads
  const { data: threads, isLoading: threadsLoading, refetch: refetchThreads } = useQuery<EmailThread[]>({
    queryKey: ["/api/email/threads", { status: filterStatus, classification: filterClassification !== "all" ? filterClassification : undefined }],
  });

  // Fetch email accounts
  const { data: accounts, isLoading: accountsLoading } = useQuery<EmailAccount[]>({
    queryKey: ["/api/email/accounts"],
  });

  // Fetch tasks
  const { data: tasks, isLoading: tasksLoading } = useQuery<EmailTask[]>({
    queryKey: ["/api/email/tasks", { status: "PENDING" }],
  });

  // Sync emails mutation
  const syncMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/email/sync");
      return res.json();
    },
    onSuccess: (data: any) => {
      toast({ title: "Sync completed", description: data.message });
      refetchThreads();
    },
    onError: () => {
      toast({ title: "Sync failed", description: "Could not sync emails", variant: "destructive" });
    },
  });

  // Generate daily summary mutation
  const dailySummaryMutation = useMutation({
    mutationFn: async (): Promise<EmailSummaryDigest> => {
      const res = await apiRequest("POST", "/api/email/summary/daily");
      return res.json();
    },
    onSuccess: (data: EmailSummaryDigest) => {
      toast({ title: "Summary generated", description: `Analyzed ${data.totalEmails} emails` });
      setShowSummarySheet(true);
    },
    onError: () => {
      toast({ title: "Summary failed", description: "Could not generate summary", variant: "destructive" });
    },
  });

  // Generate weekly summary mutation
  const weeklySummaryMutation = useMutation({
    mutationFn: async (): Promise<EmailSummaryDigest> => {
      const res = await apiRequest("POST", "/api/email/summary/weekly");
      return res.json();
    },
    onSuccess: (data: EmailSummaryDigest) => {
      toast({ title: "Weekly summary generated", description: `Analyzed ${data.totalEmails} emails` });
      setShowSummarySheet(true);
    },
    onError: () => {
      toast({ title: "Summary failed", description: "Could not generate summary", variant: "destructive" });
    },
  });

  const currentSummary = summaryType === "daily" ? dailySummaryMutation.data : weeklySummaryMutation.data;
  const isSummaryLoading = dailySummaryMutation.isPending || weeklySummaryMutation.isPending;

  // Create email account mutation
  const createAccountMutation = useMutation({
    mutationFn: async (data: {
      provider: string;
      emailAddress: string;
      displayName?: string;
      imapHost?: string;
      imapPort?: number;
      imapSecure?: boolean;
      smtpHost?: string;
      smtpPort?: number;
      smtpSecure?: boolean;
      imapUsername?: string;
      imapPassword?: string;
    }) => {
      const res = await apiRequest("POST", "/api/email/accounts", data);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Account added", description: "Email account linked successfully" });
      queryClient.invalidateQueries({ queryKey: ["/api/email/accounts"] });
      setShowAddAccountForm(false);
      setSelectedProvider(null);
      resetImapForm();
    },
    onError: (error: any) => {
      toast({ 
        title: "Failed to add account", 
        description: error.message || "Could not link email account", 
        variant: "destructive" 
      });
    },
  });

  // Toggle account active status mutation
  const toggleAccountMutation = useMutation({
    mutationFn: async ({ id, isActive }: { id: string; isActive: boolean }) => {
      const res = await apiRequest("PATCH", `/api/email/accounts/${id}`, { isActive });
      return res.json();
    },
    onSuccess: (_, { isActive }) => {
      toast({ 
        title: isActive ? "Account activated" : "Account deactivated",
        description: isActive ? "Email syncing enabled" : "Email syncing paused"
      });
      queryClient.invalidateQueries({ queryKey: ["/api/email/accounts"] });
    },
    onError: () => {
      toast({ title: "Update failed", description: "Could not update account", variant: "destructive" });
    },
  });

  // Delete email account mutation
  const deleteAccountMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("DELETE", `/api/email/accounts/${id}`);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Account removed", description: "Email account unlinked" });
      queryClient.invalidateQueries({ queryKey: ["/api/email/accounts"] });
      setDeleteAccountId(null);
    },
    onError: () => {
      toast({ title: "Delete failed", description: "Could not remove account", variant: "destructive" });
    },
  });

  // Handle IMAP form submission
  const handleImapSubmit = () => {
    if (!imapFormData.emailAddress || !imapFormData.imapHost || !imapFormData.imapPassword) {
      toast({ title: "Missing fields", description: "Please fill in all required fields", variant: "destructive" });
      return;
    }
    
    createAccountMutation.mutate({
      provider: "IMAP",
      emailAddress: imapFormData.emailAddress,
      displayName: imapFormData.displayName || undefined,
      imapHost: imapFormData.imapHost,
      imapPort: parseInt(imapFormData.imapPort) || 993,
      imapSecure: imapFormData.imapSecure,
      smtpHost: imapFormData.smtpHost || undefined,
      smtpPort: imapFormData.smtpPort ? parseInt(imapFormData.smtpPort) : undefined,
      smtpSecure: imapFormData.smtpSecure,
      imapUsername: imapFormData.imapUsername || imapFormData.emailAddress,
      imapPassword: imapFormData.imapPassword,
    });
  };

  // Initiate OAuth flow
  const initiateOAuth = (provider: "GMAIL" | "OUTLOOK") => {
    // Redirect to backend OAuth initiation endpoint
    window.location.href = `/api/email/oauth/${provider.toLowerCase()}/initiate`;
  };

  const filteredThreads = threads?.filter((thread) => {
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      if (!thread.subject.toLowerCase().includes(query)) {
        return false;
      }
    }
    return true;
  });

  return (
    <div className="flex flex-col h-full" data-testid="page-email-assistant">
      <div className="border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Mail className="w-6 h-6 text-primary" />
            <div>
              <h1 className="text-xl font-semibold">Email Assistant</h1>
              <p className="text-sm text-muted-foreground">
                AI-powered email management for construction projects
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => syncMutation.mutate()}
              disabled={syncMutation.isPending}
              data-testid="button-sync-emails"
            >
              {syncMutation.isPending ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <RefreshCw className="w-4 h-4 mr-2" />
              )}
              Sync
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setSummaryType("daily");
                dailySummaryMutation.mutate();
              }}
              disabled={isSummaryLoading}
              data-testid="button-daily-summary"
            >
              <Sparkles className="w-4 h-4 mr-2" />
              Daily Summary
            </Button>
            <Dialog open={showAccountsDialog} onOpenChange={(open) => {
              setShowAccountsDialog(open);
              if (!open) {
                setShowAddAccountForm(false);
                setSelectedProvider(null);
                resetImapForm();
              }
            }}>
              <DialogTrigger asChild>
                <Button size="sm" data-testid="button-manage-accounts">
                  <PlusCircle className="w-4 h-4 mr-2" />
                  Accounts
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-lg max-h-[85vh] flex flex-col overflow-hidden">
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2">
                    {showAddAccountForm && (
                      <Button 
                        variant="ghost" 
                        size="icon" 
                        className="h-6 w-6 mr-1"
                        onClick={() => {
                          if (selectedProvider) {
                            setSelectedProvider(null);
                          } else {
                            setShowAddAccountForm(false);
                          }
                        }}
                        data-testid="button-back-accounts"
                      >
                        <ChevronLeft className="h-4 w-4" />
                      </Button>
                    )}
                    {showAddAccountForm 
                      ? (selectedProvider === "IMAP" ? "Connect IMAP Account" : selectedProvider ? `Connect ${selectedProvider}` : "Add Email Account")
                      : "Email Accounts"
                    }
                  </DialogTitle>
                  <DialogDescription>
                    {showAddAccountForm 
                      ? (selectedProvider === "IMAP" 
                          ? "Enter your email server settings" 
                          : selectedProvider 
                            ? `Connect your ${selectedProvider} account`
                            : "Choose how you want to connect your email"
                        )
                      : "Manage linked email accounts for syncing"
                    }
                  </DialogDescription>
                </DialogHeader>

                {!showAddAccountForm ? (
                  <>
                    <div className="space-y-3 py-4 max-h-[400px] overflow-y-auto">
                      {accountsLoading ? (
                        <div className="space-y-2">
                          <Skeleton className="h-16 w-full" />
                          <Skeleton className="h-16 w-full" />
                        </div>
                      ) : accounts && accounts.length > 0 ? (
                        accounts.map((account) => (
                          <div
                            key={account.id}
                            className="flex items-center justify-between p-3 border rounded-lg"
                            data-testid={`account-item-${account.id}`}
                          >
                            <div className="flex items-center gap-3">
                              {account.provider === "GMAIL" ? (
                                <SiGmail className="w-5 h-5 text-red-500" />
                              ) : account.provider === "OUTLOOK" ? (
                                <Mail className="w-5 h-5 text-blue-600" />
                              ) : (
                                <Server className="w-5 h-5 text-muted-foreground" />
                              )}
                              <div>
                                <div className="font-medium text-sm">{account.emailAddress}</div>
                                <div className="text-xs text-muted-foreground">
                                  {account.provider}
                                  {account.lastSyncedAt && (
                                    <span> - Synced {formatDistanceToNow(new Date(account.lastSyncedAt))} ago</span>
                                  )}
                                </div>
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              <Switch
                                checked={account.isActive}
                                onCheckedChange={(checked) => 
                                  toggleAccountMutation.mutate({ id: account.id, isActive: checked })
                                }
                                disabled={toggleAccountMutation.isPending}
                                data-testid={`switch-account-active-${account.id}`}
                              />
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-destructive hover:text-destructive"
                                onClick={() => setDeleteAccountId(account.id)}
                                data-testid={`button-delete-account-${account.id}`}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          </div>
                        ))
                      ) : (
                        <div className="text-center py-6 text-muted-foreground">
                          <Mail className="w-12 h-12 mx-auto mb-3 opacity-50" />
                          <p>No email accounts linked</p>
                          <p className="text-sm">Add an account to start syncing emails</p>
                        </div>
                      )}
                    </div>
                    <DialogFooter className="gap-2 sm:gap-0">
                      <Button variant="outline" onClick={() => setShowAccountsDialog(false)}>
                        Close
                      </Button>
                      <Button onClick={() => setShowAddAccountForm(true)} data-testid="button-add-account">
                        <PlusCircle className="w-4 h-4 mr-2" />
                        Add Account
                      </Button>
                    </DialogFooter>
                  </>
                ) : !selectedProvider ? (
                  <div className="space-y-3 py-4">
                    <Button
                      variant="outline"
                      className="w-full justify-start gap-3 h-14"
                      onClick={() => initiateOAuth("GMAIL")}
                      data-testid="button-connect-gmail"
                    >
                      <SiGmail className="w-5 h-5 text-red-500" />
                      <div className="text-left">
                        <div className="font-medium">Gmail</div>
                        <div className="text-xs text-muted-foreground">Connect with Google</div>
                      </div>
                    </Button>
                    <Button
                      variant="outline"
                      className="w-full justify-start gap-3 h-14"
                      onClick={() => initiateOAuth("OUTLOOK")}
                      data-testid="button-connect-outlook"
                    >
                      <Mail className="w-5 h-5 text-blue-600" />
                      <div className="text-left">
                        <div className="font-medium">Outlook / Microsoft 365</div>
                        <div className="text-xs text-muted-foreground">Connect with Microsoft</div>
                      </div>
                    </Button>
                    <Separator className="my-4" />
                    <Button
                      variant="outline"
                      className="w-full justify-start gap-3 h-14"
                      onClick={() => setSelectedProvider("IMAP")}
                      data-testid="button-connect-imap"
                    >
                      <Server className="w-5 h-5 text-muted-foreground" />
                      <div className="text-left">
                        <div className="font-medium">IMAP / SMTP</div>
                        <div className="text-xs text-muted-foreground">Manual configuration for any email provider</div>
                      </div>
                    </Button>
                  </div>
                ) : selectedProvider === "IMAP" ? (
                  <div className="flex flex-col">
                    <ScrollArea className="max-h-[400px] pr-4">
                      <div className="grid gap-4 py-4">
                        <div className="space-y-2">
                          <Label htmlFor="emailAddress">Email Address *</Label>
                          <Input
                            id="emailAddress"
                            type="email"
                            placeholder="you@example.com"
                            value={imapFormData.emailAddress}
                            onChange={(e) => setImapFormData(prev => ({ ...prev, emailAddress: e.target.value }))}
                            data-testid="input-email-address"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="displayName">Display Name</Label>
                          <Input
                            id="displayName"
                            placeholder="My Work Email"
                            value={imapFormData.displayName}
                            onChange={(e) => setImapFormData(prev => ({ ...prev, displayName: e.target.value }))}
                            data-testid="input-display-name"
                          />
                        </div>
                        <Separator />
                        <div className="text-sm font-medium text-muted-foreground">Incoming Mail (IMAP)</div>
                        <div className="grid grid-cols-2 gap-3">
                          <div className="space-y-2">
                            <Label htmlFor="imapHost">IMAP Server *</Label>
                            <Input
                              id="imapHost"
                              placeholder="imap.example.com"
                              value={imapFormData.imapHost}
                              onChange={(e) => setImapFormData(prev => ({ ...prev, imapHost: e.target.value }))}
                              data-testid="input-imap-host"
                            />
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor="imapPort">Port</Label>
                            <Input
                              id="imapPort"
                              placeholder="993"
                              value={imapFormData.imapPort}
                              onChange={(e) => setImapFormData(prev => ({ ...prev, imapPort: e.target.value }))}
                              data-testid="input-imap-port"
                            />
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Switch
                            id="imapSecure"
                            checked={imapFormData.imapSecure}
                            onCheckedChange={(checked) => setImapFormData(prev => ({ ...prev, imapSecure: checked }))}
                            data-testid="switch-imap-secure"
                          />
                          <Label htmlFor="imapSecure" className="text-sm">Use SSL/TLS</Label>
                        </div>
                        <Separator />
                        <div className="text-sm font-medium text-muted-foreground">Outgoing Mail (SMTP)</div>
                        <div className="grid grid-cols-2 gap-3">
                          <div className="space-y-2">
                            <Label htmlFor="smtpHost">SMTP Server</Label>
                            <Input
                              id="smtpHost"
                              placeholder="smtp.example.com"
                              value={imapFormData.smtpHost}
                              onChange={(e) => setImapFormData(prev => ({ ...prev, smtpHost: e.target.value }))}
                              data-testid="input-smtp-host"
                            />
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor="smtpPort">Port</Label>
                            <Input
                              id="smtpPort"
                            placeholder="587"
                            value={imapFormData.smtpPort}
                            onChange={(e) => setImapFormData(prev => ({ ...prev, smtpPort: e.target.value }))}
                            data-testid="input-smtp-port"
                          />
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Switch
                          id="smtpSecure"
                          checked={imapFormData.smtpSecure}
                          onCheckedChange={(checked) => setImapFormData(prev => ({ ...prev, smtpSecure: checked }))}
                          data-testid="switch-smtp-secure"
                        />
                        <Label htmlFor="smtpSecure" className="text-sm">Use SSL/TLS</Label>
                      </div>
                      <Separator />
                      <div className="text-sm font-medium text-muted-foreground">Credentials</div>
                      <div className="space-y-2">
                        <Label htmlFor="imapUsername">Username</Label>
                        <Input
                          id="imapUsername"
                          placeholder="Leave blank to use email address"
                          value={imapFormData.imapUsername}
                          onChange={(e) => setImapFormData(prev => ({ ...prev, imapUsername: e.target.value }))}
                          data-testid="input-imap-username"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="imapPassword">Password *</Label>
                        <div className="relative">
                          <Input
                            id="imapPassword"
                            type={showPassword ? "text" : "password"}
                            placeholder="Your email password or app password"
                            value={imapFormData.imapPassword}
                            onChange={(e) => setImapFormData(prev => ({ ...prev, imapPassword: e.target.value }))}
                            className="pr-10"
                            data-testid="input-imap-password"
                          />
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="absolute right-0 top-0 h-full px-3"
                            onClick={() => setShowPassword(!showPassword)}
                            data-testid="button-toggle-password"
                          >
                            {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                          </Button>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          For Gmail/Outlook, use an App Password instead of your regular password
                        </p>
                      </div>
                      </div>
                    </ScrollArea>
                    <DialogFooter className="gap-2 sm:gap-0 pt-4">
                      <Button 
                        variant="outline" 
                        onClick={() => {
                          setSelectedProvider(null);
                          resetImapForm();
                        }}
                      >
                        Cancel
                      </Button>
                      <Button 
                        onClick={handleImapSubmit}
                        disabled={createAccountMutation.isPending}
                        data-testid="button-save-imap-account"
                      >
                        {createAccountMutation.isPending ? (
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        ) : (
                          <Link2 className="w-4 h-4 mr-2" />
                        )}
                        Connect Account
                      </Button>
                    </DialogFooter>
                  </div>
                ) : (
                  <div className="py-8 text-center text-muted-foreground">
                    <Loader2 className="w-8 h-8 mx-auto mb-4 animate-spin" />
                    <p>Connecting to {selectedProvider}...</p>
                    <p className="text-sm mt-2">You will be redirected to sign in</p>
                  </div>
                )}
              </DialogContent>
            </Dialog>
            
            <AlertDialog open={!!deleteAccountId} onOpenChange={(open) => !open && setDeleteAccountId(null)}>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Remove Email Account?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will unlink this email account from SmartManageAI. Your emails will no longer sync, but existing data will be preserved.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    onClick={() => deleteAccountId && deleteAccountMutation.mutate(deleteAccountId)}
                    data-testid="button-confirm-delete-account"
                  >
                    {deleteAccountMutation.isPending ? (
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    ) : null}
                    Remove Account
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        <div className="w-80 border-r flex flex-col">
          <div className="p-4 border-b space-y-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search emails..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
                data-testid="input-search-emails"
              />
            </div>
            <div className="flex gap-2">
              <Select value={filterStatus} onValueChange={setFilterStatus}>
                <SelectTrigger className="flex-1" data-testid="select-status-filter">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="OPEN">Open</SelectItem>
                  <SelectItem value="ARCHIVED">Archived</SelectItem>
                  <SelectItem value="IGNORED">Ignored</SelectItem>
                </SelectContent>
              </Select>
              <Select value={filterClassification} onValueChange={setFilterClassification}>
                <SelectTrigger className="flex-1" data-testid="select-classification-filter">
                  <SelectValue placeholder="Type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Types</SelectItem>
                  {Object.entries(CLASSIFICATION_LABELS).map(([key, config]) => (
                    <SelectItem key={key} value={key}>
                      {config.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <ScrollArea className="flex-1">
            {threadsLoading ? (
              <div className="p-4 space-y-3">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="space-y-2">
                    <Skeleton className="h-4 w-3/4" />
                    <Skeleton className="h-3 w-full" />
                    <Skeleton className="h-3 w-1/2" />
                  </div>
                ))}
              </div>
            ) : filteredThreads && filteredThreads.length > 0 ? (
              <div className="divide-y">
                {filteredThreads.map((thread) => (
                  <button
                    key={thread.id}
                    onClick={() => setSelectedThread(thread)}
                    className={`w-full p-4 text-left hover:bg-muted/50 transition-colors ${
                      selectedThread?.id === thread.id ? "bg-muted" : ""
                    }`}
                    data-testid={`thread-item-${thread.id}`}
                  >
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <span className={`font-medium text-sm line-clamp-1 ${thread.unreadCount > 0 ? "font-semibold" : ""}`}>
                        {thread.subject}
                      </span>
                      {thread.unreadCount > 0 && (
                        <Badge variant="default" className="text-xs shrink-0">
                          {thread.unreadCount}
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-2 mb-2">
                      <ClassificationBadge classification={thread.primaryClassification} />
                    </div>
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>{thread.messageCount} messages</span>
                      <span>{formatDistanceToNow(new Date(thread.lastMessageAt))} ago</span>
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              <div className="p-8 text-center text-muted-foreground">
                <Inbox className="w-12 h-12 mx-auto mb-3 opacity-50" />
                <p>No email threads found</p>
                <p className="text-sm mt-1">
                  {searchQuery ? "Try a different search" : "Sync your email to get started"}
                </p>
              </div>
            )}
          </ScrollArea>
        </div>

        <div className="flex-1 flex flex-col">
          {selectedThread ? (
            <ThreadDetailView
              thread={selectedThread}
              onClose={() => setSelectedThread(null)}
            />
          ) : (
            <div className="flex-1 flex flex-col">
              <Tabs defaultValue="overview" className="flex-1 flex flex-col">
                <TabsList className="mx-6 mt-4 self-start">
                  <TabsTrigger value="overview" data-testid="tab-overview">Overview</TabsTrigger>
                  <TabsTrigger value="tasks" data-testid="tab-tasks">Tasks</TabsTrigger>
                </TabsList>

                <TabsContent value="overview" className="flex-1 p-6 overflow-auto">
                  <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                    <Card>
                      <CardHeader className="pb-2">
                        <CardTitle className="text-base flex items-center gap-2">
                          <Inbox className="w-4 h-4" />
                          Inbox Summary
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="space-y-3">
                          <div className="flex justify-between items-center">
                            <span className="text-sm text-muted-foreground">Total Threads</span>
                            <span className="font-medium">{threads?.length || 0}</span>
                          </div>
                          <div className="flex justify-between items-center">
                            <span className="text-sm text-muted-foreground">Unread</span>
                            <span className="font-medium text-primary">
                              {threads?.reduce((sum, t) => sum + t.unreadCount, 0) || 0}
                            </span>
                          </div>
                          <div className="flex justify-between items-center">
                            <span className="text-sm text-muted-foreground">Linked Accounts</span>
                            <span className="font-medium">{accounts?.length || 0}</span>
                          </div>
                        </div>
                      </CardContent>
                    </Card>

                    <Card>
                      <CardHeader className="pb-2">
                        <CardTitle className="text-base flex items-center gap-2">
                          <Tag className="w-4 h-4" />
                          By Classification
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="space-y-2">
                          {threads && Object.entries(
                            threads.reduce((acc, t) => {
                              const cls = t.primaryClassification || "OTHER";
                              acc[cls] = (acc[cls] || 0) + 1;
                              return acc;
                            }, {} as Record<string, number>)
                          ).slice(0, 5).map(([cls, count]) => (
                            <div key={cls} className="flex items-center justify-between">
                              <ClassificationBadge classification={cls} />
                              <span className="text-sm font-medium">{count}</span>
                            </div>
                          ))}
                        </div>
                      </CardContent>
                    </Card>

                    <Card>
                      <CardHeader className="pb-2">
                        <CardTitle className="text-base flex items-center gap-2">
                          <CheckCircle2 className="w-4 h-4" />
                          Pending Tasks
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        {tasksLoading ? (
                          <div className="space-y-2">
                            <Skeleton className="h-8 w-full" />
                            <Skeleton className="h-8 w-full" />
                          </div>
                        ) : tasks && tasks.length > 0 ? (
                          <div className="space-y-2">
                            {tasks.slice(0, 3).map((task) => (
                              <div key={task.id} className="flex items-center justify-between p-2 rounded border">
                                <span className="text-sm line-clamp-1">{task.title}</span>
                                <PriorityBadge priority={task.priority} />
                              </div>
                            ))}
                            {tasks.length > 3 && (
                              <p className="text-xs text-muted-foreground text-center pt-1">
                                +{tasks.length - 3} more tasks
                              </p>
                            )}
                          </div>
                        ) : (
                          <p className="text-sm text-muted-foreground text-center py-4">
                            No pending tasks
                          </p>
                        )}
                      </CardContent>
                    </Card>
                  </div>

                  <Card className="mt-6">
                    <CardHeader>
                      <CardTitle className="text-base flex items-center gap-2">
                        <Sparkles className="w-4 h-4" />
                        AI Insights
                      </CardTitle>
                      <CardDescription>
                        Generate AI-powered summaries of your email activity
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="flex gap-4">
                        <Button
                          variant="outline"
                          onClick={() => {
                            setSummaryType("daily");
                            dailySummaryMutation.mutate();
                          }}
                          disabled={isSummaryLoading}
                          className="flex-1"
                          data-testid="button-generate-daily-summary"
                        >
                          {dailySummaryMutation.isPending ? (
                            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          ) : (
                            <Calendar className="w-4 h-4 mr-2" />
                          )}
                          Daily Summary
                        </Button>
                        <Button
                          variant="outline"
                          onClick={() => {
                            setSummaryType("weekly");
                            weeklySummaryMutation.mutate();
                          }}
                          disabled={isSummaryLoading}
                          className="flex-1"
                          data-testid="button-generate-weekly-summary"
                        >
                          {weeklySummaryMutation.isPending ? (
                            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          ) : (
                            <LayoutList className="w-4 h-4 mr-2" />
                          )}
                          Weekly Summary
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                </TabsContent>

                <TabsContent value="tasks" className="flex-1 p-6 overflow-auto">
                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2">
                        <CheckCircle2 className="w-5 h-5" />
                        Email-Generated Tasks
                      </CardTitle>
                      <CardDescription>
                        Tasks automatically created from email analysis
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      {tasksLoading ? (
                        <div className="space-y-3">
                          {Array.from({ length: 3 }).map((_, i) => (
                            <Skeleton key={i} className="h-16 w-full" />
                          ))}
                        </div>
                      ) : tasks && tasks.length > 0 ? (
                        <div className="space-y-3">
                          {tasks.map((task) => (
                            <TaskCard key={task.id} task={task} />
                          ))}
                        </div>
                      ) : (
                        <div className="text-center py-8 text-muted-foreground">
                          <CheckCircle2 className="w-12 h-12 mx-auto mb-3 opacity-50" />
                          <p>No tasks from emails yet</p>
                          <p className="text-sm mt-1">
                            AI will create tasks when it detects action items in your emails
                          </p>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </TabsContent>
              </Tabs>
            </div>
          )}
        </div>
      </div>

      <Sheet open={showSummarySheet} onOpenChange={setShowSummarySheet}>
        <SheetContent className="w-[400px] sm:w-[540px]">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              <Sparkles className="w-5 h-5" />
              {summaryType === "daily" ? "Daily" : "Weekly"} Email Summary
            </SheetTitle>
            <SheetDescription>
              {currentSummary?.periodDescription || "AI-generated insights from your emails"}
            </SheetDescription>
          </SheetHeader>
          {currentSummary && (
            <div className="mt-6 space-y-6">
              <div className="p-4 bg-muted rounded-lg">
                <p className="text-sm">{currentSummary.summaryNarrative}</p>
              </div>

              <div>
                <h4 className="font-medium mb-3 flex items-center gap-2">
                  <AlertCircle className="w-4 h-4" />
                  Highlights
                </h4>
                <div className="space-y-2">
                  {currentSummary.highlights.map((h, i) => (
                    <div key={i} className="p-3 border rounded-lg">
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-medium text-sm">{h.title}</span>
                        <PriorityBadge priority={h.priority} />
                      </div>
                      <p className="text-sm text-muted-foreground">{h.description}</p>
                    </div>
                  ))}
                </div>
              </div>

              {currentSummary.actionNeeded.length > 0 && (
                <div>
                  <h4 className="font-medium mb-3 flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4" />
                    Action Needed
                  </h4>
                  <div className="space-y-2">
                    {currentSummary.actionNeeded.map((a, i) => (
                      <div key={i} className="p-3 border rounded-lg">
                        <span className="font-medium text-sm">{a.title}</span>
                        <p className="text-sm text-muted-foreground">{a.description}</p>
                        {a.dueDate && (
                          <p className="text-xs text-muted-foreground mt-1">
                            Due: {a.dueDate}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div>
                <h4 className="font-medium mb-3">Classification Breakdown</h4>
                <div className="grid grid-cols-2 gap-2">
                  {Object.entries(currentSummary.byClassification).map(([cls, count]) => (
                    <div key={cls} className="flex items-center justify-between p-2 border rounded">
                      <ClassificationBadge classification={cls} />
                      <span className="text-sm font-medium">{count}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function ThreadDetailView({ thread, onClose }: { thread: EmailThread; onClose: () => void }) {
  const { toast } = useToast();

  // Fetch thread with messages
  const { data: threadData, isLoading } = useQuery<{
    thread: EmailThread;
    messages: EmailMessage[];
    tasks: EmailTask[];
  }>({
    queryKey: ["/api/email/threads", thread.id],
  });

  // Summarize thread mutation
  const summarizeMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/email/threads/${thread.id}/summarize`);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Thread summarized", description: "AI summary generated" });
      queryClient.invalidateQueries({ queryKey: ["/api/email/threads", thread.id] });
    },
    onError: () => {
      toast({ title: "Summary failed", variant: "destructive" });
    },
  });

  const messages = threadData?.messages || [];
  const tasks = threadData?.tasks || [];

  return (
    <div className="flex-1 flex flex-col">
      <div className="border-b p-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={onClose} data-testid="button-close-thread">
            <ChevronRight className="w-4 h-4 rotate-180" />
          </Button>
          <div>
            <h2 className="font-medium">{thread.subject}</h2>
            <div className="flex items-center gap-2 mt-1">
              <ClassificationBadge classification={thread.primaryClassification} />
              <span className="text-xs text-muted-foreground">
                {thread.messageCount} messages
              </span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => summarizeMutation.mutate()}
            disabled={summarizeMutation.isPending}
            data-testid="button-summarize-thread"
          >
            {summarizeMutation.isPending ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <Sparkles className="w-4 h-4 mr-2" />
            )}
            Summarize
          </Button>
          {thread.projectId && (
            <Button variant="outline" size="sm" asChild>
              <a href={`/projects/${thread.projectId}`} data-testid="link-view-project">
                <ExternalLink className="w-4 h-4 mr-2" />
                View Project
              </a>
            </Button>
          )}
        </div>
      </div>

      {thread.aiSummary && (
        <div className="mx-4 mt-4 p-4 bg-muted/50 rounded-lg border">
          <div className="flex items-center gap-2 mb-2">
            <Sparkles className="w-4 h-4 text-primary" />
            <span className="font-medium text-sm">AI Summary</span>
          </div>
          <p className="text-sm text-muted-foreground">{thread.aiSummary}</p>
        </div>
      )}

      <ScrollArea className="flex-1 p-4">
        {isLoading ? (
          <div className="space-y-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-32 w-full" />
            ))}
          </div>
        ) : (
          <div className="space-y-4">
            {messages.map((message) => (
              <MessageCard key={message.id} message={message} />
            ))}
          </div>
        )}
      </ScrollArea>

      {tasks.length > 0 && (
        <div className="border-t p-4">
          <h4 className="font-medium text-sm mb-3 flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4" />
            Related Tasks ({tasks.length})
          </h4>
          <div className="space-y-2">
            {tasks.slice(0, 2).map((task) => (
              <div key={task.id} className="flex items-center justify-between p-2 border rounded">
                <span className="text-sm">{task.title}</span>
                <StatusBadge status={task.status} />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function MessageCard({ message }: { message: EmailMessage }) {
  const { toast } = useToast();
  const [showReplySuggestions, setShowReplySuggestions] = useState(false);

  // Analyze message mutation
  const analyzeMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/email/messages/${message.id}/analyze`);
      return res.json();
    },
    onSuccess: (data: any) => {
      toast({
        title: "Email analyzed",
        description: `Classification: ${data.analysis.classification}`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/email/threads"] });
    },
    onError: () => {
      toast({ title: "Analysis failed", variant: "destructive" });
    },
  });

  // Suggest reply mutation
  const suggestReplyMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/email/messages/${message.id}/suggest-reply`, { tones: ["professional", "casual"] });
      return res.json();
    },
    onSuccess: () => {
      setShowReplySuggestions(true);
    },
    onError: () => {
      toast({ title: "Failed to generate suggestions", variant: "destructive" });
    },
  });

  return (
    <Card data-testid={`message-card-${message.id}`}>
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center">
              <User className="w-5 h-5 text-muted-foreground" />
            </div>
            <div>
              <div className="font-medium">
                {message.fromName || message.fromAddress}
              </div>
              <div className="text-xs text-muted-foreground">
                {format(new Date(message.receivedAt), "MMM d, yyyy 'at' h:mm a")}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <ClassificationBadge classification={message.classification} />
            {message.hasAttachments && (
              <Badge variant="outline" className="gap-1">
                <Paperclip className="w-3 h-3" />
                Attachments
              </Badge>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground whitespace-pre-wrap">
          {message.bodyText || message.snippet || "(No content)"}
        </p>
        <div className="flex items-center gap-2 mt-4">
          <Button
            variant="outline"
            size="sm"
            onClick={() => analyzeMutation.mutate()}
            disabled={analyzeMutation.isPending}
            data-testid={`button-analyze-message-${message.id}`}
          >
            {analyzeMutation.isPending ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <Sparkles className="w-4 h-4 mr-2" />
            )}
            Analyze
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => suggestReplyMutation.mutate()}
            disabled={suggestReplyMutation.isPending}
            data-testid={`button-suggest-reply-${message.id}`}
          >
            {suggestReplyMutation.isPending ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <Send className="w-4 h-4 mr-2" />
            )}
            Suggest Reply
          </Button>
        </div>

        {showReplySuggestions && suggestReplyMutation.data && (
          <div className="mt-4 space-y-3">
            <Separator />
            <h4 className="font-medium text-sm flex items-center gap-2">
              <Send className="w-4 h-4" />
              Suggested Replies
            </h4>
            {(suggestReplyMutation.data as any).drafts?.map((draft: any, i: number) => (
              <div key={i} className="p-3 bg-muted/50 rounded-lg">
                <div className="flex items-center justify-between mb-2">
                  <Badge variant="outline">{draft.tone}</Badge>
                  <Button variant="ghost" size="sm">
                    Copy
                  </Button>
                </div>
                <p className="text-sm whitespace-pre-wrap">{draft.body}</p>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function TaskCard({ task }: { task: EmailTask }) {
  const { toast } = useToast();

  const updateTaskMutation = useMutation({
    mutationFn: async (status: string) => {
      const res = await apiRequest("PATCH", `/api/email/tasks/${task.id}`, { status });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Task updated" });
      queryClient.invalidateQueries({ queryKey: ["/api/email/tasks"] });
    },
    onError: () => {
      toast({ title: "Failed to update task", variant: "destructive" });
    },
  });

  return (
    <Card data-testid={`task-card-${task.id}`}>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-1">
              <span className="font-medium">{task.title}</span>
              <PriorityBadge priority={task.priority} />
            </div>
            {task.description && (
              <p className="text-sm text-muted-foreground mb-2 line-clamp-2">
                {task.description}
              </p>
            )}
            <div className="flex items-center gap-4 text-xs text-muted-foreground">
              <StatusBadge status={task.status} />
              {task.dueDate && (
                <span className="flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  Due {format(new Date(task.dueDate), "MMM d")}
                </span>
              )}
              {task.emailThreadId && (
                <span className="flex items-center gap-1">
                  <Link2 className="w-3 h-3" />
                  Linked to email
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {task.status === "PENDING" && (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => updateTaskMutation.mutate("IN_PROGRESS")}
                  disabled={updateTaskMutation.isPending}
                  data-testid={`button-start-task-${task.id}`}
                >
                  Start
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => updateTaskMutation.mutate("COMPLETED")}
                  disabled={updateTaskMutation.isPending}
                  data-testid={`button-complete-task-${task.id}`}
                >
                  <CheckCircle2 className="w-4 h-4" />
                </Button>
              </>
            )}
            {task.status === "IN_PROGRESS" && (
              <Button
                size="sm"
                onClick={() => updateTaskMutation.mutate("COMPLETED")}
                disabled={updateTaskMutation.isPending}
                data-testid={`button-complete-task-${task.id}`}
              >
                Complete
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
