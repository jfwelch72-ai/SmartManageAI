import { useState, useMemo } from "react";
import AppHeader from "@/components/AppHeader";
import BidCard from "@/components/BidCard";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Search, Plus, AlertTriangle } from "lucide-react";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { useBids, useConvertBidToProject, useCreateBid } from "@/hooks/use-data";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import type { Bid } from "@shared/schema";
import { insertBidSchema } from "@shared/schema";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import type { z } from "zod";

// Extended bid type with estimate summary
type BidWithEstimate = Bid & {
  estimateSummary: {
    totalCost: number;
    lineItemCount: number;
    status: string;
  } | null;
};
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Textarea } from "@/components/ui/textarea";

type CreateBidInput = z.infer<typeof insertBidSchema>;

export default function BidsPage() {
  const [, setLocation] = useLocation();
  const { user, logout } = useAuth();
  const { toast } = useToast();
  const [searchTerm, setSearchTerm] = useState("");
  const [showBudgetWarning, setShowBudgetWarning] = useState(false);
  const [pendingConversionBidCode, setPendingConversionBidCode] = useState<string | null>(null);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  
  const { data: bidsData = [], isLoading } = useBids();
  const convertBid = useConvertBidToProject();
  const createBid = useCreateBid();
  
  // Cast to extended type with estimate summary
  const bids = bidsData as BidWithEstimate[];

  const form = useForm<CreateBidInput>({
    resolver: zodResolver(insertBidSchema),
    defaultValues: {
      name: "",
      code: "",
      clientName: "",
      clientContactName: "",
      clientContactEmail: "",
      clientContactPhone: "",
      bidAmount: "",
      dueDate: undefined,
      locationAddress: "",
      city: "",
      state: "",
      description: "",
      estimatorId: user?.id || undefined,
    },
  });

  const filteredBids = useMemo(() => {
    return bids.filter(bid => 
      bid.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      bid.code.toLowerCase().includes(searchTerm.toLowerCase()) ||
      bid.clientName.toLowerCase().includes(searchTerm.toLowerCase())
    );
  }, [bids, searchTerm]);

  const handleConvertToProject = async (bidCode: string) => {
    // Check if bid has budget data
    const bid = bids.find(b => b.code === bidCode);
    if (bid && (!bid.bidAmount || parseFloat(bid.bidAmount) === 0)) {
      // Show warning dialog for missing budget
      setPendingConversionBidCode(bidCode);
      setShowBudgetWarning(true);
      return;
    }

    // Proceed with conversion
    await performConversion(bidCode);
  };

  const performConversion = async (bidCode: string) => {
    try {
      await convertBid.mutateAsync(bidCode);
      toast({
        title: "Success",
        description: `Bid ${bidCode} has been converted to an active project!`,
      });
      setLocation("/projects");
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to convert bid to project",
        variant: "destructive",
      });
    }
  };

  const handleCreateBid = async (data: CreateBidInput) => {
    try {
      // Clean up empty string values to undefined for optional fields
      const cleanedData = {
        ...data,
        clientContactName: data.clientContactName || undefined,
        clientContactEmail: data.clientContactEmail || undefined,
        clientContactPhone: data.clientContactPhone || undefined,
        bidAmount: data.bidAmount || undefined,
        locationAddress: data.locationAddress || undefined,
        city: data.city || undefined,
        state: data.state || undefined,
        description: data.description || undefined,
        estimatorId: data.estimatorId || undefined,
      };

      const newBid = await createBid.mutateAsync(cleanedData);
      toast({
        title: "Success",
        description: `Bid ${data.code} has been created successfully!`,
      });
      setShowCreateDialog(false);
      form.reset();
      // Navigate to the new bid detail page
      setLocation(`/bids/${data.code}`);
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to create bid",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <AppHeader
        userName={`${user?.firstName || ""} ${user?.lastName || ""}`.trim() || "User"}
        userRole={user?.role || ""}
        onLogout={logout}
      />
      
      <main className="mx-auto max-w-7xl px-6 py-8">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-foreground mb-1">Bid Board</h1>
            <p className="text-sm text-muted-foreground">
              Track opportunities and bids in progress
            </p>
          </div>
          <Button onClick={() => setShowCreateDialog(true)} data-testid="button-new-bid">
            <Plus className="w-4 h-4 mr-2" />
            New Bid
          </Button>
        </div>

        <div className="mb-6">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search bids by name, code, or client..."
              className="pl-9"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              data-testid="input-search-bids"
            />
          </div>
        </div>

        {isLoading ? (
          <div className="text-center py-12 text-muted-foreground">
            Loading bids...
          </div>
        ) : filteredBids.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            {searchTerm ? "No bids match your search" : "No bids found"}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredBids.map((bid) => (
              <BidCard
                key={bid.id}
                code={bid.code}
                name={bid.name}
                clientName={bid.clientName}
                bidAmount={bid.bidAmount ? `$${Number(bid.bidAmount).toLocaleString()}` : "TBD"}
                dueDate={bid.dueDate ? format(new Date(bid.dueDate), 'yyyy-MM-dd') : undefined}
                location={[bid.city, bid.state].filter(Boolean).join(', ') || bid.locationAddress || undefined}
                estimator={bid.estimatorId || ""}
                onClick={() => setLocation(`/bids/${bid.code}`)}
                onConvertToProject={() => handleConvertToProject(bid.code)}
                estimateData={bid.estimateSummary}
              />
            ))}
          </div>
        )}
      </main>

      {/* Budget Warning Dialog */}
      <AlertDialog open={showBudgetWarning} onOpenChange={setShowBudgetWarning}>
        <AlertDialogContent data-testid="dialog-budget-warning">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-yellow-500" />
              Missing Budget Data
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-2">
              <p>
                This bid does not have a bid amount entered. Converting to a project without budget data will:
              </p>
              <ul className="list-disc list-inside space-y-1 text-sm">
                <li>Prevent accurate profitability tracking</li>
                <li>Limit AI analysis capabilities</li>
                <li>Reduce data quality score</li>
                <li>Make financial reporting incomplete</li>
              </ul>
              <p className="mt-3 font-medium">
                Are you sure you want to proceed without budget data?
              </p>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-conversion">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                if (pendingConversionBidCode) {
                  await performConversion(pendingConversionBidCode);
                  setPendingConversionBidCode(null);
                }
                setShowBudgetWarning(false);
              }}
              data-testid="button-confirm-conversion"
              className="bg-yellow-600 hover:bg-yellow-700"
            >
              Proceed Anyway
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Create Bid Dialog */}
      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto" data-testid="dialog-create-bid">
          <DialogHeader>
            <DialogTitle>Create New Bid</DialogTitle>
            <DialogDescription>
              Enter the basic information for the new bid opportunity.
            </DialogDescription>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(handleCreateBid)} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem className="col-span-2">
                      <FormLabel>Bid Name *</FormLabel>
                      <FormControl>
                        <Input placeholder="e.g., Downtown Office Renovation" {...field} data-testid="input-bid-name" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="code"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Bid Code *</FormLabel>
                      <FormControl>
                        <Input placeholder="e.g., BID-2025-001" {...field} data-testid="input-bid-code" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="dueDate"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Due Date</FormLabel>
                      <FormControl>
                        <Input
                          type="date"
                          {...field}
                          value={field.value instanceof Date ? field.value.toISOString().split('T')[0] : field.value || ""}
                          onChange={(e) => field.onChange(e.target.value ? new Date(e.target.value) : undefined)}
                          data-testid="input-bid-due-date"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="clientName"
                  render={({ field }) => (
                    <FormItem className="col-span-2">
                      <FormLabel>Client Name *</FormLabel>
                      <FormControl>
                        <Input placeholder="e.g., ABC Corporation" {...field} data-testid="input-client-name" />
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
                        <Input placeholder="e.g., John Smith" {...field} value={field.value || ""} data-testid="input-contact-name" />
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
                        <Input type="email" placeholder="john@example.com" {...field} value={field.value || ""} data-testid="input-contact-email" />
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
                        <Input placeholder="(555) 123-4567" {...field} value={field.value || ""} data-testid="input-contact-phone" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="bidAmount"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Bid Amount</FormLabel>
                      <FormControl>
                        <Input type="number" step="0.01" placeholder="0.00" {...field} value={field.value || ""} data-testid="input-bid-amount" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="locationAddress"
                  render={({ field }) => (
                    <FormItem className="col-span-2">
                      <FormLabel>Location Address</FormLabel>
                      <FormControl>
                        <Input placeholder="123 Main St" {...field} value={field.value || ""} data-testid="input-location-address" />
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
                        <Input placeholder="e.g., Seattle" {...field} value={field.value || ""} data-testid="input-city" />
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
                        <Input placeholder="e.g., WA" {...field} value={field.value || ""} data-testid="input-state" />
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
                        <Textarea
                          placeholder="Brief description of the project scope..."
                          className="min-h-[100px]"
                          {...field}
                          value={field.value || ""}
                          data-testid="input-description"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setShowCreateDialog(false)} data-testid="button-cancel-create">
                  Cancel
                </Button>
                <Button type="submit" disabled={createBid.isPending} data-testid="button-submit-create">
                  {createBid.isPending ? "Creating..." : "Create Bid"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
