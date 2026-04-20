import { useState } from "react";
import { format, parseISO } from "date-fns";
import { Calendar as CalendarIcon, User, Filter, X, Edit2, Save, XCircle, Package, ChevronDown, ChevronUp, Plus, Loader2, UserCheck } from "lucide-react";
import { Calendar as CalendarPicker } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Avatar, ColoredAvatarFallback } from "@/components/ui/avatar";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";

interface ProjectNote {
  id: string;
  projectId: string;
  authorId: string;
  authorFirstName: string;
  authorLastName: string;
  authorRole: string;
  noteType: string;
  text: string;
  createdAt: string;
}

interface ScopeItem {
  id: string;
  description: string;
  unit: string;
  quantity?: string;
}

interface MaterialBudget {
  id: string;
  scopeItemId: string;
  description: string;
  unit: string;
  budgetedQuantity: string;
  actualQuantityUsed: string;
}

interface DailyNoteFeedProps {
  projectId: string;
  projectCode?: string;
  availableUsers?: Array<{ id: string; firstName: string; lastName: string; role?: string }>;
}

export default function DailyNoteFeed({ projectId, projectCode, availableUsers }: DailyNoteFeedProps) {
  const { toast } = useToast();
  const { user } = useAuth();
  const [newNote, setNewNote] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [authorFilter, setAuthorFilter] = useState<string>("all");
  const [startDateFilter, setStartDateFilter] = useState<string>("");
  const [endDateFilter, setEndDateFilter] = useState<string>("");
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  
  const [showMaterialTracking, setShowMaterialTracking] = useState(false);
  const [selectedScopeItemId, setSelectedScopeItemId] = useState<string>("");
  const [quantityCompleted, setQuantityCompleted] = useState("");
  const [materialUsed, setMaterialUsed] = useState("");
  const [materialUnit, setMaterialUnit] = useState("");
  const [materialCost, setMaterialCost] = useState("");
  const [vendorName, setVendorName] = useState("");

  const queryParams = new URLSearchParams();
  if (authorFilter && authorFilter !== "all") {
    queryParams.append("authorId", authorFilter);
  }
  if (startDateFilter) {
    queryParams.append("startDate", startDateFilter);
  }
  if (endDateFilter) {
    queryParams.append("endDate", endDateFilter);
  }

  const queryString = queryParams.toString();

  const { data: notes = [], isLoading } = useQuery<ProjectNote[]>({
    queryKey: ["/api/projects", projectId, "notes", queryString],
    enabled: !!projectId,
  });

  const { data: safetyOfficerData } = useQuery<{ safetyOfficerId: string | null; safetyOfficer: { id: string; firstName: string; lastName: string; email: string } | null }>({
    queryKey: ["/api/projects", projectCode, "safety-officer"],
    queryFn: async () => {
      if (!projectCode) return { safetyOfficerId: null, safetyOfficer: null };
      const r = await fetch(`/api/projects/${projectCode}/safety-officer`, { credentials: "include" });
      if (!r.ok) return { safetyOfficerId: null, safetyOfficer: null };
      return r.json();
    },
    enabled: !!projectCode,
    staleTime: 5 * 60 * 1000,
  });

  const { data: scopeItems = [] } = useQuery<ScopeItem[]>({
    queryKey: ["/api/projects", projectCode || projectId, "scope"],
    enabled: !!(projectCode || projectId) && showMaterialTracking,
  });

  const { data: materialBudgets = [] } = useQuery<{ budget: MaterialBudget; scopeItem: any }[]>({
    queryKey: ["/api/projects", projectId, "material-budgets"],
    enabled: !!projectId && showMaterialTracking,
  });

  const createNoteMutation = useMutation({
    mutationFn: async (text: string) => {
      return apiRequest("POST", `/api/projects/${projectId}/notes`, { 
        text, 
        noteType: "GENERAL" 
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "notes"] });
      setNewNote("");
      toast({
        title: "Note Added",
        description: "Your daily note has been saved successfully.",
      });
    },
    onError: (error: Error) => {
      toast({
        variant: "destructive",
        title: "Error",
        description: error.message || "Failed to add note. Please try again.",
      });
    },
  });

  const addMaterialUsageMutation = useMutation({
    mutationFn: async (data: any) => {
      return apiRequest("POST", `/api/projects/${projectId}/material-usage`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "material-budgets"] });
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "material-usage"] });
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "material-budgets", "summary"] });
      resetMaterialFields();
      toast({
        title: "Material Usage Recorded",
        description: "Material usage has been added and budgets updated.",
      });
    },
    onError: (error: Error) => {
      toast({
        variant: "destructive",
        title: "Error",
        description: error.message || "Failed to record material usage.",
      });
    },
  });

  const updateNoteMutation = useMutation({
    mutationFn: async ({ noteId, text }: { noteId: string; text: string }) => {
      return apiRequest("PATCH", `/api/projects/${projectId}/notes/${noteId}`, { text });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "notes"] });
      setEditingNoteId(null);
      setEditText("");
      toast({
        title: "Note Updated",
        description: "Your note has been updated successfully.",
      });
    },
    onError: (error: Error) => {
      toast({
        variant: "destructive",
        title: "Error",
        description: error.message || "Failed to update note. Please try again.",
      });
    },
  });

  const resetMaterialFields = () => {
    setSelectedScopeItemId("");
    setQuantityCompleted("");
    setMaterialUsed("");
    setMaterialUnit("");
    setMaterialCost("");
    setVendorName("");
  };

  const handleSubmit = async () => {
    const hasMaterialData = showMaterialTracking && selectedScopeItemId && materialUsed;
    
    if (newNote.trim()) {
      await createNoteMutation.mutateAsync(newNote);
    }

    if (hasMaterialData) {
      const selectedScope = scopeItems.find(s => s.id === selectedScopeItemId);
      const materialBudget = materialBudgets.find(b => b.budget.scopeItemId === selectedScopeItemId);
      
      await addMaterialUsageMutation.mutateAsync({
        scopeItemId: selectedScopeItemId,
        materialBudgetId: materialBudget?.budget.id || null,
        usageDate: format(new Date(), "yyyy-MM-dd"),
        description: `Daily usage - ${selectedScope?.description || "Material"}`,
        quantityUsed: materialUsed,
        unit: materialUnit || selectedScope?.unit || "UNIT",
        unitCost: materialCost ? (parseFloat(materialCost) / parseFloat(materialUsed)).toFixed(2) : "0",
        vendorName: vendorName || null,
        notes: quantityCompleted ? `Quantity completed: ${quantityCompleted} ${selectedScope?.unit || ""}` : null,
      });
    }
  };

  const startEditing = (note: ProjectNote) => {
    setEditingNoteId(note.id);
    setEditText(note.text);
  };

  const cancelEditing = () => {
    setEditingNoteId(null);
    setEditText("");
  };

  const saveEdit = () => {
    if (editingNoteId && editText.trim()) {
      updateNoteMutation.mutate({ noteId: editingNoteId, text: editText });
    }
  };

  const canEditNote = (note: ProjectNote) => {
    if (!user) return false;
    return user.id === note.authorId || user.role === "ADMIN";
  };

  const clearFilters = () => {
    setAuthorFilter("all");
    setStartDateFilter("");
    setEndDateFilter("");
  };

  const hasActiveFilters = authorFilter !== "all" || startDateFilter || endDateFilter;
  const isSubmitting = createNoteMutation.isPending || addMaterialUsageMutation.isPending;
  const canSubmit = newNote.trim() || (showMaterialTracking && selectedScopeItemId && materialUsed);

  const selectedScope = scopeItems.find(s => s.id === selectedScopeItemId);
  const selectedBudget = materialBudgets.find(b => b.budget.scopeItemId === selectedScopeItemId);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Daily Field Report</CardTitle>
          <CardDescription>
            Document today's progress and optionally track material usage
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {safetyOfficerData?.safetyOfficer && (
            <div className="flex items-center gap-2 px-3 py-2 bg-muted/40 rounded-lg text-sm" data-testid="daily-report-safety-officer">
              <UserCheck className="h-4 w-4 text-primary" />
              <span className="font-medium text-muted-foreground">Safety Officer:</span>
              <span>{safetyOfficerData.safetyOfficer.firstName} {safetyOfficerData.safetyOfficer.lastName}</span>
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="daily-note">Notes & Progress</Label>
            <Textarea
              id="daily-note"
              placeholder="Document today's progress, issues, or important updates..."
              value={newNote}
              onChange={(e) => setNewNote(e.target.value)}
              className="min-h-24"
              data-testid="textarea-daily-note"
              disabled={isSubmitting}
            />
          </div>

          <Collapsible open={showMaterialTracking} onOpenChange={setShowMaterialTracking}>
            <CollapsibleTrigger asChild>
              <Button 
                variant="outline" 
                className="w-full justify-between gap-2"
                data-testid="button-toggle-material-tracking"
              >
                <span className="flex items-center gap-2">
                  <Package className="h-4 w-4" />
                  Material Usage Tracking
                </span>
                {showMaterialTracking ? (
                  <ChevronUp className="h-4 w-4" />
                ) : (
                  <ChevronDown className="h-4 w-4" />
                )}
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="pt-4 space-y-4">
              <div className="p-4 border rounded-md bg-muted/30 space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="scope-item">Scope Item Worked</Label>
                  <Select value={selectedScopeItemId} onValueChange={setSelectedScopeItemId}>
                    <SelectTrigger id="scope-item" data-testid="select-scope-item">
                      <SelectValue placeholder="Select scope item..." />
                    </SelectTrigger>
                    <SelectContent>
                      {scopeItems.map((item) => (
                        <SelectItem key={item.id} value={item.id}>
                          {item.description} ({item.unit})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {selectedScope && selectedBudget && (
                  <div className="flex items-center gap-2 text-sm">
                    <Badge variant="outline">
                      Budget: {Number(selectedBudget.budget.budgetedQuantity).toLocaleString()} {selectedBudget.budget.unit}
                    </Badge>
                    <Badge variant={
                      Number(selectedBudget.budget.actualQuantityUsed) / Number(selectedBudget.budget.budgetedQuantity) >= 0.9 
                        ? "destructive" 
                        : "secondary"
                    }>
                      Used: {Number(selectedBudget.budget.actualQuantityUsed).toLocaleString()} {selectedBudget.budget.unit}
                    </Badge>
                  </div>
                )}

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="quantity-completed">Quantity Completed Today</Label>
                    <Input
                      id="quantity-completed"
                      type="number"
                      step="0.01"
                      placeholder="0"
                      value={quantityCompleted}
                      onChange={(e) => setQuantityCompleted(e.target.value)}
                      data-testid="input-quantity-completed"
                      disabled={isSubmitting}
                    />
                    {selectedScope && (
                      <p className="text-xs text-muted-foreground">Unit: {selectedScope.unit}</p>
                    )}
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="material-used">Material Used</Label>
                    <Input
                      id="material-used"
                      type="number"
                      step="0.01"
                      placeholder="0"
                      value={materialUsed}
                      onChange={(e) => setMaterialUsed(e.target.value)}
                      data-testid="input-material-used"
                      disabled={isSubmitting}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="material-unit">Unit</Label>
                    <Input
                      id="material-unit"
                      placeholder={selectedScope?.unit || "SF, CY, etc."}
                      value={materialUnit}
                      onChange={(e) => setMaterialUnit(e.target.value)}
                      data-testid="input-material-unit"
                      disabled={isSubmitting}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="material-cost">Total Cost ($)</Label>
                    <Input
                      id="material-cost"
                      type="number"
                      step="0.01"
                      placeholder="0.00"
                      value={materialCost}
                      onChange={(e) => setMaterialCost(e.target.value)}
                      data-testid="input-material-cost"
                      disabled={isSubmitting}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="vendor-name">Vendor (Optional)</Label>
                    <Input
                      id="vendor-name"
                      placeholder="Vendor name"
                      value={vendorName}
                      onChange={(e) => setVendorName(e.target.value)}
                      data-testid="input-vendor-name"
                      disabled={isSubmitting}
                    />
                  </div>
                </div>
              </div>
            </CollapsibleContent>
          </Collapsible>

          <div className="flex items-center gap-2">
            <Button 
              onClick={handleSubmit} 
              data-testid="button-add-daily-note"
              disabled={!canSubmit || isSubmitting}
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <Plus className="h-4 w-4 mr-2" />
                  Add Entry
                </>
              )}
            </Button>
            {showMaterialTracking && selectedScopeItemId && (
              <Button 
                variant="ghost" 
                onClick={resetMaterialFields}
                disabled={isSubmitting}
                data-testid="button-reset-material"
              >
                Clear Material Data
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4 space-y-0 pb-4">
          <CardTitle>Daily Notes</CardTitle>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowFilters(!showFilters)}
            data-testid="button-toggle-filters"
            className="gap-2"
          >
            <Filter className="w-4 h-4" />
            {hasActiveFilters ? "Filters Active" : "Filters"}
          </Button>
        </CardHeader>
        <CardContent>
          {showFilters && (
            <div className="mb-6 p-4 border rounded-md space-y-4 bg-muted/50">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-medium">Filter Notes</h4>
                {hasActiveFilters && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={clearFilters}
                    data-testid="button-clear-filters"
                    className="gap-2 h-8"
                  >
                    <X className="w-3 h-3" />
                    Clear Filters
                  </Button>
                )}
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="author-filter">Author</Label>
                  {availableUsers && availableUsers.length > 0 ? (
                    <Select
                      value={authorFilter}
                      onValueChange={setAuthorFilter}
                    >
                      <SelectTrigger id="author-filter" data-testid="select-author-filter">
                        <SelectValue placeholder="All Authors" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Authors</SelectItem>
                        {availableUsers.map((user) => (
                          <SelectItem key={user.id} value={user.id}>
                            {user.firstName} {user.lastName} - {user.role}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <p className="text-sm text-muted-foreground">Loading users...</p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="start-date-filter">Start Date</Label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        type="button"
                        className={cn(
                          "w-full justify-start text-left font-normal",
                          !startDateFilter && "text-muted-foreground"
                        )}
                        data-testid="input-start-date-filter"
                      >
                        <CalendarIcon className="mr-2 h-4 w-4" />
                        {startDateFilter ? format(parseISO(startDateFilter), "PPP") : "Pick a date"}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <CalendarPicker
                        mode="single"
                        selected={startDateFilter ? parseISO(startDateFilter) : undefined}
                        onSelect={(date) => setStartDateFilter(date ? format(date, "yyyy-MM-dd") : "")}
                        initialFocus
                      />
                    </PopoverContent>
                  </Popover>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="end-date-filter">End Date</Label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        type="button"
                        className={cn(
                          "w-full justify-start text-left font-normal",
                          !endDateFilter && "text-muted-foreground"
                        )}
                        data-testid="input-end-date-filter"
                      >
                        <CalendarIcon className="mr-2 h-4 w-4" />
                        {endDateFilter ? format(parseISO(endDateFilter), "PPP") : "Pick a date"}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <CalendarPicker
                        mode="single"
                        selected={endDateFilter ? parseISO(endDateFilter) : undefined}
                        onSelect={(date) => setEndDateFilter(date ? format(date, "yyyy-MM-dd") : "")}
                        initialFocus
                      />
                    </PopoverContent>
                  </Popover>
                </div>
              </div>
            </div>
          )}

          <div className="space-y-4">
            {isLoading ? (
              <div className="text-center py-8">
                <p className="text-sm text-muted-foreground">Loading notes...</p>
              </div>
            ) : notes.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">
                {hasActiveFilters 
                  ? "No notes match your filters. Try adjusting or clearing them."
                  : "No notes yet. Add the first daily note above."}
              </p>
            ) : (
              notes.map((note) => {
                const noteDate = new Date(note.createdAt);
                const isEditing = editingNoteId === note.id;
                const canEdit = canEditNote(note);

                return (
                  <div
                    key={note.id}
                    className="flex gap-4 p-4 border rounded-md hover-elevate"
                    data-testid={`note-${note.id}`}
                  >
                    <Avatar className="w-10 h-10 shrink-0">
                      <ColoredAvatarFallback className="text-xs" name={`${note.authorFirstName} ${note.authorLastName}`} />
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <div>
                          <p className="font-medium text-sm" data-testid={`note-author-${note.id}`}>
                            {note.authorFirstName} {note.authorLastName}
                          </p>
                          <p className="text-xs text-muted-foreground">{note.authorRole}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="text-right shrink-0">
                            <p className="text-xs text-muted-foreground" data-testid={`note-date-${note.id}`}>
                              {format(noteDate, "MMM d, yyyy")}
                            </p>
                            <p className="text-xs text-muted-foreground" data-testid={`note-time-${note.id}`}>
                              {format(noteDate, "h:mm a")}
                            </p>
                          </div>
                          {canEdit && !isEditing && (
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => startEditing(note)}
                              data-testid={`button-edit-note-${note.id}`}
                              className="shrink-0"
                            >
                              <Edit2 className="w-4 h-4" />
                            </Button>
                          )}
                        </div>
                      </div>
                      {isEditing ? (
                        <div className="space-y-2">
                          <Textarea
                            value={editText}
                            onChange={(e) => setEditText(e.target.value)}
                            className="min-h-24"
                            data-testid={`textarea-edit-note-${note.id}`}
                            disabled={updateNoteMutation.isPending}
                          />
                          <div className="flex gap-2">
                            <Button
                              size="sm"
                              onClick={saveEdit}
                              disabled={!editText.trim() || updateNoteMutation.isPending}
                              data-testid={`button-save-note-${note.id}`}
                              className="gap-2"
                            >
                              <Save className="w-3 h-3" />
                              {updateNoteMutation.isPending ? "Saving..." : "Save"}
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={cancelEditing}
                              disabled={updateNoteMutation.isPending}
                              data-testid={`button-cancel-edit-${note.id}`}
                              className="gap-2"
                            >
                              <XCircle className="w-3 h-3" />
                              Cancel
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <p className="text-sm text-card-foreground whitespace-pre-wrap" data-testid={`note-text-${note.id}`}>
                          {note.text}
                        </p>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
