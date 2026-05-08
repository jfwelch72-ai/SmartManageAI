import { useState, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog,
  DialogContent,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  ChevronDown,
  ChevronRight,
  Plus,
  Paperclip,
  Trash2,
  Calendar,
  Clock,
  MessageSquare,
  FileText,
  CheckSquare,
  Bold,
  Italic,
  Underline,
  Strikethrough,
  List,
  ListOrdered,
  Image,
  Link,
  Code,
  Quote,
} from "lucide-react";
import { format } from "date-fns";
import { EntityDiscussion } from "@/components/messaging/EntityDiscussion";

export interface TaskData {
  id: string;
  title: string;
  description?: string | null;
  category: string;
  priority: string;
  status: string;
  createdById?: string;
  createdByFirstName?: string | null;
  createdByLastName?: string | null;
  assignedToId?: string | null;
  assignedToFirstName?: string | null;
  assignedToLastName?: string | null;
  dueDate?: string | null;
  createdAt?: string;
  updatedAt?: string;
  projectName?: string | null;
  projectCode?: string | null;
  dismissReason?: string | null;
}

interface SubtaskData {
  id: string;
  taskId: string;
  title: string;
  completed: boolean;
  createdById: string;
  createdAt: string;
  updatedAt: string;
}

interface CommentData {
  id: string;
  taskId: string;
  content: string;
  createdById: string;
  createdByFirstName: string | null;
  createdByLastName: string | null;
  createdAt: string;
  updatedAt: string;
}

interface AttachmentData {
  id: string;
  taskId: string;
  fileName: string;
  fileUrl: string;
  fileSize: number | null;
  mimeType: string | null;
  uploadedById: string;
  uploadedByFirstName: string | null;
  uploadedByLastName: string | null;
  createdAt: string;
}

interface TaskDetailModalProps {
  task: TaskData;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onStatusUpdate: (taskId: string, status: string, dismissReason?: string) => void;
  isUpdating: boolean;
}

