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
import {
  Building2,
  Star,
  MapPin,
  Briefcase,
  Search,
  ChevronRight,
  Clock,
  Shield,
  Image as ImageIcon,
  Users,
  Truck,
  ArrowLeft,
} from "lucide-react";
import { Link } from "wouter";
import { cn } from "@/lib/utils";

const TRADE_OPTIONS = [
  "GENERAL_CONTRACTOR",
  "ELECTRICAL",
  "PLUMBING",
  "HVAC",
  "ROOFING",
  "CONCRETE",
  "FRAMING",
  "DRYWALL",
  "PAINTING",
  "FLOORING",
  "LANDSCAPING",
  "DEMOLITION",
  "MASONRY",
  "INSULATION",
  "WINDOWS_DOORS",
  "SIDING",
  "TILE",
  "CABINETRY",
  "COUNTERTOPS",
  "FENCING",
  "DECKING",
  "SOLAR",
  "OTHER",
];

function formatTrade(trade: string) {
  return trade.replace(/_/g, " ");
}

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

function StarRating({ rating, size = "sm" }: { rating: number; size?: "sm" | "lg" }) {
  const cls = size === "lg" ? "w-5 h-5" : "w-4 h-4";
  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((star) => (
        <Star
          key={star}
          className={cn(cls, star <= Math.round(rating) ? "text-yellow-400 fill-yellow-400" : "text-muted-foreground")}
        />
      ))}
    </div>
  );
}

