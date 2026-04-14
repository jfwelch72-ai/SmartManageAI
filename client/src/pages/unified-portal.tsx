import { useState, useMemo, lazy, Suspense } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { useQuery } from "@tanstack/react-query";
import { isVendor } from "@/lib/rbac";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Building2,
  Shield,
  Package,
  Users,
  Loader2,
  LayoutDashboard,
  DollarSign,
  MessageSquare,
  FileText,
  LogOut,
  Image,
  ClipboardList,
  CalendarDays,
  FilePenLine,
  Receipt,
  FolderOpen,
  Send,
  Lock,
  Mail,
} from "lucide-react";
import { PortalProgressTab } from "@/components/client-portal/PortalProgressTab";
import { PortalPhotosTab } from "@/components/client-portal/PortalPhotosTab";
import { PortalScheduleTab } from "@/components/client-portal/PortalScheduleTab";
import { PortalDocumentsTab } from "@/components/client-portal/PortalDocumentsTab";
import { PortalChangeOrdersTab } from "@/components/client-portal/PortalChangeOrdersTab";
import { PortalPaymentsTab } from "@/components/client-portal/PortalPaymentsTab";
import { PortalProjectInfo } from "@/components/client-portal/PortalProjectInfo";
import { PortalChatTab, hasChatUnread, getChatUnreadCount } from "@/components/client-portal/PortalChatTab";
import { SubPortalRfiTab } from "@/components/sub-portal/SubPortalRfiTab";
import { SubPortalSubmittalTab } from "@/components/sub-portal/SubPortalSubmittalTab";
import { SubPortalTransmittalTab } from "@/components/sub-portal/SubPortalTransmittalTab";
import { SubPortalChatTab } from "@/components/sub-portal/SubPortalChatTab";

const VendorDashboard = lazy(() => import("@/pages/vendor/index"));
const VendorPricing = lazy(() => import("@/pages/vendor/pricing"));
const VendorClients = lazy(() => import("@/pages/vendor/clients"));
const VendorMessages = lazy(() => import("@/pages/vendor/messages"));
const VendorDocuments = lazy(() => import("@/pages/vendor/documents"));

type PortalRole = "client" | "subcontractor" | "vendor";

interface PortalSession {
  role: PortalRole;
  data: any;
}

const VALID_VENDOR_TABS = ["dashboard", "pricing", "clients", "messages", "documents"] as const;
const ACCESS_TYPE_LABELS: Record<string, string> = {
  OWNER_REP: "Owner Representative",
  GC_REP: "GC Representative",
  STAKEHOLDER: "Stakeholder",
  VIEWER: "Viewer",
};

function LoadingFallback() {
  return (
    <div className="min-h-screen flex items-center justify-center" data-testid="portal-loading">
      <div className="flex flex-col items-center gap-3">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        <p className="text-sm text-muted-foreground">Loading portal...</p>
      </div>
    </div>
  );
}

