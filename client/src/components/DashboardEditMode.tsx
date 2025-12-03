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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Edit, Lock, RotateCcw, Save, X, Settings2 } from "lucide-react";
import { useState } from "react";
import { useDashboardCustomization } from "@/hooks/use-dashboard-customization";

interface DashboardEditModeProps {
  onSave?: () => void;
  onReset?: () => void;
  hasUnsavedChanges?: boolean;
}

export function DashboardEditMode({ onSave, onReset, hasUnsavedChanges = false }: DashboardEditModeProps) {
  const { isEditMode, setEditMode, permissions, isSavingLayout, resetLayout } = useDashboardCustomization();
  const [showResetDialog, setShowResetDialog] = useState(false);
  const [showExitDialog, setShowExitDialog] = useState(false);

  const handleExitEditMode = () => {
    if (hasUnsavedChanges) {
      setShowExitDialog(true);
    } else {
      setEditMode(false);
    }
  };

  const handleConfirmExit = () => {
    setShowExitDialog(false);
    setEditMode(false);
  };

  const handleResetLayout = async () => {
    await resetLayout();
    setShowResetDialog(false);
    setEditMode(false);
  };

  if (!permissions.canCustomizeDashboard) {
    return null;
  }

  if (isEditMode) {
    return (
      <>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="bg-amber-500/10 text-amber-600 border-amber-500/30 gap-1">
            <Edit className="w-3 h-3" />
            Edit Mode
          </Badge>
          
          <Tooltip>
            <TooltipTrigger asChild>
              <Button 
                size="sm" 
                variant="outline"
                onClick={() => setShowResetDialog(true)}
                disabled={isSavingLayout}
                data-testid="button-reset-layout"
              >
                <RotateCcw className="w-4 h-4 mr-1" />
                Reset
              </Button>
            </TooltipTrigger>
            <TooltipContent>Reset to default layout</TooltipContent>
          </Tooltip>

          {onSave && (
            <Button 
              size="sm" 
              onClick={onSave}
              disabled={isSavingLayout}
              data-testid="button-save-layout"
            >
              <Save className="w-4 h-4 mr-1" />
              Save
            </Button>
          )}

          <Button 
            size="sm" 
            variant="ghost"
            onClick={handleExitEditMode}
            disabled={isSavingLayout}
            data-testid="button-exit-edit-mode"
          >
            <X className="w-4 h-4 mr-1" />
            Done
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
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="icon" variant="ghost" data-testid="button-dashboard-settings">
          <Settings2 className="w-4 h-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => setEditMode(true)} data-testid="menu-customize-dashboard">
          <Edit className="w-4 h-4 mr-2" />
          Customize Dashboard
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => setShowResetDialog(true)} data-testid="menu-reset-layout">
          <RotateCcw className="w-4 h-4 mr-2" />
          Reset to Default
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function EditModeIndicator() {
  const { isEditMode } = useDashboardCustomization();
  
  if (!isEditMode) return null;
  
  return (
    <div className="fixed top-0 left-0 right-0 h-1 bg-amber-500 z-50" data-testid="edit-mode-indicator" />
  );
}
