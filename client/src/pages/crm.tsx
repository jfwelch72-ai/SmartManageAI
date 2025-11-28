import { useState, useMemo } from "react";
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
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator } from "@/components/ui/command";
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
  X,
  DollarSign,
  Truck,
  Package,
  Calendar,
  Check,
  ChevronsUpDown
} from "lucide-react";
import type { CrmOrganisation as CrmOrganization, CrmContact, CrmOrganisationNote, VendorPricingCatalog, RentalEquipmentCatalog } from "@shared/schema";
import { format, formatDistanceToNow } from "date-fns";
import { MessageSquare, Clock } from "lucide-react";
import { cn } from "@/lib/utils";

// Standardized pricing item names aligned with bid estimate categories
interface StandardPricingItem {
  name: string;
  category: string;
  unit: string;
}

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

  // Notes state
  const [newNote, setNewNote] = useState({
    noteType: "GENERAL" as NoteType,
    content: "",
    contactId: undefined as string | undefined,
  });
  
  const { data: organizations, isLoading: orgsLoading } = useQuery<CrmOrganization[]>({
    queryKey: ["/api/crm/organisations"],
  });
  
  const { data: orgDetail, isLoading: orgDetailLoading } = useQuery<OrganizationWithContacts>({
    queryKey: ["/api/crm/organisations", selectedOrg?.id],
    enabled: !!selectedOrg?.id && detailOrgOpen,
  });

  // Fetch notes for selected organization
  const { data: orgNotes = [], isLoading: notesLoading } = useQuery<OrgNote[]>({
    queryKey: ["/api/crm/organisations", selectedOrg?.id, "notes"],
    enabled: !!selectedOrg?.id && detailOrgOpen,
  });

  // Fetch vendor pricing catalog for suppliers/vendors
  const showPricingTab = selectedOrg?.type === "SUPPLIER" || selectedOrg?.type === "VENDOR";
  const { data: vendorPricing = [], isLoading: pricingLoading } = useQuery<VendorPricingCatalog[]>({
    queryKey: ["/api/crm/organisations", selectedOrg?.id, "pricing"],
    enabled: !!selectedOrg?.id && detailOrgOpen && showPricingTab,
  });

  // Fetch rental catalog for rental vendors
  const showRentalTab = selectedOrg?.type === "RENTAL_VENDOR" || selectedOrg?.type === "VENDOR";
  const { data: rentalCatalog = [], isLoading: rentalLoading } = useQuery<RentalEquipmentCatalog[]>({
    queryKey: ["/api/crm/organisations", selectedOrg?.id, "rental-catalog"],
    enabled: !!selectedOrg?.id && detailOrgOpen && showRentalTab,
  });

  // State for new pricing item
  const [pricingDialogOpen, setPricingDialogOpen] = useState(false);
  const [editingPricing, setEditingPricing] = useState<VendorPricingCatalog | null>(null);
  const [itemNamePopoverOpen, setItemNamePopoverOpen] = useState(false);
  const [isCustomItemName, setIsCustomItemName] = useState(false);
  const [newPricing, setNewPricing] = useState({
    itemName: "",
    itemCode: "",
    category: "CONCRETE",
    description: "",
    unit: "YARD",
    unitPrice: "",
    minimumOrder: "",
    deliveryFee: "",
    effectiveQuarter: "",
    effectiveDate: new Date().toISOString().split('T')[0],
    leadTimeDays: "",
  });
  
  // Flatten all standard items for searching
  const allStandardItems = useMemo(() => 
    STANDARD_PRICING_ITEMS.flatMap(group => group.items), 
    []
  );
  
  // Handler for selecting a standard item
  const handleStandardItemSelect = (item: StandardPricingItem) => {
    setNewPricing(prev => ({
      ...prev,
      itemName: item.name,
      category: item.category,
      unit: item.unit,
    }));
    setIsCustomItemName(false);
    setItemNamePopoverOpen(false);
  };
  
  // Handler for entering a custom item name
  const handleCustomItemName = (name: string) => {
    setNewPricing(prev => ({ ...prev, itemName: name }));
    setIsCustomItemName(true);
  };

  // State for new rental catalog item
  const [rentalDialogOpen, setRentalDialogOpen] = useState(false);
  const [editingRental, setEditingRental] = useState<RentalEquipmentCatalog | null>(null);
  const [newRental, setNewRental] = useState({
    name: "",
    equipmentType: "HEAVY_EQUIPMENT",
    make: "",
    model: "",
    description: "",
    hourlyRate: "",
    dailyRate: "",
    weeklyRate: "",
    monthlyRate: "",
    deliveryFee: "",
    pickupFee: "",
    minimumRentalDays: "1",
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

  // Create note mutation
  const createNoteMutation = useMutation({
    mutationFn: async (data: { noteType: string; content: string; contactId?: string }) => {
      if (!selectedOrg?.id) throw new Error("No organization selected");
      return apiRequest("POST", `/api/crm/organisations/${selectedOrg.id}/notes`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/crm/organisations", selectedOrg?.id, "notes"] });
      toast({ title: "Note added successfully" });
      resetNewNote();
    },
    onError: (err: any) => {
      toast({ title: "Failed to add note", description: err.message, variant: "destructive" });
    },
  });

  // Delete note mutation
  const deleteNoteMutation = useMutation({
    mutationFn: async (noteId: string) => {
      if (!selectedOrg?.id) throw new Error("No organization selected");
      return apiRequest("DELETE", `/api/crm/organisations/${selectedOrg.id}/notes/${noteId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/crm/organisations", selectedOrg?.id, "notes"] });
      toast({ title: "Note deleted" });
    },
    onError: (err: any) => {
      toast({ title: "Failed to delete note", description: err.message, variant: "destructive" });
    },
  });

  // Pricing Catalog Mutations
  const createPricingMutation = useMutation({
    mutationFn: async (data: typeof newPricing) => {
      if (!selectedOrg?.id) throw new Error("No organization selected");
      const payload = {
        ...data,
        unitPrice: data.unitPrice || "0",
        minimumOrder: data.minimumOrder || null,
        deliveryFee: data.deliveryFee || null,
        leadTimeDays: data.leadTimeDays ? parseInt(data.leadTimeDays) : null,
        effectiveDate: new Date(data.effectiveDate),
      };
      return apiRequest("POST", `/api/crm/organisations/${selectedOrg.id}/pricing`, payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/crm/organisations", selectedOrg?.id, "pricing"] });
      toast({ title: "Pricing item added" });
      setPricingDialogOpen(false);
      resetNewPricing();
    },
    onError: (err: any) => {
      toast({ title: "Failed to add pricing item", description: err.message, variant: "destructive" });
    },
  });

  const updatePricingMutation = useMutation({
    mutationFn: async (data: typeof newPricing & { id: string }) => {
      const { id, ...rest } = data;
      const payload = {
        ...rest,
        unitPrice: rest.unitPrice || "0",
        minimumOrder: rest.minimumOrder || null,
        deliveryFee: rest.deliveryFee || null,
        leadTimeDays: rest.leadTimeDays ? parseInt(rest.leadTimeDays) : null,
        effectiveDate: new Date(rest.effectiveDate),
      };
      return apiRequest("PUT", `/api/crm/pricing/${id}`, payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/crm/organisations", selectedOrg?.id, "pricing"] });
      toast({ title: "Pricing item updated" });
      setPricingDialogOpen(false);
      setEditingPricing(null);
    },
    onError: (err: any) => {
      toast({ title: "Failed to update pricing item", description: err.message, variant: "destructive" });
    },
  });

  const deletePricingMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest("DELETE", `/api/crm/pricing/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/crm/organisations", selectedOrg?.id, "pricing"] });
      toast({ title: "Pricing item deleted" });
    },
    onError: (err: any) => {
      toast({ title: "Failed to delete pricing item", description: err.message, variant: "destructive" });
    },
  });

  // Rental Catalog Mutations
  const createRentalMutation = useMutation({
    mutationFn: async (data: typeof newRental) => {
      if (!selectedOrg?.id) throw new Error("No organization selected");
      const payload = {
        ...data,
        hourlyRate: data.hourlyRate || null,
        dailyRate: data.dailyRate || null,
        weeklyRate: data.weeklyRate || null,
        monthlyRate: data.monthlyRate || null,
        deliveryFee: data.deliveryFee || null,
        pickupFee: data.pickupFee || null,
        minimumRentalDays: data.minimumRentalDays ? parseInt(data.minimumRentalDays) : 1,
      };
      return apiRequest("POST", `/api/crm/organisations/${selectedOrg.id}/rental-catalog`, payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/crm/organisations", selectedOrg?.id, "rental-catalog"] });
      toast({ title: "Rental equipment added" });
      setRentalDialogOpen(false);
      resetNewRental();
    },
    onError: (err: any) => {
      toast({ title: "Failed to add rental equipment", description: err.message, variant: "destructive" });
    },
  });

  const updateRentalMutation = useMutation({
    mutationFn: async (data: typeof newRental & { id: string }) => {
      const { id, ...rest } = data;
      const payload = {
        ...rest,
        hourlyRate: rest.hourlyRate || null,
        dailyRate: rest.dailyRate || null,
        weeklyRate: rest.weeklyRate || null,
        monthlyRate: rest.monthlyRate || null,
        deliveryFee: rest.deliveryFee || null,
        pickupFee: rest.pickupFee || null,
        minimumRentalDays: rest.minimumRentalDays ? parseInt(rest.minimumRentalDays) : 1,
      };
      return apiRequest("PUT", `/api/crm/rental-catalog/${id}`, payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/crm/organisations", selectedOrg?.id, "rental-catalog"] });
      toast({ title: "Rental equipment updated" });
      setRentalDialogOpen(false);
      setEditingRental(null);
    },
    onError: (err: any) => {
      toast({ title: "Failed to update rental equipment", description: err.message, variant: "destructive" });
    },
  });

  const deleteRentalMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest("DELETE", `/api/crm/rental-catalog/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/crm/organisations", selectedOrg?.id, "rental-catalog"] });
      toast({ title: "Rental equipment deleted" });
    },
    onError: (err: any) => {
      toast({ title: "Failed to delete rental equipment", description: err.message, variant: "destructive" });
    },
  });

  const resetNewPricing = () => {
    const now = new Date();
    const quarter = `${now.getFullYear()}-Q${Math.floor(now.getMonth() / 3) + 1}`;
    setNewPricing({
      itemName: "",
      itemCode: "",
      category: "CONCRETE",
      description: "",
      unit: "YARD",
      unitPrice: "",
      minimumOrder: "",
      deliveryFee: "",
      effectiveQuarter: quarter,
      effectiveDate: now.toISOString().split('T')[0],
      leadTimeDays: "",
    });
    setIsCustomItemName(false);
  };

  const resetNewRental = () => {
    setNewRental({
      name: "",
      equipmentType: "HEAVY_EQUIPMENT",
      make: "",
      model: "",
      description: "",
      hourlyRate: "",
      dailyRate: "",
      weeklyRate: "",
      monthlyRate: "",
      deliveryFee: "",
      pickupFee: "",
      minimumRentalDays: "1",
    });
  };
  
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

  const resetNewNote = () => {
    setNewNote({
      noteType: "GENERAL",
      content: "",
      contactId: undefined,
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
    ownerReps: organizations?.filter(o => o.type === "OWNER_REP" && o.isActive).length || 0,
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
            <Card className="hover-elevate cursor-pointer" onClick={() => setSelectedType("OWNER_REP")} data-testid="card-owner-rep-count">
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-md bg-cyan-100 dark:bg-cyan-900">
                    <Shield className="w-5 h-5 text-cyan-600 dark:text-cyan-400" />
                  </div>
                  <div>
                    <p className="text-2xl font-bold">{orgCounts.ownerReps}</p>
                    <p className="text-sm text-muted-foreground">Owner Reps</p>
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
                      <SelectItem value="CONTRACTOR">GC / Contractors</SelectItem>
                      <SelectItem value="SUBCONTRACTOR">Subcontractors</SelectItem>
                      <SelectItem value="SUPPLIER">Suppliers</SelectItem>
                      <SelectItem value="VENDOR">Vendors</SelectItem>
                      <SelectItem value="RENTAL_VENDOR">Rental Vendors</SelectItem>
                      <SelectItem value="OWNER_REP">Owner Reps</SelectItem>
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
                <div className="overflow-x-auto -mx-4 sm:mx-0">
                  <ScrollArea className="h-[500px]">
                    <Table className="min-w-[600px]">
                      <TableHeader>
                        <TableRow>
                          <TableHead className="whitespace-nowrap">Name</TableHead>
                          <TableHead className="whitespace-nowrap">Type</TableHead>
                          <TableHead className="whitespace-nowrap">Location</TableHead>
                          <TableHead className="whitespace-nowrap">Specialties</TableHead>
                          <TableHead className="text-right whitespace-nowrap">Actions</TableHead>
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
                </div>
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
            <TabsList className="flex flex-wrap">
              <TabsTrigger value="info">Organization Info</TabsTrigger>
              <TabsTrigger value="contacts">
                Contacts ({orgDetail?.contacts?.length || 0})
              </TabsTrigger>
              <TabsTrigger value="activity" data-testid="tab-activity">
                Activity ({orgNotes.length})
              </TabsTrigger>
              {showPricingTab && (
                <TabsTrigger value="pricing" data-testid="tab-pricing">
                  <DollarSign className="w-3 h-3 mr-1" />
                  Pricing ({vendorPricing.length})
                </TabsTrigger>
              )}
              {showRentalTab && (
                <TabsTrigger value="rental" data-testid="tab-rental">
                  <Truck className="w-3 h-3 mr-1" />
                  Rentals ({rentalCatalog.length})
                </TabsTrigger>
              )}
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

            <TabsContent value="activity" className="mt-4">
              <div className="space-y-4">
                {/* Add Note Form */}
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
                      onClick={() => createNoteMutation.mutate(newNote)}
                      disabled={!newNote.content.trim() || createNoteMutation.isPending}
                      className="w-full"
                      data-testid="button-add-note"
                    >
                      {createNoteMutation.isPending ? "Adding..." : "Add Note"}
                    </Button>
                  </CardContent>
                </Card>

                {/* Notes List */}
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

            {/* Pricing Catalog Tab */}
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

            {/* Rental Catalog Tab */}
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
          </Tabs>
        </DialogContent>
      </Dialog>

      {/* Pricing Dialog */}
      <Dialog open={pricingDialogOpen} onOpenChange={(open) => { setPricingDialogOpen(open); if (!open) { setEditingPricing(null); setIsCustomItemName(false); } }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingPricing ? "Edit Pricing Item" : "Add Pricing Item"}</DialogTitle>
            <DialogDescription>
              {editingPricing ? "Update pricing information" : "Select a standard item or enter a custom name"}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4 max-h-[60vh] overflow-y-auto">
            {/* Standardized Item Name Selector */}
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
            <div className="grid grid-cols-2 gap-4">
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
                    <SelectItem value="LOAD">Load</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Unit Price ($) *</Label>
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
                <Label>Effective Quarter</Label>
                <Input
                  value={newPricing.effectiveQuarter}
                  onChange={(e) => setNewPricing({ ...newPricing, effectiveQuarter: e.target.value })}
                  placeholder="e.g., 2025-Q1"
                  data-testid="input-pricing-quarter"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Minimum Order (qty)</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={newPricing.minimumOrder}
                  onChange={(e) => setNewPricing({ ...newPricing, minimumOrder: e.target.value })}
                  placeholder="e.g., 5"
                  data-testid="input-pricing-minimum"
                />
              </div>
              <div className="space-y-2">
                <Label>Delivery Fee ($)</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={newPricing.deliveryFee}
                  onChange={(e) => setNewPricing({ ...newPricing, deliveryFee: e.target.value })}
                  placeholder="0.00"
                  data-testid="input-pricing-delivery"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Lead Time (days)</Label>
                <Input
                  type="number"
                  value={newPricing.leadTimeDays}
                  onChange={(e) => setNewPricing({ ...newPricing, leadTimeDays: e.target.value })}
                  placeholder="e.g., 2"
                  data-testid="input-pricing-lead-time"
                />
              </div>
              <div className="space-y-2">
                <Label>Effective Date</Label>
                <Input
                  type="date"
                  value={newPricing.effectiveDate}
                  onChange={(e) => setNewPricing({ ...newPricing, effectiveDate: e.target.value })}
                  data-testid="input-pricing-date"
                />
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
              }}
              disabled={!newPricing.itemName || !newPricing.unitPrice || createPricingMutation.isPending || updatePricingMutation.isPending}
              data-testid="button-save-pricing"
            >
              {(createPricingMutation.isPending || updatePricingMutation.isPending) ? "Saving..." : (editingPricing ? "Update" : "Add Item")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Rental Equipment Dialog */}
      <Dialog open={rentalDialogOpen} onOpenChange={(open) => { setRentalDialogOpen(open); if (!open) setEditingRental(null); }}>
        <DialogContent className="max-w-lg">
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
              }}
              disabled={!newRental.name || createRentalMutation.isPending || updateRentalMutation.isPending}
              data-testid="button-save-rental"
            >
              {(createRentalMutation.isPending || updateRentalMutation.isPending) ? "Saving..." : (editingRental ? "Update" : "Add Equipment")}
            </Button>
          </DialogFooter>
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
