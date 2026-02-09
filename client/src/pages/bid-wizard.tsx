import { useState, useCallback } from "react";
import { useLocation } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import { canEditBids } from "@/lib/rbac";
import { useToast } from "@/hooks/use-toast";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ObjectUploader } from "@/components/ObjectUploader";
import CrmOrganizationSelector from "@/components/CrmOrganizationSelector";

import {
  Upload,
  FileText,
  Sparkles,
  CheckCircle2,
  ArrowRight,
  ArrowLeft,
  Loader2,
  AlertTriangle,
  Plus,
  Trash2,
  Edit2,
  Building2,
  Calendar as CalendarIcon,
  MapPin,
  ClipboardList,
  Eye,
  X,
} from "lucide-react";
import { Calendar as CalendarPicker } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { format, parseISO } from "date-fns";
import { cn } from "@/lib/utils";

import type { CrmOrganisation, CrmContact } from "@shared/schema";

interface UploadedDocument {
  id: string;
  name: string;
  url: string;
  type: string;
  size: number;
}

interface AIExtractedItem {
  id: string;
  description: string;
  quantity: number;
  unit: string;
  category: string;
  notes?: string;
  selected: boolean;
}

interface AIAnalysisResult {
  projectName?: string;
  clientName?: string;
  clientContactName?: string;
  clientContactEmail?: string;
  clientContactPhone?: string;
  dueDate?: string;
  locationAddress?: string;
  city?: string;
  state?: string;
  description?: string;
  estimatedValue?: number;
  scopeItems: AIExtractedItem[];
  keyRequirements?: string[];
  specialConditions?: string[];
  insuranceRequirements?: string;
  bondingRequirements?: string;
}

const WIZARD_STEPS = [
  { id: 1, name: "Upload Documents", icon: Upload, description: "Upload bid invitation, plans, and specs" },
  { id: 2, name: "AI Review", icon: Sparkles, description: "AI analyzes your documents" },
  { id: 3, name: "Confirm Scope", icon: ClipboardList, description: "Review and modify SOW items" },
  { id: 4, name: "Bid Details", icon: Building2, description: "Enter bid information" },
];

const bidDetailsSchema = z.object({
  name: z.string().min(1, "Bid name is required"),
  clientName: z.string().min(1, "Client name is required"),
  clientContactName: z.string().optional(),
  clientContactEmail: z.string().email().optional().or(z.literal("")),
  clientContactPhone: z.string().optional(),
  dueDate: z.string().optional(),
  locationAddress: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  description: z.string().optional(),
  gcOrganizationId: z.string().optional(),
  ownerRepOrganizationId: z.string().optional(),
});

type BidDetailsForm = z.infer<typeof bidDetailsSchema>;

