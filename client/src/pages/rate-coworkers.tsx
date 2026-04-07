import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Separator } from "@/components/ui/separator";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useFeaturePermission } from "@/hooks/use-dashboard-customization";
import { Star, Users, TrendingUp, MessageSquare, CheckCircle, ArrowLeft } from "lucide-react";

interface RateableCoworker {
  id: string;
  firstName: string;
  lastName: string;
  role: string;
  alreadyRated: boolean;
}

interface MyScores {
  avgTeamwork: number | null;
  avgReliability: number | null;
  avgCommunication: number | null;
  avgHelpfulness: number | null;
  totalRatings: number;
}

const CATEGORIES = [
  { key: "teamwork", label: "Teamwork", icon: Users, color: "text-blue-500" },
  { key: "reliability", label: "Reliability", icon: CheckCircle, color: "text-green-500" },
  { key: "communication", label: "Communication", icon: MessageSquare, color: "text-purple-500" },
  { key: "helpfulness", label: "Helpfulness", icon: TrendingUp, color: "text-orange-500" },
] as const;

function StarRating({ value, onChange, readonly = false, size = "md" }: {
  value: number;
  onChange?: (v: number) => void;
  readonly?: boolean;
  size?: "sm" | "md";
}) {
  const [hover, setHover] = useState(0);
  const sizeClass = size === "sm" ? "w-4 h-4" : "w-6 h-6";

  return (
    <div className="flex gap-0.5" data-testid="star-rating">
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          type="button"
          disabled={readonly}
          className={`${readonly ? "cursor-default" : "cursor-pointer hover:scale-110"} transition-transform`}
          onMouseEnter={() => !readonly && setHover(star)}
          onMouseLeave={() => !readonly && setHover(0)}
          onClick={() => onChange?.(star)}
          data-testid={`star-${star}`}
        >
          <Star
            className={`${sizeClass} ${
              star <= (hover || value)
                ? "fill-yellow-400 text-yellow-400"
                : "text-muted-foreground/30"
            } transition-colors`}
          />
        </button>
      ))}
    </div>
  );
}

