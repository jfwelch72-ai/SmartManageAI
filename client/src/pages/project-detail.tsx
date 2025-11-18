import { useState } from "react";
import AppHeader from "@/components/AppHeader";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import StatusBadge from "@/components/StatusBadge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import FileUploadZone from "@/components/FileUploadZone";
import ScopeOfWorkTable from "@/components/ScopeOfWorkTable";
import DailyNoteFeed from "@/components/DailyNoteFeed";
import MediaGallery from "@/components/MediaGallery";
import { Building2, MapPin, User, Phone, Mail, Calendar, Plus, CheckCircle, XCircle, Clock } from "lucide-react";
import { useLocation, useRoute } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { useProject, useScopeItems, useChangeOrders, useApproveChangeOrder, useRejectChangeOrder, useCreateChangeOrder } from "@/hooks/use-data";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { ChangeOrder } from "@shared/schema";

interface ChangeOrdersTabProps {
  changeOrders: ChangeOrder[];
  projectCode: string;
  projectId: string;
  isLoading: boolean;
  userRole: string;
}

function ChangeOrdersTab({ changeOrders, projectCode, projectId, isLoading, userRole }: ChangeOrdersTabProps) {
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [changeOrderNumber, setChangeOrderNumber] = useState("");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const { toast } = useToast();

  const createMutation = useCreateChangeOrder();
  const approveMutation = useApproveChangeOrder();
  const rejectMutation = useRejectChangeOrder();

  const handleCreate = async () => {
    if (!changeOrderNumber || !description || !amount) {
      toast({ title: "Error", description: "All fields are required", variant: "destructive" });
      return;
    }

    try {
      await createMutation.mutateAsync({
        projectId,
        projectCode,
        changeOrderNumber,
        description,
        amount,
      });
      toast({ title: "Success", description: "Change order created" });
      setShowCreateDialog(false);
      setChangeOrderNumber("");
      setDescription("");
      setAmount("");
    } catch (error) {
      toast({ title: "Error", description: "Failed to create change order", variant: "destructive" });
    }
  };

  const handleApprove = async (id: string) => {
    try {
      await approveMutation.mutateAsync({ id, projectCode });
      toast({ title: "Success", description: "Change order approved" });
    } catch (error) {
      toast({ title: "Error", description: "Failed to approve", variant: "destructive" });
    }
  };

  const handleReject = async (id: string) => {
    const reason = prompt("Rejection reason:");
    if (!reason) return;

    try {
      await rejectMutation.mutateAsync({ id, reason, projectCode });
      toast({ title: "Success", description: "Change order rejected" });
    } catch (error) {
      toast({ title: "Error", description: "Failed to reject", variant: "destructive" });
    }
  };

  const canApprove = ["ADMIN", "MANAGER"].includes(userRole);

  return (
    <TabsContent value="change-orders">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4">
          <CardTitle>Change Orders</CardTitle>
          <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
            <DialogTrigger asChild>
              <Button size="sm" data-testid="button-new-change-order">
                <Plus className="w-4 h-4 mr-2" />
                New Change Order
              </Button>
            </DialogTrigger>
            <DialogContent data-testid="dialog-create-change-order">
              <DialogHeader>
                <DialogTitle>Create Change Order</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div>
                  <Label htmlFor="co-number">Change Order Number</Label>
                  <Input
                    id="co-number"
                    value={changeOrderNumber}
                    onChange={(e) => setChangeOrderNumber(e.target.value)}
                    placeholder="CO-001"
                    data-testid="input-change-order-number"
                  />
                </div>
                <div>
                  <Label htmlFor="co-description">Description</Label>
                  <Textarea
                    id="co-description"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Describe the change..."
                    data-testid="input-change-order-description"
                  />
                </div>
                <div>
                  <Label htmlFor="co-amount">Amount ($)</Label>
                  <Input
                    id="co-amount"
                    type="number"
                    step="0.01"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder="2500.00"
                    data-testid="input-change-order-amount"
                  />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setShowCreateDialog(false)}>
                  Cancel
                </Button>
                <Button
                  onClick={handleCreate}
                  disabled={createMutation.isPending}
                  data-testid="button-submit-change-order"
                >
                  {createMutation.isPending ? "Creating..." : "Create Change Order"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-center py-8 text-muted-foreground">Loading change orders...</div>
          ) : changeOrders.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">No change orders yet</div>
          ) : (
            <div className="space-y-3">
              {changeOrders.map((co) => (
                <Card key={co.id} data-testid={`change-order-${co.id}`}>
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-4 flex-wrap">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-2">
                          <Badge variant="outline" className="font-mono">{co.changeOrderNumber}</Badge>
                          <Badge
                            variant={
                              co.status === "APPROVED" ? "default" :
                              co.status === "REJECTED" ? "destructive" :
                              co.status === "PENDING_APPROVAL" ? "destructive" :
                              "secondary"
                            }
                          >
                            {co.status?.replace("_", " ")}
                          </Badge>
                        </div>
                        <p className="font-medium mb-1">{co.description}</p>
                        <p className="text-sm text-muted-foreground">
                          Created {format(new Date(co.createdAt), "MMM d, yyyy")}
                        </p>
                        {co.rejectionReason && (
                          <p className="text-sm text-destructive mt-2">
                            Rejected: {co.rejectionReason}
                          </p>
                        )}
                      </div>
                      <div className="text-right">
                        <p className="text-xl font-bold font-mono">${parseFloat(co.amount).toLocaleString()}</p>
                        {canApprove && co.status === "PENDING_APPROVAL" && (
                          <div className="flex gap-2 mt-2">
                            <Button
                              size="sm"
                              variant="default"
                              onClick={() => handleApprove(co.id)}
                              disabled={approveMutation.isPending}
                              data-testid={`button-approve-${co.id}`}
                            >
                              <CheckCircle className="w-4 h-4 mr-1" />
                              Approve
                            </Button>
                            <Button
                              size="sm"
                              variant="destructive"
                              onClick={() => handleReject(co.id)}
                              disabled={rejectMutation.isPending}
                              data-testid={`button-reject-${co.id}`}
                            >
                              <XCircle className="w-4 h-4 mr-1" />
                              Reject
                            </Button>
                          </div>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </TabsContent>
  );
}

//todo: remove mock functionality
const mockProject = {
  code: "TFR-240639",
  name: "OSU Outpatient East – Parking Lot",
  clientName: "Ohio State University",
  clientContact: "Dr. Jennifer Martinez",
  clientEmail: "martinez.123@osu.edu",
  clientPhone: "(614) 555-0123",
  status: "ACTIVE" as const,
  location: "421 Medical Center Dr, Columbus, OH 43210",
  startDate: "2024-03-15",
  endDate: "2024-08-30",
  description: "Concrete work for new parking structure and connecting walkways at OSU Medical Center East campus.",
  superintendent: "Mike Johnson",
  estimator: "Sarah Williams",
};

const mockEstimates = [
  {
    id: '1',
    version: 1,
    status: 'WON' as const,
    amount: '$487,500',
    date: '2024-02-10',
  },
];

const mockProcurement = [
  {
    id: '1',
    description: 'Ready-mix concrete 4000 PSI',
    vendor: 'Columbus Concrete Supply',
    quantity: 450,
    unit: 'CY',
    status: 'ORDERED' as const,
  },
  {
    id: '2',
    description: 'Rebar #5 Grade 60',
    vendor: 'Steel Solutions Inc',
    quantity: 12000,
    unit: 'LF',
    status: 'DELIVERED' as const,
  },
];

const mockDocuments = [
  { id: '1', title: 'Site Plans Rev 3.pdf', type: 'PLANS', uploadedBy: 'Sarah Williams', date: '2024-03-01' },
  { id: '2', title: 'Structural Drawings.pdf', type: 'PLANS', uploadedBy: 'Sarah Williams', date: '2024-03-01' },
  { id: '3', title: 'Concrete Specifications.pdf', type: 'SPECS', uploadedBy: 'Mike Johnson', date: '2024-03-05' },
];

const mockScopeItems = [
  { id: '1', description: 'Sidewalk', unit: 'SF', totalQuantity: 5000, completedQuantity: 3200 },
  { id: '2', description: 'Curb', unit: 'LF', totalQuantity: 800, completedQuantity: 650 },
  { id: '3', description: 'Slab on Grade', unit: 'SF', totalQuantity: 12000, completedQuantity: 8500 },
  { id: '4', description: 'Bollards', unit: 'EA', totalQuantity: 24, completedQuantity: 18 },
];

const mockDailyNotes = [
  {
    id: '1',
    author: 'Mike Johnson',
    authorRole: 'Superintendent',
    date: '2024-01-18',
    time: '4:30 PM',
    content: 'Completed 1,200 SF of sidewalk today. Weather was clear. Concrete delivery arrived on time at 8:15 AM. No safety incidents. Crew of 8 performed well.',
  },
  {
    id: '2',
    author: 'Sarah Williams',
    authorRole: 'Project Manager',
    date: '2024-01-17',
    time: '3:15 PM',
    content: 'Met with client rep regarding schedule adjustment for upcoming rain forecast. Agreed to shift curb work to next week. Updated project timeline accordingly.',
  },
];

const mockMediaItems = [
  {
    id: '1',
    type: 'image' as const,
    url: '/placeholder1.jpg',
    caption: 'Foundation excavation complete',
    uploadedBy: 'Mike Johnson',
    uploadedAt: '2024-01-18',
  },
  {
    id: '2',
    type: 'image' as const,
    url: '/placeholder2.jpg',
    caption: 'Concrete pour in progress - Section A',
    uploadedBy: 'Mike Johnson',
    uploadedAt: '2024-01-17',
  },
];

export default function ProjectDetailPage() {
  const [, setLocation] = useLocation();
  const [activeTab, setActiveTab] = useState("overview");
  const [, params] = useRoute("/projects/:code");
  const { user } = useAuth();
  const { toast } = useToast();
  
  const projectCode = params?.code || "";
  const { data: project, isLoading: projectLoading } = useProject(projectCode);
  const { data: scopeItems = [], isLoading: scopeLoading } = useScopeItems(projectCode);
  const { data: changeOrders = [], isLoading: changeOrdersLoading } = useChangeOrders(projectCode);

  if (projectLoading) {
    return (
      <div className="min-h-screen bg-background">
        <AppHeader
          userName={user?.firstName || "User"}
          userRole={user?.role || ""}
          onLogout={() => setLocation('/login')}
        />
        <div className="flex items-center justify-center h-96">
          <div className="text-muted-foreground">Loading project...</div>
        </div>
      </div>
    );
  }

  if (!project) {
    return (
      <div className="min-h-screen bg-background">
        <AppHeader
          userName={user?.firstName || "User"}
          userRole={user?.role || ""}
          onLogout={() => setLocation('/login')}
        />
        <div className="flex flex-col items-center justify-center h-96">
          <p className="text-muted-foreground mb-4">Project not found</p>
          <Button onClick={() => setLocation('/projects')} data-testid="button-back-to-projects">
            Back to Projects
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <AppHeader
        userName={user?.firstName || "User"}
        userRole={user?.role || ""}
        onLogout={() => setLocation('/login')}
      />
      
      <main className="mx-auto max-w-7xl px-6 py-8">
        <div className="mb-6">
          <div className="flex items-center gap-2 mb-3">
            <Button variant="ghost" onClick={() => setLocation('/projects')} data-testid="button-back">
              ← Back to Projects
            </Button>
          </div>
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <div className="flex items-center gap-2 mb-2">
                <Badge variant="outline" className="font-mono">
                  {project.code}
                </Badge>
                <StatusBadge status={project.status} type="project" />
              </div>
              <h1 className="text-2xl font-bold text-foreground">{project.name}</h1>
            </div>
          </div>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
          <TabsList className="w-full justify-start overflow-x-auto">
            <TabsTrigger value="overview" data-testid="tab-overview">Overview</TabsTrigger>
            <TabsTrigger value="scope" data-testid="tab-scope">Scope & Progress</TabsTrigger>
            <TabsTrigger value="change-orders" data-testid="tab-change-orders">
              Change Orders
              {changeOrders.filter(co => co.status === "PENDING_APPROVAL").length > 0 && (
                <Badge className="ml-2" variant="destructive">
                  {changeOrders.filter(co => co.status === "PENDING_APPROVAL").length}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="daily-notes" data-testid="tab-daily-notes">Daily Notes</TabsTrigger>
            <TabsTrigger value="media" data-testid="tab-media">Photos & Videos</TabsTrigger>
            <TabsTrigger value="estimate" data-testid="tab-estimate">Estimate</TabsTrigger>
            <TabsTrigger value="procurement" data-testid="tab-procurement">Procurement</TabsTrigger>
            <TabsTrigger value="plans" data-testid="tab-plans">Plans & Takeoff</TabsTrigger>
            <TabsTrigger value="time" data-testid="tab-time">Time & T&M</TabsTrigger>
            <TabsTrigger value="receipts" data-testid="tab-receipts">Receipts</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <Card>
                <CardHeader>
                  <CardTitle>Project Information</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-start gap-3">
                    <Building2 className="w-5 h-5 text-muted-foreground mt-0.5" />
                    <div>
                      <p className="text-sm font-medium">Client</p>
                      <p className="text-sm text-muted-foreground">{project.clientName || "N/A"}</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <User className="w-5 h-5 text-muted-foreground mt-0.5" />
                    <div>
                      <p className="text-sm font-medium">Contact</p>
                      <p className="text-sm text-muted-foreground">{project.clientContact || "N/A"}</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <Mail className="w-5 h-5 text-muted-foreground mt-0.5" />
                    <div>
                      <p className="text-sm font-medium">Email</p>
                      <p className="text-sm text-muted-foreground">{project.clientEmail || "N/A"}</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <Phone className="w-5 h-5 text-muted-foreground mt-0.5" />
                    <div>
                      <p className="text-sm font-medium">Phone</p>
                      <p className="text-sm text-muted-foreground">{project.clientPhone || "N/A"}</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <MapPin className="w-5 h-5 text-muted-foreground mt-0.5" />
                    <div>
                      <p className="text-sm font-medium">Location</p>
                      <p className="text-sm text-muted-foreground">{project.location || "N/A"}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Project Team & Timeline</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <p className="text-sm font-medium mb-1">Start Date</p>
                    <p className="text-sm text-muted-foreground">
                      {project.startDate ? format(new Date(project.startDate), "MMM d, yyyy") : "Not set"}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm font-medium mb-1">Target End Date</p>
                    <p className="text-sm text-muted-foreground">
                      {project.endDate ? format(new Date(project.endDate), "MMM d, yyyy") : "Not set"}
                    </p>
                  </div>
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader>
                <CardTitle>Description</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">{project.description || "No description provided"}</p>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="scope">
            <Card>
              <CardHeader>
                <CardTitle>Scope of Work & Progress Tracking</CardTitle>
              </CardHeader>
              <CardContent>
                {scopeLoading ? (
                  <div className="text-center py-8 text-muted-foreground">Loading scope items...</div>
                ) : scopeItems.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">No scope items yet</div>
                ) : (
                  <div className="rounded-md border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Description</TableHead>
                          <TableHead>Unit</TableHead>
                          <TableHead className="text-right">Total Qty</TableHead>
                          <TableHead className="text-right">Completed</TableHead>
                          <TableHead className="text-right">Billed</TableHead>
                          <TableHead className="text-right">Remaining</TableHead>
                          <TableHead>Billing Status</TableHead>
                          <TableHead className="text-right">Unit Price</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {scopeItems.map((item) => {
                          const total = parseFloat(item.totalQuantity);
                          const completed = parseFloat(item.completedQuantity || "0");
                          const billed = parseFloat(item.billedQuantity || "0");
                          const remaining = total - completed;
                          const progressPercent = (completed / total) * 100;

                          return (
                            <TableRow key={item.id} data-testid={`row-scope-${item.id}`}>
                              <TableCell className="font-medium">{item.description}</TableCell>
                              <TableCell>{item.unit}</TableCell>
                              <TableCell className="text-right font-mono">{total.toLocaleString()}</TableCell>
                              <TableCell className="text-right font-mono">{completed.toLocaleString()}</TableCell>
                              <TableCell className="text-right font-mono">{billed.toLocaleString()}</TableCell>
                              <TableCell className="text-right font-mono">{remaining.toLocaleString()}</TableCell>
                              <TableCell>
                                <Badge
                                  variant={
                                    item.billingStatus === "BILLED" ? "default" :
                                    item.billingStatus === "READY_TO_BILL" ? "destructive" :
                                    "secondary"
                                  }
                                  data-testid={`badge-billing-${item.id}`}
                                >
                                  {item.billingStatus?.replace("_", " ") || "NOT READY"}
                                </Badge>
                              </TableCell>
                              <TableCell className="text-right font-mono">
                                {item.unitPrice ? `$${parseFloat(item.unitPrice).toFixed(2)}` : "—"}
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <ChangeOrdersTab 
            changeOrders={changeOrders}
            projectCode={projectCode}
            projectId={project.id}
            isLoading={changeOrdersLoading}
            userRole={user?.role || ""}
          />

          <TabsContent value="daily-notes">
            <DailyNoteFeed
              notes={mockDailyNotes}
              onAddNote={(content) => console.log('New daily note:', content)}
            />
          </TabsContent>

          <TabsContent value="media">
            <MediaGallery
              items={mockMediaItems}
              onUpload={(files) => console.log('Media uploaded:', files)}
              onDelete={(id) => console.log('Delete media:', id)}
            />
          </TabsContent>

          <TabsContent value="estimate">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle>Estimates</CardTitle>
                <Button size="sm" data-testid="button-new-estimate">
                  <Plus className="w-4 h-4 mr-2" />
                  New Estimate
                </Button>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {mockEstimates.map(estimate => (
                    <div key={estimate.id} className="flex items-center justify-between p-4 border rounded-md hover-elevate">
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-medium">Version {estimate.version}</span>
                          <StatusBadge status={estimate.status} type="estimate" />
                        </div>
                        <p className="text-sm text-muted-foreground">{estimate.date}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-xl font-bold font-mono">{estimate.amount}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="procurement">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle>Procurement Items</CardTitle>
                <Button size="sm" data-testid="button-new-procurement">
                  <Plus className="w-4 h-4 mr-2" />
                  Add Item
                </Button>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {mockProcurement.map(item => (
                    <div key={item.id} className="flex items-center justify-between p-4 border rounded-md">
                      <div className="flex-1">
                        <p className="font-medium mb-1">{item.description}</p>
                        <p className="text-sm text-muted-foreground">{item.vendor}</p>
                      </div>
                      <div className="flex items-center gap-4">
                        <div className="text-right">
                          <p className="font-mono text-sm">{item.quantity} {item.unit}</p>
                        </div>
                        <StatusBadge status={item.status} type="procurement" />
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="plans">
            <div className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle>Upload Documents</CardTitle>
                </CardHeader>
                <CardContent>
                  <FileUploadZone
                    onFileSelect={(files) => console.log('Files selected:', files)}
                    accept=".pdf,.dwg,.jpg,.png"
                  />
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Documents</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {mockDocuments.map(doc => (
                      <div key={doc.id} className="flex items-center justify-between p-3 border rounded-md hover-elevate">
                        <div>
                          <p className="font-medium text-sm">{doc.title}</p>
                          <p className="text-xs text-muted-foreground">
                            Uploaded by {doc.uploadedBy} on {doc.date}
                          </p>
                        </div>
                        <Badge variant="outline">{doc.type}</Badge>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="time">
            <Card>
              <CardHeader>
                <CardTitle>Time & Material Tracking</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">
                  Time entries and T&M daily sheets will appear here.
                </p>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="receipts">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle>Receipts</CardTitle>
                <Button size="sm" data-testid="button-upload-receipt">
                  <Plus className="w-4 h-4 mr-2" />
                  Upload Receipt
                </Button>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">
                  No receipts uploaded yet.
                </p>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}
