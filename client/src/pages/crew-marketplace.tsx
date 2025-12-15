import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { 
  Users, Plus, MapPin, Star, DollarSign, Calendar, Building2,
  HardHat, Search, BarChart3, Trash2, Edit, Phone, Mail, Globe
} from "lucide-react";
import { format } from "date-fns";

interface CrewListing {
  listing: {
    id: string;
    organizationId: string;
    crewId: string | null;
    tradeType: string;
    crewName: string;
    crewSize: number | null;
    skillsSummary: string | null;
    certifications: string[] | null;
    hourlyRate: string | null;
    dailyRate: string | null;
    baseLocation: string | null;
    serviceRadius: number | null;
    availabilityStatus: string;
    availableFrom: string | null;
    availableTo: string | null;
    rating: string | null;
    completedProjects: number | null;
    contactName: string | null;
    contactPhone: string | null;
    contactEmail: string | null;
    isPublic: boolean;
    notes: string | null;
    createdAt: string;
  };
  crew: { id: string; name: string } | null;
}

interface TradeStats {
  tradeType: string;
  count: number;
  avgRating: string;
  avgHourlyRate: string;
}

const TRADE_TYPES = [
  "GENERAL_CONTRACTOR", "CONCRETE", "EARTHWORK", "ASPHALT_PAVING", "ROOFING",
  "ELECTRICAL", "PLUMBING", "HVAC", "CARPENTRY", "MASONRY", "DRYWALL",
  "PAINTING", "FLOORING", "LANDSCAPING", "DEMOLITION", "STEEL_ERECTION",
  "GLAZING", "INSULATION", "FIRE_PROTECTION", "LOW_VOLTAGE", "SOLAR", "WATERPROOFING", "OTHER"
];

