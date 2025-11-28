import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useParams, useLocation, Link } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import AppHeader from "@/components/AppHeader";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Form, FormField, FormItem, FormLabel, FormControl, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { 
  ArrowLeft, Truck, Wrench, Clock, MapPin, Calendar, DollarSign, 
  Settings2, AlertTriangle, CheckCircle, Edit, History, FileText
} from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { format } from "date-fns";
import type { Equipment } from "@shared/schema";

const STATUS_OPTIONS = [
  { value: "AVAILABLE", label: "Available", color: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200" },
  { value: "ASSIGNED", label: "Assigned", color: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200" },
  { value: "IN_REPAIR", label: "In Repair", color: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200" },
  { value: "OUT_OF_SERVICE", label: "Out of Service", color: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200" },
  { value: "RETIRED", label: "Retired", color: "bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200" },
];

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

const editEquipmentSchema = z.object({
  name: z.string().min(1, "Name is required"),
  type: z.string().min(1, "Type is required"),
  status: z.string().min(1, "Status is required"),
  make: z.string().optional(),
  model: z.string().optional(),
  year: z.coerce.number().optional(),
  serialNumber: z.string().optional(),
  vinNumber: z.string().optional(),
  licensePlate: z.string().optional(),
  currentHours: z.string().optional(),
  purchasePrice: z.string().optional(),
  homeLocation: z.string().optional(),
  currentLocation: z.string().optional(),
  description: z.string().optional(),
  notes: z.string().optional(),
});

type EditEquipmentInput = z.infer<typeof editEquipmentSchema>;

export default function EquipmentDetailPage() {
  const { user, logout } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { code } = useParams<{ code: string }>();
  const [, navigate] = useLocation();
  
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [activeTab, setActiveTab] = useState("overview");
  
  const { data: equipment, isLoading, error } = useQuery<Equipment>({
    queryKey: ["/api/equipment", code],
    queryFn: async () => {
      const response = await fetch(`/api/equipment/${code}`, {
        credentials: "include",
      });
      if (!response.ok) {
        if (response.status === 404) throw new Error("Equipment not found");
        throw new Error("Failed to fetch equipment");
      }
      return response.json();
    },
    enabled: !!code,
  });
  
  const { data: assignments = [] } = useQuery<any[]>({
    queryKey: ["/api/equipment", equipment?.id, "assignments"],
    queryFn: async () => {
      const response = await fetch(`/api/equipment/${equipment?.id}/assignments`, {
        credentials: "include",
      });
      if (!response.ok) throw new Error("Failed to fetch assignments");
      return response.json();
    },
    enabled: !!equipment?.id,
  });
  
  const { data: repairs = [] } = useQuery<any[]>({
    queryKey: ["/api/equipment", equipment?.id, "repairs"],
    queryFn: async () => {
      const response = await fetch(`/api/equipment/${equipment?.id}/repairs`, {
        credentials: "include",
      });
      if (!response.ok) throw new Error("Failed to fetch repairs");
      return response.json();
    },
    enabled: !!equipment?.id,
  });
  
  const { data: hourLogs = [] } = useQuery<any[]>({
    queryKey: ["/api/equipment", equipment?.id, "hour-logs"],
    queryFn: async () => {
      const response = await fetch(`/api/equipment/${equipment?.id}/hour-logs`, {
        credentials: "include",
      });
      if (!response.ok) throw new Error("Failed to fetch hour logs");
      return response.json();
    },
    enabled: !!equipment?.id,
  });
  
  const form = useForm<EditEquipmentInput>({
    resolver: zodResolver(editEquipmentSchema),
    defaultValues: {
      name: "",
      type: "",
      status: "",
      make: "",
      model: "",
      year: undefined,
      serialNumber: "",
      vinNumber: "",
      licensePlate: "",
      currentHours: "0",
      purchasePrice: "",
      homeLocation: "",
      currentLocation: "",
      description: "",
      notes: "",
    },
  });
  
  const updateEquipment = useMutation({
    mutationFn: async (data: EditEquipmentInput) => {
      return apiRequest("PATCH", `/api/equipment/${equipment?.id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/equipment"] });
      toast({ title: "Success", description: "Equipment updated successfully" });
      setShowEditDialog(false);
    },
    onError: (error: any) => {
      toast({ 
        title: "Error", 
        description: error.message || "Failed to update equipment",
        variant: "destructive" 
      });
    },
  });
  
  const handleEdit = () => {
    if (equipment) {
      form.reset({
        name: equipment.name || "",
        type: equipment.type || "",
        status: equipment.status || "",
        make: equipment.make || "",
        model: equipment.model || "",
        year: equipment.year || undefined,
        serialNumber: equipment.serialNumber || "",
        vinNumber: equipment.vinNumber || "",
        licensePlate: equipment.licensePlate || "",
        currentHours: equipment.currentHours || "0",
        purchasePrice: equipment.purchasePrice || "",
        homeLocation: equipment.homeLocation || "",
        currentLocation: equipment.currentLocation || "",
        description: equipment.description || "",
        notes: equipment.notes || "",
      });
      setShowEditDialog(true);
    }
  };
  
  const handleSubmit = (data: EditEquipmentInput) => {
    updateEquipment.mutate(data);
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
  
  const canEdit = user?.role === "ADMIN" || user?.role === "MANAGER" || user?.role === "SUPERINTENDENT";
  
  if (!user) return null;
  
  if (isLoading) {
    return (
      <div className="min-h-screen bg-background">
        <AppHeader userName={`${user.firstName} ${user.lastName}`} userRole={user.role} onLogout={logout} />
        <main className="mx-auto max-w-7xl px-6 py-8">
          <div className="text-center text-muted-foreground">Loading equipment...</div>
        </main>
      </div>
    );
  }
  
  if (error || !equipment) {
    return (
      <div className="min-h-screen bg-background">
        <AppHeader userName={`${user.firstName} ${user.lastName}`} userRole={user.role} onLogout={logout} />
        <main className="mx-auto max-w-7xl px-6 py-8">
          <div className="text-center">
            <h2 className="text-xl font-semibold text-destructive">Equipment Not Found</h2>
            <p className="text-muted-foreground mt-2">The equipment you're looking for doesn't exist.</p>
            <Button asChild className="mt-4">
              <Link href="/equipment">Back to Equipment</Link>
            </Button>
          </div>
        </main>
      </div>
    );
  }
  
  return (
    <div className="min-h-screen bg-background">
      <AppHeader
        userName={`${user.firstName} ${user.lastName}`}
        userRole={user.role}
        onLogout={logout}
      />
      
      <main className="mx-auto max-w-7xl px-6 py-8 space-y-6">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" asChild>
            <Link href="/equipment">
              <ArrowLeft className="h-5 w-5" />
            </Link>
          </Button>
          <div className="flex-1">
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold" data-testid="text-equipment-name">{equipment.name}</h1>
              <Badge className={getStatusBadge(equipment.status)}>
                {getStatusLabel(equipment.status)}
              </Badge>
            </div>
            <p className="text-muted-foreground">
              {equipment.equipmentCode} 
              {equipment.make && equipment.model && ` • ${equipment.make} ${equipment.model}`}
              {equipment.year && ` (${equipment.year})`}
            </p>
          </div>
          {canEdit && (
            <Button onClick={handleEdit} data-testid="button-edit">
              <Edit className="h-4 w-4 mr-2" />
              Edit
            </Button>
          )}
        </div>
        
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList>
            <TabsTrigger value="overview" data-testid="tab-overview">Overview</TabsTrigger>
            <TabsTrigger value="assignments" data-testid="tab-assignments">Assignments</TabsTrigger>
            <TabsTrigger value="repairs" data-testid="tab-repairs">Repairs</TabsTrigger>
            <TabsTrigger value="hours" data-testid="tab-hours">Hour Logs</TabsTrigger>
          </TabsList>
          
          <TabsContent value="overview" className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Equipment Details</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <p className="text-sm text-muted-foreground">Type</p>
                      <p className="font-medium">{getTypeLabel(equipment.type)}</p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">Current Hours</p>
                      <p className="font-medium flex items-center gap-1">
                        <Clock className="h-4 w-4" />
                        {equipment.currentHours || "0"} hrs
                      </p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">Make</p>
                      <p className="font-medium">{equipment.make || "-"}</p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">Model</p>
                      <p className="font-medium">{equipment.model || "-"}</p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">Year</p>
                      <p className="font-medium">{equipment.year || "-"}</p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">Serial Number</p>
                      <p className="font-medium">{equipment.serialNumber || "-"}</p>
                    </div>
                    {equipment.vinNumber && (
                      <div>
                        <p className="text-sm text-muted-foreground">VIN</p>
                        <p className="font-medium">{equipment.vinNumber}</p>
                      </div>
                    )}
                    {equipment.licensePlate && (
                      <div>
                        <p className="text-sm text-muted-foreground">License Plate</p>
                        <p className="font-medium">{equipment.licensePlate}</p>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
              
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Location & Status</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <p className="text-sm text-muted-foreground">Home Location</p>
                      <p className="font-medium flex items-center gap-1">
                        <MapPin className="h-4 w-4" />
                        {equipment.homeLocation || "-"}
                      </p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">Current Location</p>
                      <p className="font-medium flex items-center gap-1">
                        <MapPin className="h-4 w-4" />
                        {equipment.currentLocation || equipment.homeLocation || "-"}
                      </p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">Purchase Price</p>
                      <p className="font-medium flex items-center gap-1">
                        <DollarSign className="h-4 w-4" />
                        {equipment.purchasePrice ? `$${parseFloat(equipment.purchasePrice).toLocaleString()}` : "-"}
                      </p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">Last Maintenance</p>
                      <p className="font-medium flex items-center gap-1">
                        <Wrench className="h-4 w-4" />
                        {equipment.lastMaintenanceDate 
                          ? format(new Date(equipment.lastMaintenanceDate), "MMM d, yyyy")
                          : "-"
                        }
                      </p>
                    </div>
                  </div>
                  
                  {equipment.description && (
                    <div>
                      <p className="text-sm text-muted-foreground mb-1">Description</p>
                      <p className="text-sm">{equipment.description}</p>
                    </div>
                  )}
                  
                  {equipment.notes && (
                    <div>
                      <p className="text-sm text-muted-foreground mb-1">Notes</p>
                      <p className="text-sm">{equipment.notes}</p>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </TabsContent>
          
          <TabsContent value="assignments">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Assignment History</CardTitle>
                <CardDescription>Track where this equipment has been assigned</CardDescription>
              </CardHeader>
              <CardContent>
                {assignments.length === 0 ? (
                  <p className="text-center text-muted-foreground py-8">No assignment history</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Project</TableHead>
                        <TableHead>Assigned</TableHead>
                        <TableHead>Returned</TableHead>
                        <TableHead>Hours Used</TableHead>
                        <TableHead>Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {assignments.map((assignment: any) => (
                        <TableRow key={assignment.id}>
                          <TableCell>
                            <Link href={`/projects/${assignment.projectCode}`} className="text-primary hover:underline">
                              {assignment.projectName}
                            </Link>
                          </TableCell>
                          <TableCell>{format(new Date(assignment.assignedAt), "MMM d, yyyy")}</TableCell>
                          <TableCell>
                            {assignment.returnedAt 
                              ? format(new Date(assignment.returnedAt), "MMM d, yyyy")
                              : "-"
                            }
                          </TableCell>
                          <TableCell>
                            {assignment.hoursAtReturn && assignment.hoursAtAssignment
                              ? `${(parseFloat(assignment.hoursAtReturn) - parseFloat(assignment.hoursAtAssignment)).toFixed(1)} hrs`
                              : "-"
                            }
                          </TableCell>
                          <TableCell>
                            <Badge variant={assignment.isActive ? "default" : "secondary"}>
                              {assignment.isActive ? "Active" : "Returned"}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>
          
          <TabsContent value="repairs">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Repair History</CardTitle>
                <CardDescription>Track repairs and maintenance issues</CardDescription>
              </CardHeader>
              <CardContent>
                {repairs.length === 0 ? (
                  <p className="text-center text-muted-foreground py-8">No repair history</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Repair #</TableHead>
                        <TableHead>Description</TableHead>
                        <TableHead>Reported</TableHead>
                        <TableHead>Cost</TableHead>
                        <TableHead>Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {repairs.map((repair: any) => (
                        <TableRow key={repair.id}>
                          <TableCell className="font-mono">{repair.repairNumber}</TableCell>
                          <TableCell>{repair.description}</TableCell>
                          <TableCell>{format(new Date(repair.problemReportedAt), "MMM d, yyyy")}</TableCell>
                          <TableCell>
                            {repair.actualCost 
                              ? `$${parseFloat(repair.actualCost).toLocaleString()}`
                              : repair.estimatedCost
                                ? `~$${parseFloat(repair.estimatedCost).toLocaleString()}`
                                : "-"
                            }
                          </TableCell>
                          <TableCell>
                            <Badge variant={
                              repair.status === "COMPLETED" ? "default" :
                              repair.status === "IN_PROGRESS" ? "secondary" : "outline"
                            }>
                              {repair.status}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>
          
          <TabsContent value="hours">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Hour Logs</CardTitle>
                <CardDescription>Weekly equipment usage tracking</CardDescription>
              </CardHeader>
              <CardContent>
                {hourLogs.length === 0 ? (
                  <p className="text-center text-muted-foreground py-8">No hour logs recorded</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Week</TableHead>
                        <TableHead>Project</TableHead>
                        <TableHead>Starting Hours</TableHead>
                        <TableHead>Ending Hours</TableHead>
                        <TableHead>Hours Used</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {hourLogs.map((log: any) => (
                        <TableRow key={log.id}>
                          <TableCell>
                            {format(new Date(log.weekStartDate), "MMM d")} - {format(new Date(log.weekEndDate), "MMM d, yyyy")}
                          </TableCell>
                          <TableCell>
                            <Link href={`/projects/${log.projectCode}`} className="text-primary hover:underline">
                              {log.projectName}
                            </Link>
                          </TableCell>
                          <TableCell>{log.startingHours}</TableCell>
                          <TableCell>{log.endingHours}</TableCell>
                          <TableCell className="font-medium">{log.hoursUsed} hrs</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </main>
      
      <Dialog open={showEditDialog} onOpenChange={setShowEditDialog}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Equipment</DialogTitle>
            <DialogDescription>
              Update the equipment details.
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
                        <Input {...field} data-testid="input-edit-name" />
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
                          <SelectTrigger>
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
                  name="status"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Status *</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select status" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {STATUS_OPTIONS.map(option => (
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
                        <Input type="number" step="0.1" {...field} />
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
                        <Input {...field} />
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
                        <Input {...field} />
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
                        <Input type="number" {...field} />
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
                        <Input {...field} />
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
                        <Input {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                
                <FormField
                  control={form.control}
                  name="currentLocation"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Current Location</FormLabel>
                      <FormControl>
                        <Input {...field} />
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
                        <Textarea {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setShowEditDialog(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={updateEquipment.isPending} data-testid="button-save">
                  {updateEquipment.isPending ? "Saving..." : "Save Changes"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
