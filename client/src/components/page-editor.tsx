import { useState, useCallback, useRef, useEffect, lazy, Suspense, memo, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import {
  ArrowLeft,
  Save,
  Monitor,
  Tablet,
  Smartphone,
  Plus,
  Trash2,
  GripVertical,
  Eye,
  EyeOff,
  Copy,
  ChevronRight,
  Settings,
  Palette,
  Search,
  Loader2,
  LayoutGrid,
  X,
  Share2,
  History,
  Link2,
  Clock,
  RotateCcw,
  Undo2,
  Redo2,
  ExternalLink,
  ClipboardCopy,
  XCircle,
  Users,
  AlertTriangle,
  GitCompare,
  Activity,
  Gauge,
  CheckCircle2,
  MinusCircle,
  PlusCircle,
  RefreshCw,
  Bookmark,
  Pencil,
  MoreVertical,
  FolderOpen,
} from "lucide-react";
import {
  type BodyComponentType,
  type BodyComponent,
  type BodyComponentsConfig,
  type SharedStyles,
  COMPONENT_TYPE_META,
  createDefaultComponent,
  ComponentConfigEditor,
  StyleEditor,
} from "@/components/website-body-components";

interface PageData {
  id: string;
  websiteId: string;
  organizationId: string;
  pageType: string;
  pageSlug: string;
  pageTitle: string;
  contentJson: string | null;
  heroImageUrl: string | null;
  aiGenerated: boolean;
  metaTitle: string | null;
  metaDescription: string | null;
  keywords: string[] | null;
  showInNavigation: boolean;
  navigationOrder: number;
  navigationLabel: string | null;
  parentPageId: string | null;
  isPublished: boolean;
  noIndex: boolean;
  status?: string;
  updatedAt?: string;
}

interface PageEditorProps {
  pageId: string;
  onBack: () => void;
}

interface PresenceUser {
  userId: string;
  userName: string;
  activity: "viewing" | "editing";
}

interface ConflictInfo {
  conflict: boolean;
  serverUpdatedAt: string;
  lastEditor: string | null;
  lastSaved: string | null;
}

interface PerfMetrics {
  editorLoadTime: number | null;
  saveLatencies: number[];
  previewRenderTimes: number[];
  lastWarnings: string[];
}

const PERF_THRESHOLDS = {
  editorLoad: 2000,
  save: 500,
  previewRender: 1000,
};

export default function PageEditor({ pageId, onBack }: PageEditorProps) {
  const { toast } = useToast();
  const [components, setComponents] = useState<BodyComponent[]>([]);
  const [selectedComponentId, setSelectedComponentId] = useState<string | null>(null);
  const [rightPanel, setRightPanel] = useState<"component" | "page-settings">("component");
  const [devicePreview, setDevicePreview] = useState<"desktop" | "tablet" | "mobile">("desktop");
  const [searchQuery, setSearchQuery] = useState("");
  const [showComponentLibrary, setShowComponentLibrary] = useState(true);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [showShareDialog, setShowShareDialog] = useState(false);
  const [showVersionHistory, setShowVersionHistory] = useState(false);
  const [previewingVersionId, setPreviewingVersionId] = useState<string | null>(null);
  const [showConflictDialog, setShowConflictDialog] = useState(false);
  const [conflictInfo, setConflictInfo] = useState<ConflictInfo | null>(null);
  const [presenceUsers, setPresenceUsers] = useState<PresenceUser[]>([]);
  const [showPerfMonitor, setShowPerfMonitor] = useState(false);
  const [perfMetrics, setPerfMetrics] = useState<PerfMetrics>({
    editorLoadTime: null,
    saveLatencies: [],
    previewRenderTimes: [],
    lastWarnings: [],
  });
  const [showDiffDialog, setShowDiffDialog] = useState(false);
  const [diffVersionA, setDiffVersionA] = useState<string | null>(null);
  const [diffVersionB, setDiffVersionB] = useState<string | null>(null);
  const [showSaveGlobalDialog, setShowSaveGlobalDialog] = useState(false);
  const [saveGlobalName, setSaveGlobalName] = useState("");
  const [saveGlobalComponentId, setSaveGlobalComponentId] = useState<string | null>(null);
  const [showGlobalLibrary, setShowGlobalLibrary] = useState(false);
  const [editingGlobalId, setEditingGlobalId] = useState<string | null>(null);
  const [editingGlobalName, setEditingGlobalName] = useState("");
  const [pageSettings, setPageSettings] = useState({
    pageTitle: "",
    pageSlug: "",
    pageType: "CUSTOM",
    navigationLabel: "",
    showInNavigation: true,
    status: "DRAFT",
    metaTitle: "",
    metaDescription: "",
  });
  const dragItem = useRef<number | null>(null);
  const dragOverItem = useRef<number | null>(null);
  const initialized = useRef(false);
  const loadStartTime = useRef(Date.now());
  const sessionUpdatedAt = useRef<string | null>(null);
  const undoStack = useRef<BodyComponent[][]>([]);
  const redoStack = useRef<BodyComponent[][]>([]);

  const { data: pageData, isLoading } = useQuery<PageData>({
    queryKey: [`/api/website/pages/${pageId}`],
  });

  useEffect(() => {
    if (pageData && !initialized.current) {
      initialized.current = true;
      const loadTime = Date.now() - loadStartTime.current;
      setPerfMetrics(prev => {
        const warnings = [...prev.lastWarnings];
        if (loadTime > PERF_THRESHOLDS.editorLoad) {
          warnings.push(`Editor load: ${loadTime}ms (threshold: ${PERF_THRESHOLDS.editorLoad}ms)`);
        }
        return { ...prev, editorLoadTime: loadTime, lastWarnings: warnings.slice(-10) };
      });
      sessionUpdatedAt.current = pageData.updatedAt || new Date().toISOString();
      if (pageData.contentJson) {
        try {
          const parsed = JSON.parse(pageData.contentJson) as BodyComponentsConfig;
          setComponents(parsed.components || []);
        } catch {
          setComponents([]);
        }
      }
      setPageSettings({
        pageTitle: pageData.pageTitle || "",
        pageSlug: pageData.pageSlug || "",
        pageType: pageData.pageType || "CUSTOM",
        navigationLabel: pageData.navigationLabel || "",
        showInNavigation: pageData.showInNavigation ?? true,
        status: pageData.status || (pageData.isPublished ? "PUBLISHED" : "DRAFT"),
        metaTitle: pageData.metaTitle || "",
        metaDescription: pageData.metaDescription || "",
      });
    }
  }, [pageData]);

  useEffect(() => {
    let interval: ReturnType<typeof setInterval>;
    const sendPresence = async () => {
      try {
        const activity = hasUnsavedChanges ? "editing" : "viewing";
        const res = await apiRequest("POST", `/api/website/pages/${pageId}/presence`, { activity });
        const data = await res.json();
        setPresenceUsers(data.users || []);
      } catch {}
    };
    sendPresence();
    interval = setInterval(sendPresence, 10000);
    return () => {
      clearInterval(interval);
      apiRequest("DELETE", `/api/website/pages/${pageId}/presence`).catch(() => {});
    };
  }, [pageId, hasUnsavedChanges]);

  const saveMutationRef = useRef<{ mutate: () => void }>({ mutate: () => {} });

  const executeSave = useCallback(() => {
    saveMutationRef.current.mutate();
  }, []);

  const checkConflictBeforeSave = useCallback(async () => {
    if (!sessionUpdatedAt.current) {
      executeSave();
      return;
    }
    try {
      const res = await apiRequest("GET", `/api/website/pages/${pageId}/check-conflict?since=${encodeURIComponent(sessionUpdatedAt.current)}`);
      const data: ConflictInfo = await res.json();
      if (data.conflict) {
        setConflictInfo(data);
        setShowConflictDialog(true);
      } else {
        executeSave();
      }
    } catch {
      executeSave();
    }
  }, [pageId, executeSave]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const saveStart = performance.now();
      const contentJson = JSON.stringify({ components } as BodyComponentsConfig);
      const { status, ...rest } = pageSettings;
      const body = {
        ...rest,
        contentJson,
        isPublished: status === "PUBLISHED",
      };
      const result = await apiRequest("PATCH", `/api/website/pages/${pageId}`, body);
      const saveLatency = Math.round(performance.now() - saveStart);
      setPerfMetrics(prev => {
        const latencies = [...prev.saveLatencies, saveLatency].slice(-20);
        const warnings = [...prev.lastWarnings];
        if (saveLatency > PERF_THRESHOLDS.save) {
          warnings.push(`Save latency: ${saveLatency}ms (threshold: ${PERF_THRESHOLDS.save}ms)`);
        }
        return { ...prev, saveLatencies: latencies, lastWarnings: warnings.slice(-10) };
      });
      return result;
    },
    onSuccess: async (res) => {
      try {
        const data = await res.json();
        sessionUpdatedAt.current = data.updatedAt || new Date().toISOString();
      } catch {}
      queryClient.invalidateQueries({ queryKey: ["/api/website/pages", pageId] });
      queryClient.invalidateQueries({ queryKey: ["/api/website/pages"] });
      setHasUnsavedChanges(false);
      setShowConflictDialog(false);
      toast({ title: "Page saved successfully" });
      createVersionMutation.mutate({ trigger: "save", changeSummary: "Saved page changes" });
    },
    onError: (error: any) => {
      toast({ title: "Error saving page", description: error.message, variant: "destructive" });
    },
  });

  saveMutationRef.current = saveMutation;

  const createVersionMutation = useMutation({
    mutationFn: async (data: { trigger: string; changeSummary: string }) => {
      return await apiRequest("POST", `/api/website/pages/${pageId}/versions`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/website/pages", pageId, "versions"] });
    },
  });

  const revertVersionMutation = useMutation({
    mutationFn: async (versionId: string) => {
      return await apiRequest("POST", `/api/website/pages/${pageId}/revert/${versionId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/website/pages", pageId] });
      queryClient.invalidateQueries({ queryKey: ["/api/website/pages", pageId, "versions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/website/pages"] });
      initialized.current = false;
      setShowVersionHistory(false);
      setPreviewingVersionId(null);
      toast({ title: "Page reverted successfully" });
    },
    onError: (error: any) => {
      toast({ title: "Error reverting page", description: error.message, variant: "destructive" });
    },
  });

  const { data: globalComponentsData, refetch: refetchGlobals } = useQuery<{ components: any[] }>({
    queryKey: ["/api/website/global-components"],
  });
  const globalComponents = globalComponentsData?.components || [];

  const saveGlobalMutation = useMutation({
    mutationFn: async ({ name, component }: { name: string; component: BodyComponent }) => {
      return await apiRequest("POST", "/api/website/global-components", { name, component });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/website/global-components"] });
      setShowSaveGlobalDialog(false);
      setSaveGlobalName("");
      setSaveGlobalComponentId(null);
      toast({ title: "Component saved as reusable" });
    },
    onError: (error: any) => {
      toast({ title: "Error saving component", description: error.message, variant: "destructive" });
    },
  });

  const renameGlobalMutation = useMutation({
    mutationFn: async ({ id, name }: { id: string; name: string }) => {
      return await apiRequest("PATCH", `/api/website/global-components/${id}`, { name });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/website/global-components"] });
      setEditingGlobalId(null);
      setEditingGlobalName("");
      toast({ title: "Component renamed" });
    },
  });

  const updateGlobalMutation = useMutation({
    mutationFn: async ({ id, component }: { id: string; component: BodyComponent }) => {
      return await apiRequest("PATCH", `/api/website/global-components/${id}`, { component });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/website/global-components"] });
      toast({ title: "Global component updated" });
    },
  });

  const duplicateGlobalMutation = useMutation({
    mutationFn: async (id: string) => {
      return await apiRequest("POST", `/api/website/global-components/${id}/duplicate`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/website/global-components"] });
      toast({ title: "Component duplicated" });
    },
  });

  const deleteGlobalMutation = useMutation({
    mutationFn: async (id: string) => {
      return await apiRequest("DELETE", `/api/website/global-components/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/website/global-components"] });
      toast({ title: "Component deleted" });
    },
  });

  const openSaveAsGlobal = useCallback((compId: string) => {
    const comp = components.find(c => c.id === compId);
    if (!comp) return;
    setSaveGlobalComponentId(compId);
    setSaveGlobalName(comp.label || COMPONENT_TYPE_META[comp.type]?.label || "Untitled");
    setShowSaveGlobalDialog(true);
  }, [components]);

  const markChanged = useCallback(() => {
    setHasUnsavedChanges(true);
  }, []);

  const undoRef = useRef<() => void>(() => {});
  const redoRef = useRef<() => void>(() => {});

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        undoRef.current();
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
        e.preventDefault();
        redoRef.current();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const updateComponents = useCallback((newComps: BodyComponent[]) => {
    setComponents(prev => {
      undoStack.current = [...undoStack.current, JSON.parse(JSON.stringify(prev))];
      if (undoStack.current.length > 50) undoStack.current = undoStack.current.slice(-50);
      redoStack.current = [];
      return newComps;
    });
    markChanged();
  }, [markChanged]);

  const handleUndo = useCallback(() => {
    if (undoStack.current.length === 0) return;
    const previousState = undoStack.current.pop()!;
    setComponents(prev => {
      redoStack.current = [...redoStack.current, JSON.parse(JSON.stringify(prev))];
      return previousState;
    });
    markChanged();
  }, [markChanged]);

  const handleRedo = useCallback(() => {
    if (redoStack.current.length === 0) return;
    const nextState = redoStack.current.pop()!;
    setComponents(prev => {
      undoStack.current = [...undoStack.current, JSON.parse(JSON.stringify(prev))];
      return nextState;
    });
    markChanged();
  }, [markChanged]);

  useEffect(() => { undoRef.current = handleUndo; }, [handleUndo]);
  useEffect(() => { redoRef.current = handleRedo; }, [handleRedo]);

  const addComponent = useCallback((type: BodyComponentType) => {
    const newComp = createDefaultComponent(type, components.length);
    updateComponents([...components, newComp]);
    setSelectedComponentId(newComp.id);
    setRightPanel("component");
  }, [components, updateComponents]);

  const addComponentAtIndex = useCallback((type: BodyComponentType, index: number) => {
    const newComp = createDefaultComponent(type, index);
    const newComps = [...components];
    newComps.splice(index, 0, newComp);
    newComps.forEach((c, i) => { c.order = i; });
    updateComponents(newComps);
    setSelectedComponentId(newComp.id);
    setRightPanel("component");
  }, [components, updateComponents]);

  const removeComponent = useCallback((id: string) => {
    const newComps = components.filter(c => c.id !== id);
    newComps.forEach((c, i) => { c.order = i; });
    updateComponents(newComps);
    if (selectedComponentId === id) setSelectedComponentId(null);
  }, [components, updateComponents, selectedComponentId]);

  const duplicateComponent = useCallback((id: string) => {
    const comp = components.find(c => c.id === id);
    if (!comp) return;
    const newComp = JSON.parse(JSON.stringify(comp)) as BodyComponent;
    newComp.id = `body-${comp.type}-${Date.now()}`;
    newComp.label = `${comp.label} (Copy)`;
    const idx = components.findIndex(c => c.id === id);
    const newComponents = [...components];
    newComponents.splice(idx + 1, 0, newComp);
    newComponents.forEach((c, i) => { c.order = i; });
    updateComponents(newComponents);
    setSelectedComponentId(newComp.id);
    setRightPanel("component");
    setTimeout(() => {
      const el = document.querySelector(`[data-testid="canvas-component-${newComp.id}"]`);
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 100);
  }, [components, updateComponents]);

  const insertGlobalComponent = useCallback((globalComp: any) => {
    let srcComp = globalComp.component;
    if (!srcComp && globalComp.type) {
      const { name: _n, createdAt: _c, updatedAt: _u, ...rest } = globalComp;
      srcComp = rest;
    }
    if (!srcComp) {
      toast({ title: "Error", description: "This saved component has no content data.", variant: "destructive" });
      return;
    }
    const comp = JSON.parse(JSON.stringify(srcComp)) as BodyComponent;
    comp.id = `body-${comp.type}-${Date.now()}`;
    comp.order = components.length;
    updateComponents([...components, comp]);
    setSelectedComponentId(comp.id);
    setRightPanel("component");
    toast({ title: `Inserted "${globalComp.name || 'Component'}"` });
  }, [components, updateComponents, toast]);

  const updateComponent = useCallback((id: string, updates: Partial<BodyComponent>) => {
    const newComps = components.map(c =>
      c.id === id ? { ...c, ...updates } as BodyComponent : c
    );
    updateComponents(newComps);
  }, [components, updateComponents]);

  const updateComponentConfig = useCallback((id: string, newConfig: any) => {
    const newComps = components.map(c =>
      c.id === id ? { ...c, config: newConfig } as BodyComponent : c
    );
    updateComponents(newComps);
  }, [components, updateComponents]);

  const updateComponentStyles = useCallback((id: string, styles: SharedStyles) => {
    const newComps = components.map(c =>
      c.id === id ? { ...c, styles } as BodyComponent : c
    );
    updateComponents(newComps);
  }, [components, updateComponents]);

  const handleDragEnd = useCallback(() => {
    if (dragItem.current === null || dragOverItem.current === null) return;
    if (dragItem.current === dragOverItem.current) return;
    const sorted = [...components].sort((a, b) => a.order - b.order);
    const [moved] = sorted.splice(dragItem.current, 1);
    sorted.splice(dragOverItem.current, 0, moved);
    sorted.forEach((c, i) => { c.order = i; });
    updateComponents(sorted);
    dragItem.current = null;
    dragOverItem.current = null;
  }, [components, updateComponents]);

  const sortedComponents = [...components].sort((a, b) => a.order - b.order);
  const selectedComponent = selectedComponentId
    ? components.find(c => c.id === selectedComponentId) || null
    : null;

  const filteredComponentTypes = Object.entries(COMPONENT_TYPE_META).filter(
    ([_, meta]) =>
      !searchQuery ||
      meta.label.toLowerCase().includes(searchQuery.toLowerCase()) ||
      meta.description.toLowerCase().includes(searchQuery.toLowerCase())
  ) as [BodyComponentType, typeof COMPONENT_TYPE_META["banner"]][];

  if (isLoading) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center gap-3 p-3 border-b">
          <Skeleton className="h-9 w-24" />
          <Skeleton className="h-5 w-48" />
        </div>
        <div className="flex flex-1">
          <Skeleton className="w-64 h-full" />
          <Skeleton className="flex-1 h-full" />
          <Skeleton className="w-80 h-full" />
        </div>
      </div>
    );
  }

  if (!pageData) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4">
        <p className="text-muted-foreground">Page not found</p>
        <Button onClick={onBack} data-testid="button-back-not-found">
          <ArrowLeft className="h-4 w-4 mr-1" />
          Back to Pages
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full relative" data-testid="page-editor">
      {/* Top Toolbar */}
      <div className="flex items-center justify-between gap-2 p-2 border-b bg-background z-50 flex-wrap">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={onBack} data-testid="button-editor-back">
            <ArrowLeft className="h-4 w-4 mr-1" />
            Pages
          </Button>
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium truncate max-w-[200px]">{pageSettings.pageTitle || "Untitled"}</span>
          {hasUnsavedChanges && (
            <Badge variant="secondary" className="text-[10px]">Unsaved</Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-0.5 p-0.5 border rounded-md">
            <Button
              size="sm"
              variant={devicePreview === "desktop" ? "default" : "ghost"}
              onClick={() => setDevicePreview("desktop")}
              data-testid="button-preview-desktop"
            >
              <Monitor className="h-3.5 w-3.5" />
            </Button>
            <Button
              size="sm"
              variant={devicePreview === "tablet" ? "default" : "ghost"}
              onClick={() => setDevicePreview("tablet")}
              data-testid="button-preview-tablet"
            >
              <Tablet className="h-3.5 w-3.5" />
            </Button>
            <Button
              size="sm"
              variant={devicePreview === "mobile" ? "default" : "ghost"}
              onClick={() => setDevicePreview("mobile")}
              data-testid="button-preview-mobile"
            >
              <Smartphone className="h-3.5 w-3.5" />
            </Button>
          </div>
          {presenceUsers.length > 0 && (
            <div className="flex items-center gap-1.5 px-2 py-1 bg-muted rounded-md" data-testid="presence-indicator">
              <Users className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">
                {presenceUsers.length === 1
                  ? `${presenceUsers[0].userName} is ${presenceUsers[0].activity === "editing" ? "editing" : "viewing"}`
                  : `${presenceUsers.length} users ${presenceUsers.some(u => u.activity === "editing") ? "editing" : "viewing"}`}
              </span>
            </div>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowShareDialog(true)}
            data-testid="button-share-preview"
          >
            <Share2 className="h-4 w-4 mr-1" />
            Share
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowVersionHistory(true)}
            data-testid="button-version-history"
          >
            <History className="h-4 w-4 mr-1" />
            Versions
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowPerfMonitor(!showPerfMonitor)}
            data-testid="button-perf-monitor"
          >
            <Gauge className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setRightPanel("page-settings");
              setSelectedComponentId(null);
            }}
            data-testid="button-page-settings"
          >
            <Settings className="h-4 w-4 mr-1" />
            Page Settings
          </Button>
          <Button
            size="icon"
            variant="ghost"
            onClick={handleUndo}
            disabled={undoStack.current.length === 0}
            title="Undo (Ctrl+Z)"
            data-testid="button-undo"
          >
            <Undo2 className="h-4 w-4" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            onClick={handleRedo}
            disabled={redoStack.current.length === 0}
            title="Redo (Ctrl+Y)"
            data-testid="button-redo"
          >
            <Redo2 className="h-4 w-4" />
          </Button>
          <Button
            size="sm"
            onClick={() => checkConflictBeforeSave()}
            disabled={saveMutation.isPending || !hasUnsavedChanges}
            data-testid="button-save-page-editor"
          >
            {saveMutation.isPending ? (
              <Loader2 className="h-4 w-4 mr-1 animate-spin" />
            ) : (
              <Save className="h-4 w-4 mr-1" />
            )}
            Save
          </Button>
        </div>
      </div>

      {/* 3-Panel Layout */}
      <div className="flex flex-1 overflow-hidden">
        {/* LEFT SIDEBAR - Component Library */}
        <div className={`border-r bg-muted/30 flex flex-col transition-all ${showComponentLibrary ? "w-56" : "w-0"}`}>
          {showComponentLibrary && (
            <>
              <div className="p-2 border-b space-y-2">
                <div className="flex items-center gap-0.5 p-0.5 border rounded-md overflow-hidden">
                  <Button
                    size="sm"
                    variant={!showGlobalLibrary ? "default" : "ghost"}
                    onClick={() => setShowGlobalLibrary(false)}
                    className="flex-1 min-w-0 text-[11px] h-7 px-2"
                    data-testid="button-library-components"
                  >
                    <Plus className="h-3 w-3 mr-1 flex-shrink-0" />
                    <span className="truncate">Components</span>
                  </Button>
                  <Button
                    size="sm"
                    variant={showGlobalLibrary ? "default" : "ghost"}
                    onClick={() => setShowGlobalLibrary(true)}
                    className="flex-1 min-w-0 text-[11px] h-7 px-2"
                    data-testid="button-library-saved"
                  >
                    <FolderOpen className="h-3 w-3 mr-1 flex-shrink-0" />
                    <span className="truncate">Saved ({globalComponents.length})</span>
                  </Button>
                </div>
                {!showGlobalLibrary && (
                  <div className="relative">
                    <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                    <Input
                      placeholder="Search components..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="pl-7 h-8 text-xs"
                      data-testid="input-search-components"
                    />
                  </div>
                )}
              </div>
              <ScrollArea className="flex-1">
                {!showGlobalLibrary ? (
                  <div className="p-2 space-y-1">
                    {filteredComponentTypes.map(([type, meta]) => {
                      const Icon = meta.icon;
                      return (
                        <button
                          key={type}
                          className="w-full flex items-start gap-2 p-2 rounded-md text-left hover-elevate transition-colors cursor-pointer"
                          onClick={() => addComponent(type)}
                          data-testid={`library-add-${type}`}
                        >
                          <Icon className="h-4 w-4 mt-0.5 text-muted-foreground flex-shrink-0" />
                          <div className="min-w-0">
                            <div className="text-xs font-medium truncate">{meta.label}</div>
                            <div className="text-[10px] text-muted-foreground leading-tight">{meta.description}</div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <div className="p-2 space-y-1">
                    {globalComponents.length === 0 ? (
                      <div className="flex flex-col items-center justify-center py-8 text-center px-2">
                        <Bookmark className="h-8 w-8 text-muted-foreground/40 mb-2" />
                        <p className="text-xs text-muted-foreground">No saved components yet.</p>
                        <p className="text-[10px] text-muted-foreground mt-1">Select a component on the canvas and click "Save as Reusable" to save it here.</p>
                      </div>
                    ) : (
                      globalComponents.map((gc: any) => {
                        const compType = gc.component?.type;
                        const meta = compType ? COMPONENT_TYPE_META[compType as BodyComponentType] : null;
                        const Icon = meta?.icon || LayoutGrid;
                        const isEditing = editingGlobalId === gc.id;

                        return (
                          <div key={gc.id} className="rounded-md border bg-background p-2 space-y-1.5" data-testid={`global-comp-${gc.id}`}>
                            {isEditing ? (
                              <div className="flex items-center gap-1">
                                <Input
                                  value={editingGlobalName}
                                  onChange={(e) => setEditingGlobalName(e.target.value)}
                                  className="h-7 text-xs flex-1"
                                  autoFocus
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter" && editingGlobalName.trim()) {
                                      renameGlobalMutation.mutate({ id: gc.id, name: editingGlobalName.trim() });
                                    } else if (e.key === "Escape") {
                                      setEditingGlobalId(null);
                                    }
                                  }}
                                  data-testid="input-rename-global"
                                />
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-7 w-7"
                                  onClick={() => {
                                    if (editingGlobalName.trim()) {
                                      renameGlobalMutation.mutate({ id: gc.id, name: editingGlobalName.trim() });
                                    }
                                  }}
                                  data-testid="button-confirm-rename"
                                >
                                  <CheckCircle2 className="h-3 w-3" />
                                </Button>
                              </div>
                            ) : (
                              <div className="flex items-center gap-1.5">
                                <Icon className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                                <span className="text-xs font-medium truncate flex-1">{gc.name}</span>
                                <Badge variant="secondary" className="text-[9px] px-1 flex-shrink-0">{meta?.label || compType}</Badge>
                              </div>
                            )}
                            <div className="flex items-center gap-1 flex-wrap">
                              <Button
                                variant="outline"
                                size="sm"
                                className="flex-1 h-7 text-[10px]"
                                onClick={() => insertGlobalComponent(gc)}
                                data-testid={`button-insert-global-${gc.id}`}
                              >
                                <Plus className="h-3 w-3 mr-0.5" />
                                Insert
                              </Button>
                              {selectedComponent && selectedComponent.type === (gc.component?.type || gc.type) && (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="h-7 text-[10px]"
                                  onClick={() => {
                                    updateGlobalMutation.mutate({ id: gc.id, component: selectedComponent });
                                  }}
                                  title="Update with selected component"
                                  data-testid={`button-update-global-${gc.id}`}
                                >
                                  <RefreshCw className="h-3 w-3 mr-0.5" />
                                  Update
                                </Button>
                              )}
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7"
                                onClick={() => { setEditingGlobalId(gc.id); setEditingGlobalName(gc.name); }}
                                title="Rename"
                                data-testid={`button-rename-global-${gc.id}`}
                              >
                                <Pencil className="h-3 w-3" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7"
                                onClick={() => duplicateGlobalMutation.mutate(gc.id)}
                                title="Duplicate"
                                data-testid={`button-duplicate-global-${gc.id}`}
                              >
                                <Copy className="h-3 w-3" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 text-destructive"
                                onClick={() => deleteGlobalMutation.mutate(gc.id)}
                                title="Delete"
                                data-testid={`button-delete-global-${gc.id}`}
                              >
                                <Trash2 className="h-3 w-3" />
                              </Button>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                )}
              </ScrollArea>
            </>
          )}
        </div>

        {/* Toggle left sidebar */}
        <button
          className="flex items-center justify-center w-5 border-r hover-elevate transition-colors flex-shrink-0"
          onClick={() => setShowComponentLibrary(!showComponentLibrary)}
          data-testid="button-toggle-library"
        >
          <ChevronRight className={`h-3 w-3 text-muted-foreground transition-transform ${showComponentLibrary ? "rotate-180" : ""}`} />
        </button>

        {/* MAIN CANVAS */}
        <div className="flex-1 overflow-auto bg-muted/20">
          <div className={`mx-auto p-6 transition-all ${
            devicePreview === "desktop" ? "max-w-full" :
            devicePreview === "tablet" ? "max-w-[768px]" :
            "max-w-[375px]"
          }`}>
            {sortedComponents.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-24 text-center">
                <LayoutGrid className="h-16 w-16 text-muted-foreground/40 mb-4" />
                <h3 className="text-lg font-medium mb-2">Start building your page</h3>
                <p className="text-sm text-muted-foreground mb-4 max-w-md">
                  Add components from the library on the left, or click below to add your first section.
                </p>
                <Button onClick={() => addComponent("hero")} data-testid="button-add-first-component">
                  <Plus className="h-4 w-4 mr-1" />
                  Add Hero Section
                </Button>
              </div>
            ) : (
              <div className="space-y-0">
                {sortedComponents.map((comp, idx) => {
                  const meta = COMPONENT_TYPE_META[comp.type];
                  const Icon = meta.icon;
                  const isSelected = selectedComponentId === comp.id;
                  const visKey = devicePreview === "mobile" ? "visibleMobile" : "visibleDesktop";
                  const isVisible = comp[visKey];

                  return (
                    <div key={comp.id}>
                      {/* Add-between drop zone */}
                      <AddBetweenZone index={idx} onAdd={addComponentAtIndex} />

                      {/* Component block on canvas */}
                      <div
                        draggable
                        onDragStart={() => { dragItem.current = idx; }}
                        onDragOver={(e) => { e.preventDefault(); dragOverItem.current = idx; }}
                        onDrop={(e) => { e.preventDefault(); handleDragEnd(); }}
                        onClick={() => {
                          setSelectedComponentId(comp.id);
                          setRightPanel("component");
                        }}
                        className={`relative group border-2 rounded-md transition-all cursor-pointer ${
                          isSelected
                            ? "border-primary ring-1 ring-primary/20"
                            : "border-transparent hover:border-muted-foreground/30"
                        } ${!comp.enabled || !isVisible ? "opacity-40" : ""}`}
                        data-testid={`canvas-component-${comp.id}`}
                      >
                        {/* Component label overlay */}
                        <div className={`absolute -top-3 left-3 z-10 flex items-center gap-1 ${isSelected ? "visible" : "invisible group-hover:visible"}`}>
                          <Badge variant={isSelected ? "default" : "secondary"} className="text-[10px] px-1.5 py-0 gap-1">
                            <GripVertical className="h-3 w-3 cursor-grab" />
                            <Icon className="h-3 w-3" />
                            {meta.label}
                          </Badge>
                        </div>

                        {/* Component action buttons overlay */}
                        <div
                          className={`absolute -top-3 right-3 z-30 flex items-center gap-0.5 ${isSelected ? "visible" : "invisible group-hover:visible"}`}
                          draggable={false}
                          onDragStart={(e) => { e.preventDefault(); e.stopPropagation(); }}
                          onMouseDown={(e) => e.stopPropagation()}
                        >
                          <Button
                            variant="secondary"
                            size="icon"
                            draggable={false}
                            onClick={(e) => { e.preventDefault(); e.stopPropagation(); openSaveAsGlobal(comp.id); }}
                            onMouseDown={(e) => e.stopPropagation()}
                            data-testid={`canvas-save-global-${comp.id}`}
                            title="Save as Reusable"
                          >
                            <Bookmark className="h-3 w-3" />
                          </Button>
                          <Button
                            variant="secondary"
                            size="icon"
                            draggable={false}
                            onClick={(e) => { e.preventDefault(); e.stopPropagation(); duplicateComponent(comp.id); }}
                            onMouseDown={(e) => e.stopPropagation()}
                            data-testid={`canvas-duplicate-${comp.id}`}
                          >
                            <Copy className="h-3 w-3" />
                          </Button>
                          <Button
                            variant="secondary"
                            size="icon"
                            draggable={false}
                            onClick={(e) => { e.preventDefault(); e.stopPropagation(); removeComponent(comp.id); }}
                            onMouseDown={(e) => e.stopPropagation()}
                            data-testid={`canvas-remove-${comp.id}`}
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>

                        {/* Component preview content */}
                        <CanvasComponentPreview component={comp} devicePreview={devicePreview} />
                      </div>
                    </div>
                  );
                })}

                {/* Add-after zone */}
                <AddBetweenZone index={sortedComponents.length} onAdd={addComponentAtIndex} />
              </div>
            )}
          </div>
        </div>

        {/* RIGHT SIDEBAR - Settings Panel */}
        <div className="w-80 border-l bg-background flex flex-col overflow-hidden">
          {rightPanel === "page-settings" ? (
            <PageSettingsPanel
              settings={pageSettings}
              onChange={(s) => { setPageSettings(s); markChanged(); }}
              onClose={() => setRightPanel("component")}
            />
          ) : selectedComponent ? (
            <ComponentSettingsPanel
              component={selectedComponent}
              onUpdateComponent={(updates) => updateComponent(selectedComponent.id, updates)}
              onUpdateConfig={(config) => updateComponentConfig(selectedComponent.id, config)}
              onUpdateStyles={(styles) => updateComponentStyles(selectedComponent.id, styles)}
              onRemove={() => removeComponent(selectedComponent.id)}
              onDuplicate={() => duplicateComponent(selectedComponent.id)}
              onSaveAsGlobal={() => openSaveAsGlobal(selectedComponent.id)}
              onDeselect={() => setSelectedComponentId(null)}
            />
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-center p-6">
              <LayoutGrid className="h-10 w-10 text-muted-foreground/40 mb-3" />
              <p className="text-sm text-muted-foreground">
                Select a component on the canvas to edit its settings, or use Page Settings to configure this page.
              </p>
              <Button
                variant="outline"
                size="sm"
                className="mt-4"
                onClick={() => setRightPanel("page-settings")}
                data-testid="button-open-page-settings"
              >
                <Settings className="h-4 w-4 mr-1" />
                Page Settings
              </Button>
            </div>
          )}
        </div>
      </div>

      {showPerfMonitor && (
        <div className="absolute bottom-4 right-4 z-50 w-80 bg-background border rounded-md shadow-lg" data-testid="perf-monitor-panel">
          <div className="flex items-center justify-between gap-2 p-2 border-b">
            <div className="flex items-center gap-1.5">
              <Activity className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-xs font-medium">Performance Monitor</span>
            </div>
            <Button variant="ghost" size="icon" onClick={() => setShowPerfMonitor(false)} data-testid="button-close-perf">
              <X className="h-3 w-3" />
            </Button>
          </div>
          <div className="p-3 space-y-3 text-xs">
            <div className="grid grid-cols-2 gap-2">
              <div className="p-2 border rounded-md">
                <p className="text-muted-foreground mb-0.5">Editor Load</p>
                <p className="font-medium" data-testid="perf-editor-load">
                  {perfMetrics.editorLoadTime != null ? `${perfMetrics.editorLoadTime}ms` : "---"}
                </p>
                {perfMetrics.editorLoadTime != null && (
                  <PerfStatusBadge value={perfMetrics.editorLoadTime} threshold={PERF_THRESHOLDS.editorLoad} />
                )}
              </div>
              <div className="p-2 border rounded-md">
                <p className="text-muted-foreground mb-0.5">Avg Save</p>
                <p className="font-medium" data-testid="perf-avg-save">
                  {perfMetrics.saveLatencies.length > 0
                    ? `${Math.round(perfMetrics.saveLatencies.reduce((a, b) => a + b, 0) / perfMetrics.saveLatencies.length)}ms`
                    : "---"}
                </p>
                {perfMetrics.saveLatencies.length > 0 && (
                  <PerfStatusBadge
                    value={Math.round(perfMetrics.saveLatencies.reduce((a, b) => a + b, 0) / perfMetrics.saveLatencies.length)}
                    threshold={PERF_THRESHOLDS.save}
                  />
                )}
              </div>
              <div className="p-2 border rounded-md">
                <p className="text-muted-foreground mb-0.5">Avg Preview</p>
                <p className="font-medium" data-testid="perf-avg-preview">
                  {perfMetrics.previewRenderTimes.length > 0
                    ? `${Math.round(perfMetrics.previewRenderTimes.reduce((a, b) => a + b, 0) / perfMetrics.previewRenderTimes.length)}ms`
                    : "---"}
                </p>
                {perfMetrics.previewRenderTimes.length > 0 && (
                  <PerfStatusBadge
                    value={Math.round(perfMetrics.previewRenderTimes.reduce((a, b) => a + b, 0) / perfMetrics.previewRenderTimes.length)}
                    threshold={PERF_THRESHOLDS.previewRender}
                  />
                )}
              </div>
              <div className="p-2 border rounded-md">
                <p className="text-muted-foreground mb-0.5">Components</p>
                <p className="font-medium">{components.length}</p>
              </div>
            </div>
            {perfMetrics.lastWarnings.length > 0 && (
              <div className="space-y-1">
                <p className="font-medium text-muted-foreground">Recent Warnings</p>
                {perfMetrics.lastWarnings.slice(-3).map((w, i) => (
                  <div key={i} className="flex items-start gap-1 text-[10px] text-muted-foreground">
                    <AlertTriangle className="h-3 w-3 text-yellow-500 flex-shrink-0 mt-0.5" />
                    <span>{w}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      <Dialog open={showSaveGlobalDialog} onOpenChange={setShowSaveGlobalDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Save as Reusable Component</DialogTitle>
            <DialogDescription>
              Give this component a name so you can reuse it across any page.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <Label>Component Name</Label>
              <Input
                value={saveGlobalName}
                onChange={(e) => setSaveGlobalName(e.target.value)}
                placeholder="e.g. Hero with Video Background"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === "Enter" && saveGlobalName.trim() && saveGlobalComponentId) {
                    const comp = components.find(c => c.id === saveGlobalComponentId);
                    if (comp) saveGlobalMutation.mutate({ name: saveGlobalName.trim(), component: comp });
                  }
                }}
                data-testid="input-global-name"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowSaveGlobalDialog(false)} data-testid="button-cancel-save-global">
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (saveGlobalName.trim() && saveGlobalComponentId) {
                  const comp = components.find(c => c.id === saveGlobalComponentId);
                  if (comp) saveGlobalMutation.mutate({ name: saveGlobalName.trim(), component: comp });
                }
              }}
              disabled={!saveGlobalName.trim() || saveGlobalMutation.isPending}
              data-testid="button-confirm-save-global"
            >
              {saveGlobalMutation.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Bookmark className="h-4 w-4 mr-1" />}
              Save Component
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <SharePreviewDialog
        pageId={pageId}
        open={showShareDialog}
        onOpenChange={setShowShareDialog}
      />

      <VersionHistoryDialog
        pageId={pageId}
        open={showVersionHistory}
        onOpenChange={setShowVersionHistory}
        onRevert={(versionId) => revertVersionMutation.mutate(versionId)}
        isReverting={revertVersionMutation.isPending}
        previewingVersionId={previewingVersionId}
        onPreviewVersion={setPreviewingVersionId}
        onCompareVersions={(a, b) => { setDiffVersionA(a); setDiffVersionB(b); setShowDiffDialog(true); }}
      />

      <ConflictDialog
        open={showConflictDialog}
        onOpenChange={setShowConflictDialog}
        conflictInfo={conflictInfo}
        onReload={() => {
          setShowConflictDialog(false);
          initialized.current = false;
          queryClient.invalidateQueries({ queryKey: [`/api/website/pages/${pageId}`] });
        }}
        onOverwrite={() => {
          setShowConflictDialog(false);
          executeSave();
        }}
        onSaveAsVersion={() => {
          setShowConflictDialog(false);
          createVersionMutation.mutate({ trigger: "conflict-save", changeSummary: "Saved as new version (conflict resolution)" });
          toast({ title: "Changes saved as a new version" });
        }}
        isSaving={saveMutation.isPending}
      />

      <VersionDiffDialog
        open={showDiffDialog}
        onOpenChange={setShowDiffDialog}
        versionIdA={diffVersionA}
        versionIdB={diffVersionB}
      />
    </div>
  );
}

function SharePreviewDialog({ pageId, open, onOpenChange }: {
  pageId: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);
  const [expiresInHours, setExpiresInHours] = useState(72);

  const { data: previewLinks = [], isLoading: loadingLinks } = useQuery<any[]>({
    queryKey: ["/api/website/pages", pageId, "preview-links"],
    enabled: open,
  });

  const createLinkMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest("POST", `/api/website/pages/${pageId}/preview-link`, { expiresInHours });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/website/pages", pageId, "preview-links"] });
      toast({ title: "Preview link created" });
    },
    onError: (error: any) => {
      toast({ title: "Error creating link", description: error.message, variant: "destructive" });
    },
  });

  const revokeLinkMutation = useMutation({
    mutationFn: async (linkId: string) => {
      return await apiRequest("DELETE", `/api/website/preview-links/${linkId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/website/pages", pageId, "preview-links"] });
      toast({ title: "Preview link revoked" });
    },
  });

  const getPreviewUrl = (token: string) => {
    return `${window.location.origin}/shared-preview/${token}`;
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      toast({ title: "Link copied to clipboard" });
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const formatExpiry = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diff = date.getTime() - now.getTime();
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const days = Math.floor(hours / 24);
    if (days > 0) return `${days}d ${hours % 24}h remaining`;
    if (hours > 0) return `${hours}h remaining`;
    return "Expiring soon";
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Share2 className="h-4 w-4" />
            Share Preview
          </DialogTitle>
          <DialogDescription>
            Generate a read-only preview link. Anyone with the link can view this page without logging in.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <Select value={String(expiresInHours)} onValueChange={(v) => setExpiresInHours(Number(v))}>
              <SelectTrigger className="w-[140px] flex-shrink-0" data-testid="select-preview-expiry">
                <SelectValue placeholder="Expiration" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="24">24 hours</SelectItem>
                <SelectItem value="72">3 days</SelectItem>
                <SelectItem value="168">7 days</SelectItem>
                <SelectItem value="720">30 days</SelectItem>
              </SelectContent>
            </Select>
            <Button
              onClick={() => createLinkMutation.mutate()}
              disabled={createLinkMutation.isPending}
              className="flex-shrink-0"
              data-testid="button-generate-preview-link"
            >
              {createLinkMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              ) : (
                <Link2 className="h-4 w-4 mr-1" />
              )}
              Generate Link
            </Button>
          </div>

          {loadingLinks ? (
            <div className="space-y-2">
              <Skeleton className="h-16 w-full" />
            </div>
          ) : previewLinks.length > 0 ? (
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">Active Preview Links</Label>
              {previewLinks.map((link: any) => (
                <div key={link.id} className="p-2 border rounded-md space-y-1.5">
                  <div className="flex items-center gap-2">
                    <p className="flex-1 min-w-0 text-xs font-mono truncate">{getPreviewUrl(link.token)}</p>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => copyToClipboard(getPreviewUrl(link.token))}
                        data-testid={`button-copy-preview-${link.id}`}
                      >
                        <ClipboardCopy className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => window.open(getPreviewUrl(link.token), "_blank")}
                        data-testid={`button-open-preview-${link.id}`}
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => revokeLinkMutation.mutate(link.id)}
                        disabled={revokeLinkMutation.isPending}
                        data-testid={`button-revoke-preview-${link.id}`}
                      >
                        <XCircle className="h-3.5 w-3.5 text-destructive" />
                      </Button>
                    </div>
                  </div>
                  <p className="text-[10px] text-muted-foreground flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    {formatExpiry(link.expiresAt)}
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground text-center py-4">
              No active preview links. Generate one to share this page.
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function VersionHistoryDialog({ pageId, open, onOpenChange, onRevert, isReverting, previewingVersionId, onPreviewVersion, onCompareVersions }: {
  pageId: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onRevert: (versionId: string) => void;
  isReverting: boolean;
  previewingVersionId: string | null;
  onPreviewVersion: (id: string | null) => void;
  onCompareVersions: (a: string, b: string) => void;
}) {
  const { toast } = useToast();
  const [confirmRevertId, setConfirmRevertId] = useState<string | null>(null);
  const [compareMode, setCompareMode] = useState(false);
  const [compareSelections, setCompareSelections] = useState<string[]>([]);

  const { data: versions = [], isLoading: loadingVersions } = useQuery<any[]>({
    queryKey: ["/api/website/pages", pageId, "versions"],
    enabled: open,
  });

  const { data: previewVersion } = useQuery<any>({
    queryKey: ["/api/website/versions", previewingVersionId],
    enabled: !!previewingVersionId,
  });

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr);
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) +
      " " + d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  };

  const getTriggerBadge = (trigger: string) => {
    switch (trigger) {
      case "publish": return <Badge variant="default" className="text-[10px]">Published</Badge>;
      case "revert": return <Badge variant="secondary" className="text-[10px]">Reverted</Badge>;
      case "save": return <Badge variant="outline" className="text-[10px]">Saved</Badge>;
      default: return <Badge variant="outline" className="text-[10px]">{trigger}</Badge>;
    }
  };

  const getComponentCount = (contentJson: string | null) => {
    try {
      if (!contentJson) return 0;
      const parsed = JSON.parse(contentJson);
      return parsed.components?.length || 0;
    } catch {
      return 0;
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) { onPreviewVersion(null); setConfirmRevertId(null); } }}>
      <DialogContent className="max-w-lg max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <History className="h-4 w-4" />
            Version History
          </DialogTitle>
          <DialogDescription>
            View past versions of this page. You can preview, revert, or compare versions.
          </DialogDescription>
        </DialogHeader>

        {!previewingVersionId && versions.length >= 2 && (
          <div className="flex items-center justify-between gap-2 pb-2 border-b">
            <Button
              variant={compareMode ? "default" : "outline"}
              size="sm"
              onClick={() => {
                setCompareMode(!compareMode);
                setCompareSelections([]);
              }}
              data-testid="button-toggle-compare"
            >
              <GitCompare className="h-3.5 w-3.5 mr-1" />
              {compareMode ? "Cancel Compare" : "Compare Versions"}
            </Button>
            {compareMode && compareSelections.length === 2 && (
              <Button
                size="sm"
                onClick={() => {
                  onCompareVersions(compareSelections[0], compareSelections[1]);
                  setCompareMode(false);
                  setCompareSelections([]);
                }}
                data-testid="button-run-compare"
              >
                View Diff
              </Button>
            )}
            {compareMode && (
              <span className="text-xs text-muted-foreground">
                {compareSelections.length}/2 selected
              </span>
            )}
          </div>
        )}

        {previewingVersionId && previewVersion ? (
          <div className="flex flex-col flex-1 min-h-0">
            <div className="flex items-center justify-between gap-2 pb-2 border-b mb-2">
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="sm" onClick={() => onPreviewVersion(null)} data-testid="button-back-versions">
                  <ArrowLeft className="h-3 w-3 mr-1" />
                  Back
                </Button>
                <span className="text-sm font-medium">Version {previewVersion.versionNumber}</span>
                {getTriggerBadge(previewVersion.trigger)}
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setConfirmRevertId(previewVersion.id)}
                data-testid="button-revert-preview"
              >
                <RotateCcw className="h-3 w-3 mr-1" />
                Revert
              </Button>
            </div>
            <ScrollArea className="flex-1">
              <div className="space-y-2 p-1">
                <div className="text-xs space-y-1">
                  <p><span className="text-muted-foreground">Saved by:</span> {previewVersion.editorName}</p>
                  <p><span className="text-muted-foreground">Date:</span> {formatDate(previewVersion.createdAt)}</p>
                  <p><span className="text-muted-foreground">Summary:</span> {previewVersion.changeSummary || "No summary"}</p>
                  <p><span className="text-muted-foreground">Components:</span> {getComponentCount(previewVersion.contentJson)}</p>
                </div>
                {previewVersion.pageSettingsJson && (
                  <div className="border rounded-md p-2 mt-2">
                    <p className="text-xs font-medium mb-1">Page Settings at this version:</p>
                    {(() => {
                      try {
                        const s = JSON.parse(previewVersion.pageSettingsJson);
                        return (
                          <div className="text-xs space-y-0.5 text-muted-foreground">
                            <p>Title: {s.pageTitle}</p>
                            <p>Slug: /{s.pageSlug}</p>
                            <p>Status: {s.isPublished ? "Published" : "Draft"}</p>
                          </div>
                        );
                      } catch { return null; }
                    })()}
                  </div>
                )}
              </div>
            </ScrollArea>
          </div>
        ) : (
          <ScrollArea className="flex-1 max-h-[50vh]">
            {loadingVersions ? (
              <div className="space-y-2 p-1">
                {[1, 2, 3].map(i => <Skeleton key={i} className="h-16 w-full" />)}
              </div>
            ) : versions.length > 0 ? (
              <div className="space-y-1 p-1">
                {versions.map((v: any) => {
                  const isSelected = compareSelections.includes(v.id);
                  return (
                    <div
                      key={v.id}
                      className={`flex items-center justify-between gap-2 p-2 border rounded-md hover-elevate cursor-pointer ${
                        compareMode && isSelected ? "border-primary bg-primary/5" : ""
                      }`}
                      onClick={() => {
                        if (compareMode) {
                          setCompareSelections(prev => {
                            if (prev.includes(v.id)) return prev.filter(id => id !== v.id);
                            if (prev.length >= 2) return [prev[1], v.id];
                            return [...prev, v.id];
                          });
                        } else {
                          onPreviewVersion(v.id);
                        }
                      }}
                      data-testid={`version-item-${v.id}`}
                    >
                      {compareMode && (
                        <div className={`w-4 h-4 rounded-sm border flex items-center justify-center flex-shrink-0 ${isSelected ? "bg-primary border-primary" : ""}`}>
                          {isSelected && <CheckCircle2 className="h-3 w-3 text-primary-foreground" />}
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-medium">v{v.versionNumber}</span>
                          {getTriggerBadge(v.trigger)}
                        </div>
                        <p className="text-xs text-muted-foreground truncate">{v.changeSummary || "No summary"}</p>
                        <p className="text-[10px] text-muted-foreground">{v.editorName} - {formatDate(v.createdAt)}</p>
                      </div>
                      {!compareMode && (
                        <div className="flex items-center gap-1 flex-shrink-0">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={(e) => { e.stopPropagation(); onPreviewVersion(v.id); }}
                            data-testid={`button-preview-version-${v.id}`}
                          >
                            <Eye className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={(e) => { e.stopPropagation(); setConfirmRevertId(v.id); }}
                            data-testid={`button-revert-version-${v.id}`}
                          >
                            <RotateCcw className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-8 text-center">
                <History className="h-10 w-10 text-muted-foreground/40 mb-2" />
                <p className="text-sm text-muted-foreground">No version history yet</p>
                <p className="text-xs text-muted-foreground">Versions are created automatically when you save or publish.</p>
              </div>
            )}
          </ScrollArea>
        )}

        {confirmRevertId && (
          <div className="border-t pt-3">
            <div className="bg-destructive/10 border border-destructive/20 rounded-md p-3">
              <p className="text-sm font-medium mb-2">Revert to this version?</p>
              <p className="text-xs text-muted-foreground mb-3">
                This will replace the current page content with the selected version. A snapshot of the current state will be saved before reverting.
              </p>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setConfirmRevertId(null)}
                  data-testid="button-cancel-revert"
                >
                  Cancel
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => { onRevert(confirmRevertId); setConfirmRevertId(null); }}
                  disabled={isReverting}
                  data-testid="button-confirm-revert"
                >
                  {isReverting ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <RotateCcw className="h-3 w-3 mr-1" />}
                  Revert
                </Button>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function AddBetweenZone({ index, onAdd }: { index: number; onAdd: (type: BodyComponentType, index: number) => void }) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="relative group/add py-1">
      <div
        className={`flex items-center justify-center ${isOpen ? "h-auto" : "h-2"}`}
      >
        {!isOpen && (
          <button
            className="absolute inset-x-0 top-0 flex items-center justify-center h-6 opacity-0 pointer-events-none group-hover/add:opacity-100 group-hover/add:pointer-events-auto transition-opacity z-20"
            onClick={() => setIsOpen(true)}
            data-testid={`button-add-between-${index}`}
          >
            <div className="flex items-center gap-2">
              <div className="h-px flex-1 bg-primary/40" />
              <div className="flex items-center justify-center h-5 w-5 rounded-full bg-primary text-primary-foreground">
                <Plus className="h-3 w-3" />
              </div>
              <div className="h-px flex-1 bg-primary/40" />
            </div>
          </button>
        )}
      </div>

      {isOpen && (
        <div className="border rounded-md p-3 my-1 bg-background">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium">Add Component</span>
            <Button variant="ghost" size="icon" onClick={() => setIsOpen(false)} data-testid={`button-close-add-${index}`}>
              <X className="h-3 w-3" />
            </Button>
          </div>
          <div className="grid grid-cols-2 gap-1">
            {(Object.entries(COMPONENT_TYPE_META) as [BodyComponentType, typeof COMPONENT_TYPE_META["banner"]][]).map(([type, meta]) => {
              const Icon = meta.icon;
              return (
                <button
                  key={type}
                  className="flex items-center gap-1.5 p-1.5 rounded text-left hover-elevate transition-colors text-xs"
                  onClick={() => { onAdd(type, index); setIsOpen(false); }}
                  data-testid={`add-between-${type}-${index}`}
                >
                  <Icon className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                  <span className="truncate">{meta.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

const CanvasComponentPreview = memo(function CanvasComponentPreview({ component, devicePreview }: { component: BodyComponent; devicePreview: string }) {
  const meta = COMPONENT_TYPE_META[component.type];
  const Icon = meta.icon;

  const normalizeImageUrl = (url: string): string => {
    if (!url) return url;
    const gcsMatch = url.match(/https:\/\/storage\.googleapis\.com\/[^/]+\/gallery\/([^/]+\/.+)$/);
    if (gcsMatch) {
      return `/api/website/image/${gcsMatch[1]}`;
    }
    return url;
  };

  const bgStyle: Record<string, string> = {};
  if (component.styles.background.type === "solid" && component.styles.background.color) {
    bgStyle.backgroundColor = component.styles.background.color;
  } else if (component.styles.background.type === "gradient") {
    const dir = component.styles.background.gradientDirection.replace("to-", "to ");
    bgStyle.background = `linear-gradient(${dir}, ${component.styles.background.gradientFrom || "#000"}, ${component.styles.background.gradientTo || "#fff"})`;
  } else if (component.styles.background.type === "image" && component.styles.background.imageUrl) {
    bgStyle.backgroundImage = `url(${normalizeImageUrl(component.styles.background.imageUrl)})`;
    bgStyle.backgroundSize = "cover";
    bgStyle.backgroundPosition = "center";
  }

  const renderImage = (url: string, alt: string, testIdSuffix: string, className?: string) => {
    if (!url) return null;
    const src = normalizeImageUrl(url);
    return (
      <img
        src={src}
        alt={alt}
        className={className || "w-full h-24 object-cover rounded"}
        onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
        data-testid={`preview-image-${testIdSuffix}-${component.id}`}
      />
    );
  };

  const getPreviewContent = () => {
    switch (component.type) {
      case "banner": {
        const hasSideImage = component.config.sideImageEnabled && component.config.sideImageUrl;
        return (
          <div className={hasSideImage ? "flex items-center gap-3" : "space-y-1"}>
            <div className="flex-1 space-y-1">
              <h3 className="text-lg font-bold">{component.config.title || "Banner Title"}</h3>
              <p className="text-sm text-muted-foreground">{component.config.content || "Banner content"}</p>
              {component.config.buttons.length > 0 && (
                <div className="flex gap-2 pt-1 flex-wrap">
                  {component.config.buttons.map((btn, i) => (
                    <Badge key={i} variant={btn.variant === "primary" ? "default" : "secondary"}>{btn.text}</Badge>
                  ))}
                </div>
              )}
            </div>
            {hasSideImage && (
              <div className="w-24 flex-shrink-0">
                {renderImage(component.config.sideImageUrl, "Banner side image", "banner-side", "w-full h-20 object-cover rounded")}
              </div>
            )}
          </div>
        );
      }
      case "hero": {
        const hasImage = component.config.imageEnabled && component.config.imageUrl;
        const isRight = component.config.imagePosition === "right";
        return (
          <div className={hasImage ? "flex items-center gap-3" : "space-y-1"}>
            {hasImage && !isRight && (
              <div className="w-28 flex-shrink-0">
                {renderImage(component.config.imageUrl, "Hero image", "hero", "w-full h-24 object-cover rounded")}
              </div>
            )}
            <div className="flex-1 space-y-1">
              <h2 className="text-xl font-bold">{component.config.title || "Hero Title"}</h2>
              <p className="text-sm font-medium text-muted-foreground">{component.config.subtitle || "Subtitle"}</p>
              <p className="text-xs text-muted-foreground">{component.config.content || "Hero description"}</p>
            </div>
            {hasImage && isRight && (
              <div className="w-28 flex-shrink-0">
                {renderImage(component.config.imageUrl, "Hero image", "hero", "w-full h-24 object-cover rounded")}
              </div>
            )}
          </div>
        );
      }
      case "content":
        return (
          <div className="space-y-1">
            <h3 className="text-base font-semibold">{component.config.title || "Section Title"}</h3>
            <p className="text-xs text-muted-foreground line-clamp-3">{component.config.content || "Content goes here..."}</p>
          </div>
        );
      case "cta":
        return (
          <div className="text-center space-y-1">
            <h3 className="text-base font-bold">{component.config.title || "Call to Action"}</h3>
            <p className="text-xs text-muted-foreground">{component.config.content || "CTA description"}</p>
            <div className="flex gap-2 justify-center pt-1 flex-wrap">
              {component.config.buttons.map((btn, i) => (
                <Badge key={i} variant={btn.variant === "primary" ? "default" : "secondary"}>{btn.text}</Badge>
              ))}
            </div>
          </div>
        );
      case "form":
        return (
          <div className="space-y-1">
            <h3 className="text-base font-semibold">{component.config.title || "Form"}</h3>
            <div className="flex gap-2 flex-wrap">
              {component.config.fields.slice(0, 3).map((f) => (
                <Badge key={f.id} variant="outline" className="text-[10px]">{f.label}</Badge>
              ))}
              {component.config.fields.length > 3 && (
                <Badge variant="secondary" className="text-[10px]">+{component.config.fields.length - 3} more</Badge>
              )}
            </div>
          </div>
        );
      case "grid":
        return (
          <div className="space-y-1">
            <h3 className="text-base font-semibold">{component.config.title || "Grid"}</h3>
            <div className={`grid gap-2`} style={{ gridTemplateColumns: `repeat(${Math.min(component.config.columns, 4)}, 1fr)` }}>
              {component.config.items.slice(0, component.config.columns).map((item) => (
                <div key={item.id} className="p-2 border rounded text-xs">
                  <div className="font-medium truncate">{item.title}</div>
                </div>
              ))}
            </div>
          </div>
        );
      case "testimonial":
        return (
          <div className="space-y-1">
            <h3 className="text-base font-semibold">{component.config.title || "Testimonials"}</h3>
            <div className="flex gap-2 flex-wrap">
              {component.config.items.slice(0, 3).map((t) => (
                <div key={t.id} className="text-xs p-2 border rounded flex-1 min-w-[100px]">
                  <div className="flex items-center gap-2 mb-1">
                    {t.imageEnabled && t.imageUrl && renderImage(t.imageUrl, t.name, `testimonial-${t.id}`, "w-6 h-6 rounded-full object-cover flex-shrink-0")}
                    <p className="font-medium">{t.name}</p>
                  </div>
                  <p className="italic line-clamp-2">"{t.quote}"</p>
                </div>
              ))}
            </div>
          </div>
        );
      case "feature_highlight":
        return (
          <div className="space-y-1">
            <h3 className="text-base font-semibold">{component.config.title || "Features"}</h3>
            <div className="flex gap-3 flex-wrap">
              {component.config.items.slice(0, 4).map((f) => (
                <div key={f.id} className="text-xs">
                  <div className="font-medium">{f.title}</div>
                </div>
              ))}
            </div>
          </div>
        );
      case "gallery":
        return (
          <div className="space-y-1">
            <h3 className="text-base font-semibold">{component.config.title || "Gallery"}</h3>
            <div className="grid grid-cols-3 gap-1">
              {[1, 2, 3].map(i => (
                <div key={i} className="aspect-square bg-muted rounded" />
              ))}
            </div>
          </div>
        );
      case "stats":
        return (
          <div className="space-y-1">
            <h3 className="text-base font-semibold">{component.config.title || "Stats"}</h3>
            <div className="flex gap-4 flex-wrap">
              {component.config.items.slice(0, 4).map((s) => (
                <div key={s.id} className="text-center">
                  <div className="text-lg font-bold">{s.prefix}{s.value}{s.suffix}</div>
                  <div className="text-[10px] text-muted-foreground">{s.label}</div>
                </div>
              ))}
            </div>
          </div>
        );
      case "faq":
        return (
          <div className="space-y-1">
            <h3 className="text-base font-semibold">{component.config.title || "FAQ"}</h3>
            {component.config.items.slice(0, 3).map((f) => (
              <div key={f.id} className="text-xs border-b pb-1">
                <span className="font-medium">{f.question}</span>
              </div>
            ))}
          </div>
        );
      default:
        return <p className="text-sm text-muted-foreground">{meta.label}</p>;
    }
  };

  return (
    <div
      className="p-4 min-h-[60px] rounded-md"
      style={{
        ...bgStyle,
        textAlign: component.styles.alignment || "left",
      }}
    >
      {getPreviewContent()}
    </div>
  );
});

function ComponentSettingsPanel({
  component,
  onUpdateComponent,
  onUpdateConfig,
  onUpdateStyles,
  onRemove,
  onDuplicate,
  onSaveAsGlobal,
  onDeselect,
}: {
  component: BodyComponent;
  onUpdateComponent: (updates: Partial<BodyComponent>) => void;
  onUpdateConfig: (config: any) => void;
  onUpdateStyles: (styles: SharedStyles) => void;
  onRemove: () => void;
  onDuplicate: () => void;
  onSaveAsGlobal: () => void;
  onDeselect: () => void;
}) {
  const meta = COMPONENT_TYPE_META[component.type];
  const Icon = meta.icon;
  const [showStyles, setShowStyles] = useState(false);

  return (
    <>
      <div className="flex items-center justify-between gap-2 p-3 border-b">
        <div className="flex items-center gap-2 min-w-0">
          <Icon className="h-4 w-4 text-muted-foreground flex-shrink-0" />
          <span className="text-sm font-medium truncate">{meta.label}</span>
        </div>
        <Button variant="ghost" size="icon" onClick={onDeselect} data-testid="button-deselect-component">
          <X className="h-4 w-4" />
        </Button>
      </div>
      <ScrollArea className="flex-1">
        <div className="p-3 space-y-4">
          <div className="space-y-2">
            <div>
              <Label className="text-xs">Label</Label>
              <Input
                value={component.label}
                onChange={(e) => onUpdateComponent({ label: e.target.value })}
                className="h-8 text-sm"
                data-testid="input-component-label"
              />
            </div>
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-2">
                <Switch
                  checked={component.enabled}
                  onCheckedChange={(v) => onUpdateComponent({ enabled: v })}
                  data-testid="switch-component-enabled"
                />
                <Label className="text-xs">Enabled</Label>
              </div>
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1">
                  <Switch
                    checked={component.visibleDesktop}
                    onCheckedChange={(v) => onUpdateComponent({ visibleDesktop: v })}
                    data-testid="switch-visible-desktop"
                  />
                  <Monitor className="h-3 w-3 text-muted-foreground" />
                </div>
                <div className="flex items-center gap-1">
                  <Switch
                    checked={component.visibleMobile}
                    onCheckedChange={(v) => onUpdateComponent({ visibleMobile: v })}
                    data-testid="switch-visible-mobile"
                  />
                  <Smartphone className="h-3 w-3 text-muted-foreground" />
                </div>
              </div>
            </div>
          </div>

          <div className="border-t pt-3">
            <h4 className="text-xs font-semibold uppercase text-muted-foreground mb-2">Custom CSS Class</h4>
            <Input
              value={component.customClass || ""}
              onChange={(e) => onUpdateComponent({ customClass: e.target.value })}
              placeholder="e.g. my-section hero-dark"
              data-testid="input-custom-class"
            />
          </div>

          <div className="border-t pt-3">
            <h4 className="text-xs font-semibold uppercase text-muted-foreground mb-2">Content</h4>
            <ComponentConfigEditor comp={component} onConfigChange={onUpdateConfig} />
          </div>

          <div className="border-t pt-3">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowStyles(!showStyles)}
              className="w-full"
              data-testid="button-toggle-styles"
            >
              <Palette className="h-3 w-3 mr-1" />
              {showStyles ? "Hide Style Controls" : "Show Style Controls"}
            </Button>
            {showStyles && (
              <div className="mt-2">
                <StyleEditor styles={component.styles} onChange={onUpdateStyles} />
              </div>
            )}
          </div>

          <div className="border-t pt-3 space-y-2">
            <Button variant="outline" size="sm" onClick={onSaveAsGlobal} className="w-full" data-testid="button-settings-save-global">
              <Bookmark className="h-3 w-3 mr-1" />
              Save as Reusable
            </Button>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={onDuplicate} className="flex-1" data-testid="button-settings-duplicate">
                <Copy className="h-3 w-3 mr-1" />
                Duplicate
              </Button>
              <Button variant="outline" size="sm" onClick={onRemove} className="text-destructive flex-1" data-testid="button-settings-remove">
                <Trash2 className="h-3 w-3 mr-1" />
                Remove
              </Button>
            </div>
          </div>
        </div>
      </ScrollArea>
    </>
  );
}

function PageSettingsPanel({
  settings,
  onChange,
  onClose,
}: {
  settings: {
    pageTitle: string;
    pageSlug: string;
    pageType: string;
    navigationLabel: string;
    showInNavigation: boolean;
    status: string;
    metaTitle: string;
    metaDescription: string;
  };
  onChange: (s: typeof settings) => void;
  onClose: () => void;
}) {
  const update = (key: string, value: any) => {
    onChange({ ...settings, [key]: value });
  };

  return (
    <>
      <div className="flex items-center justify-between gap-2 p-3 border-b">
        <div className="flex items-center gap-2">
          <Settings className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium">Page Settings</span>
        </div>
        <Button variant="ghost" size="icon" onClick={onClose} data-testid="button-close-page-settings">
          <X className="h-4 w-4" />
        </Button>
      </div>
      <ScrollArea className="flex-1">
        <div className="p-3 space-y-4">
          <div className="space-y-2">
            <Label className="text-xs">Page Title</Label>
            <Input
              value={settings.pageTitle}
              onChange={(e) => {
                const title = e.target.value;
                const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
                update("pageTitle", title);
                update("pageSlug", slug);
              }}
              className="h-8 text-sm"
              data-testid="input-settings-page-title"
            />
          </div>
          <div className="space-y-2">
            <Label className="text-xs">URL Slug</Label>
            <Input
              value={settings.pageSlug}
              onChange={(e) => update("pageSlug", e.target.value)}
              className="h-8 text-sm"
              data-testid="input-settings-page-slug"
            />
          </div>
          <div className="space-y-2">
            <Label className="text-xs">Page Type</Label>
            <Select value={settings.pageType} onValueChange={(v) => update("pageType", v)}>
              <SelectTrigger className="h-8 text-sm" data-testid="select-settings-page-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {["HOME", "ABOUT", "SERVICES", "PROJECTS", "BLOG", "CONTACT", "SAFETY", "CAREERS", "TEAM", "FAQ", "CUSTOM"].map(t => (
                  <SelectItem key={t} value={t}>{t.charAt(0) + t.slice(1).toLowerCase()}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label className="text-xs">Navigation Label</Label>
            <Input
              value={settings.navigationLabel}
              onChange={(e) => update("navigationLabel", e.target.value)}
              className="h-8 text-sm"
              placeholder="Label shown in navigation"
              data-testid="input-settings-nav-label"
            />
          </div>
          <div className="flex items-center gap-2">
            <Switch
              checked={settings.showInNavigation}
              onCheckedChange={(v) => update("showInNavigation", v)}
              data-testid="switch-settings-show-nav"
            />
            <Label className="text-xs">Show in Navigation</Label>
          </div>
          <div className="space-y-2">
            <Label className="text-xs">Status</Label>
            <Select value={settings.status} onValueChange={(v) => update("status", v)}>
              <SelectTrigger className="h-8 text-sm" data-testid="select-settings-status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="DRAFT">Draft</SelectItem>
                <SelectItem value="PUBLISHED">Published</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="border-t pt-3 space-y-3">
            <h4 className="text-xs font-semibold uppercase text-muted-foreground">SEO Settings</h4>
            <div className="space-y-2">
              <Label className="text-xs">Meta Title</Label>
              <Input
                value={settings.metaTitle}
                onChange={(e) => update("metaTitle", e.target.value)}
                className="h-8 text-sm"
                placeholder="Page Title | Company Name"
                data-testid="input-settings-meta-title"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-xs">Meta Description</Label>
              <Textarea
                value={settings.metaDescription}
                onChange={(e) => update("metaDescription", e.target.value)}
                className="text-sm"
                placeholder="A brief description for search engines..."
                rows={3}
                data-testid="input-settings-meta-desc"
              />
            </div>
          </div>
        </div>
      </ScrollArea>
    </>
  );
}

function PerfStatusBadge({ value, threshold }: { value: number; threshold: number }) {
  const ok = value <= threshold;
  return (
    <Badge variant={ok ? "outline" : "destructive"} className="text-[9px] mt-0.5">
      {ok ? "OK" : "Slow"}
    </Badge>
  );
}

function ConflictDialog({
  open,
  onOpenChange,
  conflictInfo,
  onReload,
  onOverwrite,
  onSaveAsVersion,
  isSaving,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  conflictInfo: ConflictInfo | null;
  onReload: () => void;
  onOverwrite: () => void;
  onSaveAsVersion: () => void;
  isSaving: boolean;
}) {
  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return "Unknown";
    const d = new Date(dateStr);
    return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }) +
      " on " + d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-yellow-500" />
            Save Conflict Detected
          </DialogTitle>
          <DialogDescription>
            This page has been modified by another user since you started editing.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {conflictInfo && (
            <div className="bg-muted/50 border rounded-md p-3 text-xs space-y-1">
              {conflictInfo.lastEditor && (
                <p><span className="text-muted-foreground">Last saved by:</span> {conflictInfo.lastEditor}</p>
              )}
              {conflictInfo.lastSaved && (
                <p><span className="text-muted-foreground">Saved at:</span> {formatDate(conflictInfo.lastSaved)}</p>
              )}
            </div>
          )}

          <p className="text-sm text-muted-foreground">
            Choose how to proceed:
          </p>

          <div className="space-y-2">
            <Button
              variant="outline"
              className="w-full justify-start"
              onClick={onReload}
              data-testid="button-conflict-reload"
            >
              <RefreshCw className="h-4 w-4 mr-2" />
              <div className="text-left">
                <div className="text-sm font-medium">Reload latest version</div>
                <div className="text-[10px] text-muted-foreground">Discard your changes and load the latest saved version</div>
              </div>
            </Button>
            <Button
              variant="outline"
              className="w-full justify-start"
              onClick={onOverwrite}
              disabled={isSaving}
              data-testid="button-conflict-overwrite"
            >
              <Save className="h-4 w-4 mr-2" />
              <div className="text-left">
                <div className="text-sm font-medium">Overwrite with my changes</div>
                <div className="text-[10px] text-muted-foreground">Replace the server version with your current edits</div>
              </div>
            </Button>
            <Button
              variant="outline"
              className="w-full justify-start"
              onClick={onSaveAsVersion}
              data-testid="button-conflict-save-version"
            >
              <History className="h-4 w-4 mr-2" />
              <div className="text-left">
                <div className="text-sm font-medium">Save as a new version</div>
                <div className="text-[10px] text-muted-foreground">Keep both versions - your changes are saved separately</div>
              </div>
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function VersionDiffDialog({
  open,
  onOpenChange,
  versionIdA,
  versionIdB,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  versionIdA: string | null;
  versionIdB: string | null;
}) {
  const { data: diffData, isLoading } = useQuery<any>({
    queryKey: ["/api/website/versions/diff", versionIdA, versionIdB],
    enabled: open && !!versionIdA && !!versionIdB,
  });

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr);
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" }) +
      " " + d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  };

  const statusColors: Record<string, string> = {
    added: "bg-green-500/10 border-green-500/30 text-green-700 dark:text-green-400",
    modified: "bg-yellow-500/10 border-yellow-500/30 text-yellow-700 dark:text-yellow-400",
    removed: "bg-red-500/10 border-red-500/30 text-red-700 dark:text-red-400",
    unchanged: "bg-muted/30 border-muted-foreground/10",
  };

  const statusIcons: Record<string, typeof PlusCircle> = {
    added: PlusCircle,
    modified: AlertTriangle,
    removed: MinusCircle,
    unchanged: CheckCircle2,
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <GitCompare className="h-4 w-4" />
            Version Comparison
          </DialogTitle>
          {diffData && (
            <DialogDescription>
              Comparing v{diffData.versionA.versionNumber} ({diffData.versionA.editorName}) with v{diffData.versionB.versionNumber} ({diffData.versionB.editorName})
            </DialogDescription>
          )}
        </DialogHeader>

        {isLoading ? (
          <div className="space-y-2 p-2">
            {[1, 2, 3].map(i => <Skeleton key={i} className="h-12 w-full" />)}
          </div>
        ) : diffData ? (
          <ScrollArea className="flex-1 max-h-[60vh]">
            <div className="space-y-4 p-1">
              <div className="flex items-center gap-3 flex-wrap text-xs">
                <div className="flex items-center gap-1">
                  <div className="w-3 h-3 rounded-sm bg-green-500/20 border border-green-500/40" />
                  <span>Added ({diffData.summary.added})</span>
                </div>
                <div className="flex items-center gap-1">
                  <div className="w-3 h-3 rounded-sm bg-yellow-500/20 border border-yellow-500/40" />
                  <span>Modified ({diffData.summary.modified})</span>
                </div>
                <div className="flex items-center gap-1">
                  <div className="w-3 h-3 rounded-sm bg-red-500/20 border border-red-500/40" />
                  <span>Removed ({diffData.summary.removed})</span>
                </div>
                <div className="flex items-center gap-1">
                  <div className="w-3 h-3 rounded-sm bg-muted border" />
                  <span>Unchanged ({diffData.summary.unchanged})</span>
                </div>
              </div>

              <div className="space-y-1.5">
                <h4 className="text-xs font-semibold uppercase text-muted-foreground">Components</h4>
                {diffData.componentDiff.map((item: any) => {
                  const StatusIcon = statusIcons[item.status] || CheckCircle2;
                  return (
                    <div
                      key={item.id}
                      className={`p-2.5 border rounded-md ${statusColors[item.status] || ""}`}
                      data-testid={`diff-item-${item.id}`}
                    >
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <div className="flex items-center gap-2">
                          <StatusIcon className="h-3.5 w-3.5 flex-shrink-0" />
                          <span className="text-sm font-medium">{item.label || item.type}</span>
                          <Badge variant="outline" className="text-[9px]">{item.type}</Badge>
                        </div>
                        <Badge variant="secondary" className="text-[9px] capitalize">{item.status}</Badge>
                      </div>
                      {item.status === "modified" && item.changes && (
                        <div className="mt-1.5 flex gap-1 flex-wrap">
                          {item.changes.map((c: string) => (
                            <Badge key={c} variant="outline" className="text-[9px]">{c}</Badge>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {diffData.settingsChanges.length > 0 && (
                <div className="space-y-1.5">
                  <h4 className="text-xs font-semibold uppercase text-muted-foreground">Page Settings</h4>
                  {diffData.settingsChanges.map((change: any) => (
                    <div key={change.field} className="p-2.5 border rounded-md bg-yellow-500/10 border-yellow-500/30">
                      <p className="text-xs font-medium capitalize">{change.field.replace(/([A-Z])/g, " $1").trim()}</p>
                      <div className="flex items-center gap-2 mt-1 text-xs">
                        <span className="text-red-600 dark:text-red-400 line-through">{String(change.oldValue ?? "empty")}</span>
                        <ChevronRight className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                        <span className="text-green-600 dark:text-green-400">{String(change.newValue ?? "empty")}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {diffData.componentDiff.length === 0 && diffData.settingsChanges.length === 0 && (
                <div className="text-center py-6">
                  <CheckCircle2 className="h-8 w-8 text-muted-foreground/40 mx-auto mb-2" />
                  <p className="text-sm text-muted-foreground">These versions are identical</p>
                </div>
              )}
            </div>
          </ScrollArea>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}