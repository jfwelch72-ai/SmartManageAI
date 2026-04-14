import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Check, ChevronsUpDown, Building2, User, Plus, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import type { CrmOrganisation, CrmContact } from "@shared/schema";

type OrganisationType = "CONTRACTOR" | "SUBCONTRACTOR" | "SUPPLIER" | "VENDOR" | "OWNER_REP";

interface OrganisationWithContacts extends CrmOrganisation {
  contacts?: CrmContact[];
}

const TYPE_LABELS: Record<OrganisationType, string> = {
  CONTRACTOR: "GC / Contractor",
  SUBCONTRACTOR: "Subcontractor",
  SUPPLIER: "Supplier",
  VENDOR: "Vendor",
  OWNER_REP: "Owner Rep",
};

const TYPE_COLORS: Record<OrganisationType, string> = {
  CONTRACTOR: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  SUBCONTRACTOR: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  SUPPLIER: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200",
  VENDOR: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200",
  OWNER_REP: "bg-cyan-100 text-cyan-800 dark:bg-cyan-900 dark:text-cyan-200",
};

interface CrmOrganizationSelectorProps {
  value?: string;
  onSelect: (org: CrmOrganisation | null) => void;
  onContactSelect?: (contact: CrmContact | null) => void;
  filterTypes?: OrganisationType[];
  placeholder?: string;
  showContactSelector?: boolean;
  selectedContactId?: string;
  disabled?: boolean;
  className?: string;
}

