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
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  FileText,
  Send,
  MessageSquare,
  Paperclip,
  Download,
  Loader2,
  CheckCircle2,
  Clock,
} from "lucide-react";
import { StatusBadge, formatDate, parseAttachments } from "./sub-portal-utils";

interface SubPortalRfiTabProps {
  rfis: any[];
  rfisLoading: boolean;
  token: string;
}

export function SubPortalRfiTab({ rfis, rfisLoading, token }: SubPortalRfiTabProps) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [selectedRfi, setSelectedRfi] = useState<any>(null);
  const [rfiComment, setRfiComment] = useState("");

  const rfiCommentMutation = useMutation({
    mutationFn: async ({ id, comment }: { id: string; comment: string }) => {
      const res = await fetch(`/api/portal/rfis/${id}/comment`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-portal-token": token,
        },
        body: JSON.stringify({ comment }),
      });
      if (!res.ok) throw new Error("Failed to post comment");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/portal/rfis"] });
      toast({ title: "Comment posted" });
      setRfiComment("");
    },
    onError: () => {
      toast({ title: "Failed to post comment", variant: "destructive" });
    },
  });

  return (
    <>
      {rfisLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : rfis.length === 0 ? (
        <Card data-testid="empty-rfis">
          <CardContent className="py-12 text-center">
            <FileText className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
            <p className="text-muted-foreground text-sm">
              No RFIs found for this project.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {rfis.map((rfi: any) => (
            <Card
              key={rfi.id}
              className="cursor-pointer hover-elevate"
              onClick={() => setSelectedRfi(rfi)}
              data-testid={`card-rfi-${rfi.id}`}
            >
              <CardContent className="p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2 mb-1">
                      <span
                        className="font-medium text-sm"
                        data-testid={`text-rfi-number-${rfi.id}`}
                      >
                        {rfi.rfiNumber}
                      </span>
                      <StatusBadge status={rfi.status} />
                      {rfi.priority && (
                        <Badge
                          variant="outline"
                          className="text-xs"
                          data-testid={`badge-rfi-priority-${rfi.id}`}
                        >
                          {rfi.priority}
                        </Badge>
                      )}
                    </div>
                    <p
                      className="text-sm truncate"
                      data-testid={`text-rfi-subject-${rfi.id}`}
                    >
                      {rfi.subject}
                    </p>
                  </div>
                  <span
                    className="text-xs text-muted-foreground flex items-center gap-1"
                    data-testid={`text-rfi-date-${rfi.id}`}
                  >
                    <Clock className="h-3 w-3" />
                    {formatDate(rfi.dateSubmitted)}
                  </span>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog
        open={!!selectedRfi}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedRfi(null);
            setRfiComment("");
          }
        }}
      >
        <DialogContent
          className="max-w-2xl max-h-[85vh] overflow-y-auto"
          data-testid="dialog-rfi-detail"
        >
          {selectedRfi && (
            <>
              <DialogHeader>
                <DialogTitle className="flex flex-wrap items-center gap-2">
                  <FileText className="h-5 w-5" />
                  <span data-testid="text-rfi-detail-number">
                    {selectedRfi.rfiNumber}
                  </span>
                  <StatusBadge status={selectedRfi.status} />
                </DialogTitle>
              </DialogHeader>

              <div className="space-y-4">
                <div>
                  <Label className="text-xs text-muted-foreground">
                    Subject
                  </Label>
                  <p
                    className="text-sm font-medium"
                    data-testid="text-rfi-detail-subject"
                  >
                    {selectedRfi.subject}
                  </p>
                </div>

                {selectedRfi.question && (
                  <div>
                    <Label className="text-xs text-muted-foreground">
                      Question
                    </Label>
                    <p
                      className="text-sm whitespace-pre-wrap"
                      data-testid="text-rfi-detail-question"
                    >
                      {selectedRfi.question}
                    </p>
                  </div>
                )}

                <div className="flex flex-wrap gap-4">
                  {selectedRfi.priority && (
                    <div>
                      <Label className="text-xs text-muted-foreground">
                        Priority
                      </Label>
                      <p
                        className="text-sm"
                        data-testid="text-rfi-detail-priority"
                      >
                        {selectedRfi.priority}
                      </p>
                    </div>
                  )}
                  <div>
                    <Label className="text-xs text-muted-foreground">
                      Date Submitted
                    </Label>
                    <p
                      className="text-sm"
                      data-testid="text-rfi-detail-date"
                    >
                      {formatDate(selectedRfi.dateSubmitted)}
                    </p>
                  </div>
                  {selectedRfi.dateRequired && (
                    <div>
                      <Label className="text-xs text-muted-foreground">
                        Date Required
                      </Label>
                      <p className="text-sm">
                        {formatDate(selectedRfi.dateRequired)}
                      </p>
                    </div>
                  )}
                </div>

                {selectedRfi.impactDescription && (
                  <div>
                    <Label className="text-xs text-muted-foreground">
                      Impact
                    </Label>
                    <p className="text-sm whitespace-pre-wrap">
                      {selectedRfi.impactDescription}
                    </p>
                  </div>
                )}

                {selectedRfi.answer && (
                  <div className="rounded-md border p-3 bg-green-50 dark:bg-green-950">
                    <Label className="text-xs text-muted-foreground flex items-center gap-1">
                      <CheckCircle2 className="h-3 w-3" />
                      Answer
                    </Label>
                    <p
                      className="text-sm whitespace-pre-wrap mt-1"
                      data-testid="text-rfi-detail-answer"
                    >
                      {selectedRfi.answer}
                    </p>
                  </div>
                )}

                {parseAttachments(selectedRfi.attachmentsJson).length > 0 && (
                  <div>
                    <Label className="text-xs text-muted-foreground flex items-center gap-1 mb-2">
                      <Paperclip className="h-3 w-3" />
                      Attachments
                    </Label>
                    <div className="space-y-1">
                      {parseAttachments(selectedRfi.attachmentsJson).map(
                        (att, i) => (
                          <a
                            key={i}
                            href={att.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-2 text-sm text-primary hover:underline"
                            data-testid={`link-rfi-attachment-${i}`}
                          >
                            <Download className="h-3.5 w-3.5" />
                            {att.name || `Attachment ${i + 1}`}
                          </a>
                        )
                      )}
                    </div>
                  </div>
                )}

                {selectedRfi.activity &&
                  Array.isArray(selectedRfi.activity) &&
                  selectedRfi.activity.length > 0 && (
                    <div>
                      <Label className="text-xs text-muted-foreground flex items-center gap-1 mb-2">
                        <MessageSquare className="h-3 w-3" />
                        Activity
                      </Label>
                      <div className="space-y-2 max-h-48 overflow-y-auto">
                        {selectedRfi.activity.map((act: any, i: number) => (
                          <div
                            key={i}
                            className="rounded-md border p-2 text-sm"
                            data-testid={`rfi-activity-${i}`}
                          >
                            <div className="flex flex-wrap items-center justify-between gap-1 mb-1">
                              <span className="font-medium text-xs">
                                {act.author || act.user || "User"}
                              </span>
                              <span className="text-xs text-muted-foreground">
                                {formatDate(act.date || act.createdAt)}
                              </span>
                            </div>
                            <p className="whitespace-pre-wrap">
                              {act.comment || act.message || act.text}
                            </p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                <div>
                  <Label
                    htmlFor="rfi-comment"
                    className="text-xs text-muted-foreground"
                  >
                    Add Comment
                  </Label>
                  <div className="flex gap-2 mt-1">
                    <Textarea
                      id="rfi-comment"
                      value={rfiComment}
                      onChange={(e) => setRfiComment(e.target.value)}
                      placeholder="Type your comment..."
                      className="text-sm"
                      data-testid="input-rfi-comment"
                    />
                  </div>
                </div>
              </div>

              <DialogFooter>
                <Button
                  onClick={() =>
                    rfiCommentMutation.mutate({
                      id: selectedRfi.id,
                      comment: rfiComment,
                    })
                  }
                  disabled={
                    !rfiComment.trim() || rfiCommentMutation.isPending
                  }
                  data-testid="button-rfi-send-comment"
                >
                  {rfiCommentMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Send className="h-4 w-4" />
                  )}
                  Send
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
