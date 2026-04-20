import { useState } from "react";
import { format, parseISO } from "date-fns";
import { MessageSquare, Calendar as CalendarIcon, User, Filter, X, Building2, Edit2, Save, XCircle, Home, ArrowLeft } from "lucide-react";
import { Calendar as CalendarPicker } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Avatar, ColoredAvatarFallback } from "@/components/ui/avatar";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import { AIInsights } from "@/components/AIInsights";

interface CompanyNote {
  id: string;
  authorId: string;
  authorFirstName: string;
  authorLastName: string;
  authorRole: string;
  projectId: string | null;
  projectName: string | null;
  projectCode: string | null;
  text: string;
  createdAt: string;
}

interface Project {
  id: string;
  name: string;
  code: string;
}

interface User {
  id: string;
  firstName: string;
  lastName: string;
  role?: string;
}

export default function CompanyCommunicationsPage() {
  const { toast } = useToast();
  const { user } = useAuth();
  const [newNote, setNewNote] = useState("");
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [authorFilter, setAuthorFilter] = useState<string>("all");
  const [projectFilter, setProjectFilter] = useState<string>("all");
  const [startDateFilter, setStartDateFilter] = useState<string>("");
  const [endDateFilter, setEndDateFilter] = useState<string>("");
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");

  // Fetch all projects for filter dropdown and note creation
  const { data: projectsResponse } = useQuery<{ data: Project[] }>({
    queryKey: ["/api/projects"],
  });
  const projects = projectsResponse?.data || [];

  // Fetch all users for filter dropdown
  const { data: allUsers = [] } = useQuery<User[]>({
    queryKey: ["/api/users"],
  });

  // Build query params for filtering
  const queryParams = new URLSearchParams();
  if (authorFilter && authorFilter !== "all") {
    queryParams.append("authorId", authorFilter);
  }
  if (projectFilter && projectFilter !== "all") {
    queryParams.append("projectId", projectFilter);
  }
  if (startDateFilter) {
    queryParams.append("startDate", startDateFilter);
  }
  if (endDateFilter) {
    queryParams.append("endDate", endDateFilter);
  }

  const queryString = queryParams.toString();

  // Fetch company notes
  const { data: notes = [], isLoading } = useQuery<CompanyNote[]>({
    queryKey: ["/api/company-notes", queryString],
  });

  // Create note mutation
  const createNoteMutation = useMutation({
    mutationFn: async (noteData: { text: string; projectId?: string | null }) => {
      return apiRequest("POST", "/api/company-notes", noteData);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/company-notes"] });
      setNewNote("");
      setSelectedProjectId(null);
      toast({
        title: "Note Added",
        description: "Your daily communication has been posted successfully.",
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

  // Update note mutation
  const updateNoteMutation = useMutation({
    mutationFn: async ({ noteId, text }: { noteId: string; text: string }) => {
      return apiRequest("PATCH", `/api/company-notes/${noteId}`, { text });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/company-notes"] });
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

  const handleSubmit = () => {
    if (newNote.trim()) {
      createNoteMutation.mutate({
        text: newNote,
        projectId: selectedProjectId || undefined,
      });
    }
  };

  const startEditing = (note: CompanyNote) => {
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

  const canEditNote = (note: CompanyNote) => {
    if (!user) return false;
    return user.id === note.authorId || user.role === "ADMIN";
  };

  const clearFilters = () => {
    setAuthorFilter("all");
    setProjectFilter("all");
    setStartDateFilter("");
    setEndDateFilter("");
  };

  const hasActiveFilters = authorFilter !== "all" || projectFilter !== "all" || startDateFilter || endDateFilter;

  return (
    <div className="px-3 sm:px-6 py-6 space-y-6 mx-auto">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <MessageSquare className="w-8 h-8 text-primary" />
          <div>
            <h1 className="text-3xl font-bold" data-testid="heading-company-communications">Bulletins</h1>
            <p className="text-sm text-muted-foreground">Daily updates and notes from across the company</p>
          </div>
        </div>
        <div className="flex gap-2">
          <Link href="/">
            <Button variant="outline" className="gap-2" data-testid="button-back-to-dashboard">
              <Home className="w-4 h-4" />
              Dashboard
            </Button>
          </Link>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Post Daily Update</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="note-text">Message</Label>
            <Textarea
              id="note-text"
              placeholder="Share today's progress, updates, or important information with the team..."
              value={newNote}
              onChange={(e) => setNewNote(e.target.value)}
              className="min-h-24"
              data-testid="textarea-company-note"
              disabled={createNoteMutation.isPending}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="project-select">Related Project (Optional)</Label>
            <Select
              value={selectedProjectId || "none"}
              onValueChange={(value) => setSelectedProjectId(value === "none" ? null : value)}
              disabled={createNoteMutation.isPending}
            >
              <SelectTrigger id="project-select" data-testid="select-project">
                <SelectValue placeholder="Select a project" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No specific project</SelectItem>
                {projects.map((project) => (
                  <SelectItem key={project.id} value={project.id}>
                    {project.code} - {project.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button 
            onClick={handleSubmit} 
            data-testid="button-add-company-note"
            disabled={!newNote.trim() || createNoteMutation.isPending}
          >
            {createNoteMutation.isPending ? "Posting..." : "Post Update"}
          </Button>
        </CardContent>
      </Card>

      {/* AI Insights Section */}
      <AIInsights 
        roleFiltered={false} 
        limit={20} 
        title="AI-Generated Insights from Daily Notes"
        showProject={true}
      />

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4 space-y-0 pb-4">
          <CardTitle>Recent Bulletins</CardTitle>
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
                <h4 className="text-sm font-medium">Filter Bulletins</h4>
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
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="author-filter">Author</Label>
                  <Select
                    value={authorFilter}
                    onValueChange={setAuthorFilter}
                  >
                    <SelectTrigger id="author-filter" data-testid="select-author-filter">
                      <SelectValue placeholder="All Authors" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Authors</SelectItem>
                      {allUsers.map((user) => (
                        <SelectItem key={user.id} value={user.id}>
                          {user.firstName} {user.lastName} - {user.role}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="project-filter">Project</Label>
                  <Select
                    value={projectFilter}
                    onValueChange={setProjectFilter}
                  >
                    <SelectTrigger id="project-filter" data-testid="select-project-filter">
                      <SelectValue placeholder="All Projects" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Projects</SelectItem>
                      {projects.map((project) => (
                        <SelectItem key={project.id} value={project.id}>
                          {project.code} - {project.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="start-date-filter">Start Date</Label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
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
                <p className="text-sm text-muted-foreground">Loading bulletins...</p>
              </div>
            ) : notes.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">
                {hasActiveFilters 
                  ? "No bulletins match your filters. Try adjusting or clearing them."
                  : "No bulletins yet. Be the first to post an update above."}
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
                    data-testid={`company-note-${note.id}`}
                  >
                    <Avatar className="w-10 h-10 shrink-0">
                      <ColoredAvatarFallback className="text-xs" name={`${note.authorFirstName} ${note.authorLastName}`} />
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <div className="flex-1">
                          <p className="font-medium text-sm" data-testid={`note-author-${note.id}`}>
                            {note.authorFirstName} {note.authorLastName}
                          </p>
                          <p className="text-xs text-muted-foreground">{note.authorRole}</p>
                          {note.projectCode && note.projectName && (
                            <div className="flex items-center gap-1 mt-1">
                              <Building2 className="w-3 h-3 text-muted-foreground" />
                              <Badge variant="outline" className="text-xs" data-testid={`note-project-${note.id}`}>
                                {note.projectName} - {note.projectCode}
                              </Badge>
                            </div>
                          )}
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
                              data-testid={`button-edit-company-note-${note.id}`}
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
                            data-testid={`textarea-edit-company-note-${note.id}`}
                            disabled={updateNoteMutation.isPending}
                          />
                          <div className="flex gap-2">
                            <Button
                              size="sm"
                              onClick={saveEdit}
                              disabled={!editText.trim() || updateNoteMutation.isPending}
                              data-testid={`button-save-company-note-${note.id}`}
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
                              data-testid={`button-cancel-edit-company-note-${note.id}`}
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
