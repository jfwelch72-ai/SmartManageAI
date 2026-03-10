import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { 
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Edit, LayoutGrid, RotateCcw, Save, X, Settings2, Plus, Layers } from "lucide-react";
import { useState } from "react";
import { useDashboardCustomization } from "@/hooks/use-dashboard-customization";

interface DashboardEditModeProps {
  onToggleWidgetLibrary?: () => void;
  widgetLibraryOpen?: boolean;
}

export function DashboardEditMode({ onToggleWidgetLibrary, widgetLibraryOpen }: DashboardEditModeProps) {
  const { isEditMode, setEditMode, permissions, isSavingLayout, resetLayout, hasUnsavedChanges, saveCurrentLayout, discardChanges, localLayout, addSection } = useDashboardCustomization();
  const [showResetDialog, setShowResetDialog] = useState(false);
  const [showExitDialog, setShowExitDialog] = useState(false);
  const [showAddSection, setShowAddSection] = useState(false);
  const [newSectionTitle, setNewSectionTitle] = useState("New Section");
  const [newSectionCols, setNewSectionCols] = useState(1);

  const sectionCount = localLayout?.sections?.length || 0;
  const widgetCount = localLayout?.sections?.reduce((sum, s) => sum + s.widgets.filter(w => w.visible).length, 0) || 0;

  const handleExitEditMode = () => {
    if (hasUnsavedChanges) {
      setShowExitDialog(true);
    } else {
      setEditMode(false);
    }
  };

  const handleSave = async () => {
    try {
      await saveCurrentLayout();
      setEditMode(false);
    } catch {
    }
  };

  const handleResetLayout = async () => {
    try {
      await resetLayout();
      setShowResetDialog(false);
      setEditMode(false);
    } catch {
      setShowResetDialog(false);
    }
  };

  const handleConfirmExit = () => {
    discardChanges();
    setShowExitDialog(false);
    setEditMode(false);
  };

  const handleAddSection = () => {
    addSection(newSectionTitle.trim() || "New Section", newSectionCols);
    setShowAddSection(false);
    setNewSectionTitle("New Section");
    setNewSectionCols(1);
  };

  if (isEditMode) {
    return (
      <>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className="bg-amber-500/10 text-amber-600 border-amber-500/30 gap-1">
            <Edit className="w-3 h-3" />
            <span className="hidden sm:inline">Edit Mode</span>
          </Badge>

          <Badge variant="secondary" className="text-xs">
            {sectionCount}s · {widgetCount}w
          </Badge>

          <Popover open={showAddSection} onOpenChange={setShowAddSection}>
            <Tooltip>
              <TooltipTrigger asChild>
                <PopoverTrigger asChild>
                  <Button size="sm" variant="outline" data-testid="button-add-section">
                    <Layers className="w-4 h-4 sm:mr-1" />
                    <span className="hidden sm:inline">Add Section</span>
                  </Button>
                </PopoverTrigger>
              </TooltipTrigger>
              <TooltipContent>Add a new section</TooltipContent>
            </Tooltip>
            <PopoverContent className="w-72" align="end">
              <div className="space-y-3">
                <h4 className="font-medium text-sm">New Section</h4>
                <div className="space-y-2">
                  <Label htmlFor="section-title" className="text-xs">Title</Label>
                  <Input
                    id="section-title"
                    value={newSectionTitle}
                    onChange={(e) => setNewSectionTitle(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleAddSection(); }}
                    placeholder="Section name"
                    className="h-8"
                    data-testid="input-new-section-title"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-xs">Columns</Label>
                  <div className="flex gap-1">
                    {[1, 2, 3, 4].map((cols) => (
                      <Button
                        key={cols}
                        variant={newSectionCols === cols ? "default" : "outline"}
                        size="sm"
                        className="flex-1 h-8"
                        onClick={() => setNewSectionCols(cols)}
                        data-testid={`button-new-section-cols-${cols}`}
                      >
                        {cols}
                      </Button>
                    ))}
                  </div>
                </div>
                <Button size="sm" className="w-full" onClick={handleAddSection} data-testid="button-confirm-add-section">
                  <Plus className="w-4 h-4 mr-1" />
                  Add Section
                </Button>
              </div>
            </PopoverContent>
          </Popover>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button 
                size="sm" 
                variant={widgetLibraryOpen ? "default" : "outline"}
                onClick={onToggleWidgetLibrary}
                data-testid="button-toggle-widget-library"
              >
                <Plus className="w-4 h-4 sm:mr-1" />
                <span className="hidden sm:inline">Add Widget</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent>Browse and add widgets</TooltipContent>
          </Tooltip>
          
          <Tooltip>
            <TooltipTrigger asChild>
              <Button 
                size="sm" 
                variant="outline"
                onClick={() => setShowResetDialog(true)}
                disabled={isSavingLayout}
                data-testid="button-reset-layout"
              >
                <RotateCcw className="w-4 h-4 sm:mr-1" />
                <span className="hidden sm:inline">Reset</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent>Reset to default layout</TooltipContent>
          </Tooltip>

          <Button 
            size="sm" 
            onClick={handleSave}
            disabled={isSavingLayout || !hasUnsavedChanges}
            data-testid="button-save-layout"
          >
            <Save className="w-4 h-4 sm:mr-1" />
            <span className="hidden sm:inline">Save</span>
          </Button>

          <Button 
            size="sm" 
            variant="ghost"
            onClick={handleExitEditMode}
            disabled={isSavingLayout}
            data-testid="button-exit-edit-mode"
          >
            <X className="w-4 h-4 sm:mr-1" />
            <span className="hidden sm:inline">Done</span>
          </Button>
        </div>

        <AlertDialog open={showResetDialog} onOpenChange={setShowResetDialog}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Reset Dashboard Layout?</AlertDialogTitle>
              <AlertDialogDescription>
                This will reset your dashboard to the default layout. All your customizations will be lost. This action cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel data-testid="button-cancel-reset">Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={handleResetLayout} data-testid="button-confirm-reset">
                Reset to Default
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <AlertDialog open={showExitDialog} onOpenChange={setShowExitDialog}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Unsaved Changes</AlertDialogTitle>
              <AlertDialogDescription>
                You have unsaved changes to your dashboard layout. Are you sure you want to exit edit mode? Your changes will be lost.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel data-testid="button-cancel-exit">Keep Editing</AlertDialogCancel>
              <AlertDialogAction onClick={handleConfirmExit} data-testid="button-confirm-exit">
                Discard Changes
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </>
    );
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="icon" variant="ghost" data-testid="button-dashboard-settings">
            <Settings2 className="w-4 h-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => setEditMode(true)} data-testid="menu-customize-dashboard">
            <LayoutGrid className="w-4 h-4 mr-2" />
            Customize Dashboard
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => setShowResetDialog(true)} data-testid="menu-reset-layout">
            <RotateCcw className="w-4 h-4 mr-2" />
            Reset to Default
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog open={showResetDialog} onOpenChange={setShowResetDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reset Dashboard Layout?</AlertDialogTitle>
            <AlertDialogDescription>
              This will reset your dashboard to the default layout. All your customizations will be lost. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-reset">Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleResetLayout} data-testid="button-confirm-reset">
              Reset to Default
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export function EditModeIndicator() {
  const { isEditMode } = useDashboardCustomization();
  
  if (!isEditMode) return null;
  
  return (
    <div className="fixed top-0 left-0 right-0 h-1 bg-amber-500 z-50" data-testid="edit-mode-indicator" />
  );
}
