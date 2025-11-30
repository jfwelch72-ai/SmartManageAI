import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation, Link } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { AIAnalysisButton } from "@/components/AIAnalysisButton";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Form, FormField, FormItem, FormLabel, FormControl, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { 
  Search, Plus, Wrench, Truck, HardHat, Settings2, AlertTriangle,
  Clock, MapPin, DollarSign, Calendar, ChevronRight, Filter, MoreVertical
} from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
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
  { value: "AVAILABLE", label: "Available", color: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200" },
  { value: "ASSIGNED", label: "Assigned", color: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200" },
  { value: "IN_REPAIR", label: "In Repair", color: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200" },
  { value: "OUT_OF_SERVICE", label: "Out of Service", color: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200" },
  { value: "RETIRED", label: "Retired", color: "bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200" },
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
});

type CreateEquipmentInput = z.infer<typeof createEquipmentSchema>;

export default function EquipmentPage() {
  const { user, logout, organizationName } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();
  
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [typeFilter, setTypeFilter] = useState<string>("ALL");
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [equipmentToDelete, setEquipmentToDelete] = useState<Equipment | null>(null);
  
  const { data: equipmentList = [], isLoading } = useQuery<Equipment[]>({
    queryKey: ["/api/equipment", { status: statusFilter, type: typeFilter, search: searchTerm }],
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
    },
  });
  
  const createEquipment = useMutation({
    mutationFn: async (data: CreateEquipmentInput) => {
      return apiRequest("POST", "/api/equipment", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/equipment"] });
      toast({ title: "Success", description: "Equipment created successfully" });
      setShowCreateDialog(false);
      form.reset();
    },
    onError: (error: any) => {
      toast({ 
        title: "Error", 
        description: error.message || "Failed to create equipment",
        variant: "destructive" 
      });
    },
  });
  
  const deleteEquipment = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest("DELETE", `/api/equipment/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/equipment"] });
      toast({ title: "Success", description: "Equipment deleted successfully" });
      setShowDeleteDialog(false);
      setEquipmentToDelete(null);
    },
    onError: (error: any) => {
      toast({ 
        title: "Error", 
        description: error.message || "Failed to delete equipment",
        variant: "destructive" 
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
  
  const getStatusBadge = (status: string) => {
    const statusOption = STATUS_OPTIONS.find(s => s.value === status);
    return statusOption ? statusOption.color : "bg-gray-100 text-gray-800";
  };
  
  const getStatusLabel = (status: string) => {
    const statusOption = STATUS_OPTIONS.find(s => s.value === status);
    return statusOption ? statusOption.label : status;
  };
  
  const getTypeLabel = (type: string) => {
    const typeOption = EQUIPMENT_TYPES.find(t => t.value === type);
    return typeOption ? typeOption.label : type;
  };
  
  const canManageEquipment = user?.role === "ADMIN" || user?.role === "MANAGER" || user?.role === "SUPERINTENDENT";
  const canDeleteEquipment = user?.role === "ADMIN" || user?.role === "MANAGER";
  
  if (!user) return null;
  
  const stats = {
    total: equipmentList.length,
    available: equipmentList.filter(e => e.status === "AVAILABLE").length,
    assigned: equipmentList.filter(e => e.status === "ASSIGNED").length,
    inRepair: equipmentList.filter(e => e.status === "IN_REPAIR").length,
  };
  
  return (
    <div className="min-h-screen bg-background">
      <main className="mx-auto max-w-7xl px-6 py-8 space-y-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold" data-testid="text-page-title">Equipment & Tools</h1>
            <p className="text-muted-foreground">Manage your equipment fleet and track availability</p>
          </div>
          <div className="flex gap-2">
            <AIAnalysisButton module="EQUIPMENT" />
            {canManageEquipment && (
              <Button 
                onClick={() => setShowCreateDialog(true)}
                data-testid="button-add-equipment"
              >
                <Plus className="h-4 w-4 mr-2" />
                Add Equipment
              </Button>
            )}
          </div>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card data-testid="card-stat-total">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-md bg-primary/10">
                  <Truck className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{stats.total}</p>
                  <p className="text-sm text-muted-foreground">Total Equipment</p>
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
              <SelectTrigger className="w-[160px]" data-testid="select-status-filter">
                <Filter className="h-4 w-4 mr-2" />
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All Status</SelectItem>
                {STATUS_OPTIONS.map(option => (
                  <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            
            <Select value={typeFilter} onValueChange={setTypeFilter}>
              <SelectTrigger className="w-[180px]" data-testid="select-type-filter">
                <Filter className="h-4 w-4 mr-2" />
                <SelectValue placeholder="Type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All Types</SelectItem>
                {EQUIPMENT_TYPES.map(option => (
                  <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </CardHeader>
          
          <CardContent>
            {isLoading ? (
              <div className="py-8 text-center text-muted-foreground">Loading equipment...</div>
            ) : equipmentList.length === 0 ? (
              <div className="py-8 text-center text-muted-foreground">
                No equipment found. {canManageEquipment && "Click 'Add Equipment' to create one."}
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
                          onClick={() => navigate(`/equipment/${eq.equipmentCode}`)}
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
                                  {eq.equipmentCode} {eq.make && eq.model && `• ${eq.make} ${eq.model}`}
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
                                <Button variant="ghost" size="icon" data-testid={`button-menu-${eq.id}`}>
                                  <MoreVertical className="h-4 w-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem onClick={() => navigate(`/equipment/${eq.equipmentCode}`)}>
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
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Add New Equipment</DialogTitle>
            <DialogDescription>
              Enter the details for the new equipment or tool.
            </DialogDescription>
          </DialogHeader>
          
          <Form {...form}>
            <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem className="col-span-2">
                      <FormLabel>Name *</FormLabel>
                      <FormControl>
                        <Input placeholder="e.g., CAT 320 Excavator #1" {...field} data-testid="input-name" />
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
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger data-testid="select-type">
                            <SelectValue placeholder="Select type" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {EQUIPMENT_TYPES.map(option => (
                            <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
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
                        <Input type="number" step="0.1" placeholder="0" {...field} data-testid="input-hours" />
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
                        <Input placeholder="e.g., Caterpillar" {...field} data-testid="input-make" />
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
                        <Input placeholder="e.g., 320D L" {...field} data-testid="input-model" />
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
                        <Input type="number" placeholder="e.g., 2020" {...field} data-testid="input-year" />
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
                        <Input placeholder="Serial number" {...field} data-testid="input-serial" />
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
                        <Input placeholder="VIN number" {...field} data-testid="input-vin" />
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
                        <Input placeholder="License plate" {...field} data-testid="input-license" />
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
                        <Input type="number" step="0.01" placeholder="0.00" {...field} data-testid="input-price" />
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
                        <Input placeholder="Default storage location" {...field} data-testid="input-location" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                
                <FormField
                  control={form.control}
                  name="description"
                  render={({ field }) => (
                    <FormItem className="col-span-2">
                      <FormLabel>Description</FormLabel>
                      <FormControl>
                        <Textarea placeholder="Description and specifications..." {...field} data-testid="input-description" />
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
                        <Textarea placeholder="Additional notes..." {...field} data-testid="input-notes" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setShowCreateDialog(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={createEquipment.isPending} data-testid="button-submit">
                  {createEquipment.isPending ? "Creating..." : "Create Equipment"}
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
              Are you sure you want to delete "{equipmentToDelete?.name}"? This action cannot be undone
              and will remove all assignment history, repair records, and maintenance schedules.
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
    </div>
  );
}
