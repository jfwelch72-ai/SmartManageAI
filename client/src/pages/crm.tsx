import { useState } from "react";
import AppHeader from "@/components/AppHeader";
import { useAuth } from "@/hooks/use-auth";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { 
  Building2, 
  Users, 
  Plus,
  Search,
  Edit,
  Trash2,
  User,
  Phone,
  Mail,
  MapPin,
  Globe,
  Shield,
  FileText,
  ChevronRight,
  AlertCircle,
  X
} from "lucide-react";
import type { CrmOrganisation as CrmOrganization, CrmContact } from "@shared/schema";

type OrganizationType = "CONTRACTOR" | "SUBCONTRACTOR" | "SUPPLIER" | "VENDOR";
type ContactRole = "PM" | "ESTIMATOR" | "SUPERINTENDENT" | "SALES" | "ACCOUNTS_PAYABLE" | "ACCOUNTS_RECEIVABLE" | "OWNER" | "GENERAL_MANAGER" | "FOREMAN" | "OTHER";

interface OrganizationWithContacts extends CrmOrganization {
  contacts: CrmContact[];
}

const TYPE_LABELS: Record<OrganizationType, string> = {
  CONTRACTOR: "Contractor",
  SUBCONTRACTOR: "Subcontractor",
  SUPPLIER: "Supplier",
  VENDOR: "Vendor",
};

const TYPE_COLORS: Record<OrganizationType, string> = {
  CONTRACTOR: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  SUBCONTRACTOR: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  SUPPLIER: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200",
  VENDOR: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200",
};

const ROLE_LABELS: Record<ContactRole, string> = {
  PM: "Project Manager",
  ESTIMATOR: "Estimator",
  SUPERINTENDENT: "Superintendent",
  SALES: "Sales",
  ACCOUNTS_PAYABLE: "Accounts Payable",
  ACCOUNTS_RECEIVABLE: "Accounts Receivable",
  OWNER: "Owner",
  GENERAL_MANAGER: "General Manager",
  FOREMAN: "Foreman",
  OTHER: "Other",
};

