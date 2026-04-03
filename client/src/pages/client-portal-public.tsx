import { useState } from "react";
import { useParams } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2, Building2, Image, ClipboardList, CalendarDays, Lock, MessageSquare, FileText, FilePenLine, Receipt } from "lucide-react";
import { PortalLoginForm } from "@/components/client-portal/PortalLoginForm";
import { PortalProgressTab } from "@/components/client-portal/PortalProgressTab";
import { PortalPhotosTab } from "@/components/client-portal/PortalPhotosTab";
import { PortalScheduleTab } from "@/components/client-portal/PortalScheduleTab";
import { PortalDocumentsTab } from "@/components/client-portal/PortalDocumentsTab";
import { PortalChangeOrdersTab } from "@/components/client-portal/PortalChangeOrdersTab";
import { PortalPaymentsTab } from "@/components/client-portal/PortalPaymentsTab";
import { PortalProjectInfo } from "@/components/client-portal/PortalProjectInfo";
import { PortalChatTab, hasChatUnread, getChatUnreadCount } from "@/components/client-portal/PortalChatTab";

interface PortalPermissions {
  viewProgress: boolean;
  viewPhotos: boolean;
  viewSchedule: boolean;
  viewDocuments: boolean;
  viewChangeOrders: boolean;
  viewInvoices: boolean;
  submitRequests: boolean;
}

interface VerifyResponse {
  verified: boolean;
  accessId: string;
  projectName: string;
  projectStatus: string;
  organizationName: string;
  accessType: string;
  name: string;
  permissions: PortalPermissions;
}

interface PortalData {
  project: {
    name: string;
    status: string;
    startDate: string | null;
    endDate: string | null;
    address: string | null;
    city: string | null;
    state: string | null;
  };
  progress?: Array<{
    description: string;
    status: string;
    completionPercentage: number | null;
    updatedAt: string | null;
  }>;
  photos?: Array<{
    id: string;
    fileName: string;
    fileUrl: string | null;
    fileType: string | null;
    description: string | null;
    createdAt: string;
  }>;
  schedule?: Array<{
    name: string;
    startDate: string | null;
    endDate: string | null;
    status: string | null;
    progress: number | null;
  }>;
  documents?: Array<{
    id: string;
    title: string;
    fileName: string;
    fileUrl: string;
    type: string;
    mimeType: string | null;
    fileSize: number | null;
    uploadedAt: string;
  }>;
  changeOrders?: Array<{
    id: string;
    changeOrderNumber: string;
    description: string;
    amount: string;
    status: string;
    submittedAt: string | null;
    approvedAt: string | null;
    clientResponseDueDate: string | null;
    createdAt: string;
    costBreakdown?: {
      labor?: number;
      material?: number;
      equipment?: number;
      subcontractor?: number;
      total?: number;
    } | null;
    attachments?: Array<{
      id: string;
      fileName: string;
      fileType: string | null;
      fileSize: number | null;
    }>;
  }>;
  payments?: Array<{
    id: string;
    invoiceNumber: string;
    invoiceDate: string;
    dueDate: string | null;
    total: string;
    subtotal: string;
    taxAmount: string | null;
    status: string;
    sentAt: string | null;
    paidAt: string | null;
    pdfUrl: string | null;
  }>;
}

const ACCESS_TYPE_LABELS: Record<string, string> = {
  OWNER_REP: "Owner Representative",
  GC_REP: "GC Representative",
  STAKEHOLDER: "Stakeholder",
  VIEWER: "Viewer",
};

