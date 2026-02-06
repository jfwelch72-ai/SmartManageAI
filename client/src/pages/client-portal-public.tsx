import { useState } from "react";
import { useParams } from "wouter";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Progress } from "@/components/ui/progress";
import {
  Loader2,
  Shield,
  Mail,
  Building2,
  Calendar,
  MapPin,
  Image,
  ClipboardList,
  CalendarDays,
  CheckCircle2,
  Clock,
  AlertCircle,
  Lock,
} from "lucide-react";
import { format } from "date-fns";

interface PortalPermissions {
  viewProgress: boolean;
  viewPhotos: boolean;
  viewSchedule: boolean;
  viewDocuments: boolean;
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
}

const ACCESS_TYPE_LABELS: Record<string, string> = {
  OWNER_REP: "Owner Representative",
  GC_REP: "GC Representative",
  STAKEHOLDER: "Stakeholder",
  VIEWER: "Viewer",
};

const STATUS_COLORS: Record<string, string> = {
  COMPLETED: "text-green-600",
  IN_PROGRESS: "text-blue-600",
  NOT_STARTED: "text-muted-foreground",
  DELAYED: "text-red-600",
  ON_HOLD: "text-yellow-600",
};

export default function ClientPortalPublic() {
  const params = useParams<{ projectId: string }>();
  const projectId = params.projectId;

  const [email, setEmail] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [accessInfo, setAccessInfo] = useState<VerifyResponse | null>(null);
  const [portalData, setPortalData] = useState<PortalData | null>(null);
  const [loadingData, setLoadingData] = useState(false);

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

      setLoadingData(true);
      const dataRes = await fetch("/api/ai-features/client-portal/public/data", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, email: email.trim() }),
      });

      if (dataRes.ok) {
        const portalDataResult: PortalData = await dataRes.json();
        setPortalData(portalDataResult);
      }
      setLoadingData(false);
    } catch {
      setVerifyError("Something went wrong. Please try again.");
      setVerifying(false);
      setLoadingData(false);
    }
  };

  if (!accessInfo) {
    return (
      <div className="min-h-screen bg-muted/30 flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <div className="mx-auto mb-4 p-3 bg-primary/10 rounded-full w-fit">
              <Shield className="w-8 h-8 text-primary" />
            </div>
            <CardTitle className="text-2xl">Client Portal</CardTitle>
            <CardDescription>
              Enter your email address to access project information
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleVerify} className="space-y-4">
              <div>
                <Label htmlFor="portal-email">Email Address</Label>
                <div className="relative mt-1">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
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

              {verifyError && (
                <div className="flex items-center gap-2 text-sm text-destructive bg-destructive/10 p-3 rounded-md">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{verifyError}</span>
                </div>
              )}

              <Button
                type="submit"
                className="w-full"
                disabled={verifying || !email.trim()}
                data-testid="button-portal-verify"
              >
                {verifying ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <Lock className="w-4 h-4 mr-2" />
                )}
                Access Portal
              </Button>
            </form>

            <p className="text-xs text-muted-foreground text-center mt-4">
              You must have been invited by your project team to access this portal.
            </p>
          </CardContent>
        </Card>
      </div>
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

  return (
    <div className="min-h-screen bg-muted/30">
      <header className="bg-card border-b sticky top-0 z-50">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between gap-4 flex-wrap">
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

      <main className="max-w-5xl mx-auto px-4 py-6 space-y-6">
        {project && (
          <Card>
            <CardContent className="pt-6">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="flex items-center gap-3">
                  <CheckCircle2 className="w-5 h-5 text-muted-foreground shrink-0" />
                  <div>
                    <p className="text-xs text-muted-foreground">Status</p>
                    <p className="font-medium" data-testid="text-portal-status">
                      {project.status?.replace(/_/g, " ") || "Active"}
                    </p>
                  </div>
                </div>
                {project.startDate && (
                  <div className="flex items-center gap-3">
                    <Calendar className="w-5 h-5 text-muted-foreground shrink-0" />
                    <div>
                      <p className="text-xs text-muted-foreground">Start Date</p>
                      <p className="font-medium">
                        {format(new Date(project.startDate), "MMM d, yyyy")}
                      </p>
                    </div>
                  </div>
                )}
                {project.endDate && (
                  <div className="flex items-center gap-3">
                    <Clock className="w-5 h-5 text-muted-foreground shrink-0" />
                    <div>
                      <p className="text-xs text-muted-foreground">End Date</p>
                      <p className="font-medium">
                        {format(new Date(project.endDate), "MMM d, yyyy")}
                      </p>
                    </div>
                  </div>
                )}
                {(project.address || project.city) && (
                  <div className="flex items-center gap-3">
                    <MapPin className="w-5 h-5 text-muted-foreground shrink-0" />
                    <div>
                      <p className="text-xs text-muted-foreground">Location</p>
                      <p className="font-medium">
                        {[project.address, project.city, project.state]
                          .filter(Boolean)
                          .join(", ")}
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {availableTabs.length > 0 ? (
          <Tabs defaultValue={availableTabs[0]?.value} className="space-y-4">
            <TabsList>
              {availableTabs.map((tab) => {
                const Icon = tab.icon;
                return (
                  <TabsTrigger key={tab.value} value={tab.value} data-testid={`tab-portal-${tab.value}`}>
                    <Icon className="w-4 h-4 mr-2" />
                    {tab.label}
                  </TabsTrigger>
                );
              })}
            </TabsList>

            {permissions.viewProgress && (
              <TabsContent value="progress">
                <Card>
                  <CardHeader>
                    <CardTitle>Scope Progress</CardTitle>
                    <CardDescription>Current status of project scope items</CardDescription>
                  </CardHeader>
                  <CardContent>
                    {portalData?.progress && portalData.progress.length > 0 ? (
                      <ScrollArea className="max-h-[500px]">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Description</TableHead>
                              <TableHead>Status</TableHead>
                              <TableHead>Progress</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {portalData.progress.map((item, idx) => (
                              <TableRow key={idx}>
                                <TableCell className="font-medium">{item.description}</TableCell>
                                <TableCell>
                                  <span className={STATUS_COLORS[item.status] || "text-muted-foreground"}>
                                    {item.status?.replace(/_/g, " ") || "N/A"}
                                  </span>
                                </TableCell>
                                <TableCell>
                                  <div className="flex items-center gap-2 min-w-[120px]">
                                    <Progress value={item.completionPercentage || 0} className="h-2 flex-1" />
                                    <span className="text-sm text-muted-foreground w-10 text-right">
                                      {item.completionPercentage || 0}%
                                    </span>
                                  </div>
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </ScrollArea>
                    ) : (
                      <p className="text-muted-foreground text-center py-8">
                        No progress data available yet.
                      </p>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>
            )}

            {permissions.viewPhotos && (
              <TabsContent value="photos">
                <Card>
                  <CardHeader>
                    <CardTitle>Project Photos</CardTitle>
                    <CardDescription>Recent photos and media from the job site</CardDescription>
                  </CardHeader>
                  <CardContent>
                    {portalData?.photos && portalData.photos.length > 0 ? (
                      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                        {portalData.photos.map((photo) => (
                          <div key={photo.id} className="group relative aspect-square rounded-lg overflow-hidden bg-muted">
                            {photo.fileUrl ? (
                              <img
                                src={photo.fileUrl}
                                alt={photo.description || photo.fileName}
                                className="w-full h-full object-cover"
                              />
                            ) : (
                              <div className="flex items-center justify-center h-full">
                                <Image className="w-8 h-8 text-muted-foreground" />
                              </div>
                            )}
                            <div className="absolute bottom-0 left-0 right-0 bg-black/60 p-2 text-white text-xs opacity-0 group-hover:opacity-100 transition-opacity">
                              {photo.description || photo.fileName}
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-muted-foreground text-center py-8">
                        No photos available yet.
                      </p>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>
            )}

            {permissions.viewSchedule && (
              <TabsContent value="schedule">
                <Card>
                  <CardHeader>
                    <CardTitle>Project Schedule</CardTitle>
                    <CardDescription>Timeline and milestones for this project</CardDescription>
                  </CardHeader>
                  <CardContent>
                    {portalData?.schedule && portalData.schedule.length > 0 ? (
                      <ScrollArea className="max-h-[500px]">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Task</TableHead>
                              <TableHead>Start</TableHead>
                              <TableHead>End</TableHead>
                              <TableHead>Status</TableHead>
                              <TableHead>Progress</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {portalData.schedule.map((task, idx) => (
                              <TableRow key={idx}>
                                <TableCell className="font-medium">{task.name}</TableCell>
                                <TableCell>
                                  {task.startDate
                                    ? format(new Date(task.startDate), "MMM d")
                                    : "TBD"}
                                </TableCell>
                                <TableCell>
                                  {task.endDate
                                    ? format(new Date(task.endDate), "MMM d")
                                    : "TBD"}
                                </TableCell>
                                <TableCell>
                                  <span className={STATUS_COLORS[task.status || ""] || "text-muted-foreground"}>
                                    {task.status?.replace(/_/g, " ") || "Pending"}
                                  </span>
                                </TableCell>
                                <TableCell>
                                  <div className="flex items-center gap-2 min-w-[100px]">
                                    <Progress value={task.progress || 0} className="h-2 flex-1" />
                                    <span className="text-sm text-muted-foreground w-10 text-right">
                                      {task.progress || 0}%
                                    </span>
                                  </div>
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </ScrollArea>
                    ) : (
                      <p className="text-muted-foreground text-center py-8">
                        No schedule data available yet.
                      </p>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>
            )}
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
