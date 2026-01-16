import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { 
  Lock, Unlock, Search, Shield, Calendar, Loader2, Plus, AlertTriangle, CheckCircle
} from "lucide-react";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { DailyReportLock, Project } from "@shared/schema";

interface LockWithRelations extends DailyReportLock {
  project?: {
    id: string;
    name: string;
    code: string;
  };
  lockedBy?: {
    id: string;
    firstName: string;
    lastName: string;
  };
  supervisorLockedBy?: {
    id: string;
    firstName: string;
    lastName: string;
  };
}

export default function DailyReportLocksPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [projectFilter, setProjectFilter] = useState<string>("ALL");
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isSupervisorLockOpen, setIsSupervisorLockOpen] = useState(false);
  const [selectedLock, setSelectedLock] = useState<LockWithRelations | null>(null);
  const [supervisorNotes, setSupervisorNotes] = useState("");

  // Create form state
  const [newLock, setNewLock] = useState({
    projectId: "",
    reportDate: format(new Date(), "yyyy-MM-dd"),
    lockReason: "",
  });

  const { data: locks = [], isLoading } = useQuery<LockWithRelations[]>({
    queryKey: ["/api/delay-claims/locks"],
    enabled: !!user,
  });

  const { data: projects = [] } = useQuery<{ data: Project[]; pagination: any }, Error, Project[]>({
    queryKey: ["/api/projects"],
    enabled: !!user,
    select: (response) => response.data || [],
  });

  const createMutation = useMutation({
    mutationFn: async (data: typeof newLock) => {
      return apiRequest("POST", "/api/delay-claims/locks", data);
    },
    onSuccess: () => {
      toast({ title: "Daily report locked successfully" });
      queryClient.invalidateQueries({ queryKey: ["/api/delay-claims/locks"] });
      setIsCreateOpen(false);
      setNewLock({
        projectId: "",
        reportDate: format(new Date(), "yyyy-MM-dd"),
        lockReason: "",
      });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to lock report", description: error.message, variant: "destructive" });
    }
  });

  const supervisorLockMutation = useMutation({
    mutationFn: async ({ id, notes }: { id: string; notes: string }) => {
      return apiRequest("POST", `/api/delay-claims/locks/${id}/supervisor-lock`, { supervisorLockNotes: notes });
    },
    onSuccess: () => {
      toast({ title: "Supervisor lock applied" });
      queryClient.invalidateQueries({ queryKey: ["/api/delay-claims/locks"] });
      setIsSupervisorLockOpen(false);
      setSupervisorNotes("");
      setSelectedLock(null);
    },
    onError: (error: Error) => {
      toast({ title: "Failed to apply supervisor lock", description: error.message, variant: "destructive" });
    }
  });

  const unlockMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest("POST", `/api/delay-claims/locks/${id}/unlock`, {});
    },
    onSuccess: () => {
      toast({ title: "Report unlocked" });
      queryClient.invalidateQueries({ queryKey: ["/api/delay-claims/locks"] });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to unlock report", description: error.message, variant: "destructive" });
    }
  });

  const filteredLocks = useMemo(() => {
    return locks.filter(lock => {
      const matchesSearch =
        lock.project?.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        lock.project?.code?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        lock.lockReason?.toLowerCase().includes(searchTerm.toLowerCase());

      const matchesStatus = statusFilter === "ALL" || lock.status === statusFilter;
      const matchesProject = projectFilter === "ALL" || lock.projectId === projectFilter;

      return matchesSearch && matchesStatus && matchesProject;
    });
  }, [locks, searchTerm, statusFilter, projectFilter]);

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "UNLOCKED":
        return <Badge variant="outline"><Unlock className="w-3 h-3 mr-1" />Unlocked</Badge>;
      case "LOCKED":
        return <Badge className="bg-yellow-500 hover:bg-yellow-600"><Lock className="w-3 h-3 mr-1" />Locked</Badge>;
      case "SUPERVISOR_LOCKED":
        return <Badge className="bg-red-500 hover:bg-red-600"><Shield className="w-3 h-3 mr-1" />Supervisor Locked</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const canManageLocks = user?.role === "ADMIN" || user?.role === "MANAGER" || user?.role === "SUPERINTENDENT";
  const canSupervisorLock = user?.role === "ADMIN" || user?.role === "MANAGER";

  if (isLoading) {
    return (
      <div className="p-6 flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-page-title">Daily Report Locks</h1>
          <p className="text-muted-foreground">Lock daily reports to preserve evidence integrity</p>
        </div>
        {canManageLocks && (
          <Button onClick={() => setIsCreateOpen(true)} data-testid="button-create-lock">
            <Plus className="w-4 h-4 mr-2" />
            Lock Report
          </Button>
        )}
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Unlocked</CardTitle>
            <Unlock className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-unlocked-count">
              {locks.filter(l => l.status === "UNLOCKED").length}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Locked</CardTitle>
            <Lock className="h-4 w-4 text-yellow-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-locked-count">
              {locks.filter(l => l.status === "LOCKED").length}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Supervisor Locked</CardTitle>
            <Shield className="h-4 w-4 text-red-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-supervisor-locked-count">
              {locks.filter(l => l.status === "SUPERVISOR_LOCKED").length}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Filter Locks</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-4">
            <div className="flex-1 min-w-[200px]">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search by project or reason..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10"
                  data-testid="input-search-locks"
                />
              </div>
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[180px]" data-testid="select-status-filter">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All Statuses</SelectItem>
                <SelectItem value="UNLOCKED">Unlocked</SelectItem>
                <SelectItem value="LOCKED">Locked</SelectItem>
                <SelectItem value="SUPERVISOR_LOCKED">Supervisor Locked</SelectItem>
              </SelectContent>
            </Select>
            <Select value={projectFilter} onValueChange={setProjectFilter}>
              <SelectTrigger className="w-[200px]" data-testid="select-project-filter">
                <SelectValue placeholder="Project" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All Projects</SelectItem>
                {projects.map(project => (
                  <SelectItem key={project.id} value={project.id}>
                    {project.code} - {project.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Locks Table */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Project</TableHead>
                <TableHead>Report Date</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Locked By</TableHead>
                <TableHead>Locked At</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredLocks.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                    No daily report locks found
                  </TableCell>
                </TableRow>
              ) : (
                filteredLocks.map((lock) => (
                  <TableRow key={lock.id} data-testid={`row-lock-${lock.id}`}>
                    <TableCell>
                      {lock.project?.code} - {lock.project?.name}
                    </TableCell>
                    <TableCell>
                      {lock.reportDate ? format(new Date(lock.reportDate), "MM/dd/yyyy") : "-"}
                    </TableCell>
                    <TableCell>
                      {getStatusBadge(lock.status)}
                    </TableCell>
                    <TableCell>
                      {lock.lockedBy ? `${lock.lockedBy.firstName} ${lock.lockedBy.lastName}` : "-"}
                    </TableCell>
                    <TableCell>
                      {lock.lockedAt ? format(new Date(lock.lockedAt), "MM/dd/yyyy HH:mm") : "-"}
                    </TableCell>
                    <TableCell className="max-w-[200px] truncate">
                      {lock.lockReason || "-"}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        {lock.status === "LOCKED" && canManageLocks && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => unlockMutation.mutate(lock.id)}
                            disabled={unlockMutation.isPending}
                            data-testid={`button-unlock-${lock.id}`}
                          >
                            <Unlock className="w-4 h-4 mr-1" />
                            Unlock
                          </Button>
                        )}
                        {lock.status === "LOCKED" && canSupervisorLock && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              setSelectedLock(lock);
                              setIsSupervisorLockOpen(true);
                            }}
                            data-testid={`button-supervisor-lock-${lock.id}`}
                          >
                            <Shield className="w-4 h-4 mr-1" />
                            Escalate
                          </Button>
                        )}
                        {lock.status === "SUPERVISOR_LOCKED" && (
                          <CheckCircle className="h-5 w-5 text-green-500" />
                        )}
                        {lock.status === "UNLOCKED" && (
                          <span className="text-muted-foreground text-sm">Editable</span>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Create Lock Dialog */}
      <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Lock Daily Report</DialogTitle>
            <DialogDescription>
              Lock a daily report to prevent further modifications. This preserves the report as legal evidence.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Project</Label>
              <Select value={newLock.projectId} onValueChange={(v) => setNewLock({ ...newLock, projectId: v })}>
                <SelectTrigger data-testid="select-new-lock-project">
                  <SelectValue placeholder="Select project" />
                </SelectTrigger>
                <SelectContent>
                  {projects.map(project => (
                    <SelectItem key={project.id} value={project.id}>
                      {project.code} - {project.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Report Date</Label>
              <Input
                type="date"
                value={newLock.reportDate}
                onChange={(e) => setNewLock({ ...newLock, reportDate: e.target.value })}
                data-testid="input-new-lock-date"
              />
            </div>
            <div className="space-y-2">
              <Label>Lock Reason</Label>
              <Textarea
                placeholder="Why is this report being locked?"
                value={newLock.lockReason}
                onChange={(e) => setNewLock({ ...newLock, lockReason: e.target.value })}
                rows={3}
                data-testid="input-new-lock-reason"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsCreateOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => createMutation.mutate(newLock)}
              disabled={!newLock.projectId || !newLock.reportDate || createMutation.isPending}
              data-testid="button-confirm-lock"
            >
              {createMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              <Lock className="w-4 h-4 mr-2" />
              Lock Report
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Supervisor Lock Dialog */}
      <Dialog open={isSupervisorLockOpen} onOpenChange={setIsSupervisorLockOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-yellow-500" />
              Escalate to Supervisor Lock
            </DialogTitle>
            <DialogDescription>
              This is a higher level of protection. A supervisor lock indicates this report is being preserved for formal legal proceedings or dispute resolution.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {selectedLock && (
              <div className="p-3 bg-muted rounded-md">
                <p className="text-sm">
                  <strong>Project:</strong> {selectedLock.project?.code} - {selectedLock.project?.name}
                </p>
                <p className="text-sm">
                  <strong>Report Date:</strong> {selectedLock.reportDate ? format(new Date(selectedLock.reportDate), "MM/dd/yyyy") : "-"}
                </p>
              </div>
            )}
            <div className="space-y-2">
              <Label>Supervisor Notes</Label>
              <Textarea
                placeholder="Document the reason for escalation..."
                value={supervisorNotes}
                onChange={(e) => setSupervisorNotes(e.target.value)}
                rows={4}
                data-testid="input-supervisor-notes"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsSupervisorLockOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => selectedLock && supervisorLockMutation.mutate({ id: selectedLock.id, notes: supervisorNotes })}
              disabled={!supervisorNotes || supervisorLockMutation.isPending}
              data-testid="button-confirm-supervisor-lock"
            >
              {supervisorLockMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              <Shield className="w-4 h-4 mr-2" />
              Apply Supervisor Lock
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
