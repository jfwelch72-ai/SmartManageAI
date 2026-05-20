import { useState } from "react";
import { useParams } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Star, CheckCircle2, Loader2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { apiRequest } from "@/lib/queryClient";

interface CsatTicketInfo {
  id: string;
  subject: string;
  csatScore: number | null;
  csatSubmittedAt: string | null;
  status: string;
}

interface CsatResponse {
  ticket: CsatTicketInfo;
  alreadyRated: boolean;
}

function StarRating({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const [hovered, setHovered] = useState(0);

  return (
    <div className="flex gap-2 justify-center" data-testid="csat-star-rating">
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          type="button"
          onClick={() => onChange(star)}
          onMouseEnter={() => setHovered(star)}
          onMouseLeave={() => setHovered(0)}
          className="focus:outline-none"
          data-testid={`star-${star}`}
          aria-label={`${star} star${star !== 1 ? "s" : ""}`}
        >
          <Star
            className={`h-10 w-10 transition-colors ${
              star <= (hovered || value)
                ? "fill-yellow-400 text-yellow-400"
                : "text-gray-300"
            }`}
          />
        </button>
      ))}
    </div>
  );
}

const STAR_LABELS = ["", "Poor", "Fair", "Good", "Very Good", "Excellent"];

export default function SupportRatePage() {
  const { token } = useParams<{ token: string }>();
  const [score, setScore] = useState(0);
  const [comment, setComment] = useState("");
  const [submitted, setSubmitted] = useState(false);

  const { data, isLoading, error } = useQuery<CsatResponse>({
    queryKey: ["/api/support/csat", token],
    queryFn: () =>
      fetch(`/api/support/csat/${token}`).then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      }),
    retry: false,
  });

  const submitMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/support/csat/${token}`, {
        score,
        comment: comment.trim() || undefined,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Failed to submit rating");
      }
      return res.json();
    },
    onSuccess: () => {
      setSubmitted(true);
    },
  });

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center space-y-3 max-w-sm mx-auto px-4">
          <AlertCircle className="h-12 w-12 text-muted-foreground mx-auto" />
          <h1 className="text-xl font-semibold">Rating Link Unavailable</h1>
          <p className="text-muted-foreground text-sm">
            This rating link is invalid or has expired. Rating links are valid for 7 days after resolution.
          </p>
        </div>
      </div>
    );
  }

  if (data.alreadyRated || submitted) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center space-y-4 max-w-sm mx-auto px-4">
          <CheckCircle2 className="h-14 w-14 text-green-500 mx-auto" data-testid="icon-csat-submitted" />
          <h1 className="text-2xl font-bold">Thank you!</h1>
          <p className="text-muted-foreground">
            {data.alreadyRated && !submitted
              ? "You've already rated this ticket."
              : "Your feedback has been received. We appreciate you taking the time!"}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center space-y-2">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-primary/10 mb-2">
            <Star className="h-8 w-8 text-primary" />
          </div>
          <h1 className="text-2xl font-bold" data-testid="heading-csat">Rate your support experience</h1>
          <p className="text-muted-foreground text-sm">
            Your ticket "<span className="font-medium">{data.ticket.subject}</span>" has been resolved.
          </p>
        </div>

        <div className="rounded-xl border bg-card p-6 space-y-6 shadow-sm">
          <div className="space-y-3">
            <Label className="block text-center text-sm font-medium">How would you rate our support?</Label>
            <StarRating value={score} onChange={setScore} />
            {score > 0 && (
              <p className="text-center text-sm font-medium text-primary" data-testid="text-star-label">
                {STAR_LABELS[score]}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="csat-comment" className="text-sm">
              Comments <span className="text-muted-foreground font-normal">(optional)</span>
            </Label>
            <Textarea
              id="csat-comment"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Tell us more about your experience…"
              rows={3}
              maxLength={2000}
              data-testid="input-csat-comment"
            />
          </div>

          {submitMutation.error && (
            <p className="text-sm text-destructive" data-testid="text-csat-error">
              {(submitMutation.error as Error).message}
            </p>
          )}

          <Button
            className="w-full"
            disabled={score === 0 || submitMutation.isPending}
            onClick={() => submitMutation.mutate()}
            data-testid="button-csat-submit"
          >
            {submitMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : null}
            Submit Rating
          </Button>
        </div>

        <p className="text-center text-xs text-muted-foreground">
          SmartManageAI Support · Your feedback helps us improve
        </p>
      </div>
    </div>
  );
}
