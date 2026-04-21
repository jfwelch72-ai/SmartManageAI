import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Link, useLocation } from "wouter";
import { useTheme } from "@/hooks/use-theme";
import { useTableDensity, TABLE_DENSITY_OPTIONS } from "@/hooks/use-table-density";
import { format } from "date-fns";
import {
  User, Shield, Bell, Palette, Building2, Link2, Database,
  Download, AlertTriangle, Clock, Monitor,
  Sun, Moon, Globe, ExternalLink, Key, Loader2,
  Activity, Settings as SettingsIcon, Users,
  Lock, Plus, Trash2, Copy, Check, QrCode, Award, Rows3
} from "lucide-react";

import ProfileEditSection from "@/components/settings/ProfileEditSection";
import PasswordChangeSection from "@/components/settings/PasswordChangeSection";
import PasskeySection from "@/components/settings/PasskeySection";
import NotificationPrefsSection from "@/components/settings/NotificationPrefsSection";
import SkillsSection from "@/components/settings/SkillsSection";

const TIMEZONES = [
  "America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles",
  "America/Anchorage", "America/Honolulu", "America/Phoenix", "America/Puerto_Rico",
  "UTC", "Europe/London", "Europe/Paris", "Europe/Berlin",
  "Asia/Tokyo", "Asia/Shanghai", "Asia/Kolkata", "Australia/Sydney",
];

interface SettingsData {
  themePreference: string;
  defaultLandingPage: string;
  dateFormat: string;
  timeFormat: string;
  timezone: string | null;
  birthdayDigestWeekday: number;
  birthdayDigestHour: number;
}

const WEEKDAY_OPTIONS = [
  { value: 0, label: "Sunday" },
  { value: 1, label: "Monday" },
  { value: 2, label: "Tuesday" },
  { value: 3, label: "Wednesday" },
  { value: 4, label: "Thursday" },
  { value: 5, label: "Friday" },
  { value: 6, label: "Saturday" },
];

const HOUR_OPTIONS = Array.from({ length: 24 }, (_, h) => {
  const display12 = ((h + 11) % 12) + 1;
  const ampm = h < 12 ? "AM" : "PM";
  return { value: h, label: `${display12}:00 ${ampm} (${String(h).padStart(2, "0")}:00)` };
});

interface ActivityLogEntry {
  id: string;
  action: string;
  details: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
}

interface SessionInfo {
  id: string;
  browser: string;
  ipAddress: string;
  lastActive: string;
  isCurrent: boolean;
}

interface ApiKeyInfo {
  id: string;
  key: string;
  name: string;
  createdAt: string;
  lastUsed: string | null;
}

type SectionKey = "profile" | "security" | "notifications" | "preferences" | "skills" | "organization" | "integrations" | "data-privacy";

const SECTIONS: { key: SectionKey; label: string; icon: typeof User; adminOnly?: boolean; managerAccess?: boolean }[] = [
  { key: "profile", label: "Profile & Account", icon: User },
  { key: "security", label: "Password & Security", icon: Shield },
  { key: "notifications", label: "Notifications", icon: Bell },
  { key: "skills", label: "Skills & Certifications", icon: Award },
  { key: "preferences", label: "App Preferences", icon: Palette },
  { key: "organization", label: "Organization", icon: Building2, managerAccess: true },
  { key: "integrations", label: "Integrations", icon: Link2, adminOnly: true },
  { key: "data-privacy", label: "Data & Privacy", icon: Database },
];

const LANDING_PAGES = [
  { value: "/dashboard", label: "Dashboard" },
  { value: "/projects", label: "Projects" },
  { value: "/calendar", label: "Calendar" },
  { value: "/tasks", label: "Tasks" },
  { value: "/bids", label: "Bids" },
  { value: "/communications", label: "Communications" },
];

