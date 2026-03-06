import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  ArrowLeft,
  Save,
  Monitor,
  Tablet,
  Smartphone,
  ChevronRight,
  Settings,
  Share2,
  History,
  Undo2,
  Redo2,
  Loader2,
  Gauge,
  Users,
} from "lucide-react";
import type { PresenceUser } from "./types";

interface PageEditorToolbarProps {
  pageTitle: string;
  hasUnsavedChanges: boolean;
  devicePreview: "desktop" | "tablet" | "mobile";
  presenceUsers: PresenceUser[];
  isSaving: boolean;
  canUndo: boolean;
  canRedo: boolean;
  onBack: () => void;
  onDevicePreviewChange: (device: "desktop" | "tablet" | "mobile") => void;
  onShareClick: () => void;
  onVersionHistoryClick: () => void;
  onPerfMonitorClick: () => void;
  onPageSettingsClick: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onSave: () => void;
}

export function PageEditorToolbar({
  pageTitle,
  hasUnsavedChanges,
  devicePreview,
  presenceUsers,
  isSaving,
  canUndo,
  canRedo,
  onBack,
  onDevicePreviewChange,
  onShareClick,
  onVersionHistoryClick,
  onPerfMonitorClick,
  onPageSettingsClick,
  onUndo,
  onRedo,
  onSave,
}: PageEditorToolbarProps) {
  return (
    <div className="flex items-center justify-between gap-2 p-2 border-b bg-background z-50 flex-wrap">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={onBack} data-testid="button-editor-back">
          <ArrowLeft className="h-4 w-4 mr-1" />
          Pages
        </Button>
        <ChevronRight className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-medium truncate max-w-[200px]">{pageTitle || "Untitled"}</span>
        {hasUnsavedChanges && (
          <Badge variant="secondary" className="text-[10px]">Unsaved</Badge>
        )}
      </div>
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-0.5 p-0.5 border rounded-md">
          <Button
            size="sm"
            variant={devicePreview === "desktop" ? "default" : "ghost"}
            onClick={() => onDevicePreviewChange("desktop")}
            data-testid="button-preview-desktop"
          >
            <Monitor className="h-3.5 w-3.5" />
          </Button>
          <Button
            size="sm"
            variant={devicePreview === "tablet" ? "default" : "ghost"}
            onClick={() => onDevicePreviewChange("tablet")}
            data-testid="button-preview-tablet"
          >
            <Tablet className="h-3.5 w-3.5" />
          </Button>
          <Button
            size="sm"
            variant={devicePreview === "mobile" ? "default" : "ghost"}
            onClick={() => onDevicePreviewChange("mobile")}
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
          onClick={onShareClick}
          data-testid="button-share-preview"
        >
          <Share2 className="h-4 w-4 mr-1" />
          Share
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={onVersionHistoryClick}
          data-testid="button-version-history"
        >
          <History className="h-4 w-4 mr-1" />
          Versions
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={onPerfMonitorClick}
          data-testid="button-perf-monitor"
        >
          <Gauge className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={onPageSettingsClick}
          data-testid="button-page-settings"
        >
          <Settings className="h-4 w-4 mr-1" />
          Page Settings
        </Button>
        <Button
          size="icon"
          variant="ghost"
          onClick={onUndo}
          disabled={!canUndo}
          title="Undo (Ctrl+Z)"
          data-testid="button-undo"
        >
          <Undo2 className="h-4 w-4" />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          onClick={onRedo}
          disabled={!canRedo}
          title="Redo (Ctrl+Y)"
          data-testid="button-redo"
        >
          <Redo2 className="h-4 w-4" />
        </Button>
        <Button
          size="sm"
          onClick={onSave}
          disabled={isSaving || !hasUnsavedChanges}
          data-testid="button-save-page-editor"
        >
          {isSaving ? (
            <Loader2 className="h-4 w-4 mr-1 animate-spin" />
          ) : (
            <Save className="h-4 w-4 mr-1" />
          )}
          Save
        </Button>
      </div>
    </div>
  );
}
