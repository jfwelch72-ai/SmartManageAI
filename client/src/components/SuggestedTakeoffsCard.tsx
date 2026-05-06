import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { FileText, Lightbulb, Loader2, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface RankedSuggestion {
  id: string;
  title: string;
  tradeType: string | null;
  clientName: string | null;
  locationAddress: string | null;
  score: number;
  reasons: string[];
  sheetCount: number;
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  return "Unknown error";
}

interface Props {
  destinationKind: "bid" | "project";
  destinationId: string;
}

/**
 * Task #2404 — Suggested standalone takeoffs to attach to this bid/project.
 * Server returns a deterministic top-N list ranked by trade match,
 * keyword overlap (Jaccard) on title/client/address/notes, and recency.
 */
export function SuggestedTakeoffsCard({ destinationKind, destinationId }: Props) {
  const { toast } = useToast();
  const baseUrl = destinationKind === "bid"
    ? `/api/bids/${destinationId}/takeoff/suggestions`
    : `/api/projects/${destinationId}/takeoff/suggestions`;
  const taggedKey = destinationKind === "bid"
    ? `/api/bids/${destinationId}/takeoff/tagged-standalone`
    : `/api/projects/${destinationId}/takeoff/tagged-standalone`;

  const { data, isLoading } = useQuery<RankedSuggestion[]>({
    queryKey: [baseUrl],
  });

  // Auto-pickup is a discovery aid for the empty state — once the
  // destination already has tagged standalone takeoffs the workspace
  // becomes the source of truth and we suppress the suggestion card to
  // avoid duplicate UI noise.
  const { data: tagged } = useQuery<Array<{ id: string }>>({
    queryKey: [taggedKey],
  });

  const acceptMutation = useMutation({
    mutationFn: async (takeoffId: string) => {
      const res = await apiRequest(
        "POST",
        `/api/takeoff/standalone/${takeoffId}/tags`,
        destinationKind === "bid" ? { bidId: destinationId } : { projectId: destinationId },
      );
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [baseUrl] });
      queryClient.invalidateQueries({ queryKey: [taggedKey] });
      toast({ title: "Linked", description: "Takeoff attached to this " + destinationKind + "." });
    },
    onError: (err: unknown) =>
      toast({ title: "Failed", description: errorMessage(err), variant: "destructive" }),
  });

  const dismissMutation = useMutation({
    mutationFn: async (takeoffId: string) => {
      await apiRequest("POST", `/api/takeoff/standalone/${takeoffId}/dismissals`, {
        destinationKind,
        destinationId,
      });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [baseUrl] }),
  });

  if (isLoading) {
    return (
      <Card data-testid="suggested-takeoffs-loading">
        <CardContent className="flex items-center justify-center py-6">
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  if (!data || data.length === 0) return null;
  if (tagged && tagged.length > 0) return null;

  return (
    <Card data-testid="suggested-takeoffs-card">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          <Lightbulb className="w-4 h-4" />
          Suggested takeoffs
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {data.map((s) => (
          <div
            key={s.id}
            className="flex items-start gap-2 p-2 rounded border hover-elevate"
            data-testid={`suggestion-${s.id}`}
          >
            <Link
              href={`/takeoff/standalone/${s.id}`}
              className="flex-1 min-w-0"
              data-testid={`link-suggestion-${s.id}`}
            >
              <div className="flex items-center gap-2">
                <span className="font-medium truncate">{s.title}</span>
                {s.tradeType && <Badge variant="outline" className="text-[10px]">{s.tradeType}</Badge>}
                <span
                  className="inline-flex items-center gap-1 text-[10px] text-muted-foreground shrink-0"
                  data-testid={`text-sheet-count-${s.id}`}
                >
                  <FileText className="w-3 h-3" />
                  {s.sheetCount} {s.sheetCount === 1 ? "sheet" : "sheets"}
                </span>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5 truncate">
                {s.reasons.join(" · ")}
              </p>
            </Link>
            <Button
              size="sm"
              variant="outline"
              onClick={() => acceptMutation.mutate(s.id)}
              disabled={acceptMutation.isPending}
              data-testid={`button-accept-${s.id}`}
            >
              <Plus className="w-3.5 h-3.5 mr-1" /> Attach
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => dismissMutation.mutate(s.id)}
              data-testid={`button-dismiss-${s.id}`}
            >
              <X className="w-3.5 h-3.5" />
            </Button>
          </div>
        ))}
        <Link
          href="/takeoff?tab=mine"
          className="block text-xs text-primary hover:underline pt-1"
          data-testid="link-see-all-takeoffs"
        >
          See all my takeoffs →
        </Link>
      </CardContent>
    </Card>
  );
}
