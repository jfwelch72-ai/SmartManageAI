import { useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation, Link } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { useIsMobile } from "@/hooks/use-mobile";
import { apiRequest } from "@/lib/queryClient";
import { AIAnalysisButton } from "@/components/AIAnalysisButton";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Form,
  FormField,
  FormItem,
  FormLabel,
  FormControl,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  Search,
  Plus,
  Wrench,
  Truck,
  HardHat,
  Settings2,
  AlertTriangle,
  Clock,
  MapPin,
  DollarSign,
  Calendar,
  ChevronRight,
  Filter,
  MoreVertical,
  Download,
  Upload,
  FileUp,
} from "lucide-react";
import { EmptyState } from "@/components/EmptyState";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import type { Equipment } from "@shared/schema";

const EQUIPMENT_TYPES = [
  { value: "HEAVY_EQUIPMENT", label: "Heavy Equipment" },
  { value: "POWER_TOOL", label: "Power Tool" },
  { value: "HAND_TOOL", label: "Hand Tool" },
  { value: "VEHICLE", label: "Vehicle" },
  { value: "TRAILER", label: "Trailer" },
  { value: "CONCRETE", label: "Concrete" },
  { value: "COMPACTION", label: "Compaction" },
  { value: "SURVEYING", label: "Surveying" },
  { value: "SAFETY", label: "Safety" },
  { value: "OTHER", label: "Other" },
];

const STATUS_OPTIONS = [
  {
    value: "AVAILABLE",
    label: "Available",
    color: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  },
  {
    value: "ASSIGNED",
    label: "Assigned",
    color: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  },
  {
    value: "IN_REPAIR",
    label: "In Repair",
    color:
      "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200",
  },
  {
    value: "OUT_OF_SERVICE",
    label: "Out of Service",
    color: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
  },
  {
    value: "RETIRED",
    label: "Retired",
    color: "bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200",
  },
];

const TYPE_ICONS: Record<string, typeof Truck> = {
  HEAVY_EQUIPMENT: Truck,
  POWER_TOOL: Wrench,
  HAND_TOOL: Settings2,
  VEHICLE: Truck,
  TRAILER: Truck,
  CONCRETE: HardHat,
  COMPACTION: Settings2,
  SURVEYING: MapPin,
  SAFETY: HardHat,
  OTHER: Settings2,
};

const createEquipmentSchema = z.object({
  name: z.string().min(1, "Name is required"),
  type: z.string().min(1, "Type is required"),
  make: z.string().optional(),
  model: z.string().optional(),
  year: z.coerce.number().optional(),
  serialNumber: z.string().optional(),
  vinNumber: z.string().optional(),
  licensePlate: z.string().optional(),
  currentHours: z.string().optional(),
  purchasePrice: z.string().optional(),
  homeLocation: z.string().optional(),
  description: z.string().optional(),
  notes: z.string().optional(),
  depreciationMethod: z.string().optional(),
  usefulLifeYears: z.coerce.number().optional(),
  salvageValue: z.string().optional(),
  inServiceDate: z.string().optional(),
});

type CreateEquipmentInput = z.infer<typeof createEquipmentSchema>;

const CSV_HEADERS = [
  "Name", "Code", "Type", "Status", "Make", "Model", "Year",
  "Serial Number", "VIN", "License Plate", "Current Hours",
  "Purchase Date", "Purchase Price", "Warranty Expiration",
  "Home Location", "Current Location", "Description", "Notes",
];

const CSV_FIELD_MAP: Record<string, string> = {
  "Name": "name", "Code": "equipmentCode", "Type": "type", "Status": "status",
  "Make": "make", "Model": "model", "Year": "year", "Serial Number": "serialNumber",
  "VIN": "vinNumber", "License Plate": "licensePlate", "Current Hours": "currentHours",
  "Purchase Date": "purchaseDate", "Purchase Price": "purchasePrice",
  "Warranty Expiration": "warrantyExpirationDate", "Home Location": "homeLocation",
  "Current Location": "currentLocation", "Description": "description", "Notes": "notes",
};

