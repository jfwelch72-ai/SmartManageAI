import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { X, Loader2, FileText, Layers, Trash2, Eye, EyeOff, GitBranch, AlertTriangle } from "lucide-react";
import type { TakeoffSheet, TakeoffMeasurement, QuantityCategory } from "@shared/schema";
import type { PlanDocument } from "./types";

interface TakeoffDialogsProps {
  mobileMeasurementsOpen: boolean;
  setMobileMeasurementsOpen: (v: boolean) => void;
  measurements: TakeoffMeasurement[];
  selectedMeasurementId: string | null;
  setSelectedMeasurementId: (v: string | null) => void;
  deleteMeasurementMutation: any;
  updateMeasurementMutation: any;
  aggregatedMeasurements: any;
  categories: QuantityCategory[];
  hiddenCategoryIds: Set<string>;
  onToggleCategoryVisibility: (id: string) => void;
  renameDialogOpen: boolean;
  setRenameDialogOpen: (v: boolean) => void;
  renameValue: string;
  setRenameValue: (v: string) => void;
  renameSheetMutation: any;
  selectedSheet: string | null;
  deleteSheetConfirmOpen: boolean;
  setDeleteSheetConfirmOpen: (v: boolean) => void;
  currentSheet: TakeoffSheet | undefined;
  deleteSheetMutation: any;
  noteDialogOpen: boolean;
  setNoteDialogOpen: (v: boolean) => void;
  noteText: string;
  setNoteText: (v: string) => void;
  notePosition: { x: number; y: number } | null;
  setNotePosition: (v: { x: number; y: number } | null) => void;
  onSaveNote: () => void;
  categoryDialogOpen: boolean;
  setCategoryDialogOpen: (v: boolean) => void;
  editingCategory: QuantityCategory | null;
  setEditingCategory: (v: QuantityCategory | null) => void;
  categoryName: string;
  setCategoryName: (v: string) => void;
  categoryColor: string;
  setCategoryColor: (v: string) => void;
  onSaveCategory: () => void;
  saveCategoryPending: boolean;
  shortcutsDialogOpen: boolean;
  setShortcutsDialogOpen: (v: boolean) => void;
  uploadDialogOpen: boolean;
  setUploadDialogOpen: (v: boolean) => void;
  planDocuments: PlanDocument[];
  documentsLoading: boolean;
  sheets: TakeoffSheet[];
  importPlanMutation: any;
  supersedeSheetMutation: any;
  workspaceRef: React.RefObject<HTMLDivElement | null>;
}

