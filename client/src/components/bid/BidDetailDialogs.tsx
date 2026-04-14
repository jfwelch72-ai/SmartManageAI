import { useState } from "react";
import CrmOrganizationSelector from "@/components/CrmOrganizationSelector";
import StandardizedScopeSelector, { type ScopeSelectionData } from "@/components/StandardizedScopeSelector";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar as CalendarPicker } from "@/components/ui/calendar";
import { Calendar as CalendarIcon, FileText, UserCog, PlayCircle, ClipboardList } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { ObjectUploader } from "@/components/ObjectUploader";
import { cn } from "@/lib/utils";
import { format, parseISO } from "date-fns";
import type { UseFormReturn } from "react-hook-form";
import type { BidSubcontractorQuote, BidMaterialQuote, BidEquipmentSelection, Estimate, EstimateLineItem } from "@shared/schema";
import type { UploadResult } from "@uppy/core";

interface UserOption {
  id: string;
  firstName: string;
  lastName: string;
  role: string;
  isActive: boolean;
}

interface OwnedEquipment {
  id: string;
  equipmentCode: string;
  name: string;
  type: string;
  make: string | null;
  model: string | null;
  status: string;
  hourlyRate: string | null;
  dailyRate: string | null;
  weeklyRate: string | null;
  monthlyRate: string | null;
}

interface RentalEquipment {
  id: string;
  vendorId: string;
  name: string;
  equipmentType: string;
  make: string | null;
  model: string | null;
  hourlyRate: string | null;
  dailyRate: string | null;
  weeklyRate: string | null;
  monthlyRate: string | null;
  deliveryFee: string | null;
  vendorName: string;
  vendorCode: string;
}

interface BidEditDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  form: UseFormReturn<any>;
  onSubmit: (data: any) => void;
  isPending: boolean;
}

