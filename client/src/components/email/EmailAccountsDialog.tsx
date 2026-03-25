import { useState, useEffect, useMemo } from "react";
import { formatDistanceToNow } from "date-fns";
import {
  Mail,
  ChevronLeft,
  Loader2,
  PlusCircle,
  Server,
  Link2,
  Eye,
  EyeOff,
  Trash2,
  Wifi,
  AlertTriangle,
  Info,
  Pencil,
  Save,
} from "lucide-react";
import { SiGmail } from "react-icons/si";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
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
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useCreateAccount, useToggleAccount, useDeleteAccount, useTestAccount, useUpdateAccount } from "@/hooks/useEmailMutations";
import { useToast } from "@/hooks/use-toast";
import type { EmailAccount } from "./shared";

const PROVIDER_PRESETS: Record<string, { label: string; imapHost: string; imapPort: string; imapSecure: boolean; smtpHost: string; smtpPort: string; smtpSecure: boolean; appPasswordNote: string }> = {
  yahoo: {
    label: "Yahoo",
    imapHost: "imap.mail.yahoo.com",
    imapPort: "993",
    imapSecure: true,
    smtpHost: "smtp.mail.yahoo.com",
    smtpPort: "465",
    smtpSecure: true,
    appPasswordNote: "Yahoo requires an App Password. Go to Yahoo Account Security → Generate app password.",
  },
  aol: {
    label: "AOL",
    imapHost: "imap.aol.com",
    imapPort: "993",
    imapSecure: true,
    smtpHost: "smtp.aol.com",
    smtpPort: "465",
    smtpSecure: true,
    appPasswordNote: "AOL requires an App Password. Go to AOL Account Security → Generate app password.",
  },
  outlook: {
    label: "Outlook",
    imapHost: "outlook.office365.com",
    imapPort: "993",
    imapSecure: true,
    smtpHost: "smtp.office365.com",
    smtpPort: "587",
    smtpSecure: false,
    appPasswordNote: "If you have 2-factor authentication enabled, you'll need an App Password from your Microsoft account security settings.",
  },
  hotmail: {
    label: "Hotmail",
    imapHost: "outlook.office365.com",
    imapPort: "993",
    imapSecure: true,
    smtpHost: "smtp.office365.com",
    smtpPort: "587",
    smtpSecure: false,
    appPasswordNote: "If you have 2-factor authentication enabled, you'll need an App Password from your Microsoft account security settings.",
  },
  live: {
    label: "Live",
    imapHost: "outlook.office365.com",
    imapPort: "993",
    imapSecure: true,
    smtpHost: "smtp.office365.com",
    smtpPort: "587",
    smtpSecure: false,
    appPasswordNote: "If you have 2-factor authentication enabled, you'll need an App Password from your Microsoft account security settings.",
  },
  icloud: {
    label: "iCloud",
    imapHost: "imap.mail.me.com",
    imapPort: "993",
    imapSecure: true,
    smtpHost: "smtp.mail.me.com",
    smtpPort: "587",
    smtpSecure: false,
    appPasswordNote: "iCloud requires an App-Specific Password. Generate one at appleid.apple.com → Sign-In and Security → App-Specific Passwords.",
  },
};

function detectEmailProvider(email: string): string | null {
  const domain = email.split("@")[1]?.toLowerCase();
  if (!domain) return null;
  if (domain.includes("yahoo.")) return "yahoo";
  if (domain.includes("aol.")) return "aol";
  if (domain.startsWith("outlook.")) return "outlook";
  if (domain.startsWith("hotmail.")) return "hotmail";
  if (domain.startsWith("live.")) return "live";
  if (domain.includes("icloud.") || domain.includes("me.com") || domain.includes("mac.com")) return "icloud";
  return null;
}

interface EmailAccountsDialogProps {
  accounts: EmailAccount[] | undefined;
  accountsLoading: boolean;
}

