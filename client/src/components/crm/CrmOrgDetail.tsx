import { useState, useMemo, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator } from "@/components/ui/command";
import {
  Building2, Plus, Edit, Trash2, User, MapPin, Globe, Shield, FileText,
  ChevronRight, DollarSign, Truck, Package, Calendar, Check, ChevronsUpDown,
  Link2, Send, CheckCircle, XCircle, Clock as ClockIcon, UserPlus, Store, MessageSquare, Clock, X, FolderOpen,
  Mail, CalendarDays, ExternalLink, Wifi, WifiOff
} from "lucide-react";
import { Calendar as CalendarPicker } from "@/components/ui/calendar";
import { Calendar as CalendarIcon } from "lucide-react";
import type { CrmOrganisation as CrmOrganization, CrmContact, CrmOrganisationNote, VendorPricingCatalog, RentalEquipmentCatalog, Project } from "@shared/schema";
import { format, formatDistanceToNow, parseISO } from "date-fns";
import { cn } from "@/lib/utils";

type OrganizationType = "CONTRACTOR" | "SUBCONTRACTOR" | "SUPPLIER" | "VENDOR" | "OWNER_REP" | "RENTAL_VENDOR";
type ContactRole = "PM" | "ESTIMATOR" | "SUPERINTENDENT" | "SALES" | "ACCOUNTS_PAYABLE" | "ACCOUNTS_RECEIVABLE" | "OWNER" | "GENERAL_MANAGER" | "FOREMAN" | "OTHER";
type NoteType = "CALL" | "EMAIL" | "MEETING" | "HOT_LEAD" | "COLD_LEAD" | "FOLLOW_UP" | "ISSUE" | "GENERAL";

interface OrgNote extends CrmOrganisationNote {
  createdByFirstName: string | null;
  createdByLastName: string | null;
  contactFirstName: string | null;
  contactLastName: string | null;
}

interface OrganizationWithContacts extends CrmOrganization {
  contacts: CrmContact[];
}

interface VendorEnrollment {
  id: string;
  vendorCrmOrganisationId: string;
  contractorOrganizationId: string;
  status: 'INVITED' | 'ACTIVE' | 'SUSPENDED';
  autoApproveNewPricing: boolean;
  invitedAt: string;
  enrolledAt: string | null;
  suspendedAt: string | null;
  vendorName?: string;
  vendorUserEmail?: string;
}

interface VendorPricingSubmission extends VendorPricingCatalog {
  submittedByEmail?: string;
  submittedByName?: string;
}

interface StandardPricingItem {
  name: string;
  category: string;
  unit: string;
}

const TYPE_COLORS: Record<OrganizationType, string> = {
  CONTRACTOR: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  SUBCONTRACTOR: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  SUPPLIER: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200",
  VENDOR: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200",
  OWNER_REP: "bg-cyan-100 text-cyan-800 dark:bg-cyan-900 dark:text-cyan-200",
  RENTAL_VENDOR: "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200",
};

