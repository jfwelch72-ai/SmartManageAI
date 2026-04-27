import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useParams, useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Avatar, ColoredAvatarFallback } from "@/components/ui/avatar";
import {
  Building2,
  Star,
  MapPin,
  Briefcase,
  Search,
  Clock,
  Shield,
  Users,
  Truck,
  ArrowLeft,
  HardHat,
  Plus,
  DollarSign,
  Calendar as CalendarIcon,
  Trash2,
  Edit,
  Phone,
  Mail,
} from "lucide-react";
import { Link } from "wouter";
import { cn } from "@/lib/utils";
import EquipmentRentalMarketplacePage from "./equipment-rental-marketplace";
import TalentPoolPage from "./talent-pool";
import { format, parseISO } from "date-fns";
import { getSortedTradeOptions } from "@shared/tradeTypeUtils";

const TRADE_OPTIONS = getSortedTradeOptions();
const TRADE_TYPES = TRADE_OPTIONS;

const AVAILABILITY_STATUSES = [
  { value: "AVAILABLE", label: "Available" },
  { value: "PARTIALLY_AVAILABLE", label: "Partially Available" },
  { value: "BOOKED", label: "Booked" },
  { value: "UNAVAILABLE", label: "Unavailable" },
];

// ── Shared helpers ────────────────────────────────────────────────────────────

function formatTrade(trade: string) {
  return trade.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

// ── Contractor Directory types & components ───────────────────────────────────

interface ContractorListing {
  orgId: string;
  name: string;
  tradeType: string;
  logoUrl?: string;
  serviceAreas: string[];
  tradeSpecialties: string[];
  avgRating: number | null;
  reviewCount: number;
  foundedYear?: number;
  bio?: string;
  portfolioPhotos: string[];
  certifications: string[];
  yearsInBusiness?: number;
}

interface ContractorProfile extends ContractorListing {
  companyDescription?: string;
  licenseNumbers: string[];
  isDirectoryListed: boolean;
}

interface Review {
  id: string;
  rating: number;
  comment?: string;
  projectRef?: string;
  createdAt: string;
  reviewerOrg: { id: string; name: string; logoUrl?: string };
}

function StarRating({
  rating,
  size = "sm",
}: {
  rating: number;
  size?: "sm" | "lg";
}) {
  const cls = size === "lg" ? "w-5 h-5" : "w-4 h-4";
  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((star) => (
        <Star
          key={star}
          className={cn(
            cls,
            star <= Math.round(rating)
              ? "text-yellow-400 fill-yellow-400"
              : "text-muted-foreground",
          )}
        />
      ))}
    </div>
  );
}

function InteractiveStarRating({
  value,
  onChange,
}: {
  value: number;
  onChange: (v: number) => void;
}) {
  const [hover, setHover] = useState(0);
  return (
    <div className="flex items-center gap-1">
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          type="button"
          onClick={() => onChange(star)}
          onMouseEnter={() => setHover(star)}
          onMouseLeave={() => setHover(0)}
          data-testid={`star-rating-${star}`}
        >
          <Star
            className={cn(
              "w-6 h-6 cursor-pointer transition-colors",
              star <= (hover || value)
                ? "text-yellow-400 fill-yellow-400"
                : "text-muted-foreground",
            )}
          />
        </button>
      ))}
    </div>
  );
}

