import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  opportunityId?: string;
  contactId?: string;
  crmOrganisationId?: string;
  defaultToNumber?: string;
  invalidateKeys?: readonly unknown[][];
}

const OUTCOMES: { value: string; label: string }[] = [
  { value: "CONNECTED", label: "Connected" },
  { value: "VOICEMAIL", label: "Left voicemail" },
  { value: "NO_ANSWER", label: "No answer" },
  { value: "BUSY", label: "Busy" },
  { value: "FAILED", label: "Failed" },
  { value: "WRONG_NUMBER", label: "Wrong number" },
  { value: "MEETING_SCHEDULED", label: "Meeting scheduled" },
];

export function LogCallDialog({
  open,
  onOpenChange,
  opportunityId,
  contactId,
  crmOrganisationId,
  defaultToNumber,
  invalidateKeys,
}: Props) {
  const { toast } = useToast();
  const [direction, setDirection] = useState<"OUTBOUND" | "INBOUND">("OUTBOUND");
  const [outcome, setOutcome] = useState<string>("CONNECTED");
  const [toNumber, setToNumber] = useState(defaultToNumber ?? "");
  const [durationMinutes, setDurationMinutes] = useState("0");
  const [notes, setNotes] = useState("");

  const reset = () => {
    setDirection("OUTBOUND");
    setOutcome("CONNECTED");
    setToNumber(defaultToNumber ?? "");
    setDurationMinutes("0");
    setNotes("");
  };

  const mutation = useMutation({
    mutationFn: async () => {
      const payload = {
        opportunityId: opportunityId ?? null,
        contactId: contactId ?? null,
        crmOrganisationId: crmOrganisationId ?? null,
        direction,
        outcome,
        toNumber: toNumber || null,
        durationSeconds: Math.max(0, Math.floor(Number(durationMinutes) * 60)) || 0,
        notes: notes || null,
      };
      const res = await apiRequest("POST", "/api/crm/calls", payload);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Call logged" });
      const keys: readonly unknown[][] = invalidateKeys ?? [
        ["/api/crm/calls"],
        ["/api/crm/activity"],
      ];
      for (const k of keys) queryClient.invalidateQueries({ queryKey: k });
      reset();
      onOpenChange(false);
    },
    onError: (err) => {
      toast({ title: "Failed to log call", description: String(err), variant: "destructive" });
    },
  });

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) reset(); onOpenChange(v); }}>
      <DialogContent data-testid="dialog-log-call">
        <DialogHeader>
          <DialogTitle>Log call</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <Label>Direction</Label>
            <Select value={direction} onValueChange={(v) => setDirection(v as "OUTBOUND" | "INBOUND")}>
              <SelectTrigger data-testid="select-call-direction"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="OUTBOUND">Outbound</SelectItem>
                <SelectItem value="INBOUND">Inbound</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label>Outcome</Label>
            <Select value={outcome} onValueChange={setOutcome}>
              <SelectTrigger data-testid="select-call-outcome"><SelectValue /></SelectTrigger>
              <SelectContent>
                {OUTCOMES.map((o) => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="call-to">Phone number</Label>
              <Input
                id="call-to"
                value={toNumber}
                onChange={(e) => setToNumber(e.target.value)}
                placeholder="+15551234567"
                data-testid="input-call-to-number"
              />
            </div>
            <div>
              <Label htmlFor="call-duration">Duration (minutes)</Label>
              <Input
                id="call-duration"
                type="number"
                min={0}
                step={1}
                value={durationMinutes}
                onChange={(e) => setDurationMinutes(e.target.value)}
                data-testid="input-call-duration"
              />
            </div>
          </div>

          <div>
            <Label htmlFor="call-notes">Notes</Label>
            <Textarea
              id="call-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="What did you discuss?"
              rows={4}
              data-testid="input-call-notes"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} data-testid="button-cancel-call">
            Cancel
          </Button>
          <Button
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending}
            data-testid="button-save-call"
          >
            {mutation.isPending ? "Saving…" : "Save call"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
