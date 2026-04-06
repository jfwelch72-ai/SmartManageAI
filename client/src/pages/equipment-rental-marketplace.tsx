import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import {
  Truck,
  Plus,
  MapPin,
  DollarSign,
  Calendar,
  Building2,
  Search,
  Trash2,
  Edit,
  CheckCircle,
  XCircle,
  Clock,
  Package,
  ChevronRight,
  Image as ImageIcon,
} from "lucide-react";

const EQUIPMENT_CATEGORIES = [
  "Excavation",
  "Lifting",
  "Concrete",
  "Compaction",
  "Aerial",
  "Power",
  "Scaffolding",
  "Other",
];
const CONDITIONS = ["Excellent", "Good", "Fair"];

interface EquipmentListing {
  id: string;
  organizationId: string;
  name: string;
  category: string;
  makeModel: string | null;
  year: number | null;
  dailyRate: string | null;
  weeklyRate: string | null;
  monthlyRate: string | null;
  depositAmount: string | null;
  location: string | null;
  deliveryRadius: number | null;
  photos: string[] | null;
  condition: string | null;
  availableFrom: string | null;
  availableTo: string | null;
  isOngoing: boolean;
  description: string | null;
  isActive: boolean;
  createdAt: string;
}

interface ListingWithOrg {
  listing: EquipmentListing;
  ownerOrg: { id: string; name: string } | null;
}

interface RentalRequest {
  id: string;
  listingId: string;
  requesterOrgId: string;
  startDate: string;
  endDate: string;
  deliveryRequested: boolean;
  message: string | null;
  status: "PENDING" | "ACCEPTED" | "DECLINED";
  ownerResponse: string | null;
  createdAt: string;
}

interface RequestWithOrg {
  request: RentalRequest;
  requesterOrg?: { id: string; name: string } | null;
  listing?: {
    id: string;
    name: string;
    category: string;
    dailyRate: string | null;
    location: string | null;
    organizationId: string;
  } | null;
  ownerOrg?: { id: string; name: string } | null;
}

function formatRate(rate: string | null, period: string) {
  if (!rate) return null;
  return `$${parseFloat(rate).toLocaleString()}/${period}`;
}

function StatusBadge({ status }: { status: string }) {
  if (status === "ACCEPTED")
    return (
      <Badge className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-100">
        Accepted
      </Badge>
    );
  if (status === "DECLINED")
    return (
      <Badge className="bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-100">
        Declined
      </Badge>
    );
  return (
    <Badge className="bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-100">
      Pending
    </Badge>
  );
}

