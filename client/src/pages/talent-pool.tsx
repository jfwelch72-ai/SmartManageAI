import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useParams, useLocation, Link } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Separator } from "@/components/ui/separator";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import {
  Search, MapPin, Briefcase, Clock, Star, UserPlus, ArrowLeft,
  Building2, Edit, Eye, EyeOff, Award, Percent, ChevronLeft,
  ChevronRight, Users, Filter, Plus, X, SortAsc, Upload, Loader2,
} from "lucide-react";

const TRADE_OPTIONS = [
  "GENERAL_CONTRACTOR", "ELECTRICAL", "PLUMBING", "HVAC", "ROOFING",
  "CONCRETE", "FRAMING", "DRYWALL", "PAINTING", "FLOORING",
  "LANDSCAPING", "DEMOLITION", "MASONRY", "INSULATION", "CARPENTRY",
  "STEEL_ERECTION", "GLAZING", "FIRE_PROTECTION", "LOW_VOLTAGE",
  "SOLAR", "WATERPROOFING", "OTHER",
];

const AVAILABILITY_OPTIONS = [
  { value: "AVAILABLE", label: "Available", color: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300" },
  { value: "OPEN_TO_OFFERS", label: "Open to Offers", color: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300" },
  { value: "NOT_AVAILABLE", label: "Not Available", color: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300" },
];

function formatTrade(trade: string) {
  return trade.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function initials(firstName: string, lastName: string) {
  return `${firstName?.[0] || ""}${lastName?.[0] || ""}`.toUpperCase();
}

function availabilityBadge(status: string) {
  const opt = AVAILABILITY_OPTIONS.find((o) => o.value === status);
  return opt ? (
    <Badge variant="secondary" className={opt.color}>{opt.label}</Badge>
  ) : (
    <Badge variant="outline">{status}</Badge>
  );
}

interface TalentProfileCard {
  profile: any;
  user: any;
  organization?: any;
  skills?: any[];
  certifications?: string[];
}

function TalentCard({ data }: { data: TalentProfileCard }) {
  const [, navigate] = useLocation();
  const { profile, user, organization, skills = [], certifications = [] } = data;

  return (
    <Card
      className="cursor-pointer hover:shadow-md transition-shadow"
      onClick={() => navigate(`/talent-pool/${profile.id}`)}
      data-testid={`card-talent-${profile.id}`}
    >
      <CardContent className="p-4">
        <div className="flex gap-3">
          <Avatar className="w-14 h-14 shrink-0">
            <AvatarImage src={user.avatarUrl} />
            <AvatarFallback className="bg-primary/10 text-primary text-sm">
              {initials(user.firstName, user.lastName)}
            </AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h3 className="font-semibold text-sm line-clamp-1" data-testid={`text-talent-name-${profile.id}`}>
                  {user.firstName} {user.lastName}
                </h3>
                {profile.headline && (
                  <p className="text-xs text-muted-foreground line-clamp-1">{profile.headline}</p>
                )}
              </div>
              {availabilityBadge(profile.availability)}
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5">
              {profile.tradeSpecialization && (
                <Badge variant="secondary" className="text-xs">
                  {formatTrade(profile.tradeSpecialization)}
                </Badge>
              )}
              {profile.yearsOfExperience != null && (
                <div className="flex items-center gap-1">
                  <Briefcase className="w-3 h-3 text-muted-foreground" />
                  <span className="text-xs text-muted-foreground">
                    {profile.yearsOfExperience} yr{profile.yearsOfExperience !== 1 ? "s" : ""}
                  </span>
                </div>
              )}
              {profile.preferredLocation && (
                <div className="flex items-center gap-1">
                  <MapPin className="w-3 h-3 text-muted-foreground" />
                  <span className="text-xs text-muted-foreground line-clamp-1">{profile.preferredLocation}</span>
                </div>
              )}
            </div>
            {organization?.name && (
              <div className="flex items-center gap-1 mt-1">
                <Building2 className="w-3 h-3 text-muted-foreground" />
                <span className="text-xs text-muted-foreground">{organization.name}</span>
              </div>
            )}
            {skills.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-2">
                {skills.slice(0, 4).map((sk: any) => (
                  <Badge key={sk.id || sk.name} variant="outline" className="text-xs py-0">
                    {sk.name}
                  </Badge>
                ))}
                {skills.length > 4 && (
                  <Badge variant="outline" className="text-xs py-0">+{skills.length - 4}</Badge>
                )}
              </div>
            )}
            <div className="flex justify-end mt-2">
              <Button
                variant="outline"
                size="sm"
                className="text-xs h-7"
                onClick={(e) => { e.stopPropagation(); navigate(`/talent-pool/${profile.id}?recruit=1`); }}
                data-testid={`button-recruit-card-${profile.id}`}
              >
                <UserPlus className="w-3 h-3 mr-1" />
                Recruit
              </Button>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function TalentDirectoryPage() {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [trade, setTrade] = useState("");
  const [availability, setAvailability] = useState("");
  const [location, setLocation] = useState("");
  const [skillFilter, setSkillFilter] = useState("");
  const [certFilter, setCertFilter] = useState("");
  const [minRating, setMinRating] = useState("");
  const [sort, setSort] = useState("newest");
  const [page, setPage] = useState(1);

  const queryParams = new URLSearchParams();
  if (search) queryParams.set("search", search);
  if (trade) queryParams.set("trade", trade);
  if (availability) queryParams.set("availability", availability);
  if (location) queryParams.set("location", location);
  if (skillFilter) queryParams.set("skill", skillFilter);
  if (certFilter) queryParams.set("certification", certFilter);
  if (minRating) queryParams.set("minRating", minRating);
  if (sort) queryParams.set("sort", sort);
  queryParams.set("page", String(page));

  const { data, isLoading } = useQuery<{
    profiles: TalentProfileCard[];
    total: number;
    page: number;
    totalPages: number;
  }>({
    queryKey: ["/api/talent-pool/directory", search, trade, availability, location, skillFilter, certFilter, minRating, sort, page],
    queryFn: async () => {
      const res = await fetch(`/api/talent-pool/directory?${queryParams.toString()}`);
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
  });

  const profiles = data?.profiles ?? [];
  const totalPages = data?.totalPages ?? 1;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold" data-testid="heading-talent-pool">Talent Pool</h1>
          <p className="text-muted-foreground">Discover skilled workers and subcontractors</p>
        </div>
        <Link href="/talent-pool/my-profile">
          <Button variant="outline" data-testid="button-my-talent-profile">
            <Edit className="w-4 h-4 mr-2" />
            My Profile
          </Button>
        </Link>
      </div>

      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex flex-col md:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search by name, trade, or skill..."
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                className="pl-10"
                data-testid="input-talent-search"
              />
            </div>
            <Select value={trade} onValueChange={(v) => { setTrade(v === "all" ? "" : v); setPage(1); }}>
              <SelectTrigger className="w-full md:w-48" data-testid="select-talent-trade">
                <SelectValue placeholder="All Trades" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Trades</SelectItem>
                {TRADE_OPTIONS.map((t) => (
                  <SelectItem key={t} value={t}>{formatTrade(t)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={availability} onValueChange={(v) => { setAvailability(v === "all" ? "" : v); setPage(1); }}>
              <SelectTrigger className="w-full md:w-48" data-testid="select-talent-availability">
                <SelectValue placeholder="Any Availability" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Any Availability</SelectItem>
                {AVAILABILITY_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col md:flex-row gap-3">
            <div className="relative w-full md:w-48">
              <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Location..."
                value={location}
                onChange={(e) => { setLocation(e.target.value); setPage(1); }}
                className="pl-10"
                data-testid="input-talent-location"
              />
            </div>
            <Input
              placeholder="Filter by skill..."
              value={skillFilter}
              onChange={(e) => { setSkillFilter(e.target.value); setPage(1); }}
              className="w-full md:w-48"
              data-testid="input-talent-skill-filter"
            />
            <Input
              placeholder="Filter by certification..."
              value={certFilter}
              onChange={(e) => { setCertFilter(e.target.value); setPage(1); }}
              className="w-full md:w-48"
              data-testid="input-talent-cert-filter"
            />
            <Select value={minRating || "any"} onValueChange={(v) => { setMinRating(v === "any" ? "" : v); setPage(1); }}>
              <SelectTrigger className="w-full md:w-40" data-testid="select-talent-min-rating">
                <SelectValue placeholder="Min Rating" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="any">Any Rating</SelectItem>
                <SelectItem value="1">1+ Stars</SelectItem>
                <SelectItem value="2">2+ Stars</SelectItem>
                <SelectItem value="3">3+ Stars</SelectItem>
                <SelectItem value="4">4+ Stars</SelectItem>
                <SelectItem value="5">5 Stars</SelectItem>
              </SelectContent>
            </Select>
            <Select value={sort} onValueChange={(v) => { setSort(v); setPage(1); }}>
              <SelectTrigger className="w-full md:w-48" data-testid="select-talent-sort">
                <SelectValue placeholder="Sort by" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="newest">Newest First</SelectItem>
                <SelectItem value="updated">Recently Updated</SelectItem>
                <SelectItem value="experience_desc">Most Experience</SelectItem>
                <SelectItem value="experience_asc">Least Experience</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {isLoading ? (
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-36" />
          ))}
        </div>
      ) : profiles.length === 0 ? (
        <div className="text-center py-12">
          <Users className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
          <h3 className="font-semibold text-lg">No Talent Profiles Found</h3>
          <p className="text-muted-foreground text-sm mt-1">
            Try adjusting your filters or search criteria.
          </p>
        </div>
      ) : (
        <>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            {profiles.map((p) => (
              <TalentCard key={p.profile.id} data={p} />
            ))}
          </div>
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                data-testid="button-talent-prev-page"
              >
                <ChevronLeft className="w-4 h-4" />
              </Button>
              <span className="text-sm text-muted-foreground">
                Page {page} of {totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => p + 1)}
                data-testid="button-talent-next-page"
              >
                <ChevronRight className="w-4 h-4" />
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function TalentProfileDetailPage({ profileId }: { profileId: string }) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [recruitJobId, setRecruitJobId] = useState("");
  const [recruitOpen, setRecruitOpen] = useState(
    typeof window !== "undefined" && new URLSearchParams(window.location.search).get("recruit") === "1"
  );
  const [matchJobId, setMatchJobId] = useState("");

  const { data: profile, isLoading } = useQuery<any>({
    queryKey: ["/api/talent-pool/profiles", profileId],
    queryFn: async () => {
      const res = await fetch(`/api/talent-pool/profiles/${profileId}`);
      if (!res.ok) throw new Error("Not found");
      return res.json();
    },
  });

  const { data: jobs = [] } = useQuery<any[]>({
    queryKey: ["/api/hiring/jobs"],
  });

  const { data: matchScore } = useQuery<any>({
    queryKey: ["/api/talent-pool/profiles", profileId, "match-score", matchJobId],
    queryFn: async () => {
      const res = await fetch(`/api/talent-pool/profiles/${profileId}/match-score?jobId=${matchJobId}`);
      if (!res.ok) return null;
      return res.json();
    },
    enabled: !!matchJobId,
  });

  const recruitMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/talent-pool/profiles/${profileId}/recruit`, {
        jobId: recruitJobId && recruitJobId !== "none" ? recruitJobId : null,
      });
      return res.json();
    },
    onSuccess: (data) => {
      toast({ title: "Candidate recruited", description: "Added to your hiring pipeline." });
      setRecruitOpen(false);
      queryClient.invalidateQueries({ queryKey: ["/api/hiring/candidates"] });
      navigate(`/hiring/candidates/${data.id}`);
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  if (isLoading) {
    return (
      <div className="p-6 max-w-4xl mx-auto">
        <Skeleton className="h-8 w-48 mb-4" />
        <Skeleton className="h-48 w-full mb-4" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="p-6 text-center">
        <p className="text-muted-foreground">Profile not found.</p>
        <Link href="/talent-pool">
          <Button variant="outline" className="mt-4">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Talent Pool
          </Button>
        </Link>
      </div>
    );
  }

  const isOwnProfile = profile.profile.userId === user?.id;
  const p = profile.profile;
  const u = profile.user;
  const org = profile.organization;

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <Link href="/talent-pool">
        <Button variant="ghost" size="sm" className="mb-2" data-testid="link-back-talent-pool">
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back to Talent Pool
        </Button>
      </Link>

      <Card>
        <CardContent className="p-6">
          <div className="flex gap-4 items-start">
            <Avatar className="w-20 h-20 shrink-0">
              <AvatarImage src={u.avatarUrl} />
              <AvatarFallback className="bg-primary/10 text-primary text-xl">
                {initials(u.firstName, u.lastName)}
              </AvatarFallback>
            </Avatar>
            <div className="flex-1">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h1 className="text-2xl font-bold" data-testid="text-talent-profile-name">
                    {u.firstName} {u.lastName}
                  </h1>
                  {p.headline && <p className="text-muted-foreground">{p.headline}</p>}
                </div>
                <div className="flex items-center gap-2">
                  {availabilityBadge(p.availability)}
                  {!isOwnProfile && (
                    <Dialog open={recruitOpen} onOpenChange={setRecruitOpen}>
                      <DialogTrigger asChild>
                        <Button data-testid="button-recruit">
                          <UserPlus className="w-4 h-4 mr-2" />
                          Recruit
                        </Button>
                      </DialogTrigger>
                      <DialogContent>
                        <DialogHeader>
                          <DialogTitle>Recruit {u.firstName} {u.lastName}</DialogTitle>
                          <DialogDescription>
                            Add this person to your hiring pipeline as a candidate.
                          </DialogDescription>
                        </DialogHeader>
                        <div className="py-4">
                          <Label>Assign to Job (optional)</Label>
                          <Select value={recruitJobId} onValueChange={setRecruitJobId}>
                            <SelectTrigger data-testid="select-recruit-job">
                              <SelectValue placeholder="No specific job" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="none">No specific job</SelectItem>
                              {jobs.filter((j: any) => j.status === "PUBLISHED").map((j: any) => (
                                <SelectItem key={j.id} value={j.id}>{j.title}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <DialogFooter>
                          <Button variant="outline" onClick={() => setRecruitOpen(false)}>Cancel</Button>
                          <Button
                            onClick={() => recruitMutation.mutate()}
                            disabled={recruitMutation.isPending}
                            data-testid="button-confirm-recruit"
                          >
                            {recruitMutation.isPending ? "Recruiting..." : "Add to Pipeline"}
                          </Button>
                        </DialogFooter>
                      </DialogContent>
                    </Dialog>
                  )}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2">
                {p.tradeSpecialization && (
                  <Badge variant="secondary">{formatTrade(p.tradeSpecialization)}</Badge>
                )}
                {p.yearsOfExperience != null && (
                  <div className="flex items-center gap-1">
                    <Briefcase className="w-4 h-4 text-muted-foreground" />
                    <span className="text-sm text-muted-foreground">{p.yearsOfExperience} years experience</span>
                  </div>
                )}
                {p.preferredLocation && (
                  <div className="flex items-center gap-1">
                    <MapPin className="w-4 h-4 text-muted-foreground" />
                    <span className="text-sm text-muted-foreground">{p.preferredLocation}</span>
                  </div>
                )}
                {p.workRadiusMiles && (
                  <span className="text-sm text-muted-foreground">({p.workRadiusMiles} mi radius)</span>
                )}
              </div>
              {org?.name && (
                <div className="flex items-center gap-1 mt-1">
                  <Building2 className="w-4 h-4 text-muted-foreground" />
                  <Link href={`/marketplace/contractors/${org.id}`}>
                    <span className="text-sm text-primary hover:underline cursor-pointer" data-testid="link-org-marketplace">
                      {org.name}
                    </span>
                  </Link>
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid md:grid-cols-3 gap-6">
        <div className="md:col-span-2 space-y-6">
          {p.bio && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">About</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground whitespace-pre-wrap" data-testid="text-talent-bio">{p.bio}</p>
              </CardContent>
            </Card>
          )}

          {profile.skills?.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Skills</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-2">
                  {profile.skills.map((s: any) => (
                    <Badge key={s.skill?.id || s.id} variant="secondary" className="text-sm" data-testid={`badge-skill-${s.skill?.id || s.id}`}>
                      {s.skill?.name || s.name}
                      {s.proficiency && ` (${s.proficiency})`}
                      {s.yearsExperience && ` · ${s.yearsExperience}yr`}
                    </Badge>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {profile.certifications?.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Certifications</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {profile.certifications.map((cert: any) => (
                    <div key={cert.id || cert.certificationName} className="flex items-center gap-2" data-testid={`cert-${cert.id}`}>
                      <Award className="w-4 h-4 text-primary shrink-0" />
                      <div>
                        <p className="text-sm font-medium">{cert.certificationName || cert}</p>
                        {cert.expiryDate && (
                          <p className="text-xs text-muted-foreground">
                            Expires: {new Date(cert.expiryDate).toLocaleDateString()}
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {p.portfolioPhotos?.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Portfolio</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-3 gap-2">
                  {p.portfolioPhotos.map((url: string, i: number) => (
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
        </div>

        <div className="space-y-6">
          {(p.desiredPayMin || p.desiredPayMax) && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Desired Pay</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-lg font-semibold" data-testid="text-desired-pay">
                  {p.desiredPayMin && p.desiredPayMax
                    ? `$${Number(p.desiredPayMin).toLocaleString()} - $${Number(p.desiredPayMax).toLocaleString()}`
                    : p.desiredPayMin
                      ? `From $${Number(p.desiredPayMin).toLocaleString()}`
                      : `Up to $${Number(p.desiredPayMax).toLocaleString()}`}
                  {p.payType && <span className="text-sm text-muted-foreground ml-1">/ {p.payType}</span>}
                </p>
              </CardContent>
            </Card>
          )}

          {!isOwnProfile && jobs.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Percent className="w-4 h-4" />
                  Skill Match
                </CardTitle>
                <CardDescription>Compare this candidate against a job posting</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <Select value={matchJobId} onValueChange={setMatchJobId}>
                  <SelectTrigger data-testid="select-match-job">
                    <SelectValue placeholder="Select a job" />
                  </SelectTrigger>
                  <SelectContent>
                    {jobs.filter((j: any) => j.status === "PUBLISHED").map((j: any) => (
                      <SelectItem key={j.id} value={j.id}>{j.title}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {matchScore && (
                  <div className="text-center space-y-2" data-testid="match-score-result">
                    <div className={`inline-flex items-center gap-1 text-2xl font-bold ${
                      matchScore.matchScore >= 70 ? "text-green-600" :
                      matchScore.matchScore >= 40 ? "text-yellow-600" : "text-red-600"
                    }`}>
                      {matchScore.matchScore}%
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Match for {matchScore.jobTitle}
                    </p>
                    {matchScore.matchedSkills?.length > 0 && (
                      <div className="flex flex-wrap gap-1 justify-center">
                        {matchScore.matchedSkills.map((s: string) => (
                          <Badge key={s} variant="secondary" className="text-xs">{s}</Badge>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {u.email && !isOwnProfile && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Contact</CardTitle>
              </CardHeader>
              <CardContent className="space-y-1">
                <p className="text-sm" data-testid="text-talent-email">{u.email}</p>
                {u.phone && <p className="text-sm" data-testid="text-talent-phone">{u.phone}</p>}
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

function MyTalentProfilePage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [, navigate] = useLocation();

  const { data: profileData, isLoading } = useQuery<any>({
    queryKey: ["/api/talent-pool/my-profile"],
    queryFn: async () => {
      const res = await fetch("/api/talent-pool/my-profile");
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
  });

  const [bio, setBio] = useState("");
  const [headline, setHeadline] = useState("");
  const [tradeSpecialization, setTradeSpecialization] = useState("");
  const [yearsOfExperience, setYearsOfExperience] = useState("");
  const [availability, setAvailability] = useState("AVAILABLE");
  const [visibility, setVisibility] = useState("PUBLIC");
  const [preferredLocation, setPreferredLocation] = useState("");
  const [workRadiusMiles, setWorkRadiusMiles] = useState("");
  const [desiredPayMin, setDesiredPayMin] = useState("");
  const [desiredPayMax, setDesiredPayMax] = useState("");
  const [payType, setPayType] = useState("hour");
  const [resumeUrl, setResumeUrl] = useState("");
  const [portfolioPhotos, setPortfolioPhotos] = useState<string[]>([]);
  const [newPhotoUrl, setNewPhotoUrl] = useState("");
  const [isPublished, setIsPublished] = useState(false);
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    if (initialized) return;
    if (profileData) {
      const p = profileData;
      setBio(p.bio || "");
      setHeadline(p.headline || "");
      setTradeSpecialization(p.tradeSpecialization || user?.tradeSpecialization || "");
      setYearsOfExperience(p.yearsOfExperience?.toString() || "");
      setAvailability(p.availability || "AVAILABLE");
      setVisibility(p.visibility || "PUBLIC");
      setPreferredLocation(p.preferredLocation || "");
      setWorkRadiusMiles(p.workRadiusMiles?.toString() || "");
      setDesiredPayMin(p.desiredPayMin || "");
      setDesiredPayMax(p.desiredPayMax || "");
      setPayType(p.payType || "hour");
      setResumeUrl(p.resumeUrl || "");
      setPortfolioPhotos(p.portfolioPhotos || []);
      setIsPublished(p.isPublished ?? false);
      setInitialized(true);
    } else if (!isLoading) {
      setTradeSpecialization(user?.tradeSpecialization || "");
      setInitialized(true);
    }
  }, [profileData, isLoading, initialized, user?.tradeSpecialization]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const body = {
        bio: bio || null,
        headline: headline || null,
        tradeSpecialization: tradeSpecialization || null,
        yearsOfExperience: yearsOfExperience ? parseInt(yearsOfExperience, 10) : null,
        availability,
        visibility,
        preferredLocation: preferredLocation || null,
        workRadiusMiles: workRadiusMiles ? parseInt(workRadiusMiles, 10) : null,
        desiredPayMin: desiredPayMin || null,
        desiredPayMax: desiredPayMax || null,
        payType: payType || null,
        resumeUrl: resumeUrl || null,
        portfolioPhotos,
        isPublished,
      };
      const res = await apiRequest("PUT", "/api/talent-pool/my-profile", body);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Profile saved" });
      queryClient.invalidateQueries({ queryKey: ["/api/talent-pool/my-profile"] });
      queryClient.invalidateQueries({ queryKey: ["/api/talent-pool/directory"] });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  if (isLoading) {
    return (
      <div className="p-6 max-w-3xl mx-auto">
        <Skeleton className="h-8 w-48 mb-4" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/talent-pool">
          <Button variant="ghost" size="sm" data-testid="link-back-talent-pool-edit">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-bold" data-testid="heading-my-talent-profile">My Talent Profile</h1>
          <p className="text-muted-foreground">Build your discoverable profile for recruiters</p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Profile Visibility</CardTitle>
          <CardDescription>Control who can see your talent profile</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {isPublished ? <Eye className="w-4 h-4 text-green-600" /> : <EyeOff className="w-4 h-4 text-muted-foreground" />}
              <Label>Published</Label>
            </div>
            <Switch checked={isPublished} onCheckedChange={setIsPublished} data-testid="toggle-profile-published" />
          </div>
          <Select value={visibility} onValueChange={setVisibility}>
            <SelectTrigger data-testid="select-profile-visibility">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="PUBLIC">Public - Visible to all users</SelectItem>
              <SelectItem value="CONNECTIONS_ONLY">Connections Only</SelectItem>
              <SelectItem value="PRIVATE">Private - Only you</SelectItem>
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Basic Information</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1">
            <Label>Headline</Label>
            <Input
              placeholder="e.g., Experienced Commercial Electrician"
              value={headline}
              onChange={(e) => setHeadline(e.target.value)}
              data-testid="input-talent-headline"
            />
          </div>
          <div className="space-y-1">
            <Label>Bio</Label>
            <Textarea
              placeholder="Tell recruiters about yourself, your experience, and what you're looking for..."
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              rows={4}
              data-testid="input-talent-bio"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label>Trade Specialization</Label>
              <Select value={tradeSpecialization} onValueChange={setTradeSpecialization}>
                <SelectTrigger data-testid="select-talent-trade-edit">
                  <SelectValue placeholder="Select trade" />
                </SelectTrigger>
                <SelectContent>
                  {TRADE_OPTIONS.map((t) => (
                    <SelectItem key={t} value={t}>{formatTrade(t)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Years of Experience</Label>
              <Input
                type="number"
                min="0"
                placeholder="e.g., 5"
                value={yearsOfExperience}
                onChange={(e) => setYearsOfExperience(e.target.value)}
                data-testid="input-talent-years"
              />
            </div>
          </div>
          <div className="space-y-1">
            <Label>Availability</Label>
            <Select value={availability} onValueChange={setAvailability}>
              <SelectTrigger data-testid="select-talent-availability-edit">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {AVAILABILITY_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Location & Pay</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label>Preferred Location</Label>
              <Input
                placeholder="e.g., Austin, TX"
                value={preferredLocation}
                onChange={(e) => setPreferredLocation(e.target.value)}
                data-testid="input-talent-preferred-location"
              />
            </div>
            <div className="space-y-1">
              <Label>Work Radius (miles)</Label>
              <Input
                type="number"
                min="0"
                placeholder="e.g., 50"
                value={workRadiusMiles}
                onChange={(e) => setWorkRadiusMiles(e.target.value)}
                data-testid="input-talent-radius"
              />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-1">
              <Label>Min Pay</Label>
              <Input
                type="number"
                min="0"
                placeholder="e.g., 25"
                value={desiredPayMin}
                onChange={(e) => setDesiredPayMin(e.target.value)}
                data-testid="input-talent-pay-min"
              />
            </div>
            <div className="space-y-1">
              <Label>Max Pay</Label>
              <Input
                type="number"
                min="0"
                placeholder="e.g., 45"
                value={desiredPayMax}
                onChange={(e) => setDesiredPayMax(e.target.value)}
                data-testid="input-talent-pay-max"
              />
            </div>
            <div className="space-y-1">
              <Label>Pay Type</Label>
              <Select value={payType} onValueChange={setPayType}>
                <SelectTrigger data-testid="select-talent-pay-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="hour">Per Hour</SelectItem>
                  <SelectItem value="year">Per Year</SelectItem>
                  <SelectItem value="project">Per Project</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Resume & Portfolio</CardTitle>
          <CardDescription>Add your resume link and portfolio work photos</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1">
            <Label>Resume URL</Label>
            <Input
              placeholder="https://example.com/my-resume.pdf"
              value={resumeUrl}
              onChange={(e) => setResumeUrl(e.target.value)}
              data-testid="input-talent-resume-url"
            />
          </div>
          <PortfolioPhotoUploader
            photos={portfolioPhotos}
            onPhotosChange={setPortfolioPhotos}
            newPhotoUrl={newPhotoUrl}
            onNewPhotoUrlChange={setNewPhotoUrl}
          />
        </CardContent>
      </Card>

      <SkillsManager tradeSpecialization={tradeSpecialization} />

      <CertificationsManager />

      <div className="flex justify-end">
        <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending} data-testid="button-save-talent-profile">
          {saveMutation.isPending ? "Saving..." : "Save Profile"}
        </Button>
      </div>
    </div>
  );
}

function PortfolioPhotoUploader({
  photos,
  onPhotosChange,
  newPhotoUrl,
  onNewPhotoUrlChange,
}: {
  photos: string[];
  onPhotosChange: (photos: string[]) => void;
  newPhotoUrl: string;
  onNewPhotoUrlChange: (url: string) => void;
}) {
  const { toast } = useToast();
  const [isUploading, setIsUploading] = useState(false);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const formData = new FormData();
    for (let i = 0; i < files.length; i++) {
      formData.append("photos", files[i]);
    }

    setIsUploading(true);
    try {
      const res = await fetch("/api/talent-pool/upload-portfolio-photos", {
        method: "POST",
        body: formData,
        credentials: "include",
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Upload failed");
      }
      const data = await res.json();
      onPhotosChange([...photos, ...data.urls]);
      toast({ title: "Photos uploaded", description: `${data.urls.length} photo(s) added to portfolio` });
    } catch (err) {
      toast({ title: "Upload failed", description: err instanceof Error ? err.message : "Could not upload photos", variant: "destructive" });
    } finally {
      setIsUploading(false);
      e.target.value = "";
    }
  };

  return (
    <div className="space-y-2">
      <Label>Portfolio / Work Photos</Label>
      {photos.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {photos.map((url, i) => (
            <div key={i} className="relative group rounded-md overflow-hidden border">
              <img src={url} alt={`Portfolio ${i + 1}`} className="w-full h-32 object-cover" />
              <Button
                variant="destructive"
                size="icon"
                className="absolute top-1 right-1 h-6 w-6 opacity-0 group-hover:opacity-100 transition"
                onClick={() => onPhotosChange(photos.filter((_, j) => j !== i))}
                data-testid={`button-remove-portfolio-${i}`}
              >
                <X className="h-3 w-3" />
              </Button>
            </div>
          ))}
        </div>
      )}
      <div className="flex gap-2 items-center">
        <label className="cursor-pointer" data-testid="button-upload-portfolio-photos">
          <input
            type="file"
            accept="image/jpeg,image/png,image/gif,image/webp"
            multiple
            className="hidden"
            onChange={handleFileUpload}
            disabled={isUploading}
          />
          <div className="flex items-center gap-2 px-4 py-2 border rounded-md bg-background hover:bg-accent transition text-sm font-medium">
            {isUploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            {isUploading ? "Uploading..." : "Upload Photos"}
          </div>
        </label>
        <span className="text-muted-foreground text-xs">or</span>
        <Input
          placeholder="Paste image URL..."
          value={newPhotoUrl}
          onChange={(e) => onNewPhotoUrlChange(e.target.value)}
          className="flex-1"
          data-testid="input-talent-portfolio-url"
        />
        <Button
          variant="outline"
          disabled={!newPhotoUrl.trim()}
          onClick={() => {
            if (newPhotoUrl.trim()) {
              onPhotosChange([...photos, newPhotoUrl.trim()]);
              onNewPhotoUrlChange("");
            }
          }}
          data-testid="button-add-portfolio-photo"
        >
          Add
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">Supports JPEG, PNG, GIF, WebP. Max 10MB per file.</p>
    </div>
  );
}

function SkillsManager({ tradeSpecialization }: { tradeSpecialization?: string }) {
  const { toast } = useToast();
  const [newSkill, setNewSkill] = useState("");

  const { data: mySkills = [], isLoading } = useQuery<any[]>({
    queryKey: ["/api/talent-pool/my-skills"],
    queryFn: async () => {
      const res = await fetch("/api/talent-pool/my-skills");
      if (!res.ok) return [];
      return res.json();
    },
  });

  const { data: suggestions = [] } = useQuery<any[]>({
    queryKey: ["/api/talent-pool/skill-suggestions", newSkill, tradeSpecialization],
    queryFn: async () => {
      if (!newSkill.trim()) return [];
      const params = new URLSearchParams({ q: newSkill });
      if (tradeSpecialization) params.set("trade", tradeSpecialization);
      const res = await fetch(`/api/talent-pool/skill-suggestions?${params.toString()}`);
      if (!res.ok) return [];
      return res.json();
    },
    enabled: newSkill.length >= 2,
  });

  const addMutation = useMutation({
    mutationFn: async (skillName: string) => {
      const res = await apiRequest("POST", "/api/talent-pool/my-skills", { skillName });
      return res.json();
    },
    onSuccess: () => {
      setNewSkill("");
      queryClient.invalidateQueries({ queryKey: ["/api/talent-pool/my-skills"] });
      queryClient.invalidateQueries({ queryKey: ["/api/talent-pool/directory"] });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const removeMutation = useMutation({
    mutationFn: async (skillId: string) => {
      await apiRequest("DELETE", `/api/talent-pool/my-skills/${skillId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/talent-pool/my-skills"] });
      queryClient.invalidateQueries({ queryKey: ["/api/talent-pool/directory"] });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Skills</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {mySkills.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {mySkills.map((s: any) => (
              <Badge key={s.id} variant="secondary" className="text-sm gap-1 pr-1" data-testid={`badge-my-skill-${s.id}`}>
                {s.name}
                <button
                  onClick={() => removeMutation.mutate(s.id)}
                  className="ml-1 hover:text-destructive"
                  data-testid={`button-remove-skill-${s.id}`}
                >
                  <X className="w-3 h-3" />
                </button>
              </Badge>
            ))}
          </div>
        )}
        <div className="relative">
          <Input
            placeholder="Type to search skills..."
            value={newSkill}
            onChange={(e) => setNewSkill(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && newSkill.trim()) {
                addMutation.mutate(newSkill.trim());
              }
            }}
            data-testid="input-add-skill"
          />
          {suggestions.length > 0 && newSkill.length >= 2 && (
            <div className="absolute z-10 mt-1 w-full bg-background border rounded-md shadow-lg max-h-48 overflow-y-auto">
              {suggestions.map((s: any) => (
                <button
                  key={s.id}
                  className="w-full text-left px-3 py-2 text-sm hover:bg-muted"
                  onClick={() => {
                    addMutation.mutate(s.name);
                  }}
                  data-testid={`suggestion-skill-${s.id}`}
                >
                  {s.name}
                </button>
              ))}
            </div>
          )}
        </div>
        <p className="text-xs text-muted-foreground">Press Enter or click a suggestion to add a skill.</p>
      </CardContent>
    </Card>
  );
}

function CertificationsManager() {
  const { toast } = useToast();
  const [newCertName, setNewCertName] = useState("");

  const { data: myCerts = [] } = useQuery<any[]>({
    queryKey: ["/api/talent-pool/my-certifications"],
    queryFn: async () => {
      const res = await fetch("/api/talent-pool/my-certifications");
      if (!res.ok) return [];
      return res.json();
    },
  });

  const addCertMutation = useMutation({
    mutationFn: async (name: string) => {
      const res = await apiRequest("POST", "/api/talent-pool/my-certifications", { certificationName: name });
      return res.json();
    },
    onSuccess: () => {
      setNewCertName("");
      queryClient.invalidateQueries({ queryKey: ["/api/talent-pool/my-certifications"] });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const removeCertMutation = useMutation({
    mutationFn: async (certId: string) => {
      await apiRequest("DELETE", `/api/talent-pool/my-certifications/${certId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/talent-pool/my-certifications"] });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Certifications</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {myCerts.length > 0 && (
          <div className="space-y-2">
            {myCerts.map((c: any) => (
              <div key={c.id} className="flex items-center justify-between gap-2" data-testid={`cert-edit-${c.id}`}>
                <div className="flex items-center gap-2">
                  <Award className="w-4 h-4 text-primary shrink-0" />
                  <span className="text-sm">{c.certificationName}</span>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 w-6 p-0 text-destructive hover:text-destructive"
                  onClick={() => removeCertMutation.mutate(c.id)}
                  data-testid={`button-remove-cert-${c.id}`}
                >
                  <X className="w-3.5 h-3.5" />
                </Button>
              </div>
            ))}
          </div>
        )}
        <div className="flex gap-2">
          <Input
            placeholder="Add certification name..."
            value={newCertName}
            onChange={(e) => setNewCertName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && newCertName.trim()) addCertMutation.mutate(newCertName.trim());
            }}
            data-testid="input-add-cert"
          />
          <Button
            variant="outline"
            size="sm"
            onClick={() => { if (newCertName.trim()) addCertMutation.mutate(newCertName.trim()); }}
            disabled={!newCertName.trim()}
            data-testid="button-add-cert"
          >
            <Plus className="w-4 h-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export default function TalentPoolPage() {
  const params = useParams<{ id?: string }>();

  if (params.id === "my-profile") {
    return <MyTalentProfilePage />;
  }

  if (params.id) {
    return <TalentProfileDetailPage profileId={params.id} />;
  }

  return <TalentDirectoryPage />;
}