export default function BidWizardPage() {
  const [, setLocation] = useLocation();
  const { user } = useAuth();
  const { toast } = useToast();
  const hasEditAccess = canEditBids(user?.role);
  
  const [currentStep, setCurrentStep] = useState(1);
  const [uploadedDocs, setUploadedDocs] = useState<UploadedDocument[]>([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<AIAnalysisResult | null>(null);
  const [scopeItems, setScopeItems] = useState<AIExtractedItem[]>([]);
  const [customItems, setCustomItems] = useState<AIExtractedItem[]>([]);
  const [newItemDescription, setNewItemDescription] = useState("");
  const [newItemQuantity, setNewItemQuantity] = useState("");
  const [newItemUnit, setNewItemUnit] = useState("");
  
  const [selectedGcOrg, setSelectedGcOrg] = useState<CrmOrganisation | null>(null);
  const [selectedGcContact, setSelectedGcContact] = useState<CrmContact | null>(null);
  const [selectedOwnerRepOrg, setSelectedOwnerRepOrg] = useState<CrmOrganisation | null>(null);
  const [selectedOwnerRepContact, setSelectedOwnerRepContact] = useState<CrmContact | null>(null);

  const form = useForm<BidDetailsForm>({
    resolver: zodResolver(bidDetailsSchema),
    defaultValues: {
      name: "",
      clientName: "",
      clientContactName: "",
      clientContactEmail: "",
      clientContactPhone: "",
      dueDate: "",
      locationAddress: "",
      city: "",
      state: "",
      description: "",
    },
  });

  const onGetUploadParameters = async () => {
    try {
      const response = await apiRequest("POST", "/api/objects/upload");
      const data = await response.json();
      return {
        method: "PUT" as const,
        url: data.uploadURL,
      };
    } catch (error) {
      toast({ title: "Error", description: "Failed to get upload URL", variant: "destructive" });
      throw error;
    }
  };

  const handleUploadComplete = useCallback((result: any) => {
    if (!result.successful || result.successful.length === 0) return;

    const newDocs: UploadedDocument[] = result.successful.map((file: any, index: number) => ({
      id: `doc-${Date.now()}-${index}`,
      name: file.name,
      url: file.uploadURL?.split('?')[0] || "",
      type: file.type || "application/pdf",
      size: file.size || 0,
    }));

    setUploadedDocs(prev => [...prev, ...newDocs]);
    toast({ title: "Documents uploaded", description: `${newDocs.length} file(s) uploaded successfully` });
  }, [toast]);

  const removeDocument = (docId: string) => {
    setUploadedDocs(prev => prev.filter(d => d.id !== docId));
  };

  const analyzeMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/ai-bid-wizard/analyze", {
        documents: uploadedDocs.map(d => ({ url: d.url, name: d.name })),
      });
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Analysis failed' }));
        throw new Error(errorData.error || 'Failed to analyze documents');
      }
      return response.json();
    },
    onSuccess: (data) => {
      setAnalysisResult(data);
      
      // Safely coerce scope items with proper numeric handling
      const items = (data.scopeItems || []).map((item: any, idx: number) => ({
        ...item,
        id: `ai-${idx}`,
        quantity: typeof item.quantity === 'number' && !isNaN(item.quantity) ? item.quantity : 1,
        unit: item.unit || 'EA',
        category: item.category || 'GENERAL',
        selected: true,
      }));
      setScopeItems(items);
      
      if (data.projectName) form.setValue("name", data.projectName);
      if (data.clientName) form.setValue("clientName", data.clientName);
      if (data.clientContactName) form.setValue("clientContactName", data.clientContactName);
      if (data.clientContactEmail) form.setValue("clientContactEmail", data.clientContactEmail);
      if (data.clientContactPhone) form.setValue("clientContactPhone", data.clientContactPhone);
      if (data.dueDate) form.setValue("dueDate", data.dueDate);
      if (data.locationAddress) form.setValue("locationAddress", data.locationAddress);
      if (data.city) form.setValue("city", data.city);
      if (data.state) form.setValue("state", data.state);
      if (data.description) form.setValue("description", data.description);
      
      // Show warning if AI had an error
      if (data.aiError) {
        toast({ 
          title: "AI analysis incomplete", 
          description: data.message || "You can enter information manually.",
          variant: "default"
        });
      } else {
        toast({ title: "Analysis complete", description: `Found ${items.length} scope items` });
      }
      
      setCurrentStep(3);
    },
    onError: (error: any) => {
      toast({ 
        title: "Analysis failed", 
        description: error.message || "Failed to analyze documents. You can still proceed manually.",
        variant: "destructive"
      });
      setCurrentStep(3);
    },
  });

  const createBidMutation = useMutation({
    mutationFn: async (data: BidDetailsForm) => {
      const selectedItems = [...scopeItems.filter(i => i.selected), ...customItems];
      
      // Step 1: Create the bid
      const response = await apiRequest("POST", "/api/bids", {
        ...data,
        estimatorId: user?.id,
      });
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ message: 'Failed to create bid' }));
        throw new Error(errorData.message || 'Failed to create bid');
      }
      const bid = await response.json();
      
      // Step 2: Create an estimate for the bid (required for line items)
      const estimateResponse = await apiRequest("POST", `/api/bids/${bid.id}/estimate`);
      if (!estimateResponse.ok) {
        const errorData = await estimateResponse.json().catch(() => ({ message: 'Failed to create estimate' }));
        throw new Error(errorData.message || 'Failed to create estimate for bid. Please try again.');
      }
      const estimate = await estimateResponse.json();
      
      // Step 3: Add each scope item as a line item to the estimate
      const validCategories = ["CONCRETE", "EXCAVATION", "PAVERS", "BOLLARDS", "GC", "OVERHEAD", "PROFIT", "GENERAL"];
      const mapCategory = (cat: string | undefined) => {
        if (!cat) return "GENERAL";
        const upper = cat.toUpperCase();
        return validCategories.includes(upper) ? upper : "GENERAL";
      };
      
      if (selectedItems.length > 0 && estimate?.id) {
        const failedItems: string[] = [];
        
        for (const item of selectedItems) {
          const qty = Number.isFinite(item.quantity) && item.quantity > 0 ? item.quantity : 1;
          const lineItemData = {
            description: item.description,
            quantity: qty.toString(),
            unit: item.unit || 'EA',
            category: mapCategory(item.category),
            notes: item.notes,
            materialCost: "0",
            laborCost: "0",
            laborHours: "0",
            equipmentCost: "0",
            consumablesCost: "0",
            subcontractCost: "0",
            overheadAllocation: "0",
            profitAllocation: "0",
            totalCost: "0",
          };
          
          const lineItemResponse = await apiRequest("POST", `/api/estimates/${estimate.id}/line-items`, lineItemData);
          if (!lineItemResponse.ok) {
            failedItems.push(item.description);
          }
        }
        
        if (failedItems.length > 0) {
          throw new Error(`Failed to add ${failedItems.length} scope item(s) to estimate. Please add them manually.`);
        }
      }
      
      return bid;
    },
    onSuccess: (bid) => {
      queryClient.invalidateQueries({ queryKey: ["/api/bids"] });
      toast({ 
        title: "Bid created successfully", 
        description: `Bid ${bid.code} has been created with ${scopeItems.filter(i => i.selected).length + customItems.length} line items`
      });
      setLocation(`/bids/${bid.code}/estimate`);
    },
    onError: (error: any) => {
      toast({ 
        title: "Failed to create bid", 
        description: error.message || "An error occurred",
        variant: "destructive"
      });
    },
  });

  const handleGcSelect = (org: CrmOrganisation | null) => {
    setSelectedGcOrg(org);
    if (org) {
      form.setValue("gcOrganizationId", org.id);
      form.setValue("clientName", org.name);
    } else {
      form.setValue("gcOrganizationId", undefined);
    }
  };

  const handleGcContactSelect = (contact: CrmContact | null) => {
    setSelectedGcContact(contact);
    if (contact) {
      form.setValue("clientContactName", `${contact.firstName} ${contact.lastName}`.trim());
      form.setValue("clientContactEmail", contact.email || "");
      form.setValue("clientContactPhone", contact.phone || contact.mobile || "");
    }
  };

  const handleOwnerRepSelect = (org: CrmOrganisation | null) => {
    setSelectedOwnerRepOrg(org);
    form.setValue("ownerRepOrganizationId", org?.id || undefined);
  };

  const toggleScopeItem = (itemId: string) => {
    setScopeItems(prev => prev.map(item => 
      item.id === itemId ? { ...item, selected: !item.selected } : item
    ));
  };

  const addCustomItem = () => {
    if (!newItemDescription.trim()) return;
    
    // Safely parse quantity with Number.isFinite guard
    const parsedQty = parseFloat(newItemQuantity);
    const safeQuantity = Number.isFinite(parsedQty) && parsedQty > 0 ? parsedQty : 1;
    
    const newItem: AIExtractedItem = {
      id: `custom-${Date.now()}`,
      description: newItemDescription.trim(),
      quantity: safeQuantity,
      unit: newItemUnit || "EA",
      category: "CUSTOM",
      selected: true,
    };
    
    setCustomItems(prev => [...prev, newItem]);
    setNewItemDescription("");
    setNewItemQuantity("");
    setNewItemUnit("");
  };

  const removeCustomItem = (itemId: string) => {
    setCustomItems(prev => prev.filter(i => i.id !== itemId));
  };

  const goToStep = (step: number) => {
    if (step < currentStep) {
      setCurrentStep(step);
    } else if (step === currentStep + 1) {
      if (currentStep === 1 && uploadedDocs.length === 0) {
        toast({ title: "Upload required", description: "Please upload at least one document", variant: "destructive" });
        return;
      }
      if (currentStep === 2) {
        analyzeMutation.mutate();
        return;
      }
      setCurrentStep(step);
    }
  };

  const handleSkipAnalysis = () => {
    setCurrentStep(3);
  };

  const handleSubmit = form.handleSubmit((data) => {
    createBidMutation.mutate(data);
  });

  const progressPercent = (currentStep / WIZARD_STEPS.length) * 100;

  if (!hasEditAccess) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Card className="max-w-md">
          <CardHeader>
            <CardTitle>Access Restricted</CardTitle>
            <CardDescription>
              You do not have permission to create new bids. Please contact your administrator if you need this access.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={() => setLocation("/bids")} data-testid="button-back-to-bids">
              Back to Bids
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-6xl mx-auto p-6">
        <div className="mb-8">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h1 className="text-2xl font-bold">Create New Bid</h1>
              <p className="text-muted-foreground">AI-powered bid creation wizard</p>
            </div>
            <Button variant="outline" onClick={() => setLocation("/bids")} data-testid="button-cancel-wizard">
              <X className="h-4 w-4 mr-2" />
              Cancel
            </Button>
          </div>
          
          <Progress value={progressPercent} className="h-2 mb-4" />
          
          <div className="flex justify-between">
            {WIZARD_STEPS.map((step) => (
              <div
                key={step.id}
                className={`flex items-center gap-2 cursor-pointer transition-opacity ${
                  step.id <= currentStep ? "opacity-100" : "opacity-50"
                }`}
                onClick={() => step.id < currentStep && setCurrentStep(step.id)}
                data-testid={`wizard-step-${step.id}`}
              >
                <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
                  step.id < currentStep 
                    ? "bg-primary text-primary-foreground" 
                    : step.id === currentStep 
                      ? "bg-primary/20 text-primary border-2 border-primary" 
                      : "bg-muted text-muted-foreground"
                }`}>
                  {step.id < currentStep ? (
                    <CheckCircle2 className="h-4 w-4" />
                  ) : (
                    <step.icon className="h-4 w-4" />
                  )}
                </div>
                <div className="hidden md:block">
                  <p className="text-sm font-medium">{step.name}</p>
                  <p className="text-xs text-muted-foreground">{step.description}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {currentStep === 1 && (
          <Card data-testid="step-upload-documents">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Upload className="h-5 w-5" />
                Upload Bid Documents
              </CardTitle>
              <CardDescription>
                Upload bid invitation, construction drawings, specifications, and any other relevant documents.
                Our AI will analyze them to extract scope of work items and project details.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <ObjectUploader
                onGetUploadParameters={onGetUploadParameters}
                onComplete={handleUploadComplete}
                allowedFileTypes={[".pdf", ".png", ".jpg", ".jpeg", ".doc", ".docx", ".xls", ".xlsx"]}
                maxNumberOfFiles={10}
              >
                <div className="flex flex-col items-center justify-center p-8 border-2 border-dashed rounded-lg hover:border-primary transition-colors">
                  <Upload className="h-10 w-10 text-muted-foreground mb-4" />
                  <p className="font-medium">Click to upload or drag and drop</p>
                  <p className="text-sm text-muted-foreground mt-1">
                    PDF, Images, Word, Excel (max 10 files)
                  </p>
                </div>
              </ObjectUploader>

              {uploadedDocs.length > 0 && (
                <div className="space-y-2">
                  <h4 className="font-medium">Uploaded Documents ({uploadedDocs.length})</h4>
                  <div className="space-y-2">
                    {uploadedDocs.map((doc) => (
                      <div
                        key={doc.id}
                        className="flex items-center justify-between p-3 rounded-md border bg-muted/30"
                        data-testid={`uploaded-doc-${doc.id}`}
                      >
                        <div className="flex items-center gap-3">
                          <FileText className="h-5 w-5 text-muted-foreground" />
                          <div>
                            <p className="font-medium text-sm">{doc.name}</p>
                            <p className="text-xs text-muted-foreground">
                              {(doc.size / 1024).toFixed(1)} KB
                            </p>
                          </div>
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => removeDocument(doc.id)}
                          data-testid={`remove-doc-${doc.id}`}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex justify-between pt-4">
                <Button variant="outline" onClick={() => setLocation("/bids")} data-testid="button-back-to-bids">
                  <ArrowLeft className="h-4 w-4 mr-2" />
                  Back to Bids
                </Button>
                <div className="flex gap-2">
                  <Button variant="outline" onClick={handleSkipAnalysis} data-testid="button-skip-analysis">
                    Skip AI Analysis
                  </Button>
                  <Button 
                    onClick={() => goToStep(2)} 
                    disabled={uploadedDocs.length === 0}
                    data-testid="button-analyze-documents"
                  >
                    Analyze Documents
                    <ArrowRight className="h-4 w-4 ml-2" />
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {currentStep === 2 && (
          <Card data-testid="step-ai-review">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Sparkles className="h-5 w-5" />
                AI Document Analysis
              </CardTitle>
              <CardDescription>
                Our AI is analyzing your documents to extract project details and scope of work items.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="flex flex-col items-center justify-center py-12">
                {analyzeMutation.isPending ? (
                  <>
                    <Loader2 className="h-12 w-12 animate-spin text-primary mb-4" />
                    <h3 className="text-lg font-medium">Analyzing Documents...</h3>
                    <p className="text-muted-foreground text-center max-w-md mt-2">
                      AI is reading your documents to extract project information, scope items, 
                      and key requirements. This may take a minute.
                    </p>
                    <div className="flex gap-2 mt-6">
                      {uploadedDocs.map((doc, idx) => (
                        <Badge key={doc.id} variant="outline" className="flex items-center gap-1">
                          <FileText className="h-3 w-3" />
                          {doc.name.length > 20 ? doc.name.substring(0, 20) + "..." : doc.name}
                        </Badge>
                      ))}
                    </div>
                  </>
                ) : (
                  <>
                    <Sparkles className="h-12 w-12 text-primary mb-4" />
                    <h3 className="text-lg font-medium">Ready to Analyze</h3>
                    <p className="text-muted-foreground text-center max-w-md mt-2">
                      Click the button below to start AI analysis of your {uploadedDocs.length} document(s).
                    </p>
                    <Button 
                      className="mt-6" 
                      onClick={() => analyzeMutation.mutate()}
                      data-testid="button-start-analysis"
                    >
                      <Sparkles className="h-4 w-4 mr-2" />
                      Start AI Analysis
                    </Button>
                  </>
                )}
              </div>

              <div className="flex justify-between pt-4">
                <Button variant="outline" onClick={() => setCurrentStep(1)} data-testid="button-back-to-upload">
                  <ArrowLeft className="h-4 w-4 mr-2" />
                  Back
                </Button>
                <Button variant="outline" onClick={handleSkipAnalysis} data-testid="button-skip-to-scope">
                  Skip to Scope Entry
                  <ArrowRight className="h-4 w-4 ml-2" />
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {currentStep === 3 && (
          <Card data-testid="step-confirm-scope">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ClipboardList className="h-5 w-5" />
                Confirm Scope of Work
              </CardTitle>
              <CardDescription>
                Review the AI-extracted scope items, modify as needed, and add your own items.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {analysisResult && (
                <Alert className="bg-primary/5 border-primary/20">
                  <Sparkles className="h-4 w-4" />
                  <AlertDescription>
                    AI found <strong>{scopeItems.length}</strong> potential scope items from your documents.
                    {analysisResult.keyRequirements && analysisResult.keyRequirements.length > 0 && (
                      <span className="block mt-1 text-xs">
                        Key requirements: {analysisResult.keyRequirements.slice(0, 3).join(", ")}
                      </span>
                    )}
                  </AlertDescription>
                </Alert>
              )}

              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h4 className="font-medium">
                    {scopeItems.length > 0 ? "AI-Extracted Items" : "Scope Items"}
                  </h4>
                  <Badge variant="outline">
                    {scopeItems.filter(i => i.selected).length + customItems.length} selected
                  </Badge>
                </div>

                {scopeItems.length > 0 ? (
                  <ScrollArea className="h-[300px] rounded-md border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-12">Include</TableHead>
                          <TableHead>Description</TableHead>
                          <TableHead className="w-24">Quantity</TableHead>
                          <TableHead className="w-20">Unit</TableHead>
                          <TableHead className="w-28">Category</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {scopeItems.map((item) => (
                          <TableRow key={item.id} data-testid={`scope-item-${item.id}`}>
                            <TableCell>
                              <Checkbox
                                checked={item.selected}
                                onCheckedChange={() => toggleScopeItem(item.id)}
                                data-testid={`checkbox-${item.id}`}
                              />
                            </TableCell>
                            <TableCell className="font-medium">{item.description}</TableCell>
                            <TableCell>{item.quantity}</TableCell>
                            <TableCell>{item.unit}</TableCell>
                            <TableCell>
                              <Badge variant="outline" className="text-xs">{item.category}</Badge>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </ScrollArea>
                ) : (
                  <div className="text-center py-8 border rounded-md bg-muted/30">
                    <ClipboardList className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
                    <p className="text-muted-foreground">No AI-extracted items. Add your own below.</p>
                  </div>
                )}

                {customItems.length > 0 && (
                  <div className="space-y-2">
                    <h4 className="font-medium text-sm">Your Custom Items</h4>
                    <div className="space-y-2">
                      {customItems.map((item) => (
                        <div
                          key={item.id}
                          className="flex items-center justify-between p-3 rounded-md border bg-muted/30"
                          data-testid={`custom-item-${item.id}`}
                        >
                          <div className="flex items-center gap-4">
                            <CheckCircle2 className="h-4 w-4 text-primary" />
                            <span className="font-medium">{item.description}</span>
                            <Badge variant="outline">{item.quantity} {item.unit}</Badge>
                          </div>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => removeCustomItem(item.id)}
                            data-testid={`remove-custom-${item.id}`}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <Separator />

                <div className="space-y-3">
                  <h4 className="font-medium text-sm">Add Custom Scope Item</h4>
                  <div className="flex gap-2">
                    <Input
                      placeholder="Description"
                      value={newItemDescription}
                      onChange={(e) => setNewItemDescription(e.target.value)}
                      className="flex-1"
                      data-testid="input-custom-description"
                    />
                    <Input
                      placeholder="Qty"
                      type="number"
                      value={newItemQuantity}
                      onChange={(e) => setNewItemQuantity(e.target.value)}
                      className="w-20"
                      data-testid="input-custom-quantity"
                    />
                    <Input
                      placeholder="Unit"
                      value={newItemUnit}
                      onChange={(e) => setNewItemUnit(e.target.value)}
                      className="w-20"
                      data-testid="input-custom-unit"
                    />
                    <Button onClick={addCustomItem} data-testid="button-add-custom-item">
                      <Plus className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </div>

              <div className="flex justify-between pt-4">
                <Button variant="outline" onClick={() => setCurrentStep(1)} data-testid="button-back-to-step1">
                  <ArrowLeft className="h-4 w-4 mr-2" />
                  Back to Upload
                </Button>
                <Button onClick={() => setCurrentStep(4)} data-testid="button-continue-to-details">
                  Continue to Bid Details
                  <ArrowRight className="h-4 w-4 ml-2" />
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {currentStep === 4 && (
          <Card data-testid="step-bid-details">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Building2 className="h-5 w-5" />
                Bid Details
              </CardTitle>
              <CardDescription>
                Enter the bid information. Some fields may be pre-filled from AI analysis.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Form {...form}>
                <form onSubmit={handleSubmit} className="space-y-6">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <FormField
                      control={form.control}
                      name="name"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Bid Name *</FormLabel>
                          <FormControl>
                            <Input placeholder="e.g., City Hall Renovation" {...field} data-testid="input-bid-name" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="dueDate"
                      render={({ field }) => (
                        <FormItem className="flex flex-col">
                          <FormLabel className="mt-[5px] mb-[5px]">Due Date</FormLabel>
                          <Popover>
                            <PopoverTrigger asChild>
                              <FormControl>
                                <Button
                                  variant="outline"
                                  className={cn(
                                    "w-full pl-3 text-left font-normal",
                                    !field.value && "text-muted-foreground"
                                  )}
                                  data-testid="input-due-date"
                                >
                                  {field.value && !isNaN(parseISO(field.value).getTime()) ? format(parseISO(field.value), "PPP") : "Pick a date"}
                                  <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                                </Button>
                              </FormControl>
                            </PopoverTrigger>
                            <PopoverContent className="w-auto p-0" align="start">
                              <CalendarPicker
                                mode="single"
                                selected={field.value && !isNaN(parseISO(field.value).getTime()) ? parseISO(field.value) : undefined}
                                onSelect={(date) => field.onChange(date ? format(date, "yyyy-MM-dd") : "")}
                                initialFocus
                              />
                            </PopoverContent>
                          </Popover>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>

                  <Separator />

                  <div className="space-y-4">
                    <h4 className="font-medium">Client Information</h4>
                    
                    <div className="space-y-2">
                      <FormLabel>Select from CRM (optional)</FormLabel>
                      <CrmOrganizationSelector
                        value={selectedGcOrg?.id}
                        onSelect={handleGcSelect}
                        selectedContactId={selectedGcContact?.id}
                        onContactSelect={handleGcContactSelect}
                        filterTypes={["CONTRACTOR"]}
                        placeholder="Search for client organization..."
                      />
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <FormField
                        control={form.control}
                        name="clientName"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Client Name *</FormLabel>
                            <FormControl>
                              <Input placeholder="Client company name" {...field} data-testid="input-client-name" />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={form.control}
                        name="clientContactName"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Contact Name</FormLabel>
                            <FormControl>
                              <Input placeholder="Primary contact" {...field} data-testid="input-contact-name" />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={form.control}
                        name="clientContactEmail"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Contact Email</FormLabel>
                            <FormControl>
                              <Input type="email" placeholder="email@example.com" {...field} data-testid="input-contact-email" />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={form.control}
                        name="clientContactPhone"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Contact Phone</FormLabel>
                            <FormControl>
                              <Input placeholder="(555) 123-4567" {...field} data-testid="input-contact-phone" />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                  </div>

                  <Separator />

                  <div className="space-y-4">
                    <h4 className="font-medium">Location</h4>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <FormField
                        control={form.control}
                        name="locationAddress"
                        render={({ field }) => (
                          <FormItem className="md:col-span-3">
                            <FormLabel>Address</FormLabel>
                            <FormControl>
                              <Input placeholder="Street address" {...field} data-testid="input-address" />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={form.control}
                        name="city"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>City</FormLabel>
                            <FormControl>
                              <Input placeholder="City" {...field} data-testid="input-city" />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={form.control}
                        name="state"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>State</FormLabel>
                            <FormControl>
                              <Input placeholder="State" {...field} data-testid="input-state" />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                  </div>

                  <Separator />

                  <FormField
                    control={form.control}
                    name="description"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Description / Notes</FormLabel>
                        <FormControl>
                          <Textarea 
                            placeholder="Additional notes about this bid..."
                            className="min-h-[100px]"
                            {...field}
                            data-testid="input-description"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <Alert className="bg-muted">
                    <CheckCircle2 className="h-4 w-4" />
                    <AlertDescription>
                      <strong>{scopeItems.filter(i => i.selected).length + customItems.length}</strong> scope items 
                      will be added to your estimate when you create this bid.
                    </AlertDescription>
                  </Alert>

                  <div className="flex justify-between pt-4">
                    <Button 
                      type="button" 
                      variant="outline" 
                      onClick={() => setCurrentStep(3)}
                      data-testid="button-back-to-scope"
                    >
                      <ArrowLeft className="h-4 w-4 mr-2" />
                      Back to Scope
                    </Button>
                    <Button 
                      type="submit" 
                      disabled={createBidMutation.isPending}
                      data-testid="button-create-bid"
                    >
                      {createBidMutation.isPending ? (
                        <>
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                          Creating...
                        </>
                      ) : (
                        <>
                          <CheckCircle2 className="h-4 w-4 mr-2" />
                          Create Bid & Go to Estimate
                        </>
                      )}
                    </Button>
                  </div>
                </form>
              </Form>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
