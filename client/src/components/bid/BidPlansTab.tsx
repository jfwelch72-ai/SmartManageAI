import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import TakeoffWorkspace from "@/components/TakeoffWorkspace";
import { ObjectUploader } from "@/components/ObjectUploader";
import {
  Upload, Download, Eye, FileText, Trash2, FolderOpen, Folder, ChevronRight, ChevronDown,
  Search, MoreVertical, File, Plus, Pencil, GripVertical, ArrowRight, Copy, Loader2,
  ExternalLink, X
} from "lucide-react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubTrigger, DropdownMenuSubContent } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useQuery, useMutation } from "@tanstack/react-query";
import type { TakeoffSheet } from "@shared/schema";
import { cn } from "@/lib/utils";

interface BidPlansTabProps {
  bidId: string;
  bidCode: string;
  canEdit: boolean;
  estimateId?: string;
  onNextStep: () => void;
}

interface BidDocument {
  id: string;
  bidId: string;
  type: string;
  title: string;
  fileName: string;
  fileUrl: string;
  objectKey: string | null;
  fileSize: number | null;
  mimeType: string | null;
  uploadedAt: string;
}

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

export default function BidPlansTab({ bidId, bidCode, canEdit, estimateId, onNextStep }: BidPlansTabProps) {
  const { toast } = useToast();

  const { data: documents = [], isLoading: documentsLoading } = useQuery<BidDocument[]>({
    queryKey: ["/api/bids", bidCode, "documents"],
    queryFn: async () => {
      const res = await fetch(`/api/bids/${bidCode}/documents`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch documents");
      return res.json();
    },
  });

  const { data: sheets = [] } = useQuery<TakeoffSheet[]>({
    queryKey: ["/api/bids", bidId, "takeoff", "sheets"],
    enabled: !!bidId,
  });

  const [docTitle, setDocTitle] = useState("");
  const [docType, setDocType] = useState<string>("PLANS");
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
    queryKey: ["/api/bids", bidCode, "documents", previewDocId, "preview-url"],
    queryFn: async () => {
      const res = await fetch(`/api/bids/${bidCode}/documents/${previewDocId}/preview-url`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to get preview URL");
      return res.json();
    },
    enabled: !!previewDocId,
    staleTime: 50 * 60 * 1000,
  });

  const SHEET_FOLDER_NAMES = ["Plans", "Supporting Documents"];

  const createDocMutation = useMutation({
    mutationFn: async (data: { title: string; fileName: string; fileUrl: string; objectKey?: string; fileSize?: number; mimeType?: string; type: string }) => {
      const res = await apiRequest("POST", `/api/bids/${bidCode}/documents`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/bids", bidCode, "documents"] });
      setDocTitle("");
      toast({ title: "Document uploaded" });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to save document", variant: "destructive" });
    },
  });

  const deleteDocMutation = useMutation({
    mutationFn: async (docId: string) => {
      await apiRequest("DELETE", `/api/bids/${bidCode}/documents/${docId}`);
    },
    onSuccess: (_, docId) => {
      queryClient.invalidateQueries({ queryKey: ["/api/bids", bidCode, "documents"] });
      if (selectedDocId === docId) setSelectedDocId(null);
      if (previewDocId === docId) setPreviewDocId(null);
      toast({ title: "Document removed" });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to remove document", variant: "destructive" });
    },
  });

  const moveSheetMutation = useMutation({
    mutationFn: async ({ sheetId, folderGroup }: { sheetId: string; folderGroup: string }) => {
      const res = await apiRequest("PATCH", `/api/takeoff/sheets/${sheetId}/folder-group`, { folderGroup });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/bids", bidId, "takeoff", "sheets"] });
    },
  });

  const renameSheetMutation = useMutation({
    mutationFn: async ({ sheetId, sheetName }: { sheetId: string; sheetName: string }) => {
      const res = await apiRequest("PATCH", `/api/takeoff/sheets/${sheetId}/rename`, { sheetName });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/bids", bidId, "takeoff", "sheets"] });
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
      queryClient.invalidateQueries({ queryKey: ["/api/bids", bidId, "takeoff", "sheets"] });
      toast({ title: "Sheet duplicated" });
    },
  });

  const deleteSheetMutation = useMutation({
    mutationFn: async (sheetId: string) => {
      await apiRequest("DELETE", `/api/takeoff/sheets/${sheetId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/bids", bidId, "takeoff", "sheets"] });
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
      ? documents.filter((d) =>
          (d.title || d.fileName || "").toLowerCase().includes(searchQuery.toLowerCase())
        )
      : documents;

    return groups.map((group) => ({
      ...group,
      docs: filtered.filter((d) => group.types.includes(d.type)),
    }));
  }, [documents, searchQuery, groups]);

  const toggleGroup = (name: string) => {
    setGroups((prev) =>
      prev.map((g) => (g.name === name ? { ...g, expanded: !g.expanded } : g))
    );
  };

  const selectedDoc = documents.find((d) => d.id === selectedDocId);

  const handleOpenFile = async (docId: string, fallbackUrl: string) => {
    try {
      const res = await fetch(`/api/bids/${bidCode}/documents/${docId}/preview-url`, { credentials: "include" });
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

  const handleUploadComplete = (result: any) => {
    if (!result.successful?.length) {
      toast({ title: "Error", description: "No file uploaded", variant: "destructive" });
      return;
    }
    const isSingle = result.successful.length === 1;
    result.successful.forEach((uploaded: any) => {
      const file = uploaded.data as File;
      const fileUrl = uploaded.uploadURL?.split("?")[0] || "";
      const baseName = file.name.replace(/\.[^/.]+$/, "");
      const title = isSingle && docTitle.trim() ? docTitle.trim() : baseName;
      createDocMutation.mutate({
        title,
        fileName: file.name,
        fileUrl,
        objectKey: fileUrl,
        fileSize: file.size,
        mimeType: file.type,
        type: docType,
      });
    });
    if (result.successful.length > 1) {
      toast({ title: `${result.successful.length} files uploaded`, description: "All documents have been added." });
    }
  };

  const handleImportToTakeoff = async (docId: string) => {
    try {
      await apiRequest("POST", `/api/bids/${bidId}/takeoff/import-plan`, { documentId: docId });
      toast({ title: "Success", description: "Plan imported to takeoff workspace" });
      await queryClient.invalidateQueries({ queryKey: ["/api/bids", bidId, "takeoff", "sheets"] });
    } catch (error: any) {
      toast({ title: "Error", description: error?.message || "Failed to import plan", variant: "destructive" });
    }
  };

  const importToEstimateMutation = useMutation({
    mutationFn: async () => {
      if (!estimateId) throw new Error("No estimate found. Create an estimate in Step 2 first.");
      const catRes = await apiRequest("GET", `/api/bids/${bidId}/takeoff/categories`);
      const categories: { id: string; name: string }[] = await catRes.json();
      if (!categories.length) throw new Error("No takeoff categories found. Add measurements in the workspace first.");
      const categoryIds = categories.map((c) => c.id);
      const res = await apiRequest("POST", `/api/bids/${bidId}/estimate/import-takeoff`, { estimateId, categoryIds });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Import failed");
      }
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/bids", bidId, "estimate"] });
      toast({ title: "Import complete", description: `${data.count} line item(s) added to your estimate` });
    },
    onError: (error: any) => {
      toast({ title: "Import failed", description: error.message, variant: "destructive" });
    },
  });

  const handleDeleteDocument = async (docId: string) => {
    deleteDocMutation.mutate(docId);
    setDeleteDocId(null);
  };

  return (
    <div className="flex flex-col h-[calc(100vh-280px)] min-h-[500px]">
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
                    data-testid="input-search-bid-documents"
                  />
                </div>
              </div>
              {canEdit && (
                <div className="space-y-2">
                  <div className="flex gap-1">
                    <Input
                      value={docTitle}
                      onChange={(e) => setDocTitle(e.target.value)}
                      placeholder="Title (optional)"
                      className="h-7 text-xs flex-1"
                      data-testid="input-bid-doc-title"
                    />
                    <Select value={docType} onValueChange={setDocType}>
                      <SelectTrigger className="h-7 w-24 text-xs" data-testid="select-bid-doc-type">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="PLANS">Plans</SelectItem>
                        <SelectItem value="SPECS">Specs</SelectItem>
                        <SelectItem value="TAKEOFF">Takeoff</SelectItem>
                        <SelectItem value="OTHER">Other</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <ObjectUploader
                    key={docType}
                    maxNumberOfFiles={20}
                    maxFileSize={104857600}
                    allowedFileTypes={docType === "PLANS" ? [".pdf"] : [".pdf", ".dwg", ".dxf", ".png", ".jpg", ".jpeg", ".xlsx", ".xls", ".csv", ".doc", ".docx"]}
                    fileType="DOCUMENT"
                    onComplete={handleUploadComplete}
                    testId="button-upload-bid-plan"
                  >
                    <Button variant="default" size="sm" className="w-full h-7 text-xs" disabled={createDocMutation.isPending} data-testid="button-upload-bid-plan">
                      <Upload className="w-3 h-3 mr-1" />
                      {createDocMutation.isPending ? "Saving..." : "Upload"}
                    </Button>
                  </ObjectUploader>
                  {docType === "PLANS" && (
                    <p className="text-[10px] text-muted-foreground" data-testid="hint-pdf-only">PDF files only for Plans</p>
                  )}
                </div>
              )}
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
                            group.docs.map((doc) => (
                              <div
                                key={doc.id}
                                className={cn(
                                  "flex items-start gap-1.5 px-3 py-1.5 text-sm cursor-pointer hover:bg-accent/50 transition-colors group",
                                  selectedDocId === doc.id && "bg-accent"
                                )}
                                onClick={() => { setSelectedDocId(doc.id); setPreviewDocId(doc.id); }}
                                data-testid={`bid-document-${doc.id}`}
                              >
                                <File className="w-3.5 h-3.5 text-muted-foreground shrink-0 mt-0.5" />
                                <span className="break-words flex-1 min-w-0 text-sm leading-snug">{doc.title || doc.fileName}</span>
                                <DropdownMenu>
                                  <DropdownMenuTrigger asChild>
                                    <Button
                                      size="icon"
                                      variant="ghost"
                                      className="h-5 w-5 opacity-0 group-hover:opacity-100 shrink-0"
                                      onClick={(e) => e.stopPropagation()}
                                      data-testid={`menu-bid-document-${doc.id}`}
                                    >
                                      <MoreVertical className="w-3 h-3" />
                                    </Button>
                                  </DropdownMenuTrigger>
                                  <DropdownMenuContent align="end">
                                    <DropdownMenuItem
                                      onClick={() => handleOpenFile(doc.id, doc.fileUrl)}
                                      data-testid={`button-view-bid-doc-${doc.id}`}
                                    >
                                      <Eye className="w-4 h-4 mr-2" />
                                      View
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
                                    {canEdit && (
                                      <>
                                        <DropdownMenuSeparator />
                                        <DropdownMenuItem
                                          onClick={() => setDeleteDocId(doc.id)}
                                          className="text-destructive"
                                          data-testid={`button-delete-bid-doc-${doc.id}`}
                                        >
                                          <Trash2 className="w-4 h-4 mr-2" />
                                          Delete
                                        </DropdownMenuItem>
                                      </>
                                    )}
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
                </div>
                <div className="flex gap-1">
                  <Button size="sm" variant="outline" className="h-7 text-xs flex-1" onClick={() => handleOpenFile(selectedDoc.id, selectedDoc.fileUrl)} data-testid="button-view-selected-doc">
                    <Eye className="w-3 h-3 mr-1" /> View
                  </Button>
                  {(selectedDoc.mimeType?.includes("pdf") || selectedDoc.fileName?.toLowerCase().endsWith(".pdf")) && (
                    <Button size="sm" variant="outline" className="h-7 text-xs flex-1" onClick={() => handleImportToTakeoff(selectedDoc.id)} data-testid="button-import-selected-doc">
                      <FileText className="w-3 h-3 mr-1" /> Import
                    </Button>
                  )}
                </div>
              </div>
            )}

            <div className="border-t p-2 shrink-0 space-y-1.5">
              {estimateId && sheets.length > 0 && (
                <Button
                  size="sm"
                  variant="outline"
                  className="w-full"
                  onClick={() => importToEstimateMutation.mutate()}
                  disabled={importToEstimateMutation.isPending}
                  data-testid="button-import-to-estimate"
                >
                  {importToEstimateMutation.isPending ? (
                    <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                  ) : (
                    <ArrowRight className="w-3 h-3 mr-1" />
                  )}
                  Import Measurements to Estimate
                </Button>
              )}
              <Button size="sm" className="w-full" onClick={onNextStep} data-testid="button-continue-scope-sidebar">
                Continue to Scope of Work
                <ChevronRight className="w-4 h-4 ml-1" />
              </Button>
            </div>
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
              const doc = documents.find((d) => d.id === previewDocId);
              if (!doc) return <TakeoffWorkspace context={{ type: "bid", bidId, bidCode }} />;
              const isPdf = doc.mimeType?.includes("pdf") || doc.fileName?.toLowerCase().endsWith(".pdf");
              const isImage = doc.mimeType?.startsWith("image/") || /\.(png|jpg|jpeg|gif|webp)$/i.test(doc.fileName || "");
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
            <TakeoffWorkspace
              context={{ type: "bid", bidId, bidCode }}
            />
          )}
        </div>
      </div>

      <AlertDialog open={!!deleteDocId} onOpenChange={(open) => !open && setDeleteDocId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Document</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this document? This action cannot be undone.
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
