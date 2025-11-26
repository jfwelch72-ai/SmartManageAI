import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, ChevronsUpDown, Building2, User } from "lucide-react";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
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
  const [open, setOpen] = useState(false);
  const [selectedOrg, setSelectedOrg] = useState<OrganisationWithContacts | null>(null);

  const { data: organizations = [] } = useQuery<CrmOrganisation[]>({
    queryKey: ["/api/crm/organisations"],
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
            <CommandInput placeholder="Search organizations..." data-testid="input-search-organization" />
            <CommandList>
              <CommandEmpty>
                <div className="py-6 text-center text-sm text-muted-foreground">
                  No organizations found.
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
    </div>
  );
}
