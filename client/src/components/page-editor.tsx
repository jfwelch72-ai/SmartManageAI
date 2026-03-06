import { useState, useCallback, useRef, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeft } from "lucide-react";
import {
  type BodyComponentType,
  type BodyComponent,
  type BodyComponentsConfig,
  type SharedStyles,
  COMPONENT_TYPE_META,
  createDefaultComponent,
} from "@/components/website-body-components";
import type { PageData, PerfMetrics, ConflictInfo, PageSettings } from "@/components/page-editor/types";
import { PERF_THRESHOLDS } from "@/components/page-editor/types";
import { PageEditorToolbar } from "@/components/page-editor/PageEditorToolbar";
import { PageEditorCanvas } from "@/components/page-editor/PageEditorCanvas";
import { ComponentLibrary, RightSidebar } from "@/components/page-editor/PageEditorSidebar";
import {
  SharePreviewDialog,
  VersionHistoryDialog,
  ConflictDialog,
  VersionDiffDialog,
  SaveGlobalDialog,
  PerfMonitorPanel,
} from "@/components/page-editor/PageEditorDialogs";

interface PageEditorProps {
  pageId: string;
  onBack: () => void;
}

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
  const [presenceUsers, setPresenceUsers] = useState<import("@/components/page-editor/types").PresenceUser[]>([]);
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
  const [pageSettings, setPageSettings] = useState<PageSettings>({
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

  const createVersionMutation = useMutation({
    mutationFn: async (data: { trigger: string; changeSummary: string }) => {
      return await apiRequest("POST", `/api/website/pages/${pageId}/versions`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/website/pages", pageId, "versions"] });
    },
  });

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

  const { data: globalComponentsData } = useQuery<{ components: any[] }>({
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
      <PageEditorToolbar
        pageTitle={pageSettings.pageTitle}
        hasUnsavedChanges={hasUnsavedChanges}
        devicePreview={devicePreview}
        presenceUsers={presenceUsers}
        isSaving={saveMutation.isPending}
        canUndo={undoStack.current.length > 0}
        canRedo={redoStack.current.length > 0}
        onBack={onBack}
        onDevicePreviewChange={setDevicePreview}
        onShareClick={() => setShowShareDialog(true)}
        onVersionHistoryClick={() => setShowVersionHistory(true)}
        onPerfMonitorClick={() => setShowPerfMonitor(!showPerfMonitor)}
        onPageSettingsClick={() => { setRightPanel("page-settings"); setSelectedComponentId(null); }}
        onUndo={handleUndo}
        onRedo={handleRedo}
        onSave={() => checkConflictBeforeSave()}
      />

      <div className="flex flex-1 overflow-hidden">
        <ComponentLibrary
          showComponentLibrary={showComponentLibrary}
          showGlobalLibrary={showGlobalLibrary}
          searchQuery={searchQuery}
          globalComponents={globalComponents}
          selectedComponent={selectedComponent}
          editingGlobalId={editingGlobalId}
          editingGlobalName={editingGlobalName}
          filteredComponentTypes={filteredComponentTypes}
          onToggleLibrary={() => setShowComponentLibrary(!showComponentLibrary)}
          onToggleGlobalLibrary={setShowGlobalLibrary}
          onSearchChange={setSearchQuery}
          onAddComponent={addComponent}
          onInsertGlobal={insertGlobalComponent}
          onUpdateGlobal={(id, component) => updateGlobalMutation.mutate({ id, component })}
          onRenameGlobal={(id, name) => renameGlobalMutation.mutate({ id, name })}
          onDuplicateGlobal={(id) => duplicateGlobalMutation.mutate(id)}
          onDeleteGlobal={(id) => deleteGlobalMutation.mutate(id)}
          onStartEditGlobal={(id, name) => { setEditingGlobalId(id); setEditingGlobalName(name); }}
          onCancelEditGlobal={() => setEditingGlobalId(null)}
          onEditingGlobalNameChange={setEditingGlobalName}
        />

        <PageEditorCanvas
          sortedComponents={sortedComponents}
          selectedComponentId={selectedComponentId}
          devicePreview={devicePreview}
          onSelectComponent={(id) => { setSelectedComponentId(id); setRightPanel("component"); }}
          onAddComponent={addComponent}
          onAddComponentAtIndex={addComponentAtIndex}
          onRemoveComponent={removeComponent}
          onDuplicateComponent={duplicateComponent}
          onSaveAsGlobal={openSaveAsGlobal}
          onDragStart={(idx) => { dragItem.current = idx; }}
          onDragOver={(idx) => { dragOverItem.current = idx; }}
          onDragEnd={handleDragEnd}
        />

        <RightSidebar
          rightPanel={rightPanel}
          selectedComponent={selectedComponent}
          pageSettings={pageSettings}
          onPageSettingsChange={(s) => { setPageSettings(s); markChanged(); }}
          onClosePageSettings={() => setRightPanel("component")}
          onUpdateComponent={(updates) => selectedComponent && updateComponent(selectedComponent.id, updates)}
          onUpdateConfig={(config) => selectedComponent && updateComponentConfig(selectedComponent.id, config)}
          onUpdateStyles={(styles) => selectedComponent && updateComponentStyles(selectedComponent.id, styles)}
          onRemove={() => selectedComponent && removeComponent(selectedComponent.id)}
          onDuplicate={() => selectedComponent && duplicateComponent(selectedComponent.id)}
          onSaveAsGlobal={() => selectedComponent && openSaveAsGlobal(selectedComponent.id)}
          onDeselect={() => setSelectedComponentId(null)}
          onOpenPageSettings={() => setRightPanel("page-settings")}
        />
      </div>

      <PerfMonitorPanel
        show={showPerfMonitor}
        perfMetrics={perfMetrics}
        componentCount={components.length}
        onClose={() => setShowPerfMonitor(false)}
      />

      <SaveGlobalDialog
        open={showSaveGlobalDialog}
        onOpenChange={setShowSaveGlobalDialog}
        name={saveGlobalName}
        onNameChange={setSaveGlobalName}
        onSave={() => {
          if (saveGlobalName.trim() && saveGlobalComponentId) {
            const comp = components.find(c => c.id === saveGlobalComponentId);
            if (comp) saveGlobalMutation.mutate({ name: saveGlobalName.trim(), component: comp });
          }
        }}
        isPending={saveGlobalMutation.isPending}
      />

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
