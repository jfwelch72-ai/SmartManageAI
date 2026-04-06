import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Plus, Eye, Edit, Trash2, Ruler, Truck, ExternalLink, Settings2, Link2, Undo2 } from "lucide-react";
import { Calendar as CalendarIcon } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { format, parseISO } from "date-fns";
import { cn } from "@/lib/utils";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar as CalendarPicker } from "@/components/ui/calendar";
import { apiRequest } from "@/lib/queryClient";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { CostCodeCombobox } from "@/components/CostCodeCombobox";

interface ProjectEquipmentTabProps {
  projectId: string;
  projectCode: string;
  userRole: string;
}

function AddEquipmentPlanDialog({ open, onOpenChange, projectId }: { open: boolean; onOpenChange: (open: boolean) => void; projectId: string }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [source, setSource] = useState<"OWNED" | "RENTAL">("OWNED");
  const [equipmentName, setEquipmentName] = useState("");
  const [equipmentType, setEquipmentType] = useState("");
  const [plannedDays, setPlannedDays] = useState("");
  const [dailyRate, setDailyRate] = useState("");
  const [notes, setNotes] = useState("");
  const [costCode, setCostCode] = useState("");

  const createPlan = useMutation({
    mutationFn: async () => {
      const days = plannedDays ? Number(plannedDays) : null;
      const rate = dailyRate ? Number(dailyRate) : null;
      const cost = days && rate ? days * rate : null;
      
      return apiRequest("POST", `/api/projects/${projectId}/equipment-plans`, {
        source,
        equipmentName,
        equipmentType,
        plannedDays: days,
        dailyRate: rate,
        plannedCost: cost,
        notes: notes || null,
        costCode: costCode || null,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "equipment-plans"] });
      toast({ title: "Success", description: "Equipment added to plan" });
      onOpenChange(false);
      resetForm();
    },
    onError: (error: any) => {
      toast({ 
        title: "Error", 
        description: error.message || "Failed to add equipment",
        variant: "destructive" 
      });
    },
  });

  const resetForm = () => {
    setSource("OWNED");
    setEquipmentName("");
    setEquipmentType("");
    setPlannedDays("");
    setDailyRate("");
    setNotes("");
    setCostCode("");
  };

  const calculatedCost = plannedDays && dailyRate ? Number(plannedDays) * Number(dailyRate) : 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add Equipment to Plan</DialogTitle>
          <DialogDescription>Add planned equipment for this project</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Button
              type="button"
              variant={source === "OWNED" ? "default" : "outline"}
              onClick={() => setSource("OWNED")}
              data-testid="button-source-owned"
            >
              <Truck className="h-4 w-4 mr-2" />
              Owned
            </Button>
            <Button
              type="button"
              variant={source === "RENTAL" ? "default" : "outline"}
              onClick={() => setSource("RENTAL")}
              data-testid="button-source-rental"
            >
              <ExternalLink className="h-4 w-4 mr-2" />
              Rental
            </Button>
          </div>

          <div>
            <Label>Equipment Name</Label>
            <Input
              value={equipmentName}
              onChange={(e) => setEquipmentName(e.target.value)}
              placeholder="e.g., CAT 320 Excavator"
              data-testid="input-plan-equipment-name"
            />
          </div>

          <div>
            <Label>Equipment Type</Label>
            <Select value={equipmentType} onValueChange={setEquipmentType}>
              <SelectTrigger data-testid="select-plan-equipment-type">
                <SelectValue placeholder="Select type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Heavy Equipment">Heavy Equipment</SelectItem>
                <SelectItem value="Vehicles">Vehicles</SelectItem>
                <SelectItem value="Power Tools">Power Tools</SelectItem>
                <SelectItem value="Hand Tools">Hand Tools</SelectItem>
                <SelectItem value="Trailers">Trailers</SelectItem>
                <SelectItem value="Concrete Equipment">Concrete Equipment</SelectItem>
                <SelectItem value="Excavation Equipment">Excavation Equipment</SelectItem>
                <SelectItem value="Other">Other</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Planned Days</Label>
              <Input
                type="number"
                value={plannedDays}
                onChange={(e) => setPlannedDays(e.target.value)}
                placeholder="0"
                data-testid="input-plan-days"
              />
            </div>
            <div>
              <Label>Daily Rate ($)</Label>
              <Input
                type="number"
                step="0.01"
                value={dailyRate}
                onChange={(e) => setDailyRate(e.target.value)}
                placeholder="0.00"
                data-testid="input-plan-daily-rate"
              />
            </div>
          </div>

          {calculatedCost > 0 && (
            <div className="p-3 rounded-md bg-muted text-center">
              <div className="text-sm text-muted-foreground">Estimated Cost</div>
              <div className="text-lg font-bold">
                ${calculatedCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </div>
            </div>
          )}

          <div>
            <Label>Cost Code</Label>
            <CostCodeCombobox
              value={costCode}
              onChange={setCostCode}
              data-testid="select-cost-code-equipment"
            />
          </div>

          <div>
            <Label>Notes (Optional)</Label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Additional notes..."
              data-testid="input-plan-notes"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            onClick={() => createPlan.mutate()}
            disabled={!equipmentName || !equipmentType || createPlan.isPending}
            data-testid="button-submit-plan"
          >
            {createPlan.isPending ? "Adding..." : "Add to Plan"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AssignEquipmentDialog({ open, onOpenChange, projectId, plan }: { open: boolean; onOpenChange: (open: boolean) => void; projectId: string; plan: any }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedEquipmentId, setSelectedEquipmentId] = useState("");
  const [expectedDays, setExpectedDays] = useState("");

  const { data: availableEquipment = [], isLoading } = useQuery<any[]>({
    queryKey: ["/api/equipment", "available", plan?.equipmentType],
    queryFn: async () => {
      const response = await fetch(`/api/equipment?status=AVAILABLE&type=${encodeURIComponent(plan?.equipmentType || "")}`, {
        credentials: "include",
      });
      if (!response.ok) throw new Error("Failed to fetch available equipment");
      const data = await response.json();
      return data.data || data;
    },
    enabled: open && !!plan,
  });

  const assignEquipment = useMutation({
    mutationFn: async () => {
      const today = new Date();
      const endDate = expectedDays ? new Date(today.getTime() + Number(expectedDays) * 24 * 60 * 60 * 1000) : null;
      
      await apiRequest("POST", `/api/equipment/${selectedEquipmentId}/assign`, {
        projectId: projectId,
        expectedReturnDate: endDate?.toISOString().split('T')[0] || null,
      });
      
      try {
        await apiRequest("PATCH", `/api/projects/${projectId}/equipment-plans/${plan.id}`, {
          equipmentId: selectedEquipmentId,
          status: "ASSIGNED",
          actualStartDate: today.toISOString(),
          actualDays: expectedDays ? Number(expectedDays) : null,
        });
      } catch (planError) {
        console.error("Failed to update plan after equipment assignment:", planError);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "equipment-plans"] });
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "equipment"] });
      queryClient.invalidateQueries({ queryKey: ["/api/equipment"] });
      queryClient.invalidateQueries({ queryKey: ["/api/equipment", "available"] });
      toast({ title: "Success", description: "Equipment assigned to project" });
      resetForm();
      onOpenChange(false);
    },
    onError: (error: any) => {
      toast({ 
        title: "Error", 
        description: error.message || "Failed to assign equipment",
        variant: "destructive" 
      });
    },
  });

  const resetForm = () => {
    setSelectedEquipmentId("");
    setExpectedDays("");
  };

  useEffect(() => {
    if (open && plan) {
      setExpectedDays(plan.plannedDays ? String(plan.plannedDays) : "");
      setSelectedEquipmentId("");
    } else if (!open) {
      resetForm();
    }
  }, [open, plan]);

  if (!plan) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Assign Equipment to Plan</DialogTitle>
          <DialogDescription>
            Select equipment from your fleet to fulfill: {plan.equipmentName}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="p-3 rounded-md bg-muted/50 text-sm">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <span className="text-muted-foreground">Plan:</span>{" "}
                <span className="font-medium">{plan.equipmentName}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Type:</span>{" "}
                <span className="font-medium">{plan.equipmentType}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Planned Days:</span>{" "}
                <span className="font-medium">{plan.plannedDays || "-"}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Planned Cost:</span>{" "}
                <span className="font-medium">
                  {plan.plannedCost ? `$${Number(plan.plannedCost).toFixed(2)}` : "-"}
                </span>
              </div>
            </div>
          </div>

          <div>
            <Label>Select Equipment from Fleet</Label>
            {isLoading ? (
              <div className="text-sm text-muted-foreground py-2">Loading available equipment...</div>
            ) : availableEquipment.length === 0 ? (
              <div className="text-sm text-muted-foreground py-2">
                No available equipment of type "{plan.equipmentType}" found in your fleet.
              </div>
            ) : (
              <Select value={selectedEquipmentId} onValueChange={setSelectedEquipmentId}>
                <SelectTrigger data-testid="select-equipment-assign">
                  <SelectValue placeholder="Select equipment" />
                </SelectTrigger>
                <SelectContent>
                  {availableEquipment.map((eq: any) => (
                    <SelectItem key={eq.id} value={eq.id}>
                      {eq.name} - {eq.make} {eq.model} ({eq.equipmentCode})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          <div>
            <Label>Expected Duration (Days)</Label>
            <Input
              type="number"
              value={expectedDays}
              onChange={(e) => setExpectedDays(e.target.value)}
              placeholder={plan.plannedDays ? String(plan.plannedDays) : "0"}
              data-testid="input-expected-days"
            />
            <p className="text-xs text-muted-foreground mt-1">
              Used to calculate expected return date
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            onClick={() => assignEquipment.mutate()}
            disabled={!selectedEquipmentId || assignEquipment.isPending}
            data-testid="button-confirm-assign"
          >
            {assignEquipment.isPending ? "Assigning..." : "Assign Equipment"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RentalBookingDialog({ open, onOpenChange, projectId, plan }: { open: boolean; onOpenChange: (open: boolean) => void; projectId: string; plan: any }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedVendorId, setSelectedVendorId] = useState("");
  const [confirmationNumber, setConfirmationNumber] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [dailyRate, setDailyRate] = useState("");
  const [notes, setNotes] = useState("");

  const { data: rentalVendors = [], isLoading } = useQuery<any[]>({
    queryKey: ["/api/rental-vendors"],
    queryFn: async () => {
      const response = await fetch("/api/rental-vendors", { credentials: "include" });
      if (!response.ok) throw new Error("Failed to fetch vendors");
      return response.json();
    },
    enabled: open,
  });

  const bookRental = useMutation({
    mutationFn: async () => {
      const days = startDate && endDate 
        ? Math.ceil((new Date(endDate).getTime() - new Date(startDate).getTime()) / (1000 * 60 * 60 * 24)) + 1
        : null;
      const rate = dailyRate ? Number(dailyRate) : (plan.dailyRate ? Number(plan.dailyRate) : null);
      const cost = days && rate ? days * rate : null;
      
      return apiRequest("PATCH", `/api/projects/${projectId}/equipment-plans/${plan.id}`, {
        status: "RENTAL_BOOKED",
        rentalVendorId: selectedVendorId || null,
        rentalConfirmationNumber: confirmationNumber || null,
        actualStartDate: startDate || null,
        actualEndDate: endDate || null,
        actualDays: days,
        dailyRate: rate,
        actualCost: cost,
        notes: notes || plan.notes,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "equipment-plans"] });
      toast({ title: "Success", description: "Rental booked successfully" });
      resetForm();
      onOpenChange(false);
    },
    onError: (error: any) => {
      toast({ 
        title: "Error", 
        description: error.message || "Failed to book rental",
        variant: "destructive" 
      });
    },
  });

  const resetForm = () => {
    setSelectedVendorId("");
    setConfirmationNumber("");
    setStartDate("");
    setEndDate("");
    setDailyRate("");
    setNotes("");
  };

  useEffect(() => {
    if (open && plan) {
      setSelectedVendorId(plan.rentalVendorId || "");
      setConfirmationNumber(plan.rentalConfirmationNumber || "");
      setStartDate(plan.plannedStartDate ? format(new Date(plan.plannedStartDate), "yyyy-MM-dd") : "");
      setEndDate(plan.plannedEndDate ? format(new Date(plan.plannedEndDate), "yyyy-MM-dd") : "");
      setDailyRate(plan.dailyRate ? String(plan.dailyRate) : "");
      setNotes(plan.notes || "");
    } else if (!open) {
      resetForm();
    }
  }, [open, plan]);

  if (!plan) return null;

  const calculatedDays = startDate && endDate 
    ? Math.ceil((new Date(endDate).getTime() - new Date(startDate).getTime()) / (1000 * 60 * 60 * 24)) + 1
    : 0;
  const rate = dailyRate ? Number(dailyRate) : (plan.dailyRate ? Number(plan.dailyRate) : 0);
  const calculatedCost = calculatedDays * rate;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Book Rental</DialogTitle>
          <DialogDescription>
            Book rental equipment: {plan.equipmentName}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="p-3 rounded-md bg-muted/50 text-sm">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <span className="text-muted-foreground">Equipment:</span>{" "}
                <span className="font-medium">{plan.equipmentName}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Type:</span>{" "}
                <span className="font-medium">{plan.equipmentType}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Planned Days:</span>{" "}
                <span className="font-medium">{plan.plannedDays || "-"}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Planned Cost:</span>{" "}
                <span className="font-medium">
                  {plan.plannedCost ? `$${Number(plan.plannedCost).toFixed(2)}` : "-"}
                </span>
              </div>
            </div>
          </div>

          <div>
            <Label>Rental Vendor</Label>
            {isLoading ? (
              <div className="text-sm text-muted-foreground py-2">Loading vendors...</div>
            ) : (
              <Select value={selectedVendorId} onValueChange={setSelectedVendorId}>
                <SelectTrigger data-testid="select-rental-vendor">
                  <SelectValue placeholder="Select vendor" />
                </SelectTrigger>
                <SelectContent>
                  {rentalVendors.map((vendor: any) => (
                    <SelectItem key={vendor.id} value={vendor.id}>
                      {vendor.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          <div>
            <Label>Confirmation Number (Optional)</Label>
            <Input
              value={confirmationNumber}
              onChange={(e) => setConfirmationNumber(e.target.value)}
              placeholder="e.g., RNT-12345"
              data-testid="input-confirmation-number"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Start Date</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn(
                      "w-full justify-start text-left font-normal",
                      !startDate && "text-muted-foreground"
                    )}
                    data-testid="input-rental-start-date"
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {startDate ? format(parseISO(startDate), "PPP") : "Pick a date"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <CalendarPicker
                    mode="single"
                    selected={startDate ? parseISO(startDate) : undefined}
                    onSelect={(date) => setStartDate(date ? format(date, "yyyy-MM-dd") : "")}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>
            </div>
            <div className="space-y-2">
              <Label>End Date</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn(
                      "w-full justify-start text-left font-normal",
                      !endDate && "text-muted-foreground"
                    )}
                    data-testid="input-rental-end-date"
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {endDate ? format(parseISO(endDate), "PPP") : "Pick a date"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <CalendarPicker
                    mode="single"
                    selected={endDate ? parseISO(endDate) : undefined}
                    onSelect={(date) => setEndDate(date ? format(date, "yyyy-MM-dd") : "")}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>
            </div>
          </div>

          <div>
            <Label>Daily Rate ($)</Label>
            <Input
              type="number"
              step="0.01"
              value={dailyRate}
              onChange={(e) => setDailyRate(e.target.value)}
              placeholder={plan.dailyRate ? String(plan.dailyRate) : "0.00"}
              data-testid="input-rental-daily-rate"
            />
          </div>

          {calculatedCost > 0 && (
            <div className="p-3 rounded-md bg-muted text-center">
              <div className="text-sm text-muted-foreground">{calculatedDays} days x ${rate.toFixed(2)}/day</div>
              <div className="text-lg font-bold">
                Total: ${calculatedCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </div>
            </div>
          )}

          <div>
            <Label>Notes (Optional)</Label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Additional notes..."
              data-testid="input-rental-notes"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            onClick={() => bookRental.mutate()}
            disabled={bookRental.isPending}
            data-testid="button-confirm-booking"
          >
            {bookRental.isPending ? "Booking..." : "Book Rental"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RentalTrackingDialog({ open, onOpenChange, projectId, plan }: { open: boolean; onOpenChange: (open: boolean) => void; projectId: string; plan: any }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<string>("RENTAL_ACTIVE");
  const [actualDays, setActualDays] = useState("");
  const [actualCost, setActualCost] = useState("");
  const [notes, setNotes] = useState("");

  const updateRental = useMutation({
    mutationFn: async () => {
      const updateData: Record<string, any> = {
        status,
        notes: notes || plan.notes,
      };
      
      if (actualDays) updateData.actualDays = Number(actualDays);
      if (actualCost) updateData.actualCost = Number(actualCost);
      
      if (status === "COMPLETED") {
        updateData.actualEndDate = new Date().toISOString();
      }
      
      return apiRequest("PATCH", `/api/projects/${projectId}/equipment-plans/${plan.id}`, updateData);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "equipment-plans"] });
      toast({ title: "Success", description: "Rental updated successfully" });
      onOpenChange(false);
    },
    onError: (error: any) => {
      toast({ 
        title: "Error", 
        description: error.message || "Failed to update rental",
        variant: "destructive" 
      });
    },
  });

  useEffect(() => {
    if (open && plan) {
      setStatus(plan.status);
      setActualDays(plan.actualDays ? String(plan.actualDays) : "");
      setActualCost(plan.actualCost ? String(plan.actualCost) : "");
      setNotes(plan.notes || "");
    }
  }, [open, plan]);

  if (!plan) return null;

  const costVariance = plan.plannedCost && actualCost 
    ? Number(actualCost) - Number(plan.plannedCost) 
    : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Track Rental</DialogTitle>
          <DialogDescription>
            Update rental status and track costs: {plan.equipmentName}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="p-3 rounded-md bg-muted/50 text-sm">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <span className="text-muted-foreground">Equipment:</span>{" "}
                <span className="font-medium">{plan.equipmentName}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Vendor:</span>{" "}
                <span className="font-medium">{plan.vendorName || "-"}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Planned Cost:</span>{" "}
                <span className="font-medium">
                  {plan.plannedCost ? `$${Number(plan.plannedCost).toFixed(2)}` : "-"}
                </span>
              </div>
              <div>
                <span className="text-muted-foreground">Confirmation:</span>{" "}
                <span className="font-medium">{plan.rentalConfirmationNumber || "-"}</span>
              </div>
            </div>
          </div>

          <div>
            <Label>Status</Label>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger data-testid="select-rental-status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="RENTAL_BOOKED">Booked</SelectItem>
                <SelectItem value="RENTAL_ACTIVE">Active</SelectItem>
                <SelectItem value="COMPLETED">Completed</SelectItem>
                <SelectItem value="CANCELLED">Cancelled</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Actual Days</Label>
              <Input
                type="number"
                value={actualDays}
                onChange={(e) => setActualDays(e.target.value)}
                placeholder={plan.plannedDays ? String(plan.plannedDays) : "0"}
                data-testid="input-actual-days"
              />
            </div>
            <div>
              <Label>Actual Cost ($)</Label>
              <Input
                type="number"
                step="0.01"
                value={actualCost}
                onChange={(e) => setActualCost(e.target.value)}
                placeholder={plan.plannedCost ? String(plan.plannedCost) : "0.00"}
                data-testid="input-actual-cost"
              />
            </div>
          </div>

          {costVariance !== null && (
            <div className={`p-3 rounded-md text-center ${costVariance > 0 ? 'bg-destructive/10' : 'bg-green-500/10'}`}>
              <div className="text-sm text-muted-foreground">Cost Variance</div>
              <div className={`text-lg font-bold ${costVariance > 0 ? 'text-destructive' : 'text-green-600'}`}>
                {costVariance > 0 ? '+' : ''}{costVariance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                <span className="text-sm ml-1">
                  ({((costVariance / Number(plan.plannedCost)) * 100).toFixed(1)}%)
                </span>
              </div>
            </div>
          )}

          <div>
            <Label>Notes (Optional)</Label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Additional notes..."
              data-testid="input-tracking-notes"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            onClick={() => updateRental.mutate()}
            disabled={updateRental.isPending}
            data-testid="button-update-rental"
          >
            {updateRental.isPending ? "Updating..." : "Update Rental"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditEquipmentPlanDialog({ open, onOpenChange, projectId, plan }: { open: boolean; onOpenChange: (open: boolean) => void; projectId: string; plan: any }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [equipmentName, setEquipmentName] = useState("");
  const [plannedDays, setPlannedDays] = useState("");
  const [dailyRate, setDailyRate] = useState("");
  const [notes, setNotes] = useState("");
  const [costCode, setCostCode] = useState("");

  useEffect(() => {
    if (open && plan) {
      setEquipmentName(plan.equipmentName || "");
      setPlannedDays(plan.plannedDays ? String(plan.plannedDays) : "");
      setDailyRate(plan.dailyRate ? String(plan.dailyRate) : "");
      setNotes(plan.notes || "");
      setCostCode(plan.costCode || "");
    }
  }, [open, plan]);

  const updatePlan = useMutation({
    mutationFn: async () => {
      const days = plannedDays ? Number(plannedDays) : null;
      const rate = dailyRate ? Number(dailyRate) : null;
      const cost = days && rate ? days * rate : null;

      return apiRequest("PATCH", `/api/projects/${projectId}/equipment-plans/${plan.id}`, {
        equipmentName,
        plannedDays: days,
        dailyRate: rate,
        plannedCost: cost,
        notes: notes || null,
        costCode: costCode || null,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "equipment-plans"] });
      toast({ title: "Success", description: "Equipment plan updated" });
      onOpenChange(false);
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to update plan", variant: "destructive" });
    },
  });

  if (!plan) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Edit Equipment Plan</DialogTitle>
          <DialogDescription>Update equipment plan details</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label>Equipment Name</Label>
            <Input
              value={equipmentName}
              onChange={(e) => setEquipmentName(e.target.value)}
              data-testid="input-edit-plan-name"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Planned Days</Label>
              <Input
                type="number"
                value={plannedDays}
                onChange={(e) => setPlannedDays(e.target.value)}
                data-testid="input-edit-plan-days"
              />
            </div>
            <div>
              <Label>Daily Rate ($)</Label>
              <Input
                type="number"
                step="0.01"
                value={dailyRate}
                onChange={(e) => setDailyRate(e.target.value)}
                data-testid="input-edit-plan-rate"
              />
            </div>
          </div>
          <div>
            <Label>Cost Code</Label>
            <CostCodeCombobox
              value={costCode}
              onChange={setCostCode}
              data-testid="select-cost-code-edit-equipment"
            />
          </div>
          <div>
            <Label>Notes (Optional)</Label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              data-testid="input-edit-plan-notes"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            onClick={() => updatePlan.mutate()}
            disabled={!equipmentName || updatePlan.isPending}
            data-testid="button-save-edit-plan"
          >
            {updatePlan.isPending ? "Saving..." : "Save Changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function ProjectEquipmentTab({ projectId, projectCode, userRole }: ProjectEquipmentTabProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [showAddPlanDialog, setShowAddPlanDialog] = useState(false);
  const [showEditPlanDialog, setShowEditPlanDialog] = useState(false);
  const [selectedPlanForEdit, setSelectedPlanForEdit] = useState<any>(null);
  const [showAssignDialog, setShowAssignDialog] = useState(false);
  const [selectedPlanForAssignment, setSelectedPlanForAssignment] = useState<any>(null);
  const [showRentalBookingDialog, setShowRentalBookingDialog] = useState(false);
  const [showRentalTrackingDialog, setShowRentalTrackingDialog] = useState(false);
  const [selectedPlanForRental, setSelectedPlanForRental] = useState<any>(null);
  
  const { data: assignedEquipment = [], isLoading: loadingAssigned } = useQuery<any[]>({
    queryKey: ["/api/projects", projectId, "equipment"],
    queryFn: async () => {
      const response = await fetch(`/api/projects/${projectId}/equipment`, {
        credentials: "include",
      });
      if (!response.ok) throw new Error("Failed to fetch equipment");
      return response.json();
    },
    enabled: !!projectId,
  });

  const { data: equipmentPlans = [], isLoading: loadingPlans } = useQuery<any[]>({
    queryKey: ["/api/projects", projectId, "equipment-plans"],
    queryFn: async () => {
      const response = await fetch(`/api/projects/${projectId}/equipment-plans`, {
        credentials: "include",
      });
      if (!response.ok) throw new Error("Failed to fetch equipment plans");
      return response.json();
    },
    enabled: !!projectId,
  });

  const canManageEquipment = userRole === "ADMIN" || userRole === "MANAGER" || userRole === "SUPERINTENDENT" || userRole === "FIELD_WORKER";
  const canManagePlans = userRole === "ADMIN" || userRole === "MANAGER" || userRole === "SUPERINTENDENT" || userRole === "ESTIMATOR";

  const returnEquipment = useMutation({
    mutationFn: async (equipmentId: string) => {
      return apiRequest("POST", `/api/equipment/${equipmentId}/return`, {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "equipment"] });
      queryClient.invalidateQueries({ queryKey: ["/api/equipment"] });
      toast({ title: "Success", description: "Equipment returned" });
    },
    onError: (error: any) => {
      toast({ 
        title: "Error", 
        description: error.message || "Failed to return equipment",
        variant: "destructive" 
      });
    },
  });

  const updatePlanStatus = useMutation({
    mutationFn: async ({ planId, status }: { planId: string; status: string }) => {
      return apiRequest("PATCH", `/api/projects/${projectId}/equipment-plans/${planId}`, { status });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "equipment-plans"] });
      toast({ title: "Success", description: "Equipment plan updated" });
    },
    onError: (error: any) => {
      toast({ 
        title: "Error", 
        description: error.message || "Failed to update plan",
        variant: "destructive" 
      });
    },
  });

  const deletePlan = useMutation({
    mutationFn: async (planId: string) => {
      return apiRequest("DELETE", `/api/projects/${projectId}/equipment-plans/${planId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "equipment-plans"] });
      toast({ title: "Success", description: "Equipment plan removed" });
    },
    onError: (error: any) => {
      toast({ 
        title: "Error", 
        description: error.message || "Failed to remove plan",
        variant: "destructive" 
      });
    },
  });

  const isLoading = loadingAssigned || loadingPlans;

  const totalPlannedCost = equipmentPlans.reduce((sum: number, plan: any) => sum + Number(plan.plannedCost || 0), 0);
  const ownedPlans = equipmentPlans.filter((p: any) => p.source === "OWNED");
  const rentalPlans = equipmentPlans.filter((p: any) => p.source === "RENTAL");

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground">
          Loading equipment...
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Ruler className="h-5 w-5" />
                Equipment Plan
              </CardTitle>
              <CardDescription>
                Planned equipment for this project (from bid or manually added)
              </CardDescription>
            </div>
            <div className="w-full sm:w-auto flex flex-wrap gap-2">
              {totalPlannedCost > 0 && (
                <Badge variant="secondary" className="text-base">
                  Total: ${totalPlannedCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </Badge>
              )}
              {canManagePlans && (
                <Button size="sm" onClick={() => setShowAddPlanDialog(true)} data-testid="button-add-equipment-plan" className="w-full sm:w-auto">
                  <Plus className="h-4 w-4 mr-1" />
                  Add Equipment
                </Button>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {equipmentPlans.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Ruler className="h-12 w-12 mx-auto mb-4 opacity-20" />
              <p>No equipment planned for this project</p>
              {canManagePlans && (
                <p className="text-sm mt-2">
                  Equipment plans are carried over when converting a bid to a project
                </p>
              )}
            </div>
          ) : (
            <>
            <div className="hidden md:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Equipment</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Source</TableHead>
                    <TableHead>Planned Days</TableHead>
                    <TableHead>Rate</TableHead>
                    <TableHead>Planned Cost</TableHead>
                    <TableHead>Cost Code</TableHead>
                    <TableHead>Status</TableHead>
                    {canManagePlans && <TableHead>Actions</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {equipmentPlans.map((plan: any) => (
                    <TableRow key={plan.id}>
                      <TableCell className="font-medium">{plan.equipmentName}</TableCell>
                      <TableCell>
                        <Badge variant="outline">{plan.equipmentType}</Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant={plan.source === "OWNED" ? "default" : "secondary"}>
                          {plan.source}
                        </Badge>
                      </TableCell>
                      <TableCell>{plan.plannedDays || plan.plannedHours ? `${plan.plannedDays || "-"} days / ${plan.plannedHours || "-"} hrs` : "-"}</TableCell>
                      <TableCell>
                        {plan.dailyRate ? `$${Number(plan.dailyRate).toFixed(2)}/day` : plan.hourlyRate ? `$${Number(plan.hourlyRate).toFixed(2)}/hr` : "-"}
                      </TableCell>
                      <TableCell className="font-medium">
                        {plan.plannedCost ? `$${Number(plan.plannedCost).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "-"}
                      </TableCell>
                      <TableCell>
                        {plan.costCode ? (
                          <Badge variant="outline" data-testid={`text-cost-code-equipment-${plan.id}`}>{plan.costCode}</Badge>
                        ) : (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Select
                          value={plan.status}
                          onValueChange={(value) => updatePlanStatus.mutate({ planId: plan.id, status: value })}
                          disabled={!canManagePlans || updatePlanStatus.isPending}
                        >
                          <SelectTrigger className="w-32" data-testid={`select-plan-status-${plan.id}`}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="PLANNED">Planned</SelectItem>
                            <SelectItem value="ASSIGNED">Assigned</SelectItem>
                            <SelectItem value="RENTAL_BOOKED">Rental Booked</SelectItem>
                            <SelectItem value="RENTAL_ACTIVE">Rental Active</SelectItem>
                            <SelectItem value="COMPLETED">Completed</SelectItem>
                            <SelectItem value="CANCELLED">Cancelled</SelectItem>
                          </SelectContent>
                        </Select>
                      </TableCell>
                      {canManagePlans && (
                        <TableCell>
                          <div className="flex items-center gap-1">
                            {plan.source === "OWNED" && plan.status === "PLANNED" && !plan.equipmentId && (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => {
                                  setSelectedPlanForAssignment(plan);
                                  setShowAssignDialog(true);
                                }}
                                data-testid={`button-assign-plan-${plan.id}`}
                              >
                                <Link2 className="h-4 w-4 mr-1" />
                                Assign
                              </Button>
                            )}
                            {plan.source === "RENTAL" && plan.status === "PLANNED" && (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => {
                                  setSelectedPlanForRental(plan);
                                  setShowRentalBookingDialog(true);
                                }}
                                data-testid={`button-book-rental-${plan.id}`}
                              >
                                <ExternalLink className="h-4 w-4 mr-1" />
                                Book
                              </Button>
                            )}
                            {plan.source === "RENTAL" && (plan.status === "RENTAL_BOOKED" || plan.status === "RENTAL_ACTIVE") && (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => {
                                  setSelectedPlanForRental(plan);
                                  setShowRentalTrackingDialog(true);
                                }}
                                data-testid={`button-track-rental-${plan.id}`}
                              >
                                <Edit className="h-4 w-4 mr-1" />
                                Track
                              </Button>
                            )}
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => {
                                setSelectedPlanForEdit(plan);
                                setShowEditPlanDialog(true);
                              }}
                              data-testid={`button-edit-plan-${plan.id}`}
                            >
                              <Settings2 className="h-4 w-4" />
                            </Button>
                            {plan.equipmentId && (
                              <Button
                                variant="ghost"
                                size="sm"
                                asChild
                                data-testid={`button-view-equipment-${plan.id}`}
                              >
                                <Link href={`/equipment/${plan.equipmentCode || plan.equipmentId}`}>
                                  <Eye className="h-4 w-4" />
                                </Link>
                              </Button>
                            )}
                            <AlertDialog>
                              <AlertDialogTrigger asChild>
                                <Button variant="ghost" size="icon" data-testid={`button-delete-plan-${plan.id}`}>
                                  <Trash2 className="h-4 w-4 text-destructive" />
                                </Button>
                              </AlertDialogTrigger>
                              <AlertDialogContent>
                                <AlertDialogHeader>
                                  <AlertDialogTitle>Delete Equipment Plan?</AlertDialogTitle>
                                  <AlertDialogDescription>
                                    Remove "{plan.equipmentName}" from the equipment plan. This cannot be undone.
                                  </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                                  <AlertDialogAction onClick={() => deletePlan.mutate(plan.id)}>
                                    Delete
                                  </AlertDialogAction>
                                </AlertDialogFooter>
                              </AlertDialogContent>
                            </AlertDialog>
                          </div>
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <div className="md:hidden space-y-3">
              {equipmentPlans.map((plan: any) => (
                <div key={plan.id} className="border rounded-md p-4 space-y-3" data-testid={`card-equipment-plan-mobile-${plan.id}`}>
                  <div className="flex items-start justify-between gap-2">
                    <span className="font-medium">{plan.equipmentName}</span>
                    <div className="flex items-center gap-1 shrink-0">
                      <Badge variant="outline">{plan.equipmentType}</Badge>
                      <Badge variant={plan.source === "OWNED" ? "default" : "secondary"}>
                        {plan.source}
                      </Badge>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div>
                      <span className="text-muted-foreground">Planned Days/Hrs</span>
                      <p>{plan.plannedDays || plan.plannedHours ? `${plan.plannedDays || "-"} days / ${plan.plannedHours || "-"} hrs` : "-"}</p>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Rate</span>
                      <p>{plan.dailyRate ? `$${Number(plan.dailyRate).toFixed(2)}/day` : plan.hourlyRate ? `$${Number(plan.hourlyRate).toFixed(2)}/hr` : "-"}</p>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Planned Cost</span>
                      <p className="font-medium">{plan.plannedCost ? `$${Number(plan.plannedCost).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "-"}</p>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Cost Code</span>
                      <p>{plan.costCode ? plan.costCode : "-"}</p>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Status</span>
                      <div className="mt-1">
                        <Select
                          value={plan.status}
                          onValueChange={(value) => updatePlanStatus.mutate({ planId: plan.id, status: value })}
                          disabled={!canManagePlans || updatePlanStatus.isPending}
                        >
                          <SelectTrigger className="w-full" data-testid={`select-plan-status-mobile-${plan.id}`}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="PLANNED">Planned</SelectItem>
                            <SelectItem value="ASSIGNED">Assigned</SelectItem>
                            <SelectItem value="RENTAL_BOOKED">Rental Booked</SelectItem>
                            <SelectItem value="RENTAL_ACTIVE">Rental Active</SelectItem>
                            <SelectItem value="COMPLETED">Completed</SelectItem>
                            <SelectItem value="CANCELLED">Cancelled</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  </div>
                  {canManagePlans && (
                    <div className="flex flex-wrap items-center gap-2 pt-1">
                      {plan.source === "OWNED" && plan.status === "PLANNED" && !plan.equipmentId && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setSelectedPlanForAssignment(plan);
                            setShowAssignDialog(true);
                          }}
                          data-testid={`button-assign-plan-mobile-${plan.id}`}
                        >
                          <Link2 className="h-4 w-4 mr-1" />
                          Assign
                        </Button>
                      )}
                      {plan.source === "RENTAL" && plan.status === "PLANNED" && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setSelectedPlanForRental(plan);
                            setShowRentalBookingDialog(true);
                          }}
                          data-testid={`button-book-rental-mobile-${plan.id}`}
                        >
                          <ExternalLink className="h-4 w-4 mr-1" />
                          Book
                        </Button>
                      )}
                      {plan.source === "RENTAL" && (plan.status === "RENTAL_BOOKED" || plan.status === "RENTAL_ACTIVE") && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setSelectedPlanForRental(plan);
                            setShowRentalTrackingDialog(true);
                          }}
                          data-testid={`button-track-rental-mobile-${plan.id}`}
                        >
                          <Edit className="h-4 w-4 mr-1" />
                          Track
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => {
                          setSelectedPlanForEdit(plan);
                          setShowEditPlanDialog(true);
                        }}
                        data-testid={`button-edit-plan-mobile-${plan.id}`}
                      >
                        <Settings2 className="h-4 w-4" />
                      </Button>
                      {plan.equipmentId && (
                        <Button
                          variant="ghost"
                          size="sm"
                          asChild
                          data-testid={`button-view-equipment-mobile-${plan.id}`}
                        >
                          <Link href={`/equipment/${plan.equipmentCode || plan.equipmentId}`}>
                            <Eye className="h-4 w-4 mr-1" />
                            View
                          </Link>
                        </Button>
                      )}
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button variant="ghost" size="icon" data-testid={`button-delete-plan-mobile-${plan.id}`}>
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Delete Equipment Plan?</AlertDialogTitle>
                            <AlertDialogDescription>
                              Remove "{plan.equipmentName}" from the equipment plan. This cannot be undone.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction onClick={() => deletePlan.mutate(plan.id)}>
                              Delete
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  )}
                </div>
              ))}
            </div>
            </>
          )}

          {equipmentPlans.length > 0 && (
            <div className="mt-4 grid grid-cols-3 gap-4 text-sm">
              <div className="p-3 rounded-md bg-muted/50">
                <div className="text-muted-foreground">Owned Equipment</div>
                <div className="text-lg font-semibold">{ownedPlans.length} items</div>
                <div className="text-muted-foreground">
                  ${ownedPlans.reduce((sum: number, p: any) => sum + Number(p.plannedCost || 0), 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </div>
              </div>
              <div className="p-3 rounded-md bg-muted/50">
                <div className="text-muted-foreground">Rental Equipment</div>
                <div className="text-lg font-semibold">{rentalPlans.length} items</div>
                <div className="text-muted-foreground">
                  ${rentalPlans.reduce((sum: number, p: any) => sum + Number(p.plannedCost || 0), 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </div>
              </div>
              <div className="p-3 rounded-md bg-muted/50">
                <div className="text-muted-foreground">Total Planned Cost</div>
                <div className="text-lg font-semibold">
                  ${totalPlannedCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Truck className="h-5 w-5" />
                Assigned Equipment
              </CardTitle>
              <CardDescription>
                Equipment currently assigned to this project
              </CardDescription>
            </div>
            {canManageEquipment && (
              <Button asChild size="sm" data-testid="button-manage-equipment" className="w-full sm:w-auto">
                <Link href="/equipment">
                  <Settings2 className="h-4 w-4 mr-2" />
                  Manage Equipment
                </Link>
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {assignedEquipment.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Truck className="h-12 w-12 mx-auto mb-4 opacity-20" />
              <p>No equipment currently assigned to this project</p>
              {canManageEquipment && (
                <p className="text-sm mt-2">
                  <Link href="/equipment" className="text-primary hover:underline">
                    Go to Equipment
                  </Link> to assign equipment to this project
                </p>
              )}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Equipment</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Make/Model</TableHead>
                  <TableHead>Assigned</TableHead>
                  <TableHead>Expected Return</TableHead>
                  <TableHead>Status</TableHead>
                  {canManageEquipment && <TableHead>Actions</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {assignedEquipment.map((item: any) => (
                  <TableRow key={item.id}>
                    <TableCell>
                      <Link href={`/equipment/${item.equipmentCode}`} className="text-primary hover:underline font-medium">
                        {item.name}
                      </Link>
                      <div className="text-xs text-muted-foreground">{item.equipmentCode}</div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{item.type}</Badge>
                    </TableCell>
                    <TableCell>
                      {item.make && item.model 
                        ? `${item.make} ${item.model}` 
                        : item.make || item.model || "-"
                      }
                      {item.year && <span className="text-muted-foreground ml-1">({item.year})</span>}
                    </TableCell>
                    <TableCell>
                      {item.assignedAt 
                        ? format(new Date(item.assignedAt), "MMM d, yyyy")
                        : "-"
                      }
                    </TableCell>
                    <TableCell>
                      {item.expectedReturnDate
                        ? format(new Date(item.expectedReturnDate), "MMM d, yyyy")
                        : "-"
                      }
                    </TableCell>
                    <TableCell>
                      <Badge variant={item.status === "ASSIGNED" ? "default" : "secondary"}>
                        {item.status}
                      </Badge>
                    </TableCell>
                    {canManageEquipment && (
                      <TableCell>
                        <div className="flex gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => returnEquipment.mutate(item.id)}
                            disabled={returnEquipment.isPending}
                            data-testid={`button-return-${item.equipmentCode}`}
                          >
                            <Undo2 className="h-4 w-4 mr-1" />
                            Return
                          </Button>
                        </div>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <AddEquipmentPlanDialog
        open={showAddPlanDialog}
        onOpenChange={setShowAddPlanDialog}
        projectId={projectId}
      />

      <AssignEquipmentDialog
        open={showAssignDialog}
        onOpenChange={(open) => {
          setShowAssignDialog(open);
          if (!open) setSelectedPlanForAssignment(null);
        }}
        projectId={projectId}
        plan={selectedPlanForAssignment}
      />

      <RentalBookingDialog
        open={showRentalBookingDialog}
        onOpenChange={(open) => {
          setShowRentalBookingDialog(open);
          if (!open) setSelectedPlanForRental(null);
        }}
        projectId={projectId}
        plan={selectedPlanForRental}
      />

      <RentalTrackingDialog
        open={showRentalTrackingDialog}
        onOpenChange={(open) => {
          setShowRentalTrackingDialog(open);
          if (!open) setSelectedPlanForRental(null);
        }}
        projectId={projectId}
        plan={selectedPlanForRental}
      />

      <EditEquipmentPlanDialog
        open={showEditPlanDialog}
        onOpenChange={(open) => {
          setShowEditPlanDialog(open);
          if (!open) setSelectedPlanForEdit(null);
        }}
        projectId={projectId}
        plan={selectedPlanForEdit}
      />
    </div>
  );
}