export default function UnifiedPortal() {
  const { user, isLoading } = useAuth();
  const [, navigate] = useLocation();

  const searchParams = useMemo(() => new URLSearchParams(window.location.search), []);
  const token = searchParams.get("token");
  const projectId = searchParams.get("projectId");
  const tab = searchParams.get("tab");

  const [portalSession, setPortalSession] = useState<PortalSession | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);

  const [clientEmail, setClientEmail] = useState("");
  const [clientVerifying, setClientVerifying] = useState(false);

  const brandingProjectId = projectId || null;
  const { data: portalBranding } = useQuery<{
    organizationName: string | null;
    logoUrl: string | null;
    primaryColor: string | null;
    accentColor: string | null;
  }>({
    queryKey: ["/api/portal/branding", brandingProjectId],
    queryFn: async () => {
      if (!brandingProjectId) return { organizationName: null, logoUrl: null, primaryColor: null, accentColor: null };
      const res = await fetch(`/api/portal/branding?projectId=${encodeURIComponent(brandingProjectId)}`);
      if (!res.ok) return { organizationName: null, logoUrl: null, primaryColor: null, accentColor: null };
      return res.json();
    },
    enabled: !!brandingProjectId,
    staleTime: 5 * 60 * 1000,
  });

  if (isLoading) return <LoadingFallback />;

  if (tab && !user && !token && !projectId) {
    navigate(`/login?redirect=${encodeURIComponent(window.location.pathname + window.location.search)}`, { replace: true });
    return <LoadingFallback />;
  }

  const detectedRole: PortalRole | null = token
    ? "subcontractor"
    : projectId
    ? "client"
    : user && isVendor(user.role)
    ? "vendor"
    : null;

  if (!detectedRole) {
    return <PortalLanding />;
  }

  if (detectedRole === "subcontractor" && !portalSession) {
    return (
      <SubPortalAuth
        token={token!}
        onSuccess={(session) => setPortalSession(session)}
        onError={(err) => setAuthError(err)}
        error={authError}
      />
    );
  }

  if (detectedRole === "client" && !portalSession) {
    return (
      <ClientPortalAuth
        projectId={projectId!}
        email={clientEmail}
        setEmail={setClientEmail}
        verifying={clientVerifying}
        error={authError}
        branding={portalBranding || null}
        onSubmit={async () => {
          if (!clientEmail.trim()) return;
          setClientVerifying(true);
          setAuthError(null);
          try {
            const res = await fetch("/api/portal/auth/resolve", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ type: "client", email: clientEmail.trim(), projectId }),
            });
            if (!res.ok) {
              const err = await res.json();
              setAuthError(err.error || "Access denied");
              setClientVerifying(false);
              return;
            }
            const result = await res.json();
            setPortalSession(result);
            setClientVerifying(false);
          } catch {
            setAuthError("Something went wrong. Please try again.");
            setClientVerifying(false);
          }
        }}
      />
    );
  }

  if (detectedRole === "vendor" && !portalSession) {
    return (
      <VendorPortalAuth
        onSuccess={(session) => setPortalSession(session)}
        onError={(err) => setAuthError(err)}
        error={authError}
      />
    );
  }

  if (!portalSession) return <LoadingFallback />;

  return (
    <PortalShell session={portalSession} token={token} projectId={projectId} email={clientEmail} />
  );
}

