import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Loader2, ShieldCheck, ShieldX, Inbox } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { apiRequest, queryClient } from "@/lib/queryClient";

// Mirrors the server's `accessRequests` row + hydrated requester info.
// Kept loose (`unknown`) on date fields because the JSON serializer turns
// `Date`s into ISO strings.
interface AccessRequestRow {
  id: string;
  organizationId: string;
  requesterUserId: string;
  requestedRole: string | null;
  requestedPermissions: string[] | null;
  featureContext: string | null;
  reason: string;
  status: "PENDING" | "APPROVED" | "DENIED";
  decidedById: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  createdAt: string;
  updatedAt: string;
  requester: {
    id: string;
    firstName: string | null;
    lastName: string | null;
    email: string;
    role: string;
  } | null;
  decidedBy: {
    id: string;
    firstName: string | null;
    lastName: string | null;
    email: string;
  } | null;
}

const ROLE_LABELS: Record<string, string> = {
  SUPER_ADMIN: "Super Admin",
  ADMIN: "Admin",
  HUSTLER: "Hustler",
  MANAGER: "Manager",
  ESTIMATOR: "Estimator",
  SUPERINTENDENT: "Superintendent",
  FOREMAN: "Foreman",
  FIELD_WORKER: "Field Worker",
  ACCOUNTANT: "Accountant",
};

function displayName(
  u: AccessRequestRow["requester"] | AccessRequestRow["decidedBy"],
): string {
  if (!u) return "Unknown user";
  const name = [u.firstName, u.lastName].filter(Boolean).join(" ").trim();
  return name || u.email;
}

function formatTime(iso: string | null): string {
  if (!iso) return "";
  try {
    return formatDistanceToNow(new Date(iso), { addSuffix: true });
  } catch {
    return iso;
  }
}

function StatusBadge({ status }: { status: AccessRequestRow["status"] }) {
  if (status === "APPROVED") {
    return (
      <Badge
        variant="outline"
        className="text-green-700 border-green-300 bg-green-50 dark:text-green-300 dark:border-green-800 dark:bg-green-950"
        data-testid={`badge-status-${status.toLowerCase()}`}
      >
        Approved
      </Badge>
    );
  }
  if (status === "DENIED") {
    return (
      <Badge
        variant="outline"
        className="text-red-700 border-red-300 bg-red-50 dark:text-red-300 dark:border-red-800 dark:bg-red-950"
        data-testid={`badge-status-${status.toLowerCase()}`}
      >
        Denied
      </Badge>
    );
  }
  return (
    <Badge variant="secondary" data-testid={`badge-status-${status.toLowerCase()}`}>
      Pending
    </Badge>
  );
}