export function TakeoffDialogs(props: TakeoffDialogsProps) {
  const {
    mobileMeasurementsOpen, setMobileMeasurementsOpen,
    measurements, selectedMeasurementId, setSelectedMeasurementId,
    deleteMeasurementMutation, updateMeasurementMutation, aggregatedMeasurements,
    categories, hiddenCategoryIds, onToggleCategoryVisibility,
    renameDialogOpen, setRenameDialogOpen, renameValue, setRenameValue, renameSheetMutation, selectedSheet,
    deleteSheetConfirmOpen, setDeleteSheetConfirmOpen, currentSheet, deleteSheetMutation,
    noteDialogOpen, setNoteDialogOpen, noteText, setNoteText, notePosition, setNotePosition, onSaveNote,
    categoryDialogOpen, setCategoryDialogOpen, editingCategory, setEditingCategory,
    categoryName, setCategoryName, categoryColor, setCategoryColor, onSaveCategory, saveCategoryPending,
    shortcutsDialogOpen, setShortcutsDialogOpen,
    uploadDialogOpen, setUploadDialogOpen, planDocuments, documentsLoading, sheets, importPlanMutation,
    supersedeSheetMutation,
    workspaceRef,
  } = props;

  const [importStep, setImportStep] = useState<"select-doc" | "revision-prompt" | "select-supersede">("select-doc");
  const [pendingDocId, setPendingDocId] = useState<string | null>(null);
  const [supersedesSheetId, setSupersedesSheetId] = useState<string>("");
  const [revisionLabel, setRevisionLabel] = useState<string>("");

  const activeSheets = sheets.filter((s: any) => s.isActive !== false);

  const resetImportState = () => {
    setImportStep("select-doc");
    setPendingDocId(null);
    setSupersedesSheetId("");
    setRevisionLabel("");
  };

  const handleDocClick = (docId: string) => {
    if (importPlanMutation.isPending) return;
    if (sheets.length === 0) {
      importPlanMutation.mutate({ documentId: docId });
    } else {
      setPendingDocId(docId);
      setImportStep("revision-prompt");
    }
  };

  const handleNewSheet = () => {
    if (!pendingDocId) return;
    importPlanMutation.mutate({ documentId: pendingDocId });
    resetImportState();
  };

  const handleRevision = () => {
    setImportStep("select-supersede");
  };

  const handleConfirmRevision = async () => {
    if (!pendingDocId || !supersedesSheetId) return;
    const data = await importPlanMutation.mutateAsync({ documentId: pendingDocId, revisionLabel: revisionLabel || undefined });
    if (data?.sheets?.[0]?.id && supersedesSheetId) {
      supersedeSheetMutation.mutate({
        oldSheetId: supersedesSheetId,
        newSheetId: data.sheets[0].id,
        revisionLabel: revisionLabel || undefined,
      });
    }
    resetImportState();
  };

  return (
    <>
      <Sheet open={mobileMeasurementsOpen} onOpenChange={setMobileMeasurementsOpen}>
        <SheetContent side="bottom" className="h-[70vh] flex flex-col p-0">
          <SheetHeader className="px-4 pt-4 pb-2 border-b shrink-0">
            <SheetTitle className="flex items-center justify-between">
              <span className="flex items-center gap-2"><Layers className="w-4 h-4 text-primary" />Measurements</span>
              <Badge variant="secondary">{measurements.length}</Badge>
            </SheetTitle>
            <SheetDescription className="sr-only">View and manage takeoff measurements</SheetDescription>
          </SheetHeader>
          <ScrollArea className="flex-1">
            <div className="p-4 space-y-3">
              {categories.length > 0 && (
                <div className="space-y-1">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Layer Visibility</p>
                  <div className="space-y-1">
                    {categories.map((category) => {
                      const isHidden = hiddenCategoryIds.has(category.id);
                      return (
                        <div key={category.id} className={cn("flex items-center justify-between px-2 py-1.5 rounded border", isHidden && "opacity-60")} style={{ borderLeft: `3px solid ${isHidden ? "#9ca3af" : category.color}` }}>
                          <span className={cn("text-sm", isHidden && "line-through text-muted-foreground")}>{category.name}</span>
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => onToggleCategoryVisibility(category.id)} data-testid={`button-mobile-toggle-visibility-category-${category.id}`} title={isHidden ? "Show layer" : "Hide layer"}>
                            {isHidden ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                          </Button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
              {measurements.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">No measurements yet. Use the drawing tools to create measurements.</p>
              ) : (
                measurements.map((m) => {
                  const isSelected = selectedMeasurementId === m.id;
                  return (
                    <div key={m.id} className={cn("p-3 rounded-lg bg-muted/50 border transition-colors", isSelected ? "border-primary ring-1 ring-primary bg-primary/5" : "border-transparent")} onClick={() => setSelectedMeasurementId(m.id === selectedMeasurementId ? null : m.id)} data-testid={`mobile-measurement-item-${m.id}`}>
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="font-medium text-sm truncate">{m.label || "Untitled"}</span>
                          <Badge variant="outline" className="text-[10px] shrink-0">{m.type}</Badge>
                        </div>
                        <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={(e) => { e.stopPropagation(); deleteMeasurementMutation.mutate(m); }} data-testid={`button-mobile-delete-measurement-${m.id}`}>
                          <Trash2 className="w-3.5 h-3.5 text-destructive" />
                        </Button>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {(m.type === "LINEAR" || m.type === "LINEAR_WITH_DROP" || m.type === "PITCHED_LINEAR") && m.computedLengthFt
                          ? `${(Number.isFinite(m.computedLengthFt) ? m.computedLengthFt : 0).toFixed(2)} LF${(m as any).pitchRatio ? ` (${(m as any).pitchRatio})` : ""}`
                          : (m.type === "AREA" || m.type === "PITCHED_AREA" || m.type === "SURFACE_AREA") && (m.computedAreaFt2 || (m as any).computedSurfaceAreaFt2)
                          ? `${((m as any).computedSurfaceAreaFt2 || m.computedAreaFt2 || 0).toFixed(2)} SF${(m as any).pitchRatio ? ` (${(m as any).pitchRatio})` : ""}`
                          : m.type === "VOLUME" && m.computedVolumeCy ? `${(Number.isFinite(m.computedVolumeCy) ? m.computedVolumeCy : 0).toFixed(2)} CY`
                          : m.type === "COUNT" ? "Count marker" : m.type === "NOTE" ? "Note" : ""}
                      </p>
                      {isSelected && (
                        <div className="mt-3 pt-3 border-t space-y-3">
                          <div className="grid grid-cols-2 gap-2">
                            {m.computedLengthFt && <div className="text-xs"><span className="text-muted-foreground">Length: </span><span className="font-medium">{Number(m.computedLengthFt).toFixed(2)} LF</span></div>}
                            {m.computedAreaFt2 && <div className="text-xs"><span className="text-muted-foreground">Area: </span><span className="font-medium">{Number(m.computedAreaFt2).toFixed(2)} SF</span></div>}
                            {m.computedVolumeCy && <div className="text-xs"><span className="text-muted-foreground">Volume: </span><span className="font-medium">{Number(m.computedVolumeCy).toFixed(2)} CY</span></div>}
                          </div>
                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <Label className="text-[10px]">Cost Code</Label>
                              <Input placeholder="Cost code..." defaultValue={(m as any).costCodeId || ""} onBlur={(e) => { const val = e.target.value.trim(); if (val !== ((m as any).costCodeId || "")) updateMeasurementMutation.mutate({ id: m.id, costCodeId: val || undefined }); }} className="h-7 text-xs" data-testid={`mobile-input-cost-code-${m.id}`} />
                            </div>
                            <div>
                              <Label className="text-[10px]">Unit Cost ($)</Label>
                              <Input type="number" placeholder="0.00" defaultValue={(m as any).unitCost || ""} onBlur={(e) => { const val = parseFloat(e.target.value) || undefined; if (val !== (m as any).unitCost) updateMeasurementMutation.mutate({ id: m.id, unitCost: val }); }} className="h-7 text-xs" data-testid={`mobile-input-unit-cost-${m.id}`} />
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })
              )}
              {measurements.length > 0 && (
                <div className="p-3 bg-muted rounded-lg space-y-1">
                  <h4 className="text-xs font-semibold mb-2">Totals</h4>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                    <div className="flex justify-between"><span className="text-muted-foreground">Linear:</span><span>{(Number.isFinite(aggregatedMeasurements.grandTotals.linearTotal) ? aggregatedMeasurements.grandTotals.linearTotal : 0).toFixed(1)} LF</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Area:</span><span>{(Number.isFinite(aggregatedMeasurements.grandTotals.areaTotal) ? aggregatedMeasurements.grandTotals.areaTotal : 0).toFixed(1)} SF</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Volume:</span><span>{(Number.isFinite(aggregatedMeasurements.grandTotals.volumeTotal) ? aggregatedMeasurements.grandTotals.volumeTotal : 0).toFixed(1)} CY</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Count:</span><span>{aggregatedMeasurements.grandTotals.countTotal}</span></div>
                  </div>
                </div>
              )}
            </div>
          </ScrollArea>
        </SheetContent>
      </Sheet>

      <Dialog open={renameDialogOpen} onOpenChange={setRenameDialogOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Rename Sheet</DialogTitle><DialogDescription>Enter a new name for this sheet.</DialogDescription></DialogHeader>
          <Input value={renameValue} onChange={(e) => setRenameValue(e.target.value)} placeholder="Sheet name..." onKeyDown={(e) => { if (e.key === "Enter" && renameValue.trim() && selectedSheet) renameSheetMutation.mutate({ sheetId: selectedSheet, sheetName: renameValue.trim() }); }} data-testid="input-rename-sheet" />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameDialogOpen(false)} data-testid="button-cancel-rename">Cancel</Button>
            <Button onClick={() => selectedSheet && renameSheetMutation.mutate({ sheetId: selectedSheet, sheetName: renameValue.trim() })} disabled={!renameValue.trim() || renameSheetMutation.isPending} data-testid="button-confirm-rename">
              {renameSheetMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}Rename
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteSheetConfirmOpen} onOpenChange={setDeleteSheetConfirmOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Delete Sheet</DialogTitle><DialogDescription>Are you sure you want to delete "{currentSheet?.sheetName}"? This will also remove all measurements on this sheet. This action cannot be undone.</DialogDescription></DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteSheetConfirmOpen(false)} data-testid="button-cancel-delete-sheet">Cancel</Button>
            <Button variant="destructive" onClick={() => selectedSheet && deleteSheetMutation.mutate(selectedSheet)} disabled={deleteSheetMutation.isPending} data-testid="button-confirm-delete-sheet">
              {deleteSheetMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <DialogPrimitive.Root open={noteDialogOpen} onOpenChange={setNoteDialogOpen}>
        <DialogPrimitive.Portal container={workspaceRef.current}>
          <DialogPrimitive.Overlay className={cn("fixed inset-0 z-50 bg-black/80 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0")} />
          <DialogPrimitive.Content className={cn("fixed left-[50%] top-[50%] z-50 grid w-full max-w-lg translate-x-[-50%] translate-y-[-50%] gap-4 border bg-background p-6 shadow-lg duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%] sm:rounded-lg")} data-testid="dialog-note">
            <div className="flex flex-col space-y-1.5 text-center sm:text-left">
              <DialogPrimitive.Title className="text-lg font-semibold leading-none tracking-tight">Add Note</DialogPrimitive.Title>
              <DialogPrimitive.Description className="text-sm text-muted-foreground">Add a note to mark this location on the drawing</DialogPrimitive.Description>
            </div>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="note-text">Note Text</Label>
                <Textarea id="note-text" placeholder="Enter your note here..." value={noteText} onChange={(e) => setNoteText(e.target.value)} data-testid="input-note-text" rows={4} />
              </div>
            </div>
            <div className="flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2">
              <Button variant="outline" onClick={() => { setNoteDialogOpen(false); setNoteText(""); setNotePosition(null); }} data-testid="button-cancel-note">Cancel</Button>
              <Button onClick={onSaveNote} data-testid="button-save-note">Save Note</Button>
            </div>
            <DialogPrimitive.Close className="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none data-[state=open]:bg-accent data-[state=open]:text-muted-foreground">
              <X className="h-4 w-4" /><span className="sr-only">Close</span>
            </DialogPrimitive.Close>
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>

      <DialogPrimitive.Root open={categoryDialogOpen} onOpenChange={(open) => { setCategoryDialogOpen(open); if (!open) setEditingCategory(null); }}>
        <DialogPrimitive.Portal container={workspaceRef.current}>
          <DialogPrimitive.Overlay className={cn("fixed inset-0 z-50 bg-black/80 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0")} />
          <DialogPrimitive.Content className={cn("fixed left-[50%] top-[50%] z-50 grid w-full max-w-lg translate-x-[-50%] translate-y-[-50%] gap-4 border bg-background p-6 shadow-lg duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%] sm:rounded-lg")} data-testid="dialog-category">
            <div className="flex flex-col space-y-1.5 text-center sm:text-left">
              <DialogPrimitive.Title className="text-lg font-semibold leading-none tracking-tight">{editingCategory ? "Edit Category" : "Add Category"}</DialogPrimitive.Title>
              <DialogPrimitive.Description className="text-sm text-muted-foreground">Create or edit quantity categories to organize your measurements</DialogPrimitive.Description>
            </div>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="category-name">Category Name</Label>
                <Input id="category-name" placeholder="e.g., Sidewalk, Curb, Curb & Gutter..." value={categoryName} onChange={(e) => setCategoryName(e.target.value)} data-testid="input-category-name" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="category-color">Color</Label>
                <div className="flex gap-2 items-center">
                  <Input id="category-color" type="color" value={categoryColor} onChange={(e) => setCategoryColor(e.target.value)} className="w-20 h-10 cursor-pointer" data-testid="input-category-color" />
                  <Input type="text" value={categoryColor} onChange={(e) => setCategoryColor(e.target.value)} placeholder="#3b82f6" className="flex-1 font-mono" data-testid="input-category-color-text" />
                </div>
              </div>
            </div>
            <div className="flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2">
              <Button variant="outline" onClick={() => { setCategoryDialogOpen(false); setEditingCategory(null); }} data-testid="button-cancel-category">Cancel</Button>
              <Button onClick={onSaveCategory} data-testid="button-save-category" disabled={saveCategoryPending}>{saveCategoryPending ? "Saving..." : (editingCategory ? "Update" : "Create")}</Button>
            </div>
            <DialogPrimitive.Close className="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none data-[state=open]:bg-accent data-[state=open]:text-muted-foreground">
              <X className="h-4 w-4" /><span className="sr-only">Close</span>
            </DialogPrimitive.Close>
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>

      <Dialog open={shortcutsDialogOpen} onOpenChange={setShortcutsDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>Keyboard Shortcuts</DialogTitle><DialogDescription>Speed up your workflow with these keyboard shortcuts</DialogDescription></DialogHeader>
          <div className="grid gap-6">
            <div>
              <h3 className="font-semibold mb-3">Tools</h3>
              <div className="grid grid-cols-2 gap-2">
                {[
                  ["Select Tool", "S"], ["Hand/Pan Tool", "H"], ["Linear Tool", "L"], ["Arc/Radius Tool", "R"],
                  ["Area Tool", "A"], ["Volume Tool", "V"], ["Count Tool", "C"], ["Note Tool", "N"],
                  ["Linear + Drop", "D"], ["Pitched Linear", "P"], ["Pitched Area", "T"], ["Surface Area", "G"],
                ].map(([label, key]) => (
                  <div key={key} className="flex items-center justify-between p-2 rounded hover-elevate">
                    <span className="text-sm">{label}</span>
                    <kbd className="px-2 py-1 text-xs font-mono bg-muted rounded border">{key}</kbd>
                  </div>
                ))}
              </div>
            </div>
            <Separator />
            <div>
              <h3 className="font-semibold mb-3">Navigation & View</h3>
              <div className="grid grid-cols-2 gap-2">
                {[
                  ["Temporary Pan", "Space"], ["Zoom In", "+ / ="], ["Zoom Out", "-"],
                  ["Mouse Wheel Zoom", "Scroll"], ["Toggle Fullscreen", "F"],
                ].map(([label, key]) => (
                  <div key={key} className="flex items-center justify-between p-2 rounded hover-elevate">
                    <span className="text-sm">{label}</span>
                    <kbd className="px-2 py-1 text-xs font-mono bg-muted rounded border">{key}</kbd>
                  </div>
                ))}
              </div>
            </div>
            <Separator />
            <div>
              <h3 className="font-semibold mb-3">Actions</h3>
              <div className="grid grid-cols-2 gap-2">
                {[
                  ["Undo", "Ctrl+Z"], ["Redo", "Ctrl+Y"], ["Cancel Drawing", "ESC"], ["Complete Polygon", "Enter"],
                ].map(([label, key]) => (
                  <div key={key} className="flex items-center justify-between p-2 rounded hover-elevate">
                    <span className="text-sm">{label}</span>
                    <kbd className="px-2 py-1 text-xs font-mono bg-muted rounded border">{key}</kbd>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={uploadDialogOpen} onOpenChange={(open) => { setUploadDialogOpen(open); if (!open) resetImportState(); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Import Plan Sheet</DialogTitle>
            <DialogDescription>
              {importStep === "select-doc" && "Select a plan document to import into the takeoff workspace"}
              {importStep === "revision-prompt" && "Is this a new sheet or a revision of an existing sheet?"}
              {importStep === "select-supersede" && "Select the existing sheet this revision replaces"}
            </DialogDescription>
          </DialogHeader>

          {importStep === "select-doc" && (
            <div className="space-y-4">
              {documentsLoading ? (
                <div className="flex items-center justify-center py-8"><Loader2 className="w-6 h-6 animate-spin" /></div>
              ) : planDocuments.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <FileText className="w-12 h-12 mx-auto mb-4 opacity-50" />
                  <p>No plan documents found</p>
                  <p className="text-sm mt-2">Upload plan documents to the project first via the Documents section</p>
                </div>
              ) : (
                <ScrollArea className="max-h-[300px]">
                  <div className="space-y-2">
                    {planDocuments.map((doc) => {
                      const isAlreadyImported = sheets.some((sheet: any) => sheet.documentId === doc.id && (sheet.isActive !== false));
                      return (
                        <div key={doc.id} className={cn("flex items-center gap-3 p-3 rounded-lg border", isAlreadyImported ? "bg-muted/50 cursor-not-allowed opacity-60" : "hover-elevate cursor-pointer")} onClick={() => { if (!isAlreadyImported && !importPlanMutation.isPending) handleDocClick(doc.id); }} data-testid={`button-import-doc-${doc.id}`}>
                          <FileText className="w-8 h-8 text-primary flex-shrink-0" />
                          <div className="flex-1 min-w-0">
                            <p className="font-medium truncate">{doc.title || doc.fileName}</p>
                            <p className="text-sm text-muted-foreground truncate">{doc.fileName}</p>
                          </div>
                          {isAlreadyImported ? <Badge variant="secondary">Imported</Badge> : importPlanMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                        </div>
                      );
                    })}
                  </div>
                </ScrollArea>
              )}
            </div>
          )}

          {importStep === "revision-prompt" && (
            <div className="space-y-4 py-2">
              <div className="grid grid-cols-2 gap-3">
                <button
                  className="flex flex-col items-center gap-3 p-4 rounded-lg border-2 border-muted hover:border-primary hover:bg-primary/5 transition-colors text-center"
                  onClick={handleNewSheet}
                  data-testid="button-new-sheet"
                >
                  <FileText className="w-8 h-8 text-primary" />
                  <div>
                    <p className="font-medium text-sm">New Sheet</p>
                    <p className="text-xs text-muted-foreground mt-1">Add as a brand-new plan sheet</p>
                  </div>
                </button>
                <button
                  className="flex flex-col items-center gap-3 p-4 rounded-lg border-2 border-muted hover:border-amber-500 hover:bg-amber-50 dark:hover:bg-amber-950/20 transition-colors text-center"
                  onClick={handleRevision}
                  disabled={activeSheets.length === 0}
                  data-testid="button-revision-of-existing"
                >
                  <GitBranch className="w-8 h-8 text-amber-500" />
                  <div>
                    <p className="font-medium text-sm">Revision</p>
                    <p className="text-xs text-muted-foreground mt-1">Supersedes an existing sheet</p>
                  </div>
                </button>
              </div>
            </div>
          )}

          {importStep === "select-supersede" && (
            <div className="space-y-4 py-2">
              <div className="space-y-2">
                <Label>Sheet this revision replaces</Label>
                <Select value={supersedesSheetId} onValueChange={setSupersedesSheetId}>
                  <SelectTrigger data-testid="select-supersedes-sheet">
                    <SelectValue placeholder="Select existing sheet..." />
                  </SelectTrigger>
                  <SelectContent>
                    {activeSheets.map((s: any) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.sheetName || "Untitled"}{(s as any).revisionLabel ? ` (${(s as any).revisionLabel})` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Revision Label <span className="text-muted-foreground font-normal">(optional)</span></Label>
                <Input
                  placeholder="e.g., Rev B, v2, 2025-03-19..."
                  value={revisionLabel}
                  onChange={(e) => setRevisionLabel(e.target.value)}
                  data-testid="input-revision-label"
                />
                <p className="text-xs text-muted-foreground">A short label shown on the sheet badge. Leave blank to auto-generate.</p>
              </div>
              <div className="flex gap-2 pt-2">
                <Button variant="outline" onClick={() => setImportStep("revision-prompt")} className="flex-1">Back</Button>
                <Button
                  onClick={handleConfirmRevision}
                  disabled={!supersedesSheetId || importPlanMutation.isPending || supersedeSheetMutation.isPending}
                  className="flex-1"
                  data-testid="button-confirm-revision"
                >
                  {(importPlanMutation.isPending || supersedeSheetMutation.isPending) && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                  Import as Revision
                </Button>
              </div>
            </div>
          )}

          {importStep === "select-doc" && (
            <DialogFooter>
              <Button variant="outline" onClick={() => { setUploadDialogOpen(false); resetImportState(); }} data-testid="button-close-import-dialog">Close</Button>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
