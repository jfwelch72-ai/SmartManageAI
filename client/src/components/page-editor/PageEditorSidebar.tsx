import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Plus,
  Trash2,
  Copy,
  Search,
  LayoutGrid,
  X,
  Settings,
  Palette,
  Bookmark,
  ChevronRight,
  Pencil,
  FolderOpen,
  RefreshCw,
  CheckCircle2,
  Monitor,
  Smartphone,
} from "lucide-react";
import {
  type BodyComponentType,
  type BodyComponent,
  type SharedStyles,
  COMPONENT_TYPE_META,
  ComponentConfigEditor,
  StyleEditor,
} from "@/components/website-body-components";
import type { PageSettings } from "./types";

interface ComponentLibraryProps {
  showComponentLibrary: boolean;
  showGlobalLibrary: boolean;
  searchQuery: string;
  globalComponents: any[];
  selectedComponent: BodyComponent | null;
  editingGlobalId: string | null;
  editingGlobalName: string;
  filteredComponentTypes: [BodyComponentType, typeof COMPONENT_TYPE_META["banner"]][];
  onToggleLibrary: () => void;
  onToggleGlobalLibrary: (show: boolean) => void;
  onSearchChange: (query: string) => void;
  onAddComponent: (type: BodyComponentType) => void;
  onInsertGlobal: (gc: any) => void;
  onUpdateGlobal: (id: string, component: BodyComponent) => void;
  onRenameGlobal: (id: string, name: string) => void;
  onDuplicateGlobal: (id: string) => void;
  onDeleteGlobal: (id: string) => void;
  onStartEditGlobal: (id: string, name: string) => void;
  onCancelEditGlobal: () => void;
  onEditingGlobalNameChange: (name: string) => void;
}

