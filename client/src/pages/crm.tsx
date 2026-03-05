import { useState, useMemo } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useQuery } from "@tanstack/react-query";
import { AIAnalysisButton } from "@/components/AIAnalysisButton";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Building2, Plus, Search, Edit, MapPin, Package, AlertCircle, X, ShieldAlert
} from "lucide-react";
import type { CrmOrganisation as CrmOrganization, CrmContact, Project } from "@shared/schema";
import { useCrmMutations } from "@/hooks/useCrmMutations";
import { CrmOrgDialogs, type OrgFormState } from "@/components/crm/CrmOrgDialogs";
import { CrmContactDialogs } from "@/components/crm/CrmContactDialogs";
import { CrmOrgDetail } from "@/components/crm/CrmOrgDetail";

type OrganizationType = "CONTRACTOR" | "SUBCONTRACTOR" | "SUPPLIER" | "VENDOR" | "OWNER_REP" | "RENTAL_VENDOR";
type ContactRole = "PM" | "ESTIMATOR" | "SUPERINTENDENT" | "SALES" | "ACCOUNTS_PAYABLE" | "ACCOUNTS_RECEIVABLE" | "OWNER" | "GENERAL_MANAGER" | "FOREMAN" | "OTHER";

interface OrganizationWithContacts extends CrmOrganization {
  contacts: CrmContact[];
}

const TYPE_LABELS: Record<OrganizationType, string> = {
  CONTRACTOR: "GC / Contractor",
  SUBCONTRACTOR: "Subcontractor",
  SUPPLIER: "Supplier",
  VENDOR: "Vendor",
  OWNER_REP: "Owner Rep",
  RENTAL_VENDOR: "Rental Vendor",
};

const TYPE_COLORS: Record<OrganizationType, string> = {
  CONTRACTOR: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  SUBCONTRACTOR: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  SUPPLIER: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200",
  VENDOR: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200",
  OWNER_REP: "bg-cyan-100 text-cyan-800 dark:bg-cyan-900 dark:text-cyan-200",
  RENTAL_VENDOR: "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200",
};

const DEFAULT_ORG: OrgFormState = {
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
  crmStatus: "ACTIVE",
  licenseNumber: "",
  bondingCapacity: "",
  insuranceExpiration: "",
  tradeSpecialty: "",
  materialCategories: [],
  serviceCategory: "",
  contractExpiration: "",
  equipmentCategory: "",
  rentalTerms: "",
  companyRepresented: "",
  activeProjectIds: [],
};

const DEFAULT_CONTACT = {
  firstName: "",
  lastName: "",
  title: "",
  role: "OTHER" as ContactRole,
  email: "",
  phone: "",
  mobile: "",
  isPrimary: false,
  notes: "",
};

