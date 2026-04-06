import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Star, Users, CheckCircle2, Loader2 } from "lucide-react";

interface RateableCoworker {
  id: string;
  firstName: string;
  lastName: string;
  avatarUrl: string | null;
  role: string | null;
  alreadyRated: boolean;
}

interface PeerScores {
  avgTeamwork: number | null;
  avgReliability: number | null;
  avgCommunication: number | null;
  avgHelpfulness: number | null;
  totalRatings: number;
}

const CRITERIA = [
  { key: "teamwork", label: "Teamwork" },
  { key: "reliability", label: "Reliability" },
  { key: "communication", label: "Communication" },
  { key: "helpfulness", label: "Helpfulness" },
] as const;

function StarRating({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div className="flex gap-1">
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          type="button"
          onClick={() => onChange(star === value ? 0 : star)}
          className="p-0.5"
          data-testid={`star-rating-${star}`}
        >
          <Star
            className={`h-6 w-6 ${
              star <= value
                ? "text-yellow-500 fill-yellow-500"
                : "text-muted-foreground/40"
            }`}
          />
        </button>
      ))}
    </div>
  );
}

function ScoreBar({ label, value }: { label: string; value: number | null }) {
  const displayValue = value !== null ? value.toFixed(1) : "—";
  const pct = value !== null ? (value / 5) * 100 : 0;
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-sm">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-medium">{displayValue}/5</span>
      </div>
      <div className="h-2 bg-muted rounded-full overflow-hidden">
        <div
          className="h-full bg-yellow-500 rounded-full transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

export default function RateCoworkersPage() {
  const { toast } = useToast();
  const [selectedCoworker, setSelectedCoworker] = useState<RateableCoworker | null>(null);
  const [ratings, setRatings] = useState<Record<string, number>>({
    teamwork: 0,
    reliability: 0,
    communication: 0,
    helpfulness: 0,
  });
  const [comment, setComment] = useState("");

  const { data: coworkers = [], isLoading: loadingCoworkers } = useQuery<RateableCoworker[]>({
    queryKey: ["/api/peer-ratings/rateable-coworkers"],
  });

  const { data: myScores, isLoading: loadingScores } = useQuery<PeerScores>({
    queryKey: ["/api/peer-ratings/my-scores"],
  });

  const submitMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest("POST", "/api/peer-ratings", {
        rateeId: selectedCoworker!.id,
        teamwork: ratings.teamwork,
        reliability: ratings.reliability,
        communication: ratings.communication,
        helpfulness: ratings.helpfulness,
        comment: comment.trim() || null,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/peer-ratings/rateable-coworkers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/peer-ratings/my-scores"] });
      toast({ title: "Rating submitted", description: `You've rated ${selectedCoworker?.firstName} ${selectedCoworker?.lastName}` });
      setSelectedCoworker(null);
      setRatings({ teamwork: 0, reliability: 0, communication: 0, helpfulness: 0 });
      setComment("");
    },
    onError: (err: Error) => {
      toast({ title: "Failed to submit rating", description: err.message, variant: "destructive" });
    },
  });

  const allRated = ratings.teamwork > 0 && ratings.reliability > 0 && ratings.communication > 0 && ratings.helpfulness > 0;

  const rateableCount = coworkers.filter(c => !c.alreadyRated).length;
  const ratedCount = coworkers.filter(c => c.alreadyRated).length;

  return (
    <div className="p-4 md:p-8 max-w-4xl mx-auto" data-testid="rate-coworkers-page">
      <div className="mb-6">
        <h1 className="text-3xl font-bold flex items-center gap-2" data-testid="text-page-title">
          <Users className="h-8 w-8 text-primary" />
          Rate Your Crew
        </h1>
        <p className="text-muted-foreground mt-1">Recognize your coworkers by rating their teamwork, reliability, communication, and helpfulness</p>
      </div>

      {myScores && myScores.totalRatings > 0 && (
        <Card className="mb-6" data-testid="my-peer-scores-card">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2">
              <Star className="h-5 w-5 text-yellow-500" />
              Your Peer Score
            </CardTitle>
            <CardDescription>{myScores.totalRatings} rating{myScores.totalRatings !== 1 ? "s" : ""} received</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <ScoreBar label="Teamwork" value={myScores.avgTeamwork} />
            <ScoreBar label="Reliability" value={myScores.avgReliability} />
            <ScoreBar label="Communication" value={myScores.avgCommunication} />
            <ScoreBar label="Helpfulness" value={myScores.avgHelpfulness} />
          </CardContent>
        </Card>
      )}

      <Card data-testid="coworkers-list-card">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-lg">Coworkers</CardTitle>
              <CardDescription>
                {rateableCount > 0
                  ? `${rateableCount} coworker${rateableCount !== 1 ? "s" : ""} to rate this period`
                  : "All coworkers rated this period"}
                {ratedCount > 0 && ` · ${ratedCount} already rated`}
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {loadingCoworkers ? (
            <div className="space-y-3" data-testid="coworkers-loading">
              {[1, 2, 3].map(i => <Skeleton key={i} className="h-16 rounded-md" />)}
            </div>
          ) : coworkers.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8" data-testid="text-no-coworkers">
              No coworkers found to rate. You may need to be assigned to a project or crew first.
            </p>
          ) : (
            <div className="space-y-2">
              {coworkers.map((coworker) => {
                const initials = `${coworker.firstName?.[0] || ""}${coworker.lastName?.[0] || ""}`.toUpperCase();
                const roleLabel = coworker.role?.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase()) || "";
                return (
                  <div
                    key={coworker.id}
                    className="flex items-center justify-between p-3 border rounded-md hover:bg-muted/50 transition-colors"
                    data-testid={`coworker-row-${coworker.id}`}
                  >
                    <div className="flex items-center gap-3">
                      <Avatar className="h-10 w-10">
                        <AvatarImage src={coworker.avatarUrl || undefined} />
                        <AvatarFallback className="text-sm bg-primary/10 text-primary">
                          {initials}
                        </AvatarFallback>
                      </Avatar>
                      <div>
                        <p className="text-sm font-medium" data-testid={`text-coworker-name-${coworker.id}`}>
                          {coworker.firstName} {coworker.lastName}
                        </p>
                        {roleLabel && (
                          <p className="text-xs text-muted-foreground">{roleLabel}</p>
                        )}
                      </div>
                    </div>
                    {coworker.alreadyRated ? (
                      <Badge variant="secondary" className="gap-1" data-testid={`badge-rated-${coworker.id}`}>
                        <CheckCircle2 className="h-3 w-3" />
                        Rated
                      </Badge>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setSelectedCoworker(coworker)}
                        data-testid={`button-rate-${coworker.id}`}
                      >
                        <Star className="h-4 w-4 mr-1" />
                        Rate
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!selectedCoworker} onOpenChange={(open) => {
        if (!open) {
          setSelectedCoworker(null);
          setRatings({ teamwork: 0, reliability: 0, communication: 0, helpfulness: 0 });
          setComment("");
        }
      }}>
        <DialogContent data-testid="rate-dialog">
          <DialogHeader>
            <DialogTitle>
              Rate {selectedCoworker?.firstName} {selectedCoworker?.lastName}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {CRITERIA.map(({ key, label }) => (
              <div key={key} className="flex items-center justify-between" data-testid={`criteria-row-${key}`}>
                <span className="text-sm font-medium">{label}</span>
                <StarRating
                  value={ratings[key]}
                  onChange={(v) => setRatings(prev => ({ ...prev, [key]: v }))}
                />
              </div>
            ))}
            <div className="space-y-2">
              <span className="text-sm font-medium">Comment (optional)</span>
              <Textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="Add a comment about this coworker..."
                className="resize-none"
                rows={3}
                data-testid="textarea-peer-comment"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setSelectedCoworker(null);
                setRatings({ teamwork: 0, reliability: 0, communication: 0, helpfulness: 0 });
                setComment("");
              }}
              data-testid="button-cancel-rating"
            >
              Cancel
            </Button>
            <Button
              onClick={() => submitMutation.mutate()}
              disabled={!allRated || submitMutation.isPending}
              data-testid="button-submit-rating"
            >
              {submitMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              ) : (
                <Star className="h-4 w-4 mr-1" />
              )}
              {submitMutation.isPending ? "Submitting..." : "Submit Rating"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