function ListingCard({
  item,
  onRequestRental,
  isOwn,
}: {
  item: ListingWithOrg;
  onRequestRental?: () => void;
  isOwn?: boolean;
}) {
  const { listing, ownerOrg } = item;
  const photo =
    listing.photos && listing.photos.length > 0 ? listing.photos[0] : null;

  return (
    <Card
      className="flex flex-col"
      data-testid={`card-equipment-listing-${listing.id}`}
    >
      <div className="relative h-40 bg-muted rounded-t-lg overflow-hidden">
        {photo ? (
          <img
            src={photo}
            alt={listing.name}
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-muted-foreground">
            <Truck className="h-10 w-10 opacity-30" />
          </div>
        )}
        <Badge className="absolute top-2 right-2 bg-white/90 dark:bg-black/70 text-foreground">
          {listing.category}
        </Badge>
      </div>
      <CardContent className="flex flex-col flex-1 gap-2 pt-4">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h3
              className="font-semibold text-base leading-tight"
              data-testid={`text-listing-name-${listing.id}`}
            >
              {listing.name}
            </h3>
            {listing.makeModel && (
              <p className="text-sm text-muted-foreground">
                {listing.makeModel}
                {listing.year ? ` • ${listing.year}` : ""}
              </p>
            )}
          </div>
          {listing.condition && (
            <Badge variant="outline" className="shrink-0 text-xs">
              {listing.condition}
            </Badge>
          )}
        </div>

        {listing.location && (
          <div className="flex items-center gap-1 text-sm text-muted-foreground">
            <MapPin className="h-3.5 w-3.5" />
            <span data-testid={`text-listing-location-${listing.id}`}>
              {listing.location}
            </span>
            {listing.deliveryRadius && (
              <span>• {listing.deliveryRadius}mi delivery</span>
            )}
          </div>
        )}

        <div className="flex flex-wrap gap-2 text-sm">
          {listing.dailyRate && (
            <span
              className="font-medium text-primary"
              data-testid={`text-daily-rate-${listing.id}`}
            >
              {formatRate(listing.dailyRate, "day")}
            </span>
          )}
          {listing.weeklyRate && (
            <span className="text-muted-foreground">
              {formatRate(listing.weeklyRate, "wk")}
            </span>
          )}
          {listing.monthlyRate && (
            <span className="text-muted-foreground">
              {formatRate(listing.monthlyRate, "mo")}
            </span>
          )}
        </div>

        {listing.isOngoing ? (
          <p className="text-xs text-muted-foreground">Availability: Ongoing</p>
        ) : (
          listing.availableFrom && (
            <p className="text-xs text-muted-foreground">
              Available: {listing.availableFrom}
              {listing.availableTo ? ` — ${listing.availableTo}` : ""}
            </p>
          )
        )}

        {ownerOrg && (
          <div className="flex items-center gap-1 text-xs text-muted-foreground mt-auto pt-1 border-t">
            <Building2 className="h-3 w-3" />
            <span>{ownerOrg.name}</span>
          </div>
        )}

        {!isOwn && onRequestRental && (
          <Button
            onClick={onRequestRental}
            className="mt-2 w-full"
            size="sm"
            data-testid={`button-request-rental-${listing.id}`}
          >
            Request Rental
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

export default function EquipmentRentalMarketplacePage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState("browse");
  const [categoryFilter, setCategoryFilter] = useState("ALL");
  const [locationSearch, setLocationSearch] = useState("");
  const [minRate, setMinRate] = useState("");
  const [maxRate, setMaxRate] = useState("");

  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [editingListing, setEditingListing] = useState<EquipmentListing | null>(
    null,
  );
  const [requestListing, setRequestListing] = useState<ListingWithOrg | null>(
    null,
  );
  const [respondingRequest, setRespondingRequest] =
    useState<RequestWithOrg | null>(null);
  const [selectedMyListing, setSelectedMyListing] =
    useState<ListingWithOrg | null>(null);

  const [createForm, setCreateForm] = useState({
    name: "",
    category: "",
    makeModel: "",
    year: "",
    dailyRate: "",
    weeklyRate: "",
    monthlyRate: "",
    depositAmount: "",
    location: "",
    deliveryRadius: "",
    photos: "",
    condition: "",
    availableFrom: "",
    availableTo: "",
    isOngoing: false,
    description: "",
  });

  const [requestForm, setRequestForm] = useState({
    startDate: "",
    endDate: "",
    deliveryRequested: false,
    message: "",
  });

  const [respondForm, setRespondForm] = useState({
    status: "" as "ACCEPTED" | "DECLINED" | "",
    ownerResponse: "",
  });

  const { data: browseListings, isLoading: isBrowseLoading } = useQuery<
    ListingWithOrg[]
  >({
    queryKey: [
      "/api/marketplace/equipment",
      categoryFilter,
      locationSearch,
      minRate,
      maxRate,
    ],
    queryFn: () => {
      const params = new URLSearchParams();
      if (categoryFilter !== "ALL") params.set("category", categoryFilter);
      if (locationSearch) params.set("location", locationSearch);
      if (minRate) params.set("minRate", minRate);
      if (maxRate) params.set("maxRate", maxRate);
      const qs = params.toString();
      return fetch(`/api/marketplace/equipment${qs ? `?${qs}` : ""}`, {
        credentials: "include",
      }).then((r) => r.json());
    },
  });

  const { data: myListings, isLoading: isMyListingsLoading } = useQuery<
    ListingWithOrg[]
  >({
    queryKey: ["/api/marketplace/equipment/my"],
    enabled: activeTab === "my-listings",
  });

  const { data: myRequests, isLoading: isMyRequestsLoading } = useQuery<
    RequestWithOrg[]
  >({
    queryKey: ["/api/marketplace/equipment/requests/my"],
    enabled: activeTab === "my-requests",
    queryFn: () =>
      fetch("/api/marketplace/equipment/requests/my", {
        credentials: "include",
      }).then((r) => r.json()),
  });

  const { data: listingRequests, isLoading: isListingRequestsLoading } =
    useQuery<RequestWithOrg[]>({
      queryKey: [
        "/api/marketplace/equipment",
        selectedMyListing?.listing.id,
        "requests",
      ],
      enabled: !!selectedMyListing,
      queryFn: () =>
        fetch(
          `/api/marketplace/equipment/${selectedMyListing!.listing.id}/requests`,
          { credentials: "include" },
        ).then((r) => r.json()),
    });

  const createMutation = useMutation({
    mutationFn: (data: Record<string, any>) =>
      apiRequest("POST", "/api/marketplace/equipment", data),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["/api/marketplace/equipment"],
        exact: false,
      });
      toast({ title: "Listing created successfully" });
      setShowCreateDialog(false);
      resetCreateForm();
    },
    onError: () =>
      toast({ title: "Failed to create listing", variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, any> }) =>
      apiRequest("PATCH", `/api/marketplace/equipment/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["/api/marketplace/equipment"],
        exact: false,
      });
      toast({ title: "Listing updated" });
      setEditingListing(null);
    },
    onError: () =>
      toast({ title: "Failed to update listing", variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) =>
      apiRequest("DELETE", `/api/marketplace/equipment/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["/api/marketplace/equipment"],
        exact: false,
      });
      toast({ title: "Listing deleted" });
      setSelectedMyListing(null);
    },
    onError: () =>
      toast({ title: "Failed to delete listing", variant: "destructive" }),
  });

  const requestMutation = useMutation({
    mutationFn: ({
      listingId,
      data,
    }: {
      listingId: string;
      data: Record<string, any>;
    }) =>
      apiRequest(
        "POST",
        `/api/marketplace/equipment/${listingId}/requests`,
        data,
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["/api/marketplace/equipment/requests/my"],
      });
      toast({ title: "Rental request submitted" });
      setRequestListing(null);
      setRequestForm({
        startDate: "",
        endDate: "",
        deliveryRequested: false,
        message: "",
      });
    },
    onError: () =>
      toast({ title: "Failed to submit request", variant: "destructive" }),
  });

  const respondMutation = useMutation({
    mutationFn: ({
      listingId,
      reqId,
      data,
    }: {
      listingId: string;
      reqId: string;
      data: Record<string, any>;
    }) =>
      apiRequest(
        "PATCH",
        `/api/marketplace/equipment/${listingId}/requests/${reqId}`,
        data,
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: [
          "/api/marketplace/equipment",
          selectedMyListing?.listing.id,
          "requests",
        ],
      });
      toast({ title: "Response sent" });
      setRespondingRequest(null);
      setRespondForm({ status: "", ownerResponse: "" });
    },
    onError: () =>
      toast({ title: "Failed to send response", variant: "destructive" }),
  });

  function resetCreateForm() {
    setCreateForm({
      name: "",
      category: "",
      makeModel: "",
      year: "",
      dailyRate: "",
      weeklyRate: "",
      monthlyRate: "",
      depositAmount: "",
      location: "",
      deliveryRadius: "",
      photos: "",
      condition: "",
      availableFrom: "",
      availableTo: "",
      isOngoing: false,
      description: "",
    });
  }

  function handleCreateSubmit() {
    const data: Record<string, any> = {
      name: createForm.name,
      category: createForm.category,
      isOngoing: createForm.isOngoing,
    };
    if (createForm.makeModel) data.makeModel = createForm.makeModel;
    if (createForm.year) data.year = parseInt(createForm.year);
    if (createForm.dailyRate) data.dailyRate = createForm.dailyRate;
    if (createForm.weeklyRate) data.weeklyRate = createForm.weeklyRate;
    if (createForm.monthlyRate) data.monthlyRate = createForm.monthlyRate;
    if (createForm.depositAmount) data.depositAmount = createForm.depositAmount;
    if (createForm.location) data.location = createForm.location;
    if (createForm.deliveryRadius)
      data.deliveryRadius = parseInt(createForm.deliveryRadius);
    if (createForm.photos)
      data.photos = createForm.photos
        .split(",")
        .map((p) => p.trim())
        .filter(Boolean);
    if (createForm.condition) data.condition = createForm.condition;
    if (!createForm.isOngoing && createForm.availableFrom)
      data.availableFrom = createForm.availableFrom;
    if (!createForm.isOngoing && createForm.availableTo)
      data.availableTo = createForm.availableTo;
    if (createForm.description) data.description = createForm.description;

    if (editingListing) {
      updateMutation.mutate({ id: editingListing.id, data });
    } else {
      createMutation.mutate(data);
    }
  }

  function openEditDialog(listing: EquipmentListing) {
    setEditingListing(listing);
    setCreateForm({
      name: listing.name,
      category: listing.category,
      makeModel: listing.makeModel ?? "",
      year: listing.year?.toString() ?? "",
      dailyRate: listing.dailyRate ?? "",
      weeklyRate: listing.weeklyRate ?? "",
      monthlyRate: listing.monthlyRate ?? "",
      depositAmount: listing.depositAmount ?? "",
      location: listing.location ?? "",
      deliveryRadius: listing.deliveryRadius?.toString() ?? "",
      photos: listing.photos?.join(", ") ?? "",
      condition: listing.condition ?? "",
      availableFrom: listing.availableFrom ?? "",
      availableTo: listing.availableTo ?? "",
      isOngoing: listing.isOngoing,
      description: listing.description ?? "",
    });
    setShowCreateDialog(true);
  }

  const isAdmin =
    user?.role === "ADMIN" ||
    user?.role === "MANAGER";

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-full mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Truck className="h-6 w-6 text-primary" />
            Equipment Rental Marketplace
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Rent or list construction equipment — excavators, lifts,
            compressors, scaffolding &amp; more
          </p>
        </div>
        {isAdmin && (
          <Button
            onClick={() => {
              setEditingListing(null);
              resetCreateForm();
              setShowCreateDialog(true);
            }}
            data-testid="button-create-listing"
          >
            <Plus className="h-4 w-4 mr-2" />
            List Equipment
          </Button>
        )}
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList data-testid="tabs-marketplace">
          <TabsTrigger value="browse" data-testid="tab-browse">
            Browse
          </TabsTrigger>
          <TabsTrigger value="my-listings" data-testid="tab-my-listings">
            My Listings
          </TabsTrigger>
          <TabsTrigger value="my-requests" data-testid="tab-my-requests">
            My Requests
          </TabsTrigger>
        </TabsList>

        {/* BROWSE TAB */}
        <TabsContent value="browse" className="space-y-4 mt-4">
          <div className="flex flex-wrap gap-3 items-end">
            <div className="flex-1 min-w-[160px]">
              <Label htmlFor="filter-category">Category</Label>
              <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                <SelectTrigger
                  id="filter-category"
                  data-testid="select-category-filter"
                >
                  <SelectValue placeholder="All categories" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All Categories</SelectItem>
                  {EQUIPMENT_CATEGORIES.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex-1 min-w-[160px]">
              <Label htmlFor="filter-location">Location</Label>
              <div className="relative">
                <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  id="filter-location"
                  placeholder="Search by city..."
                  value={locationSearch}
                  onChange={(e) => setLocationSearch(e.target.value)}
                  className="pl-9"
                  data-testid="input-location-filter"
                />
              </div>
            </div>
            <div className="w-28">
              <Label htmlFor="filter-min-rate">Min $/day</Label>
              <Input
                id="filter-min-rate"
                placeholder="0"
                value={minRate}
                onChange={(e) => setMinRate(e.target.value)}
                type="number"
                data-testid="input-min-rate-filter"
              />
            </div>
            <div className="w-28">
              <Label htmlFor="filter-max-rate">Max $/day</Label>
              <Input
                id="filter-max-rate"
                placeholder="Any"
                value={maxRate}
                onChange={(e) => setMaxRate(e.target.value)}
                type="number"
                data-testid="input-max-rate-filter"
              />
            </div>
          </div>

          {isBrowseLoading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {[1, 2, 3, 4, 5, 6].map((i) => (
                <Skeleton key={i} className="h-64" />
              ))}
            </div>
          ) : browseListings && browseListings.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {browseListings.map((item) => (
                <ListingCard
                  key={item.listing.id}
                  item={item}
                  isOwn={item.listing.organizationId === user?.organizationId}
                  onRequestRental={() => setRequestListing(item)}
                />
              ))}
            </div>
          ) : (
            <div className="text-center py-16 text-muted-foreground">
              <Package className="h-10 w-10 mx-auto mb-3 opacity-30" />
              <p className="font-medium">No equipment listings found</p>
              <p className="text-sm">
                Try adjusting your filters or check back later
              </p>
            </div>
          )}
        </TabsContent>

        {/* MY LISTINGS TAB */}
        <TabsContent value="my-listings" className="space-y-4 mt-4">
          {selectedMyListing ? (
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setSelectedMyListing(null)}
                  data-testid="button-back-listings"
                >
                  ← Back to listings
                </Button>
              </div>
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold">
                  {selectedMyListing.listing.name} — Incoming Requests
                </h2>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => openEditDialog(selectedMyListing.listing)}
                    data-testid="button-edit-listing"
                  >
                    <Edit className="h-4 w-4 mr-1" /> Edit
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() =>
                      deleteMutation.mutate(selectedMyListing.listing.id)
                    }
                    disabled={deleteMutation.isPending}
                    data-testid="button-delete-listing"
                  >
                    <Trash2 className="h-4 w-4 mr-1" /> Delete
                  </Button>
                </div>
              </div>

              {isListingRequestsLoading ? (
                <div className="space-y-3">
                  {[1, 2].map((i) => (
                    <Skeleton key={i} className="h-24" />
                  ))}
                </div>
              ) : listingRequests && listingRequests.length > 0 ? (
                <div className="space-y-3">
                  {listingRequests.map((item) => (
                    <Card
                      key={item.request.id}
                      data-testid={`card-incoming-request-${item.request.id}`}
                    >
                      <CardContent className="pt-4">
                        <div className="flex items-start justify-between gap-4">
                          <div className="space-y-1">
                            <div className="flex items-center gap-2">
                              <Building2 className="h-4 w-4 text-muted-foreground" />
                              <span className="font-medium">
                                {item.requesterOrg?.name ?? "Unknown Org"}
                              </span>
                              <StatusBadge status={item.request.status} />
                            </div>
                            <p className="text-sm text-muted-foreground">
                              {item.request.startDate} — {item.request.endDate}
                              {item.request.deliveryRequested &&
                                " • Delivery requested"}
                            </p>
                            {item.request.message && (
                              <p className="text-sm mt-1 italic">
                                "{item.request.message}"
                              </p>
                            )}
                            {item.request.ownerResponse && (
                              <p className="text-sm text-muted-foreground">
                                Your response: {item.request.ownerResponse}
                              </p>
                            )}
                          </div>
                          {item.request.status === "PENDING" && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                setRespondingRequest(item);
                                setRespondForm({
                                  status: "",
                                  ownerResponse: "",
                                });
                              }}
                              data-testid={`button-respond-request-${item.request.id}`}
                            >
                              Respond
                            </Button>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              ) : (
                <div className="text-center py-10 text-muted-foreground">
                  <Clock className="h-8 w-8 mx-auto mb-2 opacity-30" />
                  <p>No requests yet for this listing</p>
                </div>
              )}
            </div>
          ) : (
            <>
              {isMyListingsLoading ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {[1, 2, 3].map((i) => (
                    <Skeleton key={i} className="h-64" />
                  ))}
                </div>
              ) : myListings && myListings.length > 0 ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {myListings.map((item) => (
                    <div
                      key={item.listing.id}
                      className="cursor-pointer"
                      onClick={() => setSelectedMyListing(item)}
                      data-testid={`card-my-listing-${item.listing.id}`}
                    >
                      <Card className="hover:border-primary/50 transition-colors">
                        <CardContent className="pt-4">
                          <div className="flex items-start justify-between">
                            <div>
                              <h3 className="font-semibold">
                                {item.listing.name}
                              </h3>
                              <p className="text-sm text-muted-foreground">
                                {item.listing.category}{" "}
                                {item.listing.makeModel
                                  ? `• ${item.listing.makeModel}`
                                  : ""}
                              </p>
                              {item.listing.dailyRate && (
                                <p className="text-sm text-primary font-medium mt-1">
                                  {formatRate(item.listing.dailyRate, "day")}
                                </p>
                              )}
                              {item.listing.location && (
                                <p className="text-xs text-muted-foreground flex items-center gap-1 mt-1">
                                  <MapPin className="h-3 w-3" />
                                  {item.listing.location}
                                </p>
                              )}
                            </div>
                            <div className="flex flex-col items-end gap-2">
                              <Badge
                                variant={
                                  item.listing.isActive
                                    ? "default"
                                    : "secondary"
                                }
                              >
                                {item.listing.isActive ? "Active" : "Inactive"}
                              </Badge>
                              <ChevronRight className="h-4 w-4 text-muted-foreground" />
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-16 text-muted-foreground">
                  <Truck className="h-10 w-10 mx-auto mb-3 opacity-30" />
                  <p className="font-medium">No listings yet</p>
                  <p className="text-sm">
                    Create your first equipment listing to start renting
                  </p>
                  {isAdmin && (
                    <Button
                      className="mt-4"
                      onClick={() => {
                        resetCreateForm();
                        setShowCreateDialog(true);
                      }}
                      data-testid="button-create-first-listing"
                    >
                      <Plus className="h-4 w-4 mr-2" />
                      List Equipment
                    </Button>
                  )}
                </div>
              )}
            </>
          )}
        </TabsContent>

        {/* MY REQUESTS TAB */}
        <TabsContent value="my-requests" className="space-y-4 mt-4">
          {isMyRequestsLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-24" />
              ))}
            </div>
          ) : myRequests && myRequests.length > 0 ? (
            <div className="space-y-3">
              {myRequests.map((item) => (
                <Card
                  key={item.request.id}
                  data-testid={`card-my-request-${item.request.id}`}
                >
                  <CardContent className="pt-4">
                    <div className="flex items-start justify-between gap-4">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <Truck className="h-4 w-4 text-muted-foreground" />
                          <span className="font-medium">
                            {item.listing?.name ?? "Equipment"}
                          </span>
                          <Badge variant="outline" className="text-xs">
                            {item.listing?.category}
                          </Badge>
                          <StatusBadge status={item.request.status} />
                        </div>
                        {item.ownerOrg && (
                          <p className="text-sm text-muted-foreground flex items-center gap-1">
                            <Building2 className="h-3.5 w-3.5" /> Owner:{" "}
                            {item.ownerOrg.name}
                          </p>
                        )}
                        <p className="text-sm text-muted-foreground">
                          {item.request.startDate} — {item.request.endDate}
                          {item.request.deliveryRequested && " • Delivery"}
                        </p>
                        {item.request.message && (
                          <p className="text-sm italic text-muted-foreground">
                            Your note: "{item.request.message}"
                          </p>
                        )}
                        {item.request.ownerResponse && (
                          <p className="text-sm mt-1 p-2 bg-muted rounded">
                            Owner response: {item.request.ownerResponse}
                          </p>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (
            <div className="text-center py-16 text-muted-foreground">
              <Clock className="h-10 w-10 mx-auto mb-3 opacity-30" />
              <p className="font-medium">No rental requests yet</p>
              <p className="text-sm">
                Browse equipment and submit a rental inquiry
              </p>
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* CREATE / EDIT LISTING DIALOG */}
      <Dialog
        open={showCreateDialog}
        onOpenChange={(open) => {
          setShowCreateDialog(open);
          if (!open) setEditingListing(null);
        }}
      >
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editingListing
                ? "Edit Equipment Listing"
                : "List Equipment for Rent"}
            </DialogTitle>
            <DialogDescription>
              Provide details about the equipment you want to make available for
              rental.
            </DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-2 gap-4 py-2">
            <div className="col-span-2">
              <Label htmlFor="create-name">Equipment Name *</Label>
              <Input
                id="create-name"
                value={createForm.name}
                onChange={(e) =>
                  setCreateForm((f) => ({ ...f, name: e.target.value }))
                }
                placeholder="e.g. CAT 320 Excavator"
                data-testid="input-listing-name"
              />
            </div>

            <div>
              <Label htmlFor="create-category">Category *</Label>
              <Select
                value={createForm.category}
                onValueChange={(v) =>
                  setCreateForm((f) => ({ ...f, category: v }))
                }
              >
                <SelectTrigger
                  id="create-category"
                  data-testid="select-listing-category"
                >
                  <SelectValue placeholder="Select category" />
                </SelectTrigger>
                <SelectContent>
                  {EQUIPMENT_CATEGORIES.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label htmlFor="create-condition">Condition</Label>
              <Select
                value={createForm.condition}
                onValueChange={(v) =>
                  setCreateForm((f) => ({ ...f, condition: v }))
                }
              >
                <SelectTrigger
                  id="create-condition"
                  data-testid="select-listing-condition"
                >
                  <SelectValue placeholder="Select condition" />
                </SelectTrigger>
                <SelectContent>
                  {CONDITIONS.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label htmlFor="create-makemodel">Make / Model</Label>
              <Input
                id="create-makemodel"
                value={createForm.makeModel}
                onChange={(e) =>
                  setCreateForm((f) => ({ ...f, makeModel: e.target.value }))
                }
                placeholder="e.g. CAT 320"
                data-testid="input-listing-makemodel"
              />
            </div>

            <div>
              <Label htmlFor="create-year">Year</Label>
              <Input
                id="create-year"
                value={createForm.year}
                onChange={(e) =>
                  setCreateForm((f) => ({ ...f, year: e.target.value }))
                }
                placeholder="e.g. 2021"
                type="number"
                data-testid="input-listing-year"
              />
            </div>

            <div>
              <Label htmlFor="create-daily">Daily Rate ($)</Label>
              <Input
                id="create-daily"
                value={createForm.dailyRate}
                onChange={(e) =>
                  setCreateForm((f) => ({ ...f, dailyRate: e.target.value }))
                }
                placeholder="0.00"
                type="number"
                data-testid="input-listing-daily-rate"
              />
            </div>

            <div>
              <Label htmlFor="create-weekly">Weekly Rate ($)</Label>
              <Input
                id="create-weekly"
                value={createForm.weeklyRate}
                onChange={(e) =>
                  setCreateForm((f) => ({ ...f, weeklyRate: e.target.value }))
                }
                placeholder="0.00"
                type="number"
                data-testid="input-listing-weekly-rate"
              />
            </div>

            <div>
              <Label htmlFor="create-monthly">Monthly Rate ($)</Label>
              <Input
                id="create-monthly"
                value={createForm.monthlyRate}
                onChange={(e) =>
                  setCreateForm((f) => ({ ...f, monthlyRate: e.target.value }))
                }
                placeholder="0.00"
                type="number"
                data-testid="input-listing-monthly-rate"
              />
            </div>

            <div>
              <Label htmlFor="create-deposit">Deposit Amount ($)</Label>
              <Input
                id="create-deposit"
                value={createForm.depositAmount}
                onChange={(e) =>
                  setCreateForm((f) => ({
                    ...f,
                    depositAmount: e.target.value,
                  }))
                }
                placeholder="0.00"
                type="number"
                data-testid="input-listing-deposit"
              />
            </div>

            <div>
              <Label htmlFor="create-location">Location</Label>
              <Input
                id="create-location"
                value={createForm.location}
                onChange={(e) =>
                  setCreateForm((f) => ({ ...f, location: e.target.value }))
                }
                placeholder="e.g. Phoenix, AZ"
                data-testid="input-listing-location"
              />
            </div>

            <div>
              <Label htmlFor="create-radius">Delivery Radius (miles)</Label>
              <Input
                id="create-radius"
                value={createForm.deliveryRadius}
                onChange={(e) =>
                  setCreateForm((f) => ({
                    ...f,
                    deliveryRadius: e.target.value,
                  }))
                }
                placeholder="e.g. 50"
                type="number"
                data-testid="input-listing-delivery-radius"
              />
            </div>

            <div className="col-span-2">
              <Label htmlFor="create-photos">
                Photo URLs (comma-separated)
              </Label>
              <Input
                id="create-photos"
                value={createForm.photos}
                onChange={(e) =>
                  setCreateForm((f) => ({ ...f, photos: e.target.value }))
                }
                placeholder="https://example.com/photo1.jpg, https://..."
                data-testid="input-listing-photos"
              />
            </div>

            <div className="col-span-2 flex items-center gap-3">
              <Switch
                id="create-ongoing"
                checked={createForm.isOngoing}
                onCheckedChange={(v) =>
                  setCreateForm((f) => ({ ...f, isOngoing: v }))
                }
                data-testid="switch-listing-ongoing"
              />
              <Label htmlFor="create-ongoing">
                Ongoing availability (no fixed end date)
              </Label>
            </div>

            {!createForm.isOngoing && (
              <>
                <div>
                  <Label htmlFor="create-from">Available From</Label>
                  <Input
                    id="create-from"
                    value={createForm.availableFrom}
                    onChange={(e) =>
                      setCreateForm((f) => ({
                        ...f,
                        availableFrom: e.target.value,
                      }))
                    }
                    type="date"
                    data-testid="input-listing-available-from"
                  />
                </div>
                <div>
                  <Label htmlFor="create-to">Available To</Label>
                  <Input
                    id="create-to"
                    value={createForm.availableTo}
                    onChange={(e) =>
                      setCreateForm((f) => ({
                        ...f,
                        availableTo: e.target.value,
                      }))
                    }
                    type="date"
                    data-testid="input-listing-available-to"
                  />
                </div>
              </>
            )}

            <div className="col-span-2">
              <Label htmlFor="create-description">Description</Label>
              <Textarea
                id="create-description"
                value={createForm.description}
                onChange={(e) =>
                  setCreateForm((f) => ({ ...f, description: e.target.value }))
                }
                placeholder="Details about the equipment, special features, requirements..."
                rows={3}
                data-testid="textarea-listing-description"
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setShowCreateDialog(false);
                setEditingListing(null);
              }}
            >
              Cancel
            </Button>
            <Button
              onClick={handleCreateSubmit}
              disabled={
                !createForm.name ||
                !createForm.category ||
                createMutation.isPending ||
                updateMutation.isPending
              }
              data-testid="button-submit-listing"
            >
              {createMutation.isPending || updateMutation.isPending
                ? "Saving..."
                : editingListing
                  ? "Update Listing"
                  : "Create Listing"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* REQUEST RENTAL DIALOG */}
      <Dialog
        open={!!requestListing}
        onOpenChange={(open) => {
          if (!open) setRequestListing(null);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Request Rental</DialogTitle>
            <DialogDescription>
              {requestListing?.listing.name} — {requestListing?.ownerOrg?.name}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="req-start">Start Date *</Label>
                <Input
                  id="req-start"
                  type="date"
                  value={requestForm.startDate}
                  onChange={(e) =>
                    setRequestForm((f) => ({ ...f, startDate: e.target.value }))
                  }
                  data-testid="input-request-start-date"
                />
              </div>
              <div>
                <Label htmlFor="req-end">End Date *</Label>
                <Input
                  id="req-end"
                  type="date"
                  value={requestForm.endDate}
                  onChange={(e) =>
                    setRequestForm((f) => ({ ...f, endDate: e.target.value }))
                  }
                  data-testid="input-request-end-date"
                />
              </div>
            </div>

            <div className="flex items-center gap-3">
              <Switch
                id="req-delivery"
                checked={requestForm.deliveryRequested}
                onCheckedChange={(v) =>
                  setRequestForm((f) => ({ ...f, deliveryRequested: v }))
                }
                data-testid="switch-request-delivery"
              />
              <Label htmlFor="req-delivery">
                Request delivery to my location
              </Label>
            </div>

            <div>
              <Label htmlFor="req-message">Message to owner</Label>
              <Textarea
                id="req-message"
                value={requestForm.message}
                onChange={(e) =>
                  setRequestForm((f) => ({ ...f, message: e.target.value }))
                }
                placeholder="Describe your project and any specific needs..."
                rows={3}
                data-testid="textarea-request-message"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setRequestListing(null)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (!requestListing) return;
                requestMutation.mutate({
                  listingId: requestListing.listing.id,
                  data: requestForm,
                });
              }}
              disabled={
                !requestForm.startDate ||
                !requestForm.endDate ||
                requestMutation.isPending
              }
              data-testid="button-submit-request"
            >
              {requestMutation.isPending ? "Submitting..." : "Submit Request"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* RESPOND TO REQUEST DIALOG */}
      <Dialog
        open={!!respondingRequest}
        onOpenChange={(open) => {
          if (!open) setRespondingRequest(null);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Respond to Rental Request</DialogTitle>
            <DialogDescription>
              Request from {respondingRequest?.requesterOrg?.name}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {respondingRequest && (
              <div className="p-3 bg-muted rounded text-sm space-y-1">
                <p>
                  <span className="font-medium">Dates:</span>{" "}
                  {respondingRequest.request.startDate} —{" "}
                  {respondingRequest.request.endDate}
                </p>
                {respondingRequest.request.deliveryRequested && (
                  <p>Delivery requested</p>
                )}
                {respondingRequest.request.message && (
                  <p>
                    <span className="font-medium">Note:</span>{" "}
                    {respondingRequest.request.message}
                  </p>
                )}
              </div>
            )}

            <div>
              <Label>Decision *</Label>
              <div className="flex gap-3 mt-2">
                <Button
                  variant={
                    respondForm.status === "ACCEPTED" ? "default" : "outline"
                  }
                  className="flex-1"
                  onClick={() =>
                    setRespondForm((f) => ({ ...f, status: "ACCEPTED" }))
                  }
                  data-testid="button-respond-accept"
                >
                  <CheckCircle className="h-4 w-4 mr-2" /> Accept
                </Button>
                <Button
                  variant={
                    respondForm.status === "DECLINED"
                      ? "destructive"
                      : "outline"
                  }
                  className="flex-1"
                  onClick={() =>
                    setRespondForm((f) => ({ ...f, status: "DECLINED" }))
                  }
                  data-testid="button-respond-decline"
                >
                  <XCircle className="h-4 w-4 mr-2" /> Decline
                </Button>
              </div>
            </div>

            <div>
              <Label htmlFor="respond-message">Message (optional)</Label>
              <Textarea
                id="respond-message"
                value={respondForm.ownerResponse}
                onChange={(e) =>
                  setRespondForm((f) => ({
                    ...f,
                    ownerResponse: e.target.value,
                  }))
                }
                placeholder="Add a message to the requester..."
                rows={3}
                data-testid="textarea-respond-message"
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setRespondingRequest(null)}
            >
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (!respondingRequest || !respondForm.status) return;
                respondMutation.mutate({
                  listingId: respondingRequest.request.listingId,
                  reqId: respondingRequest.request.id,
                  data: {
                    status: respondForm.status,
                    ownerResponse: respondForm.ownerResponse || undefined,
                  },
                });
              }}
              disabled={!respondForm.status || respondMutation.isPending}
              data-testid="button-submit-response"
            >
              {respondMutation.isPending ? "Sending..." : "Send Response"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
