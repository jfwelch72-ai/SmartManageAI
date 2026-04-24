import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Link2, AlertCircle } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Connection } from "./types";

/**
 * Task #1603 — Collects per-tenant Sage Intacct Web Services
 * credentials (companyId / userId / userPassword + optional locationId)
 * and posts them to /api/integrations/sage/credentials. The server
 * runs a probe call against the Sage XML Gateway before flipping the
 * connection to active, so bad credentials surface in this dialog
 * instead of failing later inside a background sync.
 */
export function SageConnectDialog({
  open,
  onOpenChange,
  existingConnection,
}: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  existingConnection?: Connection | null;
}) {
  const { toast } = useToast();
  const [companyId, setCompanyId] = useState("");
  const [userId, setUserId] = useState("");
  const [userPassword, setUserPassword] = useState("");
  const [locationId, setLocationId] = useState("");
  const [probeError, setProbeError] = useState<string | null>(null);

  // Reset form fields whenever the dialog (re)opens so we never leave
  // a stale Web Services password sitting in the input.
  useEffect(() => {
    if (open) {
      setCompanyId("");
      setUserId("");
      setUserPassword("");
      setLocationId("");
      setProbeError(null);
    }
  }, [open]);

  const submitMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/integrations/sage/credentials", {
        companyId: companyId.trim(),
        userId: userId.trim(),
        userPassword,
        ...(locationId.trim() ? { locationId: locationId.trim() } : {}),
      });
      return res.json() as Promise<{ ok: boolean; connectionId: string; status: string }>;
    },
    onSuccess: () => {
      toast({
        title: "Sage Intacct connected",
        description: "Credentials verified — your tenant is now linked.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/integrations/connections"] });
      queryClient.invalidateQueries({ queryKey: ["/api/integrations/providers"] });
      onOpenChange(false);
    },
    onError: (err: unknown) => {
      // apiRequest already unwraps the JSON `error` field — the server
      // packs the probe detail into it so the admin knows whether it
      // was a wrong companyId vs bad password.
      const detail = err instanceof Error ? err.message : String(err);
      setProbeError(detail);
    },
  });

  const isEditing = !!existingConnection && existingConnection.status === "active";
  const canSubmit =
    companyId.trim().length > 0 &&
    userId.trim().length > 0 &&
    userPassword.length > 0 &&
    !submitMutation.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-md"
        data-testid="dialog-sage-connect"
      >
        <DialogHeader>
          <DialogTitle data-testid="text-sage-connect-title">
            {isEditing ? "Update Sage Intacct credentials" : "Connect Sage Intacct"}
          </DialogTitle>
          <DialogDescription>
            Enter your Sage Intacct Web Services credentials. We'll verify
            them with a live probe call before activating the connection —
            nothing is persisted in plaintext.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!canSubmit) return;
            setProbeError(null);
            submitMutation.mutate();
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="sage-company-id">Company ID</Label>
            <Input
              id="sage-company-id"
              autoFocus
              autoComplete="off"
              value={companyId}
              onChange={(e) => setCompanyId(e.target.value)}
              placeholder="ACME-PROD"
              data-testid="input-sage-company-id"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="sage-user-id">Web Services User ID</Label>
            <Input
              id="sage-user-id"
              autoComplete="off"
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
              placeholder="ws-user"
              data-testid="input-sage-user-id"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="sage-user-password">Web Services Password</Label>
            <Input
              id="sage-user-password"
              type="password"
              autoComplete="new-password"
              value={userPassword}
              onChange={(e) => setUserPassword(e.target.value)}
              data-testid="input-sage-user-password"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="sage-location-id">
              Location ID <span className="text-muted-foreground">(optional, multi-entity tenants)</span>
            </Label>
            <Input
              id="sage-location-id"
              autoComplete="off"
              value={locationId}
              onChange={(e) => setLocationId(e.target.value)}
              placeholder="100"
              data-testid="input-sage-location-id"
            />
          </div>
          {probeError && (
            <div
              className="flex items-start gap-2 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive"
              data-testid="text-sage-connect-error"
            >
              <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
              <span>{probeError}</span>
            </div>
          )}
          <DialogFooter className="gap-2 sm:gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              data-testid="button-sage-connect-cancel"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={!canSubmit}
              data-testid="button-sage-connect-submit"
            >
              {submitMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <Link2 className="h-4 w-4 mr-2" />
              )}
              {isEditing ? "Update credentials" : "Connect"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
