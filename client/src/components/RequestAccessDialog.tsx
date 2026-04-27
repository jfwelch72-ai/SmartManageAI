import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";

type RequestedRole =
  | "ADMIN"
  | "MANAGER"
  | "SUPERINTENDENT"
  | "ESTIMATOR"
  | "FIELD_WORKER"
  | "VENDOR";

interface RequestAccessDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * Free-text label for the action that triggered the dialog (e.g.
   * "Export estimate PDF"). Surfaced in the admin queue so they don't
   * have to chase the user out-of-band to figure out what they need.
   */
  featureContext?: string;
  /**
   * Optional permission flag(s) to ask the admin to grant on the
   * requester's `userDashboardPermissions` row. The server only
   * applies values from a hard allow-list.
   */
  defaultPermissions?: string[];
  /** Optional default role suggestion (e.g. "MANAGER"). */
  defaultRole?: RequestedRole | null;
}

export function RequestAccessDialog({
  open,
  onOpenChange,
  featureContext,
  defaultPermissions,
  defaultRole,
}: RequestAccessDialogProps) {
  const [reason, setReason] = useState("");
  const [requestedRole, setRequestedRole] = useState<RequestedRole | "none">(
    defaultRole ?? "none",
  );
  const { toast } = useToast();

  const mutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/access-requests", {
        featureContext: featureContext ?? null,
        requestedRole: requestedRole === "none" ? null : requestedRole,
        requestedPermissions: defaultPermissions ?? null,
        reason: reason.trim(),
      });
      return res.json();
    },
    onSuccess: () => {
      toast({
        title: "Request sent",
        description: "An admin has been notified and will review it shortly.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/access-requests"] });
      setReason("");
      setRequestedRole(defaultRole ?? "none");
      onOpenChange(false);
    },
    onError: (err) => {
      toast({
        title: "Couldn't send request",
        description:
          err instanceof Error
            ? err.message
            : "Please try again in a moment.",
        variant: "destructive",
      });
    },
  });

  const reasonValid = reason.trim().length >= 5;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-md"
        data-testid="dialog-request-access"
      >
        <DialogHeader>
          <DialogTitle>Request access</DialogTitle>
          <DialogDescription>
            {featureContext
              ? `Ask an admin to grant you access to "${featureContext}". They'll be notified right away.`
              : "Ask an admin to grant you the access you need. They'll be notified right away."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="request-access-role">
              Suggested role (optional)
            </Label>
            <Select
              value={requestedRole}
              onValueChange={(v) => setRequestedRole(v as typeof requestedRole)}
            >
              <SelectTrigger
                id="request-access-role"
                data-testid="select-request-access-role"
              >
                <SelectValue placeholder="Leave to admin's discretion" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Leave to admin's discretion</SelectItem>
                <SelectItem value="FIELD_WORKER">Field Worker</SelectItem>
                <SelectItem value="ESTIMATOR">Estimator</SelectItem>
                <SelectItem value="SUPERINTENDENT">Superintendent</SelectItem>
                <SelectItem value="MANAGER">Manager</SelectItem>
                <SelectItem value="ADMIN">Admin</SelectItem>
                <SelectItem value="VENDOR">Vendor</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="request-access-reason">
              Why do you need access?
            </Label>
            <Textarea
              id="request-access-reason"
              data-testid="input-request-access-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Briefly explain what you're trying to do."
              rows={4}
              maxLength={1000}
            />
            <p className="text-xs text-muted-foreground">
              At least 5 characters. Your admin sees this verbatim.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={mutation.isPending}
            data-testid="button-request-access-cancel"
          >
            Cancel
          </Button>
          <Button
            onClick={() => mutation.mutate()}
            disabled={!reasonValid || mutation.isPending}
            data-testid="button-request-access-submit"
          >
            {mutation.isPending && (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            )}
            Send request
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
