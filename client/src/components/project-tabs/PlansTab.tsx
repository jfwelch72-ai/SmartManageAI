import { useState, useMemo, useCallback } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ObjectUploader } from "@/components/ObjectUploader";
import TakeoffWorkspace from "@/components/TakeoffWorkspace";
import DocumentRevisionPanel from "@/components/DocumentRevisionPanel";
import ProjectAddenda from "@/components/ProjectAddenda";
import {
  Upload, Download, Eye, FileText, Trash2, FolderOpen, Folder, ChevronRight, ChevronDown,
  Search, MoreVertical, File, Plus, Pencil, GripVertical, ArrowRight, Copy
} from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubTrigger, DropdownMenuSubContent } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { useProjectDocuments } from "@/hooks/use-data";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import type { TakeoffSheet } from "@shared/schema";
import { cn } from "@/lib/utils";
import LibraryPanel from "@/components/LibraryPanel";

interface PlansTabProps {
  projectCode: string;
  project: any;
}

type SubTab = "plans" | "addenda" | "libraries";

interface DocGroup {
  name: string;
  expanded: boolean;
  types: string[];
}

const DEFAULT_GROUPS: DocGroup[] = [
  { name: "Plans", expanded: true, types: ["PLANS"] },
  { name: "Specifications", expanded: true, types: ["SPECS"] },
  { name: "Takeoff", expanded: false, types: ["TAKEOFF"] },
  { name: "Supporting Documents", expanded: true, types: ["OTHER"] },
];

