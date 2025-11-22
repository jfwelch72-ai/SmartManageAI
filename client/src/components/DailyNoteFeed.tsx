import { useState } from "react";
import { format } from "date-fns";
import { Calendar, User, Filter, X } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";

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

interface DailyNoteFeedProps {
  projectId: string;
  availableUsers?: Array<{ id: string; firstName: string; lastName: string }>;
}

export default function DailyNoteFeed({ projectId, availableUsers }: DailyNoteFeedProps) {
  const { toast } = useToast();
  const [newNote, setNewNote] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [authorFilter, setAuthorFilter] = useState<string>("all");
  const [startDateFilter, setStartDateFilter] = useState<string>("");
  const [endDateFilter, setEndDateFilter] = useState<string>("");

  // Build query params
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

  // Fetch notes
  const { data: notes = [], isLoading } = useQuery<ProjectNote[]>({
    queryKey: ["/api/projects", projectId, "notes", queryString],
    enabled: !!projectId,
  });

  // Create note mutation
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

  const handleSubmit = () => {
    if (newNote.trim()) {
      createNoteMutation.mutate(newNote);
    }
  };

  const clearFilters = () => {
    setAuthorFilter("all");
    setStartDateFilter("");
    setEndDateFilter("");
  };

  const hasActiveFilters = authorFilter !== "all" || startDateFilter || endDateFilter;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Add Daily Note</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Textarea
            placeholder="Document today's progress, issues, or important updates..."
            value={newNote}
            onChange={(e) => setNewNote(e.target.value)}
            className="min-h-24"
            data-testid="textarea-daily-note"
            disabled={createNoteMutation.isPending}
          />
          <Button 
            onClick={handleSubmit} 
            data-testid="button-add-daily-note"
            disabled={!newNote.trim() || createNoteMutation.isPending}
          >
            {createNoteMutation.isPending ? "Adding..." : "Add Note"}
          </Button>
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
                            {user.firstName} {user.lastName}
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
                  <input
                    id="start-date-filter"
                    type="date"
                    value={startDateFilter}
                    onChange={(e) => setStartDateFilter(e.target.value)}
                    className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors"
                    data-testid="input-start-date-filter"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="end-date-filter">End Date</Label>
                  <input
                    id="end-date-filter"
                    type="date"
                    value={endDateFilter}
                    onChange={(e) => setEndDateFilter(e.target.value)}
                    className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors"
                    data-testid="input-end-date-filter"
                  />
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
                const initials = `${note.authorFirstName[0]}${note.authorLastName[0]}`.toUpperCase();
                const noteDate = new Date(note.createdAt);

                return (
                  <div
                    key={note.id}
                    className="flex gap-4 p-4 border rounded-md hover-elevate"
                    data-testid={`note-${note.id}`}
                  >
                    <Avatar className="w-10 h-10 shrink-0">
                      <AvatarFallback className="text-xs">{initials}</AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <div>
                          <p className="font-medium text-sm" data-testid={`note-author-${note.id}`}>
                            {note.authorFirstName} {note.authorLastName}
                          </p>
                          <p className="text-xs text-muted-foreground">{note.authorRole}</p>
                        </div>
                        <div className="text-right shrink-0">
                          <p className="text-xs text-muted-foreground" data-testid={`note-date-${note.id}`}>
                            {format(noteDate, "MMM d, yyyy")}
                          </p>
                          <p className="text-xs text-muted-foreground" data-testid={`note-time-${note.id}`}>
                            {format(noteDate, "h:mm a")}
                          </p>
                        </div>
                      </div>
                      <p className="text-sm text-card-foreground whitespace-pre-wrap" data-testid={`note-text-${note.id}`}>
                        {note.text}
                      </p>
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
