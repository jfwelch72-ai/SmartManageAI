import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Check, ChevronsUpDown, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Project } from "@shared/schema";

type OrganizationType = "CONTRACTOR" | "SUBCONTRACTOR" | "SUPPLIER" | "VENDOR" | "OWNER_REP" | "RENTAL_VENDOR";

export interface OrgFormState {
  type: OrganizationType;
  name: string;
  address: string;
  city: string;
  state: string;
  zipCode: string;
  website: string;
  specialties: string[];
  paymentTerms: string;
  notes: string;
  crmStatus: "ACTIVE" | "PREQUALIFIED" | "COMPLIANCE_ISSUE" | "INACTIVE";
  licenseNumber: string;
  bondingCapacity: string;
  insuranceExpiration: string;
  tradeSpecialty: string;
  materialCategories: string[];
  serviceCategory: string;
  contractExpiration: string;
  equipmentCategory: string;
  rentalTerms: string;
  companyRepresented: string;
  activeProjectIds: string[];
}

interface CrmOrgDialogsProps {
  createOrgOpen: boolean;
  setCreateOrgOpen: (open: boolean) => void;
  editOrgOpen: boolean;
  setEditOrgOpen: (open: boolean) => void;
  newOrg: OrgFormState;
  setNewOrg: (org: OrgFormState) => void;
  allProjects: Project[];
  selectedOrgId: string | undefined;
  createOrgMutation: any;
  updateOrgMutation: any;
}