function PortalHeader({ session, onLogout }: { session: PortalSession; onLogout?: () => void }) {
  const roleLabels: Record<PortalRole, string> = {
    client: "Client",
    subcontractor: "Subcontractor",
    vendor: "Vendor",
  };

  const roleIcons: Record<PortalRole, typeof Building2> = {
    client: Building2,
    subcontractor: Shield,
    vendor: Package,
  };

  const RoleIcon = roleIcons[session.role];
  const sessionBranding: PortalBranding | null = session.data.branding || null;

  let subtitle = "";
  let userName = "";
  if (session.role === "client") {
    subtitle = session.data.organizationName || "";
    userName = session.data.name || "";
  } else if (session.role === "subcontractor") {
    subtitle = session.data.project?.name || "";
    userName = session.data.contactName || "";
  } else if (session.role === "vendor") {
    subtitle = session.data.organizationName || "";
    userName = session.data.fullName || "";
  }

  const headerOrgName = sessionBranding?.organizationName || subtitle;

  return (
    <header className="bg-card border-b sticky top-0 z-50" data-testid="header-portal">
      <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          {sessionBranding?.logoUrl ? (
            <img
              src={sessionBranding.logoUrl}
              alt={headerOrgName || "Organization"}
              className="h-8 max-w-[120px] object-contain"
              data-testid="img-portal-header-logo"
            />
          ) : (
            <div className="p-2 bg-primary/10 rounded-lg">
              <RoleIcon className="w-5 h-5 text-primary" />
            </div>
          )}
          <div>
            <h1 className="font-semibold text-lg leading-tight" data-testid="text-portal-title">
              {headerOrgName || "External Portal"}
            </h1>
            {subtitle && subtitle !== headerOrgName && (
              <p className="text-sm text-muted-foreground" data-testid="text-portal-subtitle">
                {subtitle}
              </p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="secondary" data-testid="badge-portal-role">
            {roleLabels[session.role]}
          </Badge>
          {session.role === "client" && session.data.accessType && (
            <Badge variant="outline" data-testid="badge-portal-access-type">
              {ACCESS_TYPE_LABELS[session.data.accessType] || session.data.accessType}
            </Badge>
          )}
          {userName && (
            <span className="text-sm text-muted-foreground hidden sm:inline" data-testid="text-portal-user">
              {userName}
            </span>
          )}
          {session.role === "subcontractor" && (
            <Badge
              variant="outline"
              className="bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-300"
              data-testid="badge-secure-access"
            >
              <Shield className="h-3 w-3 mr-1" />
              Secure Access
            </Badge>
          )}
          {onLogout && (
            <Button variant="ghost" size="sm" onClick={onLogout} data-testid="button-logout">
              <LogOut className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>
    </header>
  );
}

function PortalShell({
  session,
  token,
  projectId,
  email,
}: {
  session: PortalSession;
  token: string | null;
  projectId: string | null;
  email: string;
}) {
  const { logout } = useAuth();

  return (
    <div className="min-h-screen bg-muted/30" data-testid="container-portal">
      <PortalHeader
        session={session}
        onLogout={session.role === "vendor" ? () => logout() : undefined}
      />

      <main className="max-w-6xl mx-auto px-4 py-6">
        {session.role === "client" && (
          <ClientPortalContent session={session} projectId={projectId!} email={email} />
        )}
        {session.role === "subcontractor" && (
          <SubPortalContent session={session} token={token!} />
        )}
        {session.role === "vendor" && <VendorPortalContent />}
      </main>

      <footer className="text-center text-xs text-muted-foreground py-4">
        Powered by SmartManageAI Construction Management Platform
      </footer>
    </div>
  );
}

function ClientPortalContent({
  session,
  projectId,
  email,
}: {
  session: PortalSession;
  projectId: string;
  email: string;
}) {
  const clientHeaders: Record<string, string> = {
    "x-client-email": email,
    "x-client-project-id": projectId,
  };

  const { data: portalData, isLoading: loadingData, refetch: refetchPortalData } = useQuery({
    queryKey: ["/api/ai-features/client-portal/public/data", { projectId, email }],
    queryFn: async () => {
      const dataRes = await fetch("/api/ai-features/client-portal/public/data", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, email: email.trim() }),
      });
      if (!dataRes.ok) throw new Error("Failed to load portal data");
      return dataRes.json();
    },
    enabled: !!email && !!projectId,
  });

  const { data: chatThreads = [] } = useQuery({
    queryKey: ["/api/client-portal/chat/threads", { email, projectId }],
    queryFn: async () => {
      const res = await fetch("/api/client-portal/chat/threads", { headers: clientHeaders });
      if (!res.ok) throw new Error("Failed to load chat threads");
      return res.json();
    },
    enabled: !!email && !!projectId,
    refetchInterval: 60000,
  });

  if (loadingData) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const permissions = session.data.permissions;
  const project = portalData?.project;

  const availableTabs: { value: string; label: string; icon: any }[] = [];
  if (permissions.viewProgress) availableTabs.push({ value: "progress", label: "Progress", icon: ClipboardList });
  if (permissions.viewPhotos) availableTabs.push({ value: "photos", label: "Photos", icon: Image });
  if (permissions.viewSchedule) availableTabs.push({ value: "schedule", label: "Schedule", icon: CalendarDays });
  if (permissions.viewDocuments) availableTabs.push({ value: "documents", label: "Documents", icon: FileText });
  if (permissions.viewChangeOrders) availableTabs.push({ value: "change-orders", label: "Change Orders", icon: FilePenLine });
  if (permissions.viewInvoices) availableTabs.push({ value: "payments", label: "Payments", icon: Receipt });
  availableTabs.push({ value: "chat", label: "Messages", icon: MessageSquare });

  if (availableTabs.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <Lock className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
          <p className="text-muted-foreground">
            Your current access level does not include detailed project views.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {project && <PortalProjectInfo project={project} />}

      <Tabs defaultValue={availableTabs[0]?.value} className="space-y-4">
        <TabsList className="flex-wrap h-auto gap-1" data-testid="tabs-client-nav">
          {availableTabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <TabsTrigger key={tab.value} value={tab.value} data-testid={`tab-portal-${tab.value}`}>
                <Icon className="w-4 h-4 mr-2" />
                {tab.label}
                {tab.value === "chat" && hasChatUnread(chatThreads) && (
                  <span className="ml-1 inline-flex items-center justify-center h-4 min-w-[1rem] rounded-full bg-destructive text-destructive-foreground text-xs px-1">
                    {getChatUnreadCount(chatThreads)}
                  </span>
                )}
              </TabsTrigger>
            );
          })}
        </TabsList>

        {permissions.viewProgress && (
          <TabsContent value="progress">
            <PortalProgressTab progress={portalData?.progress} />
          </TabsContent>
        )}
        {permissions.viewPhotos && (
          <TabsContent value="photos">
            <PortalPhotosTab photos={portalData?.photos} />
          </TabsContent>
        )}
        {permissions.viewSchedule && (
          <TabsContent value="schedule">
            <PortalScheduleTab schedule={portalData?.schedule} />
          </TabsContent>
        )}
        {permissions.viewDocuments && (
          <TabsContent value="documents">
            <PortalDocumentsTab documents={portalData?.documents} />
          </TabsContent>
        )}
        {permissions.viewChangeOrders && (
          <TabsContent value="change-orders">
            <PortalChangeOrdersTab
              changeOrders={portalData?.changeOrders}
              projectId={projectId}
              email={email}
              onRefresh={() => refetchPortalData()}
            />
          </TabsContent>
        )}
        {permissions.viewInvoices && (
          <TabsContent value="payments">
            <PortalPaymentsTab payments={portalData?.payments} />
          </TabsContent>
        )}
        <TabsContent value="chat" data-testid="content-chat">
          <PortalChatTab email={email} projectId={projectId} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function SubPortalContent({ session, token }: { session: PortalSession; token: string }) {
  const { data: rfis = [], isLoading: rfisLoading } = useQuery({
    queryKey: ["/api/portal/rfis", { token }],
    queryFn: async () => {
      const res = await fetch(`/api/portal/rfis?token=${token}`);
      if (!res.ok) throw new Error("Failed to load RFIs");
      return res.json();
    },
  });

  const { data: submittals = [], isLoading: submittalsLoading } = useQuery({
    queryKey: ["/api/portal/submittals", { token }],
    queryFn: async () => {
      const res = await fetch(`/api/portal/submittals?token=${token}`);
      if (!res.ok) throw new Error("Failed to load submittals");
      return res.json();
    },
  });

  const { data: transmittals = [], isLoading: transmittalsLoading } = useQuery({
    queryKey: ["/api/portal/transmittals", { token }],
    queryFn: async () => {
      const res = await fetch(`/api/portal/transmittals?token=${token}`);
      if (!res.ok) throw new Error("Failed to load transmittals");
      return res.json();
    },
  });

  const { data: chatThreads = [], isLoading: chatLoading } = useQuery({
    queryKey: ["/api/portal/chat/threads", { token }],
    queryFn: async () => {
      const res = await fetch(`/api/portal/chat/threads`, {
        headers: { "x-portal-token": token },
      });
      if (!res.ok) throw new Error("Failed to load chat threads");
      return res.json();
    },
    refetchInterval: 60000,
  });

  return (
    <Tabs defaultValue="rfis" data-testid="tabs-portal">
      <TabsList className="flex-wrap h-auto gap-1" data-testid="tabs-sub-nav">
        <TabsTrigger value="rfis" data-testid="tab-rfis">
          <FileText className="h-4 w-4 mr-1.5" />
          RFIs
        </TabsTrigger>
        <TabsTrigger value="submittals" data-testid="tab-submittals">
          <FolderOpen className="h-4 w-4 mr-1.5" />
          Submittals
        </TabsTrigger>
        <TabsTrigger value="transmittals" data-testid="tab-transmittals">
          <Send className="h-4 w-4 mr-1.5" />
          Transmittals
        </TabsTrigger>
        <TabsTrigger value="chat" data-testid="tab-chat">
          <MessageSquare className="h-4 w-4 mr-1.5" />
          Chat
          {chatThreads.some((t: any) => t.portalUnreadCount > 0) && (
            <span className="ml-1 inline-flex items-center justify-center h-4 min-w-[1rem] rounded-full bg-destructive text-destructive-foreground text-xs px-1">
              {chatThreads.reduce((sum: number, t: any) => sum + (t.portalUnreadCount || 0), 0)}
            </span>
          )}
        </TabsTrigger>
      </TabsList>

      <TabsContent value="rfis" data-testid="content-rfis">
        <SubPortalRfiTab rfis={rfis} rfisLoading={rfisLoading} token={token} />
      </TabsContent>
      <TabsContent value="submittals" data-testid="content-submittals">
        <SubPortalSubmittalTab submittals={submittals} submittalsLoading={submittalsLoading} token={token} />
      </TabsContent>
      <TabsContent value="transmittals" data-testid="content-transmittals">
        <SubPortalTransmittalTab transmittals={transmittals} transmittalsLoading={transmittalsLoading} token={token} />
      </TabsContent>
      <TabsContent value="chat" data-testid="content-chat">
        <SubPortalChatTab token={token} chatThreads={chatThreads} chatLoading={chatLoading} />
      </TabsContent>
    </Tabs>
  );
}