export function AccessRequestsAdminPanel() {
  const { toast } = useToast();
  const { user } = useAuth();
  // Mirror the server's `ADMIN_ROLES` list. The server is authoritative —
  // hiding the action buttons is purely defensive UX so non-admins (who
  // can technically reach the tab if it's mis-routed) don't see buttons
  // that would just 403. Approve/deny endpoints are still gated server
  // side regardless of what the client renders.
  const canModerate = !!user && ["SUPER_ADMIN", "ADMIN", "HUSTLER"].includes(user.role);
  const [denyTarget, setDenyTarget] = useState<AccessRequestRow | null>(null);
  const [denyNote, setDenyNote] = useState("");

  const { data, isLoading } = useQuery<AccessRequestRow[]>({
    queryKey: ["/api/access-requests"],
  });

  const decide = useMutation({
    mutationFn: async (args: {
      id: string;
      action: "approve" | "deny";
      decisionNote?: string;
    }) => {
      const res = await apiRequest(
        "POST",
        `/api/access-requests/${args.id}/${args.action}`,
        { decisionNote: args.decisionNote ?? null },
      );
      return res.json();
    },
    onSuccess: (_, vars) => {
      toast({
        title: vars.action === "approve" ? "Request approved" : "Request denied",
        description:
          vars.action === "approve"
            ? "The user's access has been updated and they've been notified."
            : "The requester has been notified.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/access-requests"] });
      // Approvals can shift role + permission flags; refresh the
      // dashboard permissions view so the Feature Permissions tab
      // reflects the change without a manual reload.
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/permissions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      setDenyTarget(null);
      setDenyNote("");
    },
    onError: (err) => {
      toast({
        title: "Couldn't update request",
        description: err instanceof Error ? err.message : "Try again shortly.",
        variant: "destructive",
      });
    },
  });

  const rows = data ?? [];
  const pending = rows.filter((r) => r.status === "PENDING");
  const decided = rows.filter((r) => r.status !== "PENDING");

  const renderRow = (req: AccessRequestRow) => {
    const grants: string[] = [];
    if (req.requestedRole) {
      grants.push(`Role: ${ROLE_LABELS[req.requestedRole] ?? req.requestedRole}`);
    }
    if (req.requestedPermissions && req.requestedPermissions.length > 0) {
      grants.push(`Permissions: ${req.requestedPermissions.join(", ")}`);
    }
    if (grants.length === 0) {
      grants.push("No specific role suggested — admin's discretion");
    }

    return (
      <div
        key={req.id}
        className="border rounded-lg p-4 space-y-2"
        data-testid={`row-access-request-${req.id}`}
      >
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <div className="flex items-center gap-2">
              <p
                className="font-medium"
                data-testid={`text-requester-${req.id}`}
              >
                {displayName(req.requester)}
              </p>
              <StatusBadge status={req.status} />
            </div>
            <p className="text-xs text-muted-foreground">
              {req.requester ? req.requester.email : ""} ·{" "}
              {req.requester
                ? ROLE_LABELS[req.requester.role] ?? req.requester.role
                : ""}{" "}
              · Submitted {formatTime(req.createdAt)}
            </p>
          </div>
          {req.status === "PENDING" && canModerate && (
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setDenyTarget(req);
                  setDenyNote("");
                }}
                disabled={decide.isPending}
                data-testid={`button-deny-${req.id}`}
              >
                <ShieldX className="w-4 h-4 mr-1.5" />
                Deny
              </Button>
              <Button
                size="sm"
                onClick={() =>
                  decide.mutate({ id: req.id, action: "approve" })
                }
                disabled={decide.isPending}
                data-testid={`button-approve-${req.id}`}
              >
                {decide.isPending ? (
                  <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
                ) : (
                  <ShieldCheck className="w-4 h-4 mr-1.5" />
                )}
                Approve
              </Button>
            </div>
          )}
        </div>

        {req.featureContext && (
          <p className="text-sm">
            <span className="text-muted-foreground">Trying to:</span>{" "}
            <span data-testid={`text-feature-${req.id}`}>
              {req.featureContext}
            </span>
          </p>
        )}

        <p className="text-sm">
          <span className="text-muted-foreground">Requesting:</span>{" "}
          {grants.join(" · ")}
        </p>

        <p
          className="text-sm whitespace-pre-wrap rounded bg-muted/50 p-2"
          data-testid={`text-reason-${req.id}`}
        >
          {req.reason}
        </p>

        {req.status !== "PENDING" && (
          <p className="text-xs text-muted-foreground">
            {req.status === "APPROVED" ? "Approved" : "Denied"}{" "}
            {formatTime(req.decidedAt)}
            {req.decidedBy ? ` by ${displayName(req.decidedBy)}` : ""}
            {req.decisionNote ? ` — "${req.decisionNote}"` : ""}
          </p>
        )}
      </div>
    );
  };

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Access requests</CardTitle>
          <p className="text-sm text-muted-foreground">
            Review and act on self-serve requests for elevated access. Approving
            updates the user's role and any requested permission flags
            immediately.
          </p>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : rows.length === 0 ? (
            <div
              className="flex flex-col items-center justify-center text-center py-12 text-muted-foreground"
              data-testid="empty-access-requests"
            >
              <Inbox className="w-10 h-10 mb-3" />
              <p className="font-medium">No access requests yet</p>
              <p className="text-sm">
                When a user hits a permission wall, they can request access
                from here.
              </p>
            </div>
          ) : (
            <Tabs defaultValue="pending" className="space-y-4">
              <TabsList>
                <TabsTrigger
                  value="pending"
                  data-testid="tab-access-requests-pending"
                >
                  Pending
                  {pending.length > 0 && (
                    <Badge variant="secondary" className="ml-2">
                      {pending.length}
                    </Badge>
                  )}
                </TabsTrigger>
                <TabsTrigger
                  value="history"
                  data-testid="tab-access-requests-history"
                >
                  History
                </TabsTrigger>
              </TabsList>
              <TabsContent value="pending" className="space-y-3">
                {pending.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-6 text-center">
                    No pending requests.
                  </p>
                ) : (
                  pending.map(renderRow)
                )}
              </TabsContent>
              <TabsContent value="history" className="space-y-3">
                {decided.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-6 text-center">
                    No decisions yet.
                  </p>
                ) : (
                  decided.map(renderRow)
                )}
              </TabsContent>
            </Tabs>
          )}
        </CardContent>
      </Card>

      <Dialog
        open={!!denyTarget}
        onOpenChange={(o) => {
          if (!o) {
            setDenyTarget(null);
            setDenyNote("");
          }
        }}
      >
        <DialogContent data-testid="dialog-deny-access-request">
          <DialogHeader>
            <DialogTitle>Deny access request</DialogTitle>
            <DialogDescription>
              {denyTarget
                ? `Optionally tell ${displayName(denyTarget.requester)} why so they know what to do next.`
                : ""}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="deny-note">Note (optional)</Label>
            <Textarea
              id="deny-note"
              data-testid="input-deny-note"
              value={denyNote}
              onChange={(e) => setDenyNote(e.target.value)}
              rows={3}
              maxLength={500}
              placeholder="e.g. Use temp role then ping me Friday"
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setDenyTarget(null);
                setDenyNote("");
              }}
              disabled={decide.isPending}
              data-testid="button-deny-cancel"
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (!denyTarget) return;
                decide.mutate({
                  id: denyTarget.id,
                  action: "deny",
                  decisionNote: denyNote.trim() || undefined,
                });
              }}
              disabled={decide.isPending}
              data-testid="button-deny-confirm"
            >
              {decide.isPending && (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              )}
              Confirm denial
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