export default function CRMPage() {
  const { user } = useAuth();

  const [searchTerm, setSearchTerm] = useState("");
  const [selectedType, setSelectedType] = useState<string>("all");
  const [specialtyFilter, setSpecialtyFilter] = useState<string>("all");

  const [createOrgOpen, setCreateOrgOpen] = useState(false);
  const [editOrgOpen, setEditOrgOpen] = useState(false);
  const [detailOrgOpen, setDetailOrgOpen] = useState(false);
  const [selectedOrg, setSelectedOrg] = useState<OrganizationWithContacts | null>(null);

  const [createContactOpen, setCreateContactOpen] = useState(false);
  const [editContactOpen, setEditContactOpen] = useState(false);
  const [viewContactOpen, setViewContactOpen] = useState(false);
  const [selectedContact, setSelectedContact] = useState<CrmContact | null>(null);

  const [newOrg, setNewOrg] = useState<OrgFormState>({ ...DEFAULT_ORG });
  const [newContact, setNewContact] = useState({ ...DEFAULT_CONTACT });

  const { data: organizations, isLoading: orgsLoading } = useQuery<CrmOrganization[]>({
    queryKey: ["/api/crm/organisations"],
  });

  const { data: projectsResponse } = useQuery<{ data: Project[] }>({
    queryKey: ["/api/projects"],
  });
  const allProjects = projectsResponse?.data || [];

  interface ComplianceItem {
    orgId: string;
    orgName: string;
    orgType: string;
    complianceType: string;
    expirationDate: string;
    status: "expired" | "expiring_soon";
    daysUntilExpiration: number;
  }
  const { data: complianceData } = useQuery<{ total: number; expired: number; expiringSoon: number; items: ComplianceItem[] }>({
    queryKey: ["/api/crm/organisations/expiring-compliance"],
  });

  const mutations = useCrmMutations(selectedOrg?.id);

  const createOrgMutationWrapped = {
    ...mutations.createOrgMutation,
    mutate: (data: any) => {
      mutations.createOrgMutation.mutate(data, {
        onSuccess: () => {
          setCreateOrgOpen(false);
          setNewOrg({ ...DEFAULT_ORG });
        },
      });
    },
  };

  const updateOrgMutationWrapped = {
    ...mutations.updateOrgMutation,
    mutate: (data: any) => {
      mutations.updateOrgMutation.mutate(data, {
        onSuccess: () => {
          setEditOrgOpen(false);
        },
      });
    },
  };

  const createContactMutationWrapped = {
    ...mutations.createContactMutation,
    mutate: (data: any) => {
      mutations.createContactMutation.mutate(data, {
        onSuccess: () => {
          setCreateContactOpen(false);
          setNewContact({ ...DEFAULT_CONTACT });
        },
      });
    },
  };

  const updateContactMutationWrapped = {
    ...mutations.updateContactMutation,
    mutate: (data: any) => {
      mutations.updateContactMutation.mutate(data, {
        onSuccess: () => {
          setEditContactOpen(false);
        },
      });
    },
  };

  const deleteOrgMutationWrapped = {
    ...mutations.deleteOrgMutation,
    mutate: (id: string) => {
      mutations.deleteOrgMutation.mutate(id, {
        onSuccess: () => {
          setDetailOrgOpen(false);
          setSelectedOrg(null);
        },
      });
    },
  };

  const uniqueSpecialties = useMemo(() => {
    const allSpecialties = organizations?.flatMap(org => org.specialties || []) || [];
    return Array.from(new Set(allSpecialties)).sort();
  }, [organizations]);

  const filteredOrganizations = organizations?.filter((org) => {
    const matchesSearch = org.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      org.city?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      org.state?.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesType = selectedType === "all" || org.type === selectedType;
    const matchesSpecialty = specialtyFilter === "all" || (org.specialties?.includes(specialtyFilter) ?? false);
    return matchesSearch && matchesType && matchesSpecialty && org.isActive;
  }) || [];

  const orgCounts = {
    total: organizations?.length || 0,
    activeOnProjects: organizations?.filter(o => (o.activeProjectIds?.length || 0) > 0).length || 0,
    complianceIssues: organizations?.filter(o => o.crmStatus === "COMPLIANCE_ISSUE").length || 0,
    inactive: organizations?.filter(o => o.crmStatus === "INACTIVE").length || 0,
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
      crmStatus: (org.crmStatus as "ACTIVE" | "PREQUALIFIED" | "COMPLIANCE_ISSUE" | "INACTIVE") || "ACTIVE",
      licenseNumber: org.licenseNumber || "",
      bondingCapacity: org.bondingCapacity || "",
      insuranceExpiration: org.insuranceExpiration ? new Date(org.insuranceExpiration).toISOString().split('T')[0] : "",
      tradeSpecialty: org.tradeSpecialty || "",
      materialCategories: org.materialCategories || [],
      serviceCategory: org.serviceCategory || "",
      contractExpiration: org.contractExpiration ? new Date(org.contractExpiration).toISOString().split('T')[0] : "",
      equipmentCategory: org.equipmentCategory || "",
      rentalTerms: org.rentalTerms || "",
      companyRepresented: org.companyRepresented || "",
      activeProjectIds: org.activeProjectIds || [],
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
            <div className="flex gap-2">
              <AIAnalysisButton module="VENDOR_PRICING" />
              <Button onClick={() => setCreateOrgOpen(true)} data-testid="button-add-organization">
                <Plus className="w-4 h-4 mr-2" />
                Add Organization
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card className="hover-elevate cursor-pointer" onClick={() => setSelectedType("all")} data-testid="card-total-count">
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-md bg-primary/10">
                    <Building2 className="w-5 h-5 text-primary" />
                  </div>
                  <div>
                    <p className="text-2xl font-bold">{orgCounts.total}</p>
                    <p className="text-sm text-muted-foreground">Total Orgs</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card className="hover-elevate cursor-pointer" data-testid="card-active-count">
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-md bg-green-100 dark:bg-green-900">
                    <Building2 className="w-5 h-5 text-green-600 dark:text-green-400" />
                  </div>
                  <div>
                    <p className="text-2xl font-bold">{orgCounts.activeOnProjects}</p>
                    <p className="text-sm text-muted-foreground">Active on Projects</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card className="hover-elevate cursor-pointer" data-testid="card-compliance-count">
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-md bg-orange-100 dark:bg-orange-900">
                    <AlertCircle className="w-5 h-5 text-orange-600 dark:text-orange-400" />
                  </div>
                  <div>
                    <p className="text-2xl font-bold">{orgCounts.complianceIssues}</p>
                    <p className="text-sm text-muted-foreground">Compliance Issues</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card className="hover-elevate cursor-pointer" data-testid="card-inactive-count">
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-md bg-gray-100 dark:bg-gray-900">
                    <Building2 className="w-5 h-5 text-gray-600 dark:text-gray-400" />
                  </div>
                  <div>
                    <p className="text-2xl font-bold">{orgCounts.inactive}</p>
                    <p className="text-sm text-muted-foreground">Inactive</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {complianceData && complianceData.total > 0 && (
            <Card className="border-orange-300 dark:border-orange-700 bg-orange-50 dark:bg-orange-950" data-testid="card-compliance-alert">
              <CardContent className="p-4">
                <div className="flex items-start gap-3">
                  <ShieldAlert className="w-5 h-5 text-orange-600 dark:text-orange-400 mt-0.5 shrink-0" />
                  <div className="flex-1">
                    <p className="font-semibold text-orange-800 dark:text-orange-200">
                      Compliance Alert: {complianceData.total} item{complianceData.total !== 1 ? "s" : ""} require attention
                    </p>
                    <p className="text-sm text-orange-700 dark:text-orange-300 mt-1">
                      {complianceData.expired > 0 && (
                        <span className="font-medium text-red-600 dark:text-red-400">{complianceData.expired} expired</span>
                      )}
                      {complianceData.expired > 0 && complianceData.expiringSoon > 0 && " · "}
                      {complianceData.expiringSoon > 0 && (
                        <span>{complianceData.expiringSoon} expiring within 30 days</span>
                      )}
                    </p>
                    <div className="mt-2 space-y-1">
                      {complianceData.items.slice(0, 5).map((item, idx) => (
                        <div key={idx} className="flex items-center gap-2 text-sm" data-testid={`compliance-item-${idx}`}>
                          <Badge variant={item.status === "expired" ? "destructive" : "secondary"} className="text-xs">
                            {item.status === "expired" ? "Expired" : `${item.daysUntilExpiration}d left`}
                          </Badge>
                          <span className="text-orange-800 dark:text-orange-200 font-medium">{item.orgName}</span>
                          <span className="text-orange-600 dark:text-orange-400">— {item.complianceType}</span>
                        </div>
                      ))}
                      {complianceData.items.length > 5 && (
                        <p className="text-xs text-orange-600 dark:text-orange-400">
                          +{complianceData.items.length - 5} more items
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

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
                      <SelectItem value="CONTRACTOR">GC / Contractors</SelectItem>
                      <SelectItem value="SUBCONTRACTOR">Subcontractors</SelectItem>
                      <SelectItem value="SUPPLIER">Suppliers</SelectItem>
                      <SelectItem value="VENDOR">Vendors</SelectItem>
                      <SelectItem value="RENTAL_VENDOR">Rental Vendors</SelectItem>
                      <SelectItem value="OWNER_REP">Owner Reps</SelectItem>
                    </SelectContent>
                  </Select>
                  {uniqueSpecialties.length > 0 && (
                    <Select value={specialtyFilter} onValueChange={setSpecialtyFilter}>
                      <SelectTrigger className="w-[180px]" data-testid="select-specialty-filter">
                        <SelectValue placeholder="Filter by specialty" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Specialties</SelectItem>
                        {uniqueSpecialties.map(specialty => (
                          <SelectItem key={specialty} value={specialty}>{specialty}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </div>
              </div>

              {(searchTerm || selectedType !== "all" || specialtyFilter !== "all") && (
                <div className="flex flex-wrap items-center gap-2 mt-2">
                  <span className="text-sm text-muted-foreground">Active filters:</span>
                  {searchTerm && (
                    <Badge variant="secondary" className="gap-1">
                      Search: "{searchTerm}"
                      <X
                        className="w-3 h-3 cursor-pointer"
                        onClick={() => setSearchTerm("")}
                        data-testid="button-clear-search"
                      />
                    </Badge>
                  )}
                  {selectedType !== "all" && (
                    <Badge variant="secondary" className="gap-1">
                      {TYPE_LABELS[selectedType as OrganizationType]}
                      <X
                        className="w-3 h-3 cursor-pointer"
                        onClick={() => setSelectedType("all")}
                        data-testid="button-clear-type-filter"
                      />
                    </Badge>
                  )}
                  {specialtyFilter !== "all" && (
                    <Badge variant="secondary" className="gap-1">
                      {specialtyFilter}
                      <X
                        className="w-3 h-3 cursor-pointer"
                        onClick={() => setSpecialtyFilter("all")}
                        data-testid="button-clear-specialty-filter"
                      />
                    </Badge>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setSearchTerm("");
                      setSelectedType("all");
                      setSpecialtyFilter("all");
                    }}
                    data-testid="button-clear-all-filters"
                  >
                    Clear all
                  </Button>
                </div>
              )}
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
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {filteredOrganizations.map((org) => {
                    const statusColor = org.crmStatus === "ACTIVE" ? "bg-green-500" :
                      org.crmStatus === "PREQUALIFIED" ? "bg-blue-500" :
                      org.crmStatus === "COMPLIANCE_ISSUE" ? "bg-orange-500" : "bg-gray-400";
                    const statusLabel = org.crmStatus === "ACTIVE" ? "Active" :
                      org.crmStatus === "PREQUALIFIED" ? "Prequalified" :
                      org.crmStatus === "COMPLIANCE_ISSUE" ? "Compliance Issue" : "Inactive";
                    const typeSpecificInfo = org.type === "CONTRACTOR" ? (org.bondingCapacity ? `Bonding: ${org.bondingCapacity}` : null) :
                      org.type === "SUBCONTRACTOR" ? (org.tradeSpecialty || (org.specialties?.length ? org.specialties[0] : null)) :
                      org.type === "SUPPLIER" ? (org.materialCategories?.length ? org.materialCategories[0] : null) :
                      org.type === "VENDOR" ? (org.serviceCategory || null) :
                      org.type === "RENTAL_VENDOR" ? (org.equipmentCategory || null) :
                      org.type === "OWNER_REP" ? (org.companyRepresented || null) : null;

                    return (
                      <Card
                        key={org.id}
                        className="hover-elevate cursor-pointer transition-all flex flex-col"
                        onClick={() => openOrgDetail(org)}
                        data-testid={`card-org-${org.id}`}
                      >
                        <CardContent className="p-4 flex flex-col flex-1">
                          <div className="flex items-start justify-between mb-3">
                            <div className="flex items-center gap-2">
                              <span className={`inline-block w-2.5 h-2.5 rounded-full ${statusColor}`} />
                              <h3 className="font-semibold text-foreground truncate">{org.name}</h3>
                              {(() => {
                                const orgCompliance = complianceData?.items.filter(i => i.orgId === org.id) || [];
                                if (orgCompliance.length === 0) return null;
                                const hasExpired = orgCompliance.some(i => i.status === "expired");
                                return (
                                  <Badge variant={hasExpired ? "destructive" : "secondary"} className="text-xs shrink-0" data-testid={`compliance-badge-${org.id}`}>
                                    {hasExpired ? "Expired" : "Expiring"}
                                  </Badge>
                                );
                              })()}
                            </div>
                          </div>
                          <div className="space-y-1.5 text-sm">
                            <div className="flex items-center gap-1.5">
                              <Badge className={`${TYPE_COLORS[org.type as OrganizationType]} text-xs`}>
                                {TYPE_LABELS[org.type as OrganizationType]}
                              </Badge>
                            </div>
                            {(org.city || org.state) && (
                              <div className="flex items-center gap-1.5 text-muted-foreground">
                                <MapPin className="w-3.5 h-3.5 shrink-0" />
                                <span>{org.city && org.state ? `${org.city}, ${org.state}` : org.city || org.state}</span>
                              </div>
                            )}
                            {typeSpecificInfo && (
                              <div className="flex items-center gap-1.5 text-muted-foreground">
                                <Package className="w-3.5 h-3.5 shrink-0" />
                                <span className="truncate">{typeSpecificInfo}</span>
                              </div>
                            )}
                            {(org.activeProjectIds?.length || 0) > 0 && (
                              <div className="flex items-center gap-1.5 text-muted-foreground">
                                <Building2 className="w-3.5 h-3.5 shrink-0" />
                                <span>Projects: {org.activeProjectIds!.length} Active</span>
                              </div>
                            )}
                          </div>
                          <div className="flex items-center mt-auto pt-3 border-t">
                            <span className="text-xs text-muted-foreground">{statusLabel}</span>
                            <div className="flex items-center gap-1 ml-auto">
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-7 text-xs"
                                onClick={(e) => { e.stopPropagation(); openOrgDetail(org); }}
                                data-testid={`button-view-org-${org.id}`}
                              >
                                View
                              </Button>
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-7 text-xs"
                                onClick={(e) => { e.stopPropagation(); openEditOrg(org); }}
                                data-testid={`button-edit-org-${org.id}`}
                              >
                                Edit
                              </Button>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </main>

      <CrmOrgDialogs
        createOrgOpen={createOrgOpen}
        setCreateOrgOpen={setCreateOrgOpen}
        editOrgOpen={editOrgOpen}
        setEditOrgOpen={setEditOrgOpen}
        newOrg={newOrg}
        setNewOrg={setNewOrg}
        allProjects={allProjects}
        selectedOrgId={selectedOrg?.id}
        createOrgMutation={createOrgMutationWrapped}
        updateOrgMutation={updateOrgMutationWrapped}
      />

      <CrmOrgDetail
        detailOrgOpen={detailOrgOpen}
        setDetailOrgOpen={setDetailOrgOpen}
        selectedOrg={selectedOrg}
        allProjects={allProjects}
        openEditOrg={openEditOrg}
        openEditContact={openEditContact}
        setCreateContactOpen={setCreateContactOpen}
        resetNewContact={() => setNewContact({ ...DEFAULT_CONTACT })}
        setSelectedContact={setSelectedContact}
        setViewContactOpen={setViewContactOpen}
        mutations={{
          ...mutations,
          deleteOrgMutation: deleteOrgMutationWrapped,
        }}
      />

      <CrmContactDialogs
        createContactOpen={createContactOpen}
        setCreateContactOpen={setCreateContactOpen}
        editContactOpen={editContactOpen}
        setEditContactOpen={setEditContactOpen}
        viewContactOpen={viewContactOpen}
        setViewContactOpen={setViewContactOpen}
        newContact={newContact}
        setNewContact={setNewContact}
        selectedContact={selectedContact}
        selectedOrgName={selectedOrg?.name}
        selectedOrgId={selectedOrg?.id}
        createContactMutation={createContactMutationWrapped}
        updateContactMutation={updateContactMutationWrapped}
        openEditContact={openEditContact}
      />
    </div>
  );
}