function VendorPortalContent() {
  const searchParams = useMemo(() => new URLSearchParams(window.location.search), []);
  const rawTab = searchParams.get("tab") || "dashboard";
  const initialTab = (VALID_VENDOR_TABS as readonly string[]).includes(rawTab) ? rawTab : "dashboard";
  const [activeTab, setActiveTab] = useState(initialTab);

  return (
    <>
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="flex-wrap h-auto gap-1 mb-4" data-testid="tabs-vendor-nav">
          <TabsTrigger value="dashboard" data-testid="tab-vendor-dashboard">
            <LayoutDashboard className="w-4 h-4 mr-2" />
            Dashboard
          </TabsTrigger>
          <TabsTrigger value="pricing" data-testid="tab-vendor-pricing">
            <DollarSign className="w-4 h-4 mr-2" />
            Pricing
          </TabsTrigger>
          <TabsTrigger value="clients" data-testid="tab-vendor-clients">
            <Users className="w-4 h-4 mr-2" />
            Clients
          </TabsTrigger>
          <TabsTrigger value="messages" data-testid="tab-vendor-messages">
            <MessageSquare className="w-4 h-4 mr-2" />
            Messages
          </TabsTrigger>
          <TabsTrigger value="documents" data-testid="tab-vendor-documents">
            <FileText className="w-4 h-4 mr-2" />
            Documents
          </TabsTrigger>
        </TabsList>
      </Tabs>
      <Suspense fallback={<LoadingFallback />}>
        {activeTab === "dashboard" && <VendorDashboard />}
        {activeTab === "pricing" && <VendorPricing />}
        {activeTab === "clients" && <VendorClients />}
        {activeTab === "messages" && <VendorMessages />}
        {activeTab === "documents" && <VendorDocuments />}
      </Suspense>
    </>
  );
}