export default function CrewMarketplacePage() {
  const { toast } = useToast();
  const [tradeFilter, setTradeFilter] = useState<string>("ALL");
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [locationSearch, setLocationSearch] = useState("");
  const [showOwnOnly, setShowOwnOnly] = useState(false);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [selectedListing, setSelectedListing] = useState<CrewListing | null>(null);
  const [activeTab, setActiveTab] = useState("browse");

  const { data: listings, isLoading } = useQuery<CrewListing[]>({
    queryKey: ["/api/marketplace/crew-listings", tradeFilter, statusFilter, locationSearch, showOwnOnly],
    queryFn: () => {
      const params = new URLSearchParams();
      if (tradeFilter !== "ALL") params.set("tradeType", tradeFilter);
      if (statusFilter !== "ALL") params.set("status", statusFilter);
      if (locationSearch) params.set("location", locationSearch);
      if (showOwnOnly) params.set("ownOnly", "true");
      const queryString = params.toString();
      return fetch(`/api/marketplace/crew-listings${queryString ? `?${queryString}` : ""}`, { credentials: "include" }).then(r => r.json());
    },
  });

  const { data: stats } = useQuery<TradeStats[]>({
    queryKey: ["/api/marketplace/crew-listings/stats/by-trade"],
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/marketplace/crew-listings/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/marketplace/crew-listings"], exact: false });
      toast({ title: "Listing deleted" });
      setSelectedListing(null);
    },
    onError: () => {
      toast({ title: "Failed to delete listing", variant: "destructive" });
    },
  });

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "AVAILABLE":
        return <Badge className="bg-green-600">Available</Badge>;
      case "PARTIALLY_AVAILABLE":
        return <Badge className="bg-yellow-500">Partially Available</Badge>;
      case "BUSY":
        return <Badge variant="secondary">Busy</Badge>;
      case "NOT_TAKING_WORK":
        return <Badge variant="outline">Not Taking Work</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const formatTrade = (trade: string) => {
    return trade.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
  };

  return (
    <div className="p-6 space-y-6" data-testid="page-crew-marketplace">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-page-title">Crew Marketplace</h1>
          <p className="text-muted-foreground">Find and list available crews</p>
        </div>
        <Button onClick={() => setShowCreateDialog(true)} data-testid="button-create-listing">
          <Plus className="h-4 w-4 mr-2" />
          List Your Crew
        </Button>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="browse" data-testid="tab-browse">Browse Crews</TabsTrigger>
          <TabsTrigger value="stats" data-testid="tab-stats">Market Stats</TabsTrigger>
        </TabsList>

        <TabsContent value="browse" className="space-y-4">
          <Card className="p-4">
            <div className="flex flex-wrap items-center gap-3">
              <Select value={tradeFilter} onValueChange={setTradeFilter}>
                <SelectTrigger className="w-[180px]" data-testid="select-trade-filter">
                  <SelectValue placeholder="Filter by trade" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All Trades</SelectItem>
                  {TRADE_TYPES.map((trade) => (
                    <SelectItem key={trade} value={trade}>{formatTrade(trade)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-[180px]" data-testid="select-status-filter">
                  <SelectValue placeholder="Filter by status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All Statuses</SelectItem>
                  <SelectItem value="AVAILABLE">Available</SelectItem>
                  <SelectItem value="PARTIALLY_AVAILABLE">Partially Available</SelectItem>
                  <SelectItem value="BUSY">Busy</SelectItem>
                </SelectContent>
              </Select>

              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  value={locationSearch}
                  onChange={(e) => setLocationSearch(e.target.value)}
                  placeholder="Search by location..."
                  className="pl-9 w-[200px]"
                  data-testid="input-location-search"
                />
              </div>

              <div className="flex items-center gap-2 ml-auto">
                <Switch
                  checked={showOwnOnly}
                  onCheckedChange={setShowOwnOnly}
                  data-testid="switch-own-only"
                />
                <Label className="text-sm">My Listings Only</Label>
              </div>
            </div>
          </Card>

          {isLoading ? (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {[1, 2, 3].map((i) => (
                <Card key={i}>
                  <CardHeader>
                    <Skeleton className="h-5 w-32" />
                    <Skeleton className="h-4 w-24" />
                  </CardHeader>
                  <CardContent>
                    <Skeleton className="h-20 w-full" />
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : listings && listings.length > 0 ? (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {listings.map((item) => (
                <Card 
                  key={item.listing.id}
                  className="cursor-pointer hover-elevate transition-all"
                  onClick={() => setSelectedListing(item)}
                  data-testid={`card-listing-${item.listing.id}`}
                >
                  <CardHeader className="pb-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <CardTitle className="text-base truncate flex items-center gap-2">
                          <HardHat className="h-4 w-4" />
                          {item.listing.crewName}
                        </CardTitle>
                        <CardDescription className="text-xs">
                          {formatTrade(item.listing.tradeType)}
                        </CardDescription>
                      </div>
                      {getStatusBadge(item.listing.availabilityStatus)}
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {item.listing.rating && (
                      <div className="flex items-center gap-1">
                        <Star className="h-4 w-4 fill-yellow-400 text-yellow-400" />
                        <span className="font-medium">{parseFloat(item.listing.rating).toFixed(1)}</span>
                        {item.listing.completedProjects && (
                          <span className="text-sm text-muted-foreground">
                            ({item.listing.completedProjects} projects)
                          </span>
                        )}
                      </div>
                    )}

                    <div className="flex items-center gap-4 text-sm">
                      {item.listing.crewSize && (
                        <div className="flex items-center gap-1 text-muted-foreground">
                          <Users className="h-3 w-3" />
                          {item.listing.crewSize} workers
                        </div>
                      )}
                      {item.listing.hourlyRate && (
                        <div className="flex items-center gap-1 text-muted-foreground">
                          <DollarSign className="h-3 w-3" />
                          ${parseFloat(item.listing.hourlyRate).toFixed(0)}/hr
                        </div>
                      )}
                    </div>

                    {item.listing.baseLocation && (
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <MapPin className="h-3 w-3" />
                        <span className="truncate">{item.listing.baseLocation}</span>
                        {item.listing.serviceRadius && (
                          <span>({item.listing.serviceRadius} mi radius)</span>
                        )}
                      </div>
                    )}

                    {item.listing.skillsSummary && (
                      <p className="text-sm text-muted-foreground line-clamp-2">
                        {item.listing.skillsSummary}
                      </p>
                    )}

                    {item.listing.certifications && item.listing.certifications.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {item.listing.certifications.slice(0, 3).map((cert, i) => (
                          <Badge key={i} variant="outline" className="text-xs">{cert}</Badge>
                        ))}
                        {item.listing.certifications.length > 3 && (
                          <Badge variant="outline" className="text-xs">+{item.listing.certifications.length - 3}</Badge>
                        )}
                      </div>
                    )}

                    {!item.listing.isPublic && (
                      <Badge variant="secondary" className="text-xs">Private</Badge>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (
            <Card className="p-12 text-center">
              <Users className="h-12 w-12 mx-auto text-muted-foreground/50 mb-4" />
              <h3 className="text-lg font-medium mb-2">No Crews Found</h3>
              <p className="text-muted-foreground mb-4">
                {showOwnOnly 
                  ? "You haven't listed any crews yet."
                  : "No crews match your search criteria."}
              </p>
              <Button onClick={() => setShowCreateDialog(true)} data-testid="button-create-first-listing">
                <Plus className="h-4 w-4 mr-2" />
                List Your Crew
              </Button>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="stats" className="space-y-4">
          {stats && stats.length > 0 ? (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {stats.map((stat) => (
                <Card key={stat.tradeType} data-testid={`card-stat-${stat.tradeType}`}>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base flex items-center gap-2">
                      <HardHat className="h-4 w-4" />
                      {formatTrade(stat.tradeType)}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-3 gap-4 text-center">
                      <div>
                        <div className="text-2xl font-bold text-primary">{stat.count}</div>
                        <div className="text-xs text-muted-foreground">Crews</div>
                      </div>
                      <div>
                        <div className="text-2xl font-bold flex items-center justify-center gap-1">
                          <Star className="h-4 w-4 fill-yellow-400 text-yellow-400" />
                          {stat.avgRating ? parseFloat(stat.avgRating).toFixed(1) : "N/A"}
                        </div>
                        <div className="text-xs text-muted-foreground">Avg Rating</div>
                      </div>
                      <div>
                        <div className="text-2xl font-bold">
                          ${stat.avgHourlyRate ? parseFloat(stat.avgHourlyRate).toFixed(0) : "N/A"}
                        </div>
                        <div className="text-xs text-muted-foreground">Avg Rate/hr</div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (
            <Card className="p-12 text-center">
              <BarChart3 className="h-12 w-12 mx-auto text-muted-foreground/50 mb-4" />
              <h3 className="text-lg font-medium mb-2">No Market Stats</h3>
              <p className="text-muted-foreground">
                Stats will appear when crews are listed publicly.
              </p>
            </Card>
          )}
        </TabsContent>
      </Tabs>

      <ListingDetailDialog 
        listing={selectedListing}
        onClose={() => setSelectedListing(null)}
        onDelete={(id) => deleteMutation.mutate(id)}
        isDeleting={deleteMutation.isPending}
        getStatusBadge={getStatusBadge}
        formatTrade={formatTrade}
      />

      <CreateListingDialog 
        open={showCreateDialog} 
        onOpenChange={setShowCreateDialog}
      />
    </div>
  );
}

function ListingDetailDialog({
  listing,
  onClose,
  onDelete,
  isDeleting,
  getStatusBadge,
  formatTrade,
}: {
  listing: CrewListing | null;
  onClose: () => void;
  onDelete: (id: string) => void;
  isDeleting: boolean;
  getStatusBadge: (s: string) => JSX.Element;
  formatTrade: (t: string) => string;
}) {
  if (!listing) return null;

  return (
    <Dialog open={!!listing} onOpenChange={() => onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <HardHat className="h-5 w-5" />
            {listing.listing.crewName}
          </DialogTitle>
          <DialogDescription>
            {formatTrade(listing.listing.tradeType)}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            {getStatusBadge(listing.listing.availabilityStatus)}
            {!listing.listing.isPublic && <Badge variant="secondary">Private</Badge>}
          </div>

          {listing.listing.rating && (
            <div className="flex items-center gap-2">
              <Star className="h-5 w-5 fill-yellow-400 text-yellow-400" />
              <span className="text-lg font-medium">{parseFloat(listing.listing.rating).toFixed(1)}</span>
              {listing.listing.completedProjects && (
                <span className="text-muted-foreground">
                  ({listing.listing.completedProjects} completed projects)
                </span>
              )}
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            {listing.listing.crewSize && (
              <div>
                <Label className="text-sm text-muted-foreground">Crew Size</Label>
                <p className="flex items-center gap-1">
                  <Users className="h-4 w-4" />
                  {listing.listing.crewSize} workers
                </p>
              </div>
            )}
            {listing.listing.hourlyRate && (
              <div>
                <Label className="text-sm text-muted-foreground">Hourly Rate</Label>
                <p className="flex items-center gap-1">
                  <DollarSign className="h-4 w-4" />
                  ${parseFloat(listing.listing.hourlyRate).toFixed(2)}/hr
                </p>
              </div>
            )}
            {listing.listing.dailyRate && (
              <div>
                <Label className="text-sm text-muted-foreground">Daily Rate</Label>
                <p className="flex items-center gap-1">
                  <DollarSign className="h-4 w-4" />
                  ${parseFloat(listing.listing.dailyRate).toFixed(2)}/day
                </p>
              </div>
            )}
            {listing.listing.baseLocation && (
              <div>
                <Label className="text-sm text-muted-foreground">Location</Label>
                <p className="flex items-center gap-1">
                  <MapPin className="h-4 w-4" />
                  {listing.listing.baseLocation}
                </p>
              </div>
            )}
          </div>

          {(listing.listing.availableFrom || listing.listing.availableTo) && (
            <div>
              <Label className="text-sm text-muted-foreground">Availability Window</Label>
              <p className="flex items-center gap-1">
                <Calendar className="h-4 w-4" />
                {listing.listing.availableFrom && format(new Date(listing.listing.availableFrom), "MMM d, yyyy")}
                {listing.listing.availableFrom && listing.listing.availableTo && " - "}
                {listing.listing.availableTo && format(new Date(listing.listing.availableTo), "MMM d, yyyy")}
              </p>
            </div>
          )}

          {listing.listing.skillsSummary && (
            <div>
              <Label className="text-sm text-muted-foreground">Skills & Experience</Label>
              <p className="text-sm p-3 bg-muted rounded-lg">{listing.listing.skillsSummary}</p>
            </div>
          )}

          {listing.listing.certifications && listing.listing.certifications.length > 0 && (
            <div>
              <Label className="text-sm text-muted-foreground">Certifications</Label>
              <div className="flex flex-wrap gap-2 mt-1">
                {listing.listing.certifications.map((cert, i) => (
                  <Badge key={i} variant="outline">{cert}</Badge>
                ))}
              </div>
            </div>
          )}

          <div className="border-t pt-4 space-y-2">
            <Label className="text-sm font-medium">Contact Information</Label>
            {listing.listing.contactName && (
              <p className="text-sm">{listing.listing.contactName}</p>
            )}
            {listing.listing.contactPhone && (
              <p className="flex items-center gap-2 text-sm">
                <Phone className="h-3 w-3" />
                {listing.listing.contactPhone}
              </p>
            )}
            {listing.listing.contactEmail && (
              <p className="flex items-center gap-2 text-sm">
                <Mail className="h-3 w-3" />
                {listing.listing.contactEmail}
              </p>
            )}
          </div>

          {listing.listing.notes && (
            <div>
              <Label className="text-sm text-muted-foreground">Notes</Label>
              <p className="text-sm p-3 bg-muted rounded-lg">{listing.listing.notes}</p>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button
            variant="destructive"
            onClick={() => onDelete(listing.listing.id)}
            disabled={isDeleting}
            data-testid="button-delete-listing"
          >
            <Trash2 className="h-4 w-4 mr-2" />
            Delete
          </Button>
          <Button variant="outline" onClick={onClose} data-testid="button-close-dialog">
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CreateListingDialog({ 
  open, 
  onOpenChange 
}: { 
  open: boolean; 
  onOpenChange: (open: boolean) => void;
}) {
  const { toast } = useToast();
  const [crewName, setCrewName] = useState("");
  const [tradeType, setTradeType] = useState("OTHER");
  const [crewSize, setCrewSize] = useState("");
  const [skillsSummary, setSkillsSummary] = useState("");
  const [hourlyRate, setHourlyRate] = useState("");
  const [dailyRate, setDailyRate] = useState("");
  const [baseLocation, setBaseLocation] = useState("");
  const [serviceRadius, setServiceRadius] = useState("");
  const [availabilityStatus, setAvailabilityStatus] = useState("AVAILABLE");
  const [availableFrom, setAvailableFrom] = useState("");
  const [availableTo, setAvailableTo] = useState("");
  const [contactName, setContactName] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [isPublic, setIsPublic] = useState(true);
  const [notes, setNotes] = useState("");

  const createMutation = useMutation({
    mutationFn: (data: any) => apiRequest("POST", "/api/marketplace/crew-listings", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/marketplace/crew-listings"], exact: false });
      toast({ title: "Crew listing created" });
      onOpenChange(false);
      resetForm();
    },
    onError: () => {
      toast({ title: "Failed to create listing", variant: "destructive" });
    },
  });

  const resetForm = () => {
    setCrewName("");
    setTradeType("OTHER");
    setCrewSize("");
    setSkillsSummary("");
    setHourlyRate("");
    setDailyRate("");
    setBaseLocation("");
    setServiceRadius("");
    setAvailabilityStatus("AVAILABLE");
    setAvailableFrom("");
    setAvailableTo("");
    setContactName("");
    setContactPhone("");
    setContactEmail("");
    setIsPublic(true);
    setNotes("");
  };

  const handleSubmit = () => {
    if (!crewName.trim()) {
      toast({ title: "Crew name is required", variant: "destructive" });
      return;
    }
    createMutation.mutate({
      crewName,
      tradeType,
      crewSize: crewSize ? parseInt(crewSize) : undefined,
      skillsSummary: skillsSummary || undefined,
      hourlyRate: hourlyRate || undefined,
      dailyRate: dailyRate || undefined,
      baseLocation: baseLocation || undefined,
      serviceRadius: serviceRadius ? parseInt(serviceRadius) : undefined,
      availabilityStatus,
      availableFrom: availableFrom || undefined,
      availableTo: availableTo || undefined,
      contactName: contactName || undefined,
      contactPhone: contactPhone || undefined,
      contactEmail: contactEmail || undefined,
      isPublic,
      notes: notes || undefined,
    });
  };

  const formatTrade = (trade: string) => {
    return trade.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh]">
        <DialogHeader>
          <DialogTitle>List Your Crew</DialogTitle>
          <DialogDescription>
            Make your crew available for hire on the marketplace.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-2">
          <div className="space-y-2">
            <Label>Crew Name *</Label>
            <Input
              value={crewName}
              onChange={(e) => setCrewName(e.target.value)}
              placeholder="e.g., Smith Concrete Crew"
              data-testid="input-crew-name"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Trade Type</Label>
              <Select value={tradeType} onValueChange={setTradeType}>
                <SelectTrigger data-testid="select-trade">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TRADE_TYPES.map((trade) => (
                    <SelectItem key={trade} value={trade}>{formatTrade(trade)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Crew Size</Label>
              <Input
                type="number"
                value={crewSize}
                onChange={(e) => setCrewSize(e.target.value)}
                placeholder="# of workers"
                data-testid="input-crew-size"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Skills & Experience</Label>
            <Textarea
              value={skillsSummary}
              onChange={(e) => setSkillsSummary(e.target.value)}
              placeholder="Describe your crew's skills, specialties, and experience..."
              rows={3}
              data-testid="input-skills"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Hourly Rate</Label>
              <div className="relative">
                <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  type="number"
                  step="0.01"
                  value={hourlyRate}
                  onChange={(e) => setHourlyRate(e.target.value)}
                  placeholder="0.00"
                  className="pl-8"
                  data-testid="input-hourly-rate"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Daily Rate</Label>
              <div className="relative">
                <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  type="number"
                  step="0.01"
                  value={dailyRate}
                  onChange={(e) => setDailyRate(e.target.value)}
                  placeholder="0.00"
                  className="pl-8"
                  data-testid="input-daily-rate"
                />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Base Location</Label>
              <Input
                value={baseLocation}
                onChange={(e) => setBaseLocation(e.target.value)}
                placeholder="City, State"
                data-testid="input-location"
              />
            </div>
            <div className="space-y-2">
              <Label>Service Radius (miles)</Label>
              <Input
                type="number"
                value={serviceRadius}
                onChange={(e) => setServiceRadius(e.target.value)}
                placeholder="50"
                data-testid="input-radius"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Availability Status</Label>
            <Select value={availabilityStatus} onValueChange={setAvailabilityStatus}>
              <SelectTrigger data-testid="select-availability">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="AVAILABLE">Available</SelectItem>
                <SelectItem value="PARTIALLY_AVAILABLE">Partially Available</SelectItem>
                <SelectItem value="BUSY">Busy</SelectItem>
                <SelectItem value="NOT_TAKING_WORK">Not Taking Work</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Available From</Label>
              <Input
                type="date"
                value={availableFrom}
                onChange={(e) => setAvailableFrom(e.target.value)}
                data-testid="input-available-from"
              />
            </div>
            <div className="space-y-2">
              <Label>Available To</Label>
              <Input
                type="date"
                value={availableTo}
                onChange={(e) => setAvailableTo(e.target.value)}
                data-testid="input-available-to"
              />
            </div>
          </div>

          <div className="border-t pt-4 space-y-4">
            <Label className="text-sm font-medium">Contact Information</Label>
            <div className="space-y-2">
              <Label>Contact Name</Label>
              <Input
                value={contactName}
                onChange={(e) => setContactName(e.target.value)}
                placeholder="John Smith"
                data-testid="input-contact-name"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Phone</Label>
                <Input
                  value={contactPhone}
                  onChange={(e) => setContactPhone(e.target.value)}
                  placeholder="(555) 123-4567"
                  data-testid="input-contact-phone"
                />
              </div>
              <div className="space-y-2">
                <Label>Email</Label>
                <Input
                  value={contactEmail}
                  onChange={(e) => setContactEmail(e.target.value)}
                  placeholder="email@example.com"
                  data-testid="input-contact-email"
                />
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Switch
              checked={isPublic}
              onCheckedChange={setIsPublic}
              data-testid="switch-public"
            />
            <Label>Make listing visible to other organizations</Label>
          </div>

          <div className="space-y-2">
            <Label>Notes</Label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Additional information..."
              rows={2}
              data-testid="input-notes"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={createMutation.isPending} data-testid="button-submit-listing">
            {createMutation.isPending ? "Creating..." : "Create Listing"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
