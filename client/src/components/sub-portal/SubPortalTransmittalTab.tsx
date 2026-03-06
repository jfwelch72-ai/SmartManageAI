import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Send,
  Paperclip,
  Download,
  Loader2,
  CheckCircle2,
  Clock,
  ExternalLink,
} from "lucide-react";
import { StatusBadge, formatDate, parseAttachments } from "./sub-portal-utils";

interface SubPortalTransmittalTabProps {
  transmittals: any[];
  transmittalsLoading: boolean;
  token: string;
}

export function SubPortalTransmittalTab({ transmittals, transmittalsLoading, token }: SubPortalTransmittalTabProps) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [selectedTransmittal, setSelectedTransmittal] = useState<any>(null);

  const acknowledgeMutation = useMutation({
    mutationFn: async ({ id }: { id: string }) => {
      const res = await fetch(`/api/portal/transmittals/${id}/acknowledge`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-portal-token": token,
        },
      });
      if (!res.ok) throw new Error("Failed to acknowledge");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["/api/portal/transmittals"],
      });
      toast({ title: "Receipt acknowledged" });
    },
    onError: () => {
      toast({ title: "Failed to acknowledge receipt", variant: "destructive" });
    },
  });

  return (
    <>
      {transmittalsLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : transmittals.length === 0 ? (
        <Card data-testid="empty-transmittals">
          <CardContent className="py-12 text-center">
            <Send className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
            <p className="text-muted-foreground text-sm">
              No transmittals found for this project.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {transmittals.map((tr: any) => (
            <Card
              key={tr.id}
              className="cursor-pointer hover-elevate"
              onClick={() => setSelectedTransmittal(tr)}
              data-testid={`card-transmittal-${tr.id}`}
            >
              <CardContent className="p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2 mb-1">
                      <span
                        className="font-medium text-sm"
                        data-testid={`text-transmittal-number-${tr.id}`}
                      >
                        {tr.transmittalNumber}
                      </span>
                      <StatusBadge status={tr.status} />
                      {tr.documentType && (
                        <Badge
                          variant="outline"
                          className="text-xs"
                          data-testid={`badge-transmittal-doctype-${tr.id}`}
                        >
                          {tr.documentType}
                        </Badge>
                      )}
                    </div>
                    <p
                      className="text-sm truncate"
                      data-testid={`text-transmittal-subject-${tr.id}`}
                    >
                      {tr.subject}
                    </p>
                  </div>
                  <span
                    className="text-xs text-muted-foreground flex items-center gap-1"
                    data-testid={`text-transmittal-date-${tr.id}`}
                  >
                    <Clock className="h-3 w-3" />
                    {formatDate(tr.dateSent)}
                  </span>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog
        open={!!selectedTransmittal}
        onOpenChange={(open) => {
          if (!open) setSelectedTransmittal(null);
        }}
      >
        <DialogContent
          className="max-w-2xl max-h-[85vh] overflow-y-auto"
          data-testid="dialog-transmittal-detail"
        >
          {selectedTransmittal && (
            <>
              <DialogHeader>
                <DialogTitle className="flex flex-wrap items-center gap-2">
                  <ExternalLink className="h-5 w-5" />
                  <span data-testid="text-transmittal-detail-number">
                    {selectedTransmittal.transmittalNumber}
                  </span>
                  <StatusBadge status={selectedTransmittal.status} />
                </DialogTitle>
              </DialogHeader>

              <div className="space-y-4">
                <div>
                  <Label className="text-xs text-muted-foreground">
                    Subject
                  </Label>
                  <p
                    className="text-sm font-medium"
                    data-testid="text-transmittal-detail-subject"
                  >
                    {selectedTransmittal.subject}
                  </p>
                </div>

                {selectedTransmittal.description && (
                  <div>
                    <Label className="text-xs text-muted-foreground">
                      Description
                    </Label>
                    <p className="text-sm whitespace-pre-wrap">
                      {selectedTransmittal.description}
                    </p>
                  </div>
                )}

                <div className="flex flex-wrap gap-4">
                  {selectedTransmittal.documentType && (
                    <div>
                      <Label className="text-xs text-muted-foreground">
                        Document Type
                      </Label>
                      <p className="text-sm">
                        {selectedTransmittal.documentType}
                      </p>
                    </div>
                  )}
                  <div>
                    <Label className="text-xs text-muted-foreground">
                      Date Sent
                    </Label>
                    <p className="text-sm">
                      {formatDate(selectedTransmittal.dateSent)}
                    </p>
                  </div>
                </div>

                {selectedTransmittal.recipients &&
                  Array.isArray(selectedTransmittal.recipients) &&
                  selectedTransmittal.recipients.length > 0 && (
                    <div>
                      <Label className="text-xs text-muted-foreground mb-2 block">
                        Recipients
                      </Label>
                      <div className="space-y-1">
                        {selectedTransmittal.recipients.map(
                          (r: any, i: number) => (
                            <div
                              key={i}
                              className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-2 text-sm"
                              data-testid={`transmittal-recipient-${i}`}
                            >
                              <span>
                                {r.name || r.email || `Recipient ${i + 1}`}
                              </span>
                              {r.acknowledged ? (
                                <Badge
                                  variant="outline"
                                  className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200 text-xs"
                                >
                                  <CheckCircle2 className="h-3 w-3 mr-1" />
                                  Acknowledged
                                </Badge>
                              ) : (
                                <Badge
                                  variant="outline"
                                  className="text-xs"
                                >
                                  <Clock className="h-3 w-3 mr-1" />
                                  Pending
                                </Badge>
                              )}
                            </div>
                          )
                        )}
                      </div>
                    </div>
                  )}

                {parseAttachments(selectedTransmittal.attachmentsJson)
                  .length > 0 && (
                  <div>
                    <Label className="text-xs text-muted-foreground flex items-center gap-1 mb-2">
                      <Paperclip className="h-3 w-3" />
                      Attachments
                    </Label>
                    <div className="space-y-1">
                      {parseAttachments(
                        selectedTransmittal.attachmentsJson
                      ).map((att, i) => (
                        <a
                          key={i}
                          href={att.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-2 text-sm text-primary hover:underline"
                          data-testid={`link-transmittal-attachment-${i}`}
                        >
                          <Download className="h-3.5 w-3.5" />
                          {att.name || `Attachment ${i + 1}`}
                        </a>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <DialogFooter>
                <Button
                  onClick={() =>
                    acknowledgeMutation.mutate({
                      id: selectedTransmittal.id,
                    })
                  }
                  disabled={acknowledgeMutation.isPending}
                  data-testid="button-transmittal-acknowledge"
                >
                  {acknowledgeMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <CheckCircle2 className="h-4 w-4" />
                  )}
                  Acknowledge Receipt
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
