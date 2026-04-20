import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Mail, Eye } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import DOMPurify from "dompurify";

interface Props {
  contactIds?: string[];
  opportunityId?: string;
  trigger?: React.ReactNode;
}

interface SeqUser {
  id: string;
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
}

export function EnrollSequenceDialog({ contactIds, opportunityId, trigger }: Props) {
  const [open, setOpen] = useState(false);
  const [sequenceId, setSequenceId] = useState<string>("");
  const [senderId, setSenderId] = useState<string>("");
  const [startAt, setStartAt] = useState<string>("");
  const [preview, setPreview] = useState<{ subject?: string; body?: string } | null>(null);
  const { toast } = useToast();

  const { data: sequences } = useQuery<any[]>({
    queryKey: ["/api/crm/sequences"],
    enabled: open,
  });

  const { data: meRes } = useQuery<{ user?: SeqUser }>({
    queryKey: ["/api/auth/me"],
    enabled: open,
  });

  useEffect(() => {
    if (open && !senderId && meRes?.user?.id) setSenderId(meRes.user.id);
  }, [open, meRes, senderId]);

  const activeSeqs = (sequences || []).filter((s) => s.status === "ACTIVE");

  const previewMut = useMutation({
    mutationFn: async () => {
      if (!sequenceId) throw new Error("Pick a sequence first");
      const body = { contactId: contactIds?.[0], stepIndex: 0 };
      return (await apiRequest("POST", `/api/crm/sequences/${sequenceId}/preview`, body)).json();
    },
    onSuccess: (res) => setPreview(res),
    onError: (e: any) => toast({ title: "Preview failed", description: e.message, variant: "destructive" }),
  });

  const enrollMut = useMutation({
    mutationFn: async () => {
      if (!sequenceId) throw new Error("Pick a sequence");
      const url = `/api/crm/sequences/${sequenceId}/enroll`;
      const body: Record<string, any> = contactIds && contactIds.length > 1
        ? { contactIds }
        : { contactId: contactIds?.[0], opportunityId };
      if (senderId) body.senderId = senderId;
      if (startAt) body.startAt = new Date(startAt).toISOString();
      return (await apiRequest("POST", url, body)).json();
    },
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ["/api/crm/sequences"] });
      queryClient.invalidateQueries({ queryKey: ["/api/crm/sequences/inbox/me"] });
      toast({
        title: "Enrolled",
        description: `${res.enrolled || 1} contact(s) enrolled${res.skipped ? `, ${res.skipped} skipped (already enrolled)` : ""}.`,
      });
      setOpen(false);
      setSequenceId("");
      setStartAt("");
      setPreview(null);
    },
    onError: (e: any) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger || (
          <Button size="sm" variant="outline" data-testid="button-open-enroll-sequence">
            <Mail className="h-4 w-4 mr-1" />Enroll in sequence
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader><DialogTitle>Enroll in sequence</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Active sequence</Label>
            <Select value={sequenceId} onValueChange={(v) => { setSequenceId(v); setPreview(null); }}>
              <SelectTrigger data-testid="select-enroll-sequence"><SelectValue placeholder="Pick a sequence" /></SelectTrigger>
              <SelectContent>
                {activeSeqs.length === 0 ? (
                  <SelectItem value="none" disabled>No active sequences</SelectItem>
                ) : activeSeqs.map((s) => (
                  <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label htmlFor="enroll-sender">Send as (sender)</Label>
            <Input
              id="enroll-sender"
              value={senderId}
              onChange={(e) => setSenderId(e.target.value)}
              placeholder="User ID (defaults to you)"
              data-testid="input-enroll-sender"
            />
            <p className="text-xs text-muted-foreground mt-1">Defaults to you. Admin can override.</p>
          </div>

          <div>
            <Label htmlFor="enroll-start">Start at</Label>
            <Input
              id="enroll-start"
              type="datetime-local"
              value={startAt}
              onChange={(e) => setStartAt(e.target.value)}
              data-testid="input-enroll-start"
            />
            <p className="text-xs text-muted-foreground mt-1">Leave blank to start immediately.</p>
          </div>

          {sequenceId && contactIds && contactIds.length === 1 && (
            <div>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => previewMut.mutate()}
                disabled={previewMut.isPending}
                data-testid="button-preview-first-step"
              >
                <Eye className="h-4 w-4 mr-1" />
                {previewMut.isPending ? "Loading…" : "Preview first email"}
              </Button>
              {preview && (
                <div className="border rounded-md p-3 mt-2 space-y-2 text-sm" data-testid="preview-first-step">
                  <div><span className="font-medium">Subject:</span> {preview.subject || "(no subject)"}</div>
                  <div
                    className="border-t pt-2 prose prose-sm max-w-none"
                    dangerouslySetInnerHTML={{
                      __html: DOMPurify.sanitize(preview.body || "", {
                        USE_PROFILES: { html: true },
                        FORBID_TAGS: ["script", "style", "iframe", "object", "embed"],
                        FORBID_ATTR: ["onerror", "onload", "onclick"],
                      }),
                    }}
                  />
                </div>
              )}
            </div>
          )}

          <p className="text-xs text-muted-foreground">
            {contactIds && contactIds.length > 1
              ? `${contactIds.length} contacts will be enrolled. Duplicates are skipped.`
              : opportunityId
                ? "This opportunity (and its primary contact) will be enrolled."
                : "This contact will be enrolled."}
          </p>
        </div>
        <DialogFooter>
          <Button onClick={() => enrollMut.mutate()} disabled={!sequenceId || enrollMut.isPending} data-testid="button-confirm-enroll">
            {enrollMut.isPending ? "Enrolling…" : "Enroll"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
