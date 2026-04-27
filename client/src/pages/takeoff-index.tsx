import { useMemo, useState } from "react";
import { Link } from "wouter";
import { ArrowRight, FileText, Loader2, Ruler, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { useBids } from "@/hooks/use-data";
import type { Bid } from "@shared/schema";

const ACTIVE_STATUSES = new Set([
  "DRAFT",
  "IN_PROGRESS",
  "READY_TO_SUBMIT",
  "SUBMITTED",
  "ACTIVE",
]);

export default function TakeoffIndexPage() {
  const { data: bids = [], isLoading } = useBids();
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const sorted = [...(bids as Bid[])].sort((a, b) => {
      const aActive = ACTIVE_STATUSES.has(String(a.status)) ? 0 : 1;
      const bActive = ACTIVE_STATUSES.has(String(b.status)) ? 0 : 1;
      if (aActive !== bActive) return aActive - bActive;
      const aTime = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
      const bTime = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
      return bTime - aTime;
    });
    if (!q) return sorted;
    return sorted.filter(
      (b) =>
        (b.name || "").toLowerCase().includes(q) ||
        (b.code || "").toLowerCase().includes(q) ||
        (b.clientName || "").toLowerCase().includes(q),
    );
  }, [bids, search]);

  return (
    <div className="container max-w-5xl mx-auto p-6 space-y-6" data-testid="takeoff-index-page">
      <div className="flex items-start gap-4">
        <div className="rounded-md bg-primary/10 p-3 shrink-0">
          <Ruler className="w-6 h-6 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight" data-testid="text-takeoff-index-title">
            Takeoff
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Open a bid to launch its dedicated full-screen takeoff workspace —
            measure quantities, mark up plans, and calibrate scale.
          </p>
        </div>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search bids by name, code, or client..."
          className="pl-9 h-10"
          data-testid="input-takeoff-bid-search"
        />
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-16" data-testid="takeoff-index-loading">
          <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
        </div>
      ) : filtered.length === 0 ? (
        <Card data-testid="takeoff-index-empty">
          <CardContent className="flex flex-col items-center justify-center text-center py-16 gap-3">
            <FileText className="w-12 h-12 text-muted-foreground/40" />
            <div>
              <p className="font-medium">
                {search ? "No bids match your search." : "No bids yet."}
              </p>
              <p className="text-sm text-muted-foreground mt-1">
                Create a bid first to start a takeoff.
              </p>
            </div>
            <Button asChild variant="outline" data-testid="button-takeoff-go-to-bids">
              <Link href="/bids">Go to Bids</Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-2">
          {filtered.map((bid) => (
            <Link
              key={bid.id}
              href={`/takeoff/${bid.code}`}
              data-testid={`link-takeoff-bid-${bid.code}`}
            >
              <Card className="hover-elevate active-elevate-2 transition-colors cursor-pointer">
                <CardContent className="flex items-center gap-3 p-4">
                  <FileText className="w-5 h-5 text-muted-foreground shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium truncate" data-testid={`text-takeoff-bid-name-${bid.code}`}>
                        {bid.name || bid.code}
                      </span>
                      <Badge
                        variant="outline"
                        className="text-[10px] font-mono uppercase tracking-wide shrink-0"
                      >
                        {bid.code}
                      </Badge>
                      {bid.status && (
                        <Badge variant="secondary" className="text-[10px] shrink-0">
                          {bid.status}
                        </Badge>
                      )}
                    </div>
                    {bid.clientName && (
                      <p className="text-xs text-muted-foreground truncate mt-0.5">
                        {bid.clientName}
                      </p>
                    )}
                  </div>
                  <ArrowRight className="w-4 h-4 text-muted-foreground shrink-0" />
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
