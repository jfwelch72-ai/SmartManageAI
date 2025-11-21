import { useState } from "react";
import AppHeader from "@/components/AppHeader";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import FileUploadZone from "@/components/FileUploadZone";
import { ObjectUploader } from "@/components/ObjectUploader";
import { Building2, MapPin, Mail, Phone, Calendar, DollarSign, Plus, Edit, Trash2, Users, FileText, Download } from "lucide-react";
import { useLocation, useRoute } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { useBid, useConvertBidToProject } from "@/hooks/use-data";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { insertBidSubcontractorQuoteSchema } from "@shared/schema";
import type { BidSubcontractorQuote, InsertBidSubcontractorQuote } from "@shared/schema";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { format } from "date-fns";
import { z } from "zod";
import type { UploadResult } from "@uppy/core";

const quoteFormSchema = insertBidSubcontractorQuoteSchema.omit({ bidId: true }).extend({
  quoteAmount: z.string().min(1, "Quote amount is required"),
});
type QuoteFormValues = z.infer<typeof quoteFormSchema>;

export default function BidDetailPage() {
  const [, setLocation] = useLocation();
  const [, params] = useRoute("/bids/:code");
  const { user, logout } = useAuth();
  const { toast } = useToast();
  const [showQuoteDialog, setShowQuoteDialog] = useState(false);
  const [editingQuote, setEditingQuote] = useState<BidSubcontractorQuote | null>(null);
  const [uploadedFileData, setUploadedFileData] = useState<{
    fileUrl: string;
    fileName: string;
    fileSize: number;
    mimeType: string;
  } | null>(null);
  const [isUploadingFile, setIsUploadingFile] = useState(false);
  
  const bidCode = params?.code || "";
  const { data: bid, isLoading } = useBid(bidCode);
  const convertBid = useConvertBidToProject();

  // Fetch bid quotes
  const { data: quotes = [], isLoading: quotesLoading } = useQuery<BidSubcontractorQuote[]>({
    queryKey: ["/api/bids", bidCode, "quotes"],
    enabled: !!bidCode,
  });

  // Quote form
  const form = useForm<QuoteFormValues>({
    resolver: zodResolver(quoteFormSchema),
    defaultValues: {
      subcontractorName: "",
      scopeOfWork: "",
      quoteAmount: "",
      contactName: "",
      contactEmail: "",
      contactPhone: "",
      notes: "",
    },
  });

  // Create quote mutation
  const createQuote = useMutation({
    mutationFn: async (data: QuoteFormValues) => {
      const payload = {
        ...data,
        quoteAmount: data.quoteAmount,
      };
      const response = await fetch(`/api/bids/${bidCode}/quotes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(payload),
      });
      if (!response.ok) throw new Error("Failed to create quote");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/bids", bidCode, "quotes"] });
      toast({ title: "Success", description: "Subcontractor quote added" });
      setShowQuoteDialog(false);
      form.reset();
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to add quote",
        variant: "destructive",
      });
    },
  });

  // Update quote mutation
  const updateQuote = useMutation({
    mutationFn: async ({ quoteId, data }: { quoteId: string; data: Partial<QuoteFormValues> }) => {
      const response = await fetch(`/api/bids/${bidCode}/quotes/${quoteId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(data),
      });
      if (!response.ok) throw new Error("Failed to update quote");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/bids", bidCode, "quotes"] });
      toast({ title: "Success", description: "Quote updated" });
      setShowQuoteDialog(false);
      setEditingQuote(null);
      form.reset();
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update quote",
        variant: "destructive",
      });
    },
  });

  // Delete quote mutation
  const deleteQuote = useMutation({
    mutationFn: async (quoteId: string) => {
      const response = await fetch(`/api/bids/${bidCode}/quotes/${quoteId}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!response.ok) throw new Error("Failed to delete quote");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/bids", bidCode, "quotes"] });
      toast({ title: "Success", description: "Quote deleted" });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to delete quote",
        variant: "destructive",
      });
    },
  });

  const handleAddQuote = () => {
    setEditingQuote(null);
    setUploadedFileData(null);
    form.reset();
    setShowQuoteDialog(true);
  };

  const handleEditQuote = (quote: BidSubcontractorQuote) => {
    setEditingQuote(quote);
    setUploadedFileData(
      quote.fileUrl && quote.fileName ? {
        fileUrl: quote.fileUrl,
        fileName: quote.fileName,
        fileSize: quote.fileSize || 0,
        mimeType: quote.mimeType || "",
      } : null
    );
    form.reset({
      subcontractorName: quote.subcontractorName,
      scopeOfWork: quote.scopeOfWork,
      quoteAmount: quote.quoteAmount,
      contactName: quote.contactName || "",
      contactEmail: quote.contactEmail || "",
      contactPhone: quote.contactPhone || "",
      notes: quote.notes || "",
    });
    setShowQuoteDialog(true);
  };

  const handleDeleteQuote = async (quoteId: string) => {
    if (confirm("Are you sure you want to delete this quote?")) {
      await deleteQuote.mutateAsync(quoteId);
    }
  };

  const getUploadParameters = async () => {
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

  const handleFileUploadComplete = async (result: UploadResult<Record<string, unknown>, Record<string, unknown>>) => {
    try {
      if (!result.successful || result.successful.length === 0) {
        throw new Error("No file uploaded");
      }

      const uploadedFile = result.successful[0];
      const file = uploadedFile.data as File;
      const uploadUrl = uploadedFile.uploadURL;
      const filePath = uploadUrl?.split('?')[0] || '';

      setUploadedFileData({
        fileUrl: filePath,
        fileName: file.name,
        fileSize: file.size,
        mimeType: file.type,
      });

      toast({ title: "Success", description: "Quote document uploaded" });
    } catch (error) {
      toast({ title: "Error", description: "Failed to process uploaded file", variant: "destructive" });
    } finally {
      setIsUploadingFile(false);
    }
  };

  const onSubmitQuote = async (data: QuoteFormValues) => {
    const payload = {
      ...data,
      ...(uploadedFileData && {
        fileUrl: uploadedFileData.fileUrl,
        fileName: uploadedFileData.fileName,
        fileSize: uploadedFileData.fileSize,
        mimeType: uploadedFileData.mimeType,
      }),
    };

    if (editingQuote) {
      await updateQuote.mutateAsync({ quoteId: editingQuote.id, data: payload });
    } else {
      await createQuote.mutateAsync(payload as QuoteFormValues);
    }
  };

  const totalQuotes = quotes.reduce((sum, q) => sum + Number(q.quoteAmount || 0), 0);

  const handleMarkAsAwarded = async () => {
    if (!bid) return;
    
    if (confirm(`Mark bid ${bid.code} as awarded and convert to active project?`)) {
      try {
        await convertBid.mutateAsync(bid.code);
        toast({
          title: "Success",
          description: "Bid has been awarded and moved to Active Projects!",
        });
        setLocation('/projects');
      } catch (error: any) {
        toast({
          title: "Error",
          description: error.message || "Failed to convert bid to project",
          variant: "destructive",
        });
      }
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background">
        <AppHeader
          userName={`${user?.firstName || ""} ${user?.lastName || ""}`.trim() || "User"}
          userRole={user?.role || ""}
          onLogout={logout}
        />
        <div className="flex items-center justify-center py-12">
          <p className="text-muted-foreground">Loading bid details...</p>
        </div>
      </div>
    );
  }

  if (!bid) {
    return (
      <div className="min-h-screen bg-background">
        <AppHeader
          userName={`${user?.firstName || ""} ${user?.lastName || ""}`.trim() || "User"}
          userRole={user?.role || ""}
          onLogout={logout}
        />
        <div className="flex items-center justify-center py-12">
          <p className="text-muted-foreground">Bid not found</p>
        </div>
      </div>
    );
  }

  const locationString = [bid.locationAddress, bid.city, bid.state]
    .filter(Boolean)
    .join(', ') || 'No location specified';

  return (
    <div className="min-h-screen bg-background">
      <AppHeader
        userName={`${user?.firstName || ""} ${user?.lastName || ""}`.trim() || "User"}
        userRole={user?.role || ""}
        onLogout={logout}
      />
      
      <main className="mx-auto max-w-7xl px-6 py-8">
        <div className="mb-6">
          <Button variant="ghost" onClick={() => setLocation('/bids')} data-testid="button-back">
            ← Back to Bid Board
          </Button>
        </div>

        <div className="flex items-start justify-between gap-4 flex-wrap mb-6">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <Badge variant="outline" className="font-mono">
                {bid.code}
              </Badge>
              <Badge className="bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300">
                BID IN PROGRESS
              </Badge>
            </div>
            <h1 className="text-2xl font-bold text-foreground mb-2">{bid.name}</h1>
          </div>
          <Button onClick={handleMarkAsAwarded} data-testid="button-mark-awarded">
            Mark as Awarded
          </Button>
        </div>

        <div className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card>
              <CardHeader>
                <CardTitle>Bid Information</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-start gap-3">
                  <DollarSign className="w-5 h-5 text-muted-foreground mt-0.5" />
                  <div>
                    <p className="text-sm font-medium">Bid Amount</p>
                    <p className="text-lg font-bold font-mono">
                      {bid.bidAmount ? `$${Number(bid.bidAmount).toLocaleString()}` : 'TBD'}
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <Calendar className="w-5 h-5 text-muted-foreground mt-0.5" />
                  <div>
                    <p className="text-sm font-medium">Due Date</p>
                    <p className="text-sm text-muted-foreground">
                      {bid.dueDate ? format(new Date(bid.dueDate), 'PPP') : 'Not set'}
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <Building2 className="w-5 h-5 text-muted-foreground mt-0.5" />
                  <div>
                    <p className="text-sm font-medium">Client</p>
                    <p className="text-sm text-muted-foreground">{bid.clientName}</p>
                  </div>
                </div>
                {bid.clientContactEmail && (
                  <div className="flex items-start gap-3">
                    <Mail className="w-5 h-5 text-muted-foreground mt-0.5" />
                    <div>
                      <p className="text-sm font-medium">Contact Email</p>
                      <p className="text-sm text-muted-foreground">{bid.clientContactEmail}</p>
                    </div>
                  </div>
                )}
                {bid.clientContactPhone && (
                  <div className="flex items-start gap-3">
                    <Phone className="w-5 h-5 text-muted-foreground mt-0.5" />
                    <div>
                      <p className="text-sm font-medium">Contact Phone</p>
                      <p className="text-sm text-muted-foreground">{bid.clientContactPhone}</p>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Project Details</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-start gap-3">
                  <MapPin className="w-5 h-5 text-muted-foreground mt-0.5" />
                  <div>
                    <p className="text-sm font-medium">Location</p>
                    <p className="text-sm text-muted-foreground">{locationString}</p>
                  </div>
                </div>
                {bid.estimatorId && (
                  <div>
                    <p className="text-sm font-medium mb-1">Estimator</p>
                    <p className="text-sm text-muted-foreground">Estimator ID: {bid.estimatorId}</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {bid.description && (
            <Card>
              <CardHeader>
                <CardTitle>Description</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">{bid.description}</p>
              </CardContent>
            </Card>
          )}

          <Card data-testid="card-subcontractor-quotes">
            <CardHeader className="flex flex-row items-center justify-between gap-4">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Users className="w-5 h-5" />
                  Subcontractor Quotes
                </CardTitle>
                <CardDescription>Track quotes from subcontractors for cost estimation</CardDescription>
              </div>
              {(user?.role === "ADMIN" || user?.role === "MANAGER" || user?.role === "ESTIMATOR") && (
                <Button onClick={handleAddQuote} size="sm" data-testid="button-add-quote">
                  <Plus className="w-4 h-4 mr-2" />
                  Add Quote
                </Button>
              )}
            </CardHeader>
            <CardContent>
              {quotesLoading ? (
                <div className="text-center py-8 text-muted-foreground">Loading quotes...</div>
              ) : quotes.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  No subcontractor quotes added yet
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="flex items-center justify-between p-4 bg-muted rounded-md">
                    <span className="text-sm font-medium">Total from Quotes:</span>
                    <span className="text-lg font-bold font-mono">${totalQuotes.toLocaleString()}</span>
                  </div>
                  <div className="space-y-3">
                    {quotes.map((quote) => (
                      <div key={quote.id} className="flex items-start justify-between p-4 border rounded-md" data-testid={`quote-${quote.id}`}>
                        <div className="flex-1">
                          <div className="flex items-center gap-3 mb-2">
                            <h4 className="font-medium">{quote.subcontractorName}</h4>
                            <Badge variant="outline" className="font-mono">
                              ${Number(quote.quoteAmount).toLocaleString()}
                            </Badge>
                            {quote.fileUrl && (
                              <Badge variant="secondary" className="gap-1">
                                <FileText className="w-3 h-3" />
                                Document
                              </Badge>
                            )}
                          </div>
                          <p className="text-sm text-muted-foreground mb-2">{quote.scopeOfWork}</p>
                          {(quote.contactName || quote.contactEmail || quote.contactPhone) && (
                            <div className="text-xs text-muted-foreground space-y-1">
                              {quote.contactName && <p>Contact: {quote.contactName}</p>}
                              {quote.contactEmail && <p>Email: {quote.contactEmail}</p>}
                              {quote.contactPhone && <p>Phone: {quote.contactPhone}</p>}
                            </div>
                          )}
                          {quote.notes && (
                            <p className="text-xs text-muted-foreground mt-2 italic">{quote.notes}</p>
                          )}
                          {quote.fileUrl && (
                            <div className="flex items-center gap-2 mt-3 pt-3 border-t">
                              <FileText className="w-4 h-4 text-muted-foreground" />
                              <span className="text-xs text-muted-foreground flex-1 truncate">
                                {quote.fileName || "Quote document"}
                              </span>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={async () => {
                                  try {
                                    const response = await apiRequest("POST", "/api/objects/download", {
                                      fileUrl: quote.fileUrl,
                                    });
                                    const data = await response.json();
                                    window.open(data.downloadURL, '_blank');
                                  } catch (error) {
                                    toast({ 
                                      title: "Error", 
                                      description: "Failed to download document", 
                                      variant: "destructive" 
                                    });
                                  }
                                }}
                                data-testid={`button-download-quote-${quote.id}`}
                              >
                                <Download className="w-3 h-3 mr-1" />
                                Download
                              </Button>
                            </div>
                          )}
                        </div>
                        {(user?.role === "ADMIN" || user?.role === "MANAGER" || user?.role === "ESTIMATOR") && (
                          <div className="flex gap-2 ml-4">
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={() => handleEditQuote(quote)}
                              data-testid={`button-edit-quote-${quote.id}`}
                            >
                              <Edit className="w-4 h-4" />
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={() => handleDeleteQuote(quote.id)}
                              data-testid={`button-delete-quote-${quote.id}`}
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Bid Documents</CardTitle>
            </CardHeader>
            <CardContent>
              <FileUploadZone
                onFileSelect={(files) => console.log('Bid documents uploaded:', files)}
                accept=".pdf,.xlsx,.docx"
              />
            </CardContent>
          </Card>
        </div>
      </main>

      <Dialog open={showQuoteDialog} onOpenChange={setShowQuoteDialog}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editingQuote ? "Edit Quote" : "Add Subcontractor Quote"}</DialogTitle>
            <DialogDescription>
              {editingQuote ? "Update the subcontractor quote details" : "Add a new quote from a subcontractor"}
            </DialogDescription>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmitQuote)} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="subcontractorName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Subcontractor Name</FormLabel>
                      <FormControl>
                        <Input {...field} placeholder="ABC Construction" data-testid="input-subcontractor-name" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="quoteAmount"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Quote Amount</FormLabel>
                      <FormControl>
                        <Input {...field} type="number" step="0.01" placeholder="25000.00" data-testid="input-quote-amount" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <FormField
                control={form.control}
                name="scopeOfWork"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Scope of Work</FormLabel>
                    <FormControl>
                      <Textarea {...field} placeholder="Describe the work to be performed..." data-testid="input-scope-of-work" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="grid grid-cols-3 gap-4">
                <FormField
                  control={form.control}
                  name="contactName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Contact Name</FormLabel>
                      <FormControl>
                        <Input {...field} value={field.value || ""} placeholder="John Doe" data-testid="input-contact-name" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="contactEmail"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Contact Email</FormLabel>
                      <FormControl>
                        <Input {...field} value={field.value || ""} type="email" placeholder="john@abc.com" data-testid="input-contact-email" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="contactPhone"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Contact Phone</FormLabel>
                      <FormControl>
                        <Input {...field} value={field.value || ""} placeholder="(555) 123-4567" data-testid="input-contact-phone" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <FormField
                control={form.control}
                name="notes"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Notes (Optional)</FormLabel>
                    <FormControl>
                      <Textarea {...field} value={field.value || ""} placeholder="Additional notes..." data-testid="input-notes" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              
              <div className="space-y-2">
                <FormLabel>Quote Document (Optional)</FormLabel>
                <div className="flex items-center gap-3">
                  {uploadedFileData ? (
                    <div className="flex items-center gap-2 p-3 bg-muted rounded-md flex-1">
                      <FileText className="w-4 h-4 text-muted-foreground" />
                      <span className="text-sm font-medium flex-1 truncate">{uploadedFileData.fileName}</span>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => setUploadedFileData(null)}
                        data-testid="button-remove-file"
                      >
                        Remove
                      </Button>
                    </div>
                  ) : (
                    <ObjectUploader
                      maxNumberOfFiles={1}
                      maxFileSize={104857600}
                      allowedFileTypes={["application/pdf", "image/*", ".doc", ".docx", ".xls", ".xlsx"]}
                      onGetUploadParameters={getUploadParameters}
                      onComplete={(result) => {
                        setIsUploadingFile(true);
                        handleFileUploadComplete(result);
                      }}
                      buttonVariant="outline"
                      testId="button-upload-quote-document"
                    >
                      {isUploadingFile ? "Uploading..." : "Upload Document"}
                    </ObjectUploader>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  PDF, images, or Office documents (max 100MB)
                </p>
              </div>

              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setShowQuoteDialog(false)} data-testid="button-cancel">
                  Cancel
                </Button>
                <Button type="submit" disabled={createQuote.isPending || updateQuote.isPending} data-testid="button-submit-quote">
                  {createQuote.isPending || updateQuote.isPending ? "Saving..." : editingQuote ? "Update Quote" : "Add Quote"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