export function BidEditDialog({ open, onOpenChange, form, onSubmit, isPending }: BidEditDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit Bid</DialogTitle>
          <DialogDescription>Update the bid details</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4" data-testid="form-edit-bid">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Project Name</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="Project name" data-testid="input-name" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="bidAmount"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Bid Amount</FormLabel>
                    <FormControl>
                      <Input {...field} value={field.value || ""} type="number" step="0.01" placeholder="0.00" data-testid="input-bid-amount" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <FormField
              control={form.control}
              name="dueDate"
              render={({ field }) => (
                <FormItem className="flex flex-col">
                  <FormLabel>Due Date</FormLabel>
                  <Popover>
                    <PopoverTrigger asChild>
                      <FormControl>
                        <Button
                          variant="outline"
                          className={cn(
                            "w-full pl-3 text-left font-normal",
                            !field.value && "text-muted-foreground"
                          )}
                          data-testid="input-due-date"
                        >
                          {field.value ? format(parseISO(field.value), "PPP") : "Pick a date"}
                          <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                        </Button>
                      </FormControl>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <CalendarPicker
                        mode="single"
                        selected={field.value ? parseISO(field.value) : undefined}
                        onSelect={(date) => field.onChange(date ? format(date, "yyyy-MM-dd") : "")}
                        initialFocus
                      />
                    </PopoverContent>
                  </Popover>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <FormField
                control={form.control}
                name="locationAddress"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Address</FormLabel>
                    <FormControl>
                      <Input {...field} value={field.value || ""} placeholder="123 Main St" data-testid="input-location-address" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="city"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>City</FormLabel>
                    <FormControl>
                      <Input {...field} value={field.value || ""} placeholder="City" data-testid="input-city" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="state"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>State</FormLabel>
                    <FormControl>
                      <Input {...field} value={field.value || ""} placeholder="State" data-testid="input-state" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Description</FormLabel>
                  <FormControl>
                    <Textarea {...field} value={field.value || ""} placeholder="Project details..." rows={3} data-testid="input-description" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)} data-testid="button-cancel-edit-bid">
                Cancel
              </Button>
              <Button type="submit" disabled={isPending} data-testid="button-submit-edit-bid">
                {isPending ? "Saving..." : "Save Changes"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

interface SubcontractorQuoteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  form: UseFormReturn<any>;
  onSubmit: (data: any) => void;
  editingQuote: BidSubcontractorQuote | null;
  createPending: boolean;
  updatePending: boolean;
  isUploadingFile: boolean;
  uploadedFileData: { fileUrl: string; fileName: string; fileSize: number; mimeType: string } | null;
  onSetUploadedFileData: (data: { fileUrl: string; fileName: string; fileSize: number; mimeType: string } | null) => void;
  onFileUploadComplete: (result: UploadResult<Record<string, unknown>, Record<string, unknown>>) => void;
  estimateData: { estimate: (Estimate & { lineItems: EstimateLineItem[]; totals: any }) | null } | undefined;
  scopeSelectionData: ScopeSelectionData | undefined;
  onScopeSelectionChange: (data: ScopeSelectionData | undefined) => void;
  subcontractorContactId: string | undefined;
  onSubcontractorContactIdChange: (id: string | undefined) => void;
}

export function SubcontractorQuoteDialog({
  open,
  onOpenChange,
  form,
  onSubmit,
  editingQuote,
  createPending,
  updatePending,
  isUploadingFile,
  uploadedFileData,
  onSetUploadedFileData,
  onFileUploadComplete,
  estimateData,
  scopeSelectionData,
  onScopeSelectionChange,
  subcontractorContactId,
  onSubcontractorContactIdChange,
}: SubcontractorQuoteDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editingQuote ? "Edit Quote" : "Add Subcontractor Quote"}</DialogTitle>
          <DialogDescription>
            {editingQuote ? "Update the subcontractor quote details" : "Add a new quote from a subcontractor"}
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4" data-testid="form-subcontractor-quote">
            <div className="space-y-2">
              <Label>Select from CRM</Label>
              <CrmOrganizationSelector
                value={form.watch("subcontractorName")}
                filterTypes={["SUBCONTRACTOR"]}
                placeholder="Select or search for a subcontractor..."
                selectedContactId={subcontractorContactId}
                onSelect={(org) => {
                  if (org) {
                    form.setValue("subcontractorName", org.name);
                  } else {
                    form.setValue("subcontractorName", "");
                    form.setValue("contactName", "");
                    form.setValue("contactEmail", "");
                    form.setValue("contactPhone", "");
                    onSubcontractorContactIdChange(undefined);
                  }
                }}
                onContactSelect={(contact) => {
                  if (contact) {
                    onSubcontractorContactIdChange(contact.id);
                    form.setValue("contactName", `${contact.firstName} ${contact.lastName}`);
                    form.setValue("contactEmail", contact.email || "");
                    form.setValue("contactPhone", contact.phone || contact.mobile || "");
                  } else {
                    onSubcontractorContactIdChange(undefined);
                    form.setValue("contactName", "");
                    form.setValue("contactEmail", "");
                    form.setValue("contactPhone", "");
                  }
                }}
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="subcontractorName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Subcontractor Name</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="Company name" data-testid="input-subcontractor-name" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="quoteAmount"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Quote Amount ($)</FormLabel>
                    <FormControl>
                      <Input {...field} type="number" step="0.01" placeholder="0.00" data-testid="input-quote-amount" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            {estimateData?.estimate && (
              <div className="space-y-2">
                <Label>Link to Scope Item</Label>
                <StandardizedScopeSelector
                  value={scopeSelectionData}
                  onChange={(data) => {
                    onScopeSelectionChange(data);
                    if (data) {
                      form.setValue("scopeOfWork", data.canonicalName || data.workTypeName || "");
                    }
                  }}
                />
              </div>
            )}
            <FormField
              control={form.control}
              name="scopeOfWork"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Scope of Work</FormLabel>
                  <FormControl>
                    <Textarea {...field} placeholder="Describe the work to be performed..." rows={3} data-testid="input-scope-of-work" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <FormField
                control={form.control}
                name="contactName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Contact Name</FormLabel>
                    <FormControl>
                      <Input {...field} value={field.value || ""} placeholder="Contact person" data-testid="input-contact-name" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="contactEmail"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Contact Email</FormLabel>
                    <FormControl>
                      <Input {...field} value={field.value || ""} type="email" placeholder="email@example.com" data-testid="input-contact-email" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="contactPhone"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Contact Phone</FormLabel>
                    <FormControl>
                      <Input {...field} value={field.value || ""} placeholder="(555) 123-4567" data-testid="input-contact-phone" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <FormField
              control={form.control}
              name="notes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Notes</FormLabel>
                  <FormControl>
                    <Textarea {...field} value={field.value || ""} placeholder="Additional notes..." rows={2} data-testid="input-notes" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="inclusions"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Inclusions</FormLabel>
                    <FormControl>
                      <Textarea {...field} value={field.value || ""} placeholder="What is included in this quote..." rows={2} data-testid="input-inclusions" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="exclusions"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Exclusions</FormLabel>
                    <FormControl>
                      <Textarea {...field} value={field.value || ""} placeholder="What is excluded from this quote..." rows={2} data-testid="input-exclusions" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <div className="space-y-2">
              <Label>Quote Document</Label>
              {uploadedFileData ? (
                <div className="flex items-center gap-2 p-3 bg-muted rounded-md">
                  <FileText className="w-4 h-4" />
                  <span className="text-sm flex-1 truncate">{uploadedFileData.fileName}</span>
                  <Button type="button" size="sm" variant="ghost" onClick={() => onSetUploadedFileData(null)}>
                    Remove
                  </Button>
                </div>
              ) : (
                <ObjectUploader
                  fileType="DOCUMENT"
                  onComplete={onFileUploadComplete}
                  allowedFileTypes={[".pdf", ".xlsx", ".docx", ".png", ".jpg"]}
                  maxFileSize={10 * 1024 * 1024}
                >
                  Upload Quote Document
                </ObjectUploader>
              )}
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => { onOpenChange(false); onSetUploadedFileData(null); }} data-testid="button-cancel-sub-quote">
                Cancel
              </Button>
              <Button type="submit" disabled={createPending || updatePending || isUploadingFile} data-testid="button-submit-sub-quote">
                {editingQuote ? (updatePending ? "Saving..." : "Save Changes") : (createPending ? "Adding..." : "Add Quote")}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

