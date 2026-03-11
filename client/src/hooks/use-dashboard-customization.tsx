import { createContext, useContext, useState, useEffect, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { getWidgetDefinition } from "@/components/dashboard-widgets/WidgetRegistry";

export interface DashboardWidget {
  id: string;
  type: string;
  x: number;
  y: number;
  w: number;
  h: number;
  visible: boolean;
  minW?: number;
  minH?: number;
  maxW?: number;
  maxH?: number;
  config?: Record<string, any>;
}

export interface DashboardSection {
  id: string;
  title: string;
  columns: number;
  collapsed: boolean;
  widgets: DashboardWidget[];
}

export interface DashboardLayoutConfig {
  sections: DashboardSection[];
  gridCols: number;
  version: number;
}

interface UserPermissions {
  canAccessFinancials: boolean;
  canManagePayroll: boolean;
  canAccessReports: boolean;
  canUseAiFeatures: boolean;
  canPostSocialMedia: boolean;
  canManageWebsite: boolean;
  canManageEquipment: boolean;
  canManageProcurement: boolean;
}

interface ColorPalette {
  id?: string;
  paletteName: string;
  isPreset?: boolean;
  isActive?: boolean;
  lightPrimary?: string;
  lightPrimaryForeground?: string;
  lightSecondary?: string;
  lightSecondaryForeground?: string;
  lightAccent?: string;
  lightAccentForeground?: string;
  lightBackground?: string;
  lightForeground?: string;
  lightMuted?: string;
  lightMutedForeground?: string;
  lightCard?: string;
  lightCardForeground?: string;
  lightBorder?: string;
  darkPrimary?: string;
  darkPrimaryForeground?: string;
  darkSecondary?: string;
  darkSecondaryForeground?: string;
  darkAccent?: string;
  darkAccentForeground?: string;
  darkBackground?: string;
  darkForeground?: string;
  darkMuted?: string;
  darkMutedForeground?: string;
  darkCard?: string;
  darkCardForeground?: string;
  darkBorder?: string;
}

export function getAllWidgets(layout: DashboardLayoutConfig | null): DashboardWidget[] {
  if (!layout || !layout.sections) return [];
  return layout.sections.flatMap(s => s.widgets);
}

interface DashboardCustomizationContextType {
  isEditMode: boolean;
  setEditMode: (value: boolean) => void;
  toggleEditMode: () => void;
  permissions: UserPermissions;
  isLoadingPermissions: boolean;
  layout: DashboardLayoutConfig | null;
  localLayout: DashboardLayoutConfig | null;
  isLoadingLayout: boolean;
  saveLayout: (layout: DashboardLayoutConfig) => Promise<void>;
  resetLayout: () => Promise<void>;
  isSavingLayout: boolean;
  addWidget: (type: string, sectionId?: string) => void;
  removeWidget: (widgetId: string, sectionId: string) => void;
  duplicateWidget: (widgetId: string, sectionId: string) => void;
  reorderWidgets: (sectionId: string, fromIndex: number, toIndex: number) => void;
  updateWidgetConfig: (widgetId: string, sectionId: string, config: Record<string, any>) => void;
  getWidgetConfig: (widgetId: string, sectionId: string) => Record<string, any> | undefined;
  updateSectionLayout: (sectionId: string, gridLayout: Array<{ i: string; x: number; y: number; w: number; h: number }>) => void;
  addSection: (title: string, columns: number) => void;
  removeSection: (sectionId: string) => void;
  duplicateSection: (sectionId: string) => void;
  updateSectionTitle: (sectionId: string, title: string) => void;
  updateSectionColumns: (sectionId: string, columns: number) => void;
  toggleSectionCollapse: (sectionId: string) => void;
  reorderSections: (fromIndex: number, toIndex: number) => void;
  hasUnsavedChanges: boolean;
  saveCurrentLayout: () => Promise<void>;
  discardChanges: () => void;
  activePalette: ColorPalette | null;
  orgPalette: ColorPalette | null;
  isOrgDefault: boolean;
  isLoadingPalette: boolean;
  savedPalettes: ColorPalette[];
  presetPalettes: Record<string, any>;
  savePalette: (palette: ColorPalette & { setActive?: boolean }) => Promise<void>;
  saveOrgPalette: (palette: ColorPalette) => Promise<void>;
  deactivateOrgPalette: () => Promise<void>;
  activatePalette: (paletteId: string) => Promise<void>;
  deactivatePalette: () => Promise<void>;
  deletePalette: (paletteId: string) => Promise<void>;
  isSavingPalette: boolean;
  applyPaletteToDOM: (palette: ColorPalette | null, isDark: boolean) => void;
}

const DashboardCustomizationContext = createContext<DashboardCustomizationContextType | null>(null);

export function DashboardCustomizationProvider({ children }: { children: React.ReactNode }) {
  const { toast } = useToast();
  const [isEditMode, setIsEditMode] = useState(false);
  const [localLayout, setLocalLayout] = useState<DashboardLayoutConfig | null>(null);

  const { data: permissions = { canAccessFinancials: false, canManagePayroll: false, canAccessReports: false, canUseAiFeatures: false, canPostSocialMedia: false, canManageWebsite: false, canManageEquipment: false, canManageProcurement: false }, isLoading: isLoadingPermissions } = useQuery<UserPermissions>({
    queryKey: ["/api/dashboard/my-permissions"],
  });

  const { data: layoutData, isLoading: isLoadingLayout } = useQuery<{ layout: DashboardLayoutConfig; isCustom: boolean }>({
    queryKey: ["/api/dashboard/layout"],
  });

  const { data: paletteData, isLoading: isLoadingPalette } = useQuery<{ palette: ColorPalette | null; orgPalette: ColorPalette | null; isActive: boolean }>({
    queryKey: ["/api/dashboard/palette"],
  });

  const { data: savedPalettes = [] } = useQuery<ColorPalette[]>({
    queryKey: ["/api/dashboard/palettes"],
  });

  const { data: presetPalettes = {} } = useQuery<Record<string, any>>({
    queryKey: ["/api/dashboard/palettes/presets"],
  });

  useEffect(() => {
    if (layoutData?.layout) {
      setLocalLayout(layoutData.layout);
    }
  }, [layoutData]);

  const saveLayoutMutation = useMutation({
    mutationFn: async (layout: DashboardLayoutConfig) => {
      return await apiRequest("PUT", "/api/dashboard/layout", { layout });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/layout"] });
      toast({ title: "Layout saved", description: "Your dashboard layout has been saved" });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to save layout", variant: "destructive" });
    },
  });

  const resetLayoutMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest("POST", "/api/dashboard/layout/reset");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/layout"] });
      toast({ title: "Layout reset", description: "Your dashboard has been reset to default" });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to reset layout", variant: "destructive" });
    },
  });

  const savePaletteMutation = useMutation({
    mutationFn: async (palette: ColorPalette & { setActive?: boolean }) => {
      return await apiRequest("POST", "/api/dashboard/palette", palette);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/palette"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/palettes"] });
      toast({ title: "Theme saved", description: "Your color scheme has been saved" });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to save theme", variant: "destructive" });
    },
  });

  const activatePaletteMutation = useMutation({
    mutationFn: async (paletteId: string) => {
      return await apiRequest("PUT", `/api/dashboard/palette/${paletteId}/activate`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/palette"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/palettes"] });
      toast({ title: "Theme activated", description: "Your color scheme has been applied" });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to activate theme", variant: "destructive" });
    },
  });

  const deactivatePaletteMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest("POST", "/api/dashboard/palette/deactivate");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/palette"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/palettes"] });
      toast({ title: "Theme deactivated", description: "Using default color scheme" });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to deactivate theme", variant: "destructive" });
    },
  });

  const deletePaletteMutation = useMutation({
    mutationFn: async (paletteId: string) => {
      return await apiRequest("DELETE", `/api/dashboard/palette/${paletteId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/palette"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/palettes"] });
      toast({ title: "Theme deleted", description: "Your color scheme has been removed" });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to delete theme", variant: "destructive" });
    },
  });

  const saveOrgPaletteMutation = useMutation({
    mutationFn: async (palette: ColorPalette) => {
      return await apiRequest("POST", "/api/dashboard/org-palette", palette);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/palette"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/org-palette"] });
      toast({ title: "Organization theme saved", description: "The default theme has been set for all users" });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to save organization theme", variant: "destructive" });
    },
  });

  const deactivateOrgPaletteMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest("POST", "/api/dashboard/org-palette/deactivate");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/palette"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/org-palette"] });
      toast({ title: "Organization theme removed", description: "Users will see the system default unless they have a personal theme" });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to remove organization theme", variant: "destructive" });
    },
  });

  const applyPaletteToDOM = useCallback((palette: ColorPalette | null, isDark: boolean) => {
    const root = document.documentElement;
    
    if (!palette) {
      const cssVars = ['--primary', '--primary-foreground', '--secondary', '--secondary-foreground', 
        '--accent', '--accent-foreground', '--background', '--foreground', '--muted', 
        '--muted-foreground', '--card', '--card-foreground', '--border'];
      cssVars.forEach(v => root.style.removeProperty(v));
      return;
    }

    const prefix = isDark ? 'dark' : 'light';
    const setCSSVar = (name: string, value: string | undefined) => {
      if (value) root.style.setProperty(name, value);
    };

    setCSSVar('--primary', palette[`${prefix}Primary` as keyof ColorPalette] as string);
    setCSSVar('--primary-foreground', palette[`${prefix}PrimaryForeground` as keyof ColorPalette] as string);
    setCSSVar('--secondary', palette[`${prefix}Secondary` as keyof ColorPalette] as string);
    setCSSVar('--secondary-foreground', palette[`${prefix}SecondaryForeground` as keyof ColorPalette] as string);
    setCSSVar('--accent', palette[`${prefix}Accent` as keyof ColorPalette] as string);
    setCSSVar('--accent-foreground', palette[`${prefix}AccentForeground` as keyof ColorPalette] as string);
    setCSSVar('--background', palette[`${prefix}Background` as keyof ColorPalette] as string);
    setCSSVar('--foreground', palette[`${prefix}Foreground` as keyof ColorPalette] as string);
    setCSSVar('--muted', palette[`${prefix}Muted` as keyof ColorPalette] as string);
    setCSSVar('--muted-foreground', palette[`${prefix}MutedForeground` as keyof ColorPalette] as string);
    setCSSVar('--card', palette[`${prefix}Card` as keyof ColorPalette] as string);
    setCSSVar('--card-foreground', palette[`${prefix}CardForeground` as keyof ColorPalette] as string);
    setCSSVar('--border', palette[`${prefix}Border` as keyof ColorPalette] as string);
  }, []);

  const effectivePalette = paletteData?.palette && paletteData.isActive
    ? paletteData.palette
    : paletteData?.orgPalette || null;

  const isOrgDefault = !paletteData?.isActive && !!paletteData?.orgPalette;

  useEffect(() => {
    const isDark = document.documentElement.classList.contains('dark');
    applyPaletteToDOM(effectivePalette, isDark);
  }, [effectivePalette, applyPaletteToDOM]);

  useEffect(() => {
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
          const isDark = document.documentElement.classList.contains('dark');
          applyPaletteToDOM(effectivePalette, isDark);
        }
      }
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, [effectivePalette, applyPaletteToDOM]);

  const setEditMode = useCallback((value: boolean) => {
    if (value && layoutData?.layout) {
      setLocalLayout(JSON.parse(JSON.stringify(layoutData.layout)));
    }
    if (!value && layoutData?.layout) {
      setLocalLayout(layoutData.layout);
    }
    setIsEditMode(value);
  }, [permissions, toast, layoutData]);

  const toggleEditMode = useCallback(() => {
    setEditMode(!isEditMode);
  }, [isEditMode, setEditMode]);

  const addWidget = useCallback((type: string, sectionId?: string) => {
    const def = getWidgetDefinition(type);
    if (!def) return;

    setLocalLayout(prev => {
      if (!prev || prev.sections.length === 0) return prev;
      const targetSectionId = sectionId || prev.sections[prev.sections.length - 1].id;
      const targetSection = prev.sections.find(s => s.id === targetSectionId);
      if (!targetSection) return prev;

      const allIds = prev.sections.flatMap(s => s.widgets.map(w => w.id));
      let newId = type.toLowerCase().replace(/_/g, '-');
      if (allIds.includes(newId)) {
        newId = `${newId}-${Date.now()}`;
      }

      const maxY = targetSection.widgets.reduce((max, w) => Math.max(max, w.y + w.h), 0);

      const newWidget: DashboardWidget = {
        id: newId,
        type,
        x: 0,
        y: maxY,
        w: Math.min(def.defaultW, 12),
        h: def.defaultH,
        visible: true,
        minW: def.minW,
        minH: def.minH,
        maxW: def.maxW,
        maxH: def.maxH,
      };

      return {
        ...prev,
        sections: prev.sections.map(s =>
          s.id === targetSectionId
            ? { ...s, widgets: [...s.widgets, newWidget] }
            : s
        ),
      };
    });
  }, []);

  const duplicateWidget = useCallback((widgetId: string, sectionId: string) => {
    setLocalLayout(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        sections: prev.sections.map(s => {
          if (s.id !== sectionId) return s;
          const widgetIndex = s.widgets.findIndex(w => w.id === widgetId);
          if (widgetIndex === -1) return s;
          const original = s.widgets[widgetIndex];
          const cloned: DashboardWidget = {
            ...JSON.parse(JSON.stringify(original)),
            id: `${original.type.toLowerCase().replace(/_/g, '-')}-${Date.now()}`,
          };
          const widgets = [...s.widgets];
          widgets.splice(widgetIndex + 1, 0, cloned);
          return { ...s, widgets };
        }),
      };
    });
  }, []);

  const removeWidget = useCallback((widgetId: string, sectionId: string) => {
    setLocalLayout(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        sections: prev.sections.map(s =>
          s.id === sectionId
            ? { ...s, widgets: s.widgets.filter(w => w.id !== widgetId) }
            : s
        ),
      };
    });
  }, []);

  const reorderWidgets = useCallback((sectionId: string, fromIndex: number, toIndex: number) => {
    setLocalLayout(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        sections: prev.sections.map(s => {
          if (s.id !== sectionId) return s;
          const widgets = [...s.widgets];
          const [moved] = widgets.splice(fromIndex, 1);
          widgets.splice(toIndex, 0, moved);
          return { ...s, widgets };
        }),
      };
    });
  }, []);

  const updateWidgetConfig = useCallback((widgetId: string, sectionId: string, config: Record<string, any>) => {
    setLocalLayout(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        sections: prev.sections.map(s =>
          s.id === sectionId
            ? { ...s, widgets: s.widgets.map(w => w.id === widgetId ? { ...w, config: { ...w.config, ...config } } : w) }
            : s
        ),
      };
    });
  }, []);

  const getWidgetConfig = useCallback((widgetId: string, sectionId: string): Record<string, any> | undefined => {
    if (!localLayout) return undefined;
    const section = localLayout.sections.find(s => s.id === sectionId);
    if (!section) return undefined;
    const widget = section.widgets.find(w => w.id === widgetId);
    return widget?.config;
  }, [localLayout]);

  const updateSectionLayout = useCallback((sectionId: string, gridLayout: Array<{ i: string; x: number; y: number; w: number; h: number }>) => {
    setLocalLayout(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        sections: prev.sections.map(s => {
          if (s.id !== sectionId) return s;
          const updatedWidgets = s.widgets.map(widget => {
            const layoutItem = gridLayout.find(l => l.i === widget.id);
            if (layoutItem) {
              return { ...widget, x: layoutItem.x, y: layoutItem.y, w: layoutItem.w, h: layoutItem.h };
            }
            return widget;
          });
          return { ...s, widgets: updatedWidgets };
        }),
      };
    });
  }, []);

  const addSection = useCallback((title: string, columns: number) => {
    setLocalLayout(prev => {
      if (!prev) return prev;
      const newSection: DashboardSection = {
        id: `section-${Date.now()}`,
        title,
        columns: Math.min(Math.max(columns, 1), 4),
        collapsed: false,
        widgets: [],
      };
      return { ...prev, sections: [...prev.sections, newSection] };
    });
  }, []);

  const duplicateSection = useCallback((sectionId: string) => {
    setLocalLayout(prev => {
      if (!prev) return prev;
      const sectionIndex = prev.sections.findIndex(s => s.id === sectionId);
      if (sectionIndex === -1) return prev;
      const original = prev.sections[sectionIndex];
      const now = Date.now();
      const cloned: DashboardSection = {
        id: `section-${now}`,
        title: `${original.title} (Copy)`,
        columns: original.columns,
        collapsed: false,
        widgets: original.widgets.map((w, i) => ({
          ...JSON.parse(JSON.stringify(w)),
          id: `${w.type.toLowerCase().replace(/_/g, '-')}-${now}-${i}`,
        })),
      };
      const sections = [...prev.sections];
      sections.splice(sectionIndex + 1, 0, cloned);
      return { ...prev, sections };
    });
  }, []);

  const removeSection = useCallback((sectionId: string) => {
    setLocalLayout(prev => {
      if (!prev) return prev;
      return { ...prev, sections: prev.sections.filter(s => s.id !== sectionId) };
    });
  }, []);

  const updateSectionTitle = useCallback((sectionId: string, title: string) => {
    setLocalLayout(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        sections: prev.sections.map(s => s.id === sectionId ? { ...s, title } : s),
      };
    });
  }, []);

  const updateSectionColumns = useCallback((sectionId: string, columns: number) => {
    setLocalLayout(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        sections: prev.sections.map(s => s.id === sectionId ? { ...s, columns: Math.min(Math.max(columns, 1), 4) } : s),
      };
    });
  }, []);

  const toggleSectionCollapse = useCallback((sectionId: string) => {
    setLocalLayout(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        sections: prev.sections.map(s => s.id === sectionId ? { ...s, collapsed: !s.collapsed } : s),
      };
    });
  }, []);

  const reorderSections = useCallback((fromIndex: number, toIndex: number) => {
    setLocalLayout(prev => {
      if (!prev) return prev;
      const sections = [...prev.sections];
      const [moved] = sections.splice(fromIndex, 1);
      sections.splice(toIndex, 0, moved);
      return { ...prev, sections };
    });
  }, []);

  const hasUnsavedChanges = (() => {
    if (!localLayout || !layoutData?.layout) return false;
    return JSON.stringify(localLayout) !== JSON.stringify(layoutData.layout);
  })();

  const saveCurrentLayout = useCallback(async () => {
    if (!localLayout) return;
    await saveLayoutMutation.mutateAsync(localLayout);
  }, [localLayout, saveLayoutMutation]);

  const discardChanges = useCallback(() => {
    if (layoutData?.layout) {
      setLocalLayout(layoutData.layout);
    }
  }, [layoutData]);

  const value: DashboardCustomizationContextType = {
    isEditMode,
    setEditMode,
    toggleEditMode,
    permissions,
    isLoadingPermissions,
    layout: layoutData?.layout || null,
    localLayout,
    isLoadingLayout,
    saveLayout: async (layout) => { await saveLayoutMutation.mutateAsync(layout); },
    resetLayout: async () => { await resetLayoutMutation.mutateAsync(); },
    isSavingLayout: saveLayoutMutation.isPending || resetLayoutMutation.isPending,
    addWidget,
    removeWidget,
    duplicateWidget,
    reorderWidgets,
    updateWidgetConfig,
    getWidgetConfig,
    updateSectionLayout,
    addSection,
    removeSection,
    duplicateSection,
    updateSectionTitle,
    updateSectionColumns,
    toggleSectionCollapse,
    reorderSections,
    hasUnsavedChanges,
    saveCurrentLayout,
    discardChanges,
    activePalette: paletteData?.palette || null,
    orgPalette: paletteData?.orgPalette || null,
    isOrgDefault,
    isLoadingPalette,
    savedPalettes,
    presetPalettes,
    savePalette: async (palette) => { await savePaletteMutation.mutateAsync(palette); },
    saveOrgPalette: async (palette) => { await saveOrgPaletteMutation.mutateAsync(palette); },
    deactivateOrgPalette: async () => { await deactivateOrgPaletteMutation.mutateAsync(); },
    activatePalette: async (id) => { await activatePaletteMutation.mutateAsync(id); },
    deactivatePalette: async () => { await deactivatePaletteMutation.mutateAsync(); },
    deletePalette: async (id) => { await deletePaletteMutation.mutateAsync(id); },
    isSavingPalette: savePaletteMutation.isPending || activatePaletteMutation.isPending || deactivatePaletteMutation.isPending || saveOrgPaletteMutation.isPending || deactivateOrgPaletteMutation.isPending,
    applyPaletteToDOM,
  };

  return (
    <DashboardCustomizationContext.Provider value={value}>
      {children}
    </DashboardCustomizationContext.Provider>
  );
}

export function useDashboardCustomization() {
  const context = useContext(DashboardCustomizationContext);
  if (!context) {
    throw new Error("useDashboardCustomization must be used within a DashboardCustomizationProvider");
  }
  return context;
}

export type FeaturePermissionKey = keyof UserPermissions;

export function useFeaturePermission(permissionKey: FeaturePermissionKey): boolean {
  const { permissions } = useDashboardCustomization();
  return permissions[permissionKey] ?? false;
}