function RatingForm({ coworker, onBack }: { coworker: RateableCoworker; onBack: () => void }) {
  const { toast } = useToast();
  const [ratings, setRatings] = useState({ teamwork: 0, reliability: 0, communication: 0, helpfulness: 0 });
  const [comment, setComment] = useState("");

  const submitMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/peer-ratings", {
        rateeId: coworker.id,
        ...ratings,
        comment: comment.trim() || undefined,
      });
    },
    onSuccess: () => {
      toast({ title: "Rating submitted", description: `Your rating for ${coworker.firstName} has been recorded.` });
      queryClient.invalidateQueries({ queryKey: ["/api/peer-ratings/rateable-coworkers"] });
      onBack();
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const allRated = Object.values(ratings).every((v) => v > 0);
  const initials = `${coworker.firstName?.[0] || ""}${coworker.lastName?.[0] || ""}`.toUpperCase();

  return (
    <div className="space-y-6">
      <Button variant="ghost" onClick={onBack} className="gap-2 mb-2" data-testid="button-back-to-list">
        <ArrowLeft className="w-4 h-4" /> Back to list
      </Button>

      <Card data-testid="rating-form-card">
        <CardHeader>
          <div className="flex items-center gap-3">
            <Avatar className="h-12 w-12">
              <AvatarFallback className="bg-primary/10 text-primary font-semibold">{initials}</AvatarFallback>
            </Avatar>
            <div>
              <CardTitle data-testid="text-ratee-name">{coworker.firstName} {coworker.lastName}</CardTitle>
              <CardDescription>{coworker.role}</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          {CATEGORIES.map(({ key, label, icon: Icon, color }) => (
            <div key={key} className="flex items-center justify-between" data-testid={`rating-category-${key}`}>
              <div className="flex items-center gap-2">
                <Icon className={`w-5 h-5 ${color}`} />
                <span className="font-medium">{label}</span>
              </div>
              <StarRating
                value={ratings[key as keyof typeof ratings]}
                onChange={(v) => setRatings((prev) => ({ ...prev, [key]: v }))}
              />
            </div>
          ))}

          <Separator />

          <div className="space-y-2">
            <label className="text-sm font-medium">Comment (optional)</label>
            <Textarea
              placeholder="Share any additional feedback..."
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              rows={3}
              data-testid="input-rating-comment"
            />
          </div>

          <Button
            className="w-full"
            disabled={!allRated || submitMutation.isPending}
            onClick={() => submitMutation.mutate()}
            data-testid="button-submit-rating"
          >
            {submitMutation.isPending ? "Submitting..." : "Submit Rating"}
          </Button>
          {!allRated && (
            <p className="text-xs text-muted-foreground text-center">Please rate all four categories to submit.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function MyScoresTab() {
  const { data: scores, isLoading } = useQuery<MyScores>({
    queryKey: ["/api/peer-ratings/my-scores"],
  });

  if (isLoading) {
    return (
      <div className="grid gap-4 sm:grid-cols-2">
        {CATEGORIES.map(({ key }) => (
          <Card key={key} className="animate-pulse">
            <CardContent className="pt-6 h-24" />
          </Card>
        ))}
      </div>
    );
  }

  if (!scores || scores.totalRatings === 0) {
    return (
      <Card data-testid="my-scores-empty">
        <CardContent className="pt-6 text-center py-12">
          <Star className="w-12 h-12 mx-auto text-muted-foreground/30 mb-3" />
          <p className="font-medium text-muted-foreground">No ratings received yet</p>
          <p className="text-sm text-muted-foreground/70 mt-1">Your coworkers haven't rated you this period.</p>
        </CardContent>
      </Card>
    );
  }

  const scoreMap: Record<string, number | null> = {
    teamwork: scores.avgTeamwork,
    reliability: scores.avgReliability,
    communication: scores.avgCommunication,
    helpfulness: scores.avgHelpfulness,
  };

  return (
    <div className="space-y-4" data-testid="my-scores-section">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Based on <Badge variant="secondary" data-testid="badge-total-ratings">{scores.totalRatings}</Badge> rating{scores.totalRatings !== 1 ? "s" : ""}
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {CATEGORIES.map(({ key, label, icon: Icon, color }) => {
          const avg = scoreMap[key];
          return (
            <Card key={key} data-testid={`score-card-${key}`}>
              <CardContent className="pt-6">
                <div className="flex items-center gap-2 mb-3">
                  <Icon className={`w-5 h-5 ${color}`} />
                  <span className="font-medium">{label}</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-2xl font-bold" data-testid={`text-score-${key}`}>
                    {avg != null ? avg.toFixed(1) : "—"}
                  </span>
                  <StarRating value={Math.round(avg || 0)} readonly size="sm" />
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

export default function RateCoworkersPage() {
  const { user } = useAuth();
  const [selectedCoworker, setSelectedCoworker] = useState<RateableCoworker | null>(null);
  const canViewScores = useFeaturePermission("canViewPeerRatings");

  const { data: coworkers, isLoading } = useQuery<RateableCoworker[]>({
    queryKey: ["/api/peer-ratings/rateable-coworkers"],
  });

  if (selectedCoworker) {
    return (
      <div className="container max-w-2xl mx-auto py-6 px-4">
        <RatingForm coworker={selectedCoworker} onBack={() => setSelectedCoworker(null)} />
      </div>
    );
  }

  const unrated = coworkers?.filter((c) => !c.alreadyRated) || [];
  const rated = coworkers?.filter((c) => c.alreadyRated) || [];

  return (
    <div className="container max-w-3xl mx-auto py-6 px-4 space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight" data-testid="text-page-title">Rate Coworkers</h1>
        <p className="text-muted-foreground mt-1">Provide anonymous feedback on your coworkers' performance this month.</p>
      </div>

      <Tabs defaultValue="rate" data-testid="peer-ratings-tabs">
        <TabsList className={`grid w-full ${canViewScores ? "grid-cols-2" : "grid-cols-1"}`}>
          <TabsTrigger value="rate" data-testid="tab-rate">Rate Others</TabsTrigger>
          {canViewScores && <TabsTrigger value="scores" data-testid="tab-my-scores">My Scores</TabsTrigger>}
        </TabsList>

        <TabsContent value="rate" className="mt-4 space-y-4">
          {isLoading ? (
            <div className="grid gap-3">
              {[1, 2, 3].map((i) => (
                <Card key={i} className="animate-pulse">
                  <CardContent className="pt-6 h-16" />
                </Card>
              ))}
            </div>
          ) : coworkers?.length === 0 ? (
            <Card data-testid="no-coworkers-card">
              <CardContent className="pt-6 text-center py-12">
                <Users className="w-12 h-12 mx-auto text-muted-foreground/30 mb-3" />
                <p className="font-medium text-muted-foreground">No coworkers to rate</p>
                <p className="text-sm text-muted-foreground/70 mt-1">
                  You don't have any eligible coworkers to rate right now.
                </p>
              </CardContent>
            </Card>
          ) : (
            <>
              {unrated.length > 0 && (
                <div className="space-y-2">
                  <h3 className="text-sm font-medium text-muted-foreground">Not Yet Rated ({unrated.length})</h3>
                  <div className="grid gap-2">
                    {unrated.map((cw) => {
                      const initials = `${cw.firstName?.[0] || ""}${cw.lastName?.[0] || ""}`.toUpperCase();
                      return (
                        <Card
                          key={cw.id}
                          className="cursor-pointer hover:border-primary/50 transition-colors"
                          onClick={() => setSelectedCoworker(cw)}
                          data-testid={`coworker-card-${cw.id}`}
                        >
                          <CardContent className="pt-4 pb-4 flex items-center justify-between">
                            <div className="flex items-center gap-3">
                              <Avatar className="h-9 w-9">
                                <AvatarFallback className="bg-primary/10 text-primary text-sm font-semibold">{initials}</AvatarFallback>
                              </Avatar>
                              <div>
                                <p className="font-medium text-sm">{cw.firstName} {cw.lastName}</p>
                                <p className="text-xs text-muted-foreground">{cw.role}</p>
                              </div>
                            </div>
                            <Button variant="outline" size="sm" data-testid={`button-rate-${cw.id}`}>
                              Rate
                            </Button>
                          </CardContent>
                        </Card>
                      );
                    })}
                  </div>
                </div>
              )}
              {rated.length > 0 && (
                <div className="space-y-2">
                  <h3 className="text-sm font-medium text-muted-foreground">Already Rated ({rated.length})</h3>
                  <div className="grid gap-2">
                    {rated.map((cw) => {
                      const initials = `${cw.firstName?.[0] || ""}${cw.lastName?.[0] || ""}`.toUpperCase();
                      return (
                        <Card key={cw.id} className="opacity-60" data-testid={`coworker-rated-${cw.id}`}>
                          <CardContent className="pt-4 pb-4 flex items-center justify-between">
                            <div className="flex items-center gap-3">
                              <Avatar className="h-9 w-9">
                                <AvatarFallback className="bg-muted text-muted-foreground text-sm">{initials}</AvatarFallback>
                              </Avatar>
                              <div>
                                <p className="font-medium text-sm">{cw.firstName} {cw.lastName}</p>
                                <p className="text-xs text-muted-foreground">{cw.role}</p>
                              </div>
                            </div>
                            <Badge variant="secondary" className="gap-1">
                              <CheckCircle className="w-3 h-3" /> Rated
                            </Badge>
                          </CardContent>
                        </Card>
                      );
                    })}
                  </div>
                </div>
              )}
            </>
          )}
        </TabsContent>

<<<<<<< HEAD
        {canViewScores && (
          <TabsContent value="scores" className="mt-4">
            <MyScoresTab />
          </TabsContent>
        )}
=======
        <TabsContent value="scores" className="mt-4">
          <MyScoresTab />
        </TabsContent>
>>>>>>> fd04d986 (Saved your changes before starting work)
      </Tabs>
    </div>
  );
}
