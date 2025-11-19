import AppHeader from "@/components/AppHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import FileUploadZone from "@/components/FileUploadZone";
import { Building2, MapPin, Mail, Phone, Calendar, DollarSign } from "lucide-react";
import { useLocation, useRoute } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { useBid, useConvertBidToProject } from "@/hooks/use-data";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";

export default function BidDetailPage() {
  const [, setLocation] = useLocation();
  const [, params] = useRoute("/bids/:code");
  const { user, logout } = useAuth();
  const { toast } = useToast();
  
  const bidCode = params?.code || "";
  const { data: bid, isLoading } = useBid(bidCode);
  const convertBid = useConvertBidToProject();

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
    </div>
  );
}
