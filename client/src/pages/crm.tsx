import { useState, useMemo } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AIAnalysisButton } from "@/components/AIAnalysisButton";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Building2,
  Plus,
  Search,
  MapPin,
  Package,
  AlertCircle,
  X,
  ShieldAlert,
  TrendingUp,
  Users,
  Mail,
  Phone,
  ChevronUp,
  ChevronDown,
  ChevronsUpDown,
  Copy,
  Filter,
} from "lucide-react";
import CrmPipelineView from "@/components/crm/CrmPipelineView";
import type {
  CrmOrganisation as CrmOrganization,
  CrmContact,
  Project,
} from "@shared/schema";
import { useCrmMutations } from "@/hooks/useCrmMutations";
import {
  CrmOrgDialogs,
  type OrgFormState,
} from "@/components/crm/CrmOrgDialogs";
import { CrmContactDialogs } from "@/components/crm/CrmContactDialogs";
import { CrmOrgDetail } from "@/components/crm/CrmOrgDetail";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

type OrganizationType =
  | "CONTRACTOR"
  | "SUBCONTRACTOR"
  | "SUPPLIER"
  | "VENDOR"
  | "OWNER_REP"
  | "RENTAL_VENDOR";
type ContactRole =
  | "PM"
  | "ESTIMATOR"
  | "SUPERINTENDENT"
  | "SALES"
  | "ACCOUNTS_PAYABLE"
  | "ACCOUNTS_RECEIVABLE"
  | "OWNER"
  | "GENERAL_MANAGER"
  | "FOREMAN"
  | "OTHER";

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
  SUBCONTRACTOR:
    "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  SUPPLIER:
    "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200",
  VENDOR:
    "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200",
  OWNER_REP: "bg-cyan-100 text-cyan-800 dark:bg-cyan-900 dark:text-cyan-200",
  RENTAL_VENDOR:
    "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200",
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

interface DupOrg {
  id: string;
  name: string;
  type: string | null;
  city: string | null;
  state: string | null;
  crmStatus: string;
  isActive: boolean;
}

interface DupPair {
  orgA: DupOrg;
  orgB: DupOrg;
  matchReason: string;
}