export default function TaskDetailModal({ task, open, onOpenChange, onStatusUpdate, isUpdating }: TaskDetailModalProps) {
  const { toast } = useToast();
  const [attachmentsOpen, setAttachmentsOpen] = useState(true);
  const [subtasksOpen, setSubtasksOpen] = useState(true);
  const [newSubtaskTitle, setNewSubtaskTitle] = useState("");
  const [newComment, setNewComment] = useState("");
  const attachmentFileRef = useRef<HTMLInputElement>(null);
  const commentFileRef = useRef<HTMLInputElement>(null);

  const { data: subtasks = [], isLoading: subtasksLoading } = useQuery<SubtaskData[]>({
    queryKey: ["/api/tasks", task?.id, "subtasks"],
    queryFn: async () => {
      const res = await fetch(`/api/tasks/${task.id}/subtasks`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch subtasks");
      return res.json();
    },
    enabled: !!task?.id && open,
  });

  const { data: comments = [], isLoading: commentsLoading } = useQuery<CommentData[]>({
    queryKey: ["/api/tasks", task?.id, "comments"],
    queryFn: async () => {
      const res = await fetch(`/api/tasks/${task.id}/comments`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch comments");
      return res.json();
    },
    enabled: !!task?.id && open,
  });

  const { data: attachments = [], isLoading: attachmentsLoading } = useQuery<AttachmentData[]>({
    queryKey: ["/api/tasks", task?.id, "attachments"],
    queryFn: async () => {
      const res = await fetch(`/api/tasks/${task.id}/attachments`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch attachments");
      return res.json();
    },
    enabled: !!task?.id && open,
  });

  const addSubtaskMutation = useMutation({
    mutationFn: async (title: string) => {
      return apiRequest("POST", `/api/tasks/${task.id}/subtasks`, { title });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tasks", task.id, "subtasks"] });
      setNewSubtaskTitle("");
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to add subtask", variant: "destructive" });
    },
  });

  const toggleSubtaskMutation = useMutation({
    mutationFn: async ({ subtaskId, completed }: { subtaskId: string; completed: boolean }) => {
      return apiRequest("PATCH", `/api/tasks/${task.id}/subtasks/${subtaskId}`, { completed });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tasks", task.id, "subtasks"] });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to update subtask", variant: "destructive" });
    },
  });

  const deleteSubtaskMutation = useMutation({
    mutationFn: async (subtaskId: string) => {
      return apiRequest("DELETE", `/api/tasks/${task.id}/subtasks/${subtaskId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tasks", task.id, "subtasks"] });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to delete subtask", variant: "destructive" });
    },
  });

  const addCommentMutation = useMutation({
    mutationFn: async (content: string) => {
      return apiRequest("POST", `/api/tasks/${task.id}/comments`, { content });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tasks", task.id, "comments"] });
      setNewComment("");
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to add comment", variant: "destructive" });
    },
  });

  const deleteAttachmentMutation = useMutation({
    mutationFn: async (attachmentId: string) => {
      return apiRequest("DELETE", `/api/tasks/${task.id}/attachments/${attachmentId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tasks", task.id, "attachments"] });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to delete attachment", variant: "destructive" });
    },
  });

  const uploadFileMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch(`/api/tasks/${task.id}/attachments/upload`, {
        method: "POST",
        body: formData,
        credentials: "include",
      });
      if (!res.ok) throw new Error("Upload failed");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tasks", task.id, "attachments"] });
      toast({ title: "Success", description: "File uploaded" });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to upload file", variant: "destructive" });
    },
  });

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    uploadFileMutation.mutate(file);
    e.target.value = "";
  };

  const handleCommentFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const formData = new FormData();
    formData.append("file", file);
    const fileName = file.name;
    fetch(`/api/tasks/${task.id}/attachments/upload`, {
      method: "POST",
      body: formData,
      credentials: "include",
    })
      .then((res) => {
        if (!res.ok) throw new Error("Upload failed");
        return res.json();
      })
      .then(() => {
        queryClient.invalidateQueries({ queryKey: ["/api/tasks", task.id, "attachments"] });
        setAttachmentsOpen(true);
        setNewComment(prev => prev ? `${prev}\n[Attached: ${fileName}]` : `[Attached: ${fileName}]`);
        toast({ title: "File attached", description: `"${fileName}" added to task attachments` });
      })
      .catch(() => {
        toast({ title: "Error", description: "Failed to upload file", variant: "destructive" });
      });
    e.target.value = "";
  };

  if (!task) return null;

  const getCategoryLabel = (category: string) => category.replace(/_/g, " ");

  const getStatusLabel = (status: string) => {
    switch (status) {
      case "COMPLETED": return "COMPLETED";
      case "IN_PROGRESS": return "IN PROGRESS";
      case "DISMISSED": return "DISMISSED";
      case "PENDING": return "OPEN";
      default: return status;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "COMPLETED": return "text-green-600 dark:text-green-400";
      case "IN_PROGRESS": return "text-blue-600 dark:text-blue-400";
      case "DISMISSED": return "text-gray-500 dark:text-gray-400";
      default: return "text-amber-600 dark:text-amber-400";
    }
  };

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case "CRITICAL": return "text-red-600 dark:text-red-400";
      case "HIGH": return "text-orange-600 dark:text-orange-400";
      case "MEDIUM": return "text-amber-600 dark:text-amber-400";
      case "LOW": return "text-gray-600 dark:text-gray-400";
      default: return "text-gray-600";
    }
  };

  const completedSubtasks = subtasks.filter((s) => s.completed).length;
  const totalSubtasks = subtasks.length;

  const formatFileSize = (bytes: number | null) => {
    if (!bytes) return "";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const toolbarButtons = [
    { icon: Bold, label: "Bold" },
    { icon: Italic, label: "Italic" },
    { icon: Underline, label: "Underline" },
    { icon: Strikethrough, label: "Strikethrough" },
    { icon: List, label: "Bullet List" },
    { icon: ListOrdered, label: "Ordered List" },
    { icon: Image, label: "Image" },
    { icon: Link, label: "Link" },
    { icon: Code, label: "Code" },
    { icon: Quote, label: "Quote" },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-4xl max-h-[90vh] overflow-hidden p-0" data-testid="task-detail-modal">
        <div className="flex flex-col md:flex-row h-full max-h-[90vh]">
          <div className="flex-1 overflow-y-auto p-6 border-r border-border" data-testid="task-detail-main">
            <div className="mb-4">
              <h2 className="text-xl font-bold mb-2" data-testid="task-detail-title">{task.title}</h2>
              <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                <Badge variant="secondary" data-testid="task-detail-category-badge">
                  {getCategoryLabel(task.category)}
                </Badge>
                <span data-testid="task-detail-id">#{task.id.slice(0, 8)}</span>
                <span>
                  Created by {task.createdByFirstName} {task.createdByLastName}{task.createdAt ? ` on ${format(new Date(task.createdAt), "MMM d, yyyy")}` : ""}
                </span>
              </div>
              {task.description && (
                <p className="mt-3 text-sm text-muted-foreground" data-testid="task-detail-description">
                  {task.description}
                </p>
              )}
            </div>

            <Collapsible open={attachmentsOpen} onOpenChange={setAttachmentsOpen} className="mb-4">
              <div className="flex items-center justify-between">
                <CollapsibleTrigger className="flex items-center gap-2 text-sm font-semibold hover:text-foreground" data-testid="toggle-attachments">
                  {attachmentsOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                  <Paperclip className="h-4 w-4" />
                  Attachments ({attachments.length})
                </CollapsibleTrigger>
                <div>
                  <input type="file" ref={attachmentFileRef} className="hidden" onChange={handleFileUpload} data-testid="input-attachment-file" />
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => attachmentFileRef.current?.click()}
                    data-testid="button-add-attachment"
                  >
                    <Plus className="h-3 w-3 mr-1" /> Add
                  </Button>
                </div>
              </div>
              <CollapsibleContent className="mt-2">
                {attachmentsLoading ? (
                  <p className="text-sm text-muted-foreground">Loading...</p>
                ) : attachments.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-2" data-testid="empty-attachments">No attachments yet</p>
                ) : (
                  <div className="space-y-2">
                    {attachments.map((attachment) => (
                      <div key={attachment.id} className="flex items-center justify-between p-2 rounded-md border bg-muted/30" data-testid={`attachment-${attachment.id}`}>
                        <div className="flex items-center gap-2 min-w-0">
                          <FileText className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
                          <div className="min-w-0">
                            <p className="text-sm font-medium truncate">{attachment.fileName}</p>
                            {attachment.fileSize && (
                              <p className="text-xs text-muted-foreground">{formatFileSize(attachment.fileSize)}</p>
                            )}
                          </div>
                        </div>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => deleteAttachmentMutation.mutate(attachment.id)}
                          disabled={deleteAttachmentMutation.isPending}
                          data-testid={`button-delete-attachment-${attachment.id}`}
                        >
                          <Trash2 className="h-3 w-3 text-muted-foreground" />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </CollapsibleContent>
            </Collapsible>

            <Collapsible open={subtasksOpen} onOpenChange={setSubtasksOpen} className="mb-4">
              <CollapsibleTrigger className="flex items-center gap-2 text-sm font-semibold hover:text-foreground" data-testid="toggle-subtasks">
                {subtasksOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                <CheckSquare className="h-4 w-4" />
                Subtasks ({completedSubtasks}/{totalSubtasks})
              </CollapsibleTrigger>
              <CollapsibleContent className="mt-2">
                {subtasksLoading ? (
                  <p className="text-sm text-muted-foreground">Loading...</p>
                ) : (
                  <div className="space-y-2">
                    {subtasks.map((subtask) => (
                      <div key={subtask.id} className="flex items-center gap-2 group" data-testid={`subtask-${subtask.id}`}>
                        <Checkbox
                          checked={subtask.completed}
                          onCheckedChange={(checked) =>
                            toggleSubtaskMutation.mutate({ subtaskId: subtask.id, completed: !!checked })
                          }
                          data-testid={`checkbox-subtask-${subtask.id}`}
                        />
                        <span className={`text-sm flex-1 ${subtask.completed ? "line-through text-muted-foreground" : ""}`}>
                          {subtask.title}
                        </span>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="opacity-0 group-hover:opacity-100 h-6 w-6 p-0"
                          onClick={() => deleteSubtaskMutation.mutate(subtask.id)}
                          data-testid={`button-delete-subtask-${subtask.id}`}
                        >
                          <Trash2 className="h-3 w-3 text-muted-foreground" />
                        </Button>
                      </div>
                    ))}
                    <div className="flex items-center gap-2 mt-2">
                      <Input
                        placeholder="Add a subtask..."
                        value={newSubtaskTitle}
                        onChange={(e) => setNewSubtaskTitle(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && newSubtaskTitle.trim()) {
                            addSubtaskMutation.mutate(newSubtaskTitle.trim());
                          }
                        }}
                        className="text-sm h-8"
                        data-testid="input-new-subtask"
                      />
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={!newSubtaskTitle.trim() || addSubtaskMutation.isPending}
                        onClick={() => {
                          if (newSubtaskTitle.trim()) addSubtaskMutation.mutate(newSubtaskTitle.trim());
                        }}
                        data-testid="button-add-subtask"
                      >
                        <Plus className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                )}
              </CollapsibleContent>
            </Collapsible>

            {task && <EntityDiscussion entityType="TASK" entityId={task.id} />}

            <div className="mt-4" data-testid="task-detail-comments-section">
              <div className="flex items-center gap-1 text-sm font-semibold mb-3">
                <MessageSquare className="h-4 w-4" />
                Comments
              </div>
              {commentsLoading ? (
                <p className="text-sm text-muted-foreground">Loading comments...</p>
              ) : comments.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4" data-testid="empty-comments">No comments yet</p>
              ) : (
                <div className="space-y-3 mb-4 max-h-[200px] overflow-y-auto">
                  {comments.map((comment) => (
                    <div key={comment.id} className="p-3 rounded-md border bg-muted/20" data-testid={`comment-${comment.id}`}>
                      <div className="flex items-center gap-2 mb-1">
                        <div className="h-6 w-6 rounded-full bg-primary/10 flex items-center justify-center text-xs font-medium text-primary">
                          {comment.createdByFirstName?.[0]}{comment.createdByLastName?.[0]}
                        </div>
                        <span className="text-sm font-medium">
                          {comment.createdByFirstName} {comment.createdByLastName}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {format(new Date(comment.createdAt), "MMM d, yyyy 'at' h:mm a")}
                        </span>
                      </div>
                      <p className="text-sm pl-8">{comment.content}</p>
                    </div>
                  ))}
                </div>
              )}
              <div className="space-y-0">
                <div className="flex items-center gap-0.5 p-1.5 border border-b-0 rounded-t-md bg-muted/30" data-testid="comment-toolbar">
                  {toolbarButtons.map(({ icon: Icon, label }) => (
                    <button
                      key={label}
                      type="button"
                      title={label}
                      className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                      data-testid={`toolbar-${label.toLowerCase().replace(/\s+/g, "-")}`}
                    >
                      <Icon className="h-3.5 w-3.5" />
                    </button>
                  ))}
                </div>
                <Textarea
                  placeholder="Write a comment..."
                  value={newComment}
                  onChange={(e) => setNewComment(e.target.value)}
                  className="min-h-[80px] text-sm rounded-t-none border-t-0"
                  data-testid="input-new-comment"
                />
                <div className="flex items-center justify-between mt-4">
                  <div>
                    <input type="file" ref={commentFileRef} className="hidden" onChange={handleCommentFileUpload} data-testid="input-comment-attachment" />
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => commentFileRef.current?.click()}
                      data-testid="button-attach-files"
                    >
                      <Paperclip className="h-3 w-3 mr-1" />
                      Attach Files
                    </Button>
                  </div>
                  <Button
                    size="sm"
                    disabled={!newComment.trim() || addCommentMutation.isPending}
                    onClick={() => {
                      if (newComment.trim()) addCommentMutation.mutate(newComment.trim());
                    }}
                    data-testid="button-add-comment"
                  >
                    {addCommentMutation.isPending ? "Adding..." : "Add Comment"}
                  </Button>
                </div>
              </div>
            </div>
          </div>

          <div className="w-full md:w-[260px] flex-shrink-0 p-6 overflow-y-auto bg-muted/20" data-testid="task-detail-sidebar">

            <div className="space-y-5">
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">Status</p>
                <p className={`text-sm font-bold ${getStatusColor(task.status)}`} data-testid="task-detail-status">
                  {getStatusLabel(task.status)}
                </p>
              </div>

              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">Priority</p>
                <p className={`text-sm font-bold ${getPriorityColor(task.priority)}`} data-testid="task-detail-priority">
                  {task.priority}
                </p>
              </div>

              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">Category</p>
                <p className="text-sm" data-testid="task-detail-category">{getCategoryLabel(task.category)}</p>
              </div>

              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">Assignee</p>
                {task.assignedToFirstName ? (
                  <div className="flex items-center gap-2" data-testid="task-detail-assignee">
                    <div className="h-6 w-6 rounded-full bg-blue-100 dark:bg-blue-900 flex items-center justify-center text-xs font-medium text-blue-700 dark:text-blue-300">
                      {task.assignedToFirstName[0]}{task.assignedToLastName?.[0]}
                    </div>
                    <span className="text-sm text-blue-600 dark:text-blue-400 font-medium">
                      {task.assignedToFirstName} {task.assignedToLastName}
                    </span>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground" data-testid="task-detail-assignee">Unassigned</p>
                )}
              </div>

              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">Dates</p>
                <div className="space-y-1">
                  <div className="flex items-center gap-1 text-sm" data-testid="task-detail-created-date">
                    <Calendar className="h-3 w-3 text-muted-foreground" />
                    <span>Created: {task.createdAt ? format(new Date(task.createdAt), "MMM d, yyyy") : "—"}</span>
                  </div>
                  {task.dueDate && (
                    <div className="flex items-center gap-1 text-sm" data-testid="task-detail-due-date">
                      <Clock className="h-3 w-3 text-muted-foreground" />
                      <span>Due: {format(new Date(task.dueDate), "MMM d, yyyy")}</span>
                    </div>
                  )}
                </div>
              </div>

              <div className="pt-3 border-t border-border space-y-2">
                {task.status === "PENDING" && (
                  <Button
                    size="sm"
                    className="w-full"
                    onClick={() => onStatusUpdate(task.id, "IN_PROGRESS")}
                    disabled={isUpdating}
                    data-testid="button-modal-start-task"
                  >
                    Start Working
                  </Button>
                )}
                {task.status === "IN_PROGRESS" && (
                  <>
                    <Button
                      size="sm"
                      className="w-full"
                      onClick={() => onStatusUpdate(task.id, "COMPLETED")}
                      disabled={isUpdating}
                      data-testid="button-modal-complete-task"
                    >
                      Mark Complete
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="w-full"
                      onClick={() => onStatusUpdate(task.id, "DISMISSED")}
                      disabled={isUpdating}
                      data-testid="button-modal-dismiss-task"
                    >
                      Dismiss
                    </Button>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