function ContractorCard({ contractor }: { contractor: ContractorListing }) {
  const [, navigate] = useLocation();
  return (
    <Card
      className="cursor-pointer hover:shadow-md transition-shadow"
      onClick={() => navigate(`/marketplace/contractors/${contractor.orgId}`)}
      data-testid={`card-contractor-${contractor.orgId}`}
    >
      <CardContent className="p-4">
        <div className="flex gap-3">
          {contractor.portfolioPhotos.length > 0 ? (
            <img
              src={contractor.portfolioPhotos[0]}
              alt={contractor.name}
              className="w-16 h-16 rounded-lg object-cover shrink-0"
              data-testid={`img-contractor-${contractor.orgId}`}
            />
          ) : (
            <div className="w-16 h-16 rounded-lg bg-muted flex items-center justify-center shrink-0">
              <Building2 className="w-8 h-8 text-muted-foreground" />
            </div>
          )}
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2">
              <h3
                className="font-semibold text-sm line-clamp-1"
                data-testid={`text-contractor-name-${contractor.orgId}`}
              >
                {contractor.name}
              </h3>
              <Badge variant="secondary" className="shrink-0 text-xs">
                {formatTrade(contractor.tradeType)}
              </Badge>
            </div>
            {contractor.avgRating !== null && (
              <div className="flex items-center gap-1.5 mt-1">
                <StarRating rating={contractor.avgRating} />
                <span
                  className="text-xs text-muted-foreground"
                  data-testid={`text-rating-${contractor.orgId}`}
                >
                  {contractor.avgRating.toFixed(1)} ({contractor.reviewCount})
                </span>
              </div>
            )}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-1">
              {contractor.serviceAreas.length > 0 && (
                <div className="flex items-center gap-1">
                  <MapPin className="w-3 h-3 text-muted-foreground shrink-0" />
                  <span className="text-xs text-muted-foreground line-clamp-1">
                    {contractor.serviceAreas.slice(0, 2).join(", ")}
                  </span>
                </div>
              )}
              {contractor.yearsInBusiness != null &&
                contractor.yearsInBusiness > 0 && (
                  <div className="flex items-center gap-1">
                    <Briefcase className="w-3 h-3 text-muted-foreground shrink-0" />
                    <span
                      className="text-xs text-muted-foreground"
                      data-testid={`text-years-${contractor.orgId}`}
                    >
                      {contractor.yearsInBusiness} yr
                      {contractor.yearsInBusiness !== 1 ? "s" : ""}
                    </span>
                  </div>
                )}
            </div>
            {contractor.bio && (
              <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                {contractor.bio}
              </p>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function ReviewForm({
  orgId,
  onSuccess,
}: {
  orgId: string;
  onSuccess: () => void;
}) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  const [projectRef, setProjectRef] = useState("");

  const mutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest(
        "POST",
        `/api/marketplace/contractors/${orgId}/reviews`,
        {
          rating,
          comment: comment || null,
          projectRef: projectRef || null,
        },
      );
      return res.json();
    },
    onSuccess: () => {
      toast({
        title: "Review submitted",
        description: "Thank you for your feedback.",
      });
      setOpen(false);
      setRating(0);
      setComment("");
      setProjectRef("");
      onSuccess();
    },
    onError: (err: unknown) => {
      const message =
        err instanceof Error ? err.message : "Failed to submit review";
      toast({ title: "Error", description: message, variant: "destructive" });
    },
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" data-testid="button-write-review">
          <Star className="w-4 h-4 mr-2" />
          Write a Review
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Write a Review</DialogTitle>
          <DialogDescription>
            Share your experience working with this contractor.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="grid gap-2">
            <Label>Rating *</Label>
            <InteractiveStarRating value={rating} onChange={setRating} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="review-comment">Comment</Label>
            <Textarea
              id="review-comment"
              placeholder="Describe your experience..."
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              data-testid="input-review-comment"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="review-project-ref">
              Project Reference (optional)
            </Label>
            <Input
              id="review-project-ref"
              placeholder="e.g., Main St Office Building"
              value={projectRef}
              onChange={(e) => setProjectRef(e.target.value)}
              data-testid="input-review-project-ref"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => mutation.mutate()}
            disabled={rating === 0 || mutation.isPending}
            data-testid="button-submit-review"
          >
            {mutation.isPending ? "Submitting..." : "Submit Review"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============================================
// CONTRACTOR PROFILE PAGE
// ============================================
function TeamMembersSection({ orgId }: { orgId: string }) {
  const { data: members = [], isLoading } = useQuery<any[]>({
    queryKey: ["/api/marketplace/contractors", orgId, "team-members"],
    queryFn: async () => {
      const res = await fetch(
        `/api/marketplace/contractors/${orgId}/team-members`,
      );
      if (!res.ok) return [];
      return res.json();
    },
  });

  if (isLoading) return <Skeleton className="h-24 w-full" />;
  if (members.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm flex items-center gap-1.5">
          <Users className="w-4 h-4" />
          Team Members
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {members.map((m: any) => (
          <Link key={m.user.id} href={`/talent-pool/${m.profile.id}`}>
            <div
              className="flex items-center gap-2 py-1 hover:bg-muted/50 rounded px-1 cursor-pointer"
              data-testid={`team-member-${m.user.id}`}
            >
              <Avatar className="w-7 h-7 shrink-0">
                <ColoredAvatarFallback className="text-xs" name={`${m.user.firstName ?? ""} ${m.user.lastName ?? ""}`} />
              </Avatar>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium line-clamp-1">
                  {m.user.firstName} {m.user.lastName}
                </p>
                {m.profile.tradeSpecialization && (
                  <p className="text-xs text-muted-foreground">
                    {formatTrade(m.profile.tradeSpecialization)}
                  </p>
                )}
              </div>
              <Badge variant="secondary" className="text-xs shrink-0">
                View Profile
              </Badge>
            </div>
          </Link>
        ))}
      </CardContent>
    </Card>
  );
}

export function ContractorProfilePage() {
  const { orgId } = useParams<{ orgId: string }>();
  const { user } = useAuth();

  const { data: profile, isLoading: profileLoading } =
    useQuery<ContractorProfile>({
      queryKey: ["/api/marketplace/contractors", orgId],
      queryFn: async () => {
        const res = await fetch(`/api/marketplace/contractors/${orgId}`);
        if (!res.ok) throw new Error("Not found");
        return res.json();
      },
    });

  const {
    data: reviews = [],
    isLoading: reviewsLoading,
    refetch: refetchReviews,
  } = useQuery<Review[]>({
    queryKey: ["/api/marketplace/contractors", orgId, "reviews"],
    queryFn: async () => {
      const res = await fetch(`/api/marketplace/contractors/${orgId}/reviews`);
      if (!res.ok) return [];
      return res.json();
    },
  });

  const isOwnOrg = user?.organizationId === orgId;
  const hasReviewed = reviews.some(
    (r) => r.reviewerOrg.id === user?.organizationId,
  );

  if (profileLoading) {
    return (
      <div className="p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-32 bg-muted rounded-lg" />
          <div className="h-8 bg-muted rounded w-1/3" />
          <div className="h-24 bg-muted rounded" />
        </div>
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="p-6 text-center">
        <p className="text-muted-foreground">
          Contractor not found in the directory.
        </p>
        <Link href="/marketplace">
          <Button variant="outline" className="mt-4">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Directory
          </Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-full mx-auto p-6 space-y-6">
      <div>
        <Link href="/marketplace">
          <Button
            variant="ghost"
            size="sm"
            className="mb-4"
            data-testid="link-back-directory"
          >
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Marketplace
          </Button>
        </Link>

        {/* Header */}
        <Card>
          <CardContent className="p-6">
            <div className="flex gap-4 items-start">
              <div className="w-20 h-20 rounded-xl bg-muted flex items-center justify-center shrink-0">
                {profile.logoUrl ? (
                  <img
                    src={profile.logoUrl}
                    alt={profile.name}
                    className="w-20 h-20 rounded-xl object-cover"
                  />
                ) : (
                  <Building2 className="w-10 h-10 text-muted-foreground" />
                )}
              </div>
              <div className="flex-1">
                <div className="flex flex-wrap items-start gap-2 justify-between">
                  <h1
                    className="text-2xl font-bold"
                    data-testid="text-contractor-profile-name"
                  >
                    {profile.name}
                  </h1>
                  <Badge>{formatTrade(profile.tradeType)}</Badge>
                </div>
                {profile.avgRating !== null && (
                  <div className="flex items-center gap-2 mt-1">
                    <StarRating rating={profile.avgRating} size="lg" />
                    <span className="font-medium">
                      {profile.avgRating.toFixed(1)}
                    </span>
                    <span className="text-muted-foreground">
                      ({profile.reviewCount} reviews)
                    </span>
                  </div>
                )}
                {profile.serviceAreas.length > 0 && (
                  <div className="flex items-center gap-1 mt-2">
                    <MapPin className="w-4 h-4 text-muted-foreground" />
                    <span className="text-sm text-muted-foreground">
                      {profile.serviceAreas.join(", ")}
                    </span>
                  </div>
                )}
                {profile.foundedYear && (
                  <div className="flex items-center gap-1 mt-1">
                    <Clock className="w-4 h-4 text-muted-foreground" />
                    <span className="text-sm text-muted-foreground">
                      Founded {profile.foundedYear}
                    </span>
                  </div>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="grid md:grid-cols-3 gap-6 mt-6">
          <div className="md:col-span-2 space-y-6">
            {/* About */}
            {(profile.bio || profile.companyDescription) && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">About</CardTitle>
                </CardHeader>
                <CardContent>
                  <p
                    className="text-sm text-muted-foreground whitespace-pre-wrap"
                    data-testid="text-contractor-bio"
                  >
                    {profile.bio || profile.companyDescription}
                  </p>
                </CardContent>
              </Card>
            )}

            {/* Portfolio */}
            {profile.portfolioPhotos.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Portfolio</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-3 gap-2">
                    {profile.portfolioPhotos.map((url, i) => (
                      <img
                        key={i}
                        src={url}
                        alt={`Portfolio ${i + 1}`}
                        className="w-full aspect-square object-cover rounded-lg"
                        data-testid={`img-portfolio-${i}`}
                      />
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Reviews */}
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">
                    Reviews ({reviews.length})
                  </CardTitle>
                  {!isOwnOrg && !hasReviewed && (
                    <ReviewForm
                      orgId={orgId!}
                      onSuccess={() => refetchReviews()}
                    />
                  )}
                </div>
              </CardHeader>
              <CardContent>
                {reviewsLoading ? (
                  <div className="animate-pulse space-y-3">
                    <div className="h-16 bg-muted rounded" />
                    <div className="h-16 bg-muted rounded" />
                  </div>
                ) : reviews.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-4">
                    No reviews yet.
                  </p>
                ) : (
                  <div className="space-y-4">
                    {reviews.map((review) => (
                      <div
                        key={review.id}
                        className="border-b last:border-0 pb-4 last:pb-0"
                        data-testid={`review-${review.id}`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <p className="text-sm font-medium">
                              {review.reviewerOrg.name}
                            </p>
                            <StarRating rating={review.rating} />
                          </div>
                          <span className="text-xs text-muted-foreground">
                            {new Date(review.createdAt).toLocaleDateString()}
                          </span>
                        </div>
                        {review.comment && (
                          <p className="text-sm text-muted-foreground mt-2">
                            {review.comment}
                          </p>
                        )}
                        {review.projectRef && (
                          <p className="text-xs text-muted-foreground mt-1">
                            Project: {review.projectRef}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          <div className="space-y-4">
            {/* Trade specialties */}
            {profile.tradeSpecialties.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">Trade Specialties</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex flex-wrap gap-1.5">
                    {profile.tradeSpecialties.map((t) => (
                      <Badge key={t} variant="secondary" className="text-xs">
                        {formatTrade(t)}
                      </Badge>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Certifications, Licenses & Insurance */}
            {(profile.certifications.length > 0 ||
              profile.licenseNumbers.length > 0) && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm flex items-center gap-1.5">
                    <Shield className="w-4 h-4" />
                    Certifications, Licenses & Insurance
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {profile.certifications.map((c) => (
                    <Badge
                      key={c}
                      variant="outline"
                      className="text-xs w-full justify-start"
                      data-testid={`badge-cert-${c}`}
                    >
                      {c}
                    </Badge>
                  ))}
                  {profile.licenseNumbers.map((l) => (
                    <p
                      key={l}
                      className="text-xs text-muted-foreground"
                      data-testid={`text-license-${l}`}
                    >
                      <span className="font-medium">License:</span> {l}
                    </p>
                  ))}
                  {profile.certifications.length > 0 && (
                    <p className="text-xs text-muted-foreground pt-1">
                      Insurance documentation available upon request.
                    </p>
                  )}
                </CardContent>
              </Card>
            )}

            <TeamMembersSection orgId={orgId} />
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================
// CONTRACTOR DIRECTORY LIST
// ============================================
function ContractorDirectory() {
  const [search, setSearch] = useState("");
  const [tradeFilter, setTradeFilter] = useState("all");
  const [locationFilter, setLocationFilter] = useState("");
  const [minRating, setMinRating] = useState("all");

  const params = new URLSearchParams();
  if (search) params.set("search", search);
  if (tradeFilter !== "all") params.set("trade", tradeFilter);
  if (locationFilter) params.set("location", locationFilter);
  if (minRating !== "all") params.set("minRating", minRating);

  const { data: contractors = [], isLoading } = useQuery<ContractorListing[]>({
    queryKey: [
      "/api/marketplace/contractors",
      search,
      tradeFilter,
      locationFilter,
      minRating,
    ],
    queryFn: async () => {
      const res = await fetch(
        `/api/marketplace/contractors?${params.toString()}`,
      );
      if (!res.ok) throw new Error("Failed to load");
      return res.json();
    },
  });

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Browse and connect with verified subcontractors and specialty
        contractors in your area.
      </p>
      {/* Filters */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-wrap gap-3">
            <div className="flex-1 min-w-[200px]">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  placeholder="Search contractors..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-9"
                  data-testid="input-search-contractors"
                />
              </div>
            </div>
            <Select value={tradeFilter} onValueChange={setTradeFilter}>
              <SelectTrigger
                className="w-[180px]"
                data-testid="select-trade-filter"
              >
                <SelectValue placeholder="All Trades" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Trades</SelectItem>
                {TRADE_OPTIONS.map(({ value, label }) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="w-[160px]">
              <Input
                placeholder="Location..."
                value={locationFilter}
                onChange={(e) => setLocationFilter(e.target.value)}
                data-testid="input-location-filter"
              />
            </div>
            <Select value={minRating} onValueChange={setMinRating}>
              <SelectTrigger
                className="w-[140px]"
                data-testid="select-rating-filter"
              >
                <SelectValue placeholder="Min Rating" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Any Rating</SelectItem>
                <SelectItem value="4">4+ Stars</SelectItem>
                <SelectItem value="3">3+ Stars</SelectItem>
                <SelectItem value="2">2+ Stars</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Results */}
      {isLoading ? (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-32 bg-muted rounded-lg animate-pulse" />
          ))}
        </div>
      ) : contractors.length === 0 ? (
        <div className="text-center py-12">
          <Building2 className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
          <h3 className="font-medium">No contractors found</h3>
          <p className="text-sm text-muted-foreground mt-1">
            Try adjusting your search or filters
          </p>
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {contractors.map((c) => (
            <ContractorCard key={c.orgId} contractor={c} />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Crew Marketplace types & helpers ─────────────────────────────────────────

interface CrewListing {
  listing: {
    id: string;
    organizationId: string;
    crewId: string | null;
    tradeType: string;
    crewName: string;
    crewSize: number | null;
    skills: string[] | null;
    certifications: string[] | null;
    equipmentOwned: string[] | null;
    hourlyRate: string | null;
    dailyRate: string | null;
    baseLocation: string | null;
    travelRadius: number | null;
    availabilityStatus: string;
    availableFrom: string | null;
    availableTo: string | null;
    rating: string | null;
    completedProjects: number | null;
    contactName: string | null;
    contactPhone: string | null;
    contactEmail: string | null;
    description: string | null;
    isPublic: boolean;
    createdAt: string;
    updatedAt: string;
  };
  crew: { id: string; name: string } | null;
}

function getStatusBadge(status: string) {
  switch (status) {
    case "AVAILABLE":
      return <Badge className="bg-green-600 text-white">Available</Badge>;
    case "PARTIALLY_AVAILABLE":
      return (
        <Badge className="bg-yellow-500 text-white">Partially Available</Badge>
      );
    case "BOOKED":
      return <Badge variant="secondary">Booked</Badge>;
    case "UNAVAILABLE":
      return <Badge variant="outline">Unavailable</Badge>;
    default:
      return <Badge variant="outline">{status}</Badge>;
  }
}

// ── Crew Marketplace Tab ─────────────────────────────────────────────────────

function CrewMarketplaceTab() {
  const { toast } = useToast();
  const [tradeFilter, setTradeFilter] = useState<string>("ALL");
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [locationSearch, setLocationSearch] = useState("");
  const [availableFrom, setAvailableFrom] = useState("");
  const [availableTo, setAvailableTo] = useState("");
  const [showOwnOnly, setShowOwnOnly] = useState(false);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [selectedListing, setSelectedListing] = useState<CrewListing | null>(
    null,
  );
  const [editListing, setEditListing] = useState<CrewListing | null>(null);

  const buildParams = () => {
    const params = new URLSearchParams();
    if (tradeFilter !== "ALL") params.set("tradeType", tradeFilter);
    if (statusFilter !== "ALL") params.set("status", statusFilter);
    if (locationSearch) params.set("location", locationSearch);
    if (availableFrom) params.set("availableFrom", availableFrom);
    if (availableTo) params.set("availableTo", availableTo);
    return params.toString();
  };

  const queryKey = showOwnOnly
    ? ["/api/marketplace/crews/my"]
    : [
        "/api/marketplace/crews",
        tradeFilter,
        statusFilter,
        locationSearch,
        availableFrom,
        availableTo,
      ];

  const { data: listings, isLoading } = useQuery<CrewListing[]>({
    queryKey,
    queryFn: () => {
      if (showOwnOnly) {
        return fetch("/api/marketplace/crews/my", {
          credentials: "include",
        }).then((r) => r.json());
      }
      const qs = buildParams();
      return fetch(`/api/marketplace/crews${qs ? `?${qs}` : ""}`, {
        credentials: "include",
      }).then((r) => r.json());
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) =>
      apiRequest("DELETE", `/api/marketplace/crews/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["/api/marketplace/crews"],
        exact: false,
      });
      toast({ title: "Listing deleted" });
      setSelectedListing(null);
    },
    onError: () => {
      toast({ title: "Failed to delete listing", variant: "destructive" });
    },
  });

  return (
    <div className="space-y-4" data-testid="crew-marketplace-tab">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <p className="text-sm text-muted-foreground">
          Browse and list available crews for hire by trade, location, and
          availability.
        </p>
        <Button
          onClick={() => setShowCreateDialog(true)}
          data-testid="button-create-crew-listing"
        >
          <Plus className="h-4 w-4 mr-2" />
          List Your Crew
        </Button>
      </div>

      <Card className="p-4">
        <div className="flex flex-wrap items-center gap-3">
          <Select value={tradeFilter} onValueChange={setTradeFilter}>
            <SelectTrigger
              className="w-[180px]"
              data-testid="select-crew-trade-filter"
            >
              <SelectValue placeholder="All Trades" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All Trades</SelectItem>
              {TRADE_TYPES.map(({ value, label }) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger
              className="w-[180px]"
              data-testid="select-crew-status-filter"
            >
              <SelectValue placeholder="All Statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All Statuses</SelectItem>
              {AVAILABILITY_STATUSES.map((s) => (
                <SelectItem key={s.value} value={s.value}>
                  {s.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={locationSearch}
              onChange={(e) => setLocationSearch(e.target.value)}
              placeholder="Search by location..."
              className="pl-9 w-[200px]"
              data-testid="input-crew-location-search"
            />
          </div>

          <Input
            type="date"
            value={availableFrom}
            onChange={(e) => setAvailableFrom(e.target.value)}
            className="w-[160px]"
            title="Available from"
            data-testid="input-crew-available-from"
          />
          <Input
            type="date"
            value={availableTo}
            onChange={(e) => setAvailableTo(e.target.value)}
            className="w-[160px]"
            title="Available to"
            data-testid="input-crew-available-to"
          />

          <div className="flex items-center gap-2 ml-auto">
            <Switch
              checked={showOwnOnly}
              onCheckedChange={setShowOwnOnly}
              data-testid="switch-crew-own-only"
            />
            <Label
              className="text-sm cursor-pointer"
              onClick={() => setShowOwnOnly(!showOwnOnly)}
            >
              My Listings Only
            </Label>
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
              className="cursor-pointer hover:shadow-md transition-shadow"
              onClick={() => setSelectedListing(item)}
              data-testid={`card-crew-listing-${item.listing.id}`}
            >
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <CardTitle className="text-base truncate flex items-center gap-2">
                      <HardHat className="h-4 w-4 flex-shrink-0" />
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
                    <span className="font-medium">
                      {parseFloat(item.listing.rating).toFixed(1)}
                    </span>
                    {item.listing.completedProjects != null && (
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
                      <DollarSign className="h-3 w-3" />$
                      {parseFloat(item.listing.hourlyRate).toFixed(0)}/hr
                    </div>
                  )}
                </div>

                {item.listing.baseLocation && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <MapPin className="h-3 w-3" />
                    <span className="truncate">
                      {item.listing.baseLocation}
                    </span>
                    {item.listing.travelRadius && (
                      <span>({item.listing.travelRadius} mi radius)</span>
                    )}
                  </div>
                )}

                {item.listing.description && (
                  <p className="text-sm text-muted-foreground line-clamp-2">
                    {item.listing.description}
                  </p>
                )}

                {item.listing.certifications &&
                  item.listing.certifications.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {item.listing.certifications
                        .slice(0, 3)
                        .map((cert, i) => (
                          <Badge key={i} variant="outline" className="text-xs">
                            {cert}
                          </Badge>
                        ))}
                      {item.listing.certifications.length > 3 && (
                        <Badge variant="outline" className="text-xs">
                          +{item.listing.certifications.length - 3}
                        </Badge>
                      )}
                    </div>
                  )}

                {!item.listing.isPublic && (
                  <Badge variant="secondary" className="text-xs">
                    Private
                  </Badge>
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
          <Button
            onClick={() => setShowCreateDialog(true)}
            data-testid="button-create-first-crew-listing"
          >
            <Plus className="h-4 w-4 mr-2" />
            List Your Crew
          </Button>
        </Card>
      )}

      <CrewListingDetailDialog
        listing={selectedListing}
        onClose={() => setSelectedListing(null)}
        onDelete={(id) => deleteMutation.mutate(id)}
        onEdit={(item) => {
          setSelectedListing(null);
          setEditListing(item);
        }}
        isDeleting={deleteMutation.isPending}
      />

      <CreateOrEditCrewListingDialog
        open={showCreateDialog || editListing !== null}
        onOpenChange={(open) => {
          if (!open) {
            setShowCreateDialog(false);
            setEditListing(null);
          }
        }}
        existingListing={editListing}
      />
    </div>
  );
}

function CrewListingDetailDialog({
  listing,
  onClose,
  onDelete,
  onEdit,
  isDeleting,
}: {
  listing: CrewListing | null;
  onClose: () => void;
  onDelete: (id: string) => void;
  onEdit: (item: CrewListing) => void;
  isDeleting: boolean;
}) {
  if (!listing) return null;
  const l = listing.listing;

  return (
    <Dialog open={!!listing} onOpenChange={() => onClose()}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <HardHat className="h-5 w-5" />
            {l.crewName}
          </DialogTitle>
          <DialogDescription>{formatTrade(l.tradeType)}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            {getStatusBadge(l.availabilityStatus)}
            {!l.isPublic && <Badge variant="secondary">Private</Badge>}
          </div>

          {l.rating && (
            <div className="flex items-center gap-2">
              <Star className="h-5 w-5 fill-yellow-400 text-yellow-400" />
              <span className="text-lg font-medium">
                {parseFloat(l.rating).toFixed(1)}
              </span>
              {l.completedProjects != null && (
                <span className="text-muted-foreground">
                  ({l.completedProjects} completed projects)
                </span>
              )}
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            {l.crewSize && (
              <div>
                <Label className="text-sm text-muted-foreground">
                  Crew Size
                </Label>
                <p className="flex items-center gap-1">
                  <Users className="h-4 w-4" />
                  {l.crewSize} workers
                </p>
              </div>
            )}
            {l.hourlyRate && (
              <div>
                <Label className="text-sm text-muted-foreground">
                  Hourly Rate
                </Label>
                <p className="flex items-center gap-1">
                  <DollarSign className="h-4 w-4" />$
                  {parseFloat(l.hourlyRate).toFixed(2)}/hr
                </p>
              </div>
            )}
            {l.dailyRate && (
              <div>
                <Label className="text-sm text-muted-foreground">
                  Daily Rate
                </Label>
                <p className="flex items-center gap-1">
                  <DollarSign className="h-4 w-4" />$
                  {parseFloat(l.dailyRate).toFixed(2)}/day
                </p>
              </div>
            )}
            {l.baseLocation && (
              <div>
                <Label className="text-sm text-muted-foreground">
                  Location
                </Label>
                <p className="flex items-center gap-1">
                  <MapPin className="h-4 w-4" />
                  {l.baseLocation}
                  {l.travelRadius && ` (${l.travelRadius} mi radius)`}
                </p>
              </div>
            )}
          </div>

          {(l.availableFrom || l.availableTo) && (
            <div>
              <Label className="text-sm text-muted-foreground">
                Availability Window
              </Label>
              <p className="flex items-center gap-1">
                <CalendarIcon className="h-4 w-4" />
                {l.availableFrom &&
                  format(parseISO(l.availableFrom), "MMM d, yyyy")}
                {l.availableFrom && l.availableTo && " – "}
                {l.availableTo &&
                  format(parseISO(l.availableTo), "MMM d, yyyy")}
              </p>
            </div>
          )}

          {l.description && (
            <div>
              <Label className="text-sm text-muted-foreground">
                Description
              </Label>
              <p className="text-sm p-3 bg-muted rounded-lg">{l.description}</p>
            </div>
          )}

          {l.skills && l.skills.length > 0 && (
            <div>
              <Label className="text-sm text-muted-foreground">Skills</Label>
              <div className="flex flex-wrap gap-2 mt-1">
                {l.skills.map((s, i) => (
                  <Badge key={i} variant="secondary">
                    {s}
                  </Badge>
                ))}
              </div>
            </div>
          )}

          {l.certifications && l.certifications.length > 0 && (
            <div>
              <Label className="text-sm text-muted-foreground">
                Certifications
              </Label>
              <div className="flex flex-wrap gap-2 mt-1">
                {l.certifications.map((c, i) => (
                  <Badge key={i} variant="outline">
                    {c}
                  </Badge>
                ))}
              </div>
            </div>
          )}

          {l.equipmentOwned && l.equipmentOwned.length > 0 && (
            <div>
              <Label className="text-sm text-muted-foreground">
                Equipment Owned
              </Label>
              <div className="flex flex-wrap gap-2 mt-1">
                {l.equipmentOwned.map((e, i) => (
                  <Badge key={i} variant="outline">
                    {e}
                  </Badge>
                ))}
              </div>
            </div>
          )}

          <Separator />
          <div className="space-y-2">
            <Label className="text-sm font-medium">Contact Information</Label>
            {l.contactName && (
              <p className="text-sm font-medium">{l.contactName}</p>
            )}
            {l.contactPhone && (
              <a
                href={`tel:${l.contactPhone}`}
                className="flex items-center gap-2 text-sm text-primary hover:underline"
                data-testid="link-contact-phone"
              >
                <Phone className="h-3 w-3" />
                {l.contactPhone}
              </a>
            )}
            {l.contactEmail && (
              <a
                href={`mailto:${l.contactEmail}?subject=Interested in your crew listing: ${l.crewName}`}
                className="flex items-center gap-2 text-sm text-primary hover:underline"
                data-testid="link-contact-email"
              >
                <Mail className="h-3 w-3" />
                {l.contactEmail}
              </a>
            )}
            {!l.contactName && !l.contactPhone && !l.contactEmail && (
              <p className="text-sm text-muted-foreground">
                No contact information provided.
              </p>
            )}
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button
            variant="outline"
            onClick={() => onEdit(listing)}
            data-testid="button-edit-crew-listing"
          >
            <Edit className="h-4 w-4 mr-2" />
            Edit
          </Button>
          <Button
            variant="destructive"
            onClick={() => onDelete(l.id)}
            disabled={isDeleting}
            data-testid="button-delete-crew-listing"
          >
            <Trash2 className="h-4 w-4 mr-2" />
            Delete
          </Button>
          <Button
            variant="ghost"
            onClick={onClose}
            data-testid="button-close-crew-detail"
          >
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CreateOrEditCrewListingDialog({
  open,
  onOpenChange,
  existingListing,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  existingListing: CrewListing | null;
}) {
  const { toast } = useToast();
  const isEdit = !!existingListing;

  const [crewName, setCrewName] = useState(
    existingListing?.listing.crewName ?? "",
  );
  const [tradeType, setTradeType] = useState(
    existingListing?.listing.tradeType ?? "OTHER",
  );
  const [crewSize, setCrewSize] = useState(
    existingListing?.listing.crewSize?.toString() ?? "",
  );
  const [description, setDescription] = useState(
    existingListing?.listing.description ?? "",
  );
  const [hourlyRate, setHourlyRate] = useState(
    existingListing?.listing.hourlyRate ?? "",
  );
  const [dailyRate, setDailyRate] = useState(
    existingListing?.listing.dailyRate ?? "",
  );
  const [baseLocation, setBaseLocation] = useState(
    existingListing?.listing.baseLocation ?? "",
  );
  const [travelRadius, setTravelRadius] = useState(
    existingListing?.listing.travelRadius?.toString() ?? "",
  );
  const [availabilityStatus, setAvailabilityStatus] = useState(
    existingListing?.listing.availabilityStatus ?? "AVAILABLE",
  );
  const [availableFrom, setAvailableFrom] = useState(
    existingListing?.listing.availableFrom ?? "",
  );
  const [availableTo, setAvailableTo] = useState(
    existingListing?.listing.availableTo ?? "",
  );
  const [skillsInput, setSkillsInput] = useState(
    (existingListing?.listing.skills ?? []).join(", "),
  );
  const [certificationsInput, setCertificationsInput] = useState(
    (existingListing?.listing.certifications ?? []).join(", "),
  );
  const [equipmentInput, setEquipmentInput] = useState(
    (existingListing?.listing.equipmentOwned ?? []).join(", "),
  );
  const [contactName, setContactName] = useState(
    existingListing?.listing.contactName ?? "",
  );
  const [contactPhone, setContactPhone] = useState(
    existingListing?.listing.contactPhone ?? "",
  );
  const [contactEmail, setContactEmail] = useState(
    existingListing?.listing.contactEmail ?? "",
  );
  const [isPublic, setIsPublic] = useState(
    existingListing?.listing.isPublic ?? true,
  );

  const parseTagInput = (input: string) =>
    input
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

  const buildPayload = () => ({
    crewName,
    tradeType,
    crewSize: crewSize ? parseInt(crewSize) : undefined,
    description: description || undefined,
    hourlyRate: hourlyRate || undefined,
    dailyRate: dailyRate || undefined,
    baseLocation: baseLocation || undefined,
    travelRadius: travelRadius ? parseInt(travelRadius) : undefined,
    availabilityStatus,
    availableFrom: availableFrom || undefined,
    availableTo: availableTo || undefined,
    skills:
      parseTagInput(skillsInput).length > 0
        ? parseTagInput(skillsInput)
        : undefined,
    certifications:
      parseTagInput(certificationsInput).length > 0
        ? parseTagInput(certificationsInput)
        : undefined,
    equipmentOwned:
      parseTagInput(equipmentInput).length > 0
        ? parseTagInput(equipmentInput)
        : undefined,
    contactName: contactName || undefined,
    contactPhone: contactPhone || undefined,
    contactEmail: contactEmail || undefined,
    isPublic,
  });

  const createMutation = useMutation({
    mutationFn: (data: any) =>
      apiRequest("POST", "/api/marketplace/crews", data),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["/api/marketplace/crews"],
        exact: false,
      });
      toast({ title: "Crew listing created successfully" });
      onOpenChange(false);
    },
    onError: () => {
      toast({ title: "Failed to create listing", variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: (data: any) =>
      apiRequest(
        "PATCH",
        `/api/marketplace/crews/${existingListing!.listing.id}`,
        data,
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["/api/marketplace/crews"],
        exact: false,
      });
      toast({ title: "Crew listing updated successfully" });
      onOpenChange(false);
    },
    onError: () => {
      toast({ title: "Failed to update listing", variant: "destructive" });
    },
  });

  const handleSubmit = () => {
    if (!crewName.trim()) {
      toast({ title: "Crew name is required", variant: "destructive" });
      return;
    }
    const payload = buildPayload();
    if (isEdit) {
      updateMutation.mutate(payload);
    } else {
      createMutation.mutate(payload);
    }
  };

  const isPending = createMutation.isPending || updateMutation.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? "Edit Crew Listing" : "List Your Crew"}
          </DialogTitle>
          <DialogDescription>
            {isEdit
              ? "Update your crew's availability listing."
              : "Make your crew available for hire on the marketplace."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 overflow-y-auto flex-1 pr-2">
          <div className="space-y-2">
            <Label htmlFor="crew-name">Crew Name *</Label>
            <Input
              id="crew-name"
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
                <SelectTrigger data-testid="select-crew-trade">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TRADE_TYPES.map(({ value, label }) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="crew-size">Crew Size</Label>
              <Input
                id="crew-size"
                type="number"
                min={1}
                value={crewSize}
                onChange={(e) => setCrewSize(e.target.value)}
                placeholder="# of workers"
                data-testid="input-crew-size"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="crew-description">Description</Label>
            <Textarea
              id="crew-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe your crew's experience, specialties, past projects..."
              rows={3}
              data-testid="input-crew-description"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="crew-skills">Skills (comma-separated)</Label>
            <Input
              id="crew-skills"
              value={skillsInput}
              onChange={(e) => setSkillsInput(e.target.value)}
              placeholder="e.g., Formwork, Rebar, Shotcrete"
              data-testid="input-crew-skills"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="crew-certifications">
              Certifications (comma-separated)
            </Label>
            <Input
              id="crew-certifications"
              value={certificationsInput}
              onChange={(e) => setCertificationsInput(e.target.value)}
              placeholder="e.g., OSHA 30, ACI Certified"
              data-testid="input-crew-certifications"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="crew-equipment">
              Equipment Owned (comma-separated)
            </Label>
            <Input
              id="crew-equipment"
              value={equipmentInput}
              onChange={(e) => setEquipmentInput(e.target.value)}
              placeholder="e.g., Concrete Pump, Boom Lift"
              data-testid="input-crew-equipment"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="hourly-rate">Hourly Rate ($)</Label>
              <div className="relative">
                <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  id="hourly-rate"
                  type="number"
                  step="0.01"
                  min={0}
                  value={hourlyRate}
                  onChange={(e) => setHourlyRate(e.target.value)}
                  placeholder="0.00"
                  className="pl-8"
                  data-testid="input-hourly-rate"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="daily-rate">Daily Rate ($)</Label>
              <div className="relative">
                <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  id="daily-rate"
                  type="number"
                  step="0.01"
                  min={0}
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
              <Label htmlFor="base-location">Base Location</Label>
              <Input
                id="base-location"
                value={baseLocation}
                onChange={(e) => setBaseLocation(e.target.value)}
                placeholder="City, State"
                data-testid="input-base-location"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="travel-radius">Travel Radius (miles)</Label>
              <Input
                id="travel-radius"
                type="number"
                min={0}
                value={travelRadius}
                onChange={(e) => setTravelRadius(e.target.value)}
                placeholder="50"
                data-testid="input-travel-radius"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Availability Status</Label>
            <Select
              value={availabilityStatus}
              onValueChange={setAvailabilityStatus}
            >
              <SelectTrigger data-testid="select-availability-status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {AVAILABILITY_STATUSES.map((s) => (
                  <SelectItem key={s.value} value={s.value}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="available-from">Available From</Label>
              <Input
                id="available-from"
                type="date"
                value={availableFrom}
                onChange={(e) => setAvailableFrom(e.target.value)}
                data-testid="input-available-from"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="available-to">Available To</Label>
              <Input
                id="available-to"
                type="date"
                value={availableTo}
                onChange={(e) => setAvailableTo(e.target.value)}
                data-testid="input-available-to"
              />
            </div>
          </div>

          <Separator />

          <div className="space-y-3">
            <Label className="text-sm font-medium">Contact Information</Label>
            <Input
              value={contactName}
              onChange={(e) => setContactName(e.target.value)}
              placeholder="Contact name"
              data-testid="input-contact-name"
            />
            <div className="grid grid-cols-2 gap-3">
              <Input
                value={contactPhone}
                onChange={(e) => setContactPhone(e.target.value)}
                placeholder="(555) 123-4567"
                data-testid="input-contact-phone"
              />
              <Input
                type="email"
                value={contactEmail}
                onChange={(e) => setContactEmail(e.target.value)}
                placeholder="email@example.com"
                data-testid="input-contact-email"
              />
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Switch
              checked={isPublic}
              onCheckedChange={setIsPublic}
              id="is-public"
              data-testid="switch-is-public"
            />
            <Label htmlFor="is-public">
              Make listing visible to other organizations
            </Label>
          </div>
        </div>
        <DialogFooter className="pt-4">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={isPending}
            data-testid="button-submit-crew-listing"
          >
            {isPending
              ? isEdit
                ? "Saving..."
                : "Creating..."
              : isEdit
                ? "Save Changes"
                : "Create Listing"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============================================
// MARKETPLACE HUB (Main page)
// ============================================
export default function MarketplacePage() {
  const params = new URLSearchParams(window.location.search);
  const initialTab = params.get("tab") || "contractors";
  const validTabs = ["contractors", "talent", "crews", "equipment"];
  const [activeTab, setActiveTab] = useState(validTabs.includes(initialTab) ? initialTab : "contractors");

  return (
    <div
      className="p-6 max-w-full mx-auto space-y-6"
      data-testid="page-marketplace"
    >
      <div>
        <h1 className="text-2xl font-bold" data-testid="text-marketplace-title">
          Marketplace
        </h1>
        <p className="text-muted-foreground mt-1">
          Discover and connect with contractors, crews, and equipment providers
          in your network.
        </p>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger
            value="contractors"
            className="flex items-center gap-2"
            data-testid="tab-contractor-directory"
          >
            <Building2 className="h-4 w-4" />
            Contractors
          </TabsTrigger>
          <TabsTrigger
            value="talent"
            className="flex items-center gap-2"
            data-testid="tab-talent-pool"
          >
            <Users className="h-4 w-4" />
            Talent Pool
          </TabsTrigger>
          <TabsTrigger
            value="crews"
            className="flex items-center gap-2"
            data-testid="tab-crew-marketplace"
          >
            <HardHat className="h-4 w-4" />
            Crews
          </TabsTrigger>
          <TabsTrigger
            value="equipment"
            className="flex items-center gap-2"
            data-testid="tab-equipment-rentals"
          >
            <Truck className="h-4 w-4" />
            Equipment Rentals
          </TabsTrigger>
        </TabsList>

        <TabsContent value="contractors" className="mt-6">
          <ContractorDirectory />
        </TabsContent>

        <TabsContent value="talent" className="mt-6">
          <TalentPoolPage />
        </TabsContent>

        <TabsContent value="crews" className="mt-6">
          <CrewMarketplaceTab />
        </TabsContent>

        <TabsContent value="equipment" className="mt-6">
          <EquipmentRentalMarketplacePage />
        </TabsContent>
      </Tabs>
    </div>
  );
}
