import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { useIsMobile } from "@/hooks/use-mobile";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  HelpCircle, Plus, Eye, CheckCircle2, XCircle, AlertTriangle, Clock,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";
import {
  useRfiMutations, getStatusBadge, getPriorityBadge, isRfiOverdue, DEFAULT_CREATE_FORM,
  type RFI, type RFIStats, type RFICreateForm,
} from "@/hooks/useRfiMutations";
import RfiDetailDialog from "@/components/document-control/RfiDetailDialog";
import RfiCreateFields from "@/components/document-control/RfiCreateFields";
import DocumentAttachments from "@/components/DocumentAttachments";

interface Project { id: string; code: string; name: string; clientName: string; }
interface Subcontractor { id: string; companyName: string; }

export default function RFIsPage() {
  const { user } = useAuth();
  const isMobile = useIsMobile();
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showDetailDialog, setShowDetailDialog] = useState(false);
  const [selectedRFI, setSelectedRFI] = useState<RFI | null>(null);
  const [filterProject, setFilterProject] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterPriority, setFilterPriority] = useState("all");
  const [createForm, setCreateForm] = useState<RFICreateForm>({ ...DEFAULT_CREATE_FORM });

  const mutations = useRfiMutations({
    selectedRfiId: selectedRFI?.id ?? null,
    onCreateSuccess: () => { setShowCreateDialog(false); setCreateForm({ ...DEFAULT_CREATE_FORM }); },
    onDeleteSuccess: () => { setShowDetailDialog(false); setSelectedRFI(null); },
  });

  const buildQueryString = () => {
    const params = new URLSearchParams();
    if (filterProject !== "all") params.set("projectId", filterProject);
    if (filterStatus !== "all") params.set("status", filterStatus);
    const qs = params.toString();
    return qs ? `?${qs}` : "";
  };

  const { data: projects = [] } = useQuery<Project[]>({ queryKey: ["/api/subcontracts/projects"], enabled: !!user });
  const { data: subcontractors = [] } = useQuery<Subcontractor[]>({ queryKey: ["/api/subcontracts/subcontractors"], enabled: !!user });
  const { data: stats, isLoading: loadingStats } = useQuery<RFIStats>({ queryKey: ["/api/rfi/stats"], enabled: !!user });
  const { data: rfis = [], isLoading: loadingRFIs } = useQuery<RFI[]>({ queryKey: ["/api/rfi" + buildQueryString()], enabled: !!user });

  const openDetail = (rfi: RFI) => { setSelectedRFI(rfi); setShowDetailDialog(true); };

  const filteredRFIs = rfis.filter((rfi) => {
    if (filterPriority !== "all" && rfi.priority !== filterPriority) return false;
    return true;
  });

  if (!user) {
    return (
      <div className="p-8 text-center" data-testid="text-login-required">
        <p className="text-muted-foreground">Please log in to access RFIs</p>
      </div>
    );
  }

  return (
    <div className="p-8 space-y-6" data-testid="page-rfis">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2" data-testid="text-page-title">
            <HelpCircle className="h-8 w-8 text-primary" />
            RFIs
          </h1>
          <p className="text-muted-foreground mt-1">Manage Requests for Information across projects</p>
        </div>
        <Button onClick={() => setShowCreateDialog(true)} data-testid="button-create-rfi">
          <Plus className="h-4 w-4 mr-2" />Create RFI
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
        {loadingStats ? (
          [1, 2, 3, 4, 5].map((i) => (
            <Card key={i}><CardHeader className="pb-2"><Skeleton className="h-4 w-24" /></CardHeader><CardContent><Skeleton className="h-8 w-12" /></CardContent></Card>
          ))
        ) : (
          <>
            <Card data-testid="card-stat-total">
              <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2"><HelpCircle className="h-4 w-4" />Total RFIs</CardTitle></CardHeader>
              <CardContent><div className="text-2xl font-bold" data-testid="text-stat-total">{stats?.total ?? 0}</div></CardContent>
            </Card>
            <Card data-testid="card-stat-open">
              <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2"><AlertTriangle className="h-4 w-4" />Open</CardTitle></CardHeader>
              <CardContent><div className="text-2xl font-bold" data-testid="text-stat-open">{stats?.open ?? 0}</div></CardContent>
            </Card>
            <Card data-testid="card-stat-overdue" className="cursor-pointer hover-elevate" onClick={() => setFilterStatus("OVERDUE")}>
              <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-red-600 dark:text-red-400 flex items-center gap-2"><Clock className="h-4 w-4" />Overdue</CardTitle></CardHeader>
              <CardContent><div className="text-2xl font-bold text-red-600 dark:text-red-400" data-testid="text-stat-overdue">{stats?.overdue ?? 0}</div></CardContent>
            </Card>
            <Card data-testid="card-stat-answered">
              <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2"><CheckCircle2 className="h-4 w-4" />Answered</CardTitle></CardHeader>
              <CardContent><div className="text-2xl font-bold" data-testid="text-stat-answered">{stats?.answered ?? 0}</div></CardContent>
            </Card>
            <Card data-testid="card-stat-closed">
              <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2"><XCircle className="h-4 w-4" />Closed</CardTitle></CardHeader>
              <CardContent><div className="text-2xl font-bold" data-testid="text-stat-closed">{stats?.closed ?? 0}</div></CardContent>
            </Card>
          </>
        )}
      </div>

      <div className="flex items-center gap-4 flex-wrap">
        <div className="w-48">
          <Select value={filterProject} onValueChange={setFilterProject} data-testid="select-filter-project">
            <SelectTrigger data-testid="select-filter-project"><SelectValue placeholder="All Projects" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Projects</SelectItem>
              {projects.map((p) => (<SelectItem key={p.id} value={p.id}>{p.code} - {p.name}</SelectItem>))}
            </SelectContent>
          </Select>
        </div>
        <div className="w-48">
          <Select value={filterStatus} onValueChange={setFilterStatus}>
            <SelectTrigger data-testid="select-filter-status"><SelectValue placeholder="All Statuses" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              <SelectItem value="DRAFT">Draft</SelectItem>
              <SelectItem value="SUBMITTED">Submitted</SelectItem>
              <SelectItem value="UNDER_REVIEW">Under Review</SelectItem>
              <SelectItem value="ANSWERED">Answered</SelectItem>
              <SelectItem value="CLOSED">Closed</SelectItem>
              <SelectItem value="OVERDUE">Overdue</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="w-48">
          <Select value={filterPriority} onValueChange={setFilterPriority}>
            <SelectTrigger data-testid="select-filter-priority"><SelectValue placeholder="All Priorities" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Priorities</SelectItem>
              <SelectItem value="LOW">Low</SelectItem>
              <SelectItem value="MEDIUM">Medium</SelectItem>
              <SelectItem value="HIGH">High</SelectItem>
              <SelectItem value="URGENT">Urgent</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {loadingRFIs ? (
        <div className="space-y-4">{[1, 2, 3].map((i) => (<Skeleton key={i} className="h-16" />))}</div>
      ) : filteredRFIs.length === 0 ? (
        <Card><CardContent className="py-8 text-center text-muted-foreground" data-testid="text-empty-state">No RFIs found. Create your first RFI to get started.</CardContent></Card>
      ) : isMobile ? (
        <div className="space-y-3" data-testid="cards-rfis">
          {filteredRFIs.map((rfi) => (
            <Card key={rfi.id} className="cursor-pointer hover-elevate" onClick={() => openDetail(rfi)} data-testid={`card-rfi-${rfi.id}`}>
              <CardContent className="p-4 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-sm" data-testid={`text-rfi-number-${rfi.id}`}>{rfi.rfiNumber}</span>
                  <div className="flex items-center gap-1 flex-wrap justify-end" data-testid={`badge-rfi-status-${rfi.id}`}>
                    {getPriorityBadge(rfi.priority)}{getStatusBadge(rfi.status)}
                  </div>
                </div>
                <p className="text-sm font-medium truncate" data-testid={`text-rfi-subject-${rfi.id}`}>{rfi.subject}</p>
                {isRfiOverdue(rfi) && (
                  <Badge variant="destructive" className="text-xs" data-testid={`badge-overdue-mobile-${rfi.id}`}><Clock className="h-3 w-3 mr-1" />Overdue</Badge>
                )}
                <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                  <span data-testid={`text-rfi-project-${rfi.id}`}>{rfi.project?.code || "—"}</span>
                  <span data-testid={`text-rfi-submitted-date-${rfi.id}`}>{rfi.dateSubmitted ? format(new Date(rfi.dateSubmitted), "MMM d, yyyy") : "—"}</span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs text-muted-foreground" data-testid={`text-rfi-submitter-${rfi.id}`}>{rfi.submittedByName || "—"}</span>
                  <Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); openDetail(rfi); }} data-testid={`button-view-rfi-${rfi.id}`}>
                    <Eye className="h-4 w-4 mr-1" />View
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table data-testid="table-rfis">
              <TableHeader>
                <TableRow>
                  <TableHead>RFI #</TableHead><TableHead>Subject</TableHead><TableHead>Project</TableHead>
                  <TableHead>Priority</TableHead><TableHead>Status</TableHead><TableHead>Submitted By</TableHead>
                  <TableHead>Date Submitted</TableHead><TableHead>Date Required</TableHead><TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredRFIs.map((rfi) => (
                  <TableRow key={rfi.id} className="cursor-pointer" onClick={() => openDetail(rfi)} data-testid={`row-rfi-${rfi.id}`}>
                    <TableCell className="font-medium" data-testid={`text-rfi-number-${rfi.id}`}>{rfi.rfiNumber}</TableCell>
                    <TableCell className="max-w-[200px] truncate" data-testid={`text-rfi-subject-${rfi.id}`}>{rfi.subject}</TableCell>
                    <TableCell data-testid={`text-rfi-project-${rfi.id}`}>{rfi.project?.code || "—"}</TableCell>
                    <TableCell data-testid={`badge-rfi-priority-${rfi.id}`}>{getPriorityBadge(rfi.priority)}</TableCell>
                    <TableCell data-testid={`badge-rfi-status-${rfi.id}`}>{getStatusBadge(rfi.status)}</TableCell>
                    <TableCell data-testid={`text-rfi-submitter-${rfi.id}`}>{rfi.submittedByName || "—"}</TableCell>
                    <TableCell data-testid={`text-rfi-submitted-date-${rfi.id}`}>{rfi.dateSubmitted ? format(new Date(rfi.dateSubmitted), "MMM d, yyyy") : "—"}</TableCell>
                    <TableCell data-testid={`text-rfi-required-date-${rfi.id}`}>
                      {rfi.dateRequired ? (
                        <span className="flex items-center gap-1 flex-wrap">
                          <span className={isRfiOverdue(rfi) ? "text-red-600 dark:text-red-400 font-medium" : ""}>{format(new Date(rfi.dateRequired), "MMM d, yyyy")}</span>
                          {isRfiOverdue(rfi) && <Badge variant="destructive" className="text-xs" data-testid={`badge-overdue-${rfi.id}`}><Clock className="h-3 w-3 mr-1" />Overdue</Badge>}
                        </span>
                      ) : "—"}
                    </TableCell>
                    <TableCell>
                      <Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); openDetail(rfi); }} data-testid={`button-view-rfi-${rfi.id}`}>
                        <Eye className="h-4 w-4 mr-1" />View
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent className="max-w-lg" data-testid="dialog-create-rfi">
          <DialogHeader>
            <DialogTitle>Create RFI</DialogTitle>
            <DialogDescription>Submit a new Request for Information</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4 max-h-[60vh] overflow-y-auto">
            <div className="space-y-2">
              <Label>Project *</Label>
              <Select value={createForm.projectId} onValueChange={(v) => setCreateForm({ ...createForm, projectId: v })}>
                <SelectTrigger data-testid="select-create-project"><SelectValue placeholder="Select a project..." /></SelectTrigger>
                <SelectContent>
                  {projects.map((p) => (<SelectItem key={p.id} value={p.id}>{p.code} - {p.name}</SelectItem>))}
                </SelectContent>
              </Select>
            </div>
            <RfiCreateFields
              form={createForm}
              onChange={(updates) => setCreateForm({ ...createForm, ...updates })}
              subcontractors={subcontractors}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreateDialog(false)} data-testid="button-cancel-create">Cancel</Button>
            <Button
              onClick={() => mutations.createMutation.mutate({ ...createForm, projectId: createForm.projectId || "" })}
              disabled={!createForm.projectId || !createForm.subject || !createForm.question || mutations.createMutation.isPending}
              data-testid="button-submit-create"
            >
              {mutations.createMutation.isPending ? "Creating..." : "Create RFI"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <RfiDetailDialog
        open={showDetailDialog}
        onOpenChange={setShowDetailDialog}
        rfi={selectedRFI}
        onRfiUpdate={setSelectedRFI}
        mutations={mutations}
        attachmentsSlot={
          selectedRFI && (
            <DocumentAttachments
              entityType="rfi"
              entityId={selectedRFI.id}
              canUpload={true}
              canDelete={true}
              compact
            />
          )
        }
      />
    </div>
  );
}
