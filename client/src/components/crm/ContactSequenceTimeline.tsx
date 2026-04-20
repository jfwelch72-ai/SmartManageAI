import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Link } from "wouter";
import { AlertTriangle, Reply, Trophy, XCircle, UserMinus, CheckCircle2, ExternalLink } from "lucide-react";

type Enrollment = {
  id: string;
  sequenceId: string;
  sequenceName: string | null;
  status: string;
  exitReason: string | null;
  exitedAt: string | null;
  createdAt: string;
  bounceEmailThreadId: string | null;
  bounceEmailSubject: string | null;
};

function ExitBadge({ reason }: { reason: string | null }) {
  if (!reason) return <Badge variant="secondary" data-testid="badge-exit-active">Active</Badge>;
  switch (reason) {
    case "BOUNCED":
      return <Badge variant="destructive" className="gap-1" data-testid="badge-exit-bounced"><AlertTriangle className="w-3 h-3" />Bounced</Badge>;
    case "REPLIED":
      return <Badge className="gap-1 bg-blue-600 hover:bg-blue-600" data-testid="badge-exit-replied"><Reply className="w-3 h-3" />Replied</Badge>;
    case "OPPORTUNITY_WON":
      return <Badge className="gap-1 bg-emerald-600 hover:bg-emerald-600" data-testid="badge-exit-won"><Trophy className="w-3 h-3" />Deal won</Badge>;
    case "OPPORTUNITY_LOST":
      return <Badge variant="outline" className="gap-1" data-testid="badge-exit-lost"><XCircle className="w-3 h-3" />Deal lost</Badge>;
    case "MANUAL_REMOVE":
      return <Badge variant="outline" className="gap-1" data-testid="badge-exit-removed"><UserMinus className="w-3 h-3" />Removed</Badge>;
    case "COMPLETED":
      return <Badge variant="secondary" className="gap-1" data-testid="badge-exit-completed"><CheckCircle2 className="w-3 h-3" />Completed</Badge>;
    default:
      return <Badge variant="outline">{reason}</Badge>;
  }
}

export function ContactSequenceTimeline({ contactId }: { contactId: string }) {
  const { data, isLoading } = useQuery<Enrollment[]>({
    queryKey: ["/api/crm/sequences/enrollments/by-contact", contactId],
  });

  if (isLoading) {
    return <p className="text-sm text-muted-foreground" data-testid="text-timeline-loading">Loading sequence history…</p>;
  }
  if (!data || data.length === 0) {
    return <p className="text-sm text-muted-foreground" data-testid="text-timeline-empty">Not enrolled in any sequences yet.</p>;
  }

  return (
    <div className="space-y-2" data-testid="list-contact-enrollments">
      {data.map((e) => (
        <div
          key={e.id}
          className="flex items-start justify-between gap-3 rounded-md border p-3"
          data-testid={`row-enrollment-${e.id}`}
        >
          <div className="min-w-0 flex-1">
            <Link
              href={`/sequences/${e.sequenceId}`}
              className="text-sm font-medium hover:underline"
              data-testid={`link-sequence-${e.id}`}
            >
              {e.sequenceName || "Sequence"}
            </Link>
            <p className="text-xs text-muted-foreground mt-0.5">
              {e.exitedAt
                ? `Exited ${new Date(e.exitedAt).toLocaleDateString()}`
                : `Enrolled ${new Date(e.createdAt).toLocaleDateString()}`}
            </p>
            {e.exitReason === "BOUNCED" && e.bounceEmailThreadId && (
              <Link
                href={`/email-assistant?threadId=${encodeURIComponent(e.bounceEmailThreadId)}`}
                className="mt-1 inline-flex items-center gap-1 text-xs text-primary hover:underline"
                data-testid={`link-bounce-${e.id}`}
              >
                <ExternalLink className="w-3 h-3" />
                View bounce email
                {e.bounceEmailSubject ? `: ${e.bounceEmailSubject}` : ""}
              </Link>
            )}
          </div>
          <ExitBadge reason={e.exitReason} />
        </div>
      ))}
    </div>
  );
}