export default function PlansTab({ projectCode, project }: PlansTabProps) {
  const { user } = useAuth();
  const { toast } = useToast();

  const { data: documents = [], isLoading: documentsLoading } = useProjectDocuments(projectCode);
  const { data: sheets = [] } = useQuery<TakeoffSheet[]>({
    queryKey: ["/api/projects", project?.id, "takeoff", "sheets"],
    enabled: !!project?.id,
  });

  const [subTab, setSubTab] = useState<SubTab>("plans");
  const [showDocumentDialog, setShowDocumentDialog] = useState(false);
  const [documentTitle, setDocumentTitle] = useState("");
  const [documentType, setDocumentType] = useState<"PLANS" | "SPECS" | "TAKEOFF" | "OTHER">("OTHER");
  const [isUploadingDocument, setIsUploadingDocument] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [groups, setGroups] = useState(DEFAULT_GROUPS);
  const [selectedDocId, setSelectedDocId] = useState<string | null>(null);
  const [leftPanelCollapsed, setLeftPanelCollapsed] = useState(() => typeof window !== 'undefined' ? window.innerWidth < 768 : false);
  const [deleteDocId, setDeleteDocId] = useState<string | null>(null);
  const [sheetFolderGroups, setSheetFolderGroups] = useState<Record<string, boolean>>({ Plans: true, "Supporting Documents": true });
  const [draggedSheetId, setDraggedSheetId] = useState<string | null>(null);
  const [dragOverGroup, setDragOverGroup] = useState<string | null>(null);
  const [renameSheetId, setRenameSheetId] = useState<string | null>(null);
  const [renameSheetValue, setRenameSheetValue] = useState("");
  const [deleteSheetId, setDeleteSheetId] = useState<string | null>(null);

  const SHEET_FOLDER_NAMES = ["Plans", "Supporting Documents"];

  const moveSheetMutation = useMutation({
    mutationFn: async ({ sheetId, folderGroup }: { sheetId: string; folderGroup: string }) => {
      const res = await apiRequest("PATCH", `/api/takeoff/sheets/${sheetId}/folder-group`, { folderGroup });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", project?.id, "takeoff", "sheets"] });
    },
  });

  const renameSheetMutation = useMutation({
    mutationFn: async ({ sheetId, sheetName }: { sheetId: string; sheetName: string }) => {
      const res = await apiRequest("PATCH", `/api/takeoff/sheets/${sheetId}/rename`, { sheetName });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", project?.id, "takeoff", "sheets"] });
      setRenameSheetId(null);
      setRenameSheetValue("");
      toast({ title: "Sheet renamed" });
    },
  });

  const duplicateSheetMutation = useMutation({
    mutationFn: async (sheetId: string) => {
      const res = await apiRequest("POST", `/api/takeoff/sheets/${sheetId}/duplicate`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", project?.id, "takeoff", "sheets"] });
      toast({ title: "Sheet duplicated" });
    },
  });

  const deleteSheetMutation = useMutation({
    mutationFn: async (sheetId: string) => {
      await apiRequest("DELETE", `/api/takeoff/sheets/${sheetId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", project?.id, "takeoff", "sheets"] });
      setDeleteSheetId(null);
      toast({ title: "Sheet deleted" });
    },
  });

  const groupedSheets = useMemo(() => {
    const result: Record<string, TakeoffSheet[]> = {};
    for (const name of SHEET_FOLDER_NAMES) {
      result[name] = [];
    }
    for (const sheet of sheets) {
      const group = (sheet as any).folderGroup || "Plans";
      if (!result[group]) result[group] = [];
      result[group].push(sheet);
    }
    return result;
  }, [sheets]);

  const handleSheetDragStart = useCallback((e: any, sheetId: string) => {
    setDraggedSheetId(sheetId);
    e.dataTransfer.effectAllowed = "move";
  }, []);

  const handleSheetDragOver = useCallback((e: any, groupName: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOverGroup(groupName);
  }, []);

  const handleSheetDrop = useCallback((e: any, groupName: string) => {
    e.preventDefault();
    setDragOverGroup(null);
    if (draggedSheetId) {
      moveSheetMutation.mutate({ sheetId: draggedSheetId, folderGroup: groupName });
      setDraggedSheetId(null);
    }
  }, [draggedSheetId, moveSheetMutation]);

  const toggleSheetGroup = useCallback((name: string) => {
    setSheetFolderGroups(prev => ({ ...prev, [name]: !prev[name] }));
  }, []);

  const groupedDocuments = useMemo(() => {
    const filtered = searchQuery
      ? documents.filter((d: any) =>
          (d.title || d.fileName || "").toLowerCase().includes(searchQuery.toLowerCase())
        )
      : documents;

    return groups.map((group) => ({
      ...group,
      docs: filtered.filter((d: any) => group.types.includes(d.type)),
    }));
  }, [documents, searchQuery, groups]);

  const toggleGroup = (name: string) => {
    setGroups((prev) =>
      prev.map((g) => (g.name === name ? { ...g, expanded: !g.expanded } : g))
    );
  };

  const selectedDoc = documents.find((d: any) => d.id === selectedDocId);

  const onGetUploadParameters = async () => {
    try {
      const response = await apiRequest("POST", "/api/objects/upload");
      const data = await response.json();
      return { method: "PUT" as const, url: data.uploadURL };
    } catch (error) {
      toast({ title: "Error", description: "Failed to get upload URL", variant: "destructive" });
      throw error;
    }
  };

  const handleDocumentUploadComplete = async (result: any) => {
    if (!result.successful || result.successful.length === 0) {
      toast({ title: "Error", description: "File upload failed", variant: "destructive" });
      setIsUploadingDocument(false);
      return;
    }

    const uploadedFile = result.successful[0];
    const fileUrl = uploadedFile.uploadURL;
    const fileName = uploadedFile.name;
    const fileSize = uploadedFile.size;
    const mimeType = uploadedFile.type;

    try {
      await apiRequest("POST", "/api/documents", {
        projectId: project?.id,
        title: documentTitle,
        type: documentType,
        fileUrl,
        fileName,
        fileSize,
        mimeType,
      });
      await queryClient.invalidateQueries({ queryKey: ["/api/projects", projectCode, "documents"] });
      toast({ title: "Success", description: "Document uploaded successfully" });
      setShowDocumentDialog(false);
      setDocumentTitle("");
      setDocumentType("OTHER");
    } catch (error) {
      toast({ title: "Error", description: "Failed to save document", variant: "destructive" });
    } finally {
      setIsUploadingDocument(false);
    }
  };

  const handleDeleteDocument = async (docId: string) => {
    try {
      await apiRequest("DELETE", `/api/documents/${docId}`);
      toast({ title: "Success", description: "Document deleted" });
      await queryClient.invalidateQueries({ queryKey: ["/api/projects", projectCode, "documents"] });
      await queryClient.invalidateQueries({ queryKey: ["/api/projects", project?.id, "takeoff", "sheets"] });
      if (selectedDocId === docId) setSelectedDocId(null);
    } catch (error: any) {
      toast({ title: "Error", description: error?.message || "Failed to delete document", variant: "destructive" });
    }
    setDeleteDocId(null);
  };

  const handleImportToTakeoff = async (docId: string) => {
    try {
      await apiRequest("POST", `/api/projects/${project!.id}/takeoff/import-plan`, { documentId: docId });
      toast({ title: "Success", description: "Plan imported to takeoff workspace" });
      await queryClient.invalidateQueries({ queryKey: ["/api/projects", project!.id, "takeoff", "sheets"] });
    } catch (error: any) {
      toast({ title: "Error", description: error?.message || "Failed to import plan", variant: "destructive" });
    }
  };

  return (
      <div className="flex flex-col h-[calc(100vh-200px)]">
      <div className="border-b flex items-center gap-1 px-2 py-1 bg-card shrink-0">
        <Button
          variant={subTab === "plans" ? "default" : "ghost"}
          size="sm"
          onClick={() => setSubTab("plans")}
          data-testid="tab-plans"
        >
          Plans
        </Button>
        <Button
          variant={subTab === "addenda" ? "default" : "ghost"}
          size="sm"
          onClick={() => setSubTab("addenda")}
          data-testid="tab-addenda"
        >
          Addenda
        </Button>
        <Button
          variant={subTab === "libraries" ? "default" : "ghost"}
          size="sm"
          onClick={() => setSubTab("libraries")}
          data-testid="tab-libraries"
        >
          Libraries
        </Button>
      </div>

      {subTab === "addenda" && project && (
        <div className="flex-1 overflow-auto p-4">
          <ProjectAddenda
            projectId={project.id}
            projectCode={project.code}
            userRole={user?.role || ""}
          />
        </div>
      )}

      {subTab === "libraries" && project && (
        <div className="flex-1 min-h-0">
          <LibraryPanel projectId={project.id} />
        </div>
      )}

      {subTab === "plans" && project && (
        <div className="flex flex-1 min-h-0 relative">
          {!leftPanelCollapsed && (
            <div className="absolute inset-0 z-20 md:relative md:inset-auto w-full md:w-64 bg-card border-r flex flex-col shrink-0">
              <div className="p-2 border-b space-y-2">
                <div className="flex items-center gap-1">
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8 shrink-0 md:hidden"
                    onClick={() => setLeftPanelCollapsed(true)}
                    data-testid="button-close-panel-mobile"
                  >
                    <ChevronDown className="w-4 h-4 rotate-90" />
                  </Button>
                  <div className="relative flex-1">
                    <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                    <Input
                      placeholder="Search..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="h-8 pl-7 text-sm"
                      data-testid="input-search-documents"
                    />
                  </div>
                  <Dialog open={showDocumentDialog} onOpenChange={setShowDocumentDialog}>
                    <DialogTrigger asChild>
                          <Button size="icon" variant="default" className="h-8 w-8 shrink-0" data-testid="button-upload-document" title="Upload Document">
                            <Upload className="w-4 h-4" />
                          </Button>
                    </DialogTrigger>
                    <DialogContent data-testid="dialog-upload-document">
                      <DialogHeader>
                        <DialogTitle>Upload Document</DialogTitle>
                        <DialogDescription>Fill in the details below and then select a file to upload.</DialogDescription>
                      </DialogHeader>
                      <div className="space-y-4">
                        <div>
                          <Label htmlFor="document-title">Title</Label>
                          <Input
                            id="document-title"
                            value={documentTitle}
                            onChange={(e) => setDocumentTitle(e.target.value)}
                            placeholder="Enter document title..."
                            data-testid="input-document-title"
                          />
                        </div>
                        <div>
                          <Label htmlFor="document-type">Type</Label>
                          <Select
                            value={documentType}
                            onValueChange={(value: "PLANS" | "SPECS" | "TAKEOFF" | "OTHER") => setDocumentType(value)}
                          >
                            <SelectTrigger id="document-type" data-testid="select-document-type">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="PLANS">Plans</SelectItem>
                              <SelectItem value="SPECS">Specifications</SelectItem>
                              <SelectItem value="TAKEOFF">Takeoff</SelectItem>
                              <SelectItem value="OTHER">Other</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                      <DialogFooter>
                        <Button
                          variant="outline"
                          onClick={() => {
                            setShowDocumentDialog(false);
                            setDocumentTitle("");
                            setDocumentType("OTHER");
                          }}
                          data-testid="button-cancel-document"
                        >
                          Cancel
                        </Button>
                        <ObjectUploader
                          maxNumberOfFiles={1}
                          maxFileSize={104857600}
                          onGetUploadParameters={onGetUploadParameters}
                          onComplete={(result) => {
                            setIsUploadingDocument(true);
                            handleDocumentUploadComplete(result);
                          }}
                          buttonVariant="default"
                          testId="button-select-document-file"
                        >
                          {isUploadingDocument ? "Uploading..." : "Select File"}
                        </ObjectUploader>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>
                </div>
              </div>

              <ScrollArea className="flex-1">
                <div className="py-1">
                  <div className="px-2 py-1.5">
                    <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                      Documents ({documents.length})
                    </span>
                  </div>

                  {documentsLoading ? (
                    <div className="px-3 py-4 text-sm text-muted-foreground text-center">Loading...</div>
                  ) : (
                    groupedDocuments.map((group) => (
                      <div key={group.name}>
                        <button
                          className="flex items-center gap-1.5 w-full px-2 py-1.5 text-sm hover:bg-accent/50 transition-colors"
                          onClick={() => toggleGroup(group.name)}
                          data-testid={`folder-${group.name.toLowerCase().replace(/\s+/g, '-')}`}
                        >
                          {group.expanded ? (
                            <ChevronDown className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                          ) : (
                            <ChevronRight className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                          )}
                          {group.expanded ? (
                            <FolderOpen className="w-4 h-4 text-yellow-500 shrink-0" />
                          ) : (
                            <Folder className="w-4 h-4 text-yellow-500 shrink-0" />
                          )}
                          <span className="truncate font-medium">{group.name}</span>
                          <Badge variant="secondary" className="ml-auto text-[10px] h-4 px-1">
                            {group.docs.length}
                          </Badge>
                        </button>
                        {group.expanded && (
                          <div className="ml-2">
                            {group.docs.length === 0 ? (
                              <div className="px-6 py-1 text-xs text-muted-foreground italic">No files</div>
                            ) : (
                              group.docs.map((doc: any) => (
                                <div
                                  key={doc.id}
                                  className={cn(
                                    "flex items-center gap-1.5 px-3 py-1.5 text-sm cursor-pointer hover:bg-accent/50 transition-colors group",
                                    selectedDocId === doc.id && "bg-accent"
                                  )}
                                  onClick={() => setSelectedDocId(doc.id)}
                                  data-testid={`document-${doc.id}`}
                                >
                                  <File className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                                  <span className="truncate flex-1 text-sm">{doc.title || doc.fileName}</span>
                                  <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                      <Button
                                        size="icon"
                                        variant="ghost"
                                        className="h-5 w-5 opacity-0 group-hover:opacity-100 shrink-0"
                                        onClick={(e) => e.stopPropagation()}
                                        data-testid={`menu-document-${doc.id}`}
                                      >
                                        <MoreVertical className="w-3 h-3" />
                                      </Button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent align="end">
                                      <DropdownMenuItem
                                        onClick={() => window.open(doc.fileUrl, '_blank')}
                                        data-testid={`button-view-document-${doc.id}`}
                                      >
                                        <Eye className="w-4 h-4 mr-2" />
                                        View
                                      </DropdownMenuItem>
                                      <DropdownMenuItem
                                        onClick={() => {
                                          const link = document.createElement('a');
                                          link.href = doc.fileUrl;
                                          link.download = doc.fileName;
                                          document.body.appendChild(link);
                                          link.click();
                                          document.body.removeChild(link);
                                        }}
                                        data-testid={`button-download-document-${doc.id}`}
                                      >
                                        <Download className="w-4 h-4 mr-2" />
                                        Download
                                      </DropdownMenuItem>
                                      {doc.mimeType === 'application/pdf' && (
                                        <DropdownMenuItem
                                          onClick={() => handleImportToTakeoff(doc.id)}
                                          data-testid={`button-import-takeoff-${doc.id}`}
                                        >
                                          <FileText className="w-4 h-4 mr-2" />
                                          Import to Takeoff
                                        </DropdownMenuItem>
                                      )}
                                      <DropdownMenuSeparator />
                                      <DropdownMenuItem
                                        onClick={() => setDeleteDocId(doc.id)}
                                        className="text-destructive"
                                        data-testid={`button-delete-document-${doc.id}`}
                                      >
                                        <Trash2 className="w-4 h-4 mr-2" />
                                        Delete
                                      </DropdownMenuItem>
                                    </DropdownMenuContent>
                                  </DropdownMenu>
                                </div>
                              ))
                            )}
                          </div>
                        )}
                      </div>
                    ))
                  )}

                  {sheets.length > 0 && (
                    <>
                      <Separator className="my-2" />
                      <div className="px-2 py-1.5">
                        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                          Takeoff Sheets ({sheets.length})
                        </span>
                      </div>
                      {SHEET_FOLDER_NAMES.map((folderName) => {
                        const folderSheets = groupedSheets[folderName] || [];
                        const isExpanded = sheetFolderGroups[folderName] !== false;
                        return (
                          <div
                            key={folderName}
                            onDragOver={(e) => handleSheetDragOver(e, folderName)}
                            onDrop={(e) => handleSheetDrop(e, folderName)}
                            onDragLeave={() => setDragOverGroup(null)}
                            className={cn(dragOverGroup === folderName && "bg-accent/30 rounded")}
                          >
                            <button
                              className="flex items-center gap-1.5 w-full px-2 py-1.5 text-sm hover:bg-accent/50 transition-colors"
                              onClick={() => toggleSheetGroup(folderName)}
                              data-testid={`sheet-folder-${folderName.toLowerCase().replace(/\s+/g, '-')}`}
                            >
                              {isExpanded ? (
                                <ChevronDown className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                              ) : (
                                <ChevronRight className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                              )}
                              {isExpanded ? (
                                <FolderOpen className="w-4 h-4 text-blue-400 shrink-0" />
                              ) : (
                                <Folder className="w-4 h-4 text-blue-400 shrink-0" />
                              )}
                              <span className="truncate font-medium">{folderName}</span>
                              <Badge variant="secondary" className="ml-auto text-[10px] h-4 px-1">
                                {folderSheets.length}
                              </Badge>
                            </button>
                            {isExpanded && (
                              <div className="ml-2">
                                {folderSheets.length === 0 ? (
                                  <div className="px-6 py-1 text-xs text-muted-foreground italic">No sheets</div>
                                ) : (
                                  folderSheets.map((sheet) => (
                                    <div
                                      key={sheet.id}
                                      draggable
                                      onDragStart={(e) => handleSheetDragStart(e, sheet.id)}
                                      onDragEnd={() => setDraggedSheetId(null)}
                                      className={cn(
                                        "flex items-center gap-1.5 px-3 py-1.5 text-sm cursor-pointer hover:bg-accent/50 transition-colors group",
                                        draggedSheetId === sheet.id && "opacity-50"
                                      )}
                                      data-testid={`sheet-${sheet.id}`}
                                    >
                                      <GripVertical className="w-3 h-3 text-muted-foreground opacity-0 group-hover:opacity-50 shrink-0 cursor-grab" />
                                      <FileText className="w-3.5 h-3.5 text-blue-400 shrink-0" />
                                      {renameSheetId === sheet.id ? (
                                        <Input
                                          value={renameSheetValue}
                                          onChange={(e) => setRenameSheetValue(e.target.value)}
                                          onKeyDown={(e) => {
                                            if (e.key === "Enter" && renameSheetValue.trim()) {
                                              renameSheetMutation.mutate({ sheetId: sheet.id, sheetName: renameSheetValue.trim() });
                                            } else if (e.key === "Escape") {
                                              setRenameSheetId(null);
                                            }
                                          }}
                                          onBlur={() => {
                                            if (renameSheetValue.trim()) {
                                              renameSheetMutation.mutate({ sheetId: sheet.id, sheetName: renameSheetValue.trim() });
                                            } else {
                                              setRenameSheetId(null);
                                            }
                                          }}
                                          autoFocus
                                          className="h-6 text-sm flex-1 px-1"
                                          data-testid={`input-rename-sheet-${sheet.id}`}
                                        />
                                      ) : (
                                        <span className="truncate flex-1">{sheet.sheetName}</span>
                                      )}
                                      {sheet.scalePxPerFoot && renameSheetId !== sheet.id && (
                                        <Badge variant="outline" className="text-[10px] h-4 px-1 shrink-0">
                                          Cal
                                        </Badge>
                                      )}
                                      {renameSheetId !== sheet.id && (
                                        <DropdownMenu>
                                          <DropdownMenuTrigger asChild>
                                            <Button
                                              size="icon"
                                              variant="ghost"
                                              className="h-5 w-5 opacity-0 group-hover:opacity-100 shrink-0"
                                              onClick={(e) => e.stopPropagation()}
                                              data-testid={`menu-sheet-${sheet.id}`}
                                            >
                                              <MoreVertical className="w-3 h-3" />
                                            </Button>
                                          </DropdownMenuTrigger>
                                          <DropdownMenuContent align="end">
                                            <DropdownMenuItem
                                              onClick={() => {
                                                setRenameSheetId(sheet.id);
                                                setRenameSheetValue(sheet.sheetName || "");
                                              }}
                                              data-testid={`button-rename-sheet-${sheet.id}`}
                                            >
                                              <Pencil className="w-4 h-4 mr-2" />
                                              Rename
                                            </DropdownMenuItem>
                                            <DropdownMenuItem
                                              onClick={() => duplicateSheetMutation.mutate(sheet.id)}
                                              data-testid={`button-duplicate-sheet-${sheet.id}`}
                                            >
                                              <Copy className="w-4 h-4 mr-2" />
                                              Duplicate
                                            </DropdownMenuItem>
                                            <DropdownMenuSub>
                                              <DropdownMenuSubTrigger>
                                                <ArrowRight className="w-4 h-4 mr-2" />
                                                Move to
                                              </DropdownMenuSubTrigger>
                                              <DropdownMenuSubContent>
                                                {SHEET_FOLDER_NAMES.filter(f => f !== folderName).map(targetFolder => (
                                                  <DropdownMenuItem
                                                    key={targetFolder}
                                                    onClick={() => moveSheetMutation.mutate({ sheetId: sheet.id, folderGroup: targetFolder })}
                                                    data-testid={`button-move-sheet-${sheet.id}-${targetFolder.toLowerCase().replace(/\s+/g, '-')}`}
                                                  >
                                                    <Folder className="w-4 h-4 mr-2" />
                                                    {targetFolder}
                                                  </DropdownMenuItem>
                                                ))}
                                              </DropdownMenuSubContent>
                                            </DropdownMenuSub>
                                            <DropdownMenuSeparator />
                                            <DropdownMenuItem
                                              onClick={() => setDeleteSheetId(sheet.id)}
                                              className="text-destructive"
                                              data-testid={`button-delete-sheet-${sheet.id}`}
                                            >
                                              <Trash2 className="w-4 h-4 mr-2" />
                                              Delete
                                            </DropdownMenuItem>
                                          </DropdownMenuContent>
                                        </DropdownMenu>
                                      )}
                                    </div>
                                  ))
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </>
                  )}
                </div>
              </ScrollArea>

              {selectedDoc && (
                <div className="border-t p-3 bg-muted/30 space-y-2 shrink-0">
                  <p className="text-xs font-medium truncate">{selectedDoc.title || selectedDoc.fileName}</p>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Badge variant="outline" className="text-[10px]">{selectedDoc.type}</Badge>
                    <span>{format(new Date(selectedDoc.uploadedAt), "MMM d, yyyy")}</span>
                  </div>
                  <div className="flex gap-1">
                    <Button size="sm" variant="outline" className="h-7 text-xs flex-1" onClick={() => window.open(selectedDoc.fileUrl, '_blank')}>
                      <Eye className="w-3 h-3 mr-1" /> View
                    </Button>
                    <DocumentRevisionPanel
                      documentId={selectedDoc.id}
                      documentTitle={selectedDoc.title || selectedDoc.fileName}
                      userRole={user?.role || ""}
                    />
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="flex-1 min-w-0 relative">
            {leftPanelCollapsed && (
              <Button
                size="icon"
                variant="ghost"
                className="absolute top-2 left-2 z-10 h-7 w-7"
                onClick={() => setLeftPanelCollapsed(false)}
                data-testid="button-expand-panel"
              >
                <ChevronRight className="w-4 h-4" />
              </Button>
            )}
            {!leftPanelCollapsed && (
              <Button
                size="icon"
                variant="ghost"
                className="absolute top-2 left-2 z-10 h-7 w-7 hidden md:flex"
                onClick={() => setLeftPanelCollapsed(true)}
                data-testid="button-collapse-panel"
              >
                <ChevronDown className="w-4 h-4 rotate-90" />
              </Button>
            )}
            <TakeoffWorkspace projectId={project.id} projectCode={project.code} />
          </div>
        </div>
      )}

      <AlertDialog open={!!deleteDocId} onOpenChange={(open) => !open && setDeleteDocId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Document</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this document? This action cannot be undone and will also remove any takeoff sheets associated with it.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteDocId && handleDeleteDocument(deleteDocId)}
              className="bg-destructive hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!deleteSheetId} onOpenChange={(open) => !open && setDeleteSheetId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Sheet</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this takeoff sheet? All measurements on this sheet will be permanently removed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteSheetId && deleteSheetMutation.mutate(deleteSheetId)}
              className="bg-destructive hover:bg-destructive/90"
              data-testid="button-confirm-delete-sheet"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
