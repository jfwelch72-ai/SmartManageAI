import { useState } from "react";
import { UseFormReturn } from "react-hook-form";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Form, FormField, FormItem, FormLabel, FormControl, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Calendar as CalendarPicker } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { format, parseISO } from "date-fns";
import { cn } from "@/lib/utils";
import {
  Loader2, Sparkles, Calendar, Package, ClipboardList,
  AlertTriangle, Calendar as CalendarIcon
} from "lucide-react";
import type {
  EditEquipmentInput, AssignmentInput, ReturnEquipmentInput,
  RepairInput, HourLogInput, RateProfileInput, AIRecommendation,
  FuelLogInput
} from "@/hooks/useEquipmentMutations";
import type { MaintenanceSchedule, RateProfile } from "./EquipmentTabs";

const STATUS_OPTIONS = [
  { value: "AVAILABLE", label: "Available" },
  { value: "ASSIGNED", label: "Assigned" },
  { value: "IN_REPAIR", label: "In Repair" },
  { value: "OUT_OF_SERVICE", label: "Out of Service" },
  { value: "RETIRED", label: "Retired" },
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

interface EditEquipmentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  form: UseFormReturn<EditEquipmentInput>;
  onSubmit: (data: EditEquipmentInput) => void;
  isPending: boolean;
}

