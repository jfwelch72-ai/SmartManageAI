import AppHeader from "@/components/AppHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import FileUploadZone from "@/components/FileUploadZone";
import { Building2, MapPin, Mail, Phone, Calendar, DollarSign } from "lucide-react";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";

//todo: remove mock functionality
const mockBid = {
  code: "BID-240815",
  name: "City Hall Renovation - Phase 2",
  clientName: "City of Columbus",
  clientContact: "James Martinez",
  clientEmail: "j.martinez@columbus.gov",
  clientPhone: "(614) 645-8000",
  bidAmount: "$625,000",
  dueDate: "2024-02-15",
  location: "90 W Broad St, Columbus, OH 43215",
  estimator: "Sarah Williams",
  description: "Concrete foundation work for the second phase of City Hall renovation including basement slab, footings, and foundation walls.",
};

export default function BidDetailPage() {
  const [, setLocation] = useLocation();
  const { user, logout } = useAuth();

  const handleMarkAsAwarded = () => {
    if (confirm(`Mark bid ${mockBid.code} as awarded and convert to active project?`)) {
      console.log('Converting to project');
      alert('Bid has been awarded and moved to Active Projects!');
      setLocation('/projects');
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
        <div className="mb-6">
          <Button variant="ghost" onClick={() => setLocation('/bids')} data-testid="button-back">
            ← Back to Bid Board
          </Button>
        </div>

        <div className="flex items-start justify-between gap-4 flex-wrap mb-6">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <Badge variant="outline" className="font-mono">
                {mockBid.code}
              </Badge>
              <Badge className="bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300">
                BID IN PROGRESS
              </Badge>
            </div>
            <h1 className="text-2xl font-bold text-foreground mb-2">{mockBid.name}</h1>
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
                    <p className="text-lg font-bold font-mono">{mockBid.bidAmount}</p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <Calendar className="w-5 h-5 text-muted-foreground mt-0.5" />
                  <div>
                    <p className="text-sm font-medium">Due Date</p>
                    <p className="text-sm text-muted-foreground">{mockBid.dueDate}</p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <Building2 className="w-5 h-5 text-muted-foreground mt-0.5" />
                  <div>
                    <p className="text-sm font-medium">Client</p>
                    <p className="text-sm text-muted-foreground">{mockBid.clientName}</p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <Mail className="w-5 h-5 text-muted-foreground mt-0.5" />
                  <div>
                    <p className="text-sm font-medium">Contact Email</p>
                    <p className="text-sm text-muted-foreground">{mockBid.clientEmail}</p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <Phone className="w-5 h-5 text-muted-foreground mt-0.5" />
                  <div>
                    <p className="text-sm font-medium">Contact Phone</p>
                    <p className="text-sm text-muted-foreground">{mockBid.clientPhone}</p>
                  </div>
                </div>
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
                    <p className="text-sm text-muted-foreground">{mockBid.location}</p>
                  </div>
                </div>
                <div>
                  <p className="text-sm font-medium mb-1">Estimator</p>
                  <p className="text-sm text-muted-foreground">{mockBid.estimator}</p>
                </div>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Description</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">{mockBid.description}</p>
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
    </div>
  );
}
