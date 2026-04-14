import { useState, useEffect, Fragment } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useEntitlements } from "@/hooks/useEntitlements";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Bell, Loader2, Lock, AlertCircle } from "lucide-react";
import { useIntegrationStatus } from "@/hooks/use-integration-status";

interface ChannelPrefsData {
  emailEnabled: boolean;
  smsEnabled: boolean;
  pushEnabled: boolean;
  teamsEnabled: boolean;
  slackEnabled: boolean;
  smsPhoneNumber: string | null;
  teamsWebhookUrl: string | null;
  slackWebhookUrl: string | null;
}

interface TypeOverride {
  notificationType: string;
  emailEnabled: boolean;
}

const NOTIFICATION_TYPE_GROUPS: { label: string; types: string[] }[] = [
  {
    label: "Approvals & Change Orders",
    types: [
      "CHANGE_ORDER_PENDING", "CHANGE_ORDER_APPROVED", "CHANGE_ORDER_REJECTED",
      "APPROVAL_REQUEST_NEW", "APPROVAL_REQUEST_APPROVED", "APPROVAL_REQUEST_REJECTED",
      "OVERTIME_REQUESTED", "OVERTIME_APPROVED", "OVERTIME_REJECTED",
      "TM_TICKET_SUBMITTED", "TM_TICKET_APPROVED", "TM_TICKET_REJECTED",
      "PAYABLE_SUBMITTED", "PAYABLE_CREATED", "PAYABLE_APPROVED", "PAYABLE_REJECTED",
      "SUBMITTAL_SUBMITTED", "SUBMITTAL_APPROVED", "SUBMITTAL_REJECTED", "SUBMITTAL_REVISION_REQUESTED",
    ],
  },
  {
    label: "Projects & Bids",
    types: [
      "PROJECT_ASSIGNMENT", "BID_AWARDED", "BID_INVITATION_RECEIVED", "BID_RESPONSE_RECEIVED",
      "BID_CLARIFICATION_NEW", "PROGRESS_MILESTONE", "DAILY_PROGRESS_LOGGED", "SOV_ITEM_COMPLETED",
      "DEADLINE_WARNING", "REMINDER",
    ],
  },
  {
    label: "Payroll & Procurement",
    types: [
      "BILLING_READY",
      "PROCUREMENT_PR_SUBMITTED", "PROCUREMENT_PR_APPROVED", "PROCUREMENT_PR_REJECTED",
      "PROCUREMENT_PO_SUBMITTED", "PROCUREMENT_PO_APPROVED", "PROCUREMENT_PO_REJECTED",
    ],
  },
  {
    label: "CRM & Messaging",
    types: ["CRM_STAGE_CHANGE", "CRM_IDLE_OPPORTUNITY", "TASK_MENTIONED", "PORTAL_CHAT_MESSAGE", "PORTAL_ACTIVITY"],
  },
  {
    label: "General",
    types: ["GENERAL", "DELAY_SUBMITTED", "DELAY_ACKNOWLEDGED", "MATERIAL_OVERAGE"],
  },
];

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) {
    output[i] = raw.charCodeAt(i);
  }
  return output;
}

