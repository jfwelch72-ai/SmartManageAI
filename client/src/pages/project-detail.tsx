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
import { useProject, useScopeItems, useChangeOrders, useApproveChangeOrder, useRejectChangeOrder, useCreateChangeOrder, useProjectNotes, useProjectMedia, useProjectEstimates, useProjectProcurement, useProjectDocuments, useProjectTimeEntries, useProjectTMSheets, useProjectReceipts } from "@/hooks/use-data";
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

export default function ProjectDetailPage() {
  const [, setLocation] = useLocation();
  const [activeTab, setActiveTab] = useState("overview");
  const [, params] = useRoute("/projects/:code");
  const { user, logout } = useAuth();
  const { toast } = useToast();
  
  const projectCode = params?.code || "";
  const { data: project, isLoading: projectLoading } = useProject(projectCode);
  const { data: scopeItems = [], isLoading: scopeLoading } = useScopeItems(projectCode);
  const { data: changeOrders = [], isLoading: changeOrdersLoading } = useChangeOrders(projectCode);
  const { data: projectNotes = [], isLoading: notesLoading } = useProjectNotes(projectCode);
  const { data: mediaItems = [], isLoading: mediaLoading } = useProjectMedia(projectCode);
  const { data: estimates = [], isLoading: estimatesLoading } = useProjectEstimates(projectCode);
  const { data: procurementItems = [], isLoading: procurementLoading } = useProjectProcurement(projectCode);
  const { data: documents = [], isLoading: documentsLoading } = useProjectDocuments(projectCode);
  const { data: timeEntries = [], isLoading: timeEntriesLoading } = useProjectTimeEntries(projectCode);
  const { data: tmSheets = [], isLoading: tmSheetsLoading } = useProjectTMSheets(projectCode);
  const { data: receipts = [], isLoading: receiptsLoading } = useProjectReceipts(projectCode);

  if (projectLoading) {
    return (
      <div className="min-h-screen bg-background">
        <AppHeader
          userName={user?.firstName || "User"}
          userRole={user?.role || ""}
          onLogout={logout}
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
          onLogout={logout}
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
        onLogout={logout}
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
                      <p className="text-sm text-muted-foreground">{project.clientContactName || "N/A"}</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <Mail className="w-5 h-5 text-muted-foreground mt-0.5" />
                    <div>
                      <p className="text-sm font-medium">Email</p>
                      <p className="text-sm text-muted-foreground">{project.clientContactEmail || "N/A"}</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <Phone className="w-5 h-5 text-muted-foreground mt-0.5" />
                    <div>
                      <p className="text-sm font-medium">Phone</p>
                      <p className="text-sm text-muted-foreground">{project.clientContactPhone || "N/A"}</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <MapPin className="w-5 h-5 text-muted-foreground mt-0.5" />
                    <div>
                      <p className="text-sm font-medium">Location</p>
                      <p className="text-sm text-muted-foreground">
                        {[project.locationAddress, project.city, project.state].filter(Boolean).join(", ") || "N/A"}
                      </p>
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
            <Card>
              <CardHeader>
                <CardTitle>Daily Notes</CardTitle>
              </CardHeader>
              <CardContent>
                {notesLoading ? (
                  <div className="text-center py-8 text-muted-foreground">Loading notes...</div>
                ) : projectNotes.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">No daily notes yet</div>
                ) : (
                  <div className="space-y-4">
                    {projectNotes.map((note) => (
                      <Card key={note.id} data-testid={`note-${note.id}`}>
                        <CardContent className="p-4">
                          <div className="flex items-start justify-between gap-4 mb-2">
                            <p className="text-sm font-medium">{note.noteType.replace("_", " ")}</p>
                            <p className="text-xs text-muted-foreground">
                              {format(new Date(note.createdAt), "MMM d, yyyy h:mm a")}
                            </p>
                          </div>
                          <p className="text-sm text-muted-foreground whitespace-pre-wrap">{note.text}</p>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="media">
            <Card>
              <CardHeader>
                <CardTitle>Photos & Videos</CardTitle>
              </CardHeader>
              <CardContent>
                {mediaLoading ? (
                  <div className="text-center py-8 text-muted-foreground">Loading media...</div>
                ) : mediaItems.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">No media uploaded yet</div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {mediaItems.map((item) => (
                      <Card key={item.id} data-testid={`media-${item.id}`}>
                        <CardContent className="p-4">
                          <Badge variant="outline" className="mb-2">{item.type}</Badge>
                          <p className="text-sm font-medium mb-1">{item.caption || "Untitled"}</p>
                          <p className="text-xs text-muted-foreground">
                            {format(new Date(item.uploadedAt), "MMM d, yyyy")}
                          </p>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="estimate">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between gap-4">
                <CardTitle>Estimates</CardTitle>
                <Button size="sm" data-testid="button-new-estimate">
                  <Plus className="w-4 h-4 mr-2" />
                  New Estimate
                </Button>
              </CardHeader>
              <CardContent>
                {estimatesLoading ? (
                  <div className="text-center py-8 text-muted-foreground">Loading estimates...</div>
                ) : estimates.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">No estimates yet</div>
                ) : (
                  <div className="space-y-4">
                    {estimates.map(estimate => (
                      <div key={estimate.id} className="flex items-center justify-between p-4 border rounded-md hover-elevate" data-testid={`estimate-${estimate.id}`}>
                        <div>
                          <div className="flex items-center gap-2 mb-1">
                            <span className="font-medium">Version {estimate.versionNumber}</span>
                            <Badge variant={estimate.status === "WON" ? "default" : "secondary"}>
                              {estimate.status}
                            </Badge>
                          </div>
                          <p className="text-sm text-muted-foreground">
                            {format(new Date(estimate.createdAt), "MMM d, yyyy")}
                          </p>
                          {estimate.notes && (
                            <p className="text-xs text-muted-foreground mt-1">{estimate.notes}</p>
                          )}
                        </div>
                        <div className="text-right">
                          <p className="text-xl font-bold font-mono">
                            {estimate.baseBidAmount ? `$${parseFloat(estimate.baseBidAmount).toLocaleString()}` : "TBD"}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="procurement">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between gap-4">
                <CardTitle>Procurement Items</CardTitle>
                <Button size="sm" data-testid="button-new-procurement">
                  <Plus className="w-4 h-4 mr-2" />
                  Add Item
                </Button>
              </CardHeader>
              <CardContent>
                {procurementLoading ? (
                  <div className="text-center py-8 text-muted-foreground">Loading procurement...</div>
                ) : procurementItems.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">No procurement items yet</div>
                ) : (
                  <div className="space-y-3">
                    {procurementItems.map(item => (
                      <div key={item.id} className="flex items-center justify-between p-4 border rounded-md" data-testid={`procurement-${item.id}`}>
                        <div className="flex-1">
                          <p className="font-medium mb-1">{item.description}</p>
                          <p className="text-sm text-muted-foreground">{item.vendor || "No vendor"}</p>
                        </div>
                        <div className="flex items-center gap-4">
                          <div className="text-right">
                            <p className="font-mono text-sm">
                              {item.quantity} {item.unit}
                            </p>
                          </div>
                          <Badge
                            variant={
                              item.status === "DELIVERED" ? "default" :
                              item.status === "ORDERED" ? "secondary" :
                              "outline"
                            }
                          >
                            {item.status}
                          </Badge>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="plans">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between gap-4">
                <CardTitle>Documents</CardTitle>
                <Button size="sm" data-testid="button-upload-document">
                  <Plus className="w-4 h-4 mr-2" />
                  Upload Document
                </Button>
              </CardHeader>
              <CardContent>
                {documentsLoading ? (
                  <div className="text-center py-8 text-muted-foreground">Loading documents...</div>
                ) : documents.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">No documents uploaded yet</div>
                ) : (
                  <div className="space-y-2">
                    {documents.map(doc => (
                      <div key={doc.id} className="flex items-center justify-between p-3 border rounded-md hover-elevate" data-testid={`document-${doc.id}`}>
                        <div>
                          <p className="font-medium text-sm">{doc.title}</p>
                          <p className="text-xs text-muted-foreground">
                            Uploaded {format(new Date(doc.uploadedAt), "MMM d, yyyy")}
                          </p>
                        </div>
                        <Badge variant="outline">{doc.type}</Badge>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="time">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between gap-4">
                <CardTitle>Time & Material Tracking</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-6">
                  <div>
                    <h3 className="text-lg font-semibold mb-3">Time Entries</h3>
                    {timeEntriesLoading ? (
                      <div className="text-center py-4 text-muted-foreground">Loading time entries...</div>
                    ) : timeEntries.length === 0 ? (
                      <div className="text-center py-4 text-muted-foreground">No time entries yet</div>
                    ) : (
                      <div className="space-y-2">
                        {timeEntries.map((entry) => {
                          const totalHours = parseFloat(entry.hoursRegular) + parseFloat(entry.hoursOvertime || "0");
                          return (
                            <div key={entry.id} className="flex items-center justify-between p-3 border rounded-md" data-testid={`time-entry-${entry.id}`}>
                              <div>
                                <p className="text-sm font-medium">{format(new Date(entry.date), "MMM d, yyyy")}</p>
                                {entry.notes && (
                                  <p className="text-xs text-muted-foreground">{entry.notes}</p>
                                )}
                                {entry.costCode && (
                                  <p className="text-xs text-muted-foreground">Cost Code: {entry.costCode}</p>
                                )}
                              </div>
                              <div className="text-right">
                                <p className="font-mono text-sm">{totalHours} hours</p>
                                <Badge variant={entry.approvedAt ? "default" : "secondary"}>
                                  {entry.approvedAt ? "Approved" : "Pending"}
                                </Badge>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  <div>
                    <h3 className="text-lg font-semibold mb-3">T&M Daily Sheets</h3>
                    {tmSheetsLoading ? (
                      <div className="text-center py-4 text-muted-foreground">Loading T&M sheets...</div>
                    ) : tmSheets.length === 0 ? (
                      <div className="text-center py-4 text-muted-foreground">No T&M sheets yet</div>
                    ) : (
                      <div className="space-y-2">
                        {tmSheets.map((sheet) => (
                          <div key={sheet.id} className="flex items-center justify-between p-3 border rounded-md" data-testid={`tm-sheet-${sheet.id}`}>
                            <div>
                              <p className="text-sm font-medium">{format(new Date(sheet.date), "MMM d, yyyy")}</p>
                              <p className="text-xs text-muted-foreground">TFR Rep: {sheet.tfrRepName}</p>
                              {sheet.clientRepName && (
                                <p className="text-xs text-muted-foreground">Client Rep: {sheet.clientRepName}</p>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="receipts">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between gap-4">
                <CardTitle>Receipts</CardTitle>
                <Button size="sm" data-testid="button-upload-receipt">
                  <Plus className="w-4 h-4 mr-2" />
                  Upload Receipt
                </Button>
              </CardHeader>
              <CardContent>
                {receiptsLoading ? (
                  <div className="text-center py-8 text-muted-foreground">Loading receipts...</div>
                ) : receipts.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">No receipts uploaded yet</div>
                ) : (
                  <div className="space-y-3">
                    {receipts.map((receipt) => (
                      <div key={receipt.id} className="flex items-center justify-between p-4 border rounded-md" data-testid={`receipt-${receipt.id}`}>
                        <div className="flex-1">
                          <p className="font-medium mb-1">{receipt.vendor || "Unknown vendor"}</p>
                          <p className="text-sm text-muted-foreground">{receipt.category}</p>
                          <p className="text-xs text-muted-foreground">
                            {format(new Date(receipt.date), "MMM d, yyyy")}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="text-lg font-bold font-mono">
                            ${parseFloat(receipt.amount).toLocaleString()}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}