export function EmailAccountsDialog({ accounts, accountsLoading }: EmailAccountsDialogProps) {
  const [showAccountsDialog, setShowAccountsDialog] = useState(false);
  const [showAddAccountForm, setShowAddAccountForm] = useState(false);
  const [selectedProvider, setSelectedProvider] = useState<"IMAP" | "GMAIL" | "OUTLOOK" | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [deleteAccountId, setDeleteAccountId] = useState<string | null>(null);
  const [editingAccount, setEditingAccount] = useState<EmailAccount | null>(null);
  const [editFormData, setEditFormData] = useState({
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
  const [editShowPassword, setEditShowPassword] = useState(false);

  const { toast } = useToast();

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

  const [imapFormErrors, setImapFormErrors] = useState<Record<string, string>>({});

  const [lastAppliedPreset, setLastAppliedPreset] = useState<string | null>(null);
  const detectedProvider = useMemo(() => detectEmailProvider(imapFormData.emailAddress), [imapFormData.emailAddress]);
  const providerPreset = detectedProvider ? PROVIDER_PRESETS[detectedProvider] : null;

  useEffect(() => {
    if (detectedProvider && detectedProvider !== lastAppliedPreset && providerPreset) {
      setImapFormData(prev => ({
        ...prev,
        imapHost: providerPreset.imapHost,
        imapPort: providerPreset.imapPort,
        imapSecure: providerPreset.imapSecure,
        smtpHost: providerPreset.smtpHost,
        smtpPort: providerPreset.smtpPort,
        smtpSecure: providerPreset.smtpSecure,
      }));
      setLastAppliedPreset(detectedProvider);
    } else if (!detectedProvider && lastAppliedPreset) {
      setLastAppliedPreset(null);
    }
  }, [detectedProvider]);

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
    setImapFormErrors({});
    setShowPassword(false);
    setLastAppliedPreset(null);
  };

  const createAccountMutation = useCreateAccount({
    onSuccess: () => {
      setShowAddAccountForm(false);
      setSelectedProvider(null);
      resetImapForm();
    },
  });

  const testAccountMutation = useTestAccount();
  const toggleAccountMutation = useToggleAccount();
  const deleteAccountMutation = useDeleteAccount({
    onSuccess: () => setDeleteAccountId(null),
  });
  const updateAccountMutation = useUpdateAccount({
    onSuccess: () => setEditingAccount(null),
  });

  const startEditAccount = (account: EmailAccount) => {
    setEditFormData({
      displayName: account.displayName || "",
      imapHost: account.imapHost || "",
      imapPort: String(account.imapPort || 993),
      imapSecure: account.imapSecure ?? true,
      smtpHost: account.smtpHost || "",
      smtpPort: String(account.smtpPort || 587),
      smtpSecure: account.smtpSecure ?? true,
      imapUsername: account.imapUsername || "",
      imapPassword: "",
    });
    setEditShowPassword(false);
    setEditingAccount(account);
  };

  const handleEditSubmit = () => {
    if (!editingAccount) return;
    updateAccountMutation.mutate({
      id: editingAccount.id,
      displayName: editFormData.displayName || undefined,
      imapHost: editFormData.imapHost || undefined,
      imapPort: parseInt(editFormData.imapPort) || 993,
      imapSecure: editFormData.imapSecure,
      smtpHost: editFormData.smtpHost || undefined,
      smtpPort: editFormData.smtpPort ? parseInt(editFormData.smtpPort) : undefined,
      smtpSecure: editFormData.smtpSecure,
      imapUsername: editFormData.imapUsername || undefined,
      ...(editFormData.imapPassword ? { imapPassword: editFormData.imapPassword } : {}),
    });
  };

  const handleImapSubmit = () => {
    const errors: Record<string, string> = {};
    if (!imapFormData.emailAddress.trim()) {
      errors.emailAddress = "Email address is required";
    }
    if (!imapFormData.imapHost.trim()) {
      errors.imapHost = "IMAP server host is required";
    }
    if (!imapFormData.imapPassword) {
      errors.imapPassword = "Password is required";
    }
    if (Object.keys(errors).length > 0) {
      setImapFormErrors(errors);
      const missingFields = Object.values(errors).join(", ");
      toast({
        title: "Missing required fields",
        description: missingFields,
        variant: "destructive",
      });
      return;
    }
    setImapFormErrors({});
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

  const initiateOAuth = (provider: "GMAIL" | "OUTLOOK") => {
    window.location.href = `/api/email/oauth/${provider.toLowerCase()}/initiate`;
  };

  return (
    <>
      <Dialog open={showAccountsDialog} onOpenChange={(open) => {
        setShowAccountsDialog(open);
        if (!open) {
          setShowAddAccountForm(false);
          setSelectedProvider(null);
          resetImapForm();
          setEditingAccount(null);
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
              {(showAddAccountForm || editingAccount) && (
                <Button 
                  variant="ghost" 
                  size="icon" 
                  className="h-6 w-6 mr-1"
                  onClick={() => {
                    if (editingAccount) {
                      setEditingAccount(null);
                    } else if (selectedProvider) {
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
              {editingAccount
                ? "Edit Email Account"
                : showAddAccountForm 
                  ? (selectedProvider === "IMAP" ? "Connect IMAP Account" : selectedProvider ? `Connect ${selectedProvider}` : "Add Email Account")
                  : "Email Accounts"
              }
            </DialogTitle>
            <DialogDescription>
              {editingAccount
                ? `Update settings for ${editingAccount.emailAddress}`
                : showAddAccountForm 
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

          {editingAccount ? (
            <div className="flex flex-col">
              <ScrollArea className="max-h-[400px] pr-4">
                <div className="grid gap-4 py-4">
                  <div className="space-y-2">
                    <Label htmlFor="editDisplayName">Display Name</Label>
                    <Input
                      id="editDisplayName"
                      placeholder="My Work Email"
                      value={editFormData.displayName}
                      onChange={(e) => setEditFormData(prev => ({ ...prev, displayName: e.target.value }))}
                      data-testid="input-edit-display-name"
                    />
                  </div>
                  <Separator />
                  <div className="text-sm font-medium text-muted-foreground">Incoming Mail (IMAP)</div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-2">
                      <Label htmlFor="editImapHost">IMAP Server</Label>
                      <Input
                        id="editImapHost"
                        placeholder="imap.example.com"
                        value={editFormData.imapHost}
                        onChange={(e) => setEditFormData(prev => ({ ...prev, imapHost: e.target.value }))}
                        data-testid="input-edit-imap-host"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="editImapPort">Port</Label>
                      <Input
                        id="editImapPort"
                        placeholder="993"
                        value={editFormData.imapPort}
                        onChange={(e) => setEditFormData(prev => ({ ...prev, imapPort: e.target.value }))}
                        data-testid="input-edit-imap-port"
                      />
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Switch
                      id="editImapSecure"
                      checked={editFormData.imapSecure}
                      onCheckedChange={(checked) => setEditFormData(prev => ({ ...prev, imapSecure: checked }))}
                      data-testid="switch-edit-imap-secure"
                    />
                    <Label htmlFor="editImapSecure" className="text-sm">Use SSL/TLS</Label>
                  </div>
                  <Separator />
                  <div className="text-sm font-medium text-muted-foreground">Outgoing Mail (SMTP)</div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-2">
                      <Label htmlFor="editSmtpHost">SMTP Server</Label>
                      <Input
                        id="editSmtpHost"
                        placeholder="smtp.example.com"
                        value={editFormData.smtpHost}
                        onChange={(e) => setEditFormData(prev => ({ ...prev, smtpHost: e.target.value }))}
                        data-testid="input-edit-smtp-host"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="editSmtpPort">Port</Label>
                      <Input
                        id="editSmtpPort"
                        placeholder="587"
                        value={editFormData.smtpPort}
                        onChange={(e) => setEditFormData(prev => ({ ...prev, smtpPort: e.target.value }))}
                        data-testid="input-edit-smtp-port"
                      />
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Switch
                      id="editSmtpSecure"
                      checked={editFormData.smtpSecure}
                      onCheckedChange={(checked) => setEditFormData(prev => ({ ...prev, smtpSecure: checked }))}
                      data-testid="switch-edit-smtp-secure"
                    />
                    <Label htmlFor="editSmtpSecure" className="text-sm">Use SSL/TLS</Label>
                  </div>
                  <Separator />
                  <div className="text-sm font-medium text-muted-foreground">Credentials</div>
                  <div className="space-y-2">
                    <Label htmlFor="editImapUsername">Username</Label>
                    <Input
                      id="editImapUsername"
                      placeholder="Leave blank to use email address"
                      value={editFormData.imapUsername}
                      onChange={(e) => setEditFormData(prev => ({ ...prev, imapUsername: e.target.value }))}
                      data-testid="input-edit-imap-username"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="editImapPassword">Password</Label>
                    <div className="relative">
                      <Input
                        id="editImapPassword"
                        type={editShowPassword ? "text" : "password"}
                        placeholder="Leave blank to keep current password"
                        value={editFormData.imapPassword}
                        onChange={(e) => setEditFormData(prev => ({ ...prev, imapPassword: e.target.value }))}
                        className="pr-10"
                        data-testid="input-edit-imap-password"
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="absolute right-0 top-0 h-full px-3"
                        onClick={() => setEditShowPassword(!editShowPassword)}
                        data-testid="button-edit-toggle-password"
                      >
                        {editShowPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Leave blank to keep your current password
                    </p>
                  </div>
                </div>
              </ScrollArea>
              <DialogFooter className="gap-2 sm:gap-0 pt-4">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => testAccountMutation.mutate({
                    id: editingAccount.id,
                    overrides: {
                      imapHost: editFormData.imapHost || undefined,
                      imapPort: parseInt(editFormData.imapPort) || 993,
                      imapSecure: editFormData.imapSecure,
                      smtpHost: editFormData.smtpHost || undefined,
                      smtpPort: editFormData.smtpPort ? parseInt(editFormData.smtpPort) : undefined,
                      smtpSecure: editFormData.smtpSecure,
                      imapUsername: editFormData.imapUsername || undefined,
                      imapPassword: editFormData.imapPassword || undefined,
                    },
                  })}
                  disabled={testAccountMutation.isPending}
                  data-testid="button-edit-test-connection"
                >
                  {testAccountMutation.isPending ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Wifi className="h-4 w-4 mr-2" />
                  )}
                  Test Connection
                </Button>
                <Button
                  variant="outline"
                  onClick={() => setEditingAccount(null)}
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleEditSubmit}
                  disabled={updateAccountMutation.isPending}
                  data-testid="button-save-edit-account"
                >
                  {updateAccountMutation.isPending ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <Save className="w-4 h-4 mr-2" />
                  )}
                  Save Changes
                </Button>
              </DialogFooter>
            </div>
          ) : !showAddAccountForm ? (
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
                          <div className="font-medium text-sm flex items-center gap-1.5">
                            {account.emailAddress}
                            {account.lastSyncError && (
                              <TooltipProvider>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <AlertTriangle className="w-3.5 h-3.5 text-amber-500 shrink-0" data-testid={`icon-sync-error-${account.id}`} />
                                  </TooltipTrigger>
                                  <TooltipContent side="top" className="max-w-xs">
                                    <p className="text-xs">{account.lastSyncError}</p>
                                  </TooltipContent>
                                </Tooltip>
                              </TooltipProvider>
                            )}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {account.provider}
                            {account.lastSyncedAt && (
                              <span> · Synced {formatDistanceToNow(new Date(account.lastSyncedAt))} ago</span>
                            )}
                            {account.lastSyncError && !account.lastSyncedAt && (
                              <span className="text-amber-600 dark:text-amber-400"> · Sync error</span>
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {account.provider === "IMAP" ? (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => startEditAccount(account)}
                            title="Edit account settings"
                            data-testid={`button-edit-account-${account.id}`}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                        ) : (
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-8 w-8 opacity-50"
                                    disabled
                                    data-testid={`button-edit-account-${account.id}`}
                                  >
                                    <Pencil className="h-4 w-4" />
                                  </Button>
                                </span>
                              </TooltipTrigger>
                              <TooltipContent side="top">
                                <p className="text-xs">OAuth accounts require re-authorization to update</p>
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        )}
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => testAccountMutation.mutate({ id: account.id })}
                          disabled={testAccountMutation.isPending}
                          title="Test connection"
                          data-testid={`button-test-account-${account.id}`}
                        >
                          {testAccountMutation.isPending ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Wifi className="h-4 w-4" />
                          )}
                        </Button>
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
                    <Label htmlFor="emailAddress">Email Address <span className="text-destructive">*</span></Label>
                    <Input
                      id="emailAddress"
                      type="email"
                      placeholder="you@example.com"
                      value={imapFormData.emailAddress}
                      onChange={(e) => {
                        setImapFormData(prev => ({ ...prev, emailAddress: e.target.value }));
                        if (imapFormErrors.emailAddress) setImapFormErrors(prev => ({ ...prev, emailAddress: "" }));
                      }}
                      className={imapFormErrors.emailAddress ? "border-destructive" : ""}
                      data-testid="input-email-address"
                    />
                    {imapFormErrors.emailAddress && (
                      <p className="text-xs text-destructive" data-testid="error-email-address">{imapFormErrors.emailAddress}</p>
                    )}
                    {providerPreset && (
                      <div className="flex items-start gap-2 p-2 rounded-md bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800" data-testid="provider-auto-detect-note">
                        <Info className="w-4 h-4 text-blue-600 dark:text-blue-400 mt-0.5 shrink-0" />
                        <div className="text-xs text-blue-700 dark:text-blue-300">
                          <span className="font-medium">{providerPreset.label} detected</span> — server settings auto-filled. {providerPreset.appPasswordNote}
                        </div>
                      </div>
                    )}
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
                      <Label htmlFor="imapHost">IMAP Server <span className="text-destructive">*</span></Label>
                      <Input
                        id="imapHost"
                        placeholder="imap.example.com"
                        value={imapFormData.imapHost}
                        onChange={(e) => {
                          setImapFormData(prev => ({ ...prev, imapHost: e.target.value }));
                          if (imapFormErrors.imapHost) setImapFormErrors(prev => ({ ...prev, imapHost: "" }));
                        }}
                        className={imapFormErrors.imapHost ? "border-destructive" : ""}
                        data-testid="input-imap-host"
                      />
                      {imapFormErrors.imapHost && (
                        <p className="text-xs text-destructive" data-testid="error-imap-host">{imapFormErrors.imapHost}</p>
                      )}
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
                    <Label htmlFor="imapPassword">Password <span className="text-destructive">*</span></Label>
                    <div className="relative">
                      <Input
                        id="imapPassword"
                        type={showPassword ? "text" : "password"}
                        placeholder="Your email password or app password"
                        value={imapFormData.imapPassword}
                        onChange={(e) => {
                          setImapFormData(prev => ({ ...prev, imapPassword: e.target.value }));
                          if (imapFormErrors.imapPassword) setImapFormErrors(prev => ({ ...prev, imapPassword: "" }));
                        }}
                        className={`pr-10 ${imapFormErrors.imapPassword ? "border-destructive" : ""}`}
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
                    {imapFormErrors.imapPassword && (
                      <p className="text-xs text-destructive" data-testid="error-imap-password">{imapFormErrors.imapPassword}</p>
                    )}
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

      <AlertDialog open={!!deleteAccountId} onOpenChange={(open) => {
        if (!open && !deleteAccountMutation.isPending) {
          setDeleteAccountId(null);
        }
      }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove Email Account?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove this email account from SmartManageAI, along with all synced threads and messages.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteAccountMutation.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleteAccountMutation.isPending}
              onClick={(e) => {
                e.preventDefault();
                if (deleteAccountId) deleteAccountMutation.mutate(deleteAccountId);
              }}
              data-testid="button-confirm-delete-account"
            >
              {deleteAccountMutation.isPending ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : null}
              {deleteAccountMutation.isPending ? "Removing..." : "Remove Account"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