export default function NotificationPrefsSection() {
  const { toast } = useToast();
  const { can } = useEntitlements();
  const hasEnterpriseNotifications = can("ENTERPRISE_NOTIFICATIONS");
  const { status: integrationStatus } = useIntegrationStatus();
  const smsAvailable = integrationStatus.twilio;

  const { data: notifPrefs, isLoading: loadingNotifPrefs } = useQuery<{ channel: ChannelPrefsData; typeOverrides: TypeOverride[] }>({
    queryKey: ["/api/notifications/preferences"],
  });

  const [channelPrefs, setChannelPrefs] = useState<ChannelPrefsData>({
    emailEnabled: false, smsEnabled: false, pushEnabled: false,
    teamsEnabled: false, slackEnabled: false,
    smsPhoneNumber: null, teamsWebhookUrl: null, slackWebhookUrl: null,
  });

  const [smsPhoneInput, setSmsPhoneInput] = useState("");
  const [teamsWebhookInput, setTeamsWebhookInput] = useState("");
  const [slackWebhookInput, setSlackWebhookInput] = useState("");
  const [typeEmailOverrides, setTypeEmailOverrides] = useState<Record<string, boolean>>({});
  const [pushPermission, setPushPermission] = useState<NotificationPermission>("default");
  const [pushSubscribing, setPushSubscribing] = useState(false);

  useEffect(() => {
    if ("Notification" in window) {
      setPushPermission(Notification.permission);
    }
  }, []);

  useEffect(() => {
    if (notifPrefs?.channel) {
      setChannelPrefs({
        emailEnabled: notifPrefs.channel.emailEnabled,
        smsEnabled: notifPrefs.channel.smsEnabled,
        pushEnabled: notifPrefs.channel.pushEnabled,
        teamsEnabled: notifPrefs.channel.teamsEnabled,
        slackEnabled: notifPrefs.channel.slackEnabled,
        smsPhoneNumber: notifPrefs.channel.smsPhoneNumber ?? null,
        teamsWebhookUrl: notifPrefs.channel.teamsWebhookUrl ?? null,
        slackWebhookUrl: notifPrefs.channel.slackWebhookUrl ?? null,
      });
      setSmsPhoneInput(notifPrefs.channel.smsPhoneNumber ?? "");
      setTeamsWebhookInput(notifPrefs.channel.teamsWebhookUrl ?? "");
      setSlackWebhookInput(notifPrefs.channel.slackWebhookUrl ?? "");
    }
    if (notifPrefs?.typeOverrides) {
      const overrides: Record<string, boolean> = {};
      for (const o of notifPrefs.typeOverrides) {
        overrides[o.notificationType] = o.emailEnabled;
      }
      setTypeEmailOverrides(overrides);
    }
  }, [notifPrefs]);

  async function requestPushSubscription(): Promise<boolean> {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
      toast({ title: "Push not supported", description: "Your browser does not support push notifications.", variant: "destructive" });
      return false;
    }
    try {
      const permission = await Notification.requestPermission();
      setPushPermission(permission);
      if (permission !== "granted") {
        toast({ title: "Permission denied", description: "Please allow notifications in your browser settings.", variant: "destructive" });
        return false;
      }
      const vapidPublicKey = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined;
      if (!vapidPublicKey) {
        toast({ title: "Push not configured", description: "Server-side push is not set up.", variant: "destructive" });
        return false;
      }
      const reg = await navigator.serviceWorker.ready;
      const existing = await reg.pushManager.getSubscription();
      if (existing) await existing.unsubscribe();
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
      });
      const json = sub.toJSON();
      await apiRequest("POST", "/api/notifications/push-subscribe", {
        endpoint: json.endpoint,
        p256dh: json.keys?.p256dh,
        auth: json.keys?.auth,
        userAgent: navigator.userAgent,
      });
      return true;
    } catch (err: unknown) {
      const name = err instanceof Error ? err.name : "";
      if (name === "AbortError" || name === "NotSupportedError") {
        toast({ title: "Push notifications unavailable", description: "Your browser's push service could not be reached." });
      } else {
        toast({ title: "Push setup failed", description: String(err), variant: "destructive" });
      }
      return false;
    }
  }

  async function removePushSubscription(): Promise<void> {
    try {
      if ("serviceWorker" in navigator) {
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.getSubscription();
        if (sub) {
          await apiRequest("DELETE", "/api/notifications/push-unsubscribe", { endpoint: sub.endpoint });
          await sub.unsubscribe();
        }
      }
    } catch (err) { console.warn("[NotificationPrefs] Failed to toggle push subscription:", err); }
  }

  async function handlePushToggle(enabled: boolean) {
    setPushSubscribing(true);
    try {
      if (enabled) {
        const success = await requestPushSubscription();
        if (success) setChannelPrefs(p => ({ ...p, pushEnabled: true }));
      } else {
        await removePushSubscription();
        setChannelPrefs(p => ({ ...p, pushEnabled: false }));
      }
    } finally {
      setPushSubscribing(false);
    }
  }

  const updatePrefsMutation = useMutation({
    mutationFn: async () => {
      const typeOverrides: Record<string, { emailEnabled: boolean }> = {};
      for (const [type, emailEnabled] of Object.entries(typeEmailOverrides)) {
        typeOverrides[type] = { emailEnabled };
      }
      return await apiRequest("PUT", "/api/notifications/preferences", {
        channel: channelPrefs,
        typeOverrides,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/notifications/preferences"] });
      toast({ title: "Notification preferences saved" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to save preferences", description: error.message, variant: "destructive" });
    },
  });

  const saveWebhooksMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest("PUT", "/api/notifications/preferences/webhooks", {
        smsPhoneNumber: smsPhoneInput.trim() || null,
        teamsWebhookUrl: teamsWebhookInput.trim() || null,
        slackWebhookUrl: slackWebhookInput.trim() || null,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/notifications/preferences"] });
      toast({ title: "Connection settings saved" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to save connection settings", description: error.message, variant: "destructive" });
    },
  });

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold" data-testid="text-section-title-notifications">Notification Preferences</h2>
        <p className="text-muted-foreground mt-1">Configure how and when you receive notifications</p>
      </div>

      <Card>
        <CardContent className="pt-6">
          {loadingNotifPrefs ? (
            <div className="space-y-3">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
            </div>
          ) : (
            <div className="space-y-6 max-w-2xl">
              <div>
                <h3 className="text-sm font-semibold mb-3 text-muted-foreground uppercase tracking-wide">Delivery Channels</h3>
                <div className="space-y-3">
                  <div className="flex items-center justify-between" data-testid="row-pref-email">
                    <div>
                      <p className="text-sm font-medium">Email</p>
                      <p className="text-xs text-muted-foreground">Receive notifications via email</p>
                    </div>
                    <Switch checked={channelPrefs.emailEnabled} onCheckedChange={(checked) => setChannelPrefs(p => ({ ...p, emailEnabled: checked }))} data-testid="switch-pref-email" />
                  </div>

                  <div data-testid="row-pref-sms">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div>
                          <p className="text-sm font-medium">SMS</p>
                          <p className="text-xs text-muted-foreground">Receive text messages for critical alerts</p>
                        </div>
                        {!smsAvailable ? (
                          <Badge variant="outline" className="text-xs gap-1 text-muted-foreground" data-testid="badge-unavailable-sms">
                            <AlertCircle className="h-3 w-3" />
                            Not configured
                          </Badge>
                        ) : !hasEnterpriseNotifications ? (
                          <Badge variant="outline" className="text-xs gap-1" data-testid="badge-enterprise-sms">
                            <Lock className="h-3 w-3" />
                            Enterprise
                          </Badge>
                        ) : null}
                      </div>
                      {!smsAvailable ? (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span tabIndex={0} className="inline-flex">
                              <Switch checked={false} disabled data-testid="switch-pref-sms" />
                            </span>
                          </TooltipTrigger>
                          <TooltipContent side="left">
                            SMS requires additional setup by your administrator.
                          </TooltipContent>
                        </Tooltip>
                      ) : hasEnterpriseNotifications ? (
                        <Switch checked={channelPrefs.smsEnabled} onCheckedChange={(checked) => setChannelPrefs(p => ({ ...p, smsEnabled: checked }))} data-testid="switch-pref-sms" />
                      ) : (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span tabIndex={0} className="inline-flex">
                              <Switch checked={false} disabled data-testid="switch-pref-sms" />
                            </span>
                          </TooltipTrigger>
                          <TooltipContent side="left">
                            Upgrade to the Scale plan to enable SMS notifications.
                          </TooltipContent>
                        </Tooltip>
                      )}
                    </div>
                    {smsAvailable && hasEnterpriseNotifications && channelPrefs.smsEnabled && (
                      <div className="mt-2 space-y-1">
                        <Label htmlFor="sms-phone-input" className="text-xs text-muted-foreground">Mobile number (E.164 format)</Label>
                        <Input id="sms-phone-input" value={smsPhoneInput} onChange={(e) => setSmsPhoneInput(e.target.value)} placeholder="+15551234567" data-testid="input-sms-phone" />
                      </div>
                    )}
                  </div>

                  <div className="flex items-center justify-between" data-testid="row-pref-push">
                    <div>
                      <p className="text-sm font-medium">Push Notifications</p>
                      <p className="text-xs text-muted-foreground">Browser and mobile push alerts</p>
                    </div>
                    {pushPermission === "denied" ? (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span tabIndex={0} className="inline-flex">
                            <Switch checked={false} disabled data-testid="switch-pref-push" />
                          </span>
                        </TooltipTrigger>
                        <TooltipContent side="left">
                          Notifications are blocked in your browser settings.
                        </TooltipContent>
                      </Tooltip>
                    ) : (
                      <Switch checked={channelPrefs.pushEnabled} onCheckedChange={handlePushToggle} disabled={pushSubscribing} data-testid="switch-pref-push" />
                    )}
                  </div>

                  <div data-testid="row-pref-teams">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div>
                          <p className="text-sm font-medium">Microsoft Teams</p>
                          <p className="text-xs text-muted-foreground">Receive messages in your Teams workspace</p>
                        </div>
                        {!hasEnterpriseNotifications && (
                          <Badge variant="outline" className="text-xs gap-1" data-testid="badge-enterprise-teams">
                            <Lock className="h-3 w-3" />
                            Enterprise
                          </Badge>
                        )}
                      </div>
                      {hasEnterpriseNotifications ? (
                        <Switch checked={channelPrefs.teamsEnabled} onCheckedChange={(checked) => setChannelPrefs(p => ({ ...p, teamsEnabled: checked }))} data-testid="switch-pref-teams" />
                      ) : (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span tabIndex={0} className="inline-flex">
                              <Switch checked={false} disabled data-testid="switch-pref-teams" />
                            </span>
                          </TooltipTrigger>
                          <TooltipContent side="left">
                            Upgrade to the Scale plan to enable Teams notifications.
                          </TooltipContent>
                        </Tooltip>
                      )}
                    </div>
                    {hasEnterpriseNotifications && channelPrefs.teamsEnabled && (
                      <div className="mt-2 space-y-1">
                        <Label htmlFor="teams-webhook-input" className="text-xs text-muted-foreground">Teams incoming webhook URL</Label>
                        <Input id="teams-webhook-input" value={teamsWebhookInput} onChange={(e) => setTeamsWebhookInput(e.target.value)} placeholder="https://xxx.webhook.office.com/..." data-testid="input-teams-webhook" />
                      </div>
                    )}
                  </div>

                  <div data-testid="row-pref-slack">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div>
                          <p className="text-sm font-medium">Slack</p>
                          <p className="text-xs text-muted-foreground">Receive messages in your Slack workspace</p>
                        </div>
                        {!hasEnterpriseNotifications && (
                          <Badge variant="outline" className="text-xs gap-1" data-testid="badge-enterprise-slack">
                            <Lock className="h-3 w-3" />
                            Enterprise
                          </Badge>
                        )}
                      </div>
                      {hasEnterpriseNotifications ? (
                        <Switch checked={channelPrefs.slackEnabled} onCheckedChange={(checked) => setChannelPrefs(p => ({ ...p, slackEnabled: checked }))} data-testid="switch-pref-slack" />
                      ) : (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span tabIndex={0} className="inline-flex">
                              <Switch checked={false} disabled data-testid="switch-pref-slack" />
                            </span>
                          </TooltipTrigger>
                          <TooltipContent side="left">
                            Upgrade to the Scale plan to enable Slack notifications.
                          </TooltipContent>
                        </Tooltip>
                      )}
                    </div>
                    {hasEnterpriseNotifications && channelPrefs.slackEnabled && (
                      <div className="mt-2 space-y-1">
                        <Label htmlFor="slack-webhook-input" className="text-xs text-muted-foreground">Slack incoming webhook URL</Label>
                        <Input id="slack-webhook-input" value={slackWebhookInput} onChange={(e) => setSlackWebhookInput(e.target.value)} placeholder="https://hooks.slack.com/services/..." data-testid="input-slack-webhook" />
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {hasEnterpriseNotifications && (channelPrefs.smsEnabled || channelPrefs.teamsEnabled || channelPrefs.slackEnabled) && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => saveWebhooksMutation.mutate()}
                  disabled={saveWebhooksMutation.isPending}
                  data-testid="button-save-connection-settings"
                >
                  {saveWebhooksMutation.isPending ? (
                    <Fragment><Loader2 className="h-4 w-4 mr-2 animate-spin" />Saving...</Fragment>
                  ) : "Save Connection Settings"}
                </Button>
              )}

              {channelPrefs.emailEnabled && (
                <div>
                  <h3 className="text-sm font-semibold mb-1 text-muted-foreground uppercase tracking-wide">Email Alerts by Type</h3>
                  <p className="text-xs text-muted-foreground mb-3">Fine-tune which notifications arrive in your inbox.</p>
                  <div className="space-y-4" data-testid="section-type-email-prefs">
                    {NOTIFICATION_TYPE_GROUPS.map((group) => (
                      <div key={group.label}>
                        <p className="text-xs font-semibold text-muted-foreground mb-2">{group.label}</p>
                        <div className="space-y-2">
                          {group.types.map((type) => {
                            const label = type.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
                            const isEnabled = typeEmailOverrides[type] ?? channelPrefs.emailEnabled;
                            return (
                              <div key={type} className="flex items-center justify-between py-1" data-testid={`row-type-pref-${type}`}>
                                <span className="text-sm">{label}</span>
                                <Switch checked={isEnabled} onCheckedChange={(checked) => setTypeEmailOverrides(prev => ({ ...prev, [type]: checked }))} data-testid={`switch-type-pref-${type}`} />
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <Button
                onClick={() => updatePrefsMutation.mutate()}
                disabled={updatePrefsMutation.isPending}
                data-testid="button-save-notification-prefs"
              >
                {updatePrefsMutation.isPending ? (
                  <Fragment><Loader2 className="h-4 w-4 mr-2 animate-spin" />Saving...</Fragment>
                ) : (
                  <Fragment><Bell className="h-4 w-4 mr-2" />Save Preferences</Fragment>
                )}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}