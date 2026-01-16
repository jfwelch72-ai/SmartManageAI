import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { 
  FileText, 
  Building2, 
  DollarSign, 
  FileCheck, 
  Package, 
  HardHat, 
  AlertTriangle, 
  Users,
  ChevronDown,
  ChevronRight,
  Save,
  Loader2,
  Calendar as CalendarIcon
} from "lucide-react";
import { Calendar as CalendarPicker } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { format, parseISO } from "date-fns";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { HandoffPacket } from "@shared/schema";

interface JobInformationFormProps {
  bidCode?: string;
  projectCode?: string;
  readOnly?: boolean;
}

export default function JobInformationForm({ bidCode, projectCode, readOnly = false }: JobInformationFormProps) {
  const { toast } = useToast();
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(["overview"]));
  
  const apiPath = bidCode 
    ? `/api/bids/${bidCode}/handoff-packet` 
    : `/api/projects/${projectCode}/handoff-packet`;

  const queryKey = bidCode 
    ? ["/api/bids", bidCode, "handoff-packet"] 
    : ["/api/projects", projectCode, "handoff-packet"];

  const { data: packet, isLoading } = useQuery<HandoffPacket | null>({
    queryKey,
    enabled: !!(bidCode || projectCode),
  });

  const [formData, setFormData] = useState<Partial<HandoffPacket>>({});

  useEffect(() => {
    if (packet) {
      setFormData(packet);
    }
  }, [packet]);

  const saveMutation = useMutation({
    mutationFn: async (data: Partial<HandoffPacket>) => {
      return apiRequest("PUT", apiPath, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      toast({ title: "Success", description: "Job information saved successfully" });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to save job information", variant: "destructive" });
    },
  });

  const handleChange = (field: keyof HandoffPacket, value: any) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const handleSave = () => {
    saveMutation.mutate(formData);
  };

  const toggleSection = (section: string) => {
    const newExpanded = new Set(expandedSections);
    if (newExpanded.has(section)) {
      newExpanded.delete(section);
    } else {
      newExpanded.add(section);
    }
    setExpandedSections(newExpanded);
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-8">
          <div className="flex items-center justify-center text-muted-foreground">
            <Loader2 className="w-5 h-5 animate-spin mr-2" />
            Loading job information...
          </div>
        </CardContent>
      </Card>
    );
  }

  const SectionHeader = ({ 
    id, 
    icon: Icon, 
    title, 
    description 
  }: { 
    id: string; 
    icon: any; 
    title: string; 
    description: string 
  }) => (
    <CollapsibleTrigger 
      className="flex items-center justify-between w-full p-4 hover:bg-muted/50 rounded-md transition-colors"
      onClick={() => toggleSection(id)}
    >
      <div className="flex items-center gap-3">
        <Icon className="w-5 h-5 text-muted-foreground" />
        <div className="text-left">
          <h3 className="font-medium">{title}</h3>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
      </div>
      {expandedSections.has(id) ? (
        <ChevronDown className="w-5 h-5 text-muted-foreground" />
      ) : (
        <ChevronRight className="w-5 h-5 text-muted-foreground" />
      )}
    </CollapsibleTrigger>
  );

  return (
    <Card data-testid="card-job-information">
      <CardHeader className="flex flex-row items-center justify-between gap-4">
        <div>
          <CardTitle className="flex items-center gap-2">
            <FileText className="w-5 h-5" />
            Job Information
          </CardTitle>
          <CardDescription>
            Estimator handoff packet for QuickBooks setup
          </CardDescription>
        </div>
        {!readOnly && (
          <Button 
            onClick={handleSave} 
            disabled={saveMutation.isPending}
            size="sm"
            data-testid="button-save-job-info"
          >
            {saveMutation.isPending ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Saving...
              </>
            ) : (
              <>
                <Save className="w-4 h-4 mr-2" />
                Save Changes
              </>
            )}
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Section 1: Job Overview */}
        <Collapsible open={expandedSections.has("overview")}>
          <SectionHeader 
            id="overview" 
            icon={Building2} 
            title="1. Job Overview" 
            description="GC info, access details, and scope summary" 
          />
          <CollapsibleContent className="p-4 space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="gcName">GC Name & Contact</Label>
                <Input
                  id="gcName"
                  value={formData.gcName || ""}
                  onChange={(e) => handleChange("gcName", e.target.value)}
                  placeholder="General Contractor Company"
                  disabled={readOnly}
                  data-testid="input-gc-name"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="gcContactName">GC Contact Person</Label>
                <Input
                  id="gcContactName"
                  value={formData.gcContactName || ""}
                  onChange={(e) => handleChange("gcContactName", e.target.value)}
                  placeholder="John Smith"
                  disabled={readOnly}
                  data-testid="input-gc-contact-name"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="gcPhone">GC Phone</Label>
                <Input
                  id="gcPhone"
                  value={formData.gcPhone || ""}
                  onChange={(e) => handleChange("gcPhone", e.target.value)}
                  placeholder="(555) 123-4567"
                  disabled={readOnly}
                  data-testid="input-gc-phone"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="gcEmail">GC Email</Label>
                <Input
                  id="gcEmail"
                  type="email"
                  value={formData.gcEmail || ""}
                  onChange={(e) => handleChange("gcEmail", e.target.value)}
                  placeholder="john@gc.com"
                  disabled={readOnly}
                  data-testid="input-gc-email"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="accessDetails">Access Details</Label>
              <Textarea
                id="accessDetails"
                value={formData.accessDetails || ""}
                onChange={(e) => handleChange("accessDetails", e.target.value)}
                placeholder="Gate codes, restricted hours, security requirements..."
                disabled={readOnly}
                data-testid="input-access-details"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="scopeOfWorkSummary">Scope of Work Summary</Label>
              <Textarea
                id="scopeOfWorkSummary"
                value={formData.scopeOfWorkSummary || ""}
                onChange={(e) => handleChange("scopeOfWorkSummary", e.target.value)}
                placeholder="Summary of your company's scope on this project..."
                disabled={readOnly}
                rows={4}
                data-testid="input-scope-summary"
              />
            </div>
          </CollapsibleContent>
        </Collapsible>

        <Separator />

        {/* Section 2: Estimate Snapshot */}
        <Collapsible open={expandedSections.has("estimate")}>
          <SectionHeader 
            id="estimate" 
            icon={DollarSign} 
            title="2. Estimate Snapshot" 
            description="Contract value, dates, duration, and manpower" 
          />
          <CollapsibleContent className="p-4 space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label htmlFor="contractValue">Contract Value</Label>
                <Input
                  id="contractValue"
                  type="number"
                  value={formData.contractValue || ""}
                  onChange={(e) => handleChange("contractValue", e.target.value)}
                  placeholder="0.00"
                  disabled={readOnly}
                  data-testid="input-contract-value"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="markupPercent">Markup (%)</Label>
                <Input
                  id="markupPercent"
                  type="number"
                  step="0.01"
                  value={formData.markupPercent || ""}
                  onChange={(e) => handleChange("markupPercent", e.target.value)}
                  placeholder="25"
                  disabled={readOnly}
                  data-testid="input-markup-percent"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="duration">Duration</Label>
                <Input
                  id="duration"
                  value={formData.duration || ""}
                  onChange={(e) => handleChange("duration", e.target.value)}
                  placeholder="e.g., 6 months"
                  disabled={readOnly}
                  data-testid="input-duration"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="bidDate">Bid Date</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      className={cn(
                        "w-full justify-start text-left font-normal",
                        !formData.bidDate && "text-muted-foreground"
                      )}
                      disabled={readOnly}
                      data-testid="input-bid-date"
                    >
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {formData.bidDate ? format(parseISO(formData.bidDate), "PPP") : "Pick a date"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <CalendarPicker
                      mode="single"
                      selected={formData.bidDate ? parseISO(formData.bidDate) : undefined}
                      onSelect={(date) => handleChange("bidDate", date ? format(date, "yyyy-MM-dd") : "")}
                      initialFocus
                    />
                  </PopoverContent>
                </Popover>
              </div>
              <div className="space-y-2">
                <Label htmlFor="awardDate">Award Date</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      className={cn(
                        "w-full justify-start text-left font-normal",
                        !formData.awardDate && "text-muted-foreground"
                      )}
                      disabled={readOnly}
                      data-testid="input-award-date"
                    >
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {formData.awardDate ? format(parseISO(formData.awardDate), "PPP") : "Pick a date"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <CalendarPicker
                      mode="single"
                      selected={formData.awardDate ? parseISO(formData.awardDate) : undefined}
                      onSelect={(date) => handleChange("awardDate", date ? format(date, "yyyy-MM-dd") : "")}
                      initialFocus
                    />
                  </PopoverContent>
                </Popover>
              </div>
              <div className="space-y-2">
                <Label htmlFor="manpower">Manpower</Label>
                <Input
                  id="manpower"
                  value={formData.manpower || ""}
                  onChange={(e) => handleChange("manpower", e.target.value)}
                  placeholder="e.g., 4-6 crew"
                  disabled={readOnly}
                  data-testid="input-manpower"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="projectStartDate">Start Date</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      className={cn(
                        "w-full justify-start text-left font-normal",
                        !formData.projectStartDate && "text-muted-foreground"
                      )}
                      disabled={readOnly}
                      data-testid="input-start-date"
                    >
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {formData.projectStartDate ? format(parseISO(formData.projectStartDate), "PPP") : "Pick a date"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <CalendarPicker
                      mode="single"
                      selected={formData.projectStartDate ? parseISO(formData.projectStartDate) : undefined}
                      onSelect={(date) => handleChange("projectStartDate", date ? format(date, "yyyy-MM-dd") : "")}
                      initialFocus
                    />
                  </PopoverContent>
                </Popover>
              </div>
              <div className="space-y-2">
                <Label htmlFor="projectCompletionDate">Completion Date</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      className={cn(
                        "w-full justify-start text-left font-normal",
                        !formData.projectCompletionDate && "text-muted-foreground"
                      )}
                      disabled={readOnly}
                      data-testid="input-completion-date"
                    >
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {formData.projectCompletionDate ? format(parseISO(formData.projectCompletionDate), "PPP") : "Pick a date"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <CalendarPicker
                      mode="single"
                      selected={formData.projectCompletionDate ? parseISO(formData.projectCompletionDate) : undefined}
                      onSelect={(date) => handleChange("projectCompletionDate", date ? format(date, "yyyy-MM-dd") : "")}
                      initialFocus
                    />
                  </PopoverContent>
                </Popover>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="alternates">Alternates</Label>
              <Textarea
                id="alternates"
                value={formData.alternates || ""}
                onChange={(e) => handleChange("alternates", e.target.value)}
                placeholder="List any alternate scopes or pricing..."
                disabled={readOnly}
                data-testid="input-alternates"
              />
            </div>
          </CollapsibleContent>
        </Collapsible>

        <Separator />

        {/* Section 3: Contract & Documentation */}
        <Collapsible open={expandedSections.has("contract")}>
          <SectionHeader 
            id="contract" 
            icon={FileCheck} 
            title="3. Contract & Documentation" 
            description="Subcontract, insurance, bonds, permits, and payment terms" 
          />
          <CollapsibleContent className="p-4 space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="subcontractExecuted"
                  checked={formData.subcontractExecuted || false}
                  onCheckedChange={(checked) => handleChange("subcontractExecuted", checked)}
                  disabled={readOnly}
                  data-testid="checkbox-subcontract-executed"
                />
                <Label htmlFor="subcontractExecuted">Subcontract Executed?</Label>
              </div>
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="bondRequired"
                  checked={formData.bondRequired || false}
                  onCheckedChange={(checked) => handleChange("bondRequired", checked)}
                  disabled={readOnly}
                  data-testid="checkbox-bond-required"
                />
                <Label htmlFor="bondRequired">Bond Required?</Label>
              </div>
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="prevailingWage"
                  checked={formData.prevailingWage || false}
                  onCheckedChange={(checked) => handleChange("prevailingWage", checked)}
                  disabled={readOnly}
                  data-testid="checkbox-prevailing-wage"
                />
                <Label htmlFor="prevailingWage">Prevailing Wage?</Label>
              </div>
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="scheduleOfValuesReady"
                  checked={formData.scheduleOfValuesReady || false}
                  onCheckedChange={(checked) => handleChange("scheduleOfValuesReady", checked)}
                  disabled={readOnly}
                  data-testid="checkbox-sov-ready"
                />
                <Label htmlFor="scheduleOfValuesReady">Schedule of Values Ready?</Label>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="insuranceCerts">Insurance Certs</Label>
                <Input
                  id="insuranceCerts"
                  value={formData.insuranceCerts || ""}
                  onChange={(e) => handleChange("insuranceCerts", e.target.value)}
                  placeholder="Status of insurance certificates"
                  disabled={readOnly}
                  data-testid="input-insurance-certs"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="permits">Permits</Label>
                <Input
                  id="permits"
                  value={formData.permits || ""}
                  onChange={(e) => handleChange("permits", e.target.value)}
                  placeholder="Required permits and status"
                  disabled={readOnly}
                  data-testid="input-permits"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="retentionPercent">Retention %</Label>
                <Input
                  id="retentionPercent"
                  type="number"
                  step="0.01"
                  value={formData.retentionPercent || ""}
                  onChange={(e) => handleChange("retentionPercent", e.target.value)}
                  placeholder="10"
                  disabled={readOnly}
                  data-testid="input-retention-percent"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="paymentTerms">Payment Terms</Label>
                <Input
                  id="paymentTerms"
                  value={formData.paymentTerms || ""}
                  onChange={(e) => handleChange("paymentTerms", e.target.value)}
                  placeholder="e.g., Net 30"
                  disabled={readOnly}
                  data-testid="input-payment-terms"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="drawSchedule">Draw Schedule</Label>
              <Textarea
                id="drawSchedule"
                value={formData.drawSchedule || ""}
                onChange={(e) => handleChange("drawSchedule", e.target.value)}
                placeholder="Billing schedule and draw dates..."
                disabled={readOnly}
                data-testid="input-draw-schedule"
              />
            </div>
          </CollapsibleContent>
        </Collapsible>

        <Separator />

        {/* Section 4: Materials & Supply Chain */}
        <Collapsible open={expandedSections.has("materials")}>
          <SectionHeader 
            id="materials" 
            icon={Package} 
            title="4. Materials & Supply Chain" 
            description="Suppliers, materials, lead times, and submittals" 
          />
          <CollapsibleContent className="p-4 space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="concreteSupplier">Concrete Supplier</Label>
                <Input
                  id="concreteSupplier"
                  value={formData.concreteSupplier || ""}
                  onChange={(e) => handleChange("concreteSupplier", e.target.value)}
                  placeholder="Supplier name"
                  disabled={readOnly}
                  data-testid="input-concrete-supplier"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="mixInfo">Mix Info</Label>
                <Input
                  id="mixInfo"
                  value={formData.mixInfo || ""}
                  onChange={(e) => handleChange("mixInfo", e.target.value)}
                  placeholder="Concrete mix specifications"
                  disabled={readOnly}
                  data-testid="input-mix-info"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="rebarVendor">Rebar Vendor</Label>
                <Input
                  id="rebarVendor"
                  value={formData.rebarVendor || ""}
                  onChange={(e) => handleChange("rebarVendor", e.target.value)}
                  placeholder="Vendor name"
                  disabled={readOnly}
                  data-testid="input-rebar-vendor"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="submittalStatus">Submittal Status</Label>
                <Input
                  id="submittalStatus"
                  value={formData.submittalStatus || ""}
                  onChange={(e) => handleChange("submittalStatus", e.target.value)}
                  placeholder="Status of submittals"
                  disabled={readOnly}
                  data-testid="input-submittal-status"
                />
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="formingMaterialPlan">Forming Material Plan</Label>
                <Textarea
                  id="formingMaterialPlan"
                  value={formData.formingMaterialPlan || ""}
                  onChange={(e) => handleChange("formingMaterialPlan", e.target.value)}
                  placeholder="Forming approach and materials"
                  disabled={readOnly}
                  data-testid="input-forming-plan"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="curingSpecs">Curing Specs</Label>
                <Textarea
                  id="curingSpecs"
                  value={formData.curingSpecs || ""}
                  onChange={(e) => handleChange("curingSpecs", e.target.value)}
                  placeholder="Curing requirements"
                  disabled={readOnly}
                  data-testid="input-curing-specs"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="specialItems">Special Items</Label>
              <Textarea
                id="specialItems"
                value={formData.specialItems || ""}
                onChange={(e) => handleChange("specialItems", e.target.value)}
                placeholder="Any special materials or equipment needed"
                disabled={readOnly}
                data-testid="input-special-items"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="leadTimeRisks">Lead Time Risks</Label>
              <Textarea
                id="leadTimeRisks"
                value={formData.leadTimeRisks || ""}
                onChange={(e) => handleChange("leadTimeRisks", e.target.value)}
                placeholder="Materials with long lead times or availability concerns"
                disabled={readOnly}
                data-testid="input-lead-time-risks"
              />
            </div>
          </CollapsibleContent>
        </Collapsible>

        <Separator />

        {/* Section 5: Field Work Details */}
        <Collapsible open={expandedSections.has("field")}>
          <SectionHeader 
            id="field" 
            icon={HardHat} 
            title="5. Field Work Details" 
            description="Layout, benchmarks, work hours, safety, and inspections" 
          />
          <CollapsibleContent className="p-4 space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="layoutSurveyBy">Layout & Survey By</Label>
                <Input
                  id="layoutSurveyBy"
                  value={formData.layoutSurveyBy || ""}
                  onChange={(e) => handleChange("layoutSurveyBy", e.target.value)}
                  placeholder="Who provides layout?"
                  disabled={readOnly}
                  data-testid="input-layout-survey"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="benchmarkInfo">Benchmark Info</Label>
                <Input
                  id="benchmarkInfo"
                  value={formData.benchmarkInfo || ""}
                  onChange={(e) => handleChange("benchmarkInfo", e.target.value)}
                  placeholder="Benchmark location and elevation"
                  disabled={readOnly}
                  data-testid="input-benchmark"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="accessZones">Access Zones</Label>
                <Input
                  id="accessZones"
                  value={formData.accessZones || ""}
                  onChange={(e) => handleChange("accessZones", e.target.value)}
                  placeholder="Staging areas and access points"
                  disabled={readOnly}
                  data-testid="input-access-zones"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="workHours">Work Hours</Label>
                <Input
                  id="workHours"
                  value={formData.workHours || ""}
                  onChange={(e) => handleChange("workHours", e.target.value)}
                  placeholder="e.g., 7am-3:30pm M-F"
                  disabled={readOnly}
                  data-testid="input-work-hours"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="safetyOrientation">Safety Orientation</Label>
              <Textarea
                id="safetyOrientation"
                value={formData.safetyOrientation || ""}
                onChange={(e) => handleChange("safetyOrientation", e.target.value)}
                placeholder="Safety requirements and orientation details"
                disabled={readOnly}
                data-testid="input-safety-orientation"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="inspectionNeeds">Inspection Needs</Label>
              <Textarea
                id="inspectionNeeds"
                value={formData.inspectionNeeds || ""}
                onChange={(e) => handleChange("inspectionNeeds", e.target.value)}
                placeholder="Required inspections and timing"
                disabled={readOnly}
                data-testid="input-inspection-needs"
              />
            </div>
          </CollapsibleContent>
        </Collapsible>

        <Separator />

        {/* Section 6: Project Notes & Risks */}
        <Collapsible open={expandedSections.has("risks")}>
          <SectionHeader 
            id="risks" 
            icon={AlertTriangle} 
            title="6. Project Notes & Risk Items" 
            description="Coordination issues, weather risks, soil conditions, and notes" 
          />
          <CollapsibleContent className="p-4 space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="coordinationIssues">Coordination Issues</Label>
                <Textarea
                  id="coordinationIssues"
                  value={formData.coordinationIssues || ""}
                  onChange={(e) => handleChange("coordinationIssues", e.target.value)}
                  placeholder="Known coordination challenges"
                  disabled={readOnly}
                  data-testid="input-coordination-issues"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="weatherRisks">Weather Risks</Label>
                <Textarea
                  id="weatherRisks"
                  value={formData.weatherRisks || ""}
                  onChange={(e) => handleChange("weatherRisks", e.target.value)}
                  placeholder="Seasonal or weather concerns"
                  disabled={readOnly}
                  data-testid="input-weather-risks"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="soilConditions">Soil Conditions</Label>
              <Textarea
                id="soilConditions"
                value={formData.soilConditions || ""}
                onChange={(e) => handleChange("soilConditions", e.target.value)}
                placeholder="Known soil conditions or concerns"
                disabled={readOnly}
                data-testid="input-soil-conditions"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="estimatorNotes">Estimator Notes</Label>
              <Textarea
                id="estimatorNotes"
                value={formData.estimatorNotes || ""}
                onChange={(e) => handleChange("estimatorNotes", e.target.value)}
                placeholder="Additional notes from the estimator"
                disabled={readOnly}
                rows={4}
                data-testid="input-estimator-notes"
              />
            </div>
          </CollapsibleContent>
        </Collapsible>

        <Separator />

        {/* Section 7: Communication Protocol */}
        <Collapsible open={expandedSections.has("communication")}>
          <SectionHeader 
            id="communication" 
            icon={Users} 
            title="7. Communication Protocol" 
            description="Project contacts and communication methods" 
          />
          <CollapsibleContent className="p-4 space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="gcContactMethod">GC Contact Method</Label>
                <Input
                  id="gcContactMethod"
                  value={formData.gcContactMethod || ""}
                  onChange={(e) => handleChange("gcContactMethod", e.target.value)}
                  placeholder="Preferred contact method"
                  disabled={readOnly}
                  data-testid="input-gc-contact-method"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="projectManager">Project Manager</Label>
                <Input
                  id="projectManager"
                  value={formData.projectManager || ""}
                  onChange={(e) => handleChange("projectManager", e.target.value)}
                  placeholder="Company Project Manager"
                  disabled={readOnly}
                  data-testid="input-project-manager"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="superintendent">Superintendent</Label>
                <Input
                  id="superintendent"
                  value={formData.superintendent || ""}
                  onChange={(e) => handleChange("superintendent", e.target.value)}
                  placeholder="Company Superintendent"
                  disabled={readOnly}
                  data-testid="input-superintendent"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="officeAdmin">Office Admin</Label>
                <Input
                  id="officeAdmin"
                  value={formData.officeAdmin || ""}
                  onChange={(e) => handleChange("officeAdmin", e.target.value)}
                  placeholder="Office Admin contact"
                  disabled={readOnly}
                  data-testid="input-office-admin"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="safetyContact">Safety Contact</Label>
                <Input
                  id="safetyContact"
                  value={formData.safetyContact || ""}
                  onChange={(e) => handleChange("safetyContact", e.target.value)}
                  placeholder="Safety officer contact"
                  disabled={readOnly}
                  data-testid="input-safety-contact"
                />
              </div>
            </div>
          </CollapsibleContent>
        </Collapsible>
      </CardContent>
    </Card>
  );
}
