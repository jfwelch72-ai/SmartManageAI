import { useState } from "react";
import AppHeader from "@/components/AppHeader";
import BidCard from "@/components/BidCard";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Search, Plus } from "lucide-react";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";

//todo: remove mock functionality
const mockBids = [
  {
    id: '1',
    code: 'BID-240815',
    name: 'City Hall Renovation - Phase 2',
    clientName: 'City of Columbus',
    bidAmount: '$625,000',
    dueDate: '2024-02-15',
    location: 'Columbus, OH',
    estimator: 'Sarah Williams',
  },
  {
    id: '2',
    code: 'BID-240722',
    name: 'Shopping Plaza Foundation',
    clientName: 'Retail Development Corp',
    bidAmount: '$380,000',
    dueDate: '2024-02-20',
    location: 'Dublin, OH',
    estimator: 'David Chen',
  },
  {
    id: '3',
    code: 'BID-240701',
    name: 'Medical Office Building',
    clientName: 'Healthcare Properties Inc',
    bidAmount: '$890,000',
    dueDate: '2024-02-28',
    location: 'Westerville, OH',
    estimator: 'Sarah Williams',
  },
  {
    id: '4',
    code: 'BID-240628',
    name: 'University Parking Garage Expansion',
    clientName: 'Ohio University',
    bidAmount: '$1,250,000',
    dueDate: '2024-03-05',
    location: 'Athens, OH',
    estimator: 'David Chen',
  },
];

export default function BidsPage() {
  const [, setLocation] = useLocation();
  const { user, logout } = useAuth();
  const [searchTerm, setSearchTerm] = useState("");

  const filteredBids = mockBids.filter(bid => 
    bid.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    bid.code.toLowerCase().includes(searchTerm.toLowerCase()) ||
    bid.clientName.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const handleConvertToProject = (bidCode: string) => {
    console.log(`Converting bid ${bidCode} to project`);
    // TODO: Implement actual conversion logic
    alert(`Bid ${bidCode} has been marked as awarded and moved to Active Projects!`);
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

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredBids.map((bid) => (
            <BidCard
              key={bid.id}
              {...bid}
              onClick={() => setLocation(`/bids/${bid.code}`)}
              onConvertToProject={() => handleConvertToProject(bid.code)}
            />
          ))}
        </div>
      </main>
    </div>
  );
}