function OrgFormFields({ newOrg, setNewOrg, allProjects, prefix }: {
  newOrg: OrgFormState;
  setNewOrg: (o: OrgFormState) => void;
  allProjects: Project[];
  prefix: string;
}) {
  return (
    <div className="grid gap-4 py-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>Type *</Label>
          <Select value={newOrg.type} onValueChange={(v) => setNewOrg({ ...newOrg, type: v as OrganizationType })}>
            <SelectTrigger data-testid={`select-${prefix}org-type`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="CONTRACTOR">GC / Contractor</SelectItem>
              <SelectItem value="SUBCONTRACTOR">Subcontractor</SelectItem>
              <SelectItem value="SUPPLIER">Supplier</SelectItem>
              <SelectItem value="VENDOR">Vendor</SelectItem>
              <SelectItem value="RENTAL_VENDOR">Rental Vendor</SelectItem>
              <SelectItem value="OWNER_REP">Owner Rep</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>Name *</Label>
          <Input
            value={newOrg.name}
            onChange={(e) => setNewOrg({ ...newOrg, name: e.target.value })}
            placeholder="Company name"
            data-testid={`input-${prefix}org-name`}
          />
        </div>
      </div>
      <div className="space-y-2">
        <Label>Status</Label>
        <Select value={newOrg.crmStatus} onValueChange={(v) => setNewOrg({ ...newOrg, crmStatus: v as typeof newOrg.crmStatus })}>
          <SelectTrigger data-testid={`select-${prefix}org-status`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ACTIVE">Active</SelectItem>
            <SelectItem value="PREQUALIFIED">Prequalified</SelectItem>
            <SelectItem value="COMPLIANCE_ISSUE">Compliance Issue</SelectItem>
            <SelectItem value="INACTIVE">Inactive</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {(newOrg.type === "CONTRACTOR" || newOrg.type === "SUBCONTRACTOR") && (
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>License #</Label>
            <Input
              value={newOrg.licenseNumber}
              onChange={(e) => setNewOrg({ ...newOrg, licenseNumber: e.target.value })}
              placeholder="License number"
              data-testid={`input-${prefix}org-license`}
            />
          </div>
          <div className="space-y-2">
            <Label>Insurance Expiration</Label>
            <Input
              type="date"
              value={newOrg.insuranceExpiration}
              onChange={(e) => setNewOrg({ ...newOrg, insuranceExpiration: e.target.value })}
              data-testid={`input-${prefix}org-insurance-exp`}
            />
          </div>
        </div>
      )}
      {newOrg.type === "CONTRACTOR" && (
        <div className="space-y-2">
          <Label>Bonding Capacity</Label>
          <Input
            value={newOrg.bondingCapacity}
            onChange={(e) => setNewOrg({ ...newOrg, bondingCapacity: e.target.value })}
            placeholder="e.g. $5,000,000"
            data-testid={`input-${prefix}org-bonding`}
          />
        </div>
      )}
      {newOrg.type === "SUBCONTRACTOR" && (
        <div className="space-y-2">
          <Label>Trade Specialty</Label>
          <Input
            value={newOrg.tradeSpecialty}
            onChange={(e) => setNewOrg({ ...newOrg, tradeSpecialty: e.target.value })}
            placeholder="e.g. Electrical, Plumbing"
            data-testid={`input-${prefix}org-trade-specialty`}
          />
        </div>
      )}
      {newOrg.type === "SUPPLIER" && (
        <div className="space-y-2">
          <Label>Material Categories (comma-separated)</Label>
          <Input
            value={newOrg.materialCategories.join(", ")}
            onChange={(e) => setNewOrg({ ...newOrg, materialCategories: e.target.value.split(",").map(s => s.trim()).filter(Boolean) })}
            placeholder="Lumber, Concrete, Steel"
            data-testid={`input-${prefix}org-material-cats`}
          />
        </div>
      )}
      {newOrg.type === "VENDOR" && (
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Service Category</Label>
            <Input
              value={newOrg.serviceCategory}
              onChange={(e) => setNewOrg({ ...newOrg, serviceCategory: e.target.value })}
              placeholder="e.g. Waste Management"
              data-testid={`input-${prefix}org-service-cat`}
            />
          </div>
          <div className="space-y-2">
            <Label>Contract Expiration</Label>
            <Input
              type="date"
              value={newOrg.contractExpiration}
              onChange={(e) => setNewOrg({ ...newOrg, contractExpiration: e.target.value })}
              data-testid={`input-${prefix}org-contract-exp`}
            />
          </div>
        </div>
      )}
      {newOrg.type === "RENTAL_VENDOR" && (
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Equipment Category</Label>
            <Input
              value={newOrg.equipmentCategory}
              onChange={(e) => setNewOrg({ ...newOrg, equipmentCategory: e.target.value })}
              placeholder="e.g. Heavy Equipment"
              data-testid={`input-${prefix}org-equip-cat`}
            />
          </div>
          <div className="space-y-2">
            <Label>Rental Terms</Label>
            <Input
              value={newOrg.rentalTerms}
              onChange={(e) => setNewOrg({ ...newOrg, rentalTerms: e.target.value })}
              placeholder="e.g. Daily/Weekly/Monthly"
              data-testid={`input-${prefix}org-rental-terms`}
            />
          </div>
        </div>
      )}
      {newOrg.type === "RENTAL_VENDOR" && (
        <div className="space-y-2">
          <Label>Insurance Expiration</Label>
          <Input
            type="date"
            value={newOrg.insuranceExpiration}
            onChange={(e) => setNewOrg({ ...newOrg, insuranceExpiration: e.target.value })}
            data-testid={`input-${prefix}org-rental-insurance-exp`}
          />
        </div>
      )}
      {newOrg.type === "OWNER_REP" && (
        <div className="space-y-2">
          <Label>Company Represented</Label>
          <Input
            value={newOrg.companyRepresented}
            onChange={(e) => setNewOrg({ ...newOrg, companyRepresented: e.target.value })}
            placeholder="Company name they represent"
            data-testid={`input-${prefix}org-company-rep`}
          />
        </div>
      )}
      <div className="space-y-2">
        <Label>Address</Label>
        <Input
          value={newOrg.address}
          onChange={(e) => setNewOrg({ ...newOrg, address: e.target.value })}
          placeholder="Street address"
          data-testid={`input-${prefix}org-address`}
        />
      </div>
      <div className="grid grid-cols-3 gap-4">
        <div className="space-y-2">
          <Label>City</Label>
          <Input
            value={newOrg.city}
            onChange={(e) => setNewOrg({ ...newOrg, city: e.target.value })}
            placeholder="City"
            data-testid={`input-${prefix}org-city`}
          />
        </div>
        <div className="space-y-2">
          <Label>State</Label>
          <Input
            value={newOrg.state}
            onChange={(e) => setNewOrg({ ...newOrg, state: e.target.value })}
            placeholder="State"
            data-testid={`input-${prefix}org-state`}
          />
        </div>
        <div className="space-y-2">
          <Label>ZIP Code</Label>
          <Input
            value={newOrg.zipCode}
            onChange={(e) => setNewOrg({ ...newOrg, zipCode: e.target.value })}
            placeholder="ZIP"
            data-testid={`input-${prefix}org-zip`}
          />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>Website</Label>
          <Input
            value={newOrg.website}
            onChange={(e) => setNewOrg({ ...newOrg, website: e.target.value })}
            placeholder="https://..."
            data-testid={`input-${prefix}org-website`}
          />
        </div>
        <div className="space-y-2">
          <Label>Payment Terms</Label>
          <Input
            value={newOrg.paymentTerms}
            onChange={(e) => setNewOrg({ ...newOrg, paymentTerms: e.target.value })}
            placeholder="Net 30"
            data-testid={`input-${prefix}org-payment-terms`}
          />
        </div>
      </div>
      <div className="space-y-2">
        <Label>Specialties (comma-separated)</Label>
        <Input
          value={newOrg.specialties.join(", ")}
          onChange={(e) => setNewOrg({ ...newOrg, specialties: e.target.value.split(",").map(s => s.trim()).filter(Boolean) })}
          placeholder="Concrete, Excavation, Flatwork"
          data-testid={`input-${prefix}org-specialties`}
        />
      </div>
      <div className="space-y-2">
        <Label>Active on Projects</Label>
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" className="w-full justify-between font-normal" data-testid={`select-${prefix}org-projects`}>
              {newOrg.activeProjectIds.length > 0
                ? `${newOrg.activeProjectIds.length} project${newOrg.activeProjectIds.length > 1 ? "s" : ""} selected`
                : "Select projects..."}
              <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-full p-0" align="start">
            <Command>
              <CommandInput placeholder="Search projects..." />
              <CommandList>
                <CommandEmpty>No projects found.</CommandEmpty>
                <CommandGroup>
                  {allProjects.map((project) => (
                    <CommandItem
                      key={project.id}
                      value={project.name}
                      onSelect={() => {
                        const ids = newOrg.activeProjectIds.includes(project.id)
                          ? newOrg.activeProjectIds.filter(id => id !== project.id)
                          : [...newOrg.activeProjectIds, project.id];
                        setNewOrg({ ...newOrg, activeProjectIds: ids });
                      }}
                      data-testid={`option-${prefix}project-${project.id}`}
                    >
                      <Check className={cn("mr-2 h-4 w-4", newOrg.activeProjectIds.includes(project.id) ? "opacity-100" : "opacity-0")} />
                      <div className="flex flex-col">
                        <span className="text-sm">{project.name}</span>
                        <span className="text-xs text-muted-foreground">{project.code}</span>
                      </div>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
        {newOrg.activeProjectIds.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1">
            {newOrg.activeProjectIds.map(id => {
              const proj = allProjects.find(p => p.id === id);
              return proj ? (
                <Badge key={id} variant="secondary" className="gap-1 text-xs">
                  {proj.name}
                  <X className="w-3 h-3 cursor-pointer" onClick={() => setNewOrg({ ...newOrg, activeProjectIds: newOrg.activeProjectIds.filter(pid => pid !== id) })} />
                </Badge>
              ) : null;
            })}
          </div>
        )}
      </div>
      <div className="space-y-2">
        <Label>Notes</Label>
        <Textarea
          value={newOrg.notes}
          onChange={(e) => setNewOrg({ ...newOrg, notes: e.target.value })}
          placeholder="Additional notes..."
          data-testid={`input-${prefix}org-notes`}
        />
      </div>
    </div>
  );
}

export function CrmOrgDialogs({
  createOrgOpen,
  setCreateOrgOpen,
  editOrgOpen,
  setEditOrgOpen,
  newOrg,
  setNewOrg,
  allProjects,
  selectedOrgId,
  createOrgMutation,
  updateOrgMutation,
}: CrmOrgDialogsProps) {
  return (
    <>
      <Dialog open={createOrgOpen} onOpenChange={setCreateOrgOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Add New Organization</DialogTitle>
            <DialogDescription>
              Add a new contractor, subcontractor, supplier, or vendor to your CRM.
            </DialogDescription>
          </DialogHeader>
          <OrgFormFields newOrg={newOrg} setNewOrg={setNewOrg} allProjects={allProjects} prefix="" />
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOrgOpen(false)} data-testid="button-cancel-org">
              Cancel
            </Button>
            <Button
              onClick={() => createOrgMutation.mutate({...newOrg, insuranceExpiration: newOrg.insuranceExpiration ? new Date(newOrg.insuranceExpiration) : undefined, contractExpiration: newOrg.contractExpiration ? new Date(newOrg.contractExpiration) : undefined} as any)}
              disabled={!newOrg.name || createOrgMutation.isPending}
              data-testid="button-save-org"
            >
              {createOrgMutation.isPending ? "Creating..." : "Create Organization"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={editOrgOpen} onOpenChange={setEditOrgOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Organization</DialogTitle>
            <DialogDescription>
              Update organization details.
            </DialogDescription>
          </DialogHeader>
          <OrgFormFields newOrg={newOrg} setNewOrg={setNewOrg} allProjects={allProjects} prefix="edit-" />
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOrgOpen(false)} data-testid="button-cancel-edit-org">
              Cancel
            </Button>
            <Button
              onClick={() => selectedOrgId && updateOrgMutation.mutate({ id: selectedOrgId, ...newOrg, insuranceExpiration: newOrg.insuranceExpiration ? new Date(newOrg.insuranceExpiration) : undefined, contractExpiration: newOrg.contractExpiration ? new Date(newOrg.contractExpiration) : undefined } as any)}
              disabled={!newOrg.name || updateOrgMutation.isPending}
              data-testid="button-update-org"
            >
              {updateOrgMutation.isPending ? "Updating..." : "Update Organization"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