interface MaterialQuoteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  form: UseFormReturn<any>;
  onSubmit: (data: any) => void;
  editingQuote: BidMaterialQuote | null;
  createPending: boolean;
  updatePending: boolean;
  isUploadingFile: boolean;
  uploadedFileData: { fileUrl: string; fileName: string; fileSize: number; mimeType: string } | null;
  onSetUploadedFileData: (data: { fileUrl: string; fileName: string; fileSize: number; mimeType: string } | null) => void;
  onFileUploadComplete: (result: UploadResult<Record<string, unknown>, Record<string, unknown>>) => void;
  supplierContactId: string | undefined;
  onSupplierContactIdChange: (id: string | undefined) => void;
}

export function MaterialQuoteDialog({
  open,
  onOpenChange,
  form,
  onSubmit,
  editingQuote,
  createPending,
  updatePending,
  isUploadingFile,
  uploadedFileData,
  onSetUploadedFileData,
  onFileUploadComplete,
  supplierContactId,
  onSupplierContactIdChange,
}: MaterialQuoteDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editingQuote ? "Edit Material Quote" : "Add Material Quote"}</DialogTitle>
          <DialogDescription>
            {editingQuote ? "Update the material quote details" : "Add a new material or supply quote"}
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4" data-testid="form-material-quote">
            <div className="space-y-2">
              <Label>Select Supplier from CRM</Label>
              <CrmOrganizationSelector
                value={form.watch("supplierName") || ""}
                filterTypes={["SUPPLIER"]}
                placeholder="Select or search for a supplier..."
                selectedContactId={supplierContactId}
                onSelect={(org) => {
                  if (org) {
                    form.setValue("supplierName", org.name);
                  } else {
                    form.setValue("supplierName", "");
                    form.setValue("supplierContact", "");
                    onSupplierContactIdChange(undefined);
                  }
                }}
                onContactSelect={(contact) => {
                  if (contact) {
                    onSupplierContactIdChange(String(contact.id));
                    form.setValue("supplierContact", `${contact.firstName} ${contact.lastName}`);
                  } else {
                    onSupplierContactIdChange(undefined);
                    form.setValue("supplierContact", "");
                  }
                }}
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="materialName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Material Name</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="e.g., Concrete, Rebar, etc." data-testid="input-material-name" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="cost"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Cost ($)</FormLabel>
                    <FormControl>
                      <Input {...field} type="number" step="0.01" placeholder="0.00" data-testid="input-material-cost" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Description</FormLabel>
                  <FormControl>
                    <Textarea {...field} value={field.value || ""} placeholder="Material description..." rows={2} data-testid="input-material-description" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="specs"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Specifications</FormLabel>
                    <FormControl>
                      <Input {...field} value={field.value || ""} placeholder="Size, grade, etc." data-testid="input-material-specs" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="leadTime"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Lead Time</FormLabel>
                    <FormControl>
                      <Input {...field} value={field.value || ""} placeholder="e.g., 2 weeks" data-testid="input-material-lead-time" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="supplierName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Supplier Name</FormLabel>
                    <FormControl>
                      <Input {...field} value={field.value || ""} placeholder="Supplier company" data-testid="input-supplier-name" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="supplierContact"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Supplier Contact</FormLabel>
                    <FormControl>
                      <Input {...field} value={field.value || ""} placeholder="Contact person" data-testid="input-supplier-contact" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <FormField
              control={form.control}
              name="supplierEmail"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Supplier Email (for RFQ)</FormLabel>
                  <FormControl>
                    <Input {...field} value={field.value || ""} type="email" placeholder="supplier@example.com" data-testid="input-supplier-email" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="space-y-2">
              <Label>Quote Document</Label>
              {uploadedFileData ? (
                <div className="flex items-center gap-2 p-3 bg-muted rounded-md">
                  <FileText className="w-4 h-4" />
                  <span className="text-sm flex-1 truncate">{uploadedFileData.fileName}</span>
                  <Button type="button" size="sm" variant="ghost" onClick={() => onSetUploadedFileData(null)}>
                    Remove
                  </Button>
                </div>
              ) : (
                <ObjectUploader
                  fileType="DOCUMENT"
                  onComplete={onFileUploadComplete}
                  allowedFileTypes={[".pdf", ".xlsx", ".docx", ".png", ".jpg"]}
                  maxFileSize={10 * 1024 * 1024}
                >
                  Upload Quote Document
                </ObjectUploader>
              )}
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => { onOpenChange(false); onSetUploadedFileData(null); }} data-testid="button-cancel-material-quote">
                Cancel
              </Button>
              <Button type="submit" disabled={createPending || updatePending || isUploadingFile} data-testid="button-submit-material-quote">
                {editingQuote ? (updatePending ? "Saving..." : "Save Changes") : (createPending ? "Adding..." : "Add Quote")}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

