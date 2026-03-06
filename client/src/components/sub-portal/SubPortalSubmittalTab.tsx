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
  FolderOpen,
  Send,
  MessageSquare,
  Upload,
  Paperclip,
  Download,
  Loader2,
  Eye,
} from "lucide-react";
import { StatusBadge, formatDate, parseAttachments } from "./sub-portal-utils";

interface SubPortalSubmittalTabProps {
  submittals: any[];
  submittalsLoading: boolean;
  token: string;
}

export function SubPortalSubmittalTab({ submittals, submittalsLoading, token }: SubPortalSubmittalTabProps) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [selectedSubmittal, setSelectedSubmittal] = useState<any>(null);
  const [submittalComment, setSubmittalComment] = useState("");

  const submittalCommentMutation = useMutation({
    mutationFn: async ({ id, comment }: { id: string; comment: string }) => {
      const res = await fetch(`/api/portal/submittals/${id}/comment`, {
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
      queryClient.invalidateQueries({ queryKey: ["/api/portal/submittals"] });
      toast({ title: "Comment posted" });
      setSubmittalComment("");
    },
    onError: () => {
      toast({ title: "Failed to post comment", variant: "destructive" });
    },
  });

  return (
    <>
      {submittalsLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : submittals.length === 0 ? (
        <Card data-testid="empty-submittals">
          <CardContent className="py-12 text-center">
            <FolderOpen className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
            <p className="text-muted-foreground text-sm">
              No submittals found for this project.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {submittals.map((sub: any) => (
            <Card
              key={sub.id}
              className="cursor-pointer hover-elevate"
              onClick={() => setSelectedSubmittal(sub)}
              data-testid={`card-submittal-${sub.id}`}
            >
              <CardContent className="p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2 mb-1">
                      <span
                        className="font-medium text-sm"
                        data-testid={`text-submittal-number-${sub.id}`}
                      >
                        {sub.submittalNumber}
                      </span>
                      <StatusBadge status={sub.status} />
                      {sub.submittalType && (
                        <Badge
                          variant="outline"
                          className="text-xs"
                          data-testid={`badge-submittal-type-${sub.id}`}
                        >
                          {sub.submittalType}
                        </Badge>
                      )}
                    </div>
                    <p
                      className="text-sm truncate"
                      data-testid={`text-submittal-subject-${sub.id}`}
                    >
                      {sub.subject}
                    </p>
                  </div>
                  {sub.phase && (
                    <span
                      className="text-xs text-muted-foreground"
                      data-testid={`text-submittal-phase-${sub.id}`}
                    >
                      {sub.phase}
                    </span>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog
        open={!!selectedSubmittal}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedSubmittal(null);
            setSubmittalComment("");
          }
        }}
      >
        <DialogContent
          className="max-w-2xl max-h-[85vh] overflow-y-auto"
          data-testid="dialog-submittal-detail"
        >
          {selectedSubmittal && (
            <>
              <DialogHeader>
                <DialogTitle className="flex flex-wrap items-center gap-2">
                  <FolderOpen className="h-5 w-5" />
                  <span data-testid="text-submittal-detail-number">
                    {selectedSubmittal.submittalNumber}
                  </span>
                  <StatusBadge status={selectedSubmittal.status} />
                </DialogTitle>
              </DialogHeader>

              <div className="space-y-4">
                <div>
                  <Label className="text-xs text-muted-foreground">
                    Subject
                  </Label>
                  <p
                    className="text-sm font-medium"
                    data-testid="text-submittal-detail-subject"
                  >
                    {selectedSubmittal.subject}
                  </p>
                </div>

                {selectedSubmittal.description && (
                  <div>
                    <Label className="text-xs text-muted-foreground">
                      Description
                    </Label>
                    <p className="text-sm whitespace-pre-wrap">
                      {selectedSubmittal.description}
                    </p>
                  </div>
                )}

                <div className="flex flex-wrap gap-4">
                  {selectedSubmittal.submittalType && (
                    <div>
                      <Label className="text-xs text-muted-foreground">
                        Type
                      </Label>
                      <p className="text-sm">
                        {selectedSubmittal.submittalType}
                      </p>
                    </div>
                  )}
                  {selectedSubmittal.phase && (
                    <div>
                      <Label className="text-xs text-muted-foreground">
                        Phase
                      </Label>
                      <p className="text-sm">{selectedSubmittal.phase}</p>
                    </div>
                  )}
                  {selectedSubmittal.specSection && (
                    <div>
                      <Label className="text-xs text-muted-foreground">
                        Spec Section
                      </Label>
                      <p className="text-sm">
                        {selectedSubmittal.specSection}
                      </p>
                    </div>
                  )}
                </div>

                {selectedSubmittal.reviewComment && (
                  <div className="rounded-md border p-3">
                    <Label className="text-xs text-muted-foreground flex items-center gap-1">
                      <Eye className="h-3 w-3" />
                      Review Comment
                    </Label>
                    <p className="text-sm whitespace-pre-wrap mt-1">
                      {selectedSubmittal.reviewComment}
                    </p>
                  </div>
                )}

                {parseAttachments(selectedSubmittal.attachmentsJson).length >
                  0 && (
                  <div>
                    <Label className="text-xs text-muted-foreground flex items-center gap-1 mb-2">
                      <Paperclip className="h-3 w-3" />
                      Attachments
                    </Label>
                    <div className="space-y-1">
                      {parseAttachments(selectedSubmittal.attachmentsJson).map(
                        (att, i) => (
                          <a
                            key={i}
                            href={att.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-2 text-sm text-primary hover:underline"
                            data-testid={`link-submittal-attachment-${i}`}
                          >
                            <Download className="h-3.5 w-3.5" />
                            {att.name || `Attachment ${i + 1}`}
                          </a>
                        )
                      )}
                    </div>
                  </div>
                )}

                {selectedSubmittal.activity &&
                  Array.isArray(selectedSubmittal.activity) &&
                  selectedSubmittal.activity.length > 0 && (
                    <div>
                      <Label className="text-xs text-muted-foreground flex items-center gap-1 mb-2">
                        <MessageSquare className="h-3 w-3" />
                        Activity
                      </Label>
                      <div className="space-y-2 max-h-48 overflow-y-auto">
                        {selectedSubmittal.activity.map(
                          (act: any, i: number) => (
                            <div
                              key={i}
                              className="rounded-md border p-2 text-sm"
                              data-testid={`submittal-activity-${i}`}
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
                          )
                        )}
                      </div>
                    </div>
                  )}

                <div>
                  <Label className="text-xs text-muted-foreground flex items-center gap-1 mb-2">
                    <Upload className="h-3 w-3" />
                    Upload File
                  </Label>
                  <div
                    className="rounded-md border border-dashed p-4 text-center"
                    data-testid="container-submittal-upload"
                  >
                    <Upload className="h-6 w-6 mx-auto text-muted-foreground mb-2" />
                    <p className="text-xs text-muted-foreground mb-2">
                      Drag and drop or click to upload files
                    </p>
                    <input
                      type="file"
                      className="hidden"
                      id="submittal-file-input"
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        if (!file || !selectedSubmittal) return;
                        const formData = new FormData();
                        formData.append("file", file);
                        try {
                          const res = await fetch(
                            `/api/portal/submittals/${selectedSubmittal.id}/upload`,
                            {
                              method: "POST",
                              headers: {
                                "x-portal-token": token,
                              },
                              body: formData,
                            }
                          );
                          if (!res.ok) throw new Error("Upload failed");
                          queryClient.invalidateQueries({
                            queryKey: ["/api/portal/submittals"],
                          });
                          toast({ title: "File uploaded successfully" });
                        } catch {
                          toast({
                            title: "Failed to upload file",
                            variant: "destructive",
                          });
                        }
                        e.target.value = "";
                      }}
                      data-testid="input-submittal-file"
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        document
                          .getElementById("submittal-file-input")
                          ?.click()
                      }
                      data-testid="button-submittal-upload"
                    >
                      <Upload className="h-4 w-4" />
                      Choose File
                    </Button>
                  </div>
                </div>

                <div>
                  <Label
                    htmlFor="submittal-comment"
                    className="text-xs text-muted-foreground"
                  >
                    Add Comment
                  </Label>
                  <div className="flex gap-2 mt-1">
                    <Textarea
                      id="submittal-comment"
                      value={submittalComment}
                      onChange={(e) => setSubmittalComment(e.target.value)}
                      placeholder="Type your comment..."
                      className="text-sm"
                      data-testid="input-submittal-comment"
                    />
                  </div>
                </div>
              </div>

              <DialogFooter>
                <Button
                  onClick={() =>
                    submittalCommentMutation.mutate({
                      id: selectedSubmittal.id,
                      comment: submittalComment,
                    })
                  }
                  disabled={
                    !submittalComment.trim() ||
                    submittalCommentMutation.isPending
                  }
                  data-testid="button-submittal-send-comment"
                >
                  {submittalCommentMutation.isPending ? (
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
