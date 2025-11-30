import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Plus, CheckCircle2, Circle, XCircle, AlertCircle, Calendar, User, Search, X, Filter } from "lucide-react";
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
  const {  data: tasks = [], isLoading } = useQuery({
    queryKey: statusFilter ? [`/api/tasks?status=${statusFilter}`] : ["/api/tasks"],
  });

  // Fetch projects for dropdown
  const { data: projects = [] } = useQuery({
    queryKey: ["/api/projects"],
  });

  // Fetch users for assignment dropdown
  const { data: users = [] } = useQuery({
    queryKey: ["/api/users"],
  });

  // Create task mutation
  const createTaskMutation = useMutation({
    mutationFn: async (data: TaskFormData) => {
      return apiRequest("/api/tasks", {
        method: "POST",
        body: JSON.stringify(data),
      });
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
    mutationFn: async ({ taskId, status }: { taskId: string; status: string }) => {
      return apiRequest(`/api/tasks/${taskId}`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
      toast({ title: "Success", description: "Task status updated" });
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

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case "CRITICAL": return "destructive";
      case "HIGH": return "destructive";
      case "MEDIUM": return "default";
      case "LOW": return "secondary";
      default: return "default";
    }
  };

  const getCategoryLabel = (category: string) => {
    return category.replace(/_/g, " ");
  };

  // Filter tasks based on search, priority, and category
  const filteredTasks = useMemo(() => {
    return (tasks as any[]).filter(task => {
      // Search filter
      const matchesSearch = 
        task.title?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        task.description?.toLowerCase().includes(searchTerm.toLowerCase());
      
      if (searchTerm && !matchesSearch) return false;
      
      // Priority filter
      if (priorityFilter !== "ALL" && task.priority !== priorityFilter) return false;
      
      // Category filter
      if (categoryFilter !== "ALL" && task.category !== categoryFilter) return false;
      
      return true;
    });
  }, [tasks, searchTerm, priorityFilter, categoryFilter]);

  const hasActiveFilters = searchTerm || priorityFilter !== "ALL" || categoryFilter !== "ALL" || statusFilter !== null;

  return (
    <div className="p-6 space-y-6" data-testid="page-tasks">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold" data-testid="heading-tasks">Tasks</h1>
          <p className="text-muted-foreground" data-testid="text-task-description">
            Manage manual tasks and track AI-generated insights
          </p>
        </div>

        <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
          <DialogTrigger asChild>
            <Button data-testid="button-create-task">
              <Plus className="h-4 w-4 mr-2" />
              Create Task
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl">
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
                              {user.firstName} {user.lastName}
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
                    <FormItem>
                      <FormLabel>Due Date (Optional)</FormLabel>
                      <FormControl>
                        <Input type="date" {...field} data-testid="input-task-due-date" />
                      </FormControl>
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

      {/* Filters Section */}
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[200px] max-w-[300px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search tasks..."
              className="pl-9"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              data-testid="input-search-tasks"
            />
          </div>
          
          <Select value={priorityFilter} onValueChange={setPriorityFilter}>
            <SelectTrigger className="w-[140px]" data-testid="select-priority-filter">
              <SelectValue placeholder="Priority" />
            </SelectTrigger>
            <SelectContent>
              {PRIORITY_OPTIONS.map(p => (
                <SelectItem key={p} value={p}>{p === "ALL" ? "All Priorities" : p}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          
          <Select value={categoryFilter} onValueChange={setCategoryFilter}>
            <SelectTrigger className="w-[180px]" data-testid="select-category-filter">
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
        <div className="flex gap-2">
          <Button
            variant={statusFilter === null ? "default" : "outline"}
            size="sm"
            onClick={() => setStatusFilter(null)}
            data-testid="filter-all"
          >
            All
          </Button>
          <Button
            variant={statusFilter === "PENDING" ? "default" : "outline"}
            size="sm"
            onClick={() => setStatusFilter("PENDING")}
            data-testid="filter-pending"
          >
            Pending
          </Button>
          <Button
            variant={statusFilter === "IN_PROGRESS" ? "default" : "outline"}
            size="sm"
            onClick={() => setStatusFilter("IN_PROGRESS")}
            data-testid="filter-in-progress"
          >
            In Progress
          </Button>
          <Button
            variant={statusFilter === "COMPLETED" ? "default" : "outline"}
            size="sm"
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

      {/* Tasks List */}
      {isLoading ? (
        <div className="text-center py-8" data-testid="loading-tasks">Loading tasks...</div>
      ) : filteredTasks.length === 0 ? (
        <Card>
          <CardContent className="py-8">
            <div className="text-center text-muted-foreground" data-testid="empty-state-tasks">
              {hasActiveFilters 
                ? "No tasks match your filters. Try adjusting your search criteria."
                : "No tasks found. Create your first task to get started."}
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {filteredTasks.map((task: any) => (
            <Card key={task.id} data-testid={`task-card-${task.id}`}>
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 space-y-1">
                    <div className="flex items-center gap-2">
                      {getStatusIcon(task.status)}
                      <CardTitle className="text-base" data-testid={`task-title-${task.id}`}>
                        {task.title}
                      </CardTitle>
                    </div>
                    {task.description && (
                      <CardDescription data-testid={`task-description-${task.id}`}>
                        {task.description}
                      </CardDescription>
                    )}
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <Badge variant={getPriorityColor(task.priority) as any} data-testid={`task-priority-${task.id}`}>
                      {task.priority}
                    </Badge>
                    <Badge variant="outline" data-testid={`task-category-${task.id}`}>
                      {getCategoryLabel(task.category)}
                    </Badge>
                  </div>
                </div>

                <div className="flex flex-wrap gap-4 text-sm text-muted-foreground mt-2">
                  {task.projectName && (
                    <div className="flex items-center gap-1" data-testid={`task-project-${task.id}`}>
                      <span className="font-medium">{task.projectCode}</span>
                    </div>
                  )}
                  {task.assignedToFirstName && (
                    <div className="flex items-center gap-1" data-testid={`task-assignee-${task.id}`}>
                      <User className="h-3 w-3" />
                      {task.assignedToFirstName} {task.assignedToLastName}
                    </div>
                  )}
                  {task.dueDate && (
                    <div className="flex items-center gap-1" data-testid={`task-due-date-${task.id}`}>
                      <Calendar className="h-3 w-3" />
                      {new Date(task.dueDate).toLocaleDateString()}
                    </div>
                  )}
                </div>

                {task.status === "PENDING" && (
                  <div className="flex gap-2 mt-3">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => updateStatusMutation.mutate({ taskId: task.id, status: "IN_PROGRESS" })}
                      disabled={updateStatusMutation.isPending}
                      data-testid={`button-start-task-${task.id}`}
                    >
                      Start Working
                    </Button>
                  </div>
                )}

                {task.status === "IN_PROGRESS" && (
                  <div className="flex gap-2 mt-3">
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
                      onClick={() => updateStatusMutation.mutate({ taskId: task.id, status: "DISMISSED" })}
                      disabled={updateStatusMutation.isPending}
                      data-testid={`button-dismiss-task-${task.id}`}
                    >
                      Dismiss
                    </Button>
                  </div>
                )}
              </CardHeader>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
