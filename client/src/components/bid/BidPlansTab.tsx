import { useState, useMemo, useCallback, useRef, useEffect, lazy, Suspense } from "react";
import PdfPreview from "@/components/PdfPreview";
import FilePreview from "@/components/FilePreview";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import TakeoffWorkspace from "@/components/TakeoffWorkspace";
import { WidgetErrorBoundary } from "@/components/WidgetErrorBoundary";
import { ObjectUploader } from "@/components/ObjectUploader";
import { MAX_BATCH_UPLOAD_FILES, MAX_BATCH_UPLOAD_HELPER_TEXT, MAX_STORAGE_FILE_SIZE } from "@/lib/uploadLimits";
import BidLibrarySection from "./BidLibrarySection";
import {
  Upload, Download, Eye, FileText, Trash2, FolderOpen, Folder, ChevronRight, ChevronDown,
  Search, MoreVertical, File, Plus, Pencil, GripVertical, ArrowRight, Copy, Loader2,
  ExternalLink, X, FolderPlus, Printer, RotateCw, EyeOff, RefreshCw, Box, BookOpen, Columns2, Link2,
  Building2, Settings2, Type
} from "lucide-react";

const BimViewer = lazy(() => import("@/components/bid/BimViewer"));
import BimQuantityDialog from "@/components/bim/BimQuantityDialog";
import type { BimExtractionResult } from "@/utils/ifc-quantity-parser";
import type { QuantityCategory } from "@shared/schema";
import type { BimElementSummary, BimSelectedElement } from "@/components/bid/BimViewer";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubTrigger, DropdownMenuSubContent, DropdownMenuCheckboxItem, DropdownMenuLabel } from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useAuth } from "@/hooks/use-auth";
import { useTour } from "@/components/TourProvider";
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
import { useFeatureFlags } from "@/hooks/use-feature-flags";
// Task #2067 — Plans tab now links into the standalone Takeoff workspace at
// `/takeoff/:bidCode` instead of embedding `<TakeoffWorkspace>` for the
// default no-doc-selected pane. Sheet clicks navigate via wouter.
import { Link, useLocation } from "wouter";
import { Maximize2 } from "lucide-react";

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