interface EquipmentSelectionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  form: UseFormReturn<any>;
  onSubmit: (data: any) => void;
  editingSelection: BidEquipmentSelection | null;
  createPending: boolean;
  updatePending: boolean;
  selectedSource: "OWNED" | "RENTAL";
  onSourceChange: (source: "OWNED" | "RENTAL") => void;
  availableEquipment: { owned: OwnedEquipment[]; rental: RentalEquipment[] } | undefined;
  onSelectOwned: (id: string) => void;
  onSelectRental: (id: string) => void;
  onCalculateCost: () => void;
}

export function EquipmentSelectionDialog({
  open,
  onOpenChange,
  form,
  onSubmit,
  editingSelection,
  createPending,
  updatePending,
  selectedSource,
  onSourceChange,
  availableEquipment,
  onSelectOwned,
  onSelectRental,
  onCalculateCost,
}: EquipmentSelectionDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editingSelection ? "Edit Equipment" : "Add Equipment"}</DialogTitle>
          <DialogDescription>
            {editingSelection ? "Update the equipment selection" : "Add equipment needed for this bid"}
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4" data-testid="form-equipment-selection">
            <FormField
              control={form.control}
              name="source"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Equipment Source</FormLabel>
                  <Select
                    value={field.value}
                    onValueChange={(value: "OWNED" | "RENTAL") => {
                      field.onChange(value);
                      onSourceChange(value);
                      form.setValue("equipmentId", undefined);
                      form.setValue("rentalCatalogId", undefined);
                      form.setValue("rentalVendorId", undefined);
                      form.setValue("equipmentName", "");
                      form.setValue("equipmentType", "");
                      form.setValue("hourlyRate", "");
                      form.setValue("dailyRate", "");
                      form.setValue("weeklyRate", "");
                      form.setValue("deliveryFee", "");
                    }}
                  >
                    <SelectTrigger data-testid="select-equipment-source">
                      <SelectValue placeholder="Select source..." />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="OWNED">Owned Equipment</SelectItem>
                      <SelectItem value="RENTAL">Rental Equipment</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            {selectedSource === "OWNED" && (
              <div className="space-y-2">
                <Label>Select from Fleet</Label>
                <Select onValueChange={onSelectOwned}>
                  <SelectTrigger data-testid="select-owned-equipment">
                    <SelectValue placeholder="Select equipment from fleet..." />
                  </SelectTrigger>
                  <SelectContent>
                    {availableEquipment?.owned?.length === 0 ? (
                      <div className="p-4 text-center text-sm text-muted-foreground">
                        No owned equipment available
                      </div>
                    ) : (
                      availableEquipment?.owned?.map((eq) => (
                        <SelectItem key={eq.id} value={eq.id}>
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-xs">{eq.equipmentCode}</span>
                            <span>{eq.name}</span>
                            <span className="text-xs text-muted-foreground">({eq.type})</span>
                          </div>
                        </SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
              </div>
            )}

            {selectedSource === "RENTAL" && (
              <div className="space-y-2">
                <Label>Select from Rental Catalog</Label>
                <Select onValueChange={onSelectRental}>
                  <SelectTrigger data-testid="select-rental-equipment">
                    <SelectValue placeholder="Select rental equipment..." />
                  </SelectTrigger>
                  <SelectContent>
                    {availableEquipment?.rental?.length === 0 ? (
                      <div className="p-4 text-center text-sm text-muted-foreground">
                        No rental equipment available. Add rental vendors and equipment first.
                      </div>
                    ) : (
                      availableEquipment?.rental?.map((eq) => (
                        <SelectItem key={eq.id} value={eq.id}>
                          <div className="flex items-center gap-2">
                            <span>{eq.name}</span>
                            <span className="text-xs text-muted-foreground">({eq.equipmentType})</span>
                            <span className="text-xs text-muted-foreground">- {eq.vendorName}</span>
                          </div>
                        </SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="equipmentName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Equipment Name</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="Equipment name" data-testid="input-equipment-name" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="equipmentType"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Type</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="e.g., Excavator" data-testid="input-equipment-type" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <FormField
                control={form.control}
                name="plannedDays"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Planned Days</FormLabel>
                    <FormControl>
                      <Input {...field} type="number" placeholder="0" onBlur={onCalculateCost} data-testid="input-planned-days" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="plannedHours"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Planned Hours</FormLabel>
                    <FormControl>
                      <Input {...field} type="number" step="0.5" placeholder="0" onBlur={onCalculateCost} data-testid="input-planned-hours" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="dailyRate"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Daily Rate ($)</FormLabel>
                    <FormControl>
                      <Input {...field} type="number" step="0.01" placeholder="0.00" onBlur={onCalculateCost} data-testid="input-daily-rate" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            {selectedSource === "RENTAL" && (
              <FormField
                control={form.control}
                name="deliveryFee"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Delivery Fee ($)</FormLabel>
                    <FormControl>
                      <Input {...field} type="number" step="0.01" placeholder="0.00" onBlur={onCalculateCost} data-testid="input-delivery-fee" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            <FormField
              control={form.control}
              name="estimatedCost"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Estimated Total Cost ($)</FormLabel>
                  <FormControl>
                    <Input {...field} type="number" step="0.01" placeholder="0.00" data-testid="input-estimated-cost" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="notes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Notes</FormLabel>
                  <FormControl>
                    <Textarea {...field} value={field.value || ""} placeholder="Additional notes..." rows={2} data-testid="input-equipment-notes" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={createPending || updatePending}>
                {editingSelection
                  ? (updatePending ? "Saving..." : "Save Changes")
                  : (createPending ? "Adding..." : "Add Equipment")}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

interface AwardBidDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  bid: any;
  finalBidAmount: number;
  overheadPercent: number;
  profitPercent: number;
  superintendents: UserOption[];
  managers: UserOption[];
  selectedSuperintendentId: string;
  selectedProjectManagerId: string;
  startInPlanning: boolean;
  onSuperintendentChange: (id: string) => void;
  onProjectManagerChange: (id: string) => void;
  onStartInPlanningChange: (value: boolean) => void;
  onConfirmAward: () => void;
  isPending: boolean;
}

export function AwardBidDialog({
  open,
  onOpenChange,
  bid,
  finalBidAmount,
  overheadPercent,
  profitPercent,
  superintendents,
  managers,
  selectedSuperintendentId,
  selectedProjectManagerId,
  startInPlanning,
  onSuperintendentChange,
  onProjectManagerChange,
  onStartInPlanningChange,
  onConfirmAward,
  isPending,
}: AwardBidDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserCog className="h-5 w-5" />
            Award Bid & Assign Team
          </DialogTitle>
          <DialogDescription>
            Convert this bid to a project and assign the team members who will be responsible for it.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="p-3 bg-muted rounded-lg space-y-1">
            <p className="text-sm font-medium">Project: {bid?.name}</p>
            <p className="text-xs text-muted-foreground">Code: {bid?.code}</p>
            <p className="text-xs text-muted-foreground">Final Bid: ${finalBidAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
            <div className="flex gap-4 pt-1 border-t mt-1">
              <p className="text-xs text-muted-foreground">Overhead: <span className="font-medium text-foreground">{overheadPercent}%</span></p>
              <p className="text-xs text-muted-foreground">Profit Margin: <span className="font-medium text-foreground">{profitPercent}%</span></p>
            </div>
          </div>

          <div className="p-3 border rounded-lg space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ClipboardList className="h-4 w-4 text-muted-foreground" />
                <Label htmlFor="start-in-planning" className="font-medium cursor-pointer">Start in Planning Mode</Label>
              </div>
              <Switch
                id="start-in-planning"
                checked={startInPlanning}
                onCheckedChange={onStartInPlanningChange}
                data-testid="switch-start-in-planning"
              />
            </div>
            <p className="text-xs text-muted-foreground">
              {startInPlanning
                ? "Project will start in Planning status — use this to pre-order materials and schedule crews before mobilizing."
                : "Project will start as Active immediately upon conversion."}
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="superintendent">Superintendent</Label>
            <Select
              value={selectedSuperintendentId}
              onValueChange={(val) => onSuperintendentChange(val === "none" ? "" : val)}
            >
              <SelectTrigger id="superintendent" data-testid="select-superintendent">
                <SelectValue placeholder="Select superintendent (optional)" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">None</SelectItem>
                {superintendents.map((user) => (
                  <SelectItem key={user.id} value={user.id}>
                    {user.firstName} {user.lastName} ({user.role})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="projectManager">Project Manager</Label>
            <Select
              value={selectedProjectManagerId}
              onValueChange={(val) => onProjectManagerChange(val === "none" ? "" : val)}
            >
              <SelectTrigger id="projectManager" data-testid="select-project-manager">
                <SelectValue placeholder="Select project manager (optional)" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">None</SelectItem>
                {managers.map((user) => (
                  <SelectItem key={user.id} value={user.id}>
                    {user.firstName} {user.lastName} ({user.role})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            data-testid="button-cancel-award"
          >
            Cancel
          </Button>
          <Button
            onClick={onConfirmAward}
            disabled={isPending}
            data-testid="button-confirm-award"
          >
            {isPending ? "Converting..." : startInPlanning ? "Award & Start Planning" : "Award & Convert to Project"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