function SecuritySection() {
  const { toast } = useToast();
  const [showTotpSetup, setShowTotpSetup] = useState(false);
  const [totpToken, setTotpToken] = useState("");
  const [copiedSecret, setCopiedSecret] = useState(false);

  const { data: sessions = [], isLoading: loadingSessions } = useQuery<SessionInfo[]>({
    queryKey: ["/api/account/sessions"],
  });

  const { data: totpStatus } = useQuery<{ enabled: boolean; verifiedAt: string | null }>({
    queryKey: ["/api/account/2fa/status"],
  });

  const disableTotpMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest("POST", "/api/account/2fa/disable", {});
    },
    onSuccess: () => {
      toast({ title: "2FA disabled", description: "Two-factor authentication has been disabled." });
      queryClient.invalidateQueries({ queryKey: ["/api/account/2fa/status"] });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to disable 2FA", description: error.message, variant: "destructive" });
    },
  });

  const revokeSessionsMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest("POST", "/api/account/sessions/revoke-all", {});
    },
    onSuccess: () => {
      toast({ title: "All sessions revoked", description: "You will need to log in again on other devices." });
      queryClient.invalidateQueries({ queryKey: ["/api/account/sessions"] });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to revoke sessions", description: error.message, variant: "destructive" });
    },
  });

  const totpSetupMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/account/2fa/setup", {});
      return res.json();
    },
    onSuccess: () => {
      setShowTotpSetup(true);
    },
    onError: (error: Error) => {
      toast({ title: "Failed to setup 2FA", description: error.message, variant: "destructive" });
    },
  });

  const totpVerifyMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest("POST", "/api/account/2fa/verify", { token: totpToken });
    },
    onSuccess: () => {
      toast({ title: "2FA enabled", description: "Two-factor authentication has been enabled successfully." });
      setShowTotpSetup(false);
      setTotpToken("");
      totpSetupMutation.reset();
      queryClient.invalidateQueries({ queryKey: ["/api/account/2fa/status"] });
    },
    onError: (error: Error) => {
      toast({ title: "Verification failed", description: error.message, variant: "destructive" });
    },
  });

  const totpData = totpSetupMutation.data as { secret: string; qrCode: string; backupCodes: string[]; otpauthUrl: string } | undefined;

  const handleCopySecret = () => {
    if (totpData?.secret) {
      navigator.clipboard.writeText(totpData.secret);
      setCopiedSecret(true);
      setTimeout(() => setCopiedSecret(false), 2000);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold" data-testid="text-section-title-security">Password & Security</h2>
        <p className="text-muted-foreground mt-1">Manage your password, passkeys, sessions, and two-factor authentication</p>
      </div>

      <PasswordChangeSection />

      <PasskeySection />

      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Monitor className="h-5 w-5" />
            Active Sessions
          </CardTitle>
          <CardDescription>View and manage your currently active sessions</CardDescription>
        </CardHeader>
        <CardContent>
          {loadingSessions ? (
            <Skeleton className="h-16 w-full" />
          ) : (
            <div className="space-y-3">
              {sessions.map((session) => (
                <div key={session.id} className="flex items-center justify-between p-3 border rounded-md" data-testid={`session-item-${session.id}`}>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <Monitor className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                      <p className="text-sm font-medium truncate">{session.browser.substring(0, 60)}...</p>
                      {session.isCurrent && <Badge variant="default" className="text-xs">Current</Badge>}
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">IP: {session.ipAddress}</p>
                    <p className="text-xs text-muted-foreground">Last active: {format(new Date(session.lastActive), "MMM d, yyyy h:mm a")}</p>
                  </div>
                </div>
              ))}
              <Button
                variant="destructive"
                size="sm"
                onClick={() => revokeSessionsMutation.mutate()}
                disabled={revokeSessionsMutation.isPending}
                data-testid="button-revoke-sessions"
              >
                {revokeSessionsMutation.isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Shield className="mr-2 h-4 w-4" />
                )}
                Revoke All Other Sessions
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <QrCode className="h-5 w-5" />
            Two-Factor Authentication
          </CardTitle>
          <CardDescription>Add an extra layer of security with TOTP-based two-factor authentication</CardDescription>
        </CardHeader>
        <CardContent>
          {totpStatus?.enabled ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Badge variant="default" className="bg-green-600" data-testid="badge-2fa-enabled">Enabled</Badge>
                {totpStatus.verifiedAt && (
                  <span className="text-xs text-muted-foreground">
                    since {format(new Date(totpStatus.verifiedAt), "MMM d, yyyy")}
                  </span>
                )}
              </div>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => disableTotpMutation.mutate()}
                disabled={disableTotpMutation.isPending}
                data-testid="button-disable-2fa"
              >
                {disableTotpMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Disable Two-Factor Authentication
              </Button>
            </div>
          ) : !showTotpSetup && !totpData ? (
            <Button
              variant="outline"
              onClick={() => totpSetupMutation.mutate()}
              disabled={totpSetupMutation.isPending}
              data-testid="button-setup-2fa"
            >
              {totpSetupMutation.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <QrCode className="mr-2 h-4 w-4" />
              )}
              Setup Two-Factor Authentication
            </Button>
          ) : totpData ? (
            <div className="space-y-4">
              <div className="flex flex-col items-center gap-3 p-4 border rounded-md bg-muted/50">
                <p className="text-sm font-medium">Scan this QR code with your authenticator app</p>
                <img src={totpData.qrCode} alt="2FA QR Code" className="w-48 h-48" data-testid="img-2fa-qrcode" />
                <div className="flex items-center gap-2">
                  <code className="text-xs bg-background px-2 py-1 rounded border" data-testid="text-2fa-secret">{totpData.secret}</code>
                  <Button variant="ghost" size="sm" onClick={handleCopySecret} data-testid="button-copy-secret">
                    {copiedSecret ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                  </Button>
                </div>
              </div>

              <div className="p-4 border rounded-md bg-muted/50">
                <p className="text-sm font-medium mb-2">Backup Codes</p>
                <p className="text-xs text-muted-foreground mb-2">Save these codes in a safe place. You can use them to sign in if you lose access to your authenticator app.</p>
                <div className="grid grid-cols-2 gap-1" data-testid="backup-codes-list">
                  {totpData.backupCodes.map((code, i) => (
                    <code key={i} className="text-xs bg-background px-2 py-1 rounded border text-center">{code}</code>
                  ))}
                </div>
              </div>

              <div className="flex items-center gap-2">
                <Input
                  placeholder="Enter 6-digit code from your app"
                  value={totpToken}
                  onChange={(e) => setTotpToken(e.target.value)}
                  maxLength={6}
                  data-testid="input-2fa-token"
                />
                <Button
                  onClick={() => totpVerifyMutation.mutate()}
                  disabled={totpVerifyMutation.isPending || totpToken.length !== 6}
                  data-testid="button-verify-2fa"
                >
                  {totpVerifyMutation.isPending ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : null}
                  Verify
                </Button>
              </div>

              <Button variant="ghost" size="sm" onClick={() => { setShowTotpSetup(false); totpSetupMutation.reset(); setTotpToken(""); }} data-testid="button-cancel-2fa">
                Cancel
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}

function PreferencesSection() {
  const { toast } = useToast();
  const { user } = useAuth();
  const { setTheme } = useTheme();
  const { density: tableDensity, setDensity: setTableDensity } = useTableDensity();

  const { data: settings, isLoading } = useQuery<SettingsData>({
    queryKey: ["/api/user-settings"],
  });

  const updateSettingsMutation = useMutation({
    mutationFn: async (data: Partial<SettingsData>) => {
      return await apiRequest("PATCH", "/api/user-settings", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/user-settings"] });
      toast({ title: "Preferences saved" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to save preferences", description: error.message, variant: "destructive" });
    },
  });

  const sendTestBirthdayDigestMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/user-settings/birthday-digest/test", {});
      return (await res.json()) as { success?: boolean; message?: string; sent?: boolean };
    },
    onSuccess: (data) => {
      const wasSent = data.sent !== false && !/no contact birthdays/i.test(data.message || "");
      toast({
        title: wasSent ? "Test digest sent" : "No birthdays to preview",
        description: data.message || (wasSent ? "Check your notifications." : "There are no contact birthdays in the next 7 days."),
      });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to send test digest", description: error.message, variant: "destructive" });
    },
  });

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  const currentSettings: SettingsData = settings || {
    themePreference: "system",
    defaultLandingPage: "/dashboard",
    dateFormat: "MM/DD/YYYY",
    timeFormat: "12h",
    timezone: user?.timezone || null,
    birthdayDigestWeekday: 1,
    birthdayDigestHour: 8,
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold" data-testid="text-section-title-preferences">App Preferences</h2>
        <p className="text-muted-foreground mt-1">Customize your application experience</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Sun className="h-5 w-5" />
            Theme
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex gap-3">
            {[
              { value: "light", label: "Light", icon: Sun },
              { value: "dark", label: "Dark", icon: Moon },
              { value: "system", label: "System", icon: Monitor },
            ].map(({ value, label, icon: Icon }) => (
              <Button
                key={value}
                variant={currentSettings.themePreference === value ? "default" : "outline"}
                className="flex-1"
                onClick={() => {
                  setTheme(value as "light" | "dark" | "system");
                  updateSettingsMutation.mutate({ themePreference: value });
                }}
                data-testid={`button-theme-${value}`}
              >
                <Icon className="mr-2 h-4 w-4" />
                {label}
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Rows3 className="h-5 w-5" />
            Table Density
          </CardTitle>
          <CardDescription>How tightly packed rows appear in tables across the app</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {TABLE_DENSITY_OPTIONS.map(({ value, label, description }) => (
              <button
                key={value}
                type="button"
                onClick={() => {
                  setTableDensity(value);
                  toast({ title: "Table density updated", description: label });
                }}
                className={`text-left rounded-md border p-3 transition-colors hover-elevate ${tableDensity === value ? "border-primary bg-primary/5" : "border-border"}`}
                data-testid={`button-density-${value.toLowerCase()}`}
              >
                <div className="flex items-center justify-between">
                  <p className="font-medium text-sm">{label}</p>
                  {tableDensity === value && <Check className="h-4 w-4 text-primary" />}
                </div>
                <p className="text-xs text-muted-foreground mt-1">{description}</p>
              </button>
            ))}
          </div>
          <div className="mt-4 rounded-md border overflow-hidden">
            <p className="text-xs text-muted-foreground px-3 py-2 bg-muted/40 border-b">Live preview</p>
            <table className="w-full text-sm" data-testid="table-density-preview">
              <thead className="bg-muted/20">
                <tr className="border-b">
                  {(["Name", "Status", "Updated"]).map((h) => (
                    <th key={h} className={`text-left font-medium text-muted-foreground ${tableDensity === "COMPACT" ? "h-8 px-2" : tableDensity === "COZY" ? "h-10 px-3" : "h-12 px-4"}`}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(["Acme Civil", "Westside Paving", "Hilltop Excavation"]).map((name, i) => (
                  <tr key={name} className="border-b last:border-b-0">
                    {([name, "Active", "Apr 2026"]).map((v, j) => (
                      <td key={j} className={tableDensity === "COMPACT" ? "px-2 py-1" : tableDensity === "COZY" ? "px-3 py-2" : "p-4"}>{v}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Globe className="h-5 w-5" />
            Regional Settings
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label className="text-sm font-medium">Default Landing Page</Label>
            <Select
              value={currentSettings.defaultLandingPage}
              onValueChange={(val) => updateSettingsMutation.mutate({ defaultLandingPage: val })}
            >
              <SelectTrigger className="mt-1" data-testid="select-landing-page">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LANDING_PAGES.map((page) => (
                  <SelectItem key={page.value} value={page.value} data-testid={`select-item-landing-${page.value}`}>
                    {page.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label className="text-sm font-medium">Date Format</Label>
            <Select
              value={currentSettings.dateFormat}
              onValueChange={(val) => updateSettingsMutation.mutate({ dateFormat: val })}
            >
              <SelectTrigger className="mt-1" data-testid="select-date-format">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="MM/DD/YYYY" data-testid="select-item-date-mmddyyyy">MM/DD/YYYY</SelectItem>
                <SelectItem value="DD/MM/YYYY" data-testid="select-item-date-ddmmyyyy">DD/MM/YYYY</SelectItem>
                <SelectItem value="YYYY-MM-DD" data-testid="select-item-date-yyyymmdd">YYYY-MM-DD</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label className="text-sm font-medium">Time Format</Label>
            <Select
              value={currentSettings.timeFormat}
              onValueChange={(val) => updateSettingsMutation.mutate({ timeFormat: val })}
            >
              <SelectTrigger className="mt-1" data-testid="select-time-format">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="12h" data-testid="select-item-time-12h">12-hour (1:30 PM)</SelectItem>
                <SelectItem value="24h" data-testid="select-item-time-24h">24-hour (13:30)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label className="text-sm font-medium">Timezone</Label>
            <Select
              value={currentSettings.timezone || ""}
              onValueChange={(val) => updateSettingsMutation.mutate({ timezone: val })}
            >
              <SelectTrigger className="mt-1" data-testid="select-timezone">
                <SelectValue placeholder="Select timezone" />
              </SelectTrigger>
              <SelectContent>
                {TIMEZONES.map((tz) => (
                  <SelectItem key={tz} value={tz} data-testid={`select-item-tz-${tz}`}>{tz}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Bell className="h-5 w-5" />
            Birthday Digest Delivery
          </CardTitle>
          <CardDescription>
            Choose when you'd like to receive the weekly CRM contact birthday digest. Times are in your local timezone.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label className="text-sm font-medium">Day of Week</Label>
            <Select
              value={String(currentSettings.birthdayDigestWeekday)}
              onValueChange={(val) => updateSettingsMutation.mutate({ birthdayDigestWeekday: parseInt(val, 10) })}
            >
              <SelectTrigger className="mt-1" data-testid="select-birthday-digest-weekday">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {WEEKDAY_OPTIONS.map((d) => (
                  <SelectItem key={d.value} value={String(d.value)} data-testid={`select-item-birthday-weekday-${d.value}`}>
                    {d.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label className="text-sm font-medium">Hour of Day</Label>
            <Select
              value={String(currentSettings.birthdayDigestHour)}
              onValueChange={(val) => updateSettingsMutation.mutate({ birthdayDigestHour: parseInt(val, 10) })}
            >
              <SelectTrigger className="mt-1" data-testid="select-birthday-digest-hour">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {HOUR_OPTIONS.map((h) => (
                  <SelectItem key={h.value} value={String(h.value)} data-testid={`select-item-birthday-hour-${h.value}`}>
                    {h.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-2 pt-2 border-t">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium">Send a test now</p>
                <p className="text-xs text-muted-foreground">
                  Preview your weekly digest immediately. Limited to once every 5 minutes.
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => sendTestBirthdayDigestMutation.mutate()}
                disabled={sendTestBirthdayDigestMutation.isPending}
                data-testid="button-send-test-birthday-digest"
              >
                {sendTestBirthdayDigestMutation.isPending && <Loader2 className="h-3 w-3 mr-2 animate-spin" />}
                Send test digest
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function PeerRatingSettings() {
  const { toast } = useToast();

  const { data: settings, isLoading } = useQuery<{
    peerRatingAnonymityMode: string;
    peerRatingScopeMode: string;
  }>({
    queryKey: ["/api/peer-ratings/settings"],
  });

  const updateMutation = useMutation({
    mutationFn: async (data: Record<string, string>) => {
      return await apiRequest("PATCH", "/api/peer-ratings/settings", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/peer-ratings/settings"] });
      toast({ title: "Peer rating settings updated" });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to update settings", description: err.message, variant: "destructive" });
    },
  });

  if (isLoading) {
    return <Skeleton className="h-48 w-full" />;
  }

  const anonymityMode = settings?.peerRatingAnonymityMode || "fully_anonymous";
  const scopeMode = settings?.peerRatingScopeMode || "project_crew";

  return (
    <Card data-testid="peer-rating-settings-card">
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <Users className="h-5 w-5" />
          Peer Ratings
        </CardTitle>
        <CardDescription>Configure how peer coworker ratings work in your organization</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-2">
          <Label className="text-sm font-medium">Anonymity Mode</Label>
          <Select
            value={anonymityMode}
            onValueChange={(val) => updateMutation.mutate({ peerRatingAnonymityMode: val })}
          >
            <SelectTrigger data-testid="select-peer-anonymity">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="fully_anonymous" data-testid="option-fully-anonymous">Fully Anonymous</SelectItem>
              <SelectItem value="managers_can_see" data-testid="option-managers-can-see">Anonymous but Managers Can See Reviewer</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            {anonymityMode === "fully_anonymous"
              ? "No one can see who left a specific rating, including managers."
              : "Managers and admins can see who submitted each rating."}
          </p>
        </div>

        <div className="space-y-2">
          <Label className="text-sm font-medium">Rating Scope</Label>
          <Select
            value={scopeMode}
            onValueChange={(val) => updateMutation.mutate({ peerRatingScopeMode: val })}
          >
            <SelectTrigger data-testid="select-peer-scope">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="project_crew" data-testid="option-project-crew">Same Project/Crew Only</SelectItem>
              <SelectItem value="org_wide" data-testid="option-org-wide">Organization-Wide</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            {scopeMode === "project_crew"
              ? "Workers can only rate coworkers in the same project or crew."
              : "Workers can rate any coworker in the organization."}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

function OrganizationSection() {
  const { organizationName, user } = useAuth();
  const isManagerOrAdmin = user?.role === "ADMIN" || user?.role === "MANAGER";

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold" data-testid="text-section-title-organization">Organization Settings</h2>
        <p className="text-muted-foreground mt-1">Manage your organization's configuration</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Building2 className="h-5 w-5" />
            Company Profile
          </CardTitle>
          <CardDescription>{organizationName || "Your organization"}</CardDescription>
        </CardHeader>
        <CardContent>
          <Link href="/company-settings">
            <Button variant="outline" data-testid="button-company-settings">
              <Building2 className="mr-2 h-4 w-4" />
              Company Settings
              <ExternalLink className="ml-2 h-4 w-4" />
            </Button>
          </Link>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Users className="h-5 w-5" />
            Team & Roles
          </CardTitle>
          <CardDescription>Manage team members and their permissions</CardDescription>
        </CardHeader>
        <CardContent>
          <Link href="/company-settings?tab=users">
            <Button variant="outline" data-testid="button-team-roles">
              <Users className="mr-2 h-4 w-4" />
              Manage Team
              <ExternalLink className="ml-2 h-4 w-4" />
            </Button>
          </Link>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Shield className="h-5 w-5" />
            Feature Permissions
          </CardTitle>
          <CardDescription>Configure feature-level access for team members</CardDescription>
        </CardHeader>
        <CardContent>
          <Link href="/company-settings?tab=users">
            <Button variant="outline" data-testid="button-feature-permissions">
              <Shield className="mr-2 h-4 w-4" />
              Manage Permissions
              <ExternalLink className="ml-2 h-4 w-4" />
            </Button>
          </Link>
        </CardContent>
      </Card>

      {isManagerOrAdmin && <PeerRatingSettings />}
    </div>
  );
}

interface IntegrationStatus {
  provider: string;
  status: string;
  displayName: string | null;
}

function IntegrationsSection() {
  const { toast } = useToast();
  const [newKeyName, setNewKeyName] = useState("");
  const [justCreatedKey, setJustCreatedKey] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState(false);

  const { data: apiKeys = [], isLoading: loadingKeys } = useQuery<ApiKeyInfo[]>({
    queryKey: ["/api/account/api-keys"],
  });

  const { data: integrations = [] } = useQuery<IntegrationStatus[]>({
    queryKey: ["/api/account/integrations-status"],
  });

  const createKeyMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/account/api-keys", { name: newKeyName });
      return res.json();
    },
    onSuccess: (data: { key: string; name: string; message: string }) => {
      setJustCreatedKey(data.key);
      setNewKeyName("");
      queryClient.invalidateQueries({ queryKey: ["/api/account/api-keys"] });
      toast({ title: "API key created", description: "Copy the key now. It won't be shown again." });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to create API key", description: error.message, variant: "destructive" });
    },
  });

  const deleteKeyMutation = useMutation({
    mutationFn: async (keyId: string) => {
      return await apiRequest("DELETE", `/api/account/api-keys/${keyId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/account/api-keys"] });
      toast({ title: "API key deleted" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to delete API key", description: error.message, variant: "destructive" });
    },
  });

  const handleCopyKey = () => {
    if (justCreatedKey) {
      navigator.clipboard.writeText(justCreatedKey);
      setCopiedKey(true);
      setTimeout(() => setCopiedKey(false), 2000);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold" data-testid="text-section-title-integrations">Integrations & Connected Services</h2>
        <p className="text-muted-foreground mt-1">Manage connected services and API access</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Link2 className="h-5 w-5" />
            Connected Integrations
          </CardTitle>
          <CardDescription>View and manage your connected third-party services</CardDescription>
        </CardHeader>
        <CardContent>
          {integrations.length > 0 ? (
            <div className="space-y-3 mb-4" data-testid="integrations-list">
              {integrations.map((integration, idx) => (
                <div key={idx} className="flex items-center justify-between p-3 border rounded-md" data-testid={`integration-item-${idx}`}>
                  <div>
                    <p className="text-sm font-medium">{integration.displayName || integration.provider}</p>
                    <p className="text-xs text-muted-foreground">{integration.provider}</p>
                  </div>
                  <Badge variant={integration.status === "CONNECTED" ? "default" : "secondary"} className="text-xs">{integration.status}</Badge>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground mb-4" data-testid="text-no-integrations">No integrations connected. Manage integrations from company settings.</p>
          )}
          <Link href="/company-settings?tab=integrations">
            <Button variant="outline" data-testid="button-manage-integrations">
              <Link2 className="mr-2 h-4 w-4" />
              Manage Integrations
              <ExternalLink className="ml-2 h-4 w-4" />
            </Button>
          </Link>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Key className="h-5 w-5" />
            API Keys
          </CardTitle>
          <CardDescription>Generate and manage API keys for external tool access</CardDescription>
        </CardHeader>
        <CardContent>
          {justCreatedKey && (
            <div className="p-3 mb-4 border rounded-md bg-muted/50" data-testid="api-key-created-notice">
              <p className="text-sm font-medium mb-1">Your new API key (copy it now, it won't be shown again):</p>
              <div className="flex items-center gap-2">
                <code className="text-xs bg-background px-2 py-1 rounded border flex-1 break-all" data-testid="text-new-api-key">{justCreatedKey}</code>
                <Button variant="ghost" size="sm" onClick={handleCopyKey} data-testid="button-copy-api-key">
                  {copiedKey ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                </Button>
              </div>
              <Button variant="ghost" size="sm" className="mt-2" onClick={() => setJustCreatedKey(null)} data-testid="button-dismiss-api-key">
                Dismiss
              </Button>
            </div>
          )}

          {loadingKeys ? (
            <Skeleton className="h-12 w-full" />
          ) : (
            <div className="space-y-2 mb-4">
              {apiKeys.length === 0 ? (
                <p className="text-sm text-muted-foreground" data-testid="text-no-api-keys">No API keys created yet</p>
              ) : (
                apiKeys.map((key, idx) => (
                  <div key={idx} className="flex items-center justify-between p-3 border rounded-md" data-testid={`api-key-item-${idx}`}>
                    <div>
                      <p className="text-sm font-medium" data-testid={`text-api-key-name-${idx}`}>{key.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {key.key} &middot; Created {format(new Date(key.createdAt), "MMM d, yyyy")}
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => deleteKeyMutation.mutate(key.id)}
                      disabled={deleteKeyMutation.isPending}
                      data-testid={`button-delete-api-key-${idx}`}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                ))
              )}
            </div>
          )}

          <div className="flex items-center gap-2">
            <Input
              placeholder="Key name (e.g., CI Pipeline)"
              value={newKeyName}
              onChange={(e) => setNewKeyName(e.target.value)}
              maxLength={100}
              data-testid="input-api-key-name"
            />
            <Button
              onClick={() => createKeyMutation.mutate()}
              disabled={createKeyMutation.isPending || !newKeyName.trim()}
              data-testid="button-create-api-key"
            >
              {createKeyMutation.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Plus className="mr-2 h-4 w-4" />
              )}
              Create
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function DataPrivacySection() {
  const { toast } = useToast();
  const [deactivateReason, setDeactivateReason] = useState("");
  const [showDeactivate, setShowDeactivate] = useState(false);

  const { data: activityLogs = [], isLoading: loadingLogs } = useQuery<ActivityLogEntry[]>({
    queryKey: ["/api/activity-log"],
  });

  const exportMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/account/export", { credentials: "include" });
      if (!res.ok) throw new Error("Export failed");
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `account-data-${new Date().toISOString().split("T")[0]}.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    },
    onSuccess: () => {
      toast({ title: "Data exported successfully" });
    },
    onError: (error: Error) => {
      toast({ title: "Export failed", description: error.message, variant: "destructive" });
    },
  });

  const deactivateMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest("POST", "/api/account/deactivation-request", { reason: deactivateReason });
    },
    onSuccess: () => {
      toast({ title: "Deactivation request submitted", description: "An administrator will review your request." });
      setShowDeactivate(false);
      setDeactivateReason("");
    },
    onError: (error: Error) => {
      toast({ title: "Failed to submit request", description: error.message, variant: "destructive" });
    },
  });

  const getActionLabel = (action: string) => {
    const labels: Record<string, string> = {
      LOGIN: "Logged in",
      LOGOUT: "Logged out",
      PASSWORD_CHANGE: "Changed password",
      PROFILE_UPDATE: "Updated profile",
      ACCOUNT_DEACTIVATION_REQUEST: "Requested account deactivation",
      SETTINGS_UPDATE: "Updated settings",
      SESSIONS_REVOKED: "Revoked all sessions",
      "2FA_ENABLED": "Enabled two-factor authentication",
      API_KEY_CREATED: "Created API key",
      API_KEY_DELETED: "Deleted API key",
    };
    return labels[action] || action;
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold" data-testid="text-section-title-data-privacy">Data & Privacy</h2>
        <p className="text-muted-foreground mt-1">Export your data, view activity, and manage your account</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Download className="h-5 w-5" />
            Export Account Data
          </CardTitle>
          <CardDescription>Download a ZIP archive of your personal data including profile, time entries, and certifications</CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            variant="outline"
            onClick={() => exportMutation.mutate()}
            disabled={exportMutation.isPending}
            data-testid="button-export-data"
          >
            {exportMutation.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Download className="mr-2 h-4 w-4" />
            )}
            Export My Data (ZIP)
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Activity className="h-5 w-5" />
            Activity Log
          </CardTitle>
          <CardDescription>Recent account actions and events</CardDescription>
        </CardHeader>
        <CardContent>
          {loadingLogs ? (
            <div className="space-y-2">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : activityLogs.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center" data-testid="text-no-activity">No recent activity</p>
          ) : (
            <ScrollArea className="max-h-80">
              <div className="space-y-2">
                {activityLogs.map((log) => (
                  <div key={log.id} className="flex items-start justify-between p-3 border rounded-md" data-testid={`activity-log-${log.id}`}>
                    <div className="flex items-start gap-3">
                      <Clock className="h-4 w-4 text-muted-foreground mt-0.5 flex-shrink-0" />
                      <div>
                        <p className="text-sm font-medium" data-testid={`text-activity-action-${log.id}`}>{getActionLabel(log.action)}</p>
                        {log.details && <p className="text-xs text-muted-foreground mt-0.5">{log.details}</p>}
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {format(new Date(log.createdAt), "MMM d, yyyy h:mm a")}
                        </p>
                      </div>
                    </div>
                    {log.ipAddress && (
                      <span className="text-xs text-muted-foreground flex-shrink-0" data-testid={`text-activity-ip-${log.id}`}>{log.ipAddress}</span>
                    )}
                  </div>
                ))}
              </div>
            </ScrollArea>
          )}
        </CardContent>
      </Card>

      <Card className="border-destructive/50">
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2 text-destructive">
            <AlertTriangle className="h-5 w-5" />
            Account Deactivation
          </CardTitle>
          <CardDescription>Request to deactivate your account. This will be reviewed by an administrator.</CardDescription>
        </CardHeader>
        <CardContent>
          {!showDeactivate ? (
            <Button
              variant="destructive"
              onClick={() => setShowDeactivate(true)}
              data-testid="button-show-deactivate"
            >
              <AlertTriangle className="mr-2 h-4 w-4" />
              Request Account Deactivation
            </Button>
          ) : (
            <div className="space-y-3">
              <Textarea
                placeholder="Please provide a reason for deactivation (optional)"
                value={deactivateReason}
                onChange={(e) => setDeactivateReason(e.target.value)}
                data-testid="textarea-deactivation-reason"
              />
              <div className="flex gap-2">
                <Button
                  variant="destructive"
                  onClick={() => deactivateMutation.mutate()}
                  disabled={deactivateMutation.isPending}
                  data-testid="button-confirm-deactivate"
                >
                  {deactivateMutation.isPending ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <AlertTriangle className="mr-2 h-4 w-4" />
                  )}
                  Confirm Request
                </Button>
                <Button
                  variant="outline"
                  onClick={() => { setShowDeactivate(false); setDeactivateReason(""); }}
                  data-testid="button-cancel-deactivate"
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function getSectionFromPath(path: string): SectionKey {
  const sectionMap: Record<string, SectionKey> = {
    "/settings/profile": "profile",
    "/settings/security": "security",
    "/settings/notifications": "notifications",
    "/settings/skills": "skills",
    "/settings/preferences": "preferences",
    "/settings/organization": "organization",
    "/settings/integrations": "integrations",
    "/settings/data-privacy": "data-privacy",
  };
  return sectionMap[path] || "profile";
}

export default function SettingsPage() {
  const { user } = useAuth();
  const [location, setLocation] = useLocation();

  if (!user) return null;

  const isAdmin = user.role === "ADMIN";
  const isManager = user.role === "MANAGER";
  const canSeeOrg = isAdmin || isManager;
  const canSeeIntegrations = isAdmin;

  const visibleSections = SECTIONS.filter((s) => {
    if (s.adminOnly) return canSeeIntegrations;
    if (s.managerAccess) return canSeeOrg;
    return true;
  });

  const activeSection = getSectionFromPath(location);
  const validSection = visibleSections.some(s => s.key === activeSection) ? activeSection : "profile";

  const navigateToSection = (key: SectionKey) => {
    if (key === "profile") {
      setLocation("/settings");
    } else {
      setLocation(`/settings/${key}`);
    }
  };

  const renderSection = () => {
    switch (validSection) {
      case "profile":
        return <ProfileEditSection />;
      case "security":
        return <SecuritySection />;
      case "notifications":
        return <NotificationPrefsSection />;
      case "skills":
        return <SkillsSection />;
      case "preferences":
        return <PreferencesSection />;
      case "organization":
        return canSeeOrg ? <OrganizationSection /> : null;
      case "integrations":
        return canSeeIntegrations ? <IntegrationsSection /> : null;
      case "data-privacy":
        return <DataPrivacySection />;
      default:
        return <ProfileEditSection />;
    }
  };

  return (
    <div className="p-4 md:p-8" data-testid="settings-page">
      <div className="mb-6">
        <h1 className="text-3xl font-bold flex items-center gap-2" data-testid="text-settings-title">
          <SettingsIcon className="h-8 w-8 text-primary" />
          Account Settings
        </h1>
        <p className="text-muted-foreground mt-1">Manage your profile, preferences, and account configuration</p>
      </div>

      <div className="flex flex-col md:flex-row gap-6">
        <nav className="w-full md:w-64 flex-shrink-0" data-testid="settings-sidebar">
          <div className="space-y-1">
            {visibleSections.map((section) => {
              const Icon = section.icon;
              const isActive = validSection === section.key;
              return (
                <button
                  key={section.key}
                  type="button"
                  onClick={() => navigateToSection(section.key)}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-colors ${
                    isActive
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted"
                  }`}
                  data-testid={`settings-nav-${section.key}`}
                >
                  <Icon className="h-4 w-4" />
                  {section.label}
                </button>
              );
            })}
          </div>
        </nav>

        <div className="flex-1 min-w-0">
          {renderSection()}
        </div>
      </div>
    </div>
  );
}