export default function BidPlansTab({ bidId, bidCode, canEdit, estimateId, onNextStep }: BidPlansTabProps) {
  const { toast } = useToast();
  const { isEnabled: isFeatureFlagEnabled } = useFeatureFlags();
  const bimEnabled = isFeatureFlagEnabled("BIM_VIEWER");

  // Task #1696 — Mirror the Task #1663 pattern from `<PlansTab>`:
  // a per-user "Labeled toolbar" preference stored in localStorage
  // (re-hydrated on user.id resolve/switch so preferences never leak
  // across users), wired into `<TakeoffWorkspace labeled={…}>` so the
  // markup popover renders icon+label rows when enabled. The bid tour
  // uses its own context API (`startBidPlansTour` / `isBidPlansTourCompleted`)
  // and a separate localStorage key, kept independent from the project
  // plans tour so users get the bid walkthrough on first visit even if
  // they previously dismissed the project one.
  const { user } = useAuth();
  const { startBidPlansTour, isBidPlansTourCompleted } = useTour();
  const labeledStorageKey = (uid: string | undefined | null) =>
    uid ? `bid-plan-toolbar-labeled-${uid}` : null;
  const readLabeledPref = (uid: string | undefined | null): boolean => {
    if (typeof window === "undefined") return false;
    const key = labeledStorageKey(uid);
    if (!key) return false;
    try {
      return window.localStorage.getItem(key) === "1";
    } catch {
      return false;
    }
  };
  const [labeledToolbar, setLabeledToolbar] = useState<boolean>(() =>
    readLabeledPref(user?.id),
  );
  // Re-hydrate when the active user changes (initial resolve or switch).
  useEffect(() => {
    setLabeledToolbar(readLabeledPref(user?.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);
  // Save the preference inline at toggle time (not in a state-sync
  // effect) so re-hydrating one user's value never overwrites
  // another user's localStorage entry.
  const toggleLabeledToolbar = useCallback(() => {
    setLabeledToolbar((prev) => {
      const next = !prev;
      const key = labeledStorageKey(user?.id);
      if (key && typeof window !== "undefined") {
        try {
          if (next) window.localStorage.setItem(key, "1");
          else window.localStorage.removeItem(key);
        } catch {}
      }
      return next;
    });
  }, [user?.id]);

  // Auto-trigger the bid plans tour the first time a user opens the
  // bid Plans tab. 800ms delay gives `<TakeoffWorkspace>` time to
  // mount its toolbar so Joyride can anchor to the first step
  // (`button-tool-pan`). Ref-guarded so it never fires twice in the
  // same session, but the flag is only set inside the timer so a
  // user who tabs away before 800ms still sees it next visit.
  const tourTriggeredRef = useRef(false);
  // Reset the per-mount auto-trigger guard whenever the active user
  // changes. Without this, an account switch while this tab is still
  // mounted would carry user A's "already triggered this session" flag
  // into user B's session and silently suppress B's first-run tour.
  useEffect(() => {
    tourTriggeredRef.current = false;
  }, [user?.id]);
  useEffect(() => {
    if (tourTriggeredRef.current) return;
    if (!user?.id) return;
    if (isBidPlansTourCompleted) return;
    const timer = window.setTimeout(() => {
      tourTriggeredRef.current = true;
      startBidPlansTour();
    }, 800);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, isBidPlansTourCompleted]);


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

  // Task #1696 — Replay handler used by the gear menus on the takeoff
  // pane, the PDF/image preview header, the BIM preview header, and
  // the Split View top bar (Task #1727). The bid tour anchors live
  // inside `<TakeoffWorkspace>`, so we close any preview / split-view
  // mode first and wait a tick for the takeoff toolbar to remount
  // before Joyride starts — otherwise the first step's
  // `[data-testid="button-tool-pan"]` target won't exist in the DOM
  // and Joyride would silently skip it.
  const handleReplayTour = useCallback(() => {
    setPreviewDocId(null);
    setSplitViewMode(false);
    window.setTimeout(() => startBidPlansTour(), 250);
  }, [startBidPlansTour]);
  const bidSheetStorageKey = bidId ? `takeoff-sheet-${bidId}` : null;
  const [selectedSheetId, setSelectedSheetId] = useState<string | null>(() => {
    if (!bidSheetStorageKey) return null;
    try { return sessionStorage.getItem(bidSheetStorageKey); } catch { return null; }
  });
  const prevBidSheetStorageKeyRef = useRef<string | null>(bidSheetStorageKey);
  useEffect(() => {
    if (prevBidSheetStorageKeyRef.current !== bidSheetStorageKey) {
      prevBidSheetStorageKeyRef.current = bidSheetStorageKey;
      if (!bidSheetStorageKey) {
        setSelectedSheetId(null);
      } else {
        try { setSelectedSheetId(sessionStorage.getItem(bidSheetStorageKey)); }
        catch { setSelectedSheetId(null); }
      }
    }
  }, [bidSheetStorageKey]);
  useEffect(() => {
    if (!bidSheetStorageKey) return;
    try {
      if (selectedSheetId) sessionStorage.setItem(bidSheetStorageKey, selectedSheetId);
      else sessionStorage.removeItem(bidSheetStorageKey);
    } catch {}
  }, [selectedSheetId, bidSheetStorageKey]);
  // Task #2067 — Clicking a sheet in the bid Plans sidebar now jumps to the
  // standalone Takeoff workspace (`/takeoff/:bidCode`) instead of selecting
  // it inside an embedded `<TakeoffWorkspace>`. We pass the sheet id via a
  // `?sheet=` query param; the workspace page also writes it to
  // sessionStorage so a refresh keeps the user on the same sheet.
  const [, navigate] = useLocation();
  const handleSelectSheetFromSidebar = (sheetId: string) => {
    setPreviewDocId(null);
    setSelectedSheetId(sheetId);
    if (bidCode) {
      navigate(`/takeoff/${bidCode}?sheet=${encodeURIComponent(sheetId)}`);
    }
  };
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
  const [libraryExpanded, setLibraryExpanded] = useState(false);
  const uploadButtonRef = useRef<HTMLButtonElement>(null);
  const [draggedDocId, setDraggedDocId] = useState<string | null>(null);
  const [dragOverTarget, setDragOverTarget] = useState<string | null>(null);
  const [subFolderDocs, setSubFolderDocs] = useState<Record<string, string[]>>({});
  const [bimDialogOpen, setBimDialogOpen] = useState(false);
  const [bimExtractionResult, setBimExtractionResult] = useState<BimExtractionResult | null>(null);
  const [bimIsExtracting, setBimIsExtracting] = useState(false);
  const [bimExtractionProgress, setBimExtractionProgress] = useState(0);

  const { data: categories = [] } = useQuery<QuantityCategory[]>({
    queryKey: ["/api/bids", bidId, "takeoff", "categories"],
    enabled: !!bidId,
  });

  const isIfcFile = (fileName: string) => {
    return fileName?.toLowerCase().endsWith(".ifc");
  };

  const handleExtractBimQuantities = async (doc: BidDocument) => {
    setBimDialogOpen(true);
    setBimIsExtracting(true);
    setBimExtractionProgress(0);
    setBimExtractionResult(null);

    try {
      const fileUrl = `/api/bids/${bidCode}/documents/${doc.id}/stream`;

      const response = await fetch(fileUrl, { credentials: "include" });
      if (!response.ok) throw new Error("Failed to fetch IFC file");
      const arrayBuffer = await response.arrayBuffer();

      const { parseIfcFile } = await import("@/utils/ifc-quantity-parser");
      const result = await parseIfcFile(arrayBuffer, doc.fileName, (pct) => {
        setBimExtractionProgress(pct);
      });

      setBimExtractionResult(result);
    } catch (error: any) {
      console.error("BIM extraction error:", error);
      toast({
        title: "Extraction failed",
        description: error?.message || "Failed to parse IFC file",
        variant: "destructive",
      });
      setBimDialogOpen(false);
    } finally {
      setBimIsExtracting(false);
    }
  };

  const [splitViewMode, setSplitViewMode] = useState(false);
  const [splitBimDocId, setSplitBimDocId] = useState<string | null>(null);
  const [bimSelectedElements, setBimSelectedElements] = useState<BimSelectedElement[]>([]);
  const [highlightStoreyId, setHighlightStoreyId] = useState<number | null>(null);
  const [storeyAssocDialogOpen, setStoreyAssocDialogOpen] = useState(false);
  const [storeyAssocSheetId, setStoreyAssocSheetId] = useState<string | null>(null);
  const [storeyAssocStoreyId, setStoreyAssocStoreyId] = useState<string>("");
  const [storeyAssocStoreyName, setStoreyAssocStoreyName] = useState<string>("");

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

  const previewUrlData = previewDocId ? { url: `/api/bids/${bidCode}/documents/${previewDocId}/stream` } : undefined;
  const previewUrlLoading = false;

  const SHEET_FOLDER_NAMES = ["Plans", "Supporting Documents", "BIM"];

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
      await apiRequest("DELETE", `/api/takeoff/sheets/${sheetId}?confirm=true`);
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

    const allSubFolderDocIds = new Set(Object.values(subFolderDocs).flat());

    return groups
      .filter((group) => bimEnabled || group.name !== "BIM Models")
      .map((group) => ({
        ...group,
        docs: filtered.filter((d) => group.types.includes(d.type) && !allSubFolderDocIds.has(d.id)),
      }));
  }, [documents, searchQuery, groups, subFolderDocs, bimEnabled]);

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

  const handlePrintAllSheets = async (docs: BidDocument[]) => {
    const pdfs = docs.filter((d) => (d.fileName || "").toLowerCase().endsWith(".pdf"));
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
    setDocType(type);
    setTimeout(() => uploadButtonRef.current?.click(), 80);
  };

  const selectedDoc = documents.find((d) => d.id === selectedDocId);

  const handleOpenFile = async (docId: string, _fallbackUrl: string) => {
    window.open(`/api/bids/${bidCode}/documents/${docId}/stream`, "_blank");
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
      if (data.count > 0) {
        toast({ title: "Import complete", description: `${data.count} line item(s) added to your estimate` });
      } else if (data.message) {
        toast({ title: "No items imported", description: data.message, variant: "destructive" });
      } else {
        toast({ title: "No items imported", description: "No measurements found to import. Add measurements to your takeoff sheets first." });
      }
    },
    onError: (error: any) => {
      toast({ title: "Import failed", description: error.message, variant: "destructive" });
    },
  });

  const { data: storeyAssociations = [] } = useQuery<any[]>({
    queryKey: ["/api/bids", bidId, "bim", "storey-associations"],
    enabled: !!bidId,
  });

  const saveStoreyAssocMutation = useMutation({
    mutationFn: async (data: { sheetId: string; bimDocumentId: string; storeyExpressId: number; storeyName: string }) => {
      const res = await apiRequest("POST", `/api/bids/${bidId}/bim/storey-associations`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/bids", bidId, "bim", "storey-associations"] });
      setStoreyAssocDialogOpen(false);
      toast({ title: "Sheet linked to storey" });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to link sheet to storey", variant: "destructive" });
    },
  });

  const bimDocuments = useMemo(() =>
    documents.filter(d => d.type === "BIM" || d.fileName?.toLowerCase().endsWith(".ifc")),
    [documents]
  );

  const splitBimDoc = splitBimDocId ? documents.find(d => d.id === splitBimDocId) : bimDocuments[0] || null;

  const splitBimUrl = splitBimDoc ? { url: `/api/bids/${bidCode}/documents/${splitBimDoc.id}/stream` } : undefined;

  const handleBimElementSelect = useCallback((elements: BimSelectedElement[]) => {
    setBimSelectedElements(elements);
    if (elements.length > 0 && elements[0].storeyExpressId) {
      const assoc = storeyAssociations.find(
        (a: any) => a.storeyExpressId === elements[0].storeyExpressId
      );
      if (assoc) {
        setHighlightStoreyId(elements[0].storeyExpressId);
      }
    }
  }, [storeyAssociations]);

  const handleBimAddToTakeoff = useCallback(async (elements: BimElementSummary[]) => {
    if (!bidId || elements.length === 0) return;
    const targetSheet = sheets[0];
    if (!targetSheet) {
      toast({ title: "No takeoff sheet", description: "Create a takeoff sheet before adding BIM elements.", variant: "destructive" });
      return;
    }
    let added = 0;
    for (const el of elements) {
      const label = `${el.type}: ${el.name}`;
      const dims = el.dimensions || {};
      try {
        const body: any = {
          type: "COUNT",
          label,
          points: [{ x: 0, y: 0 }],
          sheetId: targetSheet.id,
          metadata: JSON.stringify({
            bimExpressId: el.expressID,
            bimType: el.type,
            bimMaterial: el.material,
            bimDimensions: dims,
          }),
        };
        await apiRequest("POST", "/api/takeoff/measurements", body);
        added++;
      } catch {
        toast({ title: "Error", description: `Failed to add ${el.name} to takeoff`, variant: "destructive" });
      }
    }
    queryClient.invalidateQueries({ queryKey: ["/api/takeoff/sheets"] });
    if (added > 0) {
      toast({ title: "Added to takeoff", description: `${added} element(s) added as measurements` });
    }
  }, [bidId, sheets, toast]);

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
                        {bimEnabled && <SelectItem value="BIM">BIM</SelectItem>}
                        <SelectItem value="OTHER">Other</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <ObjectUploader
                    key={docType}
                    maxNumberOfFiles={MAX_BATCH_UPLOAD_FILES}
                    maxFileSize={MAX_STORAGE_FILE_SIZE}
                    allowedFileTypes={docType === "PLANS" ? [".pdf"] : docType === "BIM" ? [".ifc"] : [".pdf", ".dwg", ".dxf", ".png", ".jpg", ".jpeg", ".xlsx", ".xls", ".csv", ".doc", ".docx", ".ifc"]}
                    fileType={docType === "BIM" ? "BIM" : "DOCUMENT"}
                    onComplete={handleUploadComplete}
                    testId="button-upload-bid-plan"
                  >
                    <Button ref={uploadButtonRef} variant="default" size="sm" className="w-full h-7 text-xs" disabled={createDocMutation.isPending} data-testid="button-upload-bid-plan">
                      <Upload className="w-3 h-3 mr-1" />
                      {createDocMutation.isPending ? "Saving..." : "Upload"}
                    </Button>
                  </ObjectUploader>
                  {docType === "PLANS" && (
                    <p className="text-[10px] text-muted-foreground" data-testid="hint-pdf-only">PDF and IFC files for Plans</p>
                  )}
                  {docType === "BIM" && (
                    <p className="text-[10px] text-muted-foreground" data-testid="hint-ifc-only">IFC files only for BIM models</p>
                  )}
                  <p className="text-[10px] text-muted-foreground" data-testid="hint-batch-upload-limit">{MAX_BATCH_UPLOAD_HELPER_TEXT}</p>
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
                            group.docs.map((doc) => (
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
                                data-testid={`bid-document-${doc.id}`}
                              >
                                <GripVertical className="w-3 h-3 text-muted-foreground opacity-0 group-hover:opacity-50 shrink-0 cursor-grab mt-0.5" />
                                {doc.type === "BIM" || doc.fileName?.toLowerCase().endsWith(".ifc") ? (
                                  <Box className="w-3.5 h-3.5 text-blue-500 shrink-0 mt-0.5" />
                                ) : (
                                  <File className="w-3.5 h-3.5 text-muted-foreground shrink-0 mt-0.5" />
                                )}
                                <span className="break-words flex-1 min-w-0 text-sm leading-snug">{doc.title || doc.fileName}</span>
                                {isIfcFile(doc.fileName) && (
                                  <Badge variant="secondary" className="text-[9px] h-4 px-1 shrink-0 bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300" data-testid={`badge-ifc-${doc.id}`}>IFC</Badge>
                                )}
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
                                    {bimEnabled && isIfcFile(doc.fileName) && (
                                      <DropdownMenuItem
                                        onClick={() => handleExtractBimQuantities(doc)}
                                        data-testid={`button-extract-bim-${doc.id}`}
                                      >
                                        <Box className="w-4 h-4 mr-2" />
                                        Extract Quantities
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
                          {(group.children || []).map((child) => {
                            const sfKey = subFolderKey(group.name, child.name);
                            const sfDocIds = subFolderDocs[sfKey] || [];
                            const sfDocs = documents.filter((d) => sfDocIds.includes(d.id));
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
                                      sfDocs.map((doc) => (
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
                              {folderSheets.filter((s) => !hiddenSheetIds.has(s.id)).length === 0 ? (
                                <div className="px-6 py-1 text-xs text-muted-foreground italic">
                                  {folderSheets.length > 0 ? "All sheets hidden" : "No sheets"}
                                </div>
                              ) : (
                                folderSheets.filter((s) => !hiddenSheetIds.has(s.id)).map((sheet) => (
                                  <div
                                    key={sheet.id}
                                    draggable
                                    onDragStart={(e) => handleSheetDragStart(e, sheet.id)}
                                    onDragEnd={() => setDraggedSheetId(null)}
                                    onClick={() => {
                                      if (renameSheetId === sheet.id) return;
                                      handleSelectSheetFromSidebar(sheet.id);
                                    }}
                                    className={cn(
                                      "flex items-start gap-1.5 px-3 py-1.5 text-sm cursor-pointer hover:bg-accent/50 transition-colors group",
                                      draggedSheetId === sheet.id && "opacity-50",
                                      selectedSheetId === sheet.id && !previewDocId && "bg-accent text-accent-foreground"
                                    )}
                                    data-testid={`sheet-${sheet.id}`}
                                  >
                                    <GripVertical
                                      className="w-3 h-3 text-muted-foreground opacity-0 group-hover:opacity-50 shrink-0 cursor-grab mt-0.5"
                                      onClick={(e) => e.stopPropagation()}
                                    />
                                    <FileText className="w-3.5 h-3.5 text-blue-400 shrink-0 mt-0.5" />
                                    {renameSheetId === sheet.id ? (
                                      <Input
                                        value={renameSheetValue}
                                        onChange={(e) => setRenameSheetValue(e.target.value)}
                                        onClick={(e) => e.stopPropagation()}
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
                                    {(sheet as any).folderGroup === "BIM" && (
                                      <Badge variant="secondary" className="text-[9px] h-4 px-1 shrink-0 bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300" data-testid={`badge-bim-sheet-${sheet.id}`}>BIM</Badge>
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

                <Separator className="my-2" />
                <div className="px-2 py-1.5">
                  <button
                    className="flex items-center gap-1.5 w-full text-sm hover:bg-accent/50 transition-colors rounded px-1 py-0.5"
                    onClick={() => setLibraryExpanded(!libraryExpanded)}
                    data-testid="section-libraries-toggle"
                  >
                    {libraryExpanded ? (
                      <ChevronDown className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                    ) : (
                      <ChevronRight className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                    )}
                    <BookOpen className="w-4 h-4 text-purple-500 shrink-0" />
                    <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                      Libraries
                    </span>
                  </button>
                </div>
                {libraryExpanded && (
                  <BidLibrarySection bidId={bidId} />
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

        <div className={cn("flex-1 min-w-0 relative flex", splitViewMode ? "flex-row" : "flex-col")}>
          {!splitViewMode && leftPanelCollapsed && !previewDocId && (
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
          {!splitViewMode && !leftPanelCollapsed && !previewDocId && (
            <Button
              size="icon"
              variant="ghost"
              className="absolute top-2 left-2 z-10 h-7 w-7 hidden md:flex mt-[11px] mb-[11px]"
              onClick={() => setLeftPanelCollapsed(true)}
              data-testid="button-collapse-panel"
            >
              <ChevronDown className="w-4 h-4 rotate-90" />
            </Button>
          )}

          {bimEnabled && splitViewMode ? (
            <>
              <div className="w-1/2 flex flex-col border-r min-w-0" data-testid="split-view-takeoff">
                <div className="flex items-center gap-2 px-2 py-1 border-b bg-muted/30 shrink-0">
                  <span className="text-xs font-semibold uppercase text-muted-foreground">2D Takeoff</span>
                  <div className="flex-1" />
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 text-[10px] gap-1"
                    onClick={() => setSplitViewMode(false)}
                    data-testid="button-exit-split-view"
                  >
                    <X className="w-3 h-3" />
                    Exit Split
                  </Button>
                  {/* Task #1727 — Same view-settings menu as the
                      takeoff pane so users can replay the tour or
                      flip the labeled-toolbar pref while in Split
                      View. The replay handler exits split mode first
                      so the Joyride targets in `<TakeoffWorkspace>`
                      are mounted in the takeoff pane. */}
                  <BidPlansViewSettingsMenu
                    labeled={labeledToolbar}
                    onToggleLabeled={toggleLabeledToolbar}
                    onReplayTour={handleReplayTour}
                  />
                </div>
                <div className="flex-1 min-h-0 overflow-hidden">
                  <WidgetErrorBoundary fallbackTitle="Takeoff Workspace">
                    <TakeoffWorkspace
                      context={{ type: "bid", bidId, bidCode }}
                      selectedSheetId={selectedSheetId}
                      onSelectSheet={setSelectedSheetId}
                      labeled={labeledToolbar}
                    />
                  </WidgetErrorBoundary>
                </div>
              </div>
              <div className="w-1/2 flex flex-col min-w-0" data-testid="split-view-bim">
                <div className="flex items-center gap-2 px-2 py-1 border-b bg-muted/30 shrink-0">
                  <span className="text-xs font-semibold uppercase text-muted-foreground">3D BIM</span>
                  {bimDocuments.length > 1 && (
                    <Select value={splitBimDocId || bimDocuments[0]?.id || ""} onValueChange={setSplitBimDocId}>
                      <SelectTrigger className="h-6 w-40 text-[10px]" data-testid="select-split-bim-doc">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {bimDocuments.map(d => (
                          <SelectItem key={d.id} value={d.id}>{d.title || d.fileName}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                  {bimSelectedElements.length > 0 && bimSelectedElements[0].storeyName && (
                    <Badge variant="outline" className="text-[9px] px-1">
                      <Building2 className="w-2.5 h-2.5 mr-0.5" />
                      {bimSelectedElements[0].storeyName}
                    </Badge>
                  )}
                  <div className="flex-1" />
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 text-[10px] gap-1"
                    onClick={() => {
                      setStoreyAssocDialogOpen(true);
                    }}
                    data-testid="button-link-storey"
                  >
                    <Link2 className="w-3 h-3" />
                    Link Sheet
                  </Button>
                </div>
                <div className="flex-1 min-h-0 overflow-hidden">
                  {splitBimDoc && splitBimUrl?.url ? (
                    <Suspense fallback={
                      <div className="flex items-center justify-center h-full">
                        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
                      </div>
                    }>
                      <WidgetErrorBoundary fallbackTitle="BIM Viewer">
                        <BimViewer
                          fileUrl={splitBimUrl.url}
                          fileName={splitBimDoc.title || splitBimDoc.fileName}
                          fileSize={splitBimDoc.fileSize}
                          uploadDate={splitBimDoc.uploadedAt}
                          onAddToTakeoff={handleBimAddToTakeoff}
                          onElementSelect={handleBimElementSelect}
                          highlightStoreyId={highlightStoreyId}
                        />
                      </WidgetErrorBoundary>
                    </Suspense>
                  ) : splitBimDoc ? (
                    <div className="flex items-center justify-center h-full">
                      <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center h-full text-center p-4">
                      <Box className="w-12 h-12 text-muted-foreground/30 mb-3" />
                      <p className="text-sm text-muted-foreground">No BIM model available. Upload an IFC file to use split view.</p>
                    </div>
                  )}
                </div>
              </div>
            </>
          ) : previewDocId ? (
            (() => {
              const doc = documents.find((d) => d.id === previewDocId);
              if (!doc) return <TakeoffCtaPane bidCode={bidCode} />;
              const isBim = bimEnabled && (doc.type === "BIM" || doc.fileName?.toLowerCase().endsWith(".ifc"));

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
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs gap-1"
                        onClick={() => { setPreviewDocId(null); setSplitBimDocId(doc.id); setSplitViewMode(true); }}
                        data-testid="button-enter-split-from-bim"
                      >
                        <Columns2 className="w-3.5 h-3.5" />
                        Split View
                      </Button>
                      {/* Task #1727 — Same view-settings menu as the
                          takeoff pane / standard preview header so
                          users can replay the tour or flip the
                          labeled-toolbar pref from the BIM viewer
                          too. The replay handler closes the BIM
                          preview first so the Joyride targets in
                          `<TakeoffWorkspace>` are mounted. */}
                      <BidPlansViewSettingsMenu
                        labeled={labeledToolbar}
                        onToggleLabeled={toggleLabeledToolbar}
                        onReplayTour={handleReplayTour}
                      />
                    </div>
                    <div className="flex-1 min-h-0 overflow-hidden">
                      <Suspense fallback={
                        <div className="flex items-center justify-center h-full">
                          <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
                        </div>
                      }>
                        <WidgetErrorBoundary fallbackTitle="BIM Viewer">
                          <BimViewer
                            fileUrl={previewUrlData.url}
                            fileName={doc.title || doc.fileName}
                            fileSize={doc.fileSize}
                            uploadDate={doc.uploadedAt}
                            onAddToTakeoff={handleBimAddToTakeoff}
                            onElementSelect={handleBimElementSelect}
                            highlightStoreyId={highlightStoreyId}
                          />
                        </WidgetErrorBoundary>
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
                      {/* Task #1727 — Keep the view-settings gear
                          available even while the BIM preview URL is
                          still loading, so the tour replay isn't
                          blocked by a slow signed-URL fetch. */}
                      <BidPlansViewSettingsMenu
                        labeled={labeledToolbar}
                        onToggleLabeled={toggleLabeledToolbar}
                        onReplayTour={handleReplayTour}
                      />
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
                    {/* Task #1696 — Same view-settings menu as the takeoff
                        pane so users can replay the tour or flip the
                        labeled-toolbar pref while previewing a doc. The
                        replay handler closes the preview first so the
                        Joyride targets in `<TakeoffWorkspace>` exist. */}
                    <BidPlansViewSettingsMenu
                      labeled={labeledToolbar}
                      onToggleLabeled={toggleLabeledToolbar}
                      onReplayTour={handleReplayTour}
                    />
                  </div>
                  <div className="flex-1 min-h-0 overflow-hidden">
                    {previewUrlLoading ? (
                      <div className="flex items-center justify-center h-full" data-testid="preview-loading">
                        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                      </div>
                    ) : (
                      <FilePreview
                        url={`/api/bids/${bidCode}/documents/${doc.id}/stream`}
                        fileName={doc.fileName}
                        title={doc.title || undefined}
                        mimeType={doc.mimeType}
                        onOpenFile={() => handleOpenFile(doc.id, doc.fileUrl)}
                      />
                    )}
                  </div>
                </div>
              );
            })()
          ) : (
            /* Task #2067 — When no document is being previewed and we are
               not in BIM split view, the Plans tab no longer embeds the
               full takeoff workspace. Instead it shows a CTA that opens
               the standalone, full-page Takeoff tool at /takeoff/:bidCode.
               Split View is still offered when BIM models exist. */
            <div className="flex flex-col h-full">
              <div className="flex items-center justify-end gap-2 px-2 py-1 border-b bg-muted/20 shrink-0">
                {bimEnabled && bimDocuments.length > 0 && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-6 text-[10px] gap-1"
                    onClick={() => setSplitViewMode(true)}
                    data-testid="button-split-view"
                  >
                    <Columns2 className="w-3 h-3" />
                    Split View (3D + 2D)
                  </Button>
                )}
                <BidPlansViewSettingsMenu
                  labeled={labeledToolbar}
                  onToggleLabeled={toggleLabeledToolbar}
                  onReplayTour={handleReplayTour}
                />
              </div>
              <div className="flex-1 min-h-0">
                <TakeoffCtaPane bidCode={bidCode} />
              </div>
            </div>
          )}
        </div>
      </div>

      <Dialog open={createFolderOpen} onOpenChange={(open) => { setCreateFolderOpen(open); if (!open) { setNewFolderName(""); setCreateFolderParent(null); } }}>
        <DialogContent className="sm:max-w-sm">
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
      <BimQuantityDialog
        open={bimDialogOpen}
        onOpenChange={setBimDialogOpen}
        bidId={bidId}
        extractionResult={bimExtractionResult}
        isExtracting={bimIsExtracting}
        extractionProgress={bimExtractionProgress}
        categories={categories}
      />

      <Dialog open={storeyAssocDialogOpen} onOpenChange={(open) => { setStoreyAssocDialogOpen(open); if (!open) { setStoreyAssocSheetId(null); setStoreyAssocStoreyId(""); setStoreyAssocStoreyName(""); } }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Link Sheet to BIM Storey</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <Label className="text-sm mb-1 block">Takeoff Sheet</Label>
              <Select value={storeyAssocSheetId || ""} onValueChange={setStoreyAssocSheetId}>
                <SelectTrigger className="h-8 text-xs" data-testid="select-storey-sheet">
                  <SelectValue placeholder="Select a sheet" />
                </SelectTrigger>
                <SelectContent>
                  {sheets.map(s => (
                    <SelectItem key={s.id} value={s.id}>{s.sheetName || `Sheet ${s.sheetIndex + 1}`}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-sm mb-1 block">BIM Storey Name</Label>
              <Input
                value={storeyAssocStoreyName}
                onChange={(e) => setStoreyAssocStoreyName(e.target.value)}
                placeholder="e.g. Level 1, Ground Floor"
                className="h-8 text-xs"
                data-testid="input-storey-name"
              />
            </div>
            <div>
              <Label className="text-sm mb-1 block">Storey Express ID</Label>
              <Input
                value={storeyAssocStoreyId}
                onChange={(e) => setStoreyAssocStoreyId(e.target.value)}
                placeholder="Express ID from BIM model"
                className="h-8 text-xs"
                data-testid="input-storey-express-id"
              />
            </div>
            {storeyAssociations.length > 0 && (
              <div>
                <Label className="text-[10px] text-muted-foreground mb-1 block">Existing Associations</Label>
                <div className="space-y-1 max-h-24 overflow-auto">
                  {storeyAssociations.map((a: any) => (
                    <div key={a.id} className="flex items-center justify-between text-[10px] bg-muted/50 rounded px-2 py-1">
                      <span className="truncate">{sheets.find(s => s.id === a.sheetId)?.sheetName || "Sheet"} → {a.storeyName}</span>
                      <Badge variant="outline" className="text-[8px] px-1 shrink-0 ml-1">#{a.storeyExpressId}</Badge>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setStoreyAssocDialogOpen(false)}>Cancel</Button>
            <Button
              onClick={() => {
                if (!storeyAssocSheetId || !storeyAssocStoreyName || !storeyAssocStoreyId) return;
                const bimDoc = splitBimDoc || bimDocuments[0];
                if (!bimDoc) return;
                saveStoreyAssocMutation.mutate({
                  sheetId: storeyAssocSheetId,
                  bimDocumentId: bimDoc.id,
                  storeyExpressId: parseInt(storeyAssocStoreyId, 10),
                  storeyName: storeyAssocStoreyName,
                });
              }}
              disabled={!storeyAssocSheetId || !storeyAssocStoreyName || !storeyAssocStoreyId || saveStoreyAssocMutation.isPending}
              data-testid="button-save-storey-association"
            >
              {saveStoreyAssocMutation.isPending ? "Saving..." : "Link"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/**
 * Task #1696 — Bid Plans view-settings menu.
 *
 * Mirrors the Settings dropdown that `<UnifiedPlanToolbar>` exposes on
 * the project Plans tab (Task #1663): a gear button with a tooltip
 * that opens a labeled-toolbar checkbox plus a "Show me the tour
 * again" item. Kept inline (rather than reusing `<UnifiedPlanToolbar>`
 * directly) because the bid surface has no pin filter / pin count
 * mode / clustering controls — it would be a lot of unrelated UI for
 * a single dropdown.
 */
function BidPlansViewSettingsMenu({
  labeled,
  onToggleLabeled,
  onReplayTour,
}: {
  labeled: boolean;
  onToggleLabeled: () => void;
  onReplayTour: () => void;
}) {
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7 shrink-0"
              data-testid="bid-plans-view-settings"
              aria-label="Plans view settings"
            >
              <Settings2 className="w-3.5 h-3.5" />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom"><span>Plans view settings</span></TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>Plans view</DropdownMenuLabel>
        <DropdownMenuCheckboxItem
          checked={!!labeled}
          onCheckedChange={() => onToggleLabeled()}
          data-testid="menu-item-bid-labeled-toolbar"
        >
          <Type className="w-3.5 h-3.5 mr-2" />
          Labeled toolbar
        </DropdownMenuCheckboxItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={() => onReplayTour()}
          data-testid="menu-item-replay-bid-plans-tour"
        >
          <BookOpen className="w-3.5 h-3.5 mr-2" />
          Show me the tour again
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Task #2067 — Call-to-action pane shown inside the bid Plans tab when no
 * document is being previewed. Replaces the previous embedded
 * `<TakeoffWorkspace>` and points users at the standalone, full-page
 * Takeoff tool at `/takeoff/:bidCode`.
 */
function TakeoffCtaPane({ bidCode }: { bidCode: string }) {
  return (
    <div
      className="flex flex-col items-center justify-center h-full text-center px-6 py-10 gap-5"
      data-testid="takeoff-cta-pane"
    >
      <div className="rounded-full bg-primary/10 p-4">
        <Maximize2 className="w-8 h-8 text-primary" />
      </div>
      <div className="max-w-md space-y-2">
        <h3 className="text-lg font-semibold tracking-tight">
          Open Takeoff in its own workspace
        </h3>
        <p className="text-sm text-muted-foreground">
          Takeoff now runs as a dedicated, full-screen tool with collapsible
          sidebars, scale calibration, and markups — all of your existing
          measurements move with you.
        </p>
      </div>
      <Button asChild size="lg" data-testid="button-open-takeoff-workspace">
        <Link href={`/takeoff/${bidCode}`}>
          <Maximize2 className="w-4 h-4 mr-2" />
          Open Full-Screen Takeoff
        </Link>
      </Button>
      <p className="text-xs text-muted-foreground">
        Tip: select a sheet on the left and we'll jump straight to it.
      </p>
    </div>
  );
}