export default function CRMPage() {
  const { user, logout } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedType, setSelectedType] = useState<string>("all");
  const [activeTab, setActiveTab] = useState<"organizations" | "contacts">("organizations");
  
  const [createOrgOpen, setCreateOrgOpen] = useState(false);
  const [editOrgOpen, setEditOrgOpen] = useState(false);
  const [detailOrgOpen, setDetailOrgOpen] = useState(false);
  const [selectedOrg, setSelectedOrg] = useState<OrganizationWithContacts | null>(null);
  
  const [createContactOpen, setCreateContactOpen] = useState(false);
  const [editContactOpen, setEditContactOpen] = useState(false);
  const [viewContactOpen, setViewContactOpen] = useState(false);
  const [selectedContact, setSelectedContact] = useState<CrmContact | null>(null);
  
  const [newOrg, setNewOrg] = useState({
    type: "SUBCONTRACTOR" as OrganizationType,
    name: "",
    address: "",
    city: "",
    state: "",
    zipCode: "",
    website: "",
    specialties: [] as string[],
    paymentTerms: "",
    notes: "",
  });
  
  const [newContact, setNewContact] = useState({
    firstName: "",
    lastName: "",
    title: "",
    role: "OTHER" as ContactRole,
    email: "",
    phone: "",
    mobile: "",
    isPrimary: false,
    notes: "",
  });
  
  const { data: organizations, isLoading: orgsLoading } = useQuery<CrmOrganization[]>({
    queryKey: ["/api/crm/organisations"],
  });
  
  const { data: orgDetail, isLoading: orgDetailLoading } = useQuery<OrganizationWithContacts>({
    queryKey: ["/api/crm/organisations", selectedOrg?.id],
    enabled: !!selectedOrg?.id && detailOrgOpen,
  });

  const createOrgMutation = useMutation({
    mutationFn: async (data: typeof newOrg) => {
      return apiRequest("POST", "/api/crm/organisations", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/crm/organisations"] });
      toast({ title: "Organization created successfully" });
      setCreateOrgOpen(false);
      resetNewOrg();
    },
    onError: (err: any) => {
      toast({ title: "Failed to create organization", description: err.message, variant: "destructive" });
    },
  });
  
  const updateOrgMutation = useMutation({
    mutationFn: async (data: Partial<typeof newOrg> & { id: string }) => {
      const { id, ...rest } = data;
      return apiRequest("PUT", `/api/crm/organisations/${id}`, rest);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/crm/organisations"] });
      toast({ title: "Organization updated successfully" });
      setEditOrgOpen(false);
    },
    onError: (err: any) => {
      toast({ title: "Failed to update organization", description: err.message, variant: "destructive" });
    },
  });
  
  const deleteOrgMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest("DELETE", `/api/crm/organisations/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/crm/organisations"] });
      toast({ title: "Organization deleted successfully" });
      setDetailOrgOpen(false);
      setSelectedOrg(null);
    },
    onError: (err: any) => {
      toast({ title: "Failed to delete organization", description: err.message, variant: "destructive" });
    },
  });
  
  const createContactMutation = useMutation({
    mutationFn: async (data: typeof newContact & { organisationId: string }) => {
      return apiRequest("POST", "/api/crm/contacts", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/crm/organisations", selectedOrg?.id] });
      toast({ title: "Contact created successfully" });
      setCreateContactOpen(false);
      resetNewContact();
    },
    onError: (err: any) => {
      toast({ title: "Failed to create contact", description: err.message, variant: "destructive" });
    },
  });
  
  const updateContactMutation = useMutation({
    mutationFn: async (data: Partial<typeof newContact> & { id: string }) => {
      const { id, ...rest } = data;
      return apiRequest("PUT", `/api/crm/contacts/${id}`, rest);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/crm/organisations", selectedOrg?.id] });
      toast({ title: "Contact updated successfully" });
      setEditContactOpen(false);
    },
    onError: (err: any) => {
      toast({ title: "Failed to update contact", description: err.message, variant: "destructive" });
    },
  });
  
  const deleteContactMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest("DELETE", `/api/crm/contacts/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/crm/organisations", selectedOrg?.id] });
      toast({ title: "Contact deleted successfully" });
    },
    onError: (err: any) => {
      toast({ title: "Failed to delete contact", description: err.message, variant: "destructive" });
    },
  });
  
  const resetNewOrg = () => {
    setNewOrg({
      type: "SUBCONTRACTOR",
      name: "",
      address: "",
      city: "",
      state: "",
      zipCode: "",
      website: "",
      specialties: [],
      paymentTerms: "",
      notes: "",
    });
  };
  
  const resetNewContact = () => {
    setNewContact({
      firstName: "",
      lastName: "",
      title: "",
      role: "OTHER",
      email: "",
      phone: "",
      mobile: "",
      isPrimary: false,
      notes: "",
    });
  };
  
  const filteredOrganizations = organizations?.filter((org) => {
    const matchesSearch = org.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      org.city?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      org.state?.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesType = selectedType === "all" || org.type === selectedType;
    return matchesSearch && matchesType && org.isActive;
  }) || [];
  
  const orgCounts = {
    total: organizations?.filter(o => o.isActive).length || 0,
    contractors: organizations?.filter(o => o.type === "CONTRACTOR" && o.isActive).length || 0,
    subcontractors: organizations?.filter(o => o.type === "SUBCONTRACTOR" && o.isActive).length || 0,
    suppliers: organizations?.filter(o => o.type === "SUPPLIER" && o.isActive).length || 0,
    vendors: organizations?.filter(o => o.type === "VENDOR" && o.isActive).length || 0,
  };

  const openOrgDetail = (org: CrmOrganization) => {
    setSelectedOrg(org as OrganizationWithContacts);
    setDetailOrgOpen(true);
  };
  
  const openEditOrg = (org: CrmOrganization) => {
    setNewOrg({
      type: org.type as OrganizationType,
      name: org.name,
      address: org.address || "",
      city: org.city || "",
      state: org.state || "",
      zipCode: org.zipCode || "",
      website: org.website || "",
      specialties: org.specialties || [],
      paymentTerms: org.paymentTerms || "",
      notes: org.notes || "",
    });
    setSelectedOrg(org as OrganizationWithContacts);
    setEditOrgOpen(true);
  };
  
  const openEditContact = (contact: CrmContact) => {
    setNewContact({
      firstName: contact.firstName,
      lastName: contact.lastName,
      title: contact.title || "",
      role: contact.role as ContactRole,
      email: contact.email || "",
      phone: contact.phone || "",
      mobile: contact.mobile || "",
      isPrimary: contact.isPrimary,
      notes: contact.notes || "",
    });
    setSelectedContact(contact);
    setEditContactOpen(true);
  };

  if (!user) return null;

  return (
    <div className="flex flex-col min-h-screen bg-background">
      <AppHeader userName={`${user.firstName || ""} ${user.lastName || ""}`.trim() || "User"} userRole={user.role} onLogout={logout} />
      
      <main className="flex-1 container mx-auto px-4 py-6">
        <div className="flex flex-col gap-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold text-foreground" data-testid="text-page-title">
                Customer Relationship Management
              </h1>
              <p className="text-muted-foreground">
                Manage contractors, subcontractors, suppliers, and vendors
              </p>
            </div>
            <Button onClick={() => setCreateOrgOpen(true)} data-testid="button-add-organization">
              <Plus className="w-4 h-4 mr-2" />
              Add Organization
            </Button>
          </div>
          
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            <Card className="hover-elevate cursor-pointer" onClick={() => setSelectedType("all")} data-testid="card-total-count">
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-md bg-primary/10">
                    <Building2 className="w-5 h-5 text-primary" />
                  </div>
                  <div>
                    <p className="text-2xl font-bold">{orgCounts.total}</p>
                    <p className="text-sm text-muted-foreground">Total</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card className="hover-elevate cursor-pointer" onClick={() => setSelectedType("CONTRACTOR")} data-testid="card-contractor-count">
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-md bg-blue-100 dark:bg-blue-900">
                    <Building2 className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                  </div>
                  <div>
                    <p className="text-2xl font-bold">{orgCounts.contractors}</p>
                    <p className="text-sm text-muted-foreground">Contractors</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card className="hover-elevate cursor-pointer" onClick={() => setSelectedType("SUBCONTRACTOR")} data-testid="card-subcontractor-count">
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-md bg-green-100 dark:bg-green-900">
                    <Users className="w-5 h-5 text-green-600 dark:text-green-400" />
                  </div>
                  <div>
                    <p className="text-2xl font-bold">{orgCounts.subcontractors}</p>
                    <p className="text-sm text-muted-foreground">Subcontractors</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card className="hover-elevate cursor-pointer" onClick={() => setSelectedType("SUPPLIER")} data-testid="card-supplier-count">
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-md bg-purple-100 dark:bg-purple-900">
                    <Building2 className="w-5 h-5 text-purple-600 dark:text-purple-400" />
                  </div>
                  <div>
                    <p className="text-2xl font-bold">{orgCounts.suppliers}</p>
                    <p className="text-sm text-muted-foreground">Suppliers</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card className="hover-elevate cursor-pointer" onClick={() => setSelectedType("VENDOR")} data-testid="card-vendor-count">
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-md bg-orange-100 dark:bg-orange-900">
                    <Building2 className="w-5 h-5 text-orange-600 dark:text-orange-400" />
                  </div>
                  <div>
                    <p className="text-2xl font-bold">{orgCounts.vendors}</p>
                    <p className="text-sm text-muted-foreground">Vendors</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
          
          <Card>
            <CardHeader className="pb-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <CardTitle>Organizations</CardTitle>
                <div className="flex items-center gap-2 flex-wrap">
                  <div className="relative flex-1 min-w-[200px]">
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input
                      placeholder="Search organizations..."
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      className="pl-9"
                      data-testid="input-search"
                    />
                  </div>
                  <Select value={selectedType} onValueChange={setSelectedType}>
                    <SelectTrigger className="w-[160px]" data-testid="select-type-filter">
                      <SelectValue placeholder="Filter by type" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Types</SelectItem>
                      <SelectItem value="CONTRACTOR">Contractors</SelectItem>
                      <SelectItem value="SUBCONTRACTOR">Subcontractors</SelectItem>
                      <SelectItem value="SUPPLIER">Suppliers</SelectItem>
                      <SelectItem value="VENDOR">Vendors</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {orgsLoading ? (
                <div className="space-y-4">
                  {[1, 2, 3, 4, 5].map((i) => (
                    <Skeleton key={i} className="h-16 w-full" />
                  ))}
                </div>
              ) : filteredOrganizations.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                  <Building2 className="w-12 h-12 mx-auto mb-4 opacity-50" />
                  <p>No organizations found</p>
                  <p className="text-sm">Try adjusting your search or filters</p>
                </div>
              ) : (
                <ScrollArea className="h-[500px]">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Name</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead>Location</TableHead>
                        <TableHead>Specialties</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredOrganizations.map((org) => (
                        <TableRow 
                          key={org.id} 
                          className="cursor-pointer hover-elevate"
                          onClick={() => openOrgDetail(org)}
                          data-testid={`row-org-${org.id}`}
                        >
                          <TableCell className="font-medium">{org.name}</TableCell>
                          <TableCell>
                            <Badge className={TYPE_COLORS[org.type as OrganizationType]}>
                              {TYPE_LABELS[org.type as OrganizationType]}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {org.city && org.state ? `${org.city}, ${org.state}` : org.city || org.state || "-"}
                          </TableCell>
                          <TableCell>
                            <div className="flex flex-wrap gap-1">
                              {org.specialties?.slice(0, 3).map((s, i) => (
                                <Badge key={i} variant="outline" className="text-xs">{s}</Badge>
                              ))}
                              {(org.specialties?.length || 0) > 3 && (
                                <Badge variant="outline" className="text-xs">+{(org.specialties?.length || 0) - 3}</Badge>
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex items-center justify-end gap-1">
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  openEditOrg(org);
                                }}
                                data-testid={`button-edit-org-${org.id}`}
                              >
                                <Edit className="w-4 h-4" />
                              </Button>
                              <ChevronRight className="w-4 h-4 text-muted-foreground" />
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </ScrollArea>
              )}
            </CardContent>
          </Card>
        </div>
      </main>
      
      <Dialog open={createOrgOpen} onOpenChange={setCreateOrgOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Add New Organization</DialogTitle>
            <DialogDescription>
              Add a new contractor, subcontractor, supplier, or vendor to your CRM.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Type *</Label>
                <Select value={newOrg.type} onValueChange={(v) => setNewOrg({ ...newOrg, type: v as OrganizationType })}>
                  <SelectTrigger data-testid="select-org-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="CONTRACTOR">Contractor</SelectItem>
                    <SelectItem value="SUBCONTRACTOR">Subcontractor</SelectItem>
                    <SelectItem value="SUPPLIER">Supplier</SelectItem>
                    <SelectItem value="VENDOR">Vendor</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Name *</Label>
                <Input
                  value={newOrg.name}
                  onChange={(e) => setNewOrg({ ...newOrg, name: e.target.value })}
                  placeholder="Company name"
                  data-testid="input-org-name"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Address</Label>
              <Input
                value={newOrg.address}
                onChange={(e) => setNewOrg({ ...newOrg, address: e.target.value })}
                placeholder="Street address"
                data-testid="input-org-address"
              />
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label>City</Label>
                <Input
                  value={newOrg.city}
                  onChange={(e) => setNewOrg({ ...newOrg, city: e.target.value })}
                  placeholder="City"
                  data-testid="input-org-city"
                />
              </div>
              <div className="space-y-2">
                <Label>State</Label>
                <Input
                  value={newOrg.state}
                  onChange={(e) => setNewOrg({ ...newOrg, state: e.target.value })}
                  placeholder="State"
                  data-testid="input-org-state"
                />
              </div>
              <div className="space-y-2">
                <Label>ZIP Code</Label>
                <Input
                  value={newOrg.zipCode}
                  onChange={(e) => setNewOrg({ ...newOrg, zipCode: e.target.value })}
                  placeholder="ZIP"
                  data-testid="input-org-zip"
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
                  data-testid="input-org-website"
                />
              </div>
              <div className="space-y-2">
                <Label>Payment Terms</Label>
                <Input
                  value={newOrg.paymentTerms}
                  onChange={(e) => setNewOrg({ ...newOrg, paymentTerms: e.target.value })}
                  placeholder="Net 30"
                  data-testid="input-org-payment-terms"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Specialties (comma-separated)</Label>
              <Input
                value={newOrg.specialties.join(", ")}
                onChange={(e) => setNewOrg({ ...newOrg, specialties: e.target.value.split(",").map(s => s.trim()).filter(Boolean) })}
                placeholder="Concrete, Excavation, Flatwork"
                data-testid="input-org-specialties"
              />
            </div>
            <div className="space-y-2">
              <Label>Notes</Label>
              <Textarea
                value={newOrg.notes}
                onChange={(e) => setNewOrg({ ...newOrg, notes: e.target.value })}
                placeholder="Additional notes..."
                data-testid="input-org-notes"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOrgOpen(false)} data-testid="button-cancel-org">
              Cancel
            </Button>
            <Button
              onClick={() => createOrgMutation.mutate(newOrg)}
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
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Type *</Label>
                <Select value={newOrg.type} onValueChange={(v) => setNewOrg({ ...newOrg, type: v as OrganizationType })}>
                  <SelectTrigger data-testid="select-edit-org-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="CONTRACTOR">Contractor</SelectItem>
                    <SelectItem value="SUBCONTRACTOR">Subcontractor</SelectItem>
                    <SelectItem value="SUPPLIER">Supplier</SelectItem>
                    <SelectItem value="VENDOR">Vendor</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Name *</Label>
                <Input
                  value={newOrg.name}
                  onChange={(e) => setNewOrg({ ...newOrg, name: e.target.value })}
                  placeholder="Company name"
                  data-testid="input-edit-org-name"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Address</Label>
              <Input
                value={newOrg.address}
                onChange={(e) => setNewOrg({ ...newOrg, address: e.target.value })}
                placeholder="Street address"
                data-testid="input-edit-org-address"
              />
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label>City</Label>
                <Input
                  value={newOrg.city}
                  onChange={(e) => setNewOrg({ ...newOrg, city: e.target.value })}
                  placeholder="City"
                  data-testid="input-edit-org-city"
                />
              </div>
              <div className="space-y-2">
                <Label>State</Label>
                <Input
                  value={newOrg.state}
                  onChange={(e) => setNewOrg({ ...newOrg, state: e.target.value })}
                  placeholder="State"
                  data-testid="input-edit-org-state"
                />
              </div>
              <div className="space-y-2">
                <Label>ZIP Code</Label>
                <Input
                  value={newOrg.zipCode}
                  onChange={(e) => setNewOrg({ ...newOrg, zipCode: e.target.value })}
                  placeholder="ZIP"
                  data-testid="input-edit-org-zip"
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
                  data-testid="input-edit-org-website"
                />
              </div>
              <div className="space-y-2">
                <Label>Payment Terms</Label>
                <Input
                  value={newOrg.paymentTerms}
                  onChange={(e) => setNewOrg({ ...newOrg, paymentTerms: e.target.value })}
                  placeholder="Net 30"
                  data-testid="input-edit-org-payment-terms"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Specialties (comma-separated)</Label>
              <Input
                value={newOrg.specialties.join(", ")}
                onChange={(e) => setNewOrg({ ...newOrg, specialties: e.target.value.split(",").map(s => s.trim()).filter(Boolean) })}
                placeholder="Concrete, Excavation, Flatwork"
                data-testid="input-edit-org-specialties"
              />
            </div>
            <div className="space-y-2">
              <Label>Notes</Label>
              <Textarea
                value={newOrg.notes}
                onChange={(e) => setNewOrg({ ...newOrg, notes: e.target.value })}
                placeholder="Additional notes..."
                data-testid="input-edit-org-notes"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOrgOpen(false)} data-testid="button-cancel-edit-org">
              Cancel
            </Button>
            <Button
              onClick={() => selectedOrg && updateOrgMutation.mutate({ id: selectedOrg.id, ...newOrg })}
              disabled={!newOrg.name || updateOrgMutation.isPending}
              data-testid="button-update-org"
            >
              {updateOrgMutation.isPending ? "Updating..." : "Update Organization"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      
      <Dialog open={detailOrgOpen} onOpenChange={setDetailOrgOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <div className="flex items-start justify-between gap-4">
              <div>
                <DialogTitle className="text-xl">{selectedOrg?.name}</DialogTitle>
                <DialogDescription className="mt-1">
                  <Badge className={TYPE_COLORS[(selectedOrg?.type || "SUBCONTRACTOR") as OrganizationType]}>
                    {TYPE_LABELS[(selectedOrg?.type || "SUBCONTRACTOR") as OrganizationType]}
                  </Badge>
                </DialogDescription>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={() => selectedOrg && openEditOrg(selectedOrg)} data-testid="button-edit-org-detail">
                  <Edit className="w-4 h-4 mr-1" />
                  Edit
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => selectedOrg && deleteOrgMutation.mutate(selectedOrg.id)}
                  disabled={deleteOrgMutation.isPending}
                  data-testid="button-delete-org"
                >
                  <Trash2 className="w-4 h-4 mr-1" />
                  Delete
                </Button>
              </div>
            </div>
          </DialogHeader>
          
          <Tabs defaultValue="info" className="mt-4">
            <TabsList>
              <TabsTrigger value="info">Organization Info</TabsTrigger>
              <TabsTrigger value="contacts">
                Contacts ({orgDetail?.contacts?.length || 0})
              </TabsTrigger>
            </TabsList>
            
            <TabsContent value="info" className="space-y-4 mt-4">
              <div className="grid grid-cols-2 gap-4">
                {selectedOrg?.address && (
                  <div className="flex items-start gap-2">
                    <MapPin className="w-4 h-4 mt-1 text-muted-foreground" />
                    <div>
                      <p className="text-sm font-medium">Address</p>
                      <p className="text-sm text-muted-foreground">
                        {selectedOrg.address}
                        {selectedOrg.city && <br />}
                        {[selectedOrg.city, selectedOrg.state, selectedOrg.zipCode].filter(Boolean).join(", ")}
                      </p>
                    </div>
                  </div>
                )}
                {selectedOrg?.website && (
                  <div className="flex items-start gap-2">
                    <Globe className="w-4 h-4 mt-1 text-muted-foreground" />
                    <div>
                      <p className="text-sm font-medium">Website</p>
                      <a href={selectedOrg.website} target="_blank" rel="noopener noreferrer" className="text-sm text-primary hover:underline">
                        {selectedOrg.website}
                      </a>
                    </div>
                  </div>
                )}
                {selectedOrg?.paymentTerms && (
                  <div className="flex items-start gap-2">
                    <FileText className="w-4 h-4 mt-1 text-muted-foreground" />
                    <div>
                      <p className="text-sm font-medium">Payment Terms</p>
                      <p className="text-sm text-muted-foreground">{selectedOrg.paymentTerms}</p>
                    </div>
                  </div>
                )}
              </div>
              
              {selectedOrg?.specialties && selectedOrg.specialties.length > 0 && (
                <div>
                  <p className="text-sm font-medium mb-2">Specialties</p>
                  <div className="flex flex-wrap gap-2">
                    {selectedOrg.specialties.map((s, i) => (
                      <Badge key={i} variant="secondary">{s}</Badge>
                    ))}
                  </div>
                </div>
              )}
              
              {selectedOrg?.notes && (
                <div>
                  <p className="text-sm font-medium mb-1">Notes</p>
                  <p className="text-sm text-muted-foreground">{selectedOrg.notes}</p>
                </div>
              )}
            </TabsContent>
            
            <TabsContent value="contacts" className="mt-4">
              <div className="flex items-center justify-between mb-4">
                <p className="text-sm text-muted-foreground">
                  Manage contacts for this organization
                </p>
                <Button size="sm" onClick={() => { resetNewContact(); setCreateContactOpen(true); }} data-testid="button-add-contact">
                  <Plus className="w-4 h-4 mr-1" />
                  Add Contact
                </Button>
              </div>
              
              {orgDetailLoading ? (
                <div className="space-y-2">
                  {[1, 2].map((i) => <Skeleton key={i} className="h-16 w-full" />)}
                </div>
              ) : !orgDetail?.contacts?.length ? (
                <div className="text-center py-8 text-muted-foreground">
                  <User className="w-12 h-12 mx-auto mb-2 opacity-50" />
                  <p>No contacts yet</p>
                  <p className="text-sm">Add contacts to track your relationships</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {orgDetail.contacts.map((contact) => (
                    <Card 
                      key={contact.id} 
                      className="cursor-pointer hover-elevate"
                      onClick={() => {
                        setSelectedContact(contact);
                        setViewContactOpen(true);
                      }}
                      data-testid={`card-contact-${contact.id}`}
                    >
                      <CardContent className="p-4">
                        <div className="flex items-start justify-between">
                          <div className="flex items-start gap-3">
                            <div className="p-2 rounded-full bg-muted">
                              <User className="w-4 h-4" />
                            </div>
                            <div>
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="font-medium">
                                  {contact.firstName} {contact.lastName}
                                </span>
                                {contact.isPrimary && (
                                  <Badge variant="secondary" className="text-xs">Primary</Badge>
                                )}
                                <Badge variant="outline" className="text-xs">
                                  {ROLE_LABELS[contact.role as ContactRole]}
                                </Badge>
                              </div>
                              {contact.title && (
                                <p className="text-sm text-muted-foreground">{contact.title}</p>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={(e) => {
                                e.stopPropagation();
                                openEditContact(contact);
                              }}
                              data-testid={`button-edit-contact-${contact.id}`}
                            >
                              <Edit className="w-4 h-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={(e) => {
                                e.stopPropagation();
                                deleteContactMutation.mutate(contact.id);
                              }}
                              disabled={deleteContactMutation.isPending}
                              data-testid={`button-delete-contact-${contact.id}`}
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                            <ChevronRight className="w-4 h-4 text-muted-foreground" />
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>
      
      <Dialog open={createContactOpen} onOpenChange={setCreateContactOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Add Contact</DialogTitle>
            <DialogDescription>
              Add a new contact to {selectedOrg?.name}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>First Name *</Label>
                <Input
                  value={newContact.firstName}
                  onChange={(e) => setNewContact({ ...newContact, firstName: e.target.value })}
                  placeholder="First name"
                  data-testid="input-contact-first-name"
                />
              </div>
              <div className="space-y-2">
                <Label>Last Name *</Label>
                <Input
                  value={newContact.lastName}
                  onChange={(e) => setNewContact({ ...newContact, lastName: e.target.value })}
                  placeholder="Last name"
                  data-testid="input-contact-last-name"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Title</Label>
                <Input
                  value={newContact.title}
                  onChange={(e) => setNewContact({ ...newContact, title: e.target.value })}
                  placeholder="Job title"
                  data-testid="input-contact-title"
                />
              </div>
              <div className="space-y-2">
                <Label>Role</Label>
                <Select value={newContact.role} onValueChange={(v) => setNewContact({ ...newContact, role: v as ContactRole })}>
                  <SelectTrigger data-testid="select-contact-role">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="PM">Project Manager</SelectItem>
                    <SelectItem value="ESTIMATOR">Estimator</SelectItem>
                    <SelectItem value="SUPERINTENDENT">Superintendent</SelectItem>
                    <SelectItem value="SALES">Sales</SelectItem>
                    <SelectItem value="ACCOUNTS_PAYABLE">Accounts Payable</SelectItem>
                    <SelectItem value="ACCOUNTS_RECEIVABLE">Accounts Receivable</SelectItem>
                    <SelectItem value="OWNER">Owner</SelectItem>
                    <SelectItem value="GENERAL_MANAGER">General Manager</SelectItem>
                    <SelectItem value="FOREMAN">Foreman</SelectItem>
                    <SelectItem value="OTHER">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label>Email</Label>
              <Input
                type="email"
                value={newContact.email}
                onChange={(e) => setNewContact({ ...newContact, email: e.target.value })}
                placeholder="email@example.com"
                data-testid="input-contact-email"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Phone</Label>
                <Input
                  value={newContact.phone}
                  onChange={(e) => setNewContact({ ...newContact, phone: e.target.value })}
                  placeholder="(555) 555-5555"
                  data-testid="input-contact-phone"
                />
              </div>
              <div className="space-y-2">
                <Label>Mobile</Label>
                <Input
                  value={newContact.mobile}
                  onChange={(e) => setNewContact({ ...newContact, mobile: e.target.value })}
                  placeholder="(555) 555-5555"
                  data-testid="input-contact-mobile"
                />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="isPrimary"
                checked={newContact.isPrimary}
                onChange={(e) => setNewContact({ ...newContact, isPrimary: e.target.checked })}
                className="rounded border-input"
                data-testid="checkbox-contact-primary"
              />
              <Label htmlFor="isPrimary" className="cursor-pointer">Primary contact</Label>
            </div>
            <div className="space-y-2">
              <Label>Notes</Label>
              <Textarea
                value={newContact.notes}
                onChange={(e) => setNewContact({ ...newContact, notes: e.target.value })}
                placeholder="Additional notes..."
                data-testid="input-contact-notes"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateContactOpen(false)} data-testid="button-cancel-contact">
              Cancel
            </Button>
            <Button
              onClick={() => selectedOrg && createContactMutation.mutate({ ...newContact, organisationId: selectedOrg.id })}
              disabled={!newContact.firstName || !newContact.lastName || createContactMutation.isPending}
              data-testid="button-save-contact"
            >
              {createContactMutation.isPending ? "Creating..." : "Add Contact"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      
      <Dialog open={editContactOpen} onOpenChange={setEditContactOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit Contact</DialogTitle>
            <DialogDescription>
              Update contact information
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>First Name *</Label>
                <Input
                  value={newContact.firstName}
                  onChange={(e) => setNewContact({ ...newContact, firstName: e.target.value })}
                  placeholder="First name"
                  data-testid="input-edit-contact-first-name"
                />
              </div>
              <div className="space-y-2">
                <Label>Last Name *</Label>
                <Input
                  value={newContact.lastName}
                  onChange={(e) => setNewContact({ ...newContact, lastName: e.target.value })}
                  placeholder="Last name"
                  data-testid="input-edit-contact-last-name"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Title</Label>
                <Input
                  value={newContact.title}
                  onChange={(e) => setNewContact({ ...newContact, title: e.target.value })}
                  placeholder="Job title"
                  data-testid="input-edit-contact-title"
                />
              </div>
              <div className="space-y-2">
                <Label>Role</Label>
                <Select value={newContact.role} onValueChange={(v) => setNewContact({ ...newContact, role: v as ContactRole })}>
                  <SelectTrigger data-testid="select-edit-contact-role">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="PM">Project Manager</SelectItem>
                    <SelectItem value="ESTIMATOR">Estimator</SelectItem>
                    <SelectItem value="SUPERINTENDENT">Superintendent</SelectItem>
                    <SelectItem value="SALES">Sales</SelectItem>
                    <SelectItem value="ACCOUNTS_PAYABLE">Accounts Payable</SelectItem>
                    <SelectItem value="ACCOUNTS_RECEIVABLE">Accounts Receivable</SelectItem>
                    <SelectItem value="OWNER">Owner</SelectItem>
                    <SelectItem value="GENERAL_MANAGER">General Manager</SelectItem>
                    <SelectItem value="FOREMAN">Foreman</SelectItem>
                    <SelectItem value="OTHER">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label>Email</Label>
              <Input
                type="email"
                value={newContact.email}
                onChange={(e) => setNewContact({ ...newContact, email: e.target.value })}
                placeholder="email@example.com"
                data-testid="input-edit-contact-email"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Phone</Label>
                <Input
                  value={newContact.phone}
                  onChange={(e) => setNewContact({ ...newContact, phone: e.target.value })}
                  placeholder="(555) 555-5555"
                  data-testid="input-edit-contact-phone"
                />
              </div>
              <div className="space-y-2">
                <Label>Mobile</Label>
                <Input
                  value={newContact.mobile}
                  onChange={(e) => setNewContact({ ...newContact, mobile: e.target.value })}
                  placeholder="(555) 555-5555"
                  data-testid="input-edit-contact-mobile"
                />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="editIsPrimary"
                checked={newContact.isPrimary}
                onChange={(e) => setNewContact({ ...newContact, isPrimary: e.target.checked })}
                className="rounded border-input"
                data-testid="checkbox-edit-contact-primary"
              />
              <Label htmlFor="editIsPrimary" className="cursor-pointer">Primary contact</Label>
            </div>
            <div className="space-y-2">
              <Label>Notes</Label>
              <Textarea
                value={newContact.notes}
                onChange={(e) => setNewContact({ ...newContact, notes: e.target.value })}
                placeholder="Additional notes..."
                data-testid="input-edit-contact-notes"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditContactOpen(false)} data-testid="button-cancel-edit-contact">
              Cancel
            </Button>
            <Button
              onClick={() => selectedContact && updateContactMutation.mutate({ id: selectedContact.id, ...newContact })}
              disabled={!newContact.firstName || !newContact.lastName || updateContactMutation.isPending}
              data-testid="button-update-contact"
            >
              {updateContactMutation.isPending ? "Updating..." : "Update Contact"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      
      <Dialog open={viewContactOpen} onOpenChange={setViewContactOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <div className="flex items-start justify-between gap-4">
              <div>
                <DialogTitle className="text-xl">
                  {selectedContact?.firstName} {selectedContact?.lastName}
                </DialogTitle>
                <div className="flex items-center gap-2 mt-2">
                  {selectedContact?.isPrimary && (
                    <Badge variant="secondary">Primary Contact</Badge>
                  )}
                  <Badge variant="outline">
                    {ROLE_LABELS[(selectedContact?.role || "OTHER") as ContactRole]}
                  </Badge>
                </div>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  if (selectedContact) {
                    openEditContact(selectedContact);
                    setViewContactOpen(false);
                  }
                }}
                data-testid="button-edit-from-view"
              >
                <Edit className="w-4 h-4 mr-1" />
                Edit
              </Button>
            </div>
          </DialogHeader>
          
          <div className="space-y-4 py-4">
            {selectedContact?.title && (
              <div className="flex items-start gap-3">
                <User className="w-5 h-5 mt-0.5 text-muted-foreground" />
                <div>
                  <p className="text-sm font-medium">Title</p>
                  <p className="text-sm text-muted-foreground">{selectedContact.title}</p>
                </div>
              </div>
            )}
            
            {selectedContact?.email && (
              <div className="flex items-start gap-3">
                <Mail className="w-5 h-5 mt-0.5 text-muted-foreground" />
                <div>
                  <p className="text-sm font-medium">Email</p>
                  <a 
                    href={`mailto:${selectedContact.email}`} 
                    className="text-sm text-primary hover:underline"
                  >
                    {selectedContact.email}
                  </a>
                </div>
              </div>
            )}
            
            {selectedContact?.phone && (
              <div className="flex items-start gap-3">
                <Phone className="w-5 h-5 mt-0.5 text-muted-foreground" />
                <div>
                  <p className="text-sm font-medium">Phone</p>
                  <a 
                    href={`tel:${selectedContact.phone}`} 
                    className="text-sm text-primary hover:underline"
                  >
                    {selectedContact.phone}
                  </a>
                </div>
              </div>
            )}
            
            {selectedContact?.mobile && (
              <div className="flex items-start gap-3">
                <Phone className="w-5 h-5 mt-0.5 text-muted-foreground" />
                <div>
                  <p className="text-sm font-medium">Mobile</p>
                  <a 
                    href={`tel:${selectedContact.mobile}`} 
                    className="text-sm text-primary hover:underline"
                  >
                    {selectedContact.mobile}
                  </a>
                </div>
              </div>
            )}
            
            {selectedContact?.notes && (
              <div className="flex items-start gap-3">
                <FileText className="w-5 h-5 mt-0.5 text-muted-foreground" />
                <div>
                  <p className="text-sm font-medium">Notes</p>
                  <p className="text-sm text-muted-foreground">{selectedContact.notes}</p>
                </div>
              </div>
            )}
            
            {!selectedContact?.title && !selectedContact?.email && !selectedContact?.phone && !selectedContact?.mobile && !selectedContact?.notes && (
              <p className="text-sm text-muted-foreground text-center py-4">
                No additional contact information available.
              </p>
            )}
          </div>
          
          <DialogFooter>
            <Button variant="outline" onClick={() => setViewContactOpen(false)} data-testid="button-close-view-contact">
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