function InteractiveStarRating({ value, onChange }: { value: number; onChange: (v: number) => void }) {
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
              star <= (hover || value) ? "text-yellow-400 fill-yellow-400" : "text-muted-foreground"
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
              <h3 className="font-semibold text-sm line-clamp-1" data-testid={`text-contractor-name-${contractor.orgId}`}>{contractor.name}</h3>
              <Badge variant="secondary" className="shrink-0 text-xs">
                {formatTrade(contractor.tradeType)}
              </Badge>
            </div>
            {contractor.avgRating !== null && (
              <div className="flex items-center gap-1.5 mt-1">
                <StarRating rating={contractor.avgRating} />
                <span className="text-xs text-muted-foreground" data-testid={`text-rating-${contractor.orgId}`}>
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
              {contractor.yearsInBusiness != null && contractor.yearsInBusiness > 0 && (
                <div className="flex items-center gap-1">
                  <Briefcase className="w-3 h-3 text-muted-foreground shrink-0" />
                  <span className="text-xs text-muted-foreground" data-testid={`text-years-${contractor.orgId}`}>
                    {contractor.yearsInBusiness} yr{contractor.yearsInBusiness !== 1 ? "s" : ""}
                  </span>
                </div>
              )}
            </div>
            {contractor.bio && (
              <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{contractor.bio}</p>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function ReviewForm({ orgId, onSuccess }: { orgId: string; onSuccess: () => void }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  const [projectRef, setProjectRef] = useState("");

  const mutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/marketplace/contractors/${orgId}/reviews`, {
        rating,
        comment: comment || null,
        projectRef: projectRef || null,
      });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Review submitted", description: "Thank you for your feedback." });
      setOpen(false);
      setRating(0);
      setComment("");
      setProjectRef("");
      onSuccess();
    },
    onError: (err: unknown) => {
      const message = err instanceof Error ? err.message : "Failed to submit review";
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
          <DialogDescription>Share your experience working with this contractor.</DialogDescription>
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
            <Label htmlFor="review-project-ref">Project Reference (optional)</Label>
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
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
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
export function ContractorProfilePage() {
  const { orgId } = useParams<{ orgId: string }>();
  const { user } = useAuth();

  const { data: profile, isLoading: profileLoading } = useQuery<ContractorProfile>({
    queryKey: ["/api/marketplace/contractors", orgId],
    queryFn: async () => {
      const res = await fetch(`/api/marketplace/contractors/${orgId}`);
      if (!res.ok) throw new Error("Not found");
      return res.json();
    },
  });

  const { data: reviews = [], isLoading: reviewsLoading, refetch: refetchReviews } = useQuery<Review[]>({
    queryKey: ["/api/marketplace/contractors", orgId, "reviews"],
    queryFn: async () => {
      const res = await fetch(`/api/marketplace/contractors/${orgId}/reviews`);
      if (!res.ok) return [];
      return res.json();
    },
  });

  const isOwnOrg = user?.organizationId === orgId;
  const hasReviewed = reviews.some((r) => r.reviewerOrg.id === user?.organizationId);

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
        <p className="text-muted-foreground">Contractor not found in the directory.</p>
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
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      <div>
        <Link href="/marketplace">
          <Button variant="ghost" size="sm" className="mb-4" data-testid="link-back-directory">
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
                  <img src={profile.logoUrl} alt={profile.name} className="w-20 h-20 rounded-xl object-cover" />
                ) : (
                  <Building2 className="w-10 h-10 text-muted-foreground" />
                )}
              </div>
              <div className="flex-1">
                <div className="flex flex-wrap items-start gap-2 justify-between">
                  <h1 className="text-2xl font-bold" data-testid="text-contractor-profile-name">{profile.name}</h1>
                  <Badge>{formatTrade(profile.tradeType)}</Badge>
                </div>
                {profile.avgRating !== null && (
                  <div className="flex items-center gap-2 mt-1">
                    <StarRating rating={profile.avgRating} size="lg" />
                    <span className="font-medium">{profile.avgRating.toFixed(1)}</span>
                    <span className="text-muted-foreground">({profile.reviewCount} reviews)</span>
                  </div>
                )}
                {profile.serviceAreas.length > 0 && (
                  <div className="flex items-center gap-1 mt-2">
                    <MapPin className="w-4 h-4 text-muted-foreground" />
                    <span className="text-sm text-muted-foreground">{profile.serviceAreas.join(", ")}</span>
                  </div>
                )}
                {profile.foundedYear && (
                  <div className="flex items-center gap-1 mt-1">
                    <Clock className="w-4 h-4 text-muted-foreground" />
                    <span className="text-sm text-muted-foreground">Founded {profile.foundedYear}</span>
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
                  <p className="text-sm text-muted-foreground whitespace-pre-wrap" data-testid="text-contractor-bio">
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
                  <CardTitle className="text-base">Reviews ({reviews.length})</CardTitle>
                  {!isOwnOrg && !hasReviewed && (
                    <ReviewForm orgId={orgId!} onSuccess={() => refetchReviews()} />
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
                  <p className="text-sm text-muted-foreground text-center py-4">No reviews yet.</p>
                ) : (
                  <div className="space-y-4">
                    {reviews.map((review) => (
                      <div key={review.id} className="border-b last:border-0 pb-4 last:pb-0" data-testid={`review-${review.id}`}>
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <p className="text-sm font-medium">{review.reviewerOrg.name}</p>
                            <StarRating rating={review.rating} />
                          </div>
                          <span className="text-xs text-muted-foreground">
                            {new Date(review.createdAt).toLocaleDateString()}
                          </span>
                        </div>
                        {review.comment && (
                          <p className="text-sm text-muted-foreground mt-2">{review.comment}</p>
                        )}
                        {review.projectRef && (
                          <p className="text-xs text-muted-foreground mt-1">Project: {review.projectRef}</p>
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
            {(profile.certifications.length > 0 || profile.licenseNumbers.length > 0) && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm flex items-center gap-1.5">
                    <Shield className="w-4 h-4" />
                    Certifications, Licenses & Insurance
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {profile.certifications.map((c) => (
                    <Badge key={c} variant="outline" className="text-xs w-full justify-start" data-testid={`badge-cert-${c}`}>
                      {c}
                    </Badge>
                  ))}
                  {profile.licenseNumbers.map((l) => (
                    <p key={l} className="text-xs text-muted-foreground" data-testid={`text-license-${l}`}>
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
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================
// CONTRACTOR DIRECTORY LIST PAGE
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
    queryKey: ["/api/marketplace/contractors", search, tradeFilter, locationFilter, minRating],
    queryFn: async () => {
      const res = await fetch(`/api/marketplace/contractors?${params.toString()}`);
      if (!res.ok) throw new Error("Failed to load");
      return res.json();
    },
  });

  return (
    <div className="space-y-4">
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
              <SelectTrigger className="w-[180px]" data-testid="select-trade-filter">
                <SelectValue placeholder="All Trades" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Trades</SelectItem>
                {TRADE_OPTIONS.map((t) => (
                  <SelectItem key={t} value={t}>{formatTrade(t)}</SelectItem>
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
              <SelectTrigger className="w-[140px]" data-testid="select-rating-filter">
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

// ============================================
// MARKETPLACE HUB (Main page)
// ============================================
export default function MarketplacePage() {
  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold" data-testid="text-marketplace-title">Marketplace</h1>
        <p className="text-muted-foreground mt-1">
          Discover and connect with contractors, crews, and equipment providers in your network.
        </p>
      </div>

      <Tabs defaultValue="contractors" data-testid="marketplace-tabs">
        <TabsList>
          <TabsTrigger value="contractors" data-testid="tab-contractor-directory">
            Contractor Directory
          </TabsTrigger>
          <TabsTrigger value="crew" data-testid="tab-crew-marketplace">
            Crew Marketplace
            <Badge variant="secondary" className="ml-2 text-xs">Coming Soon</Badge>
          </TabsTrigger>
          <TabsTrigger value="equipment" data-testid="tab-equipment-rentals">
            Equipment Rentals
            <Badge variant="secondary" className="ml-2 text-xs">Coming Soon</Badge>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="contractors" className="mt-6">
          <ContractorDirectory />
        </TabsContent>

        <TabsContent value="crew" className="mt-6">
          <Card>
            <CardContent className="py-16 text-center">
              <Users className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-lg font-semibold">Crew Marketplace</h3>
              <p className="text-muted-foreground mt-2 max-w-md mx-auto">
                Browse and hire skilled crews for your projects. This section is coming soon.
              </p>
              <Badge variant="secondary" className="mt-4">Coming Soon</Badge>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="equipment" className="mt-6">
          <Card>
            <CardContent className="py-16 text-center">
              <Truck className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-lg font-semibold">Equipment Rentals</h3>
              <p className="text-muted-foreground mt-2 max-w-md mx-auto">
                Find and rent construction equipment from trusted providers. This section is coming soon.
              </p>
              <Badge variant="secondary" className="mt-4">Coming Soon</Badge>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
