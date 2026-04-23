import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Plus, Trash2, ShieldCheck } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { HeavyCivilDocumentField } from "@/components/dot/HeavyCivilDocumentField";
import type { CrmOrganisationCertification } from "@shared/schema";
import { format, parseISO } from "date-fns";

const CERT_TYPES = ["DBE", "MBE", "WBE", "SBE", "VOSB", "SDVOSB", "HUBZONE", "EIGHTA", "ACDBE", "OTHER"] as const;

type CertType = (typeof CERT_TYPES)[number];

interface Props {
  crmOrgId: string;
}

export function CrmOrgCertificationsTab({ crmOrgId }: Props) {
  const { toast } = useToast();
  const queryKey = ["/api/crm/organisations", crmOrgId, "certifications"];

  const { data: certifications = [], isLoading } = useQuery<CrmOrganisationCertification[]>({
    queryKey,
    enabled: !!crmOrgId,
  });

  const [dialogOpen, setDialogOpen] = useState(false);
  const [draft, setDraft] = useState<{
    certificationType: CertType;
    certifyingAgency: string;
    certificationNumber: string;
    effectiveDate: string;
    expirationDate: string;
    notes: string;
  }>({
    certificationType: "DBE",
    certifyingAgency: "",
    certificationNumber: "",
    effectiveDate: "",
    expirationDate: "",
    notes: "",
  });

  const createMut = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/crm/organisations/${crmOrgId}/certifications`, {
        certificationType: draft.certificationType,
        certifyingAgency: draft.certifyingAgency || null,
        certificationNumber: draft.certificationNumber || null,
        effectiveDate: draft.effectiveDate || null,
        expirationDate: draft.expirationDate || null,
        notes: draft.notes || null,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      setDialogOpen(false);
      setDraft({
        certificationType: "DBE",
        certifyingAgency: "",
        certificationNumber: "",
        effectiveDate: "",
        expirationDate: "",
        notes: "",
      });
      toast({ title: "Certification added" });
    },
    onError: (e: any) => toast({ title: "Failed to add", description: e?.message, variant: "destructive" }),
  });

  const attachDocMut = useMutation({
    mutationFn: async ({ id, documentId }: { id: string; documentId: string }) => {
      const res = await apiRequest("PATCH", `/api/crm/organisations/${crmOrgId}/certifications/${id}`, { documentId });
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
  });

  const deleteMut = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/crm/organisations/${crmOrgId}/certifications/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      toast({ title: "Certification removed" });
    },
  });

  if (isLoading) return <Skeleton className="h-32 w-full" />;

  return (
    <div className="space-y-4 mt-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-semibold flex items-center gap-2">
            <ShieldCheck className="w-4 h-4" /> DBE / MBE / WBE Certifications
          </h3>
          <p className="text-xs text-muted-foreground">
            Track certifications and upload supporting documents with full revision history.
          </p>
        </div>
        <Button size="sm" onClick={() => setDialogOpen(true)} data-testid="button-add-certification">
          <Plus className="w-4 h-4 mr-2" /> Add Certification
        </Button>
      </div>

      {certifications.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            No certifications recorded yet.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3">
          {certifications.map((c) => (
            <Card key={c.id} data-testid={`card-certification-${c.id}`}>
              <CardHeader className="pb-3 flex-row items-start justify-between space-y-0">
                <div className="space-y-1">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Badge variant="secondary" data-testid={`badge-cert-type-${c.id}`}>{c.certificationType}</Badge>
                    {c.certifyingAgency && <span className="text-muted-foreground">{c.certifyingAgency}</span>}
                  </CardTitle>
                  <div className="text-xs text-muted-foreground space-x-3">
                    {c.certificationNumber && <span>#{c.certificationNumber}</span>}
                    {c.effectiveDate && <span>From {format(parseISO(c.effectiveDate as unknown as string), "MMM d, yyyy")}</span>}
                    {c.expirationDate && <span>Expires {format(parseISO(c.expirationDate as unknown as string), "MMM d, yyyy")}</span>}
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => deleteMut.mutate(c.id)}
                  disabled={deleteMut.isPending}
                  data-testid={`button-delete-cert-${c.id}`}
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              </CardHeader>
              <CardContent className="pt-0">
                <HeavyCivilDocumentField
                  documentId={c.documentId}
                  scope="ORG"
                  title={`${c.certificationType} Certification`}
                  docType="OTHER"
                  label="Certification document"
                  testId={`cert-doc-${c.id}`}
                  onChange={(documentId) => attachDocMut.mutate({ id: c.id, documentId })}
                />
                {c.notes && <p className="text-xs text-muted-foreground mt-3">{c.notes}</p>}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Certification</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Type</Label>
              <Select
                value={draft.certificationType}
                onValueChange={(v) => setDraft({ ...draft, certificationType: v as CertType })}
              >
                <SelectTrigger data-testid="select-cert-type"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CERT_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>{t}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Certifying Agency</Label>
              <Input
                value={draft.certifyingAgency}
                onChange={(e) => setDraft({ ...draft, certifyingAgency: e.target.value })}
                data-testid="input-certifying-agency"
              />
            </div>
            <div>
              <Label>Certification Number</Label>
              <Input
                value={draft.certificationNumber}
                onChange={(e) => setDraft({ ...draft, certificationNumber: e.target.value })}
                data-testid="input-cert-number"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Effective Date</Label>
                <Input
                  type="date"
                  value={draft.effectiveDate}
                  onChange={(e) => setDraft({ ...draft, effectiveDate: e.target.value })}
                  data-testid="input-effective-date"
                />
              </div>
              <div>
                <Label>Expiration Date</Label>
                <Input
                  type="date"
                  value={draft.expirationDate}
                  onChange={(e) => setDraft({ ...draft, expirationDate: e.target.value })}
                  data-testid="input-expiration-date"
                />
              </div>
            </div>
            <div>
              <Label>Notes</Label>
              <Textarea
                value={draft.notes}
                onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
                data-testid="input-cert-notes"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={() => createMut.mutate()} disabled={createMut.isPending} data-testid="button-save-certification">
              {createMut.isPending ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