export function ComponentLibrary({
  showComponentLibrary,
  showGlobalLibrary,
  searchQuery,
  globalComponents,
  selectedComponent,
  editingGlobalId,
  editingGlobalName,
  filteredComponentTypes,
  onToggleLibrary,
  onToggleGlobalLibrary,
  onSearchChange,
  onAddComponent,
  onInsertGlobal,
  onUpdateGlobal,
  onRenameGlobal,
  onDuplicateGlobal,
  onDeleteGlobal,
  onStartEditGlobal,
  onCancelEditGlobal,
  onEditingGlobalNameChange,
}: ComponentLibraryProps) {
  return (
    <>
      <div className={`border-r bg-muted/30 flex flex-col transition-all ${showComponentLibrary ? "w-56" : "w-0"}`}>
        {showComponentLibrary && (
          <>
            <div className="p-2 border-b space-y-2">
              <div className="flex items-center gap-0.5 p-0.5 border rounded-md overflow-hidden">
                <Button
                  size="sm"
                  variant={!showGlobalLibrary ? "default" : "ghost"}
                  onClick={() => onToggleGlobalLibrary(false)}
                  className="flex-1 min-w-0 text-[11px] h-7 px-2"
                  data-testid="button-library-components"
                >
                  <Plus className="h-3 w-3 mr-1 flex-shrink-0" />
                  <span className="truncate">Components</span>
                </Button>
                <Button
                  size="sm"
                  variant={showGlobalLibrary ? "default" : "ghost"}
                  onClick={() => onToggleGlobalLibrary(true)}
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
                    onChange={(e) => onSearchChange(e.target.value)}
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
                        onClick={() => onAddComponent(type)}
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
                                onChange={(e) => onEditingGlobalNameChange(e.target.value)}
                                className="h-7 text-xs flex-1"
                                autoFocus
                                onKeyDown={(e) => {
                                  if (e.key === "Enter" && editingGlobalName.trim()) {
                                    onRenameGlobal(gc.id, editingGlobalName.trim());
                                  } else if (e.key === "Escape") {
                                    onCancelEditGlobal();
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
                                    onRenameGlobal(gc.id, editingGlobalName.trim());
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
                              onClick={() => onInsertGlobal(gc)}
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
                                  onUpdateGlobal(gc.id, selectedComponent);
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
                              onClick={() => { onStartEditGlobal(gc.id, gc.name); }}
                              title="Rename"
                              data-testid={`button-rename-global-${gc.id}`}
                            >
                              <Pencil className="h-3 w-3" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7"
                              onClick={() => onDuplicateGlobal(gc.id)}
                              title="Duplicate"
                              data-testid={`button-duplicate-global-${gc.id}`}
                            >
                              <Copy className="h-3 w-3" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-destructive"
                              onClick={() => onDeleteGlobal(gc.id)}
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

      <button
        className="flex items-center justify-center w-5 border-r hover-elevate transition-colors flex-shrink-0"
        onClick={onToggleLibrary}
        data-testid="button-toggle-library"
      >
        <ChevronRight className={`h-3 w-3 text-muted-foreground transition-transform ${showComponentLibrary ? "rotate-180" : ""}`} />
      </button>
    </>
  );
}

interface ComponentSettingsPanelProps {
  component: BodyComponent;
  onUpdateComponent: (updates: Partial<BodyComponent>) => void;
  onUpdateConfig: (config: any) => void;
  onUpdateStyles: (styles: SharedStyles) => void;
  onRemove: () => void;
  onDuplicate: () => void;
  onSaveAsGlobal: () => void;
  onDeselect: () => void;
}

export function ComponentSettingsPanel({
  component,
  onUpdateComponent,
  onUpdateConfig,
  onUpdateStyles,
  onRemove,
  onDuplicate,
  onSaveAsGlobal,
  onDeselect,
}: ComponentSettingsPanelProps) {
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

interface PageSettingsPanelProps {
  settings: PageSettings;
  onChange: (s: PageSettings) => void;
  onClose: () => void;
}

export function PageSettingsPanel({
  settings,
  onChange,
  onClose,
}: PageSettingsPanelProps) {
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
            <div className="space-y-2">
              <Label className="text-xs">Social Share Image URL</Label>
              <Input
                value={settings.ogImageUrl || ""}
                onChange={(e) => update("ogImageUrl", e.target.value)}
                className="h-8 text-sm"
                placeholder="https://example.com/share-image.jpg"
                data-testid="input-settings-og-image"
              />
              <p className="text-xs text-muted-foreground">Overrides site-wide share image for this page</p>
            </div>
            <div className="space-y-2">
              <Label className="text-xs">Canonical URL</Label>
              <Input
                value={settings.canonicalUrl || ""}
                onChange={(e) => update("canonicalUrl", e.target.value)}
                className="h-8 text-sm"
                placeholder="https://example.com/preferred-url"
                data-testid="input-settings-canonical-url"
              />
            </div>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={settings.noIndex || false}
                onChange={(e) => update("noIndex", e.target.checked)}
                className="h-4 w-4 rounded border-gray-300"
                data-testid="input-settings-no-index"
              />
              <Label className="text-xs">Hide from search engines (noindex)</Label>
            </div>
          </div>
        </div>
      </ScrollArea>
    </>
  );
}

interface RightSidebarProps {
  rightPanel: "component" | "page-settings";
  selectedComponent: BodyComponent | null;
  pageSettings: PageSettings;
  onPageSettingsChange: (s: PageSettings) => void;
  onClosePageSettings: () => void;
  onUpdateComponent: (updates: Partial<BodyComponent>) => void;
  onUpdateConfig: (config: any) => void;
  onUpdateStyles: (styles: SharedStyles) => void;
  onRemove: () => void;
  onDuplicate: () => void;
  onSaveAsGlobal: () => void;
  onDeselect: () => void;
  onOpenPageSettings: () => void;
}

export function RightSidebar({
  rightPanel,
  selectedComponent,
  pageSettings,
  onPageSettingsChange,
  onClosePageSettings,
  onUpdateComponent,
  onUpdateConfig,
  onUpdateStyles,
  onRemove,
  onDuplicate,
  onSaveAsGlobal,
  onDeselect,
  onOpenPageSettings,
}: RightSidebarProps) {
  return (
    <div className="w-80 border-l bg-background flex flex-col overflow-hidden">
      {rightPanel === "page-settings" ? (
        <PageSettingsPanel
          settings={pageSettings}
          onChange={onPageSettingsChange}
          onClose={onClosePageSettings}
        />
      ) : selectedComponent ? (
        <ComponentSettingsPanel
          component={selectedComponent}
          onUpdateComponent={onUpdateComponent}
          onUpdateConfig={onUpdateConfig}
          onUpdateStyles={onUpdateStyles}
          onRemove={onRemove}
          onDuplicate={onDuplicate}
          onSaveAsGlobal={onSaveAsGlobal}
          onDeselect={onDeselect}
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
            onClick={onOpenPageSettings}
            data-testid="button-open-page-settings"
          >
            <Settings className="h-4 w-4 mr-1" />
            Page Settings
          </Button>
        </div>
      )}
    </div>
  );
}