const TYPE_LABELS: Record<OrganizationType, string> = {
  CONTRACTOR: "GC / Contractor",
  SUBCONTRACTOR: "Subcontractor",
  SUPPLIER: "Supplier",
  VENDOR: "Vendor",
  OWNER_REP: "Owner Rep",
  RENTAL_VENDOR: "Rental Vendor",
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

const NOTE_TYPE_LABELS: Record<NoteType, string> = {
  CALL: "Phone Call",
  EMAIL: "Email",
  MEETING: "Meeting",
  HOT_LEAD: "Hot Lead",
  COLD_LEAD: "Cold Lead",
  FOLLOW_UP: "Follow Up",
  ISSUE: "Issue",
  GENERAL: "General",
};

const NOTE_TYPE_COLORS: Record<NoteType, string> = {
  CALL: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  EMAIL: "bg-cyan-100 text-cyan-800 dark:bg-cyan-900 dark:text-cyan-200",
  MEETING: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200",
  HOT_LEAD: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
  COLD_LEAD: "bg-slate-100 text-slate-800 dark:bg-slate-900 dark:text-slate-200",
  FOLLOW_UP: "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200",
  ISSUE: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200",
  GENERAL: "bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200",
};

const STANDARD_PRICING_ITEMS: { category: string; items: StandardPricingItem[] }[] = [
  {
    category: "CONCRETE",
    items: [
      { name: "Ready Mix Concrete 3000 PSI", category: "CONCRETE", unit: "YARD" },
      { name: "Ready Mix Concrete 3500 PSI", category: "CONCRETE", unit: "YARD" },
      { name: "Ready Mix Concrete 4000 PSI", category: "CONCRETE", unit: "YARD" },
      { name: "Ready Mix Concrete 4500 PSI", category: "CONCRETE", unit: "YARD" },
      { name: "Ready Mix Concrete 5000 PSI", category: "CONCRETE", unit: "YARD" },
      { name: "Fiber Mesh Concrete", category: "CONCRETE", unit: "YARD" },
      { name: "Colored Concrete", category: "CONCRETE", unit: "YARD" },
      { name: "Pump Truck Fee", category: "CONCRETE", unit: "EA" },
      { name: "Short Load Fee", category: "CONCRETE", unit: "EA" },
      { name: "Overtime/Saturday Delivery", category: "CONCRETE", unit: "EA" },
    ],
  },
  {
    category: "STONE",
    items: [
      { name: "Crushed Stone #57", category: "STONE", unit: "TON" },
      { name: "Crushed Stone #8", category: "STONE", unit: "TON" },
      { name: "Crushed Limestone", category: "STONE", unit: "TON" },
      { name: "Compacted Base Material", category: "STONE", unit: "TON" },
      { name: "Pea Gravel", category: "STONE", unit: "TON" },
      { name: "Recycled Concrete Aggregate", category: "STONE", unit: "TON" },
      { name: "Sand - Mason", category: "STONE", unit: "TON" },
      { name: "Sand - Fill", category: "STONE", unit: "TON" },
      { name: "Topsoil", category: "STONE", unit: "YARD" },
    ],
  },
  {
    category: "REBAR",
    items: [
      { name: "Rebar #3 (3/8\")", category: "REBAR", unit: "LF" },
      { name: "Rebar #4 (1/2\")", category: "REBAR", unit: "LF" },
      { name: "Rebar #5 (5/8\")", category: "REBAR", unit: "LF" },
      { name: "Rebar #6 (3/4\")", category: "REBAR", unit: "LF" },
      { name: "Rebar #7 (7/8\")", category: "REBAR", unit: "LF" },
      { name: "Rebar #8 (1\")", category: "REBAR", unit: "LF" },
      { name: "Dowel Bars 18\" x 1/2\"", category: "REBAR", unit: "EA" },
      { name: "Dowel Bars 18\" x 5/8\"", category: "REBAR", unit: "EA" },
      { name: "Tie Wire", category: "REBAR", unit: "ROLL" },
      { name: "Rebar Chairs", category: "REBAR", unit: "EA" },
    ],
  },
  {
    category: "WIRE_MESH",
    items: [
      { name: "Wire Mesh 6x6 W1.4/W1.4", category: "WIRE_MESH", unit: "ROLL" },
      { name: "Wire Mesh 6x6 W2.9/W2.9", category: "WIRE_MESH", unit: "ROLL" },
      { name: "Wire Mesh 6x6 W4.0/W4.0", category: "WIRE_MESH", unit: "ROLL" },
      { name: "Fiber Mesh - Synthetic", category: "WIRE_MESH", unit: "BAG" },
      { name: "Fiber Mesh - Steel", category: "WIRE_MESH", unit: "BAG" },
    ],
  },
  {
    category: "SEALER",
    items: [
      { name: "Cure & Seal Clear", category: "SEALER", unit: "GAL" },
      { name: "Cure & Seal White Pigmented", category: "SEALER", unit: "GAL" },
      { name: "Acrylic Sealer", category: "SEALER", unit: "GAL" },
      { name: "Penetrating Sealer", category: "SEALER", unit: "GAL" },
      { name: "Polyurethane Sealer", category: "SEALER", unit: "GAL" },
      { name: "Epoxy Sealer", category: "SEALER", unit: "GAL" },
      { name: "Joint Sealant", category: "SEALER", unit: "GAL" },
      { name: "Backer Rod", category: "SEALER", unit: "LF" },
    ],
  },
  {
    category: "LUMBER",
    items: [
      { name: "Form Lumber 2x4", category: "LUMBER", unit: "LF" },
      { name: "Form Lumber 2x6", category: "LUMBER", unit: "LF" },
      { name: "Form Lumber 2x8", category: "LUMBER", unit: "LF" },
      { name: "Form Lumber 2x10", category: "LUMBER", unit: "LF" },
      { name: "Form Lumber 2x12", category: "LUMBER", unit: "LF" },
      { name: "Plywood 3/4\" CDX", category: "LUMBER", unit: "EA" },
      { name: "Stakes - Wood", category: "LUMBER", unit: "EA" },
      { name: "Stakes - Steel", category: "LUMBER", unit: "EA" },
    ],
  },
  {
    category: "FILL",
    items: [
      { name: "Clean Fill", category: "FILL", unit: "YARD" },
      { name: "Structural Fill", category: "FILL", unit: "YARD" },
      { name: "Select Fill", category: "FILL", unit: "YARD" },
      { name: "Flowable Fill", category: "FILL", unit: "YARD" },
      { name: "Gravel Fill", category: "FILL", unit: "TON" },
    ],
  },
  {
    category: "EQUIPMENT",
    items: [
      { name: "Concrete Mixer Truck", category: "EQUIPMENT", unit: "EA" },
      { name: "Concrete Pump - Line", category: "EQUIPMENT", unit: "EA" },
      { name: "Concrete Pump - Boom", category: "EQUIPMENT", unit: "EA" },
      { name: "Excavator Rental", category: "EQUIPMENT", unit: "EA" },
      { name: "Skid Steer Rental", category: "EQUIPMENT", unit: "EA" },
      { name: "Compactor Rental", category: "EQUIPMENT", unit: "EA" },
    ],
  },
  {
    category: "OTHER",
    items: [
      { name: "Expansion Joint Material", category: "OTHER", unit: "LF" },
      { name: "Vapor Barrier 6 mil", category: "OTHER", unit: "SF" },
      { name: "Vapor Barrier 10 mil", category: "OTHER", unit: "SF" },
      { name: "Form Release Agent", category: "OTHER", unit: "GAL" },
      { name: "Concrete Blankets", category: "OTHER", unit: "EA" },
      { name: "Plastic Sheeting", category: "OTHER", unit: "ROLL" },
    ],
  },
];

interface CrmOrgDetailProps {
  detailOrgOpen: boolean;
  setDetailOrgOpen: (open: boolean) => void;
  selectedOrg: OrganizationWithContacts | null;
  allProjects: Project[];
  openEditOrg: (org: CrmOrganization) => void;
  openEditContact: (contact: CrmContact) => void;
  setCreateContactOpen: (open: boolean) => void;
  resetNewContact: () => void;
  setSelectedContact: (contact: CrmContact) => void;
  setViewContactOpen: (open: boolean) => void;
  mutations: any;
}

export function CrmOrgDetail({
  detailOrgOpen,
  setDetailOrgOpen,
  selectedOrg,
  allProjects,
  openEditOrg,
  openEditContact,
  setCreateContactOpen,
  resetNewContact,
  setSelectedContact,
  setViewContactOpen,
  mutations,
}: CrmOrgDetailProps) {
  const {
    deleteOrgMutation, deleteContactMutation, createNoteMutation, deleteNoteMutation,
    createPricingMutation, updatePricingMutation, deletePricingMutation,
    createRentalMutation, updateRentalMutation, deleteRentalMutation,
    inviteVendorMutation, updateEnrollmentMutation, suspendEnrollmentMutation,
    reactivateEnrollmentMutation, approvePricingMutation, rejectPricingMutation,
  } = mutations;

  const [newNote, setNewNote] = useState({
    noteType: "GENERAL" as NoteType,
    content: "",
    contactId: undefined as string | undefined,
  });

  const [inviteVendorOpen, setInviteVendorOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [autoApprove, setAutoApprove] = useState(false);

  const [pricingDialogOpen, setPricingDialogOpen] = useState(false);
  const [editingPricing, setEditingPricing] = useState<VendorPricingCatalog | null>(null);
  const [itemNamePopoverOpen, setItemNamePopoverOpen] = useState(false);
  const [isCustomItemName, setIsCustomItemName] = useState(false);
  const [newPricing, setNewPricing] = useState({
    itemName: "", itemCode: "", category: "CONCRETE", description: "", unit: "YARD",
    unitPrice: "", minimumOrder: "", deliveryFee: "", effectiveQuarter: "",
    effectiveDate: new Date().toISOString().split('T')[0], leadTimeDays: "",
  });

  const [rentalDialogOpen, setRentalDialogOpen] = useState(false);
  const [editingRental, setEditingRental] = useState<RentalEquipmentCatalog | null>(null);
  const [newRental, setNewRental] = useState({
    name: "", equipmentType: "HEAVY_EQUIPMENT", make: "", model: "", description: "",
    hourlyRate: "", dailyRate: "", weeklyRate: "", monthlyRate: "",
    deliveryFee: "", pickupFee: "", minimumRentalDays: "1",
  });

  const allStandardItems = useMemo(() =>
    STANDARD_PRICING_ITEMS.flatMap(group => group.items), []
  );

  const handleStandardItemSelect = (item: StandardPricingItem) => {
    setNewPricing(prev => ({ ...prev, itemName: item.name, category: item.category, unit: item.unit }));
    setIsCustomItemName(false);
    setItemNamePopoverOpen(false);
  };

  const handleCustomItemName = (name: string) => {
    setNewPricing(prev => ({ ...prev, itemName: name }));
    setIsCustomItemName(true);
  };

  const resetNewPricing = () => {
    const now = new Date();
    const quarter = `${now.getFullYear()}-Q${Math.floor(now.getMonth() / 3) + 1}`;
    setNewPricing({
      itemName: "", itemCode: "", category: "CONCRETE", description: "", unit: "YARD",
      unitPrice: "", minimumOrder: "", deliveryFee: "", effectiveQuarter: quarter,
      effectiveDate: now.toISOString().split('T')[0], leadTimeDays: "",
    });
    setIsCustomItemName(false);
  };

  const resetNewRental = () => {
    setNewRental({
      name: "", equipmentType: "HEAVY_EQUIPMENT", make: "", model: "", description: "",
      hourlyRate: "", dailyRate: "", weeklyRate: "", monthlyRate: "",
      deliveryFee: "", pickupFee: "", minimumRentalDays: "1",
    });
  };

  const resetNewNote = () => {
    setNewNote({ noteType: "GENERAL", content: "", contactId: undefined });
  };

  const { data: orgDetail, isLoading: orgDetailLoading } = useQuery<OrganizationWithContacts>({
    queryKey: [`/api/crm/organisations/${selectedOrg?.id}`],
    enabled: !!selectedOrg?.id && detailOrgOpen,
  });

  const { data: orgNotes = [], isLoading: notesLoading } = useQuery<OrgNote[]>({
    queryKey: [`/api/crm/organisations/${selectedOrg?.id}/notes`],
    enabled: !!selectedOrg?.id && detailOrgOpen,
  });

  const showPricingTab = selectedOrg?.type === "SUPPLIER" || selectedOrg?.type === "VENDOR";
  const { data: vendorPricing = [], isLoading: pricingLoading } = useQuery<VendorPricingCatalog[]>({
    queryKey: [`/api/crm/organisations/${selectedOrg?.id}/pricing`],
    enabled: !!selectedOrg?.id && detailOrgOpen && showPricingTab,
  });

  const showRentalTab = selectedOrg?.type === "RENTAL_VENDOR" || selectedOrg?.type === "VENDOR";
  const { data: rentalCatalog = [], isLoading: rentalLoading } = useQuery<RentalEquipmentCatalog[]>({
    queryKey: [`/api/crm/organisations/${selectedOrg?.id}/rental-catalog`],
    enabled: !!selectedOrg?.id && detailOrgOpen && showRentalTab,
  });

  const showPortalTab = selectedOrg?.type === "SUPPLIER" || selectedOrg?.type === "VENDOR";
  const { data: vendorEnrollment, isLoading: enrollmentLoading } = useQuery<VendorEnrollment | null>({
    queryKey: [`/api/vendor-enrollments/by-crm-org/${selectedOrg?.id}`],
    enabled: !!selectedOrg?.id && detailOrgOpen && showPortalTab,
  });

  const { data: pendingSubmissions = [], isLoading: submissionsLoading } = useQuery<VendorPricingSubmission[]>({
    queryKey: [`/api/crm/organisations/${selectedOrg?.id}/pricing/pending`],
    enabled: !!selectedOrg?.id && detailOrgOpen && showPortalTab && !!vendorEnrollment,
  });

  interface IntegrationConnection { provider: string; status: string; }
  const { data: integrationConnections = [] } = useQuery<IntegrationConnection[]>({
    queryKey: ["/api/integrations/connections"],
    enabled: detailOrgOpen,
  });
  const hasEmailIntegration = integrationConnections.some(
    (c) => (c.provider === "google" || c.provider === "microsoft") && (c.status === "active" || c.status === "connected")
  );

  interface CommEmail {
    threadId: string;
    subject: string;
    lastMessageAt: string;
    messageCount: number;
    aiSummary: string | null;
    status: string;
    fromAddress: string | null;
    fromName: string | null;
    snippet: string | null;
    receivedAt: string | null;
  }
  interface CommEvent {
    id: string;
    title: string;
    description: string | null;
    startDate: string;
    endDate: string | null;
    allDay: boolean;
    eventType: string;
    projectId: string | null;
    crmOrganisationId: string | null;
  }
  interface CommunicationsPagination { page: number; pageSize: number; total: number; hasMore: boolean; }
  interface CommunicationsData { emails: CommEmail[]; upcomingEvents: CommEvent[]; pagination: CommunicationsPagination; }
  const [activeOrgTab, setActiveOrgTab] = useState("info");
  const [commsPage, setCommsPage] = useState(1);
  const [accumulatedEmails, setAccumulatedEmails] = useState<CommEmail[]>([]);
  useEffect(() => {
    setActiveOrgTab("info");
    setCommsPage(1);
    setAccumulatedEmails([]);
  }, [selectedOrg?.id]);

  useEffect(() => {
    const conditionalTabs = [
      !showPricingTab && "pricing",
      !showRentalTab && "rental",
      !showPortalTab && "portal",
    ].filter(Boolean) as string[];
    if (conditionalTabs.includes(activeOrgTab)) {
      setActiveOrgTab("info");
    }
  }, [showPricingTab, showRentalTab, showPortalTab, activeOrgTab]);
  const { data: commsData, isLoading: commsLoading } = useQuery<CommunicationsData>({
    queryKey: [`/api/crm/organisations/${selectedOrg?.id}/communications`, { page: commsPage }],
    queryFn: async () => {
      const url = `/api/crm/organisations/${selectedOrg?.id}/communications?page=${commsPage}&pageSize=20`;
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch communications");
      return res.json();
    },
    enabled: !!selectedOrg?.id && detailOrgOpen && hasEmailIntegration,
  });
  useEffect(() => {
    if (commsData?.emails) {
      if (commsPage === 1) {
        setAccumulatedEmails(commsData.emails);
      } else {
        setAccumulatedEmails((prev) => {
          const existingIds = new Set(prev.map((e) => e.threadId));
          const newEmails = commsData.emails.filter((e) => !existingIds.has(e.threadId));
          return [...prev, ...newEmails];
        });
      }
    }
  }, [commsData, commsPage]);

  return (
    <>
      <Dialog open={detailOrgOpen} onOpenChange={setDetailOrgOpen}>
        <DialogContent className="sm:max-w-3xl">
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

          <Tabs value={activeOrgTab} onValueChange={setActiveOrgTab} className="mt-4">
            <Select value={activeOrgTab} onValueChange={setActiveOrgTab} data-testid="select-org-tab">
              <SelectTrigger className="w-full sm:w-64" data-testid="trigger-org-tab">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="info">Organization Info</SelectItem>
                <SelectItem value="contacts">
                  Contacts ({orgDetail?.contacts?.length || 0})
                </SelectItem>
                <SelectItem value="activity" data-testid="tab-activity">
                  Activity ({orgNotes.length})
                </SelectItem>
                {showPricingTab && (
                  <SelectItem value="pricing" data-testid="tab-pricing">
                    Pricing ({vendorPricing.length})
                  </SelectItem>
                )}
                {showRentalTab && (
                  <SelectItem value="rental" data-testid="tab-rental">
                    Rentals ({rentalCatalog.length})
                  </SelectItem>
                )}
                {showPortalTab && (
                  <SelectItem value="portal" data-testid="tab-portal">
                    Portal Access
                  </SelectItem>
                )}
                <SelectItem value="communications" data-testid="tab-communications">
                  Communications
                </SelectItem>
              </SelectContent>
            </Select>

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
                {selectedOrg?.licenseNumber && (
                  <div className="flex items-start gap-2">
                    <FileText className="w-4 h-4 mt-1 text-muted-foreground" />
                    <div>
                      <p className="text-sm font-medium">License #</p>
                      <p className="text-sm text-muted-foreground">{selectedOrg.licenseNumber}</p>
                    </div>
                  </div>
                )}
                {selectedOrg?.bondingCapacity && (
                  <div className="flex items-start gap-2">
                    <Shield className="w-4 h-4 mt-1 text-muted-foreground" />
                    <div>
                      <p className="text-sm font-medium">Bonding Capacity</p>
                      <p className="text-sm text-muted-foreground">{selectedOrg.bondingCapacity}</p>
                    </div>
                  </div>
                )}
                {selectedOrg?.insuranceExpiration && (
                  <div className="flex items-start gap-2">
                    <Calendar className="w-4 h-4 mt-1 text-muted-foreground" />
                    <div>
                      <p className="text-sm font-medium">Insurance Expiration</p>
                      <p className="text-sm text-muted-foreground">{new Date(selectedOrg.insuranceExpiration).toLocaleDateString()}</p>
                    </div>
                  </div>
                )}
                {selectedOrg?.tradeSpecialty && (
                  <div className="flex items-start gap-2">
                    <Package className="w-4 h-4 mt-1 text-muted-foreground" />
                    <div>
                      <p className="text-sm font-medium">Trade Specialty</p>
                      <p className="text-sm text-muted-foreground">{selectedOrg.tradeSpecialty}</p>
                    </div>
                  </div>
                )}
                {selectedOrg?.serviceCategory && (
                  <div className="flex items-start gap-2">
                    <Package className="w-4 h-4 mt-1 text-muted-foreground" />
                    <div>
                      <p className="text-sm font-medium">Service Category</p>
                      <p className="text-sm text-muted-foreground">{selectedOrg.serviceCategory}</p>
                    </div>
                  </div>
                )}
                {selectedOrg?.contractExpiration && (
                  <div className="flex items-start gap-2">
                    <Calendar className="w-4 h-4 mt-1 text-muted-foreground" />
                    <div>
                      <p className="text-sm font-medium">Contract Expiration</p>
                      <p className="text-sm text-muted-foreground">{new Date(selectedOrg.contractExpiration).toLocaleDateString()}</p>
                    </div>
                  </div>
                )}
                {selectedOrg?.equipmentCategory && (
                  <div className="flex items-start gap-2">
                    <Truck className="w-4 h-4 mt-1 text-muted-foreground" />
                    <div>
                      <p className="text-sm font-medium">Equipment Category</p>
                      <p className="text-sm text-muted-foreground">{selectedOrg.equipmentCategory}</p>
                    </div>
                  </div>
                )}
                {selectedOrg?.rentalTerms && (
                  <div className="flex items-start gap-2">
                    <FileText className="w-4 h-4 mt-1 text-muted-foreground" />
                    <div>
                      <p className="text-sm font-medium">Rental Terms</p>
                      <p className="text-sm text-muted-foreground">{selectedOrg.rentalTerms}</p>
                    </div>
                  </div>
                )}
                {selectedOrg?.companyRepresented && (
                  <div className="flex items-start gap-2">
                    <Building2 className="w-4 h-4 mt-1 text-muted-foreground" />
                    <div>
                      <p className="text-sm font-medium">Company Represented</p>
                      <p className="text-sm text-muted-foreground">{selectedOrg.companyRepresented}</p>
                    </div>
                  </div>
                )}
              </div>

              {selectedOrg?.materialCategories && selectedOrg.materialCategories.length > 0 && (
                <div>
                  <p className="text-sm font-medium mb-2">Material Categories</p>
                  <div className="flex flex-wrap gap-2">
                    {selectedOrg.materialCategories.map((cat: string, i: number) => (
                      <Badge key={i} variant="secondary">{cat}</Badge>
                    ))}
                  </div>
                </div>
              )}

              <div>
                <p className="text-sm font-medium mb-2 flex items-center gap-1.5">
                  <FolderOpen className="w-4 h-4 text-muted-foreground" />
                  Related Projects
                </p>
                {(() => {
                  const relatedProjects = allProjects.filter(p =>
                    selectedOrg?.activeProjectIds?.includes(p.id)
                  );
                  const statusColors: Record<string, string> = {
                    BID: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
                    PLANNING: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
                    ACTIVE: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
                    COMPLETE: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200",
                    CLOSED: "bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200",
                  };
                  if (relatedProjects.length === 0) {
                    return (
                      <p className="text-sm text-muted-foreground italic">No active projects linked to this organization.</p>
                    );
                  }
                  return (
                    <div className="space-y-1.5">
                      {relatedProjects.map(proj => (
                        <div key={proj.id} className="flex items-center gap-2 text-sm group">
                          <Badge className={`text-xs shrink-0 ${statusColors[proj.status] || statusColors.ACTIVE}`}>
                            {proj.status}
                          </Badge>
                          <a
                            href={`/projects/${proj.code}`}
                            className="font-medium text-primary hover:underline truncate"
                            data-testid={`link-related-project-${proj.id}`}
                          >
                            {proj.name}
                          </a>
                          <ChevronRight className="w-3 h-3 text-muted-foreground opacity-0 group-hover:opacity-100 shrink-0 ml-auto" />
                        </div>
                      ))}
                    </div>
                  );
                })()}
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
                              onClick={(e) => { e.stopPropagation(); openEditContact(contact); }}
                              data-testid={`button-edit-contact-${contact.id}`}
                            >
                              <Edit className="w-4 h-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={(e) => { e.stopPropagation(); deleteContactMutation.mutate(contact.id); }}
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

            <TabsContent value="activity" className="mt-4">
              <div className="space-y-4">
                <Card>
                  <CardContent className="p-4 space-y-3">
                    <div className="flex items-center gap-2 mb-2">
                      <MessageSquare className="w-4 h-4 text-muted-foreground" />
                      <span className="text-sm font-medium">Add Activity Note</span>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <Label className="text-xs">Type</Label>
                        <Select
                          value={newNote.noteType}
                          onValueChange={(v) => setNewNote({ ...newNote, noteType: v as NoteType })}
                        >
                          <SelectTrigger data-testid="select-note-type">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="CALL">Phone Call</SelectItem>
                            <SelectItem value="EMAIL">Email</SelectItem>
                            <SelectItem value="MEETING">Meeting</SelectItem>
                            <SelectItem value="HOT_LEAD">Hot Lead</SelectItem>
                            <SelectItem value="COLD_LEAD">Cold Lead</SelectItem>
                            <SelectItem value="FOLLOW_UP">Follow Up</SelectItem>
                            <SelectItem value="ISSUE">Issue</SelectItem>
                            <SelectItem value="GENERAL">General</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Related Contact (Optional)</Label>
                        <Select
                          value={newNote.contactId || "none"}
                          onValueChange={(v) => setNewNote({ ...newNote, contactId: v === "none" ? undefined : v })}
                        >
                          <SelectTrigger data-testid="select-note-contact">
                            <SelectValue placeholder="Select contact..." />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">None</SelectItem>
                            {orgDetail?.contacts?.map((contact) => (
                              <SelectItem key={contact.id} value={contact.id}>
                                {contact.firstName} {contact.lastName}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <Textarea
                      value={newNote.content}
                      onChange={(e) => setNewNote({ ...newNote, content: e.target.value })}
                      placeholder="Enter your note... (e.g., 'Called about upcoming project, they're interested in bidding next month')"
                      className="min-h-[80px]"
                      data-testid="input-note-content"
                    />
                    <Button
                      onClick={() => { createNoteMutation.mutate(newNote); resetNewNote(); }}
                      disabled={!newNote.content.trim() || createNoteMutation.isPending}
                      className="w-full"
                      data-testid="button-add-note"
                    >
                      {createNoteMutation.isPending ? "Adding..." : "Add Note"}
                    </Button>
                  </CardContent>
                </Card>

                {notesLoading ? (
                  <div className="space-y-2">
                    {[1, 2, 3].map((i) => <Skeleton key={i} className="h-20 w-full" />)}
                  </div>
                ) : orgNotes.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    <Clock className="w-12 h-12 mx-auto mb-2 opacity-50" />
                    <p>No activity notes yet</p>
                    <p className="text-sm">Add notes above to track your interactions</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {orgNotes.map((note) => (
                      <Card key={note.id} className="relative" data-testid={`card-note-${note.id}`}>
                        <CardContent className="p-4">
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap mb-1">
                                <Badge className={NOTE_TYPE_COLORS[note.noteType as NoteType]}>
                                  {NOTE_TYPE_LABELS[note.noteType as NoteType]}
                                </Badge>
                                {note.contactFirstName && note.contactLastName && (
                                  <Badge variant="outline" className="text-xs">
                                    <User className="w-3 h-3 mr-1" />
                                    {note.contactFirstName} {note.contactLastName}
                                  </Badge>
                                )}
                              </div>
                              <p className="text-sm mt-2 whitespace-pre-wrap">{note.content}</p>
                              <div className="flex items-center gap-2 mt-2 text-xs text-muted-foreground">
                                <span>
                                  {note.createdByFirstName && note.createdByLastName
                                    ? `${note.createdByFirstName} ${note.createdByLastName}`
                                    : 'Unknown'}
                                </span>
                                <span>•</span>
                                <span title={format(new Date(note.createdAt), 'PPpp')}>
                                  {formatDistanceToNow(new Date(note.createdAt), { addSuffix: true })}
                                </span>
                              </div>
                            </div>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="shrink-0"
                              onClick={() => deleteNoteMutation.mutate(note.id)}
                              disabled={deleteNoteMutation.isPending}
                              data-testid={`button-delete-note-${note.id}`}
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )}
              </div>
            </TabsContent>

            {showPricingTab && (
              <TabsContent value="pricing" className="mt-4">
                <div className="flex items-center justify-between mb-4">
                  <p className="text-sm text-muted-foreground">
                    Manage quarterly pricing for materials and supplies
                  </p>
                  <Button size="sm" onClick={() => { resetNewPricing(); setPricingDialogOpen(true); }} data-testid="button-add-pricing">
                    <Plus className="w-4 h-4 mr-1" />
                    Add Pricing
                  </Button>
                </div>

                {pricingLoading ? (
                  <div className="space-y-2">
                    {[1, 2].map((i) => <Skeleton key={i} className="h-16 w-full" />)}
                  </div>
                ) : vendorPricing.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    <DollarSign className="w-12 h-12 mx-auto mb-2 opacity-50" />
                    <p>No pricing items yet</p>
                    <p className="text-sm">Add pricing items to use in bid estimates</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {vendorPricing.map((item) => (
                      <Card key={item.id} className="hover-elevate" data-testid={`card-pricing-${item.id}`}>
                        <CardContent className="p-4">
                          <div className="flex items-start justify-between">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap mb-1">
                                <span className="font-medium">{item.itemName}</span>
                                {item.itemCode && (
                                  <Badge variant="outline" className="text-xs">{item.itemCode}</Badge>
                                )}
                                <Badge variant="secondary" className="text-xs">{item.category}</Badge>
                              </div>
                              <div className="flex items-center gap-4 text-sm text-muted-foreground mt-1">
                                <span className="font-semibold text-foreground">
                                  ${parseFloat(item.unitPrice || "0").toFixed(2)} / {item.unit}
                                </span>
                                {item.effectiveQuarter && (
                                  <span className="flex items-center gap-1">
                                    <Calendar className="w-3 h-3" />
                                    {item.effectiveQuarter}
                                  </span>
                                )}
                                {item.leadTimeDays && (
                                  <span>{item.leadTimeDays} day lead</span>
                                )}
                              </div>
                              {item.description && (
                                <p className="text-xs text-muted-foreground mt-1">{item.description}</p>
                              )}
                            </div>
                            <div className="flex items-center gap-1">
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => {
                                  setEditingPricing(item);
                                  const isStandard = allStandardItems.some(si => si.name === item.itemName);
                                  setIsCustomItemName(!isStandard);
                                  setNewPricing({
                                    itemName: item.itemName,
                                    itemCode: item.itemCode || "",
                                    category: item.category,
                                    description: item.description || "",
                                    unit: item.unit,
                                    unitPrice: item.unitPrice || "",
                                    minimumOrder: item.minimumOrder || "",
                                    deliveryFee: item.deliveryFee || "",
                                    effectiveQuarter: item.effectiveQuarter || "",
                                    effectiveDate: item.effectiveDate ? new Date(item.effectiveDate).toISOString().split('T')[0] : new Date().toISOString().split('T')[0],
                                    leadTimeDays: item.leadTimeDays?.toString() || "",
                                  });
                                  setPricingDialogOpen(true);
                                }}
                                data-testid={`button-edit-pricing-${item.id}`}
                              >
                                <Edit className="w-4 h-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => deletePricingMutation.mutate(item.id)}
                                disabled={deletePricingMutation.isPending}
                                data-testid={`button-delete-pricing-${item.id}`}
                              >
                                <Trash2 className="w-4 h-4" />
                              </Button>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )}
              </TabsContent>
            )}

            {showRentalTab && (
              <TabsContent value="rental" className="mt-4">
                <div className="flex items-center justify-between mb-4">
                  <p className="text-sm text-muted-foreground">
                    Manage rental equipment catalog for this vendor
                  </p>
                  <Button size="sm" onClick={() => { resetNewRental(); setRentalDialogOpen(true); }} data-testid="button-add-rental">
                    <Plus className="w-4 h-4 mr-1" />
                    Add Equipment
                  </Button>
                </div>

                {rentalLoading ? (
                  <div className="space-y-2">
                    {[1, 2].map((i) => <Skeleton key={i} className="h-16 w-full" />)}
                  </div>
                ) : rentalCatalog.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    <Truck className="w-12 h-12 mx-auto mb-2 opacity-50" />
                    <p>No rental equipment yet</p>
                    <p className="text-sm">Add rental equipment to use in bid estimates</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {rentalCatalog.map((item) => (
                      <Card key={item.id} className="hover-elevate" data-testid={`card-rental-${item.id}`}>
                        <CardContent className="p-4">
                          <div className="flex items-start justify-between">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap mb-1">
                                <span className="font-medium">{item.name}</span>
                                <Badge variant="secondary" className="text-xs">{item.equipmentType?.replace(/_/g, ' ')}</Badge>
                              </div>
                              <div className="text-sm text-muted-foreground">
                                {item.make && item.model && <span>{item.make} {item.model}</span>}
                              </div>
                              <div className="flex items-center gap-3 text-sm mt-1 flex-wrap">
                                {item.dailyRate && (
                                  <span><span className="font-medium">${parseFloat(item.dailyRate).toFixed(0)}</span>/day</span>
                                )}
                                {item.weeklyRate && (
                                  <span><span className="font-medium">${parseFloat(item.weeklyRate).toFixed(0)}</span>/week</span>
                                )}
                                {item.monthlyRate && (
                                  <span><span className="font-medium">${parseFloat(item.monthlyRate).toFixed(0)}</span>/month</span>
                                )}
                              </div>
                              {item.description && (
                                <p className="text-xs text-muted-foreground mt-1">{item.description}</p>
                              )}
                            </div>
                            <div className="flex items-center gap-1">
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => {
                                  setEditingRental(item);
                                  setNewRental({
                                    name: item.name,
                                    equipmentType: item.equipmentType || "HEAVY_EQUIPMENT",
                                    make: item.make || "",
                                    model: item.model || "",
                                    description: item.description || "",
                                    hourlyRate: item.hourlyRate || "",
                                    dailyRate: item.dailyRate || "",
                                    weeklyRate: item.weeklyRate || "",
                                    monthlyRate: item.monthlyRate || "",
                                    deliveryFee: item.deliveryFee || "",
                                    pickupFee: item.pickupFee || "",
                                    minimumRentalDays: item.minimumRentalDays?.toString() || "1",
                                  });
                                  setRentalDialogOpen(true);
                                }}
                                data-testid={`button-edit-rental-${item.id}`}
                              >
                                <Edit className="w-4 h-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => deleteRentalMutation.mutate(item.id)}
                                disabled={deleteRentalMutation.isPending}
                                data-testid={`button-delete-rental-${item.id}`}
                              >
                                <Trash2 className="w-4 h-4" />
                              </Button>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )}
              </TabsContent>
            )}

            {showPortalTab && (
              <TabsContent value="portal" className="mt-4">
                <div className="space-y-6">
                  {enrollmentLoading ? (
                    <div className="space-y-4">
                      <Skeleton className="h-24 w-full" />
                      <Skeleton className="h-48 w-full" />
                    </div>
                  ) : !vendorEnrollment ? (
                    <Card>
                      <CardContent className="p-6">
                        <div className="text-center">
                          <Store className="w-12 h-12 mx-auto mb-4 text-muted-foreground opacity-50" />
                          <h3 className="font-medium text-lg mb-2">Vendor Portal Not Connected</h3>
                          <p className="text-sm text-muted-foreground mb-4">
                            Enable this vendor to submit pricing directly to your catalog through their own portal.
                          </p>
                          <Button onClick={() => setInviteVendorOpen(true)} data-testid="button-invite-vendor">
                            <UserPlus className="w-4 h-4 mr-2" />
                            Invite to Vendor Portal
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  ) : (
                    <>
                      <Card>
                        <CardHeader className="pb-3">
                          <div className="flex items-start justify-between">
                            <div>
                              <CardTitle className="text-base">Portal Connection Status</CardTitle>
                              <CardDescription>
                                Vendor portal access for {selectedOrg?.name}
                              </CardDescription>
                            </div>
                            <Badge
                              className={
                                vendorEnrollment.status === 'ACTIVE'
                                  ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
                                  : vendorEnrollment.status === 'INVITED'
                                  ? 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200'
                                  : 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200'
                              }
                            >
                              {vendorEnrollment.status === 'ACTIVE' && <CheckCircle className="w-3 h-3 mr-1" />}
                              {vendorEnrollment.status === 'INVITED' && <ClockIcon className="w-3 h-3 mr-1" />}
                              {vendorEnrollment.status === 'SUSPENDED' && <XCircle className="w-3 h-3 mr-1" />}
                              {vendorEnrollment.status}
                            </Badge>
                          </div>
                        </CardHeader>
                        <CardContent className="space-y-4">
                          <div className="grid grid-cols-2 gap-4 text-sm">
                            <div>
                              <p className="text-muted-foreground">Invited</p>
                              <p className="font-medium">
                                {vendorEnrollment.invitedAt
                                  ? format(new Date(vendorEnrollment.invitedAt), 'MMM d, yyyy')
                                  : 'N/A'}
                              </p>
                            </div>
                            {vendorEnrollment.enrolledAt && (
                              <div>
                                <p className="text-muted-foreground">Enrolled</p>
                                <p className="font-medium">
                                  {format(new Date(vendorEnrollment.enrolledAt), 'MMM d, yyyy')}
                                </p>
                              </div>
                            )}
                            {vendorEnrollment.vendorUserEmail && (
                              <div className="col-span-2">
                                <p className="text-muted-foreground">Vendor Email</p>
                                <p className="font-medium">{vendorEnrollment.vendorUserEmail}</p>
                              </div>
                            )}
                          </div>

                          <Separator />

                          <div className="flex items-center justify-between">
                            <div>
                              <p className="font-medium">Auto-Approve Pricing</p>
                              <p className="text-sm text-muted-foreground">
                                {vendorEnrollment.autoApproveNewPricing
                                  ? 'New pricing submissions are automatically approved'
                                  : 'New pricing submissions require your review'}
                              </p>
                            </div>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => updateEnrollmentMutation.mutate({
                                enrollmentId: vendorEnrollment.id,
                                autoApprove: !vendorEnrollment.autoApproveNewPricing,
                              })}
                              disabled={updateEnrollmentMutation.isPending}
                              data-testid="button-toggle-auto-approve"
                            >
                              {vendorEnrollment.autoApproveNewPricing ? 'Disable' : 'Enable'}
                            </Button>
                          </div>

                          <Separator />

                          <div className="flex items-center gap-2">
                            {vendorEnrollment.status === 'ACTIVE' && (
                              <Button
                                variant="destructive"
                                size="sm"
                                onClick={() => suspendEnrollmentMutation.mutate(vendorEnrollment.id)}
                                disabled={suspendEnrollmentMutation.isPending}
                                data-testid="button-suspend-enrollment"
                              >
                                <XCircle className="w-4 h-4 mr-1" />
                                Suspend Access
                              </Button>
                            )}
                            {vendorEnrollment.status === 'SUSPENDED' && (
                              <Button
                                variant="default"
                                size="sm"
                                onClick={() => reactivateEnrollmentMutation.mutate(vendorEnrollment.id)}
                                disabled={reactivateEnrollmentMutation.isPending}
                                data-testid="button-reactivate-enrollment"
                              >
                                <CheckCircle className="w-4 h-4 mr-1" />
                                Reactivate Access
                              </Button>
                            )}
                          </div>
                        </CardContent>
                      </Card>

                      {!vendorEnrollment.autoApproveNewPricing && (
                        <Card>
                          <CardHeader className="pb-3">
                            <CardTitle className="text-base">Pending Submissions</CardTitle>
                            <CardDescription>
                              Review and approve pricing submitted by this vendor
                            </CardDescription>
                          </CardHeader>
                          <CardContent>
                            {submissionsLoading ? (
                              <div className="space-y-2">
                                {[1, 2].map((i) => <Skeleton key={i} className="h-16 w-full" />)}
                              </div>
                            ) : pendingSubmissions.length === 0 ? (
                              <div className="text-center py-6 text-muted-foreground">
                                <ClockIcon className="w-8 h-8 mx-auto mb-2 opacity-50" />
                                <p>No pending submissions</p>
                                <p className="text-sm">
                                  New pricing from this vendor will appear here for review
                                </p>
                              </div>
                            ) : (
                              <div className="space-y-3">
                                {pendingSubmissions.map((item) => (
                                  <div
                                    key={item.id}
                                    className="flex items-start justify-between p-3 border rounded-lg"
                                    data-testid={`pending-pricing-${item.id}`}
                                  >
                                    <div className="flex-1 min-w-0">
                                      <div className="flex items-center gap-2 flex-wrap">
                                        <span className="font-medium">{item.itemName}</span>
                                        {item.itemCode && (
                                          <Badge variant="outline" className="text-xs">{item.itemCode}</Badge>
                                        )}
                                        <Badge variant="secondary" className="text-xs">{item.category}</Badge>
                                      </div>
                                      <p className="text-sm text-muted-foreground mt-1">
                                        ${parseFloat(item.unitPrice || "0").toFixed(2)} / {item.unit}
                                        {item.effectiveQuarter && ` • ${item.effectiveQuarter}`}
                                      </p>
                                      {item.submittedByEmail && (
                                        <p className="text-xs text-muted-foreground mt-1">
                                          Submitted by {item.submittedByEmail}
                                        </p>
                                      )}
                                    </div>
                                    <div className="flex items-center gap-1">
                                      <Button
                                        variant="ghost"
                                        size="icon"
                                        onClick={() => approvePricingMutation.mutate(item.id)}
                                        disabled={approvePricingMutation.isPending}
                                        className="text-green-600 hover:text-green-700 hover:bg-green-100"
                                        data-testid={`button-approve-${item.id}`}
                                      >
                                        <CheckCircle className="w-4 h-4" />
                                      </Button>
                                      <Button
                                        variant="ghost"
                                        size="icon"
                                        onClick={() => rejectPricingMutation.mutate(item.id)}
                                        disabled={rejectPricingMutation.isPending}
                                        className="text-red-600 hover:text-red-700 hover:bg-red-100"
                                        data-testid={`button-reject-${item.id}`}
                                      >
                                        <XCircle className="w-4 h-4" />
                                      </Button>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </CardContent>
                        </Card>
                      )}
                    </>
                  )}
                </div>
              </TabsContent>
            )}

            <TabsContent value="communications" className="mt-4">
              {!hasEmailIntegration ? (
                <Card>
                  <CardContent className="p-6">
                    <div className="text-center">
                      <WifiOff className="w-12 h-12 mx-auto mb-4 text-muted-foreground opacity-50" />
                      <h3 className="font-medium text-lg mb-2">No Email Integration Connected</h3>
                      <p className="text-sm text-muted-foreground mb-4">
                        Connect a Google Workspace or Microsoft 365 account to see email threads and calendar events linked to this organization.
                      </p>
                      <Button variant="outline" asChild data-testid="button-connect-email">
                        <a href="/integrations">
                          <Wifi className="w-4 h-4 mr-2" />
                          Connect Email Integration
                        </a>
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ) : commsLoading ? (
                <div className="space-y-3">
                  {[1, 2, 3].map((i) => <Skeleton key={i} className="h-16 w-full" />)}
                </div>
              ) : (
                <div className="space-y-6">
                  <div>
                    <div className="flex items-center gap-2 mb-3">
                      <Mail className="w-4 h-4 text-muted-foreground" />
                      <h3 className="text-sm font-medium">Email Threads</h3>
                      <Badge variant="secondary" className="text-xs">{commsData?.pagination?.total ?? accumulatedEmails.length}</Badge>
                    </div>
                    {!accumulatedEmails.length && !commsLoading ? (
                      <div className="text-center py-6 text-muted-foreground">
                        <Mail className="w-10 h-10 mx-auto mb-2 opacity-40" />
                        <p className="text-sm">No email threads linked to this organization</p>
                        <p className="text-xs mt-1">Threads appear here when emails are matched to this org in the Email Assistant.</p>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {accumulatedEmails.map((email) => (
                          <Card key={email.threadId} className="hover-elevate" data-testid={`card-email-${email.threadId}`}>
                            <CardContent className="p-3">
                              <div className="flex items-start justify-between gap-2">
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <p className="text-sm font-medium truncate">{email.subject}</p>
                                    <Badge variant="outline" className="text-xs shrink-0">{email.messageCount} msg{email.messageCount !== 1 ? "s" : ""}</Badge>
                                  </div>
                                  {(email.fromName || email.fromAddress) && (
                                    <p className="text-xs text-muted-foreground mt-0.5">
                                      From: {email.fromName ? `${email.fromName} <${email.fromAddress}>` : email.fromAddress}
                                    </p>
                                  )}
                                  {(email.aiSummary || email.snippet) && (
                                    <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                                      {email.aiSummary ?? email.snippet}
                                    </p>
                                  )}
                                  <p className="text-xs text-muted-foreground mt-1">
                                    {email.receivedAt
                                      ? formatDistanceToNow(new Date(email.receivedAt), { addSuffix: true })
                                      : formatDistanceToNow(new Date(email.lastMessageAt), { addSuffix: true })}
                                  </p>
                                </div>
                                <Button variant="ghost" size="icon" asChild className="shrink-0" data-testid={`button-open-email-${email.threadId}`}>
                                  <a href={`/email-assistant?threadId=${email.threadId}`} title="Open in Email Assistant">
                                    <ExternalLink className="w-3.5 h-3.5" />
                                  </a>
                                </Button>
                              </div>
                            </CardContent>
                          </Card>
                        ))}
                        {commsData?.pagination?.hasMore && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="w-full mt-2"
                            onClick={() => setCommsPage((p) => p + 1)}
                            data-testid="button-load-more-emails"
                          >
                            Load more ({commsData.pagination.total - accumulatedEmails.length} remaining)
                          </Button>
                        )}
                      </div>
                    )}
                  </div>

                  <Separator />

                  <div>
                    <div className="flex items-center gap-2 mb-3">
                      <CalendarDays className="w-4 h-4 text-muted-foreground" />
                      <h3 className="text-sm font-medium">Upcoming Events</h3>
                      <span className="text-xs text-muted-foreground">(next 30 days)</span>
                      <Badge variant="secondary" className="text-xs">{commsData?.upcomingEvents?.length ?? 0}</Badge>
                    </div>
                    {!commsData?.upcomingEvents?.length ? (
                      <div className="text-center py-6 text-muted-foreground">
                        <CalendarDays className="w-10 h-10 mx-auto mb-2 opacity-40" />
                        <p className="text-sm">No upcoming events linked to this organization's projects</p>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {commsData.upcomingEvents.map((event) => (
                          <Card key={event.id} className="hover-elevate" data-testid={`card-event-${event.id}`}>
                            <CardContent className="p-3">
                              <div className="flex items-start gap-3">
                                <div className="p-1.5 rounded-md bg-primary/10 shrink-0">
                                  <CalendarDays className="w-3.5 h-3.5 text-primary" />
                                </div>
                                <div className="flex-1 min-w-0">
                                  <p className="text-sm font-medium">{event.title}</p>
                                  <p className="text-xs text-muted-foreground mt-0.5">
                                    {event.allDay
                                      ? format(new Date(event.startDate), "EEEE, MMMM d")
                                      : format(new Date(event.startDate), "EEEE, MMMM d 'at' h:mm a")}
                                    {event.endDate && !event.allDay && (
                                      <> – {format(new Date(event.endDate), "h:mm a")}</>
                                    )}
                                  </p>
                                  {event.description && (
                                    <p className="text-xs text-muted-foreground mt-1 line-clamp-1">{event.description}</p>
                                  )}
                                </div>
                              </div>
                            </CardContent>
                          </Card>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>

      <Dialog open={inviteVendorOpen} onOpenChange={setInviteVendorOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Invite Vendor to Portal</DialogTitle>
            <DialogDescription>
              Send an invitation to {selectedOrg?.name} to submit pricing directly through the vendor portal.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Vendor Email Address</Label>
              <Input
                type="email"
                placeholder="vendor@company.com"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                data-testid="input-vendor-email"
              />
              <p className="text-xs text-muted-foreground">
                This email will receive login credentials to access the vendor portal.
              </p>
            </div>
            <div className="flex items-center gap-3 p-3 border rounded-lg">
              <input
                type="checkbox"
                id="auto-approve"
                checked={autoApprove}
                onChange={(e) => setAutoApprove(e.target.checked)}
                className="h-4 w-4 rounded border-gray-300"
                data-testid="checkbox-auto-approve"
              />
              <div>
                <Label htmlFor="auto-approve" className="cursor-pointer">
                  Auto-approve new pricing
                </Label>
                <p className="text-xs text-muted-foreground">
                  Skip review and automatically add submitted pricing to your catalog
                </p>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setInviteVendorOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                inviteVendorMutation.mutate({ vendorEmail: inviteEmail, autoApprove });
                setInviteVendorOpen(false);
                setInviteEmail("");
                setAutoApprove(false);
              }}
              disabled={!inviteEmail || inviteVendorMutation.isPending}
              data-testid="button-send-invite"
            >
              <Send className="w-4 h-4 mr-2" />
              {inviteVendorMutation.isPending ? 'Sending...' : 'Send Invitation'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={pricingDialogOpen} onOpenChange={(open) => { setPricingDialogOpen(open); if (!open) { setEditingPricing(null); setIsCustomItemName(false); } }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingPricing ? "Edit Pricing Item" : "Add Pricing Item"}</DialogTitle>
            <DialogDescription>
              {editingPricing ? "Update pricing information" : "Select a standard item or enter a custom name"}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4 max-h-[60vh] overflow-y-auto">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Item Name *</Label>
                {isCustomItemName && (
                  <Badge variant="outline" className="text-xs">Custom Item</Badge>
                )}
              </div>
              <Popover open={itemNamePopoverOpen} onOpenChange={setItemNamePopoverOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    role="combobox"
                    aria-expanded={itemNamePopoverOpen}
                    className="w-full justify-between font-normal"
                    data-testid="button-pricing-item-selector"
                  >
                    {newPricing.itemName || "Select or enter item name..."}
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[400px] p-0" align="start">
                  <Command>
                    <CommandInput
                      placeholder="Search items or type custom name..."
                      value={newPricing.itemName}
                      onValueChange={(value) => handleCustomItemName(value)}
                      data-testid="input-pricing-item-search"
                    />
                    <CommandList className="max-h-[300px]">
                      <CommandEmpty>
                        <div className="p-2 text-center">
                          <p className="text-sm text-muted-foreground mb-2">No matching standard item</p>
                          {newPricing.itemName && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                setIsCustomItemName(true);
                                setItemNamePopoverOpen(false);
                              }}
                              data-testid="button-use-custom-name"
                            >
                              Use "{newPricing.itemName}" as custom item
                            </Button>
                          )}
                        </div>
                      </CommandEmpty>
                      {STANDARD_PRICING_ITEMS.map((group) => (
                        <CommandGroup key={group.category} heading={group.category.replace(/_/g, ' ')}>
                          {group.items.map((item) => (
                            <CommandItem
                              key={item.name}
                              value={item.name}
                              onSelect={() => handleStandardItemSelect(item)}
                              data-testid={`item-${item.name.toLowerCase().replace(/\s+/g, '-')}`}
                            >
                              <Check
                                className={cn(
                                  "mr-2 h-4 w-4",
                                  newPricing.itemName === item.name ? "opacity-100" : "opacity-0"
                                )}
                              />
                              <div className="flex flex-col">
                                <span>{item.name}</span>
                                <span className="text-xs text-muted-foreground">
                                  {item.unit === "YARD" ? "Cubic Yard" :
                                   item.unit === "TON" ? "Ton" :
                                   item.unit === "LF" ? "Linear Foot" :
                                   item.unit === "SF" ? "Square Foot" :
                                   item.unit === "EA" ? "Each" :
                                   item.unit === "ROLL" ? "Roll" :
                                   item.unit === "GAL" ? "Gallon" :
                                   item.unit === "BAG" ? "Bag" : item.unit}
                                </span>
                              </div>
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      ))}
                      <CommandSeparator />
                      <CommandGroup heading="Custom">
                        <CommandItem
                          onSelect={() => {
                            setIsCustomItemName(true);
                            setItemNamePopoverOpen(false);
                          }}
                          data-testid="item-custom-entry"
                        >
                          <Plus className="mr-2 h-4 w-4" />
                          Enter custom item name
                        </CommandItem>
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
              {isCustomItemName && (
                <Input
                  value={newPricing.itemName}
                  onChange={(e) => setNewPricing({ ...newPricing, itemName: e.target.value })}
                  placeholder="Enter custom item name..."
                  className="mt-2"
                  data-testid="input-pricing-custom-name"
                />
              )}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Item Code</Label>
                <Input
                  value={newPricing.itemCode}
                  onChange={(e) => setNewPricing({ ...newPricing, itemCode: e.target.value })}
                  placeholder="e.g., CON-4000"
                  data-testid="input-pricing-code"
                />
              </div>
              <div className="space-y-2">
                <Label>Category</Label>
                <Select value={newPricing.category} onValueChange={(v) => setNewPricing({ ...newPricing, category: v })}>
                  <SelectTrigger data-testid="select-pricing-category">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="CONCRETE">Concrete</SelectItem>
                    <SelectItem value="STONE">Stone/Aggregate</SelectItem>
                    <SelectItem value="REBAR">Rebar</SelectItem>
                    <SelectItem value="WIRE_MESH">Wire Mesh</SelectItem>
                    <SelectItem value="SEALER">Sealer/Cure</SelectItem>
                    <SelectItem value="LUMBER">Lumber</SelectItem>
                    <SelectItem value="FILL">Fill Material</SelectItem>
                    <SelectItem value="EQUIPMENT">Equipment</SelectItem>
                    <SelectItem value="OTHER">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label>Unit Price *</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={newPricing.unitPrice}
                  onChange={(e) => setNewPricing({ ...newPricing, unitPrice: e.target.value })}
                  placeholder="0.00"
                  data-testid="input-pricing-price"
                />
              </div>
              <div className="space-y-2">
                <Label>Unit</Label>
                <Select value={newPricing.unit} onValueChange={(v) => setNewPricing({ ...newPricing, unit: v })}>
                  <SelectTrigger data-testid="select-pricing-unit">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="YARD">Cubic Yard</SelectItem>
                    <SelectItem value="TON">Ton</SelectItem>
                    <SelectItem value="LF">Linear Foot</SelectItem>
                    <SelectItem value="SF">Square Foot</SelectItem>
                    <SelectItem value="EA">Each</SelectItem>
                    <SelectItem value="ROLL">Roll</SelectItem>
                    <SelectItem value="GAL">Gallon</SelectItem>
                    <SelectItem value="BAG">Bag</SelectItem>
                    <SelectItem value="HR">Hour</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Lead Time (Days)</Label>
                <Input
                  type="number"
                  value={newPricing.leadTimeDays}
                  onChange={(e) => setNewPricing({ ...newPricing, leadTimeDays: e.target.value })}
                  placeholder="0"
                  data-testid="input-pricing-lead-time"
                />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label>Min Order</Label>
                <Input
                  value={newPricing.minimumOrder}
                  onChange={(e) => setNewPricing({ ...newPricing, minimumOrder: e.target.value })}
                  placeholder="e.g., 10 yards"
                  data-testid="input-pricing-min-order"
                />
              </div>
              <div className="space-y-2">
                <Label>Delivery Fee</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={newPricing.deliveryFee}
                  onChange={(e) => setNewPricing({ ...newPricing, deliveryFee: e.target.value })}
                  placeholder="0.00"
                  data-testid="input-pricing-delivery"
                />
              </div>
              <div className="space-y-2">
                <Label>Effective Date</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      className={cn(
                        "w-full justify-start text-left font-normal",
                        !newPricing.effectiveDate && "text-muted-foreground"
                      )}
                      data-testid="input-pricing-date"
                    >
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {newPricing.effectiveDate ? format(parseISO(newPricing.effectiveDate), "PPP") : "Pick a date"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <CalendarPicker
                      mode="single"
                      selected={newPricing.effectiveDate ? parseISO(newPricing.effectiveDate) : undefined}
                      onSelect={(date) => setNewPricing({ ...newPricing, effectiveDate: date ? format(date, "yyyy-MM-dd") : "" })}
                      initialFocus
                    />
                  </PopoverContent>
                </Popover>
              </div>
            </div>
            <div className="space-y-2">
              <Label>Description</Label>
              <Textarea
                value={newPricing.description}
                onChange={(e) => setNewPricing({ ...newPricing, description: e.target.value })}
                placeholder="Additional details..."
                data-testid="input-pricing-description"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setPricingDialogOpen(false); setEditingPricing(null); }} data-testid="button-cancel-pricing">
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (editingPricing) {
                  updatePricingMutation.mutate({ ...newPricing, id: editingPricing.id });
                } else {
                  createPricingMutation.mutate(newPricing);
                }
                setPricingDialogOpen(false);
                setEditingPricing(null);
              }}
              disabled={!newPricing.itemName || !newPricing.unitPrice || createPricingMutation.isPending || updatePricingMutation.isPending}
              data-testid="button-save-pricing"
            >
              {(createPricingMutation.isPending || updatePricingMutation.isPending) ? "Saving..." : (editingPricing ? "Update" : "Add Item")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={rentalDialogOpen} onOpenChange={(open) => { setRentalDialogOpen(open); if (!open) setEditingRental(null); }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingRental ? "Edit Rental Equipment" : "Add Rental Equipment"}</DialogTitle>
            <DialogDescription>
              {editingRental ? "Update rental equipment information" : "Add equipment to the rental catalog"}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4 max-h-[60vh] overflow-y-auto">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Equipment Name *</Label>
                <Input
                  value={newRental.name}
                  onChange={(e) => setNewRental({ ...newRental, name: e.target.value })}
                  placeholder="e.g., CAT 320 Excavator"
                  data-testid="input-rental-name"
                />
              </div>
              <div className="space-y-2">
                <Label>Equipment Type</Label>
                <Select value={newRental.equipmentType} onValueChange={(v) => setNewRental({ ...newRental, equipmentType: v })}>
                  <SelectTrigger data-testid="select-rental-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="HEAVY_EQUIPMENT">Heavy Equipment</SelectItem>
                    <SelectItem value="VEHICLES">Vehicles</SelectItem>
                    <SelectItem value="POWER_TOOLS">Power Tools</SelectItem>
                    <SelectItem value="HAND_TOOLS">Hand Tools</SelectItem>
                    <SelectItem value="TRAILERS">Trailers</SelectItem>
                    <SelectItem value="COMPACTION">Compaction</SelectItem>
                    <SelectItem value="CONCRETE">Concrete</SelectItem>
                    <SelectItem value="LIFTING">Lifting</SelectItem>
                    <SelectItem value="OTHER">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Make</Label>
                <Input
                  value={newRental.make}
                  onChange={(e) => setNewRental({ ...newRental, make: e.target.value })}
                  placeholder="e.g., Caterpillar"
                  data-testid="input-rental-make"
                />
              </div>
              <div className="space-y-2">
                <Label>Model</Label>
                <Input
                  value={newRental.model}
                  onChange={(e) => setNewRental({ ...newRental, model: e.target.value })}
                  placeholder="e.g., 320"
                  data-testid="input-rental-model"
                />
              </div>
            </div>
            <div className="grid grid-cols-4 gap-4">
              <div className="space-y-2">
                <Label>Hourly ($)</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={newRental.hourlyRate}
                  onChange={(e) => setNewRental({ ...newRental, hourlyRate: e.target.value })}
                  placeholder="0"
                  data-testid="input-rental-hourly"
                />
              </div>
              <div className="space-y-2">
                <Label>Daily ($)</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={newRental.dailyRate}
                  onChange={(e) => setNewRental({ ...newRental, dailyRate: e.target.value })}
                  placeholder="0"
                  data-testid="input-rental-daily"
                />
              </div>
              <div className="space-y-2">
                <Label>Weekly ($)</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={newRental.weeklyRate}
                  onChange={(e) => setNewRental({ ...newRental, weeklyRate: e.target.value })}
                  placeholder="0"
                  data-testid="input-rental-weekly"
                />
              </div>
              <div className="space-y-2">
                <Label>Monthly ($)</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={newRental.monthlyRate}
                  onChange={(e) => setNewRental({ ...newRental, monthlyRate: e.target.value })}
                  placeholder="0"
                  data-testid="input-rental-monthly"
                />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label>Delivery Fee ($)</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={newRental.deliveryFee}
                  onChange={(e) => setNewRental({ ...newRental, deliveryFee: e.target.value })}
                  placeholder="0"
                  data-testid="input-rental-delivery"
                />
              </div>
              <div className="space-y-2">
                <Label>Pickup Fee ($)</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={newRental.pickupFee}
                  onChange={(e) => setNewRental({ ...newRental, pickupFee: e.target.value })}
                  placeholder="0"
                  data-testid="input-rental-pickup"
                />
              </div>
              <div className="space-y-2">
                <Label>Min Days</Label>
                <Input
                  type="number"
                  value={newRental.minimumRentalDays}
                  onChange={(e) => setNewRental({ ...newRental, minimumRentalDays: e.target.value })}
                  placeholder="1"
                  data-testid="input-rental-min-days"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Description</Label>
              <Textarea
                value={newRental.description}
                onChange={(e) => setNewRental({ ...newRental, description: e.target.value })}
                placeholder="Additional details about this equipment..."
                data-testid="input-rental-description"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setRentalDialogOpen(false); setEditingRental(null); }} data-testid="button-cancel-rental">
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (editingRental) {
                  updateRentalMutation.mutate({ ...newRental, id: editingRental.id });
                } else {
                  createRentalMutation.mutate(newRental);
                }
                setRentalDialogOpen(false);
                setEditingRental(null);
              }}
              disabled={!newRental.name || createRentalMutation.isPending || updateRentalMutation.isPending}
              data-testid="button-save-rental"
            >
              {(createRentalMutation.isPending || updateRentalMutation.isPending) ? "Saving..." : (editingRental ? "Update" : "Add Equipment")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