export default function CRMPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [crmTab, setCrmTab] = useState<"orgs" | "contacts" | "pipeline">("orgs");
  const [contactSearch, setContactSearch] = useState("");

  const [searchTerm, setSearchTerm] = useState("");
  const [selectedType, setSelectedType] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [stateFilter, setStateFilter] = useState<string>("");
  const [specialtyFilters, setSpecialtyFilters] = useState<string[]>([]);
  const [showFilters, setShowFilters] = useState(false);

  const [dupOpen, setDupOpen] = useState(false);
  const [mergePair, setMergePair] = useState<DupPair | null>(null);
  const [mergeWinnerId, setMergeWinnerId] = useState<string>("");

  const [createOrgOpen, setCreateOrgOpen] = useState(false);
  const [editOrgOpen, setEditOrgOpen] = useState(false);
  const [detailOrgOpen, setDetailOrgOpen] = useState(false);
  const [selectedOrg, setSelectedOrg] =
    useState<OrganizationWithContacts | null>(null);

  const [createContactOpen, setCreateContactOpen] = useState(false);
  const [editContactOpen, setEditContactOpen] = useState(false);
  const [viewContactOpen, setViewContactOpen] = useState(false);
  const [selectedContact, setSelectedContact] = useState<CrmContact | null>(
    null,
  );

  const [newOrg, setNewOrg] = useState<OrgFormState>({ ...DEFAULT_ORG });
  const [newContact, setNewContact] = useState({ ...DEFAULT_CONTACT });

  const orgQueryParams = {
    search: searchTerm,
    type: selectedType !== "all" ? selectedType : "",
    status: statusFilter !== "all" ? statusFilter : "",
    state: stateFilter,
    specialties: specialtyFilters,
  };

  const { data: organizations, isLoading: orgsLoading } = useQuery<CrmOrganization[]>({
    queryKey: ["/api/crm/organisations", orgQueryParams],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (orgQueryParams.search) params.set("search", orgQueryParams.search);
      if (orgQueryParams.type) params.set("type", orgQueryParams.type);
      if (orgQueryParams.status) params.set("status", orgQueryParams.status);
      if (orgQueryParams.state) params.set("state", orgQueryParams.state);
      orgQueryParams.specialties.forEach((s) => params.append("specialty", s));
      const res = await fetch(`/api/crm/organisations?${params}`);
      if (!res.ok) throw new Error("Failed to fetch organizations");
      return res.json();
    },
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
  const { data: complianceData } = useQuery<{
    total: number;
    expired: number;
    expiringSoon: number;
    items: ComplianceItem[];
  }>({
    queryKey: ["/api/crm/organisations/expiring-compliance"],
  });

  interface AllContact extends CrmContact {
    orgName?: string | null;
    orgType?: string | null;
  }
  const { data: allContacts = [], isLoading: contactsLoading } = useQuery<AllContact[]>({
    queryKey: ["/api/crm/contacts", { search: contactSearch }],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (contactSearch) params.set("search", contactSearch);
      const res = await fetch(`/api/crm/contacts?${params}`);
      if (!res.ok) return [];
      return res.json();
    },
    enabled: crmTab === "contacts",
  });

  const ROLE_LABELS: Record<string, string> = {
    PM: "Project Manager", ESTIMATOR: "Estimator", SUPERINTENDENT: "Superintendent",
    SALES: "Sales", ACCOUNTS_PAYABLE: "Accounts Payable", ACCOUNTS_RECEIVABLE: "Accounts Receivable",
    OWNER: "Owner", GENERAL_MANAGER: "General Manager", FOREMAN: "Foreman", OTHER: "Other",
  };

  type ContactSortKey = "name" | "role" | "orgName" | "email" | "phone";
  const [contactSort, setContactSort] = useState<{ key: ContactSortKey; dir: "asc" | "desc" }>({ key: "name", dir: "asc" });

  const sortedContacts = [...allContacts].sort((a, b) => {
    const dir = contactSort.dir === "asc" ? 1 : -1;
    const getVal = (c: AllContact): string => {
      if (contactSort.key === "name") return `${c.firstName ?? ""} ${c.lastName ?? ""}`.toLowerCase();
      if (contactSort.key === "role") return (ROLE_LABELS[c.role as string] || c.role || "").toLowerCase();
      if (contactSort.key === "orgName") return (c.orgName ?? "").toLowerCase();
      if (contactSort.key === "email") return (c.email ?? "").toLowerCase();
      if (contactSort.key === "phone") return (c.phone ?? "").toLowerCase();
      return "";
    };
    return getVal(a) < getVal(b) ? -dir : getVal(a) > getVal(b) ? dir : 0;
  });

  const handleContactSort = (key: ContactSortKey) => {
    setContactSort((prev) => prev.key === key ? { key, dir: prev.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" });
  };

  const isAdminOrManager = user?.role === "ADMIN" || user?.role === "MANAGER";

  const { data: dupData, isLoading: dupLoading } = useQuery<{ pairs: DupPair[]; total: number }>({
    queryKey: ["/api/crm/organisations/duplicates"],
    enabled: dupOpen && isAdminOrManager,
  });

  const mergeMutation = useMutation({
    mutationFn: async ({ winnerId, loserId }: { winnerId: string; loserId: string }) =>
      apiRequest("POST", `/api/crm/organisations/${winnerId}/merge/${loserId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/crm/organisations"] });
      queryClient.invalidateQueries({ queryKey: ["/api/crm/organisations/duplicates"] });
      toast({ title: "Merged", description: "Organizations merged successfully." });
      setMergePair(null);
      setMergeWinnerId("");
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to merge organizations.", variant: "destructive" });
    },
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

  const { data: allOrgsForOptions } = useQuery<CrmOrganization[]>({
    queryKey: ["/api/crm/organisations", "options"],
    queryFn: async () => {
      const res = await fetch("/api/crm/organisations");
      if (!res.ok) return [];
      return res.json();
    },
    staleTime: 5 * 60 * 1000,
  });

  const uniqueSpecialties = useMemo(() => {
    const allSpecialties =
      (allOrgsForOptions ?? []).flatMap((org) => org.specialties || []);
    return Array.from(new Set(allSpecialties)).sort();
  }, [allOrgsForOptions]);

  const uniqueStates = useMemo(() => {
    const states = (allOrgsForOptions ?? []).map((o) => o.state).filter(Boolean) as string[];
    return Array.from(new Set(states)).sort();
  }, [allOrgsForOptions]);

  const filteredOrganizations = organizations ?? [];

  const orgCounts = {
    total: organizations?.length || 0,
    activeOnProjects:
      organizations?.filter((o) => (o.activeProjectIds?.length || 0) > 0)
        .length || 0,
    complianceIssues:
      organizations?.filter((o) => o.crmStatus === "COMPLIANCE_ISSUE").length ||
      0,
    inactive:
      organizations?.filter((o) => o.crmStatus === "INACTIVE").length || 0,
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
      crmStatus:
        (org.crmStatus as
          | "ACTIVE"
          | "PREQUALIFIED"
          | "COMPLIANCE_ISSUE"
          | "INACTIVE") || "ACTIVE",
      licenseNumber: org.licenseNumber || "",
      bondingCapacity: org.bondingCapacity || "",
      insuranceExpiration: org.insuranceExpiration
        ? new Date(org.insuranceExpiration).toISOString().split("T")[0]
        : "",
      tradeSpecialty: org.tradeSpecialty || "",
      materialCategories: org.materialCategories || [],
      serviceCategory: org.serviceCategory || "",
      contractExpiration: org.contractExpiration
        ? new Date(org.contractExpiration).toISOString().split("T")[0]
        : "",
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
      <main className="flex-1 container mx-auto max-w-full px-4 py-6">
        <div className="flex flex-col gap-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h1
                className="text-2xl font-bold text-foreground"
                data-testid="text-page-title"
              >
                Customer Relationship Management
              </h1>
              <p className="text-muted-foreground">
                Manage contractors, subcontractors, suppliers, and vendors
              </p>
            </div>
            <div className="flex gap-2">
              <AIAnalysisButton module="VENDOR_PRICING" />
              {crmTab === "orgs" && isAdminOrManager && (
                <Button
                  variant="outline"
                  onClick={() => setDupOpen(true)}
                  data-testid="button-find-duplicates"
                >
                  <Copy className="w-4 h-4 mr-2" />
                  Find Duplicates
                </Button>
              )}
              {crmTab === "orgs" && (
                <Button
                  onClick={() => setCreateOrgOpen(true)}
                  data-testid="button-add-organization"
                >
                  <Plus className="w-4 h-4 mr-2" />
                  Add Organization
                </Button>
              )}
            </div>
          </div>

          {/* Tab Switcher */}
          <div className="flex gap-1 border-b" data-testid="crm-tab-switcher">
            <button
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${crmTab === "orgs" ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}
              onClick={() => setCrmTab("orgs")}
              data-testid="tab-organizations"
            >
              <Building2 className="w-4 h-4 inline mr-1.5 -mt-0.5" />
              Organizations
            </button>
            <button
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${crmTab === "contacts" ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}
              onClick={() => setCrmTab("contacts")}
              data-testid="tab-contacts"
            >
              <Users className="w-4 h-4 inline mr-1.5 -mt-0.5" />
              Contacts
            </button>
            <button
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${crmTab === "pipeline" ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}
              onClick={() => setCrmTab("pipeline")}
              data-testid="tab-sales-pipeline"
            >
              <TrendingUp className="w-4 h-4 inline mr-1.5 -mt-0.5" />
              Sales Pipeline
            </button>
          </div>

          {crmTab === "pipeline" && <CrmPipelineView />}

          {crmTab === "contacts" && (
            <Card>
              <CardHeader className="pb-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <CardTitle className="flex items-center gap-2">
                    <Users className="w-5 h-5" />
                    All Contacts
                    {!contactsLoading && (
                      <Badge variant="secondary" className="ml-1 text-xs font-normal">{allContacts.length}</Badge>
                    )}
                  </CardTitle>
                  <div className="relative flex-1 max-w-sm">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input
                      placeholder="Search by name, email, or organization..."
                      value={contactSearch}
                      onChange={(e) => setContactSearch(e.target.value)}
                      className="pl-9"
                      data-testid="input-contacts-search"
                    />
                  </div>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                {contactsLoading ? (
                  <div className="space-y-2 p-6">
                    {[1, 2, 3, 4, 5].map((i) => (
                      <Skeleton key={i} className="h-12 w-full" />
                    ))}
                  </div>
                ) : allContacts.length === 0 ? (
                  <div className="text-center py-12 text-muted-foreground">
                    <Users className="w-12 h-12 mx-auto mb-4 opacity-50" />
                    <p className="font-medium">No contacts found</p>
                    <p className="text-sm mt-1">
                      {contactSearch ? "Try a different search term." : "Add contacts inside an organization to see them here."}
                    </p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm" data-testid="table-contacts">
                      <thead>
                        <tr className="border-b bg-muted/40">
                          {(
                            [
                              { key: "name", label: "Name" },
                              { key: "role", label: "Role" },
                              { key: "orgName", label: "Organization" },
                              { key: "email", label: "Email" },
                              { key: "phone", label: "Phone" },
                            ] as { key: ContactSortKey; label: string }[]
                          ).map(({ key, label }) => (
                            <th
                              key={key}
                              className="px-4 py-3 text-left font-medium text-muted-foreground cursor-pointer select-none hover:text-foreground transition-colors whitespace-nowrap"
                              onClick={() => handleContactSort(key)}
                              data-testid={`th-contact-${key}`}
                            >
                              <span className="inline-flex items-center gap-1">
                                {label}
                                {contactSort.key === key ? (
                                  contactSort.dir === "asc" ? (
                                    <ChevronUp className="w-3.5 h-3.5" />
                                  ) : (
                                    <ChevronDown className="w-3.5 h-3.5" />
                                  )
                                ) : (
                                  <ChevronsUpDown className="w-3.5 h-3.5 opacity-40" />
                                )}
                              </span>
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {sortedContacts.map((contact) => (
                          <tr
                            key={contact.id}
                            className="cursor-pointer hover:bg-muted/40 transition-colors"
                            onClick={() => {
                              setSelectedContact(contact);
                              setViewContactOpen(true);
                            }}
                            data-testid={`row-contact-${contact.id}`}
                          >
                            <td className="px-4 py-3 font-medium">
                              <div className="flex items-center gap-2">
                                {contact.firstName} {contact.lastName}
                                {contact.isPrimary && (
                                  <Badge variant="secondary" className="text-xs">Primary</Badge>
                                )}
                              </div>
                            </td>
                            <td className="px-4 py-3 text-muted-foreground">
                              {ROLE_LABELS[contact.role as string] || contact.role || "—"}
                            </td>
                            <td className="px-4 py-3 text-muted-foreground">
                              {contact.orgName || "—"}
                            </td>
                            <td className="px-4 py-3">
                              {contact.email ? (
                                <a
                                  href={`mailto:${contact.email}`}
                                  className="flex items-center gap-1 text-muted-foreground hover:text-primary transition-colors"
                                  onClick={(e) => e.stopPropagation()}
                                  data-testid={`link-contact-email-${contact.id}`}
                                >
                                  <Mail className="w-3.5 h-3.5 shrink-0" />
                                  <span className="truncate max-w-[180px]">{contact.email}</span>
                                </a>
                              ) : (
                                <span className="text-muted-foreground/50">—</span>
                              )}
                            </td>
                            <td className="px-4 py-3">
                              {contact.phone ? (
                                <a
                                  href={`tel:${contact.phone}`}
                                  className="flex items-center gap-1 text-muted-foreground hover:text-primary transition-colors"
                                  onClick={(e) => e.stopPropagation()}
                                  data-testid={`link-contact-phone-${contact.id}`}
                                >
                                  <Phone className="w-3.5 h-3.5 shrink-0" />
                                  {contact.phone}
                                </a>
                              ) : (
                                <span className="text-muted-foreground/50">—</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {crmTab === "orgs" && <><div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card
              className="hover-elevate cursor-pointer"
              onClick={() => setSelectedType("all")}
              data-testid="card-total-count"
            >
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
            <Card
              className="hover-elevate cursor-pointer"
              data-testid="card-active-count"
            >
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-md bg-green-100 dark:bg-green-900">
                    <Building2 className="w-5 h-5 text-green-600 dark:text-green-400" />
                  </div>
                  <div>
                    <p className="text-2xl font-bold">
                      {orgCounts.activeOnProjects}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      Active on Projects
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card
              className="hover-elevate cursor-pointer"
              data-testid="card-compliance-count"
            >
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-md bg-orange-100 dark:bg-orange-900">
                    <AlertCircle className="w-5 h-5 text-orange-600 dark:text-orange-400" />
                  </div>
                  <div>
                    <p className="text-2xl font-bold">
                      {orgCounts.complianceIssues}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      Compliance Issues
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card
              className="hover-elevate cursor-pointer"
              data-testid="card-inactive-count"
            >
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
            <Card
              className="border-orange-300 dark:border-orange-700 bg-orange-50 dark:bg-orange-950"
              data-testid="card-compliance-alert"
            >
              <CardContent className="p-4">
                <div className="flex items-start gap-3">
                  <ShieldAlert className="w-5 h-5 text-orange-600 dark:text-orange-400 mt-0.5 shrink-0" />
                  <div className="flex-1">
                    <p className="font-semibold text-orange-800 dark:text-orange-200">
                      Compliance Alert: {complianceData.total} item
                      {complianceData.total !== 1 ? "s" : ""} require attention
                    </p>
                    <p className="text-sm text-orange-700 dark:text-orange-300 mt-1">
                      {complianceData.expired > 0 && (
                        <span className="font-medium text-red-600 dark:text-red-400">
                          {complianceData.expired} expired
                        </span>
                      )}
                      {complianceData.expired > 0 &&
                        complianceData.expiringSoon > 0 &&
                        " · "}
                      {complianceData.expiringSoon > 0 && (
                        <span>
                          {complianceData.expiringSoon} expiring within 30 days
                        </span>
                      )}
                    </p>
                    <div className="mt-2 space-y-1">
                      {complianceData.items.slice(0, 5).map((item, idx) => (
                        <div
                          key={idx}
                          className="flex items-center gap-2 text-sm"
                          data-testid={`compliance-item-${idx}`}
                        >
                          <Badge
                            variant={
                              item.status === "expired"
                                ? "destructive"
                                : "secondary"
                            }
                            className="text-xs"
                          >
                            {item.status === "expired"
                              ? "Expired"
                              : `${item.daysUntilExpiration}d left`}
                          </Badge>
                          <span className="text-orange-800 dark:text-orange-200 font-medium">
                            {item.orgName}
                          </span>
                          <span className="text-orange-600 dark:text-orange-400">
                            — {item.complianceType}
                          </span>
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
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setShowFilters((v) => !v)}
                    data-testid="button-toggle-filters"
                  >
                    <Filter className="w-4 h-4 mr-1.5" />
                    Filters
                    {(selectedType !== "all" || specialtyFilters.length > 0 || statusFilter !== "all" || stateFilter) && (
                      <span className="ml-1.5 bg-primary text-primary-foreground rounded-full w-4 h-4 text-xs flex items-center justify-center">
                        {[selectedType !== "all", specialtyFilters.length > 0, statusFilter !== "all", !!stateFilter].filter(Boolean).length}
                      </span>
                    )}
                  </Button>
                </div>
              </div>

              {showFilters && (
                <div className="flex flex-wrap gap-2 pt-3 border-t mt-3" data-testid="filter-panel">
                  <Select value={selectedType} onValueChange={setSelectedType}>
                    <SelectTrigger className="w-[160px]" data-testid="select-type-filter">
                      <SelectValue placeholder="All Types" />
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
                  <Select value={statusFilter} onValueChange={setStatusFilter}>
                    <SelectTrigger className="w-[180px]" data-testid="select-status-filter">
                      <SelectValue placeholder="All Statuses" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Statuses</SelectItem>
                      <SelectItem value="ACTIVE">Active</SelectItem>
                      <SelectItem value="PREQUALIFIED">Prequalified</SelectItem>
                      <SelectItem value="COMPLIANCE_ISSUE">Compliance Issue</SelectItem>
                      <SelectItem value="INACTIVE">Inactive</SelectItem>
                    </SelectContent>
                  </Select>
                  {uniqueStates.length > 0 && (
                    <Select value={stateFilter || "all"} onValueChange={(v) => setStateFilter(v === "all" ? "" : v)}>
                      <SelectTrigger className="w-[160px]" data-testid="select-state-filter">
                        <SelectValue placeholder="All States" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All States</SelectItem>
                        {uniqueStates.map((s) => (
                          <SelectItem key={s} value={s}>{s}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                  {uniqueSpecialties.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 items-center">
                      <span className="text-xs text-muted-foreground">Specialties:</span>
                      {uniqueSpecialties.map((specialty) => (
                        <Badge
                          key={specialty}
                          variant={specialtyFilters.includes(specialty) ? "default" : "outline"}
                          className="cursor-pointer select-none text-xs"
                          onClick={() =>
                            setSpecialtyFilters((prev) =>
                              prev.includes(specialty)
                                ? prev.filter((s) => s !== specialty)
                                : [...prev, specialty]
                            )
                          }
                          data-testid={`badge-specialty-${specialty}`}
                        >
                          {specialty}
                        </Badge>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {(searchTerm ||
                selectedType !== "all" ||
                specialtyFilters.length > 0 ||
                statusFilter !== "all" ||
                stateFilter) && (
                <div className="flex flex-wrap items-center gap-2 mt-2">
                  <span className="text-sm text-muted-foreground">
                    Active filters:
                  </span>
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
                  {statusFilter !== "all" && (
                    <Badge variant="secondary" className="gap-1">
                      {statusFilter === "COMPLIANCE_ISSUE" ? "Compliance Issue" : statusFilter.charAt(0) + statusFilter.slice(1).toLowerCase()}
                      <X
                        className="w-3 h-3 cursor-pointer"
                        onClick={() => setStatusFilter("all")}
                        data-testid="button-clear-status-filter"
                      />
                    </Badge>
                  )}
                  {stateFilter && (
                    <Badge variant="secondary" className="gap-1">
                      State: {stateFilter}
                      <X
                        className="w-3 h-3 cursor-pointer"
                        onClick={() => setStateFilter("")}
                        data-testid="button-clear-state-filter"
                      />
                    </Badge>
                  )}
                  {specialtyFilters.map((s) => (
                    <Badge key={s} variant="secondary" className="gap-1">
                      {s}
                      <X
                        className="w-3 h-3 cursor-pointer"
                        onClick={() => setSpecialtyFilters((prev) => prev.filter((f) => f !== s))}
                        data-testid={`button-clear-specialty-${s}`}
                      />
                    </Badge>
                  ))}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setSearchTerm("");
                      setSelectedType("all");
                      setSpecialtyFilters([]);
                      setStatusFilter("all");
                      setStateFilter("");
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
                  <p className="text-sm">
                    Try adjusting your search or filters
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {filteredOrganizations.map((org) => {
                    const statusColor =
                      org.crmStatus === "ACTIVE"
                        ? "bg-green-500"
                        : org.crmStatus === "PREQUALIFIED"
                          ? "bg-blue-500"
                          : org.crmStatus === "COMPLIANCE_ISSUE"
                            ? "bg-orange-500"
                            : "bg-gray-400";
                    const statusLabel =
                      org.crmStatus === "ACTIVE"
                        ? "Active"
                        : org.crmStatus === "PREQUALIFIED"
                          ? "Prequalified"
                          : org.crmStatus === "COMPLIANCE_ISSUE"
                            ? "Compliance Issue"
                            : "Inactive";
                    const typeSpecificInfo =
                      org.type === "CONTRACTOR"
                        ? org.bondingCapacity
                          ? `Bonding: ${org.bondingCapacity}`
                          : null
                        : org.type === "SUBCONTRACTOR"
                          ? org.tradeSpecialty ||
                            (org.specialties?.length
                              ? org.specialties[0]
                              : null)
                          : org.type === "SUPPLIER"
                            ? org.materialCategories?.length
                              ? org.materialCategories[0]
                              : null
                            : org.type === "VENDOR"
                              ? org.serviceCategory || null
                              : org.type === "RENTAL_VENDOR"
                                ? org.equipmentCategory || null
                                : org.type === "OWNER_REP"
                                  ? org.companyRepresented || null
                                  : null;

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
                              <span
                                className={`inline-block w-2.5 h-2.5 rounded-full ${statusColor}`}
                              />
                              <h3 className="font-semibold text-foreground truncate">
                                {org.name}
                              </h3>
                              {(() => {
                                const orgCompliance =
                                  complianceData?.items.filter(
                                    (i) => i.orgId === org.id,
                                  ) || [];
                                if (orgCompliance.length === 0) return null;
                                const hasExpired = orgCompliance.some(
                                  (i) => i.status === "expired",
                                );
                                return (
                                  <Badge
                                    variant={
                                      hasExpired ? "destructive" : "secondary"
                                    }
                                    className="text-xs shrink-0"
                                    data-testid={`compliance-badge-${org.id}`}
                                  >
                                    {hasExpired ? "Expired" : "Expiring"}
                                  </Badge>
                                );
                              })()}
                            </div>
                          </div>
                          <div className="space-y-1.5 text-sm">
                            <div className="flex items-center gap-1.5">
                              <Badge
                                className={`${TYPE_COLORS[org.type as OrganizationType]} text-xs`}
                              >
                                {TYPE_LABELS[org.type as OrganizationType]}
                              </Badge>
                            </div>
                            {(org.city || org.state) && (
                              <div className="flex items-center gap-1.5 text-muted-foreground">
                                <MapPin className="w-3.5 h-3.5 shrink-0" />
                                <span>
                                  {org.city && org.state
                                    ? `${org.city}, ${org.state}`
                                    : org.city || org.state}
                                </span>
                              </div>
                            )}
                            {typeSpecificInfo && (
                              <div className="flex items-center gap-1.5 text-muted-foreground">
                                <Package className="w-3.5 h-3.5 shrink-0" />
                                <span className="truncate">
                                  {typeSpecificInfo}
                                </span>
                              </div>
                            )}
                            {(org.activeProjectIds?.length || 0) > 0 && (
                              <div className="flex items-center gap-1.5 text-muted-foreground">
                                <Building2 className="w-3.5 h-3.5 shrink-0" />
                                <span>
                                  Projects: {org.activeProjectIds!.length}{" "}
                                  Active
                                </span>
                              </div>
                            )}
                          </div>
                          <div className="flex items-center mt-auto pt-3 border-t">
                            <span className="text-xs text-muted-foreground">
                              {statusLabel}
                            </span>
                            <div className="flex items-center gap-1 ml-auto">
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-7 text-xs"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  openOrgDetail(org);
                                }}
                                data-testid={`button-view-org-${org.id}`}
                              >
                                View
                              </Button>
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-7 text-xs"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  openEditOrg(org);
                                }}
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
          </>}
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

      {/* Duplicate Detection Dialog */}
      <Dialog open={dupOpen} onOpenChange={setDupOpen}>
        <DialogContent className="max-w-3xl max-h-[80vh] flex flex-col" data-testid="dialog-duplicates">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Copy className="w-5 h-5" />
              Potential Duplicate Organizations
            </DialogTitle>
            <DialogDescription>
              Records with similar names or shared contact information are shown below. Review each pair and merge if needed.
            </DialogDescription>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto space-y-3 pr-1">
            {dupLoading ? (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => <Skeleton key={i} className="h-20 w-full" />)}
              </div>
            ) : !dupData || dupData.pairs.length === 0 ? (
              <div className="text-center py-10 text-muted-foreground">
                <Copy className="w-10 h-10 mx-auto mb-3 opacity-40" />
                <p className="font-medium">No potential duplicates found</p>
                <p className="text-sm mt-1">All organizations appear to be unique.</p>
              </div>
            ) : (
              dupData.pairs.map((pair, idx) => (
                <div
                  key={idx}
                  className="border rounded-lg p-4 space-y-3"
                  data-testid={`dup-pair-${idx}`}
                >
                  <div className="flex items-center justify-between">
                    <Badge variant="outline" className="text-xs">
                      Matched by: {pair.matchReason}
                    </Badge>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setMergePair(pair);
                        setMergeWinnerId(pair.orgA.id);
                      }}
                      data-testid={`button-review-pair-${idx}`}
                    >
                      Review & Merge
                    </Button>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    {[pair.orgA, pair.orgB].map((org) => (
                      <div key={org.id} className="space-y-1">
                        <p className="font-semibold text-sm truncate">{org.name}</p>
                        <p className="text-xs text-muted-foreground">{org.type ?? "—"}</p>
                        {(org.city || org.state) && (
                          <p className="text-xs text-muted-foreground flex items-center gap-1">
                            <MapPin className="w-3 h-3" />
                            {[org.city, org.state].filter(Boolean).join(", ")}
                          </p>
                        )}
                        <Badge
                          variant="secondary"
                          className="text-xs"
                          data-testid={`dup-org-status-${org.id}`}
                        >
                          {org.crmStatus === "COMPLIANCE_ISSUE" ? "Compliance Issue" : org.crmStatus.charAt(0) + org.crmStatus.slice(1).toLowerCase()}
                        </Badge>
                      </div>
                    ))}
                  </div>
                </div>
              ))
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDupOpen(false)} data-testid="button-close-duplicates">
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Merge Confirmation Dialog */}
      {mergePair && (
        <Dialog open={!!mergePair} onOpenChange={(open) => { if (!open) { setMergePair(null); setMergeWinnerId(""); } }}>
          <DialogContent className="max-w-xl" data-testid="dialog-merge">
            <DialogHeader>
              <DialogTitle>Merge Organizations</DialogTitle>
              <DialogDescription>
                Choose the record to keep (winner). All contacts and notes from the other record will be moved to the winner, and the duplicate will be archived.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              {[mergePair.orgA, mergePair.orgB].map((org) => (
                <div
                  key={org.id}
                  className={`border rounded-lg p-4 cursor-pointer transition-colors ${mergeWinnerId === org.id ? "border-primary bg-primary/5" : "hover:border-muted-foreground/40"}`}
                  onClick={() => setMergeWinnerId(org.id)}
                  data-testid={`merge-option-${org.id}`}
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="font-semibold">{org.name}</p>
                      <p className="text-sm text-muted-foreground">{org.type ?? "—"}{org.city ? ` · ${org.city}${org.state ? `, ${org.state}` : ""}` : ""}</p>
                    </div>
                    {mergeWinnerId === org.id && (
                      <Badge className="shrink-0" data-testid={`badge-winner-${org.id}`}>Keep (Winner)</Badge>
                    )}
                  </div>
                </div>
              ))}
              <p className="text-xs text-muted-foreground pt-1">
                The record not selected will be archived. This action cannot be undone.
              </p>
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => { setMergePair(null); setMergeWinnerId(""); }}
                data-testid="button-cancel-merge"
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                disabled={!mergeWinnerId || mergeMutation.isPending}
                onClick={() => {
                  const loserId = mergeWinnerId === mergePair.orgA.id ? mergePair.orgB.id : mergePair.orgA.id;
                  mergeMutation.mutate({ winnerId: mergeWinnerId, loserId });
                }}
                data-testid="button-confirm-merge"
              >
                {mergeMutation.isPending ? "Merging..." : "Merge & Archive Duplicate"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