export default function CrmOrganizationSelector({
  value,
  onSelect,
  onContactSelect,
  filterTypes,
  placeholder = "Select organization...",
  showContactSelector = true,
  selectedContactId,
  disabled = false,
  className,
}: CrmOrganizationSelectorProps) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [selectedOrg, setSelectedOrg] = useState<OrganisationWithContacts | null>(null);
  const [addCrmDialogOpen, setAddCrmDialogOpen] = useState(false);
  const [searchValue, setSearchValue] = useState("");
  const [newOrgData, setNewOrgData] = useState({
    name: "",
    type: filterTypes?.[0] || "CONTRACTOR" as OrganisationType,
    phone: "",
    email: "",
    city: "",
    state: "",
  });

  const { data: organizations = [] } = useQuery<CrmOrganisation[]>({
    queryKey: ["/api/crm/organisations"],
  });

  const addOrgMutation = useMutation({
    mutationFn: async (data: typeof newOrgData) => {
      const response = await apiRequest("POST", "/api/crm/organisations", {
        ...data,
        isActive: true,
      });
      return response.json();
    },
    onSuccess: (newOrg: CrmOrganisation) => {
      queryClient.invalidateQueries({ queryKey: ['/api/crm/organisations'] });
      toast({
        title: "Organization Added",
        description: `"${newOrg.name}" has been added to your CRM`,
      });
      setAddCrmDialogOpen(false);
      setNewOrgData({
        name: "",
        type: filterTypes?.[0] || "CONTRACTOR" as OrganisationType,
        phone: "",
        email: "",
        city: "",
        state: "",
      });
      handleOrgSelect(newOrg);
    },
    onError: (error: any) => {
      toast({
        title: "Failed to Add Organization",
        description: error.message || "An error occurred",
        variant: "destructive",
      });
    },
  });

  const { data: orgDetail } = useQuery<OrganisationWithContacts>({
    queryKey: ["/api/crm/organisations", selectedOrg?.id],
    enabled: !!selectedOrg?.id && showContactSelector,
  });

  const filteredOrgs = organizations.filter((org) => {
    if (!org.isActive) return false;
    if (filterTypes && filterTypes.length > 0) {
      return filterTypes.includes(org.type as OrganisationType);
    }
    return true;
  });

  useEffect(() => {
    if (value && organizations.length > 0) {
      const org = organizations.find((o) => o.name === value || o.id === value);
      if (org && (!selectedOrg || selectedOrg.id !== org.id)) {
        setSelectedOrg(org as OrganisationWithContacts);
      }
    }
  }, [value, organizations]);

  useEffect(() => {
    if (orgDetail && showContactSelector && onContactSelect) {
      const primaryContact = orgDetail.contacts?.find((c) => c.isPrimary);
      if (primaryContact && !selectedContactId) {
        onContactSelect(primaryContact);
      }
    }
  }, [orgDetail, showContactSelector, selectedContactId]);

  const handleOrgSelect = (org: CrmOrganisation) => {
    setSelectedOrg(org as OrganisationWithContacts);
    onSelect(org);
    setOpen(false);
  };

  const handleContactChange = (contactId: string) => {
    if (!orgDetail?.contacts || !onContactSelect) return;
    const contact = orgDetail.contacts.find((c) => c.id === contactId);
    onContactSelect(contact || null);
  };

  const contacts = orgDetail?.contacts || [];

  return (
    <div className={cn("space-y-2", className)}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className="w-full justify-between font-normal"
            disabled={disabled}
            data-testid="button-select-organization"
          >
            {selectedOrg ? (
              <div className="flex items-center gap-2">
                <Building2 className="w-4 h-4 text-muted-foreground" />
                <span className="truncate">{selectedOrg.name}</span>
                <Badge variant="secondary" className={cn("ml-1 text-xs", TYPE_COLORS[selectedOrg.type as OrganisationType])}>
                  {TYPE_LABELS[selectedOrg.type as OrganisationType]}
                </Badge>
              </div>
            ) : (
              <span className="text-muted-foreground">{placeholder}</span>
            )}
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[400px] p-0" align="start">
          <Command>
            <CommandInput 
              placeholder="Search organizations..." 
              data-testid="input-search-organization"
              onValueChange={setSearchValue}
            />
            <CommandList>
              <CommandEmpty>
                <div className="py-4 text-center text-sm">
                  <p className="text-muted-foreground mb-3">No organizations found.</p>
                  <Button
                    size="sm"
                    onClick={() => {
                      setNewOrgData(prev => ({ ...prev, name: searchValue }));
                      setAddCrmDialogOpen(true);
                      setOpen(false);
                    }}
                    data-testid="button-add-to-crm"
                  >
                    <Plus className="w-4 h-4 mr-1" />
                    Add to CRM
                  </Button>
                </div>
              </CommandEmpty>
              <CommandGroup>
                {filteredOrgs.map((org) => (
                  <CommandItem
                    key={org.id}
                    value={org.name}
                    onSelect={() => handleOrgSelect(org)}
                    className="flex items-center justify-between"
                    data-testid={`option-org-${org.id}`}
                  >
                    <div className="flex items-center gap-2">
                      <Check
                        className={cn(
                          "h-4 w-4",
                          selectedOrg?.id === org.id ? "opacity-100" : "opacity-0"
                        )}
                      />
                      <Building2 className="w-4 h-4 text-muted-foreground" />
                      <div className="flex flex-col">
                        <span>{org.name}</span>
                        {org.city && org.state && (
                          <span className="text-xs text-muted-foreground">
                            {org.city}, {org.state}
                          </span>
                        )}
                      </div>
                    </div>
                    <Badge variant="secondary" className={cn("text-xs", TYPE_COLORS[org.type as OrganisationType])}>
                      {TYPE_LABELS[org.type as OrganisationType]}
                    </Badge>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      {showContactSelector && selectedOrg && contacts.length > 0 && (
        <div className="flex items-center gap-2">
          <User className="w-4 h-4 text-muted-foreground" />
          <Select
            value={selectedContactId || ""}
            onValueChange={handleContactChange}
            disabled={disabled}
          >
            <SelectTrigger className="flex-1" data-testid="select-contact">
              <SelectValue placeholder="Select contact..." />
            </SelectTrigger>
            <SelectContent>
              {contacts.map((contact) => (
                <SelectItem key={contact.id} value={contact.id} data-testid={`option-contact-${contact.id}`}>
                  <div className="flex items-center gap-2">
                    <span>
                      {contact.firstName} {contact.lastName}
                    </span>
                    {contact.isPrimary && (
                      <Badge variant="secondary" className="text-xs">Primary</Badge>
                    )}
                    {contact.title && (
                      <span className="text-xs text-muted-foreground">- {contact.title}</span>
                    )}
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      <Dialog open={addCrmDialogOpen} onOpenChange={setAddCrmDialogOpen}>
        <DialogContent className="sm:max-w-md" data-testid="dialog-add-to-crm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Building2 className="w-5 h-5" />
              Add Organization to CRM
            </DialogTitle>
            <DialogDescription>
              Add a new organization to your CRM for easy reference in future forms.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="org-name">Organization Name *</Label>
              <Input
                id="org-name"
                value={newOrgData.name}
                onChange={(e) => setNewOrgData(prev => ({ ...prev, name: e.target.value }))}
                placeholder="Company name"
                data-testid="input-new-org-name"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="org-type">Type *</Label>
              <Select
                value={newOrgData.type}
                onValueChange={(value) => setNewOrgData(prev => ({ ...prev, type: value as OrganisationType }))}
              >
                <SelectTrigger id="org-type" data-testid="select-new-org-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(filterTypes || Object.keys(TYPE_LABELS) as OrganisationType[]).map((type) => (
                    <SelectItem key={type} value={type}>
                      {TYPE_LABELS[type]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="org-phone">Phone</Label>
                <Input
                  id="org-phone"
                  value={newOrgData.phone}
                  onChange={(e) => setNewOrgData(prev => ({ ...prev, phone: e.target.value }))}
                  placeholder="(555) 123-4567"
                  data-testid="input-new-org-phone"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="org-email">Email</Label>
                <Input
                  id="org-email"
                  type="email"
                  value={newOrgData.email}
                  onChange={(e) => setNewOrgData(prev => ({ ...prev, email: e.target.value }))}
                  placeholder="contact@company.com"
                  data-testid="input-new-org-email"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="org-city">City</Label>
                <Input
                  id="org-city"
                  value={newOrgData.city}
                  onChange={(e) => setNewOrgData(prev => ({ ...prev, city: e.target.value }))}
                  placeholder="City"
                  data-testid="input-new-org-city"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="org-state">State</Label>
                <Input
                  id="org-state"
                  value={newOrgData.state}
                  onChange={(e) => setNewOrgData(prev => ({ ...prev, state: e.target.value }))}
                  placeholder="State"
                  maxLength={2}
                  data-testid="input-new-org-state"
                />
              </div>
            </div>
          </div>

          <DialogFooter className="flex-row gap-2 justify-end">
            <Button
              variant="outline"
              onClick={() => setAddCrmDialogOpen(false)}
              data-testid="button-cancel-add-org"
            >
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (!newOrgData.name?.trim()) {
                  toast({
                    title: "Name Required",
                    description: "Please enter an organization name",
                    variant: "destructive",
                  });
                  return;
                }
                if (!newOrgData.type) {
                  toast({
                    title: "Type Required",
                    description: "Please select an organization type",
                    variant: "destructive",
                  });
                  return;
                }
                addOrgMutation.mutate({
                  ...newOrgData,
                  name: newOrgData.name.trim(),
                });
              }}
              disabled={!newOrgData.name?.trim() || addOrgMutation.isPending}
              data-testid="button-confirm-add-org"
            >
              {addOrgMutation.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Adding...
                </>
              ) : (
                <>
                  <Plus className="w-4 h-4 mr-2" />
                  Add Organization
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
