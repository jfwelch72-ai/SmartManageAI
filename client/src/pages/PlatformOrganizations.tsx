import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Building2, Users, Search, ExternalLink, ChevronLeft, Plus } from "lucide-react";
import { Link } from "wouter";
import { format } from "date-fns";
import { useAuth } from "@/hooks/use-auth";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface Organization {
  id: string;
  name: string;
  slug: string;
  tradeType: string;
  tradeName: string | null;
  onboardingStatus: string;
  isActive: boolean;
  region: string | null;
  typicalCrewSize: number | null;
  websiteUrl: string | null;
  createdAt: string;
  userCount: number;
}

export default function PlatformOrganizations() {
  const { user, logout, organizationName } = useAuth();
  const { toast } = useToast();
  const [searchTerm, setSearchTerm] = useState("");
  const [tradeFilter, setTradeFilter] = useState<string>("all");
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [newOrgName, setNewOrgName] = useState("");
  const [newOrgSlug, setNewOrgSlug] = useState("");
  const [newOrgTradeType, setNewOrgTradeType] = useState("GENERAL_CONTRACTOR");
  const [newOrgRegion, setNewOrgRegion] = useState("");
  const [newOrgEmail, setNewOrgEmail] = useState("");
  const [newOrgPhone, setNewOrgPhone] = useState("");

  const generateSlug = (name: string) => {
    return name.trim().toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  };

  const createOrgMutation = useMutation({
    mutationFn: async (data: { name: string; slug: string; tradeType: string; region: string; email: string; phone: string }) => {
      const res = await apiRequest("POST", "/api/platform/organizations", data);
      return await res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/platform/organizations"] });
      setCreateDialogOpen(false);
      setNewOrgName("");
      setNewOrgSlug("");
      setNewOrgTradeType("GENERAL_CONTRACTOR");
      setNewOrgRegion("");
      setNewOrgEmail("");
      setNewOrgPhone("");
      toast({ title: "Organization created", description: "The new organization has been created successfully." });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to create organization", description: error.message, variant: "destructive" });
    },
  });

  const { data: organizations, isLoading } = useQuery<Organization[]>({
    queryKey: ["/api/platform/organizations"],
  });

  const userName = user ? `${user.firstName} ${user.lastName}` : "Admin";
  const userRole = user?.role || "SUPER_ADMIN";

  const tradeTypeLabels: Record<string, string> = {
    GENERAL_CONTRACTOR: "General Contractor",
    ROOFING: "Roofing",
    ELECTRICAL: "Electrical",
    PLUMBING: "Plumbing",
    HVAC: "HVAC",
    CONCRETE: "Concrete",
    CARPENTRY: "Carpentry",
    MASONRY: "Masonry",
    DRYWALL: "Drywall",
    PAINTING: "Painting",
    FLOORING: "Flooring",
    LANDSCAPING: "Landscaping",
    EXCAVATION: "Excavation",
    DEMOLITION: "Demolition",
    STEEL_ERECTION: "Steel Erection",
    GLAZING: "Glazing",
    INSULATION: "Insulation",
    FIRE_PROTECTION: "Fire Protection",
    WATERPROOFING: "Waterproofing",
    OTHER: "Other",
  };

  const filteredOrganizations = organizations?.filter((org) => {
    const matchesSearch = org.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      org.slug.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesTrade = tradeFilter === "all" || org.tradeType === tradeFilter;
    return matchesSearch && matchesTrade;
  });

  const uniqueTrades = Array.from(new Set(organizations?.map((org) => org.tradeType) || []));

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "COMPLETED":
        return <Badge variant="default">Active</Badge>;
      case "IN_PROGRESS":
        return <Badge variant="secondary">Onboarding</Badge>;
      default:
        return <Badge variant="outline">Not Started</Badge>;
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <main className="px-3 sm:px-6 py-4 sm:py-6 space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4">
          <Link href="/admin">
            <Button variant="ghost" size="sm">
              <ChevronLeft className="h-4 w-4 mr-1" />
              Back
            </Button>
          </Link>
          <div className="flex-1">
            <h1 className="text-xl sm:text-2xl font-bold" data-testid="text-organizations-title">Organizations</h1>
            <p className="text-muted-foreground text-sm">Manage all contractor companies on the platform</p>
          </div>
          <Button onClick={() => setCreateDialogOpen(true)} className="w-full sm:w-auto" data-testid="button-create-org">
            <Plus className="h-4 w-4 mr-2" />
            Create Organization
          </Button>
        </div>

        <Card>
        <CardHeader>
          <div className="flex flex-col md:flex-row gap-4 justify-between">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search organizations..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-9"
                data-testid="input-search-orgs"
              />
            </div>
            <Select value={tradeFilter} onValueChange={setTradeFilter}>
              <SelectTrigger className="w-full sm:w-[200px]" data-testid="select-trade-filter">
                <SelectValue placeholder="Filter by trade" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Trades</SelectItem>
                {uniqueTrades.map((trade) => (
                  <SelectItem key={trade} value={trade}>
                    {tradeTypeLabels[trade] || trade}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-4">
              {[1, 2, 3, 4, 5].map((i) => (
                <Skeleton key={i} className="h-16 w-full" />
              ))}
            </div>
          ) : (
            <div className="overflow-x-auto -mx-3 sm:-mx-6 px-3 sm:px-6">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Organization</TableHead>
                  <TableHead>Trade</TableHead>
                  <TableHead>Users</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Region</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredOrganizations?.map((org) => (
                  <TableRow key={org.id} data-testid={`row-org-${org.id}`}>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <div className="h-10 w-10 rounded-md bg-primary/10 flex items-center justify-center">
                          <Building2 className="h-5 w-5 text-primary" />
                        </div>
                        <div>
                          <div className="font-medium">{org.name}</div>
                          <div className="text-sm text-muted-foreground">{org.slug}</div>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">
                        {tradeTypeLabels[org.tradeType] || org.tradeType}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <Users className="h-4 w-4 text-muted-foreground" />
                        <span>{org.userCount}</span>
                      </div>
                    </TableCell>
                    <TableCell>{getStatusBadge(org.onboardingStatus)}</TableCell>
                    <TableCell>{org.region || "-"}</TableCell>
                    <TableCell>
                      {format(new Date(org.createdAt), "MMM d, yyyy")}
                    </TableCell>
                    <TableCell>
                      <Link href={`/admin/organizations/${org.id}`}>
                        <Button variant="ghost" size="sm" data-testid={`button-view-org-${org.id}`}>
                          View <ExternalLink className="ml-1 h-3 w-3" />
                        </Button>
                      </Link>
                    </TableCell>
                  </TableRow>
                ))}
                {filteredOrganizations?.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                      No organizations found
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
            </div>
          )}
        </CardContent>
      </Card>
      </main>

      <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Create Organization</DialogTitle>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              createOrgMutation.mutate({
                name: newOrgName,
                slug: newOrgSlug || generateSlug(newOrgName),
                tradeType: newOrgTradeType,
                region: newOrgRegion,
                email: newOrgEmail,
                phone: newOrgPhone,
              });
            }}
            className="space-y-4"
          >
            <div className="space-y-2">
              <Label htmlFor="org-name">Name *</Label>
              <Input
                id="org-name"
                value={newOrgName}
                onChange={(e) => {
                  setNewOrgName(e.target.value);
                  if (!newOrgSlug || newOrgSlug === generateSlug(newOrgName)) {
                    setNewOrgSlug(generateSlug(e.target.value));
                  }
                }}
                placeholder="Acme Construction"
                required
                data-testid="input-org-name"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="org-slug">Slug</Label>
              <Input
                id="org-slug"
                value={newOrgSlug}
                onChange={(e) => setNewOrgSlug(e.target.value)}
                placeholder="acme-construction"
                data-testid="input-org-slug"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="org-trade">Trade Type</Label>
              <Select value={newOrgTradeType} onValueChange={setNewOrgTradeType}>
                <SelectTrigger data-testid="select-org-trade">
                  <SelectValue placeholder="Select trade type" />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(tradeTypeLabels).map(([key, label]) => (
                    <SelectItem key={key} value={key}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="org-region">Region</Label>
              <Input
                id="org-region"
                value={newOrgRegion}
                onChange={(e) => setNewOrgRegion(e.target.value)}
                placeholder="Northeast US"
                data-testid="input-org-region"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="org-email">Email</Label>
              <Input
                id="org-email"
                type="email"
                value={newOrgEmail}
                onChange={(e) => setNewOrgEmail(e.target.value)}
                placeholder="info@acme.com"
                data-testid="input-org-email"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="org-phone">Phone</Label>
              <Input
                id="org-phone"
                value={newOrgPhone}
                onChange={(e) => setNewOrgPhone(e.target.value)}
                placeholder="(555) 123-4567"
                data-testid="input-org-phone"
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setCreateDialogOpen(false)} data-testid="button-cancel-create-org">
                Cancel
              </Button>
              <Button type="submit" disabled={!newOrgName.trim() || createOrgMutation.isPending} data-testid="button-submit-create-org">
                {createOrgMutation.isPending ? "Creating..." : "Create"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
