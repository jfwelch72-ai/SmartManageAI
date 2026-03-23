import { useState, useMemo, useCallback, useRef, useEffect, lazy, Suspense } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import TakeoffWorkspace from "@/components/TakeoffWorkspace";
import DocumentRevisionPanel from "@/components/DocumentRevisionPanel";
import ProjectAddenda from "@/components/ProjectAddenda";
import { ObjectUploader } from "@/components/ObjectUploader";
import {
  Upload, Download, Eye, FileText, Trash2, FolderOpen, Folder, ChevronRight, ChevronDown,
  Search, MoreVertical, File, Pencil, GripVertical, ArrowRight, Copy, Loader2,
  ExternalLink, X, FolderPlus, Printer, RotateCw, EyeOff, RefreshCw, Box
} from "lucide-react";
const BimViewer = lazy(() => import("@/components/bid/BimViewer"));
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
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
import ReportsPage from "@/pages/reports";

interface PlansTabProps {
  projectCode: string;
  project: any;
}

type SubTab = "plans" | "addenda" | "libraries" | "reports";

interface DocGroup {
  name: string;
  expanded: boolean;
  types: string[];
  children?: DocGroup[];
  parentName?: string;
}

const DEFAULT_GROUPS: DocGroup[] = [
  { name: "Plans", expanded: true, types: ["PLANS"] },
  { name: "Specifications", expanded: true, types: ["SPECS"] },
  { name: "Takeoff", expanded: false, types: ["TAKEOFF"] },
  { name: "BIM Models", expanded: true, types: ["BIM"] },
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
  const [documentTitle, setDocumentTitle] = useState("");
  const [documentType, setDocumentType] = useState<string>("OTHER");
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
  const [previewDocId, setPreviewDocId] = useState<string | null>(null);
  const [panelWidth, setPanelWidth] = useState(256);
  const isResizingRef = useRef(false);
  const resizeStartXRef = useRef(0);
  const resizeStartWidthRef = useRef(256);

  const [renamingGroupName, setRenamingGroupName] = useState<string | null>(null);
  const [renameGroupValue, setRenameGroupValue] = useState("");
  const [deletingGroupName, setDeletingGroupName] = useState<string | null>(null);
  const [createFolderOpen, setCreateFolderOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [createFolderParent, setCreateFolderParent] = useState<string | null>(null);
  const [hiddenSheetIds, setHiddenSheetIds] = useState<Set<string>>(new Set());
  const uploadButtonRef = useRef<HTMLButtonElement>(null);
  const [draggedDocId, setDraggedDocId] = useState<string | null>(null);
  const [dragOverTarget, setDragOverTarget] = useState<string | null>(null);
  const [subFolderDocs, setSubFolderDocs] = useState<Record<string, string[]>>({});

  const handleResizeMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isResizingRef.current = true;
    resizeStartXRef.current = e.clientX;
    resizeStartWidthRef.current = panelWidth;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }, [panelWidth]);

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!isResizingRef.current) return;
      const delta = e.clientX - resizeStartXRef.current;
      const newWidth = Math.min(480, Math.max(180, resizeStartWidthRef.current + delta));
      setPanelWidth(newWidth);
    };
    const onMouseUp = () => {
      if (!isResizingRef.current) return;
      isResizingRef.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
    return () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    };
  }, []);

  const { data: previewUrlData, isLoading: previewUrlLoading } = useQuery<{ url: string }>({
    queryKey: ["/api/projects", projectCode, "documents", previewDocId, "preview-url"],
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectCode}/documents/${previewDocId}/preview-url`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to get preview URL");
      return res.json();
    },
    enabled: !!previewDocId,
    staleTime: 50 * 60 * 1000,
  });

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

    const allSubFolderDocIds = new Set(Object.values(subFolderDocs).flat());

    return groups.map((group) => ({
      ...group,
      docs: filtered.filter((d: any) => group.types.includes(d.type) && !allSubFolderDocIds.has(d.id)),
    }));
  }, [documents, searchQuery, groups, subFolderDocs]);

  const toggleGroup = (name: string) => {
    setGroups((prev) =>
      prev.map((g) => (g.name === name ? { ...g, expanded: !g.expanded } : g))
    );
  };

  const subFolderKey = (parentName: string, childName: string) => `${parentName}/${childName}`;

  const handleDocDragStart = useCallback((e: React.DragEvent, docId: string) => {
    setDraggedDocId(docId);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", docId);
  }, []);

  const handleDocDragEnd = useCallback(() => {
    setDraggedDocId(null);
    setDragOverTarget(null);
  }, []);

  const handleSubfolderDrop = useCallback((e: React.DragEvent, parentName: string, childName: string) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOverTarget(null);
    if (!draggedDocId) return;

    const key = `${parentName}/${childName}`;
    setSubFolderDocs((prev) => {
      const existing = prev[key] || [];
      if (existing.includes(draggedDocId)) return prev;
      const cleaned = Object.fromEntries(
        Object.entries(prev).map(([k, ids]) => [k, ids.filter((id) => id !== draggedDocId)])
      );
      return { ...cleaned, [key]: [...existing, draggedDocId] };
    });
    setDraggedDocId(null);
  }, [draggedDocId]);

  const handleParentFolderDrop = useCallback((e: React.DragEvent, groupName: string) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOverTarget(null);
    if (!draggedDocId) return;

    setSubFolderDocs((prev) => {
      return Object.fromEntries(
        Object.entries(prev).map(([k, ids]) => [k, ids.filter((id) => id !== draggedDocId)])
      );
    });
    setDraggedDocId(null);
  }, [draggedDocId]);

  const handleRenameGroupStart = (name: string) => {
    setRenameGroupValue(name);
    setRenamingGroupName(name);
  };

  const handleRenameGroupSubmit = (oldName: string) => {
    const trimmed = renameGroupValue.trim();
    if (trimmed && trimmed !== oldName) {
      setGroups((prev) => prev.map((g) => g.name === oldName ? { ...g, name: trimmed } : g));
    }
    setRenamingGroupName(null);
  };

  const handleDeleteGroupConfirm = () => {
    if (!deletingGroupName) return;
    setGroups((prev) => prev.filter((g) => g.name !== deletingGroupName));
    setDeletingGroupName(null);
    toast({ description: `Folder "${deletingGroupName}" removed.` });
  };

  const handleCreateFolderSubmit = () => {
    const trimmed = newFolderName.trim();
    if (!trimmed) return;
    const newChild: DocGroup = { name: trimmed, expanded: true, types: [], parentName: createFolderParent || undefined };
    if (createFolderParent) {
      setGroups((prev) =>
        prev.map((g) =>
          g.name === createFolderParent
            ? { ...g, expanded: true, children: [...(g.children || []), newChild] }
            : g
        )
      );
    } else {
      setGroups((prev) => [...prev, { name: trimmed, expanded: true, types: ["OTHER"] }]);
    }
    setCreateFolderOpen(false);
    setNewFolderName("");
    setCreateFolderParent(null);
    toast({ description: `Folder "${trimmed}" created.` });
  };

  const handlePrintAllSheets = async (docs: any[]) => {
    const pdfs = docs.filter((d: any) => (d.fileName || "").toLowerCase().endsWith(".pdf"));
    if (pdfs.length === 0) {
      toast({ description: "No PDF documents found in this folder." });
      return;
    }
    toast({ description: `Opening ${pdfs.length} PDF(s) for printing…` });
    for (const doc of pdfs) {
      await handleOpenFile(doc.id, doc.fileUrl);
    }
  };

  const handleAutonameSheets = (folderName: string) => {
    const folderSheets = groupedSheets[folderName] || [];
    if (folderSheets.length === 0) {
      toast({ description: "No takeoff sheets in this folder to rename." });
      return;
    }
    folderSheets.forEach((sheet, i) => {
      renameSheetMutation.mutate({ sheetId: sheet.id, sheetName: `Sheet ${i + 1}` });
    });
    toast({ description: `Auto-named ${folderSheets.length} sheet(s).` });
  };

  const handleHideAllSheets = (folderName: string) => {
    const folderSheets = groupedSheets[folderName] || [];
    if (folderSheets.length === 0) {
      toast({ description: "No takeoff sheets to hide in this folder." });
      return;
    }
    setHiddenSheetIds((prev) => {
      const next = new Set(prev);
      folderSheets.forEach((s) => next.add(s.id));
      return next;
    });
    toast({ description: `${folderSheets.length} sheet(s) hidden.` });
  };

  const handleUnhideAllSheets = (folderName: string) => {
    const folderSheets = groupedSheets[folderName] || [];
    setHiddenSheetIds((prev) => {
      const next = new Set(prev);
      folderSheets.forEach((s) => next.delete(s.id));
      return next;
    });
    toast({ description: "All sheets in this folder are now visible." });
  };

  const handleUploadForType = (type: string) => {
    setDocumentType(type);
    setTimeout(() => uploadButtonRef.current?.click(), 80);
  };

  const selectedDoc = documents.find((d: any) => d.id === selectedDocId);

  const handleOpenFile = async (docId: string, fallbackUrl: string) => {
    try {
      const res = await fetch(`/api/projects/${projectCode}/documents/${docId}/preview-url`, { credentials: "include" });
      if (res.ok) {
        const data = await res.json();
        window.open(data.url, "_blank");
      } else {
        window.open(fallbackUrl, "_blank");
      }
    } catch {
      window.open(fallbackUrl, "_blank");
    }
  };

  const handleObjectUploadComplete = (result: any) => {
    if (!result.successful?.length) {
      toast({ title: "Error", description: "No file uploaded", variant: "destructive" });
      return;
    }
    const isSingle = result.successful.length === 1;
    result.successful.forEach((uploaded: any) => {
      const file = uploaded.data as File;
      const fileUrl = uploaded.uploadURL?.split("?")[0] || "";
      const baseName = file.name.replace(/\.[^/.]+$/, "");
      const title = isSingle && documentTitle.trim() ? documentTitle.trim() : baseName;
      apiRequest("POST", "/api/documents", {
        projectId: project?.id,
        title,
        type: documentType,
        fileUrl,
        fileName: file.name,
        fileSize: file.size,
        mimeType: file.type,
        objectKey: fileUrl,
      }).then(() => {
        queryClient.invalidateQueries({ queryKey: ["/api/projects", projectCode, "documents"] });
        toast({ title: "Document uploaded" });
        setDocumentTitle("");
      }).catch(() => {
        toast({ title: "Error", description: "Failed to save document", variant: "destructive" });
      });
    });
    if (result.successful.length > 1) {
      toast({ title: `${result.successful.length} files uploaded`, description: "All documents have been added." });
    }
  };

  const handleDeleteDocument = async (docId: string) => {
    try {
      await apiRequest("DELETE", `/api/documents/${docId}`);
      toast({ title: "Success", description: "Document deleted" });
      await queryClient.invalidateQueries({ queryKey: ["/api/projects", projectCode, "documents"] });
      await queryClient.invalidateQueries({ queryKey: ["/api/projects", project?.id, "takeoff", "sheets"] });
      if (selectedDocId === docId) setSelectedDocId(null);
      if (previewDocId === docId) setPreviewDocId(null);
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
      <div className="flex flex-col h-[calc(100vh-200px)] mb-[50px]">
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
        <Button
          variant={subTab === "reports" ? "default" : "ghost"}
          size="sm"
          onClick={() => setSubTab("reports")}
          data-testid="tab-reports"
        >
          Reports
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

      {subTab === "reports" && project && (
        <div className="flex-1 min-h-0 overflow-auto">
          <ReportsPage embeddedProjectId={String(project.id)} />
        </div>
      )}

      {subTab === "plans" && project && (
        <div className="flex flex-1 min-h-0 relative">
          {!leftPanelCollapsed && (
            <div
              className="absolute inset-0 z-20 md:relative md:inset-auto md:h-full w-full bg-card border-r flex flex-col shrink-0"
              style={{ width: panelWidth }}
            >
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
                </div>
                <div className="space-y-2">
                  <div className="flex gap-1">
                    <Input
                      value={documentTitle}
                      onChange={(e) => setDocumentTitle(e.target.value)}
                      placeholder="Title (optional)"
                      className="h-7 text-xs flex-1"
                      data-testid="input-doc-title"
                    />
                    <Select value={documentType} onValueChange={setDocumentType}>
                      <SelectTrigger className="h-7 w-24 text-xs" data-testid="select-doc-type">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="PLANS">Plans</SelectItem>
                        <SelectItem value="SPECS">Specs</SelectItem>
                        <SelectItem value="TAKEOFF">Takeoff</SelectItem>
                        <SelectItem value="BIM">BIM</SelectItem>
                        <SelectItem value="OTHER">Other</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <ObjectUploader
                    key={documentType}
                    maxNumberOfFiles={20}
                    maxFileSize={documentType === "BIM" ? 209715200 : 104857600}
                    allowedFileTypes={documentType === "PLANS" ? [".pdf"] : documentType === "BIM" ? [".ifc"] : [".pdf", ".dwg", ".dxf", ".png", ".jpg", ".jpeg", ".xlsx", ".xls", ".csv", ".doc", ".docx"]}
                    fileType={documentType === "BIM" ? "BIM" : "DOCUMENT"}
                    onComplete={handleObjectUploadComplete}
                    testId="button-upload-document"
                  >
                    <Button ref={uploadButtonRef} variant="default" size="sm" className="w-full h-7 text-xs" data-testid="button-upload-document">
                      <Upload className="w-3 h-3 mr-1" />
                      Upload
                    </Button>
                  </ObjectUploader>
                  {documentType === "PLANS" && (
                    <p className="text-[10px] text-muted-foreground" data-testid="hint-pdf-only">PDF files only for Plans</p>
                  )}
                  {documentType === "BIM" && (
                    <p className="text-[10px] text-muted-foreground" data-testid="hint-ifc-only">IFC files only for BIM models</p>
                  )}
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
                        <div
                          className={cn(
                            "flex items-center gap-1.5 w-full px-2 py-1.5 text-sm hover:bg-accent/50 transition-colors cursor-pointer group/folder",
                            dragOverTarget === `parent:${group.name}` && draggedDocId !== null && "bg-blue-500/20 ring-1 ring-blue-500/50 rounded"
                          )}
                          onClick={() => { if (renamingGroupName !== group.name) toggleGroup(group.name); }}
                          onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; setDragOverTarget(`parent:${group.name}`); }}
                          onDragLeave={() => setDragOverTarget(null)}
                          onDrop={(e) => { setDragOverTarget(null); handleParentFolderDrop(e, group.name); }}
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
                          {renamingGroupName === group.name ? (
                            <Input
                              autoFocus
                              value={renameGroupValue}
                              className="h-5 text-xs px-1 py-0 flex-1"
                              onClick={(e) => e.stopPropagation()}
                              onChange={(e) => setRenameGroupValue(e.target.value)}
                              onBlur={() => handleRenameGroupSubmit(group.name)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") handleRenameGroupSubmit(group.name);
                                if (e.key === "Escape") setRenamingGroupName(null);
                              }}
                              data-testid={`input-rename-folder-${group.name}`}
                            />
                          ) : (
                            <span className="truncate font-medium flex-1">{group.name}</span>
                          )}
                          <Badge variant="secondary" className="text-[10px] h-4 px-1 shrink-0">
                            {group.docs.length}
                          </Badge>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-5 w-5 opacity-0 group-hover/folder:opacity-100 shrink-0 ml-0.5"
                                onClick={(e) => e.stopPropagation()}
                                data-testid={`menu-folder-${group.name.toLowerCase().replace(/\s+/g, '-')}`}
                              >
                                <MoreVertical className="w-3 h-3" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="start" className="w-56">
                              <DropdownMenuItem
                                onClick={(e) => { e.stopPropagation(); setNewFolderName(""); setCreateFolderParent(group.name); setCreateFolderOpen(true); }}
                                data-testid="menu-item-create-folder"
                              >
                                <FolderPlus className="w-4 h-4 mr-2" />
                                Create Folder
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={(e) => { e.stopPropagation(); handleRenameGroupStart(group.name); }}
                                data-testid="menu-item-rename-folder"
                              >
                                <Pencil className="w-4 h-4 mr-2" />
                                Rename Folder
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={(e) => { e.stopPropagation(); setDeletingGroupName(group.name); }}
                                className="text-destructive focus:text-destructive"
                                data-testid="menu-item-delete-folder"
                              >
                                <Trash2 className="w-4 h-4 mr-2" />
                                Delete Folder
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                onClick={(e) => { e.stopPropagation(); handleAutonameSheets(group.name); }}
                                data-testid="menu-item-autoname-sheets"
                              >
                                <RefreshCw className="w-4 h-4 mr-2" />
                                Autoname Sheets
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={(e) => { e.stopPropagation(); handlePrintAllSheets(group.docs); }}
                                data-testid="menu-item-print-all-sheets"
                              >
                                <Printer className="w-4 h-4 mr-2" />
                                Print All Sheets
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={(e) => { e.stopPropagation(); toast({ description: "Rotating blank sheets right — feature coming soon." }); }}
                                data-testid="menu-item-rotate-sheets"
                              >
                                <RotateCw className="w-4 h-4 mr-2" />
                                Rotate All Blank Sheets Right
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={(e) => { e.stopPropagation(); handleHideAllSheets(group.name); }}
                                data-testid="menu-item-hide-sheets"
                              >
                                <EyeOff className="w-4 h-4 mr-2" />
                                Hide All Sheets
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={(e) => { e.stopPropagation(); handleUnhideAllSheets(group.name); }}
                                data-testid="menu-item-unhide-sheets"
                              >
                                <Eye className="w-4 h-4 mr-2" />
                                Unhide All Sheets
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                onClick={(e) => { e.stopPropagation(); handleUploadForType("PLANS"); }}
                                data-testid="menu-item-upload-plans"
                              >
                                <Upload className="w-4 h-4 mr-2" />
                                Upload Plans
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={(e) => { e.stopPropagation(); handleUploadForType("OTHER"); }}
                                data-testid="menu-item-upload-supporting"
                              >
                                <Upload className="w-4 h-4 mr-2" />
                                Upload Supporting Documents
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                        {group.expanded && (
                          <div className="ml-2">
                            {group.docs.length === 0 ? (
                              <div className="px-6 py-1 text-xs text-muted-foreground italic">No files</div>
                            ) : (
                              group.docs.map((doc: any) => (
                                <div
                                  key={doc.id}
                                  draggable
                                  onDragStart={(e) => handleDocDragStart(e, doc.id)}
                                  onDragEnd={handleDocDragEnd}
                                  className={cn(
                                    "flex items-start gap-1.5 px-3 py-1.5 text-sm cursor-pointer hover:bg-accent/50 transition-colors group",
                                    selectedDocId === doc.id && "bg-accent",
                                    draggedDocId === doc.id && "opacity-50"
                                  )}
                                  onClick={() => { setSelectedDocId(doc.id); setPreviewDocId(doc.id); }}
                                  data-testid={`document-${doc.id}`}
                                >
                                  <GripVertical className="w-3 h-3 text-muted-foreground opacity-0 group-hover:opacity-50 shrink-0 cursor-grab mt-0.5" />
                                  {doc.type === "BIM" || doc.fileName?.toLowerCase().endsWith(".ifc") ? (
                                    <Box className="w-3.5 h-3.5 text-blue-500 shrink-0 mt-0.5" />
                                  ) : (
                                    <File className="w-3.5 h-3.5 text-muted-foreground shrink-0 mt-0.5" />
                                  )}
                                  <span className="break-words flex-1 min-w-0 text-sm leading-snug">{doc.title || doc.fileName}</span>
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
                                        onClick={() => handleOpenFile(doc.id, doc.fileUrl)}
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
                                      {(doc.mimeType?.includes("pdf") || doc.fileName?.toLowerCase().endsWith(".pdf")) && (
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
                            {(group.children || []).map((child) => {
                              const sfKey = subFolderKey(group.name, child.name);
                              const sfDocIds = subFolderDocs[sfKey] || [];
                              const sfDocs = documents.filter((d: any) => sfDocIds.includes(d.id));
                              const isDropTarget = dragOverTarget === sfKey && draggedDocId !== null;
                              return (
                                <div key={child.name} className="mt-0.5">
                                  <div
                                    className={cn(
                                      "flex items-center gap-1.5 px-2 py-1 text-sm hover:bg-accent/50 transition-colors cursor-pointer group/subfolder",
                                      isDropTarget && "bg-blue-500/20 ring-1 ring-blue-500/50 rounded"
                                    )}
                                    onClick={() => {
                                      setGroups((prev) =>
                                        prev.map((g) =>
                                          g.name === group.name
                                            ? { ...g, children: (g.children || []).map((c) => c.name === child.name ? { ...c, expanded: !c.expanded } : c) }
                                            : g
                                        )
                                      );
                                    }}
                                    onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = "move"; setDragOverTarget(sfKey); }}
                                    onDragLeave={() => setDragOverTarget(null)}
                                    onDrop={(e) => handleSubfolderDrop(e, group.name, child.name)}
                                    data-testid={`subfolder-${child.name.toLowerCase().replace(/\s+/g, '-')}`}
                                  >
                                    {child.expanded ? (
                                      <ChevronDown className="w-3 h-3 text-muted-foreground shrink-0" />
                                    ) : (
                                      <ChevronRight className="w-3 h-3 text-muted-foreground shrink-0" />
                                    )}
                                    {child.expanded ? (
                                      <FolderOpen className="w-3.5 h-3.5 text-yellow-500 shrink-0" />
                                    ) : (
                                      <Folder className="w-3.5 h-3.5 text-yellow-500 shrink-0" />
                                    )}
                                    <span className="truncate font-medium text-xs flex-1">{child.name}</span>
                                    <Badge variant="secondary" className="text-[10px] h-3.5 px-1 shrink-0">
                                      {sfDocs.length}
                                    </Badge>
                                    <Button
                                      size="icon"
                                      variant="ghost"
                                      className="h-4 w-4 opacity-0 group-hover/subfolder:opacity-100 shrink-0"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setSubFolderDocs((prev) => {
                                          const next = { ...prev };
                                          delete next[sfKey];
                                          return next;
                                        });
                                        setGroups((prev) =>
                                          prev.map((g) =>
                                            g.name === group.name
                                              ? { ...g, children: (g.children || []).filter((c) => c.name !== child.name) }
                                              : g
                                          )
                                        );
                                        toast({ description: `Subfolder "${child.name}" removed. Files moved back to parent.` });
                                      }}
                                      data-testid={`delete-subfolder-${child.name}`}
                                    >
                                      <Trash2 className="w-3 h-3" />
                                    </Button>
                                  </div>
                                  {child.expanded && (
                                    <div className="ml-4">
                                      {sfDocs.length === 0 ? (
                                        <div className="px-2 py-1 text-xs text-muted-foreground italic">No files — drag documents here</div>
                                      ) : (
                                        sfDocs.map((doc: any) => (
                                          <div
                                            key={doc.id}
                                            draggable
                                            onDragStart={(e) => handleDocDragStart(e, doc.id)}
                                            onDragEnd={handleDocDragEnd}
                                            className={cn(
                                              "flex items-start gap-1.5 px-2 py-1 text-xs cursor-pointer hover:bg-accent/50 transition-colors group",
                                              selectedDocId === doc.id && "bg-accent",
                                              draggedDocId === doc.id && "opacity-50"
                                            )}
                                            onClick={() => { setSelectedDocId(doc.id); setPreviewDocId(doc.id); }}
                                            data-testid={`subfolder-doc-${doc.id}`}
                                          >
                                            <GripVertical className="w-3 h-3 text-muted-foreground opacity-0 group-hover:opacity-50 shrink-0 cursor-grab mt-0.5" />
                                            <File className="w-3 h-3 text-muted-foreground shrink-0 mt-0.5" />
                                            <span className="break-words flex-1 min-w-0 leading-snug">{doc.title || doc.fileName}</span>
                                          </div>
                                        ))
                                      )}
                                    </div>
                                  )}
                                </div>
                              );
                            })}
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
                                  folderSheets.filter((s) => !hiddenSheetIds.has(s.id)).map((sheet) => (
                                    <div
                                      key={sheet.id}
                                      draggable
                                      onDragStart={(e) => handleSheetDragStart(e, sheet.id)}
                                      onDragEnd={() => setDraggedSheetId(null)}
                                      className={cn(
                                        "flex items-start gap-1.5 px-3 py-1.5 text-sm cursor-pointer hover:bg-accent/50 transition-colors group",
                                        draggedSheetId === sheet.id && "opacity-50"
                                      )}
                                      data-testid={`sheet-${sheet.id}`}
                                    >
                                      <GripVertical className="w-3 h-3 text-muted-foreground opacity-0 group-hover:opacity-50 shrink-0 cursor-grab mt-0.5" />
                                      <FileText className="w-3.5 h-3.5 text-blue-400 shrink-0 mt-0.5" />
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
                                        <span className="break-words flex-1 min-w-0 leading-snug">{sheet.sheetName}</span>
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
                  <p className="text-xs font-medium break-words">{selectedDoc.title || selectedDoc.fileName}</p>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Badge variant="outline" className="text-[10px]">{selectedDoc.type}</Badge>
                    <span>{format(new Date(selectedDoc.uploadedAt), "MMM d, yyyy")}</span>
                  </div>
                  <div className="flex gap-1">
                    <Button size="sm" variant="outline" className="h-7 text-xs flex-1" onClick={() => handleOpenFile(selectedDoc.id, selectedDoc.fileUrl)} data-testid="button-view-selected-doc">
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

              <div
                className="absolute top-0 right-0 h-full w-1 cursor-col-resize hidden md:flex items-center justify-center group z-30 hover:bg-primary/20 active:bg-primary/30 transition-colors"
                onMouseDown={handleResizeMouseDown}
                data-testid="panel-resize-handle"
              >
                <div className="w-0.5 h-8 rounded-full bg-border group-hover:bg-primary/50 transition-colors" />
              </div>
            </div>
          )}

          <div className="flex-1 min-w-0 relative flex flex-col">
            {leftPanelCollapsed && !previewDocId && (
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
            {!leftPanelCollapsed && !previewDocId && (
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
            {previewDocId ? (
              (() => {
                const doc = documents.find((d: any) => d.id === previewDocId);
                if (!doc) return <TakeoffWorkspace projectId={project.id} projectCode={project.code} />;
                const isPdf = doc.mimeType?.includes("pdf") || doc.fileName?.toLowerCase().endsWith(".pdf");
                const isImage = doc.mimeType?.startsWith("image/") || /\.(png|jpg|jpeg|gif|webp)$/i.test(doc.fileName || "");
                const isBim = doc.type === "BIM" || doc.fileName?.toLowerCase().endsWith(".ifc");

                if (isBim && previewUrlData?.url) {
                  return (
                    <div className="flex flex-col h-full" data-testid="bim-preview-panel">
                      <div className="flex items-center gap-2 px-3 py-2 border-b bg-muted/30 shrink-0">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 text-xs gap-1"
                          onClick={() => setPreviewDocId(null)}
                          data-testid="button-back-to-takeoff"
                        >
                          <X className="w-3.5 h-3.5" />
                          Back to Takeoff
                        </Button>
                        <span className="text-sm font-medium truncate flex-1" data-testid="preview-doc-title">{doc.title || doc.fileName}</span>
                        <Badge variant="outline" className="text-[10px] shrink-0">
                          <Box className="w-3 h-3 mr-1" />
                          BIM
                        </Badge>
                      </div>
                      <div className="flex-1 min-h-0 overflow-hidden">
                        <Suspense fallback={
                          <div className="flex items-center justify-center h-full">
                            <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
                          </div>
                        }>
                          <BimViewer fileUrl={previewUrlData.url} fileName={doc.title || doc.fileName} />
                        </Suspense>
                      </div>
                    </div>
                  );
                }

                if (isBim && previewUrlLoading) {
                  return (
                    <div className="flex flex-col h-full" data-testid="bim-preview-panel">
                      <div className="flex items-center gap-2 px-3 py-2 border-b bg-muted/30 shrink-0">
                        <Button size="sm" variant="ghost" className="h-7 text-xs gap-1" onClick={() => setPreviewDocId(null)} data-testid="button-back-to-takeoff">
                          <X className="w-3.5 h-3.5" /> Back to Takeoff
                        </Button>
                        <span className="text-sm font-medium truncate flex-1">{doc.title || doc.fileName}</span>
                      </div>
                      <div className="flex items-center justify-center h-full">
                        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
                      </div>
                    </div>
                  );
                }

                return (
                  <div className="flex flex-col h-full" data-testid="doc-preview-panel">
                    <div className="flex items-center gap-2 px-3 py-2 border-b bg-muted/30 shrink-0">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 text-xs gap-1"
                        onClick={() => setPreviewDocId(null)}
                        data-testid="button-back-to-takeoff"
                      >
                        <X className="w-3.5 h-3.5" />
                        Back to Takeoff
                      </Button>
                      <span className="text-sm font-medium truncate flex-1" data-testid="preview-doc-title">{doc.title || doc.fileName}</span>
                      <Badge variant="outline" className="text-[10px] shrink-0">{doc.type}</Badge>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7 shrink-0"
                        onClick={() => handleOpenFile(doc.id, doc.fileUrl)}
                        data-testid="button-open-doc-external"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                    <div className="flex-1 min-h-0 overflow-hidden">
                      {previewUrlLoading ? (
                        <div className="flex items-center justify-center h-full" data-testid="preview-loading">
                          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                        </div>
                      ) : isPdf && previewUrlData?.url ? (
                        <iframe
                          src={previewUrlData.url}
                          className="w-full h-full border-0"
                          title={doc.title || doc.fileName}
                          data-testid="preview-pdf-iframe"
                        />
                      ) : isPdf ? (
                        <div className="flex items-center justify-center h-full">
                          <div className="text-center space-y-4 p-8 max-w-sm">
                            <File className="w-16 h-16 text-muted-foreground/40 mx-auto" />
                            <p className="text-sm text-muted-foreground">Unable to generate preview. Open the file directly.</p>
                            <Button variant="outline" onClick={() => handleOpenFile(doc.id, doc.fileUrl)} data-testid="button-open-pdf-fallback">
                              <ExternalLink className="w-4 h-4 mr-2" />Open File
                            </Button>
                          </div>
                        </div>
                      ) : isImage ? (
                        <div className="flex items-center justify-center h-full bg-muted/20 p-4">
                          <img
                            src={previewUrlData?.url || doc.fileUrl}
                            alt={doc.title || doc.fileName}
                            className="max-w-full max-h-full object-contain"
                            data-testid="preview-image"
                          />
                        </div>
                      ) : (
                        <div className="flex items-center justify-center h-full">
                          <div className="text-center space-y-4 p-8 max-w-sm">
                            <div className="flex justify-center">
                              <File className="w-16 h-16 text-muted-foreground/40" />
                            </div>
                            <div>
                              <p className="font-medium text-sm" data-testid="preview-filename">{doc.title || doc.fileName}</p>
                              <Badge variant="secondary" className="mt-1 text-xs">{doc.fileName.split(".").pop()?.toUpperCase() || doc.type}</Badge>
                            </div>
                            <p className="text-sm text-muted-foreground">This file type cannot be previewed in the browser.</p>
                            <Button
                              variant="outline"
                              onClick={() => handleOpenFile(doc.id, doc.fileUrl)}
                              data-testid="button-open-file-external"
                            >
                              <ExternalLink className="w-4 h-4 mr-2" />
                              Open File
                            </Button>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })()
            ) : (
              <TakeoffWorkspace projectId={project.id} projectCode={project.code} />
            )}
          </div>
        </div>
      )}

      <Dialog open={createFolderOpen} onOpenChange={(open) => { setCreateFolderOpen(open); if (!open) { setNewFolderName(""); setCreateFolderParent(null); } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Create Folder{createFolderParent ? ` inside ${createFolderParent}` : ""}</DialogTitle>
          </DialogHeader>
          <div className="py-2">
            <Label htmlFor="new-folder-name" className="text-sm mb-1 block">Folder name</Label>
            <Input
              id="new-folder-name"
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              placeholder="e.g. Structural Plans"
              autoFocus
              onKeyDown={(e) => { if (e.key === "Enter") handleCreateFolderSubmit(); if (e.key === "Escape") setCreateFolderOpen(false); }}
              data-testid="input-new-folder-name"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateFolderOpen(false)}>Cancel</Button>
            <Button onClick={handleCreateFolderSubmit} disabled={!newFolderName.trim()} data-testid="button-create-folder-confirm">
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deletingGroupName} onOpenChange={(open) => !open && setDeletingGroupName(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove Folder</AlertDialogTitle>
            <AlertDialogDescription>
              Remove the <strong>{deletingGroupName}</strong> folder from view? Documents already uploaded will not be deleted — they will reappear if you reload the page.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteGroupConfirm} className="bg-destructive hover:bg-destructive/90" data-testid="button-confirm-delete-folder">
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

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
