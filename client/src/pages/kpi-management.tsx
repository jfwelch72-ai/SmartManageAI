import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { ContextualHelpButton } from "@/components/ContextualHelpButton";
import {
  Target,
  Plus,
  Pencil,
  Trash2,
  TrendingUp,
  TrendingDown,
  Minus,
  ArrowUpRight,
  ArrowDownRight,
  Search,
  Library,
  ClipboardList,
  BarChart3,
  Loader2,
} from "lucide-react";

interface KpiTemplate {
  id: string;
  organizationId: string;
  name: string;
  description: string | null;
  category: string;
  unit: string;
  direction: string;
  isActive: boolean;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

interface KpiAssignment {
  id: string;
  organizationId: string;
  kpiTemplateId: string;
  userId: string;
  targetValue: string;
  periodType: string;
  startDate: string;
  endDate: string | null;
  isActive: boolean;
  assignedBy: string;
  createdAt: string;
  updatedAt: string;
  templateName: string;
  templateCategory: string;
  templateUnit: string;
  templateDirection: string;
  userName: string;
  userEmail: string;
}

interface KpiEntry {
  id: string;
  organizationId: string;
  kpiAssignmentId: string;
  actualValue: string;
  periodStart: string;
  periodEnd: string;
  notes: string | null;
  recordedBy: string;
  createdAt: string;
}

interface KpiSummaryItem {
  assignmentId: string;
  templateName: string;
  category: string;
  unit: string;
  direction: string;
  targetValue: number;
  actualValue: number;
  achievement: number;
  trend: "improving" | "declining" | "stable";
  periodType: string;
  latestPeriodEnd: string | null;
  entryCount: number;
}

interface OrgUser {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  role: string;
  isActive: boolean;
}

const CATEGORIES = ["Productivity", "Safety", "Financial", "Quality", "Attendance", "Custom"];
const PERIOD_TYPES = ["weekly", "monthly", "quarterly", "yearly"];
const DIRECTIONS = [
  { value: "higher_is_better", label: "Higher is Better" },
  { value: "lower_is_better", label: "Lower is Better" },
];

function getAchievementColor(achievement: number): string {
  if (achievement >= 80) return "text-green-600 dark:text-green-400";
  if (achievement >= 50) return "text-yellow-600 dark:text-yellow-400";
  return "text-red-600 dark:text-red-400";
}

function getProgressColor(achievement: number): string {
  if (achievement >= 80) return "bg-green-500";
  if (achievement >= 50) return "bg-yellow-500";
  return "bg-red-500";
}

function TrendIcon({ trend, direction }: { trend: string; direction: string }) {
  if (trend === "improving") {
    return <ArrowUpRight className="w-4 h-4 text-green-600 dark:text-green-400" />;
  }
  if (trend === "declining") {
    return <ArrowDownRight className="w-4 h-4 text-red-600 dark:text-red-400" />;
  }
  return <Minus className="w-4 h-4 text-muted-foreground" />;
}

function KpiLibraryTab() {
  const { toast } = useToast();
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<KpiTemplate | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [formData, setFormData] = useState({
    name: "",
    description: "",
    category: "Custom",
    unit: "count",
    direction: "higher_is_better",
  });

  const { data: templates = [], isLoading } = useQuery<KpiTemplate[]>({
    queryKey: ["/api/kpis/templates"],
  });

  const createMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      return await apiRequest("POST", "/api/kpis/templates", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/kpis/templates"] });
      toast({ title: "KPI template created" });
      resetForm();
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<typeof formData> }) => {
      return await apiRequest("PATCH", `/api/kpis/templates/${id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/kpis/templates"] });
      toast({ title: "KPI template updated" });
      resetForm();
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      return await apiRequest("DELETE", `/api/kpis/templates/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/kpis/templates"] });
      toast({ title: "KPI template deactivated" });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const resetForm = () => {
    setFormData({ name: "", description: "", category: "Custom", unit: "count", direction: "higher_is_better" });
    setShowCreateDialog(false);
    setEditingTemplate(null);
  };

  const openEditDialog = (template: KpiTemplate) => {
    setEditingTemplate(template);
    setFormData({
      name: template.name,
      description: template.description || "",
      category: template.category,
      unit: template.unit,
      direction: template.direction,
    });
    setShowCreateDialog(true);
  };

  const handleSubmit = () => {
    if (!formData.name.trim()) {
      toast({ title: "Error", description: "Name is required", variant: "destructive" });
      return;
    }
    if (editingTemplate) {
      updateMutation.mutate({ id: editingTemplate.id, data: formData });
    } else {
      createMutation.mutate(formData);
    }
  };

  const filteredTemplates = useMemo(() => {
    return templates.filter(t =>
      t.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      t.category.toLowerCase().includes(searchTerm.toLowerCase())
    );
  }, [templates, searchTerm]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search templates..."
            className="pl-9 w-[250px]"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            data-testid="input-search-templates"
          />
        </div>
        <Button onClick={() => { resetForm(); setShowCreateDialog(true); }} data-testid="button-create-kpi">
          <Plus className="w-4 h-4 mr-2" />
          Create KPI
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-6 space-y-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : filteredTemplates.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground" data-testid="text-no-templates">
              {searchTerm ? "No templates match your search" : "No KPI templates yet. Create one to get started."}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead>Unit</TableHead>
                    <TableHead>Direction</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="w-[100px]">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredTemplates.map((template) => (
                    <TableRow key={template.id} data-testid={`row-template-${template.id}`}>
                      <TableCell>
                        <div>
                          <span className="font-medium" data-testid={`text-template-name-${template.id}`}>{template.name}</span>
                          {template.description && (
                            <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{template.description}</p>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary" data-testid={`badge-category-${template.id}`}>{template.category}</Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{template.unit}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {template.direction === "higher_is_better" ? (
                          <span className="flex items-center gap-1"><TrendingUp className="w-3 h-3" /> Higher</span>
                        ) : (
                          <span className="flex items-center gap-1"><TrendingDown className="w-3 h-3" /> Lower</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant={template.isActive ? "default" : "secondary"}>
                          {template.isActive ? "Active" : "Inactive"}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <Button size="icon" variant="ghost" onClick={() => openEditDialog(template)} data-testid={`button-edit-template-${template.id}`}>
                            <Pencil className="w-4 h-4" />
                          </Button>
                          {template.isActive && (
                            <Button size="icon" variant="ghost" onClick={() => deleteMutation.mutate(template.id)} data-testid={`button-delete-template-${template.id}`}>
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={showCreateDialog} onOpenChange={(open) => { if (!open) resetForm(); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editingTemplate ? "Edit KPI Template" : "Create KPI Template"}</DialogTitle>
            <DialogDescription>
              {editingTemplate ? "Update the KPI template details." : "Define a new KPI metric for your organization."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="kpi-name">Name *</Label>
              <Input
                id="kpi-name"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="e.g., Jobs Completed Per Week"
                data-testid="input-template-name"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="kpi-description">Description</Label>
              <Textarea
                id="kpi-description"
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                placeholder="Describe what this KPI measures..."
                data-testid="input-template-description"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Category</Label>
                <Select value={formData.category} onValueChange={(v) => setFormData({ ...formData, category: v })}>
                  <SelectTrigger data-testid="select-template-category">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CATEGORIES.map((c) => (
                      <SelectItem key={c} value={c}>{c}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="kpi-unit">Unit</Label>
                <Input
                  id="kpi-unit"
                  value={formData.unit}
                  onChange={(e) => setFormData({ ...formData, unit: e.target.value })}
                  placeholder="count, hours, $, %"
                  data-testid="input-template-unit"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Direction</Label>
              <Select value={formData.direction} onValueChange={(v) => setFormData({ ...formData, direction: v })}>
                <SelectTrigger data-testid="select-template-direction">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DIRECTIONS.map((d) => (
                    <SelectItem key={d.value} value={d.value}>{d.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={resetForm} data-testid="button-cancel-template">Cancel</Button>
            <Button onClick={handleSubmit} disabled={createMutation.isPending || updateMutation.isPending} data-testid="button-save-template">
              {(createMutation.isPending || updateMutation.isPending) && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {editingTemplate ? "Update" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function AssignmentsTab() {
  const { toast } = useToast();
  const [showAssignDialog, setShowAssignDialog] = useState(false);
  const [employeeFilter, setEmployeeFilter] = useState("ALL");
  const [templateFilter, setTemplateFilter] = useState("ALL");
  const [formData, setFormData] = useState({
    kpiTemplateId: "",
    userId: "",
    targetValue: "",
    periodType: "monthly",
    startDate: new Date().toISOString().split("T")[0],
    endDate: "",
  });

  const { data: assignments = [], isLoading } = useQuery<KpiAssignment[]>({
    queryKey: ["/api/kpis/assignments"],
  });

  const { data: templates = [] } = useQuery<KpiTemplate[]>({
    queryKey: ["/api/kpis/templates"],
  });

  const { data: users = [] } = useQuery<OrgUser[]>({
    queryKey: ["/api/users"],
  });

  const activeTemplates = useMemo(() => templates.filter(t => t.isActive), [templates]);
  const activeUsers = useMemo(() => users.filter(u => u.isActive), [users]);

  const createMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      return await apiRequest("POST", "/api/kpis/assignments", {
        ...data,
        endDate: data.endDate || null,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/kpis/assignments"] });
      toast({ title: "KPI assigned successfully" });
      resetForm();
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      return await apiRequest("DELETE", `/api/kpis/assignments/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/kpis/assignments"] });
      toast({ title: "Assignment removed" });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const resetForm = () => {
    setFormData({
      kpiTemplateId: "",
      userId: "",
      targetValue: "",
      periodType: "monthly",
      startDate: new Date().toISOString().split("T")[0],
      endDate: "",
    });
    setShowAssignDialog(false);
  };

  const handleSubmit = () => {
    if (!formData.kpiTemplateId || !formData.userId || !formData.targetValue) {
      toast({ title: "Error", description: "Please fill in all required fields", variant: "destructive" });
      return;
    }
    createMutation.mutate(formData);
  };

  const filteredAssignments = useMemo(() => {
    return assignments.filter(a => {
      if (employeeFilter !== "ALL" && a.userId !== employeeFilter) return false;
      if (templateFilter !== "ALL" && a.kpiTemplateId !== templateFilter) return false;
      return true;
    });
  }, [assignments, employeeFilter, templateFilter]);

  const uniqueEmployees = useMemo(() => {
    const seen = new Map<string, string>();
    assignments.forEach(a => {
      if (!seen.has(a.userId)) seen.set(a.userId, a.userName);
    });
    return Array.from(seen.entries()).map(([id, name]) => ({ id, name }));
  }, [assignments]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <Select value={employeeFilter} onValueChange={setEmployeeFilter}>
            <SelectTrigger className="w-[200px]" data-testid="select-filter-employee">
              <SelectValue placeholder="Filter by employee" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All Employees</SelectItem>
              {uniqueEmployees.map((emp) => (
                <SelectItem key={emp.id} value={emp.id}>{emp.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={templateFilter} onValueChange={setTemplateFilter}>
            <SelectTrigger className="w-[200px]" data-testid="select-filter-template">
              <SelectValue placeholder="Filter by KPI" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All KPIs</SelectItem>
              {activeTemplates.map((t) => (
                <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button onClick={() => { resetForm(); setShowAssignDialog(true); }} data-testid="button-assign-kpi">
          <Plus className="w-4 h-4 mr-2" />
          Assign KPI
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-6 space-y-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : filteredAssignments.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground" data-testid="text-no-assignments">
              {assignments.length === 0 ? "No KPI assignments yet. Assign a KPI to an employee to get started." : "No assignments match your filters."}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Employee</TableHead>
                    <TableHead>KPI</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead>Target</TableHead>
                    <TableHead>Period</TableHead>
                    <TableHead>Start Date</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="w-[80px]">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredAssignments.map((assignment) => (
                    <TableRow key={assignment.id} data-testid={`row-assignment-${assignment.id}`}>
                      <TableCell className="font-medium" data-testid={`text-assignment-employee-${assignment.id}`}>
                        {assignment.userName}
                      </TableCell>
                      <TableCell data-testid={`text-assignment-kpi-${assignment.id}`}>{assignment.templateName}</TableCell>
                      <TableCell>
                        <Badge variant="secondary">{assignment.templateCategory}</Badge>
                      </TableCell>
                      <TableCell>
                        {assignment.targetValue} {assignment.templateUnit}
                      </TableCell>
                      <TableCell className="capitalize">{assignment.periodType}</TableCell>
                      <TableCell className="text-muted-foreground">{assignment.startDate}</TableCell>
                      <TableCell>
                        <Badge variant={assignment.isActive ? "default" : "secondary"}>
                          {assignment.isActive ? "Active" : "Inactive"}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => deleteMutation.mutate(assignment.id)}
                          data-testid={`button-delete-assignment-${assignment.id}`}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={showAssignDialog} onOpenChange={(open) => { if (!open) resetForm(); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Assign KPI to Employee</DialogTitle>
            <DialogDescription>
              Select an employee, choose a KPI template, and set the target value.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Employee *</Label>
              <Select value={formData.userId} onValueChange={(v) => setFormData({ ...formData, userId: v })}>
                <SelectTrigger data-testid="select-assign-employee">
                  <SelectValue placeholder="Select employee" />
                </SelectTrigger>
                <SelectContent>
                  {activeUsers.map((u) => (
                    <SelectItem key={u.id} value={u.id}>{u.firstName} {u.lastName}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>KPI Template *</Label>
              <Select value={formData.kpiTemplateId} onValueChange={(v) => setFormData({ ...formData, kpiTemplateId: v })}>
                <SelectTrigger data-testid="select-assign-template">
                  <SelectValue placeholder="Select KPI" />
                </SelectTrigger>
                <SelectContent>
                  {activeTemplates.map((t) => (
                    <SelectItem key={t.id} value={t.id}>{t.name} ({t.unit})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="target-value">Target Value *</Label>
                <Input
                  id="target-value"
                  type="number"
                  value={formData.targetValue}
                  onChange={(e) => setFormData({ ...formData, targetValue: e.target.value })}
                  placeholder="e.g., 10"
                  data-testid="input-assign-target"
                />
              </div>
              <div className="space-y-2">
                <Label>Period</Label>
                <Select value={formData.periodType} onValueChange={(v) => setFormData({ ...formData, periodType: v })}>
                  <SelectTrigger data-testid="select-assign-period">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PERIOD_TYPES.map((p) => (
                      <SelectItem key={p} value={p} className="capitalize">{p}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="start-date">Start Date *</Label>
                <Input
                  id="start-date"
                  type="date"
                  value={formData.startDate}
                  onChange={(e) => setFormData({ ...formData, startDate: e.target.value })}
                  data-testid="input-assign-start-date"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="end-date">End Date</Label>
                <Input
                  id="end-date"
                  type="date"
                  value={formData.endDate}
                  onChange={(e) => setFormData({ ...formData, endDate: e.target.value })}
                  data-testid="input-assign-end-date"
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={resetForm} data-testid="button-cancel-assign">Cancel</Button>
            <Button onClick={handleSubmit} disabled={createMutation.isPending} data-testid="button-save-assign">
              {createMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Assign KPI
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function PerformanceTab() {
  const { toast } = useToast();
  const [selectedUserId, setSelectedUserId] = useState<string>("");
  const [showEntryDialog, setShowEntryDialog] = useState(false);
  const [selectedAssignmentId, setSelectedAssignmentId] = useState<string>("");
  const [entryForm, setEntryForm] = useState({
    actualValue: "",
    periodStart: "",
    periodEnd: "",
    notes: "",
  });

  const { data: users = [] } = useQuery<OrgUser[]>({
    queryKey: ["/api/users"],
  });

  const activeUsers = useMemo(() => users.filter(u => u.isActive), [users]);

  const { data: summary = [], isLoading: summaryLoading } = useQuery<KpiSummaryItem[]>({
    queryKey: ["/api/kpis/summary", selectedUserId],
    queryFn: async () => {
      const res = await fetch(`/api/kpis/summary?userId=${selectedUserId}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch summary");
      return res.json();
    },
    enabled: !!selectedUserId,
  });

  const createEntryMutation = useMutation({
    mutationFn: async (data: any) => {
      return await apiRequest("POST", "/api/kpis/entries", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/kpis/summary"] });
      toast({ title: "Entry recorded" });
      setShowEntryDialog(false);
      setEntryForm({ actualValue: "", periodStart: "", periodEnd: "", notes: "" });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const openRecordEntry = (assignmentId: string) => {
    setSelectedAssignmentId(assignmentId);
    const now = new Date();
    const periodStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split("T")[0];
    const periodEnd = now.toISOString().split("T")[0];
    setEntryForm({ actualValue: "", periodStart, periodEnd, notes: "" });
    setShowEntryDialog(true);
  };

  const handleEntrySubmit = () => {
    if (!entryForm.actualValue || !entryForm.periodStart || !entryForm.periodEnd) {
      toast({ title: "Error", description: "Please fill in all required fields", variant: "destructive" });
      return;
    }
    createEntryMutation.mutate({
      kpiAssignmentId: selectedAssignmentId,
      ...entryForm,
      notes: entryForm.notes || null,
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-4">
        <div className="space-y-1">
          <Label className="text-sm text-muted-foreground">Select Employee</Label>
          <Select value={selectedUserId} onValueChange={setSelectedUserId}>
            <SelectTrigger className="w-[280px]" data-testid="select-performance-employee">
              <SelectValue placeholder="Choose an employee to view KPIs" />
            </SelectTrigger>
            <SelectContent>
              {activeUsers.map((u) => (
                <SelectItem key={u.id} value={u.id}>{u.firstName} {u.lastName}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {!selectedUserId ? (
        <Card>
          <CardContent className="py-12">
            <div className="text-center text-muted-foreground" data-testid="text-select-employee-prompt">
              <Target className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p className="text-lg font-medium">Select an Employee</p>
              <p className="text-sm">Choose an employee from the dropdown above to view their KPI performance.</p>
            </div>
          </CardContent>
        </Card>
      ) : summaryLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Card key={i}>
              <CardContent className="p-6 space-y-3">
                <Skeleton className="h-5 w-40" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-3 w-24" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : summary.length === 0 ? (
        <Card>
          <CardContent className="py-8">
            <div className="text-center text-muted-foreground" data-testid="text-no-kpis-assigned">
              <p>No KPIs assigned to this employee yet.</p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {summary.map((item) => (
            <Card key={item.assignmentId} data-testid={`card-kpi-${item.assignmentId}`}>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2 min-w-0">
                    <CardTitle className="text-base truncate" data-testid={`text-kpi-name-${item.assignmentId}`}>
                      {item.templateName}
                    </CardTitle>
                    <Badge variant="secondary" className="shrink-0">{item.category}</Badge>
                  </div>
                  <TrendIcon trend={item.trend} direction={item.direction} />
                </div>
                <CardDescription className="capitalize">{item.periodType} target</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm text-muted-foreground">
                    {item.actualValue} / {item.targetValue} {item.unit}
                  </span>
                  <span className={`text-lg font-bold ${getAchievementColor(item.achievement)}`} data-testid={`text-achievement-${item.assignmentId}`}>
                    {item.achievement}%
                  </span>
                </div>
                <div className="w-full h-2 rounded-full bg-muted overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${getProgressColor(item.achievement)}`}
                    style={{ width: `${Math.min(item.achievement, 100)}%` }}
                  />
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs text-muted-foreground">
                    {item.entryCount} {item.entryCount === 1 ? "entry" : "entries"} recorded
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => openRecordEntry(item.assignmentId)}
                    data-testid={`button-record-entry-${item.assignmentId}`}
                  >
                    <Plus className="w-3 h-3 mr-1" />
                    Record
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={showEntryDialog} onOpenChange={(open) => { if (!open) setShowEntryDialog(false); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Record KPI Entry</DialogTitle>
            <DialogDescription>
              Record the actual performance value for this period.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="actual-value">Actual Value *</Label>
              <Input
                id="actual-value"
                type="number"
                value={entryForm.actualValue}
                onChange={(e) => setEntryForm({ ...entryForm, actualValue: e.target.value })}
                placeholder="Enter actual value"
                data-testid="input-entry-value"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="period-start">Period Start *</Label>
                <Input
                  id="period-start"
                  type="date"
                  value={entryForm.periodStart}
                  onChange={(e) => setEntryForm({ ...entryForm, periodStart: e.target.value })}
                  data-testid="input-entry-period-start"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="period-end">Period End *</Label>
                <Input
                  id="period-end"
                  type="date"
                  value={entryForm.periodEnd}
                  onChange={(e) => setEntryForm({ ...entryForm, periodEnd: e.target.value })}
                  data-testid="input-entry-period-end"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="entry-notes">Notes</Label>
              <Textarea
                id="entry-notes"
                value={entryForm.notes}
                onChange={(e) => setEntryForm({ ...entryForm, notes: e.target.value })}
                placeholder="Optional notes about this entry..."
                data-testid="input-entry-notes"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowEntryDialog(false)} data-testid="button-cancel-entry">Cancel</Button>
            <Button onClick={handleEntrySubmit} disabled={createEntryMutation.isPending} data-testid="button-save-entry">
              {createEntryMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Save Entry
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function KpiManagementPage() {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState("library");

  if (!user) return null;

  return (
    <div className="min-h-screen bg-background">
      <main className="mx-auto max-w-7xl px-6 py-8 space-y-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-3xl font-bold" data-testid="text-page-title">KPI Management</h1>
            <p className="text-muted-foreground">Define, assign, and track key performance indicators for your team</p>
          </div>
          <ContextualHelpButton />
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList data-testid="tabs-kpi-management">
            <TabsTrigger value="library" data-testid="tab-kpi-library">
              <Library className="w-4 h-4 mr-2" />
              KPI Library
            </TabsTrigger>
            <TabsTrigger value="assignments" data-testid="tab-kpi-assignments">
              <ClipboardList className="w-4 h-4 mr-2" />
              Assignments
            </TabsTrigger>
            <TabsTrigger value="performance" data-testid="tab-kpi-performance">
              <BarChart3 className="w-4 h-4 mr-2" />
              Performance
            </TabsTrigger>
          </TabsList>

          <TabsContent value="library">
            <KpiLibraryTab />
          </TabsContent>

          <TabsContent value="assignments">
            <AssignmentsTab />
          </TabsContent>

          <TabsContent value="performance">
            <PerformanceTab />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}