function SubPortalAuth({
  token,
  onSuccess,
  onError,
  error,
}: {
  token: string;
  onSuccess: (session: PortalSession) => void;
  onError: (err: string) => void;
  error: string | null;
}) {
  const { isLoading, isError } = useQuery({
    queryKey: ["/api/portal/auth/resolve", "subcontractor", token],
    queryFn: async () => {
      const res = await fetch("/api/portal/auth/resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "subcontractor", token }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Invalid token");
      }
      const result = await res.json();
      onSuccess(result);
      return result;
    },
    retry: false,
  });

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background" data-testid="container-loading">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          <p className="text-muted-foreground text-sm">Validating access...</p>
        </div>
      </div>
    );
  }

  if (isError || error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4" data-testid="container-invalid-token">
        <Card className="max-w-md w-full">
          <CardHeader className="text-center">
            <div className="mx-auto mb-4">
              <Shield className="h-12 w-12 text-destructive" />
            </div>
            <CardTitle className="text-xl">Access Denied</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground text-center text-sm" data-testid="text-invalid-token-message">
              Your access link has expired or been revoked. Please contact your
              general contractor for a new invitation.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return <LoadingFallback />;
}

function VendorPortalAuth({
  onSuccess,
  onError,
  error,
}: {
  onSuccess: (session: PortalSession) => void;
  onError: (err: string) => void;
  error: string | null;
}) {
  const { isLoading, isError } = useQuery({
    queryKey: ["/api/portal/auth/resolve", "vendor"],
    queryFn: async () => {
      const res = await fetch("/api/portal/auth/resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ type: "vendor" }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Vendor authentication failed");
      }
      const result = await res.json();
      onSuccess(result);
      return result;
    },
    retry: false,
  });

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background" data-testid="container-loading">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          <p className="text-muted-foreground text-sm">Verifying vendor access...</p>
        </div>
      </div>
    );
  }

  if (isError || error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4" data-testid="container-vendor-auth-error">
        <Card className="max-w-md w-full">
          <CardHeader className="text-center">
            <div className="mx-auto mb-4">
              <Package className="h-12 w-12 text-destructive" />
            </div>
            <CardTitle className="text-xl">Access Denied</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground text-center text-sm" data-testid="text-vendor-auth-error">
              Unable to verify vendor access. Please ensure you are logged in with a vendor account.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return <LoadingFallback />;
}

interface PortalBranding {
  organizationName: string | null;
  logoUrl: string | null;
  primaryColor: string | null;
  accentColor: string | null;
}