export function EditEquipmentDialog({ open, onOpenChange, form, onSubmit, isPending }: EditEquipmentDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit Equipment</DialogTitle>
          <DialogDescription>Update the equipment details.</DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <FormField control={form.control} name="name" render={({ field }) => (
                <FormItem className="col-span-2">
                  <FormLabel>Name *</FormLabel>
                  <FormControl><Input {...field} data-testid="input-edit-name" /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={form.control} name="type" render={({ field }) => (
                <FormItem>
                  <FormLabel>Type *</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl><SelectTrigger><SelectValue placeholder="Select type" /></SelectTrigger></FormControl>
                    <SelectContent>
                      {EQUIPMENT_TYPES.map(option => (
                        <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={form.control} name="status" render={({ field }) => (
                <FormItem>
                  <FormLabel>Status *</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl><SelectTrigger><SelectValue placeholder="Select status" /></SelectTrigger></FormControl>
                    <SelectContent>
                      {STATUS_OPTIONS.map(option => (
                        <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={form.control} name="currentHours" render={({ field }) => (
                <FormItem>
                  <FormLabel>Current Hours</FormLabel>
                  <FormControl><Input type="number" step="0.1" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={form.control} name="make" render={({ field }) => (
                <FormItem>
                  <FormLabel>Make</FormLabel>
                  <FormControl><Input {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={form.control} name="model" render={({ field }) => (
                <FormItem>
                  <FormLabel>Model</FormLabel>
                  <FormControl><Input {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={form.control} name="year" render={({ field }) => (
                <FormItem>
                  <FormLabel>Year</FormLabel>
                  <FormControl><Input type="number" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={form.control} name="serialNumber" render={({ field }) => (
                <FormItem>
                  <FormLabel>Serial Number</FormLabel>
                  <FormControl><Input {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={form.control} name="homeLocation" render={({ field }) => (
                <FormItem>
                  <FormLabel>Home Location</FormLabel>
                  <FormControl><Input {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={form.control} name="currentLocation" render={({ field }) => (
                <FormItem>
                  <FormLabel>Current Location</FormLabel>
                  <FormControl><Input {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={form.control} name="notes" render={({ field }) => (
                <FormItem className="col-span-2">
                  <FormLabel>Notes</FormLabel>
                  <FormControl><Textarea {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
            </div>

            <div className="border-t pt-4">
              <h4 className="text-sm font-medium mb-3">Depreciation Settings</h4>
              <div className="grid grid-cols-2 gap-4">
                <FormField control={form.control} name="depreciationMethod" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Depreciation Method</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value || ""}>
                      <FormControl><SelectTrigger data-testid="select-depreciation-method"><SelectValue placeholder="Select method" /></SelectTrigger></FormControl>
                      <SelectContent>
                        <SelectItem value="STRAIGHT_LINE">Straight-Line</SelectItem>
                        <SelectItem value="DECLINING_BALANCE">Declining Balance</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />

                <FormField control={form.control} name="usefulLifeYears" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Useful Life (years)</FormLabel>
                    <FormControl><Input type="number" min="1" max="100" {...field} data-testid="input-useful-life" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />

                <FormField control={form.control} name="salvageValue" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Salvage Value ($)</FormLabel>
                    <FormControl><Input type="number" step="0.01" min="0" {...field} data-testid="input-salvage-value" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />

                <FormField control={form.control} name="inServiceDate" render={({ field }) => (
                  <FormItem>
                    <FormLabel>In-Service Date</FormLabel>
                    <FormControl><Input type="date" {...field} data-testid="input-in-service-date" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button type="submit" disabled={isPending} data-testid="button-save">
                {isPending ? "Saving..." : "Save Changes"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

interface AssignEquipmentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  form: UseFormReturn<AssignmentInput>;
  availableProjects: any[];
  onSubmit: (data: AssignmentInput) => void;
  isPending: boolean;
}

export function AssignEquipmentDialog({ open, onOpenChange, form, availableProjects, onSubmit, isPending }: AssignEquipmentDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Assign Equipment to Project</DialogTitle>
          <DialogDescription>Select a project to assign this equipment to.</DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField control={form.control} name="projectId" render={({ field }) => (
              <FormItem>
                <FormLabel>Project *</FormLabel>
                <Select onValueChange={field.onChange} value={field.value}>
                  <FormControl>
                    <SelectTrigger data-testid="select-project"><SelectValue placeholder="Select project" /></SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {availableProjects.map((project: any) => (
                      <SelectItem key={project.id} value={project.id}>
                        {project.code} - {project.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )} />

            <FormField control={form.control} name="expectedReturnDate" render={({ field }) => (
              <FormItem className="flex flex-col">
                <FormLabel>Expected Return Date</FormLabel>
                <Popover>
                  <PopoverTrigger asChild>
                    <FormControl>
                      <Button
                        variant="outline"
                        className={cn("w-full pl-3 text-left font-normal", !field.value && "text-muted-foreground")}
                        data-testid="input-return-date"
                      >
                        {field.value ? format(parseISO(field.value), "PPP") : "Pick a date"}
                        <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                      </Button>
                    </FormControl>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <CalendarPicker
                      mode="single"
                      selected={field.value ? parseISO(field.value) : undefined}
                      onSelect={(date) => field.onChange(date ? format(date, "yyyy-MM-dd") : "")}
                      initialFocus
                    />
                  </PopoverContent>
                </Popover>
                <FormMessage />
              </FormItem>
            )} />

            <FormField control={form.control} name="notes" render={({ field }) => (
              <FormItem>
                <FormLabel>Notes</FormLabel>
                <FormControl><Textarea {...field} placeholder="Any special notes..." /></FormControl>
                <FormMessage />
              </FormItem>
            )} />

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button type="submit" disabled={isPending} data-testid="button-confirm-assign">
                {isPending ? "Assigning..." : "Assign Equipment"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

interface ReturnEquipmentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  form: UseFormReturn<ReturnEquipmentInput>;
  activeAssignment: any;
  onSubmit: (data: ReturnEquipmentInput) => void;
  isPending: boolean;
}

export function ReturnEquipmentDialog({ open, onOpenChange, form, activeAssignment, onSubmit, isPending }: ReturnEquipmentDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Return Equipment</DialogTitle>
          <DialogDescription>Mark this equipment as returned from {activeAssignment?.projectName}.</DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField control={form.control} name="endingHours" render={({ field }) => (
              <FormItem>
                <FormLabel>Ending Hours</FormLabel>
                <FormControl><Input type="number" step="0.1" {...field} data-testid="input-ending-hours" /></FormControl>
                <FormMessage />
              </FormItem>
            )} />

            <FormField control={form.control} name="returnCondition" render={({ field }) => (
              <FormItem>
                <FormLabel>Return Condition</FormLabel>
                <Select onValueChange={field.onChange} value={field.value}>
                  <FormControl><SelectTrigger><SelectValue placeholder="Select condition" /></SelectTrigger></FormControl>
                  <SelectContent>
                    <SelectItem value="GOOD">Good</SelectItem>
                    <SelectItem value="FAIR">Fair</SelectItem>
                    <SelectItem value="NEEDS_REPAIR">Needs Repair</SelectItem>
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )} />

            <FormField control={form.control} name="notes" render={({ field }) => (
              <FormItem>
                <FormLabel>Notes</FormLabel>
                <FormControl><Textarea {...field} placeholder="Any issues or observations..." /></FormControl>
                <FormMessage />
              </FormItem>
            )} />

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button type="submit" disabled={isPending} data-testid="button-confirm-return">
                {isPending ? "Processing..." : "Return Equipment"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

interface RepairDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  form: UseFormReturn<RepairInput>;
  onSubmit: (data: RepairInput) => void;
  isPending: boolean;
  aiRecommendations: AIRecommendation | null;
  loadingAI: boolean;
  onFetchAI: () => void;
}

export function RepairDialog({ open, onOpenChange, form, onSubmit, isPending, aiRecommendations, loadingAI, onFetchAI }: RepairDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Report Equipment Issue</DialogTitle>
          <DialogDescription>Describe the problem and get AI-powered repair recommendations.</DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <FormField control={form.control} name="problemDescription" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Problem Description *</FormLabel>
                    <FormControl>
                      <Textarea
                        {...field}
                        placeholder="Describe the issue in detail..."
                        className="min-h-[100px]"
                        data-testid="input-problem-description"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )} />

                <Button
                  type="button"
                  variant="outline"
                  onClick={onFetchAI}
                  disabled={loadingAI || !form.getValues("problemDescription")}
                  className="w-full"
                  data-testid="button-get-ai"
                >
                  {loadingAI ? (
                    <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Analyzing...</>
                  ) : (
                    <><Sparkles className="h-4 w-4 mr-2" />Get AI Recommendations</>
                  )}
                </Button>

                <FormField control={form.control} name="description" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Repair Title *</FormLabel>
                    <FormControl><Input {...field} placeholder="Brief repair title" data-testid="input-repair-title" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />

                <FormField control={form.control} name="repairLocation" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Repair Location</FormLabel>
                    <FormControl><Input {...field} placeholder="Where will repairs be done?" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />

                <div className="grid grid-cols-2 gap-4">
                  <FormField control={form.control} name="estimatedCost" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Estimated Cost</FormLabel>
                      <FormControl><Input type="number" step="0.01" {...field} placeholder="$0.00" /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />

                  <FormField control={form.control} name="estimatedCompletionDate" render={({ field }) => (
                    <FormItem className="flex flex-col">
                      <FormLabel>Expected Completion</FormLabel>
                      <Popover>
                        <PopoverTrigger asChild>
                          <FormControl>
                            <Button
                              variant="outline"
                              className={cn("w-full pl-3 text-left font-normal", !field.value && "text-muted-foreground")}
                            >
                              {field.value ? format(parseISO(field.value), "PPP") : "Pick a date"}
                              <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                            </Button>
                          </FormControl>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0" align="start">
                          <CalendarPicker
                            mode="single"
                            selected={field.value ? parseISO(field.value) : undefined}
                            onSelect={(date) => field.onChange(date ? format(date, "yyyy-MM-dd") : "")}
                            initialFocus
                          />
                        </PopoverContent>
                      </Popover>
                      <FormMessage />
                    </FormItem>
                  )} />
                </div>

                <DialogFooter>
                  <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
                  <Button type="submit" disabled={isPending} data-testid="button-submit-repair">
                    {isPending ? "Submitting..." : "Submit Repair Request"}
                  </Button>
                </DialogFooter>
              </form>
            </Form>
          </div>

          <div className="space-y-4">
            {aiRecommendations ? (
              <>
                <Card className="border-primary/50">
                  <CardHeader className="pb-2">
                    <div className="flex items-center gap-2">
                      <Sparkles className="h-4 w-4 text-primary" />
                      <CardTitle className="text-sm">AI Analysis</CardTitle>
                      <Badge variant={
                        aiRecommendations.urgency === "CRITICAL" ? "destructive" :
                        aiRecommendations.urgency === "HIGH" ? "default" : "secondary"
                      }>
                        {aiRecommendations.urgency} Priority
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="text-sm">
                    <p>{aiRecommendations.summary}</p>
                    {aiRecommendations.estimatedTotalCost > 0 && (
                      <p className="mt-2 font-medium">
                        Estimated Total Cost: ${aiRecommendations.estimatedTotalCost.toLocaleString()}
                      </p>
                    )}
                  </CardContent>
                </Card>

                {aiRecommendations.recommendedTasks.length > 0 && (
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm flex items-center gap-2">
                        <ClipboardList className="h-4 w-4" />
                        Recommended Tasks
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <ul className="text-sm space-y-2">
                        {aiRecommendations.recommendedTasks.map((task, i) => (
                          <li key={i} className="flex items-start gap-2">
                            <Badge variant="outline" className="text-xs shrink-0">{task.priority}</Badge>
                            <span>{task.task}</span>
                            {task.estimatedCost > 0 && (
                              <span className="text-muted-foreground ml-auto">${task.estimatedCost}</span>
                            )}
                          </li>
                        ))}
                      </ul>
                    </CardContent>
                  </Card>
                )}

                {aiRecommendations.recommendedParts.length > 0 && (
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm flex items-center gap-2">
                        <Package className="h-4 w-4" />
                        Recommended Parts
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <ul className="text-sm space-y-2">
                        {aiRecommendations.recommendedParts.map((part, i) => (
                          <li key={i} className="flex items-center justify-between gap-2">
                            <span>{part.part} (x{part.quantity})</span>
                            <span className="text-muted-foreground">${part.estimatedCost}</span>
                          </li>
                        ))}
                      </ul>
                    </CardContent>
                  </Card>
                )}

                {aiRecommendations.preventativeSchedule.length > 0 && (
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm flex items-center gap-2">
                        <Calendar className="h-4 w-4" />
                        Preventative Maintenance Schedule
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <ul className="text-sm space-y-2">
                        {aiRecommendations.preventativeSchedule.map((item, i) => (
                          <li key={i} className="border-l-2 border-muted pl-3">
                            <div className="font-medium">{item.task}</div>
                            <div className="text-xs text-muted-foreground">Every {item.interval}</div>
                            <div className="text-xs">{item.description}</div>
                          </li>
                        ))}
                      </ul>
                    </CardContent>
                  </Card>
                )}

                {aiRecommendations.warningsOrNotes.length > 0 && (
                  <Card className="border-yellow-500/50 bg-yellow-50 dark:bg-yellow-900/20">
                    <CardContent className="pt-4">
                      <div className="flex items-start gap-2">
                        <AlertTriangle className="h-4 w-4 text-yellow-600 shrink-0 mt-0.5" />
                        <ul className="text-sm space-y-1">
                          {aiRecommendations.warningsOrNotes.map((note, i) => (
                            <li key={i}>{note}</li>
                          ))}
                        </ul>
                      </div>
                    </CardContent>
                  </Card>
                )}
              </>
            ) : (
              <div className="flex flex-col items-center justify-center h-full text-center text-muted-foreground py-8">
                <Sparkles className="h-12 w-12 mb-4 opacity-20" />
                <p className="text-sm">Describe the problem and click "Get AI Recommendations" for intelligent repair suggestions, parts lists, and maintenance schedules.</p>
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

interface HourLogDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  form: UseFormReturn<HourLogInput>;
  availableProjects: any[];
  onSubmit: (data: HourLogInput) => void;
  isPending: boolean;
}

export function HourLogDialog({ open, onOpenChange, form, availableProjects, onSubmit, isPending }: HourLogDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Log Equipment Hours</DialogTitle>
          <DialogDescription>Record weekly equipment usage.</DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField control={form.control} name="projectId" render={({ field }) => (
              <FormItem>
                <FormLabel>Project *</FormLabel>
                <Select onValueChange={field.onChange} value={field.value}>
                  <FormControl>
                    <SelectTrigger data-testid="select-hour-log-project"><SelectValue placeholder="Select project" /></SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {availableProjects.map((project: any) => (
                      <SelectItem key={project.id} value={project.id}>
                        {project.code} - {project.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )} />

            <div className="grid grid-cols-2 gap-4">
              <FormField control={form.control} name="weekStartDate" render={({ field }) => (
                <FormItem className="flex flex-col">
                  <FormLabel>Week Start *</FormLabel>
                  <Popover>
                    <PopoverTrigger asChild>
                      <FormControl>
                        <Button
                          variant="outline"
                          className={cn("w-full pl-3 text-left font-normal", !field.value && "text-muted-foreground")}
                          data-testid="input-week-start"
                        >
                          {field.value ? format(parseISO(field.value), "PPP") : "Pick a date"}
                          <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                        </Button>
                      </FormControl>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <CalendarPicker
                        mode="single"
                        selected={field.value ? parseISO(field.value) : undefined}
                        onSelect={(date) => field.onChange(date ? format(date, "yyyy-MM-dd") : "")}
                        initialFocus
                      />
                    </PopoverContent>
                  </Popover>
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={form.control} name="weekEndDate" render={({ field }) => (
                <FormItem className="flex flex-col">
                  <FormLabel>Week End *</FormLabel>
                  <Popover>
                    <PopoverTrigger asChild>
                      <FormControl>
                        <Button
                          variant="outline"
                          className={cn("w-full pl-3 text-left font-normal", !field.value && "text-muted-foreground")}
                          data-testid="input-week-end"
                        >
                          {field.value ? format(parseISO(field.value), "PPP") : "Pick a date"}
                          <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                        </Button>
                      </FormControl>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <CalendarPicker
                        mode="single"
                        selected={field.value ? parseISO(field.value) : undefined}
                        onSelect={(date) => field.onChange(date ? format(date, "yyyy-MM-dd") : "")}
                        initialFocus
                      />
                    </PopoverContent>
                  </Popover>
                  <FormMessage />
                </FormItem>
              )} />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <FormField control={form.control} name="startingHours" render={({ field }) => (
                <FormItem>
                  <FormLabel>Starting Hours *</FormLabel>
                  <FormControl><Input type="number" step="0.1" {...field} data-testid="input-starting-hours" /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={form.control} name="endingHours" render={({ field }) => (
                <FormItem>
                  <FormLabel>Ending Hours *</FormLabel>
                  <FormControl><Input type="number" step="0.1" {...field} data-testid="input-log-ending-hours" /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
            </div>

            <FormField control={form.control} name="fuelUsed" render={({ field }) => (
              <FormItem>
                <FormLabel>Fuel Used (gallons)</FormLabel>
                <FormControl><Input type="number" step="0.1" {...field} placeholder="Optional" /></FormControl>
                <FormMessage />
              </FormItem>
            )} />

            <FormField control={form.control} name="notes" render={({ field }) => (
              <FormItem>
                <FormLabel>Notes</FormLabel>
                <FormControl><Textarea {...field} placeholder="Any notes about usage this week..." /></FormControl>
                <FormMessage />
              </FormItem>
            )} />

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button type="submit" disabled={isPending} data-testid="button-submit-hours">
                {isPending ? "Submitting..." : "Submit Hour Log"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

interface CompleteMaintenanceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedSchedule: MaintenanceSchedule | null;
  onSubmit: (data: { notes?: string; laborCost?: string; partsCost?: string; performedByVendor?: string }) => void;
  isPending: boolean;
}

export function CompleteMaintenanceDialog({ open, onOpenChange, selectedSchedule, onSubmit, isPending }: CompleteMaintenanceDialogProps) {
  const [formData, setFormData] = useState({
    notes: "",
    laborCost: "",
    partsCost: "",
    performedByVendor: "",
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit(formData);
  };

  return (
    <Dialog open={open} onOpenChange={(val) => {
      onOpenChange(val);
      if (!val) setFormData({ notes: "", laborCost: "", partsCost: "", performedByVendor: "" });
    }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Complete Maintenance</DialogTitle>
          <DialogDescription>
            {selectedSchedule && (
              <>Record completion of: <strong>{selectedSchedule.name}</strong></>
            )}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Labor Cost</label>
              <Input
                type="number"
                step="0.01"
                placeholder="$0.00"
                value={formData.laborCost}
                onChange={(e) => setFormData({ ...formData, laborCost: e.target.value })}
                data-testid="input-labor-cost"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Parts Cost</label>
              <Input
                type="number"
                step="0.01"
                placeholder="$0.00"
                value={formData.partsCost}
                onChange={(e) => setFormData({ ...formData, partsCost: e.target.value })}
                data-testid="input-parts-cost"
              />
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Performed By (External Vendor)</label>
            <Input
              placeholder="Leave blank if performed in-house"
              value={formData.performedByVendor}
              onChange={(e) => setFormData({ ...formData, performedByVendor: e.target.value })}
              data-testid="input-vendor"
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Notes</label>
            <Textarea
              placeholder="Any notes about this maintenance..."
              value={formData.notes}
              onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
              data-testid="input-maintenance-notes"
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} data-testid="button-cancel-complete">Cancel</Button>
            <Button type="submit" disabled={isPending} data-testid="button-confirm-complete">
              {isPending ? "Completing..." : "Complete Maintenance"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

interface RateProfileDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  form: UseFormReturn<RateProfileInput>;
  editingRate: RateProfile | null;
  onSubmit: (data: RateProfileInput) => void;
  isPending: boolean;
}

export function RateProfileDialog({ open, onOpenChange, form, editingRate, onSubmit, isPending }: RateProfileDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editingRate ? "Edit Rate Profile" : "Add Rate Profile"}</DialogTitle>
          <DialogDescription>Configure internal hourly, daily, and weekly rates for this equipment</DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <FormField control={form.control} name="hourlyRate" render={({ field }) => (
                <FormItem>
                  <FormLabel>Hourly Rate *</FormLabel>
                  <FormControl><Input type="number" step="0.01" placeholder="$0.00/hr" {...field} data-testid="input-hourly-rate" /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={form.control} name="dailyRate" render={({ field }) => (
                <FormItem>
                  <FormLabel>Daily Rate</FormLabel>
                  <FormControl><Input type="number" step="0.01" placeholder="$0.00/day" {...field} data-testid="input-daily-rate" /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={form.control} name="weeklyRate" render={({ field }) => (
                <FormItem>
                  <FormLabel>Weekly Rate</FormLabel>
                  <FormControl><Input type="number" step="0.01" placeholder="$0.00/wk" {...field} data-testid="input-weekly-rate" /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={form.control} name="monthlyRate" render={({ field }) => (
                <FormItem>
                  <FormLabel>Monthly Rate</FormLabel>
                  <FormControl><Input type="number" step="0.01" placeholder="$0.00/mo" {...field} data-testid="input-monthly-rate" /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
            </div>

            <div className="border-t pt-4">
              <h4 className="text-sm font-medium mb-3">Operating Costs</h4>
              <div className="grid grid-cols-2 gap-4">
                <FormField control={form.control} name="fuelCostPerHour" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Fuel Cost/hr</FormLabel>
                    <FormControl><Input type="number" step="0.01" placeholder="$0.00" {...field} data-testid="input-fuel-cost" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />

                <FormField control={form.control} name="maintenanceCostPerHour" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Maintenance Cost/hr</FormLabel>
                    <FormControl><Input type="number" step="0.01" placeholder="$0.00" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />

                <FormField control={form.control} name="operatorCostPerHour" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Operator Cost/hr</FormLabel>
                    <FormControl><Input type="number" step="0.01" placeholder="$0.00" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />

                <FormField control={form.control} name="effectiveDate" render={({ field }) => (
                  <FormItem className="flex flex-col">
                    <FormLabel>Effective Date *</FormLabel>
                    <Popover>
                      <PopoverTrigger asChild>
                        <FormControl>
                          <Button
                            variant="outline"
                            className={cn("w-full pl-3 text-left font-normal", !field.value && "text-muted-foreground")}
                            data-testid="input-effective-date"
                          >
                            {field.value ? format(parseISO(field.value), "PPP") : "Pick a date"}
                            <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                          </Button>
                        </FormControl>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0" align="start">
                        <CalendarPicker
                          mode="single"
                          selected={field.value ? parseISO(field.value) : undefined}
                          onSelect={(date) => field.onChange(date ? format(date, "yyyy-MM-dd") : "")}
                          initialFocus
                        />
                      </PopoverContent>
                    </Popover>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>
            </div>

            <FormField control={form.control} name="notes" render={({ field }) => (
              <FormItem>
                <FormLabel>Notes</FormLabel>
                <FormControl><Textarea {...field} placeholder="Optional notes about this rate..." /></FormControl>
                <FormMessage />
              </FormItem>
            )} />

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button type="submit" disabled={isPending} data-testid="button-save-rate">
                {isPending ? "Saving..." : editingRate ? "Update Rate" : "Create Rate"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

interface ProjectOption {
  id: string;
  code: string;
  name: string;
}

interface FuelLogDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  form: UseFormReturn<FuelLogInput>;
  availableProjects: ProjectOption[];
  onSubmit: (data: FuelLogInput) => void;
  isPending: boolean;
}

export function FuelLogDialog({ open, onOpenChange, form, availableProjects, onSubmit, isPending }: FuelLogDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Log Fuel Fill-Up</DialogTitle>
          <DialogDescription>Record fuel usage for this equipment.</DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField control={form.control} name="date" render={({ field }) => (
              <FormItem>
                <FormLabel>Date *</FormLabel>
                <FormControl><Input type="date" {...field} data-testid="input-fuel-date" /></FormControl>
                <FormMessage />
              </FormItem>
            )} />

            <div className="grid grid-cols-2 gap-4">
              <FormField control={form.control} name="gallons" render={({ field }) => (
                <FormItem>
                  <FormLabel>Gallons *</FormLabel>
                  <FormControl><Input type="number" step="0.01" min="0" {...field} data-testid="input-fuel-gallons" /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={form.control} name="pricePerGallon" render={({ field }) => (
                <FormItem>
                  <FormLabel>Price/Gallon *</FormLabel>
                  <FormControl><Input type="number" step="0.01" min="0" {...field} data-testid="input-fuel-price" /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
            </div>

            <FormField control={form.control} name="fuelType" render={({ field }) => (
              <FormItem>
                <FormLabel>Fuel Type</FormLabel>
                <Select onValueChange={field.onChange} value={field.value || "DIESEL"}>
                  <FormControl><SelectTrigger data-testid="select-fuel-type"><SelectValue /></SelectTrigger></FormControl>
                  <SelectContent>
                    <SelectItem value="DIESEL">Diesel</SelectItem>
                    <SelectItem value="GASOLINE">Gasoline</SelectItem>
                    <SelectItem value="PROPANE">Propane</SelectItem>
                    <SelectItem value="ELECTRIC">Electric</SelectItem>
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )} />

            <FormField control={form.control} name="meterReading" render={({ field }) => (
              <FormItem>
                <FormLabel>Meter/Odometer Reading</FormLabel>
                <FormControl><Input type="number" step="0.1" min="0" {...field} data-testid="input-fuel-meter" /></FormControl>
                <FormMessage />
              </FormItem>
            )} />

            <FormField control={form.control} name="projectId" render={({ field }) => (
              <FormItem>
                <FormLabel>Project (optional)</FormLabel>
                <Select onValueChange={(val) => field.onChange(val === "none" ? "" : val)} value={field.value || "none"}>
                  <FormControl><SelectTrigger data-testid="select-fuel-project"><SelectValue placeholder="No project" /></SelectTrigger></FormControl>
                  <SelectContent>
                    <SelectItem value="none">No project</SelectItem>
                    {availableProjects.map((project) => (
                      <SelectItem key={project.id} value={project.id}>
                        {project.code} - {project.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )} />

            <FormField control={form.control} name="notes" render={({ field }) => (
              <FormItem>
                <FormLabel>Notes</FormLabel>
                <FormControl><Textarea {...field} placeholder="Optional notes..." data-testid="input-fuel-notes" /></FormControl>
                <FormMessage />
              </FormItem>
            )} />

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button type="submit" disabled={isPending} data-testid="button-save-fuel">
                {isPending ? "Saving..." : "Log Fuel"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