export default function ClientPortalPublic({ projectIdOverride }: { projectIdOverride?: string }) {
  const params = useParams<{ projectId: string }>();
  const projectId = projectIdOverride || params.projectId;

  const [email, setEmail] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [accessInfo, setAccessInfo] = useState<VerifyResponse | null>(null);
  const [portalData, setPortalData] = useState<PortalData | null>(null);
  const [loadingData, setLoadingData] = useState(false);

  const clientHeaders: Record<string, string> = {
    "x-client-email": email,
    "x-client-project-id": projectId || "",
  };

  const { data: chatThreads = [] } = useQuery({
    queryKey: ["/api/client-portal/chat/threads", { email, projectId }],
    queryFn: async () => {
      const res = await fetch("/api/client-portal/chat/threads", {
        headers: clientHeaders,
      });
      if (!res.ok) throw new Error("Failed to load chat threads");
      return res.json();
    },
    enabled: !!accessInfo && !!email && !!projectId,
    refetchInterval: 10000,
  });

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;

    setVerifying(true);
    setVerifyError(null);

    try {
      const res = await fetch("/api/ai-features/client-portal/public/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, email: email.trim() }),
      });

      if (!res.ok) {
        const err = await res.json();
        setVerifyError(err.error || "Access denied");
        setVerifying(false);
        return;
      }

      const data: VerifyResponse = await res.json();
      setAccessInfo(data);
      setVerifying(false);

      await refreshPortalData();
    } catch {
      setVerifyError("Something went wrong. Please try again.");
      setVerifying(false);
      setLoadingData(false);
    }
  };

  const refreshPortalData = async () => {
    if (!projectId || !email) return;
    setLoadingData(true);
    try {
      const dataRes = await fetch("/api/ai-features/client-portal/public/data", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, email: email.trim() }),
      });
      if (dataRes.ok) {
        const portalDataResult: PortalData = await dataRes.json();
        setPortalData(portalDataResult);
      }
    } catch {}
    setLoadingData(false);
  };

  if (!accessInfo) {
    return (
      <PortalLoginForm
        email={email}
        setEmail={setEmail}
        verifying={verifying}
        verifyError={verifyError}
        onSubmit={handleVerify}
      />
    );
  }

  if (loadingData) {
    return (
      <div className="min-h-screen bg-muted/30 flex items-center justify-center">
        <div className="text-center space-y-4">
          <Loader2 className="w-10 h-10 animate-spin mx-auto text-primary" />
          <p className="text-muted-foreground">Loading project data...</p>
        </div>
      </div>
    );
  }

  const project = portalData?.project;
  const permissions = accessInfo.permissions;

  const availableTabs: { value: string; label: string; icon: any }[] = [];
  if (permissions.viewProgress) availableTabs.push({ value: "progress", label: "Progress", icon: ClipboardList });
  if (permissions.viewPhotos) availableTabs.push({ value: "photos", label: "Photos", icon: Image });
  if (permissions.viewSchedule) availableTabs.push({ value: "schedule", label: "Schedule", icon: CalendarDays });
  if (permissions.viewDocuments) availableTabs.push({ value: "documents", label: "Documents", icon: FileText });
  if (permissions.viewChangeOrders) availableTabs.push({ value: "change-orders", label: "Change Orders", icon: FilePenLine });
  if (permissions.viewInvoices) availableTabs.push({ value: "payments", label: "Payments", icon: Receipt });
  availableTabs.push({ value: "chat", label: "Messages", icon: MessageSquare });

  return (
    <div className="min-h-screen bg-muted/30">
      <header className="bg-card border-b sticky top-0 z-50">
        <div className="px-4 py-3 flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-primary/10 rounded-lg">
              <Building2 className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h1 className="font-semibold text-lg leading-tight" data-testid="text-portal-project-name">
                {accessInfo.projectName}
              </h1>
              <p className="text-sm text-muted-foreground">
                {accessInfo.organizationName}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="secondary" data-testid="badge-portal-access-type">
              {ACCESS_TYPE_LABELS[accessInfo.accessType] || accessInfo.accessType}
            </Badge>
            <span className="text-sm text-muted-foreground hidden sm:inline">
              {accessInfo.name}
            </span>
          </div>
        </div>
      </header>

      <main className="px-4 py-6 space-y-6">
        {project && <PortalProjectInfo project={project} />}

        {availableTabs.length > 0 ? (
          <Tabs defaultValue={availableTabs[0]?.value} className="space-y-4">
            <TabsList className="flex-wrap h-auto gap-1">
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
                <PortalChangeOrdersTab changeOrders={portalData?.changeOrders} projectId={projectId} email={email} onRefresh={refreshPortalData} />
              </TabsContent>
            )}

            {permissions.viewInvoices && (
              <TabsContent value="payments">
                <PortalPaymentsTab payments={portalData?.payments} />
              </TabsContent>
            )}

            <TabsContent value="chat" data-testid="content-chat">
              <PortalChatTab email={email} projectId={projectId || ""} />
            </TabsContent>
          </Tabs>
        ) : (
          <Card>
            <CardContent className="py-12 text-center">
              <Lock className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
              <p className="text-muted-foreground">
                Your current access level does not include detailed project views.
                Contact your project team for more information.
              </p>
            </CardContent>
          </Card>
        )}

        <footer className="text-center text-xs text-muted-foreground py-4">
          Powered by SmartManageAI Construction Management Platform
        </footer>
      </main>
    </div>
  );
}