function escapeCSV(val: string | number | null | undefined): string {
  if (val === null || val === undefined) return "";
  const str = String(val);
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        current += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ",") {
        result.push(current.trim());
        current = "";
      } else {
        current += ch;
      }
    }
  }
  result.push(current.trim());
  return result;
}

function parseCSV(text: string): Record<string, string>[] {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return [];
  const headers = parseCSVLine(lines[0]);
  const rows: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);
    const row: Record<string, string> = {};
    headers.forEach((header, idx) => {
      const field = CSV_FIELD_MAP[header.trim()];
      if (field && values[idx]) {
        row[field] = values[idx];
      }
    });
    if (Object.keys(row).length > 0) rows.push(row);
  }
  return rows;
}

export default function EquipmentPage() {
  const { user, logout, organizationName } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();
  const isMobile = useIsMobile();

  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [typeFilter, setTypeFilter] = useState<string>("ALL");
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [importPreviewRows, setImportPreviewRows] = useState<Record<string, string>[]>([]);
  const [importErrors, setImportErrors] = useState<{ row: number; reason: string }[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [equipmentToDelete, setEquipmentToDelete] = useState<Equipment | null>(
    null,
  );

  const { data: equipmentList = [], isLoading } = useQuery<Equipment[]>({
    queryKey: [
      "/api/equipment",
      { status: statusFilter, type: typeFilter, search: searchTerm },
    ],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (statusFilter !== "ALL") params.append("status", statusFilter);
      if (typeFilter !== "ALL") params.append("type", typeFilter);
      if (searchTerm) params.append("search", searchTerm);
      const response = await fetch(`/api/equipment?${params.toString()}`, {
        credentials: "include",
      });
      if (!response.ok) throw new Error("Failed to fetch equipment");
      return response.json();
    },
  });

  const form = useForm<CreateEquipmentInput>({
    resolver: zodResolver(createEquipmentSchema),
    defaultValues: {
      name: "",
      type: "",
      make: "",
      model: "",
      year: undefined,
      serialNumber: "",
      vinNumber: "",
      licensePlate: "",
      currentHours: "0",
      purchasePrice: "",
      homeLocation: "",
      description: "",
      notes: "",
      depreciationMethod: "",
      usefulLifeYears: undefined,
      salvageValue: "",
      inServiceDate: "",
    },
  });

  const createEquipment = useMutation({
    mutationFn: async (data: CreateEquipmentInput) => {
      return apiRequest("POST", "/api/equipment", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/equipment"] });
      toast({
        title: "Success",
        description: "Equipment created successfully",
      });
      setShowCreateDialog(false);
      form.reset();
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to create equipment",
        variant: "destructive",
      });
    },
  });

  const deleteEquipment = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest("DELETE", `/api/equipment/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/equipment"] });
      toast({
        title: "Success",
        description: "Equipment deleted successfully",
      });
      setShowDeleteDialog(false);
      setEquipmentToDelete(null);
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to delete equipment",
        variant: "destructive",
      });
    },
  });

  const handleSubmit = (data: CreateEquipmentInput) => {
    createEquipment.mutate(data);
  };

  const handleDelete = (eq: Equipment) => {
    setEquipmentToDelete(eq);
    setShowDeleteDialog(true);
  };

  const confirmDelete = () => {
    if (equipmentToDelete) {
      deleteEquipment.mutate(equipmentToDelete.id);
    }
  };

  const handleExportCSV = () => {
    if (equipmentList.length === 0) {
      toast({ title: "Nothing to export", description: "No equipment records to export.", variant: "destructive" });
      return;
    }
    const headerLine = CSV_HEADERS.join(",");
    const dataLines = equipmentList.map((eq) =>
      [
        escapeCSV(eq.name), escapeCSV(eq.equipmentCode), escapeCSV(eq.type),
        escapeCSV(eq.status), escapeCSV(eq.make), escapeCSV(eq.model),
        escapeCSV(eq.year), escapeCSV(eq.serialNumber), escapeCSV(eq.vinNumber),
        escapeCSV(eq.licensePlate), escapeCSV(eq.currentHours),
        escapeCSV(eq.purchaseDate ? new Date(eq.purchaseDate).toISOString().slice(0, 10) : ""),
        escapeCSV(eq.purchasePrice),
        escapeCSV(eq.warrantyExpirationDate || ""),
        escapeCSV(eq.homeLocation), escapeCSV(eq.currentLocation),
        escapeCSV(eq.description), escapeCSV(eq.notes),
      ].join(",")
    );
    const csv = [headerLine, ...dataLines].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `equipment_export_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast({ title: "Export complete", description: `Exported ${equipmentList.length} equipment records.` });
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      const rows = parseCSV(text);
      if (rows.length === 0) {
        toast({ title: "Invalid file", description: "No data rows found. Ensure the CSV has headers matching the expected format.", variant: "destructive" });
        return;
      }
      setImportPreviewRows(rows);
      setImportErrors([]);
      setShowImportDialog(true);
    };
    reader.readAsText(file);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const importEquipment = useMutation({
    mutationFn: async (rows: Record<string, string>[]) => {
      const res = await apiRequest("POST", "/api/equipment/import", { rows });
      return res.json();
    },
    onSuccess: (data: { created: number; skipped: number; errors: { row: number; reason: string }[] }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/equipment"] });
      if (data.errors.length > 0) {
        setImportErrors(data.errors);
        toast({
          title: "Import completed with issues",
          description: `Created ${data.created}, skipped ${data.skipped}, ${data.errors.length} error(s).`,
        });
      } else {
        toast({
          title: "Import complete",
          description: `Created ${data.created} equipment records${data.skipped > 0 ? ` (${data.skipped} duplicates skipped)` : ""}.`,
        });
        setShowImportDialog(false);
        setImportPreviewRows([]);
      }
    },
    onError: (error: any) => {
      toast({ title: "Import failed", description: error.message || "Failed to import equipment", variant: "destructive" });
    },
  });

  const getStatusBadge = (status: string) => {
    const statusOption = STATUS_OPTIONS.find((s) => s.value === status);
    return statusOption ? statusOption.color : "bg-gray-100 text-gray-800";
  };

  const getStatusLabel = (status: string) => {
    const statusOption = STATUS_OPTIONS.find((s) => s.value === status);
    return statusOption ? statusOption.label : status;
  };

  const getTypeLabel = (type: string) => {
    const typeOption = EQUIPMENT_TYPES.find((t) => t.value === type);
    return typeOption ? typeOption.label : type;
  };

  const canManageEquipment =
    user?.role === "ADMIN" ||
    user?.role === "MANAGER" ||
    user?.role === "SUPERINTENDENT" ||
    user?.role === "FIELD_WORKER";
  const canDeleteEquipment = user?.role === "ADMIN" || user?.role === "MANAGER";

  if (!user) return null;

  const stats = {
    total: equipmentList.length,
    available: equipmentList.filter((e) => e.status === "AVAILABLE").length,
    assigned: equipmentList.filter((e) => e.status === "ASSIGNED").length,
    inRepair: equipmentList.filter((e) => e.status === "IN_REPAIR").length,
    totalPurchaseValue: equipmentList.reduce((sum, eq) => sum + (eq.purchasePrice ? parseFloat(eq.purchasePrice) : 0), 0),
    totalBookValue: equipmentList.reduce((sum, eq) => {
      const purchase = eq.purchasePrice ? parseFloat(eq.purchasePrice) : 0;
      if (!purchase) return sum;
      const salvage = eq.salvageValue ? parseFloat(eq.salvageValue) : 0;
      const usefulLife = eq.usefulLifeYears || 0;
      const inService = eq.inServiceDate ? new Date(eq.inServiceDate + "T00:00:00") : null;
      if (!usefulLife || !inService) return sum + purchase;
      const yearsElapsed = (Date.now() - inService.getTime()) / (365.25 * 24 * 60 * 60 * 1000);
      if (yearsElapsed <= 0) return sum + purchase;
      const completedYears = Math.min(Math.floor(yearsElapsed), usefulLife);
      const method = eq.depreciationMethod || "STRAIGHT_LINE";
      if (method === "DECLINING_BALANCE") {
        const rate = 2 / usefulLife;
        let bookVal = purchase;
        for (let y = 0; y < completedYears; y++) {
          const dep = bookVal * rate;
          bookVal = Math.max(bookVal - dep, salvage);
        }
        return sum + bookVal;
      }
      const annualDep = (purchase - salvage) / usefulLife;
      const accumulated = Math.min(annualDep * completedYears, purchase - salvage);
      return sum + Math.max(purchase - accumulated, salvage);
    }, 0),
  };

  return (
    <div className="min-h-screen bg-background">
      <main className="mx-auto max-w-full px-6 py-8 space-y-6">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
          <div>
            <h1 className="text-3xl font-bold" data-testid="text-page-title">
              Equipment & Tools
            </h1>
            <p className="text-muted-foreground">
              Manage your equipment fleet and track availability
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <AIAnalysisButton module="EQUIPMENT" />
            {canManageEquipment && (
              <>
                <Button
                  variant="outline"
                  onClick={handleExportCSV}
                  disabled={equipmentList.length === 0}
                  data-testid="button-export-csv"
                >
                  <Download className="h-4 w-4 mr-2" />
                  Export CSV
                </Button>
                <Button
                  variant="outline"
                  onClick={() => { setShowImportDialog(true); setImportPreviewRows([]); setImportErrors([]); }}
                  data-testid="button-import-csv"
                >
                  <Upload className="h-4 w-4 mr-2" />
                  Import CSV
                </Button>
                <Button
                  onClick={() => setShowCreateDialog(true)}
                  data-testid="button-add-equipment"
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Add Equipment
                </Button>
              </>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
          <Card data-testid="card-stat-total">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-md bg-primary/10">
                  <Truck className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{stats.total}</p>
                  <p className="text-sm text-muted-foreground">
                    Total Equipment
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card data-testid="card-stat-available">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-md bg-green-100 dark:bg-green-900">
                  <Settings2 className="h-5 w-5 text-green-700 dark:text-green-300" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{stats.available}</p>
                  <p className="text-sm text-muted-foreground">Available</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card data-testid="card-stat-assigned">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-md bg-blue-100 dark:bg-blue-900">
                  <MapPin className="h-5 w-5 text-blue-700 dark:text-blue-300" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{stats.assigned}</p>
                  <p className="text-sm text-muted-foreground">Assigned</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card data-testid="card-stat-repair">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-md bg-orange-100 dark:bg-orange-900">
                  <Wrench className="h-5 w-5 text-orange-700 dark:text-orange-300" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{stats.inRepair}</p>
                  <p className="text-sm text-muted-foreground">In Repair</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card data-testid="card-stat-book-value">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-md bg-purple-100 dark:bg-purple-900">
                  <DollarSign className="h-5 w-5 text-purple-700 dark:text-purple-300" />
                </div>
                <div>
                  <p className="text-2xl font-bold" data-testid="text-fleet-book-value">
                    ${stats.totalBookValue.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                  </p>
                  <p className="text-sm text-muted-foreground">Fleet Book Value</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader className="flex flex-row items-center gap-4 pb-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search equipment by name, code, make, model..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10"
                data-testid="input-search"
              />
            </div>

            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger
                className="w-[160px]"
                data-testid="select-status-filter"
              >
                <Filter className="h-4 w-4 mr-2" />
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All Status</SelectItem>
                {STATUS_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={typeFilter} onValueChange={setTypeFilter}>
              <SelectTrigger
                className="w-[180px]"
                data-testid="select-type-filter"
              >
                <Filter className="h-4 w-4 mr-2" />
                <SelectValue placeholder="Type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All Types</SelectItem>
                {EQUIPMENT_TYPES.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </CardHeader>

          <CardContent>
            {isLoading ? (
              <div className="py-8 text-center text-muted-foreground">
                Loading equipment...
              </div>
            ) : equipmentList.length === 0 ? (
              <EmptyState
                icon={Settings2}
                title="No equipment yet"
                description={canManageEquipment
                  ? "Add your first piece of equipment to track assets and maintenance."
                  : "No equipment has been added to the system."}
                actionLabel={canManageEquipment ? "Add Equipment" : undefined}
                onAction={canManageEquipment ? () => setShowCreateDialog(true) : undefined}
                testId="empty-state-equipment"
              />
            ) : isMobile ? (
              <div className="space-y-3">
                {equipmentList.map((eq) => {
                  const TypeIcon = TYPE_ICONS[eq.type] || Settings2;
                  return (
                    <Card
                      key={eq.id}
                      className="cursor-pointer hover-elevate"
                      onClick={() => navigate(`/equipment/${eq.equipmentCode}`)}
                      data-testid={`card-equipment-${eq.id}`}
                    >
                      <CardContent className="p-4">
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-center gap-3 min-w-0">
                            <div className="p-2 rounded-md bg-muted shrink-0">
                              <TypeIcon className="h-4 w-4" />
                            </div>
                            <div className="min-w-0">
                              <p className="font-medium truncate">{eq.name}</p>
                              <p className="text-sm text-muted-foreground truncate">
                                {eq.equipmentCode}{" "}
                                {eq.make &&
                                  eq.model &&
                                  `• ${eq.make} ${eq.model}`}
                              </p>
                            </div>
                          </div>
                          <div onClick={(e) => e.stopPropagation()}>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  data-testid={`button-menu-${eq.id}`}
                                >
                                  <MoreVertical className="h-4 w-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem
                                  onClick={() =>
                                    navigate(`/equipment/${eq.equipmentCode}`)
                                  }
                                >
                                  View Details
                                </DropdownMenuItem>
                                {canDeleteEquipment && (
                                  <DropdownMenuItem
                                    onClick={() => handleDelete(eq)}
                                    className="text-destructive"
                                  >
                                    Delete
                                  </DropdownMenuItem>
                                )}
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>
                        </div>
                        <div className="mt-3 flex flex-wrap items-center gap-2">
                          <Badge className={getStatusBadge(eq.status)}>
                            {getStatusLabel(eq.status)}
                          </Badge>
                          <Badge variant="outline">
                            {getTypeLabel(eq.type)}
                          </Badge>
                        </div>
                        <div className="mt-2 flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
                          <div className="flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            <span>{eq.currentHours || "0"} hrs</span>
                          </div>
                          {(eq.currentLocation || eq.homeLocation) && (
                            <div className="flex items-center gap-1">
                              <MapPin className="h-3 w-3" />
                              <span>
                                {eq.currentLocation || eq.homeLocation}
                              </span>
                            </div>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Equipment</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Hours</TableHead>
                      <TableHead>Location</TableHead>
                      <TableHead className="w-[80px]"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {equipmentList.map((eq) => {
                      const TypeIcon = TYPE_ICONS[eq.type] || Settings2;
                      return (
                        <TableRow
                          key={eq.id}
                          className="cursor-pointer hover-elevate"
                          onClick={() =>
                            navigate(`/equipment/${eq.equipmentCode}`)
                          }
                          data-testid={`row-equipment-${eq.id}`}
                        >
                          <TableCell>
                            <div className="flex items-center gap-3">
                              <div className="p-2 rounded-md bg-muted">
                                <TypeIcon className="h-4 w-4" />
                              </div>
                              <div>
                                <p className="font-medium">{eq.name}</p>
                                <p className="text-sm text-muted-foreground">
                                  {eq.equipmentCode}{" "}
                                  {eq.make &&
                                    eq.model &&
                                    `• ${eq.make} ${eq.model}`}
                                </p>
                              </div>
                            </div>
                          </TableCell>
                          <TableCell>{getTypeLabel(eq.type)}</TableCell>
                          <TableCell>
                            <Badge className={getStatusBadge(eq.status)}>
                              {getStatusLabel(eq.status)}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-1">
                              <Clock className="h-3 w-3 text-muted-foreground" />
                              <span>{eq.currentHours || "0"} hrs</span>
                            </div>
                          </TableCell>
                          <TableCell>
                            {eq.currentLocation || eq.homeLocation || "-"}
                          </TableCell>
                          <TableCell onClick={(e) => e.stopPropagation()}>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  data-testid={`button-menu-${eq.id}`}
                                >
                                  <MoreVertical className="h-4 w-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem
                                  onClick={() =>
                                    navigate(`/equipment/${eq.equipmentCode}`)
                                  }
                                >
                                  View Details
                                </DropdownMenuItem>
                                {canDeleteEquipment && (
                                  <DropdownMenuItem
                                    onClick={() => handleDelete(eq)}
                                    className="text-destructive"
                                  >
                                    Delete
                                  </DropdownMenuItem>
                                )}
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </main>

      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Add New Equipment</DialogTitle>
            <DialogDescription>
              Enter the details for the new equipment or tool.
            </DialogDescription>
          </DialogHeader>

          <Form {...form}>
            <form
              onSubmit={form.handleSubmit(handleSubmit)}
              className="space-y-4"
            >
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem className="col-span-2">
                      <FormLabel>Name *</FormLabel>
                      <FormControl>
                        <Input
                          placeholder="e.g., CAT 320 Excavator #1"
                          {...field}
                          data-testid="input-name"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="type"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Type *</FormLabel>
                      <Select
                        onValueChange={field.onChange}
                        value={field.value}
                      >
                        <FormControl>
                          <SelectTrigger data-testid="select-type">
                            <SelectValue placeholder="Select type" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {EQUIPMENT_TYPES.map((option) => (
                            <SelectItem key={option.value} value={option.value}>
                              {option.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="currentHours"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Current Hours</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          step="0.1"
                          placeholder="0"
                          {...field}
                          data-testid="input-hours"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="make"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Make</FormLabel>
                      <FormControl>
                        <Input
                          placeholder="e.g., Caterpillar"
                          {...field}
                          data-testid="input-make"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="model"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Model</FormLabel>
                      <FormControl>
                        <Input
                          placeholder="e.g., 320D L"
                          {...field}
                          data-testid="input-model"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="year"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Year</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          placeholder="e.g., 2020"
                          {...field}
                          data-testid="input-year"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="serialNumber"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Serial Number</FormLabel>
                      <FormControl>
                        <Input
                          placeholder="Serial number"
                          {...field}
                          data-testid="input-serial"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="vinNumber"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>VIN (Vehicles)</FormLabel>
                      <FormControl>
                        <Input
                          placeholder="VIN number"
                          {...field}
                          data-testid="input-vin"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="licensePlate"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>License Plate</FormLabel>
                      <FormControl>
                        <Input
                          placeholder="License plate"
                          {...field}
                          data-testid="input-license"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="purchasePrice"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Purchase Price</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          step="0.01"
                          placeholder="0.00"
                          {...field}
                          data-testid="input-price"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="homeLocation"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Home Location</FormLabel>
                      <FormControl>
                        <Input
                          placeholder="Default storage location"
                          {...field}
                          data-testid="input-location"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <div className="col-span-2 border-t pt-3 mt-2">
                  <h4 className="text-sm font-medium mb-3">Depreciation Settings</h4>
                  <div className="grid grid-cols-2 gap-4">
                    <FormField
                      control={form.control}
                      name="depreciationMethod"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Depreciation Method</FormLabel>
                          <Select onValueChange={field.onChange} value={field.value || ""}>
                            <FormControl>
                              <SelectTrigger data-testid="select-depreciation-method">
                                <SelectValue placeholder="Select method" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              <SelectItem value="STRAIGHT_LINE">Straight Line</SelectItem>
                              <SelectItem value="DECLINING_BALANCE">Declining Balance</SelectItem>
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="usefulLifeYears"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Useful Life (Years)</FormLabel>
                          <FormControl>
                            <Input type="number" min="1" placeholder="e.g., 10" {...field} data-testid="input-useful-life" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="salvageValue"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Salvage Value ($)</FormLabel>
                          <FormControl>
                            <Input type="number" step="0.01" placeholder="0.00" {...field} data-testid="input-salvage-value" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="inServiceDate"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>In-Service Date</FormLabel>
                          <FormControl>
                            <Input type="date" {...field} data-testid="input-in-service-date" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                </div>

                <FormField
                  control={form.control}
                  name="description"
                  render={({ field }) => (
                    <FormItem className="col-span-2">
                      <FormLabel>Description</FormLabel>
                      <FormControl>
                        <Textarea
                          placeholder="Description and specifications..."
                          {...field}
                          data-testid="input-description"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="notes"
                  render={({ field }) => (
                    <FormItem className="col-span-2">
                      <FormLabel>Notes</FormLabel>
                      <FormControl>
                        <Textarea
                          placeholder="Additional notes..."
                          {...field}
                          data-testid="input-notes"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setShowCreateDialog(false)}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={createEquipment.isPending}
                  data-testid="button-submit"
                >
                  {createEquipment.isPending
                    ? "Creating..."
                    : "Create Equipment"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Equipment</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{equipmentToDelete?.name}"? This
              action cannot be undone and will remove all assignment history,
              repair records, and maintenance schedules.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
              className="bg-destructive hover:bg-destructive/90"
              data-testid="button-confirm-delete"
            >
              {deleteEquipment.isPending ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={showImportDialog} onOpenChange={(open) => { if (!open) { setShowImportDialog(false); setImportPreviewRows([]); setImportErrors([]); } }}>
        <DialogContent className="sm:max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              <div className="flex items-center gap-2">
                <FileUp className="h-5 w-5" />
                Import Equipment from CSV
              </div>
            </DialogTitle>
            <DialogDescription>
              {importPreviewRows.length === 0
                ? "Upload a CSV file with equipment data. Expected headers: Name, Code, Type, Status, Make, Model, Year, Serial Number, VIN, License Plate, etc."
                : `${importPreviewRows.length} row(s) found. Review the data below, then click Import to create new equipment records. Duplicate equipment codes will be skipped.`}
            </DialogDescription>
          </DialogHeader>

          {importPreviewRows.length === 0 && (
            <div className="flex flex-col items-center justify-center border-2 border-dashed rounded-lg p-8 gap-4">
              <FileUp className="h-10 w-10 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">Select a CSV file to upload</p>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv"
                className="hidden"
                onChange={handleFileSelect}
                data-testid="input-import-file"
              />
              <Button variant="outline" onClick={() => fileInputRef.current?.click()} data-testid="button-choose-file">
                <Upload className="h-4 w-4 mr-2" />
                Choose File
              </Button>
            </div>
          )}

          {importErrors.length > 0 && (
            <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 space-y-1">
              <p className="text-sm font-medium text-destructive">Import errors:</p>
              {importErrors.slice(0, 5).map((err, i) => (
                <p key={i} className="text-sm text-destructive/80" data-testid={`text-import-error-${i}`}>
                  Row {err.row}: {err.reason}
                </p>
              ))}
              {importErrors.length > 5 && (
                <p className="text-sm text-destructive/80">...and {importErrors.length - 5} more</p>
              )}
            </div>
          )}

          {importPreviewRows.length > 0 && (
            <div className="overflow-x-auto border rounded-md">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10">#</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Code</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Make</TableHead>
                    <TableHead>Model</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {importPreviewRows.slice(0, 20).map((row, idx) => (
                    <TableRow key={idx} data-testid={`row-import-preview-${idx}`}>
                      <TableCell className="text-muted-foreground">{idx + 1}</TableCell>
                      <TableCell className="font-medium">{row.name || "-"}</TableCell>
                      <TableCell>{row.equipmentCode || "(auto)"}</TableCell>
                      <TableCell>{row.type || "-"}</TableCell>
                      <TableCell>{row.status || "AVAILABLE"}</TableCell>
                      <TableCell>{row.make || "-"}</TableCell>
                      <TableCell>{row.model || "-"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {importPreviewRows.length > 20 && (
                <p className="text-sm text-muted-foreground p-2 text-center">
                  Showing 20 of {importPreviewRows.length} rows
                </p>
              )}
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowImportDialog(false); setImportPreviewRows([]); setImportErrors([]); }}>
              Cancel
            </Button>
            {importPreviewRows.length > 0 && (
              <Button
                onClick={() => importEquipment.mutate(importPreviewRows)}
                disabled={importEquipment.isPending}
                data-testid="button-submit-import"
              >
                {importEquipment.isPending ? "Importing..." : `Import ${importPreviewRows.length} Record(s)`}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
