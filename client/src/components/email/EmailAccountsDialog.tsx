import { useState } from "react";
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
import { useCreateAccount, useToggleAccount, useDeleteAccount, useTestAccount } from "@/hooks/useEmailMutations";
import { useToast } from "@/hooks/use-toast";
import type { EmailAccount } from "./shared";

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
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => testAccountMutation.mutate(account.id)}
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
