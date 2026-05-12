import { useState, useMemo, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import TaskDetailModal from "@/components/TaskDetailModal";
import ViewSwitcher, { type ViewType } from "@/components/ViewSwitcher";
import SavedViewsDropdown, { type BuiltInView } from "@/components/SavedViewsDropdown";
import TasksKanbanView from "@/components/TasksKanbanView";
import EntityCalendarView, { type CalendarEntityItem } from "@/components/EntityCalendarView";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { Plus, CheckCircle2, Circle, XCircle, AlertCircle, Calendar as CalendarIcon, User, Search, X, Filter, ArrowUp, ArrowDown, ArrowUpDown, CheckSquare as CheckSquareIcon } from "lucide-react";
import { EmptyState } from "@/components/EmptyState";
import { FormDatePicker } from "@/components/ui/date-picker";
import { format, parseISO } from "date-fns";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";

const taskFormSchema = z.object({
  title: z.string().min(1, "Title is required"),
  description: z.string().optional(),
  category: z.enum(["SUPPLY_NEED", "EQUIPMENT_REPAIR", "WEATHER_DELAY", "CHANGE_ORDER", "SAFETY", "CLIENT_COMMUNICATION", "OTHER"]),
  priority: z.enum(["CRITICAL", "HIGH", "MEDIUM", "LOW"]),
  projectId: z.string().optional(),
  assignedToId: z.string().optional(),
  dueDate: z.string().optional(),
});

type TaskFormData = z.infer<typeof taskFormSchema>;

import type { TaskData as TaskItemBase } from "@/components/TaskDetailModal";
interface TaskItem extends TaskItemBase {
  projectId?: string;
}

interface TasksFilterState {
  search: string;
  priority: string;
  category: string;
  status: string | null;
}

const TASKS_DEFAULT_FILTERS: TasksFilterState = { search: "", priority: "ALL", category: "ALL", status: null };

const TASKS_BUILT_IN_VIEWS: BuiltInView<TasksFilterState>[] = [
  { id: "builtin-all-tasks", name: "All tasks", apply: { view: "table", filters: TASKS_DEFAULT_FILTERS } },
  { id: "builtin-my-open", name: "Open tasks", apply: { view: "kanban", filters: { ...TASKS_DEFAULT_FILTERS, status: "PENDING" } } },
  { id: "builtin-critical-tasks", name: "Critical priority", apply: { view: "table", filters: { ...TASKS_DEFAULT_FILTERS, priority: "CRITICAL" } } },
  { id: "builtin-due-cal", name: "Due dates", apply: { view: "calendar", filters: TASKS_DEFAULT_FILTERS } },
];

const PRIORITY_OPTIONS = ["ALL", "CRITICAL", "HIGH", "MEDIUM", "LOW"];
const CATEGORY_OPTIONS = [
  { value: "ALL", label: "All Categories" },
  { value: "SUPPLY_NEED", label: "Supply Need" },
  { value: "EQUIPMENT_REPAIR", label: "Equipment Repair" },
  { value: "WEATHER_DELAY", label: "Weather Delay" },
  { value: "CHANGE_ORDER", label: "Change Order" },
  { value: "SAFETY", label: "Safety" },
  { value: "CLIENT_COMMUNICATION", label: "Client Communication" },
  { value: "OTHER", label: "Other" },
];

export default function Tasks() {
  const { toast } = useToast();
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [priorityFilter, setPriorityFilter] = useState("ALL");
  const [categoryFilter, setCategoryFilter] = useState("ALL");
  const [dismissDialogOpen, setDismissDialogOpen] = useState(false);
  const [dismissReason, setDismissReason] = useState("");
  const [dismissingTaskId, setDismissingTaskId] = useState<string | null>(null);
  const [sortColumn, setSortColumn] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");
  const [selectedTask, setSelectedTask] = useState<TaskItem | null>(null);
  const [isDetailModalOpen, setIsDetailModalOpen] = useState(false);
  const [tasksView, setTasksView] = useState<ViewType>(() => {
    if (typeof window === "undefined") return "table";
    const saved = window.localStorage.getItem("tasks-view");
    return saved === "kanban" || saved === "calendar" || saved === "table" ? (saved as ViewType) : "table";
  });
  const handleTasksViewChange = (v: ViewType) => {
    setTasksView(v);
    if (typeof window !== "undefined") window.localStorage.setItem("tasks-view", v);
  };

  const form = useForm<TaskFormData>({
    resolver: zodResolver(taskFormSchema),
    defaultValues: {
      title: "",
      description: "",
      category: "OTHER",
      priority: "MEDIUM",
      projectId: "",
      assignedToId: "",
      dueDate: "",
    },
  });

  // Fetch tasks - use queryKey with params, default fetcher handles it
  const {  data: tasks = [], isLoading } = useQuery<TaskItem[]>({
    queryKey: statusFilter ? [`/api/tasks?status=${statusFilter}`] : ["/api/tasks"],
  });

  useEffect(() => {
    if (tasks.length === 0) return;
    const params = new URLSearchParams(window.location.search);
    const deepLinkTaskId = params.get("taskId");
    if (deepLinkTaskId) {
      const found = tasks.find((t) => t.id === deepLinkTaskId);
      if (found) {
        setSelectedTask(found);
        setIsDetailModalOpen(true);
      }
    }
  }, [tasks]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("new") === "true" || params.get("new") === "1") {
      setIsCreateDialogOpen(true);
      const url = new URL(window.location.href);
      url.searchParams.delete("new");
      window.history.replaceState({}, "", url.pathname + (url.search ? url.search : ""));
    }
  }, []);

  // Fetch projects for dropdown
  const { data: projects = [] } = useQuery<{ data: Array<{ id: string; code: string; name: string }>; pagination: any }, Error, Array<{ id: string; code: string; name: string }>>({
    queryKey: ["/api/projects"],
    select: (response) => response.data || [],
  });

  // Fetch users for assignment dropdown
  const { data: users = [] } = useQuery<Array<{ id: string; firstName: string; lastName: string; role?: string }>>({
    queryKey: ["/api/users"],
  });

  // Create task mutation
  const createTaskMutation = useMutation({
    mutationFn: async (data: TaskFormData) => {
      return apiRequest("POST", "/api/tasks", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
      toast({ title: "Success", description: "Task created successfully" });
      setIsCreateDialogOpen(false);
      form.reset();
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to create task", variant: "destructive" });
    },
  });

  // Update task status mutation
  const updateStatusMutation = useMutation({
    mutationFn: async ({ taskId, status, dismissReason }: { taskId: string; status: string; dismissReason?: string }) => {
      const body: { status: string; dismissReason?: string } = { status };
      if (dismissReason) {
        body.dismissReason = dismissReason;
      }
      return apiRequest("PATCH", `/api/tasks/${taskId}`, body);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
      toast({ title: "Success", description: "Task status updated" });
      setDismissDialogOpen(false);
      setDismissReason("");
      setDismissingTaskId(null);
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to update task status", variant: "destructive" });
    },
  });

  const onSubmit = (data: TaskFormData) => {
    createTaskMutation.mutate(data);
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "COMPLETED":
        return <CheckCircle2 className="h-4 w-4 text-green-600" data-testid="icon-completed" />;
      case "IN_PROGRESS":
        return <Circle className="h-4 w-4 text-blue-600" data-testid="icon-in-progress" />;
      case "DISMISSED":
        return <XCircle className="h-4 w-4 text-gray-600" data-testid="icon-dismissed" />;
      default:
        return <AlertCircle className="h-4 w-4 text-yellow-600" data-testid="icon-pending" />;
    }
  };

  const getCategoryLabel = (category: string) => {
    return category.replace(/_/g, " ");
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "COMPLETED":
        return <Badge className="bg-green-100 text-green-800 border-green-200 dark:bg-green-900 dark:text-green-200 dark:border-green-800" data-testid="badge-completed">Completed</Badge>;
      case "IN_PROGRESS":
        return <Badge className="bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-900 dark:text-blue-200 dark:border-blue-800" data-testid="badge-in-progress">In Progress</Badge>;
      case "DISMISSED":
        return <Badge className="bg-gray-100 text-gray-800 border-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-700" data-testid="badge-dismissed">Dismissed</Badge>;
      default:
        return <Badge className="bg-yellow-100 text-yellow-800 border-yellow-200 dark:bg-yellow-900 dark:text-yellow-200 dark:border-yellow-800" data-testid="badge-pending">Open</Badge>;
    }
  };

  const getPriorityBadge = (priority: string) => {
    switch (priority) {
      case "CRITICAL":
        return <Badge className="bg-red-100 text-red-800 border-red-200 dark:bg-red-900 dark:text-red-200 dark:border-red-800" data-testid="badge-critical">Critical</Badge>;
      case "HIGH":
        return <Badge className="bg-orange-100 text-orange-800 border-orange-200 dark:bg-orange-900 dark:text-orange-200 dark:border-orange-800" data-testid="badge-high">High</Badge>;
      case "MEDIUM":
        return <Badge className="bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950 dark:text-blue-300 dark:border-blue-800" data-testid="badge-medium">Medium</Badge>;
      case "LOW":
        return <Badge variant="secondary" data-testid="badge-low">Low</Badge>;
      default:
        return <Badge variant="secondary">{priority}</Badge>;
    }
  };

  const handleSort = (column: string) => {
    if (sortColumn === column) {
      if (sortDirection === "asc") {
        setSortDirection("desc");
      } else {
        setSortColumn(null);
        setSortDirection("asc");
      }
    } else {
      setSortColumn(column);
      setSortDirection("asc");
    }
  };

  const getSortIcon = (column: string) => {
    if (sortColumn !== column) return <ArrowUpDown className="h-3 w-3 ml-1" />;
    return sortDirection === "asc" ? <ArrowUp className="h-3 w-3 ml-1" /> : <ArrowDown className="h-3 w-3 ml-1" />;
  };

  const PRIORITY_ORDER: Record<string, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
  const STATUS_ORDER: Record<string, number> = { PENDING: 0, IN_PROGRESS: 1, COMPLETED: 2, DISMISSED: 3 };

  const filteredTasks = useMemo(() => {
    const filtered = tasks.filter(task => {
      const matchesSearch = 
        task.title?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        task.description?.toLowerCase().includes(searchTerm.toLowerCase());
      
      if (searchTerm && !matchesSearch) return false;
      if (priorityFilter !== "ALL" && task.priority !== priorityFilter) return false;
      if (categoryFilter !== "ALL" && task.category !== categoryFilter) return false;
      
      return true;
    });

    if (sortColumn) {
      filtered.sort((a: any, b: any) => {
        let cmp = 0;
        switch (sortColumn) {
          case "title":
            cmp = (a.title || "").localeCompare(b.title || "");
            break;
          case "status":
            cmp = (STATUS_ORDER[a.status] ?? 99) - (STATUS_ORDER[b.status] ?? 99);
            break;
          case "priority":
            cmp = (PRIORITY_ORDER[a.priority] ?? 99) - (PRIORITY_ORDER[b.priority] ?? 99);
            break;
          case "dueDate":
            cmp = (a.dueDate || "9999").localeCompare(b.dueDate || "9999");
            break;
        }
        return sortDirection === "desc" ? -cmp : cmp;
      });
    }

    return filtered;
  }, [tasks, searchTerm, priorityFilter, categoryFilter, sortColumn, sortDirection]);

  const hasActiveFilters = searchTerm || priorityFilter !== "ALL" || categoryFilter !== "ALL" || statusFilter !== null;

  return (
    <div className="p-4 sm:p-6 space-y-6" data-testid="page-tasks">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold" data-testid="heading-tasks">Tasks</h1>
          <p className="text-muted-foreground" data-testid="text-task-description">
            Manage manual tasks and track AI-generated insights
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <ViewSwitcher
            value={tasksView}
            onChange={handleTasksViewChange}
            views={["table", "kanban", "calendar"]}
            testId="tasks-view-switcher"
          />
          <SavedViewsDropdown
            viewKey="tasks"
            defaultFilters={TASKS_DEFAULT_FILTERS}
            builtInViews={TASKS_BUILT_IN_VIEWS}
            current={{
              view: tasksView,
              filters: { search: searchTerm, priority: priorityFilter, category: categoryFilter, status: statusFilter },
            }}
            onApply={(applied) => {
              handleTasksViewChange(applied.view === "map" ? "table" : applied.view);
              setSearchTerm(applied.filters.search ?? "");
              setPriorityFilter(applied.filters.priority ?? "ALL");
              setCategoryFilter(applied.filters.category ?? "ALL");
              setStatusFilter(applied.filters.status ?? null);
            }}
          />
        <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
          <DialogTrigger asChild>
            <Button data-testid="button-create-task">
              <Plus className="h-4 w-4 mr-2" />
              Create Task
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-2xl">
            <DialogHeader>
              <DialogTitle data-testid="heading-create-task">Create New Task</DialogTitle>
              <DialogDescription data-testid="text-create-task-description">
                Create a manual task and assign it to a team member
              </DialogDescription>
            </DialogHeader>

            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <FormField
                  control={form.control}
                  name="title"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Title</FormLabel>
                      <FormControl>
                        <Input {...field} placeholder="Enter task title" data-testid="input-task-title" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="description"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Description</FormLabel>
                      <FormControl>
                        <Textarea {...field} placeholder="Enter task description" data-testid="input-task-description" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="category"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Category</FormLabel>
                        <Select onValueChange={field.onChange} defaultValue={field.value}>
                          <FormControl>
                            <SelectTrigger data-testid="select-task-category">
                              <SelectValue placeholder="Select category" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="SUPPLY_NEED">Supply Need</SelectItem>
                            <SelectItem value="EQUIPMENT_REPAIR">Equipment Repair</SelectItem>
                            <SelectItem value="WEATHER_DELAY">Weather Delay</SelectItem>
                            <SelectItem value="CHANGE_ORDER">Change Order</SelectItem>
                            <SelectItem value="SAFETY">Safety</SelectItem>
                            <SelectItem value="CLIENT_COMMUNICATION">Client Communication</SelectItem>
                            <SelectItem value="OTHER">Other</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="priority"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Priority</FormLabel>
                        <Select onValueChange={field.onChange} defaultValue={field.value}>
                          <FormControl>
                            <SelectTrigger data-testid="select-task-priority">
                              <SelectValue placeholder="Select priority" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="CRITICAL">Critical</SelectItem>
                            <SelectItem value="HIGH">High</SelectItem>
                            <SelectItem value="MEDIUM">Medium</SelectItem>
                            <SelectItem value="LOW">Low</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <FormField
                  control={form.control}
                  name="projectId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Project (Optional)</FormLabel>
                      <Select onValueChange={(val) => field.onChange(val === "none" ? "" : val)} value={field.value || ""}>
                        <FormControl>
                          <SelectTrigger data-testid="select-task-project">
                            <SelectValue placeholder="Select project" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="none">None</SelectItem>
                          {projects.map((project: any) => (
                            <SelectItem key={project.id} value={project.id}>
                              {project.code} - {project.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="assignedToId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Assign To (Optional)</FormLabel>
                      <Select onValueChange={(val) => field.onChange(val === "none" ? "" : val)} value={field.value || ""}>
                        <FormControl>
                          <SelectTrigger data-testid="select-task-assignee">
                            <SelectValue placeholder="Select user" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="none">None</SelectItem>
                          {users.map((user: any) => (
                            <SelectItem key={user.id} value={user.id}>
                              {user.firstName} {user.lastName} - {user.role}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="dueDate"
                  render={({ field }) => (
                    <FormItem className="flex flex-col">
                      <FormLabel>Due Date (Optional)</FormLabel>
                      <FormDatePicker
                        field={field}
                        placeholder="Pick a date"
                        data-testid="input-task-due-date"
                      />
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <div className="flex justify-end gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setIsCreateDialogOpen(false)}
                    data-testid="button-cancel-task"
                  >
                    Cancel
                  </Button>
                  <Button 
                    type="submit" 
                    disabled={createTaskMutation.isPending}
                    data-testid="button-submit-task"
                  >
                    {createTaskMutation.isPending ? "Creating..." : "Create Task"}
                  </Button>
                </div>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
        </div>
      </div>

      {/* Filters Section */}
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[200px] max-w-[300px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search tasks..."
              className="pl-9 min-h-[44px] sm:min-h-0"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              data-testid="input-search-tasks"
            />
          </div>
          
          <Select value={priorityFilter} onValueChange={setPriorityFilter}>
            <SelectTrigger className="w-[140px] min-h-[44px] sm:min-h-0" data-testid="select-priority-filter">
              <SelectValue placeholder="Priority" />
            </SelectTrigger>
            <SelectContent>
              {PRIORITY_OPTIONS.map(p => (
                <SelectItem key={p} value={p}>{p === "ALL" ? "All Priorities" : p}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          
          <Select value={categoryFilter} onValueChange={setCategoryFilter}>
            <SelectTrigger className="w-[180px] min-h-[44px] sm:min-h-0" data-testid="select-category-filter">
              <Filter className="h-4 w-4 mr-2" />
              <SelectValue placeholder="Category" />
            </SelectTrigger>
            <SelectContent>
              {CATEGORY_OPTIONS.map(c => (
                <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Status Filters */}
        <div className="flex gap-2 overflow-x-auto pb-1">
          <Button
            variant={statusFilter === null ? "default" : "outline"}
            size="sm"
            className="min-h-[44px] sm:min-h-0 shrink-0"
            onClick={() => setStatusFilter(null)}
            data-testid="filter-all"
          >
            All
          </Button>
          <Button
            variant={statusFilter === "PENDING" ? "default" : "outline"}
            size="sm"
            className="min-h-[44px] sm:min-h-0 shrink-0"
            onClick={() => setStatusFilter("PENDING")}
            data-testid="filter-pending"
          >
            Pending
          </Button>
          <Button
            variant={statusFilter === "IN_PROGRESS" ? "default" : "outline"}
            size="sm"
            className="min-h-[44px] sm:min-h-0 shrink-0"
            onClick={() => setStatusFilter("IN_PROGRESS")}
            data-testid="filter-in-progress"
          >
            In Progress
          </Button>
          <Button
            variant={statusFilter === "COMPLETED" ? "default" : "outline"}
            size="sm"
            className="min-h-[44px] sm:min-h-0 shrink-0"
            onClick={() => setStatusFilter("COMPLETED")}
            data-testid="filter-completed"
          >
            Completed
          </Button>
        </div>
        
        {/* Active filter badges */}
        {hasActiveFilters && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-muted-foreground">Active filters:</span>
            {searchTerm && (
              <Badge variant="secondary" className="gap-1">
                Search: "{searchTerm}"
                <X 
                  className="w-3 h-3 cursor-pointer" 
                  onClick={() => setSearchTerm("")}
                  data-testid="button-clear-search"
                />
              </Badge>
            )}
            {statusFilter && (
              <Badge variant="secondary" className="gap-1">
                Status: {statusFilter.replace(/_/g, " ")}
                <X 
                  className="w-3 h-3 cursor-pointer" 
                  onClick={() => setStatusFilter(null)}
                  data-testid="button-clear-status-filter"
                />
              </Badge>
            )}
            {priorityFilter !== "ALL" && (
              <Badge variant="secondary" className="gap-1">
                {priorityFilter}
                <X 
                  className="w-3 h-3 cursor-pointer" 
                  onClick={() => setPriorityFilter("ALL")}
                  data-testid="button-clear-priority-filter"
                />
              </Badge>
            )}
            {categoryFilter !== "ALL" && (
              <Badge variant="secondary" className="gap-1">
                {CATEGORY_OPTIONS.find(c => c.value === categoryFilter)?.label}
                <X 
                  className="w-3 h-3 cursor-pointer" 
                  onClick={() => setCategoryFilter("ALL")}
                  data-testid="button-clear-category-filter"
                />
              </Badge>
            )}
            <Button 
              variant="ghost" 
              size="sm" 
              onClick={() => {
                setSearchTerm("");
                setStatusFilter(null);
                setPriorityFilter("ALL");
                setCategoryFilter("ALL");
              }}
              data-testid="button-clear-all-filters"
            >
              Clear all
            </Button>
          </div>
        )}
      </div>

      {/* Tasks Table */}
      {isLoading ? (
        <div className="text-center py-8" data-testid="loading-tasks">Loading tasks...</div>
      ) : filteredTasks.length === 0 ? (
        <EmptyState
          icon={CheckSquareIcon}
          title={hasActiveFilters ? "No tasks match your filters" : "No tasks yet"}
          description={hasActiveFilters
            ? "Try adjusting your search or filter criteria."
            : "Create your first task to track and manage work."}
          testId="empty-state-tasks"
        />
      ) : tasksView === "kanban" ? (
        <TasksKanbanView
          tasks={filteredTasks as React.ComponentProps<typeof TasksKanbanView>["tasks"]}
          onCardClick={(t) => {
            const full = filteredTasks.find((x) => x.id === t.id);
            if (full) {
              setSelectedTask(full);
              setIsDetailModalOpen(true);
            }
          }}
        />
      ) : tasksView === "calendar" ? (
        <EntityCalendarView
          items={filteredTasks
            .filter((t) => !!t.dueDate)
            .map<CalendarEntityItem<TaskItem>>((t) => ({
              id: t.id,
              label: t.title,
              date: new Date(t.dueDate as string),
              colorClass:
                t.priority === "CRITICAL"
                  ? "bg-red-500 hover:bg-red-600"
                  : t.priority === "HIGH"
                  ? "bg-orange-500 hover:bg-orange-600"
                  : t.priority === "MEDIUM"
                  ? "bg-blue-500 hover:bg-blue-600"
                  : "bg-slate-500 hover:bg-slate-600",
              data: t,
            }))}
          onItemClick={(t) => {
            setSelectedTask(t);
            setIsDetailModalOpen(true);
          }}
          legend={[
            { label: "Critical", colorClass: "bg-red-500" },
            { label: "High", colorClass: "bg-orange-500" },
            { label: "Medium", colorClass: "bg-blue-500" },
            { label: "Low", colorClass: "bg-slate-500" },
          ]}
          testIdPrefix="tasks-calendar"
        />
      ) : (
        <>
        {/* Mobile card view */}
        <div className="md:hidden space-y-3" data-testid="tasks-card-container">
          {filteredTasks.map((task) => (
            <Card
              key={task.id}
              className="cursor-pointer active:bg-muted/50 transition-colors"
              onClick={() => {
                setSelectedTask(task);
                setIsDetailModalOpen(true);
              }}
              data-testid={`task-card-${task.id}`}
            >
              <CardContent className="p-4 space-y-3">
                <div className="flex items-start gap-2">
                  {getStatusIcon(task.status)}
                  <span className="font-medium text-sm flex-1 leading-snug" data-testid={`task-title-${task.id}`}>{task.title}</span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <span data-testid={`task-status-${task.id}`}>{getStatusBadge(task.status)}</span>
                  <span data-testid={`task-priority-${task.id}`}>{getPriorityBadge(task.priority)}</span>
                  <Badge variant="outline" className="text-xs" data-testid={`task-category-${task.id}`}>{getCategoryLabel(task.category)}</Badge>
                </div>
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span data-testid={`task-assignee-${task.id}`}>
                    {task.assignedToFirstName ? (
                      <span className="flex items-center gap-1">
                        <User className="h-3 w-3" />
                        {task.assignedToFirstName} {task.assignedToLastName}
                      </span>
                    ) : "Unassigned"}
                  </span>
                  <span data-testid={`task-due-date-${task.id}`}>
                    {task.dueDate ? (
                      <span className="flex items-center gap-1">
                        <CalendarIcon className="h-3 w-3" />
                        {new Date(task.dueDate).toLocaleDateString()}
                      </span>
                    ) : "No due date"}
                  </span>
                </div>
                <div className="flex gap-2 pt-1" onClick={(e) => e.stopPropagation()}>
                  {task.status === "PENDING" && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="flex-1 min-h-[44px]"
                      onClick={() => updateStatusMutation.mutate({ taskId: task.id, status: "IN_PROGRESS" })}
                      disabled={updateStatusMutation.isPending}
                      data-testid={`button-start-task-${task.id}`}
                    >
                      Start Working
                    </Button>
                  )}
                  {task.status === "IN_PROGRESS" && (
                    <>
                      <Button
                        size="sm"
                        className="flex-1 min-h-[44px]"
                        onClick={() => updateStatusMutation.mutate({ taskId: task.id, status: "COMPLETED" })}
                        disabled={updateStatusMutation.isPending}
                        data-testid={`button-complete-task-${task.id}`}
                      >
                        Mark Complete
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="min-h-[44px]"
                        onClick={() => {
                          setDismissingTaskId(task.id);
                          setDismissDialogOpen(true);
                        }}
                        disabled={updateStatusMutation.isPending}
                        data-testid={`button-dismiss-task-${task.id}`}
                      >
                        Dismiss
                      </Button>
                    </>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Desktop table view */}
        <div className="hidden md:block rounded-md border overflow-x-auto" data-testid="tasks-table-container">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>
                  <button
                    className="flex items-center font-medium text-xs uppercase tracking-wider cursor-pointer select-none hover:text-foreground"
                    onClick={() => handleSort("title")}
                    data-testid="sort-task-name"
                  >
                    Task Name
                    {getSortIcon("title")}
                  </button>
                </TableHead>
                <TableHead>
                  <button
                    className="flex items-center font-medium text-xs uppercase tracking-wider cursor-pointer select-none hover:text-foreground"
                    onClick={() => handleSort("status")}
                    data-testid="sort-status"
                  >
                    Status
                    {getSortIcon("status")}
                  </button>
                </TableHead>
                <TableHead>
                  <button
                    className="flex items-center font-medium text-xs uppercase tracking-wider cursor-pointer select-none hover:text-foreground"
                    onClick={() => handleSort("priority")}
                    data-testid="sort-priority"
                  >
                    Priority
                    {getSortIcon("priority")}
                  </button>
                </TableHead>
                <TableHead className="text-xs uppercase tracking-wider">Category</TableHead>
                <TableHead className="text-xs uppercase tracking-wider">Assignee</TableHead>
                <TableHead>
                  <button
                    className="flex items-center font-medium text-xs uppercase tracking-wider cursor-pointer select-none hover:text-foreground"
                    onClick={() => handleSort("dueDate")}
                    data-testid="sort-due-date"
                  >
                    Due Date
                    {getSortIcon("dueDate")}
                  </button>
                </TableHead>
                <TableHead className="text-xs uppercase tracking-wider text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredTasks.map((task) => (
                <TableRow
                  key={task.id}
                  className="cursor-pointer hover:bg-muted/50"
                  onClick={() => {
                    setSelectedTask(task);
                    setIsDetailModalOpen(true);
                  }}
                  data-testid={`task-row-${task.id}`}
                >
                  <TableCell className="font-medium max-w-[300px]">
                    <div className="flex items-center gap-2" data-testid={`task-title-${task.id}`}>
                      {getStatusIcon(task.status)}
                      <span className="truncate">{task.title}</span>
                    </div>
                  </TableCell>
                  <TableCell data-testid={`task-status-${task.id}`}>
                    {getStatusBadge(task.status)}
                  </TableCell>
                  <TableCell data-testid={`task-priority-${task.id}`}>
                    {getPriorityBadge(task.priority)}
                  </TableCell>
                  <TableCell data-testid={`task-category-${task.id}`}>
                    <span className="text-sm text-muted-foreground">{getCategoryLabel(task.category)}</span>
                  </TableCell>
                  <TableCell data-testid={`task-assignee-${task.id}`}>
                    {task.assignedToFirstName ? (
                      <div className="flex items-center gap-1 text-sm">
                        <User className="h-3 w-3 text-muted-foreground" />
                        <span>{task.assignedToFirstName} {task.assignedToLastName}</span>
                      </div>
                    ) : (
                      <span className="text-sm text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell data-testid={`task-due-date-${task.id}`}>
                    {task.dueDate ? (
                      <div className="flex items-center gap-1 text-sm">
                        <CalendarIcon className="h-3 w-3 text-muted-foreground" />
                        <span>{new Date(task.dueDate).toLocaleDateString()}</span>
                      </div>
                    ) : (
                      <span className="text-sm text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center justify-end gap-1">
                      {task.status === "PENDING" && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => updateStatusMutation.mutate({ taskId: task.id, status: "IN_PROGRESS" })}
                          disabled={updateStatusMutation.isPending}
                          data-testid={`button-start-task-${task.id}`}
                        >
                          Start Working
                        </Button>
                      )}
                      {task.status === "IN_PROGRESS" && (
                        <>
                          <Button
                            size="sm"
                            onClick={() => updateStatusMutation.mutate({ taskId: task.id, status: "COMPLETED" })}
                            disabled={updateStatusMutation.isPending}
                            data-testid={`button-complete-task-${task.id}`}
                          >
                            Mark Complete
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setDismissingTaskId(task.id);
                              setDismissDialogOpen(true);
                            }}
                            disabled={updateStatusMutation.isPending}
                            data-testid={`button-dismiss-task-${task.id}`}
                          >
                            Dismiss
                          </Button>
                        </>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        </>
      )}

      {selectedTask && (
        <TaskDetailModal
          task={selectedTask}
          open={isDetailModalOpen}
          onOpenChange={(open) => {
            setIsDetailModalOpen(open);
            if (!open) setSelectedTask(null);
          }}
          onStatusUpdate={(taskId, status, dismissReason) => {
            if (status === "DISMISSED" && !dismissReason) {
              setDismissingTaskId(taskId);
              setDismissDialogOpen(true);
              setIsDetailModalOpen(false);
              return;
            }
            updateStatusMutation.mutate({ taskId, status, dismissReason });
            setIsDetailModalOpen(false);
            setSelectedTask(null);
          }}
          isUpdating={updateStatusMutation.isPending}
        />
      )}

      <Dialog open={dismissDialogOpen} onOpenChange={setDismissDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Dismiss Task</DialogTitle>
            <DialogDescription>
              Please provide a reason for dismissing this task.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <Textarea
              placeholder="Enter dismiss reason..."
              value={dismissReason}
              onChange={(e) => setDismissReason(e.target.value)}
              data-testid="input-dismiss-reason"
            />
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  setDismissDialogOpen(false);
                  setDismissReason("");
                  setDismissingTaskId(null);
                }}
                data-testid="button-cancel-dismiss"
              >
                Cancel
              </Button>
              <Button
                onClick={() => {
                  if (dismissingTaskId && dismissReason.trim()) {
                    updateStatusMutation.mutate({
                      taskId: dismissingTaskId,
                      status: "DISMISSED",
                      dismissReason: dismissReason.trim(),
                    });
                  }
                }}
                disabled={!dismissReason.trim() || updateStatusMutation.isPending}
                data-testid="button-confirm-dismiss"
              >
                {updateStatusMutation.isPending ? "Dismissing..." : "Dismiss Task"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
