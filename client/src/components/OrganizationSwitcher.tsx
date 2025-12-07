import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Building2, Check, ChevronDown, Loader2 } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface Organization {
  id: string;
  organizationId: string;
  roleOverride: string | null;
  isActive: boolean;
  createdAt: string;
  organization: {
    id: string;
    name: string;
    slug: string;
    tradeType: string;
    tradeName: string | null;
    logoUrl: string | null;
    primaryColor: string | null;
    region: string | null;
  };
}

interface HustlerOrganizationsResponse {
  organizations: Organization[];
  currentOrganizationId: string | null;
  count: number;
}

export function OrganizationSwitcher() {
  const { toast } = useToast();
  const [isOpen, setIsOpen] = useState(false);

  const { data, isLoading, error } = useQuery<HustlerOrganizationsResponse>({
    queryKey: ["/api/hustler/organizations"],
    retry: false,
    staleTime: 30000,
  });

  const switchMutation = useMutation({
    mutationFn: async (organizationId: string) => {
      const response = await apiRequest("POST", "/api/hustler/switch-organization", {
        organizationId,
      });
      return response.json();
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries();
      toast({
        title: "Organization Switched",
        description: result.message || "Successfully switched organization",
      });
      setIsOpen(false);
      window.location.reload();
    },
    onError: (error: any) => {
      toast({
        title: "Switch Failed",
        description: error.message || "Failed to switch organization",
        variant: "destructive",
      });
    },
  });

  if (error || !data) {
    return null;
  }

  if (isLoading) {
    return (
      <Button variant="ghost" size="sm" disabled>
        <Loader2 className="h-4 w-4 animate-spin" />
      </Button>
    );
  }

  if (data.count <= 1) {
    return null;
  }

  const currentOrg = data.organizations.find(
    (org) => org.organizationId === data.currentOrganizationId
  );

  return (
    <DropdownMenu open={isOpen} onOpenChange={setIsOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="gap-2 max-w-[200px]"
          data-testid="button-org-switcher"
        >
          <Building2 className="h-4 w-4 shrink-0" />
          <span className="truncate">
            {currentOrg?.organization.name || "Select Organization"}
          </span>
          <ChevronDown className="h-4 w-4 shrink-0" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[250px]">
        <DropdownMenuLabel>Switch Organization</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {data.organizations.map((org) => (
          <DropdownMenuItem
            key={org.organizationId}
            onClick={() => {
              if (org.organizationId !== data.currentOrganizationId) {
                switchMutation.mutate(org.organizationId);
              }
            }}
            className="gap-2 cursor-pointer"
            data-testid={`menu-item-org-${org.organizationId}`}
          >
            <div className="flex-1 min-w-0">
              <div className="font-medium truncate">{org.organization.name}</div>
              <div className="text-xs text-muted-foreground truncate">
                {org.organization.tradeName || org.organization.tradeType}
              </div>
            </div>
            {org.organizationId === data.currentOrganizationId && (
              <Check className="h-4 w-4 shrink-0 text-primary" />
            )}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