function PortalBrandingHeader({ branding, fallbackTitle }: { branding: PortalBranding | null; fallbackTitle: string }) {
  const hasLogo = branding?.logoUrl;
  const orgName = branding?.organizationName;

  return (
    <>
      {hasLogo ? (
        <div className="mx-auto mb-3 flex items-center justify-center">
          <img
            src={branding.logoUrl!}
            alt={orgName || "Organization Logo"}
            className="max-h-16 max-w-[200px] object-contain"
            data-testid="img-portal-org-logo"
          />
        </div>
      ) : (
        <div
          className="mx-auto w-12 h-12 rounded-lg flex items-center justify-center mb-3"
          style={{ backgroundColor: branding?.primaryColor ? `${branding.primaryColor}15` : undefined }}
          data-testid="icon-portal-fallback"
        >
          <Shield
            className="w-6 h-6"
            style={{ color: branding?.primaryColor || undefined }}
          />
        </div>
      )}
      {orgName && (
        <p className="text-sm font-medium text-muted-foreground mb-1" data-testid="text-portal-org-name">{orgName}</p>
      )}
      <CardTitle className="text-xl" data-testid="text-client-login-title">{fallbackTitle}</CardTitle>
    </>
  );
}

function ClientPortalAuth({
  projectId,
  email,
  setEmail,
  verifying,
  error,
  onSubmit,
  branding,
}: {
  projectId: string;
  email: string;
  setEmail: (email: string) => void;
  verifying: boolean;
  error: string | null;
  onSubmit: () => void;
  branding: PortalBranding | null;
}) {
  const accentColor = branding?.accentColor || branding?.primaryColor || null;

  return (
    <div className="min-h-screen bg-muted/30 flex items-center justify-center p-4" data-testid="container-client-login">
      <Card className="max-w-md w-full">
        <CardHeader className="text-center">
          <PortalBrandingHeader branding={branding} fallbackTitle="Client Portal" />
          <CardDescription>Enter your email address to access project information</CardDescription>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              onSubmit();
            }}
            className="space-y-4"
          >
            <div className="space-y-2">
              <Label htmlFor="portal-email">Email Address</Label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  id="portal-email"
                  type="email"
                  placeholder="your@email.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="pl-10"
                  required
                  data-testid="input-portal-email"
                />
              </div>
            </div>
            {error && (
              <p className="text-sm text-destructive text-center" data-testid="text-verify-error">
                {error}
              </p>
            )}
            <Button
              type="submit"
              className="w-full"
              disabled={verifying || !email.trim()}
              style={accentColor ? { backgroundColor: accentColor, borderColor: accentColor } : undefined}
              data-testid="button-access-portal"
            >
              {verifying ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <Lock className="h-4 w-4 mr-2" />
              )}
              Access Portal
            </Button>
            <p className="text-xs text-muted-foreground text-center">
              You must have been invited by your project team to access this portal.
            </p>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

function PortalLanding() {
  return (
    <div className="min-h-screen bg-muted/30 flex items-center justify-center p-4" data-testid="container-portal-landing">
      <div className="max-w-2xl w-full space-y-6">
        <div className="text-center space-y-2">
          <div className="mx-auto w-12 h-12 bg-primary/10 rounded-lg flex items-center justify-center mb-4">
            <Shield className="w-6 h-6 text-primary" />
          </div>
          <h1 className="text-2xl font-bold" data-testid="text-landing-title">External Portal</h1>
          <p className="text-muted-foreground" data-testid="text-landing-description">
            Access your project information, documents, and communications.
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <Card className="text-center" data-testid="card-client-info">
            <CardHeader>
              <Building2 className="w-8 h-8 mx-auto text-primary mb-2" />
              <CardTitle className="text-base">Client Portal</CardTitle>
              <CardDescription className="text-sm">
                View project progress, photos, documents, and more.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-muted-foreground">
                Access via the link provided by your contractor.
              </p>
            </CardContent>
          </Card>

          <Card className="text-center" data-testid="card-subcontractor-info">
            <CardHeader>
              <Shield className="w-8 h-8 mx-auto text-primary mb-2" />
              <CardTitle className="text-base">Subcontractor Portal</CardTitle>
              <CardDescription className="text-sm">
                Manage RFIs, submittals, and communications.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-muted-foreground">
                Use the secure link from your invitation email.
              </p>
            </CardContent>
          </Card>

          <Card className="text-center" data-testid="card-vendor-info">
            <CardHeader>
              <Package className="w-8 h-8 mx-auto text-primary mb-2" />
              <CardTitle className="text-base">Vendor Portal</CardTitle>
              <CardDescription className="text-sm">
                Manage pricing, clients, and documents.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-muted-foreground">
                Log in with your vendor account credentials.
              </p>
            </CardContent>
          </Card>
        </div>

        <p className="text-center text-xs text-muted-foreground">
          Powered by SmartManageAI Construction Management Platform
        </p>
      </div>
    </div>
  );
}
