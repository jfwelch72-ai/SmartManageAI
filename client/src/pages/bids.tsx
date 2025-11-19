import { useState, useMemo } from "react";
import AppHeader from "@/components/AppHeader";
import BidCard from "@/components/BidCard";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Search, Plus, AlertTriangle } from "lucide-react";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { useBids, useConvertBidToProject } from "@/hooks/use-data";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
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

export default function BidsPage() {
  const [, setLocation] = useLocation();
  const { user, logout } = useAuth();
  const { toast } = useToast();
  const [searchTerm, setSearchTerm] = useState("");
  const [showBudgetWarning, setShowBudgetWarning] = useState(false);
  const [pendingConversionBidCode, setPendingConversionBidCode] = useState<string | null>(null);
  
  const { data: bids = [], isLoading } = useBids();
  const convertBid = useConvertBidToProject();

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
          <Button data-testid="button-new-bid">
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
    </div>
  );
}
