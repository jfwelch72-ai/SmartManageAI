import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  MoreHorizontal, Edit, Copy, Send, AlertCircle, Trash2,
  Clock, CheckCircle, Megaphone, Hash, ExternalLink, Sparkles, ThumbsUp
} from "lucide-react";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import { format } from "date-fns";
import { type SocialPost, STATUS_COLORS, getPlatformInfo } from "./types";

export function PostCard({ post, onEdit, onDelete, onPublish, onDuplicate, onReject, onApprove }: {
  post: SocialPost;
  onEdit: (post: SocialPost) => void;
  onDelete: (id: string) => void;
  onPublish: (id: string) => void;
  onDuplicate: (id: string) => void;
  onReject: (id: string) => void;
  onApprove?: (id: string) => void;
}) {
  const info = getPlatformInfo(post.platform || "FACEBOOK");
  const Icon = info.icon;

  return (
    <Card className="hover:shadow-md transition-shadow" data-testid={`post-card-${post.id}`}>
      <CardContent className="pt-4 pb-3 px-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3 flex-1 min-w-0">
            <div className="p-2 rounded-lg border shrink-0" style={{ borderColor: info.color + "40" }}>
              <Icon className="h-4 w-4" style={{ color: info.color }} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                {post.title && <p className="text-sm font-medium truncate">{post.title}</p>}
                <Badge className={`text-xs shrink-0 ${STATUS_COLORS[post.status] || ""}`} variant="secondary">
                  {post.status.replace(/_/g, " ")}
                </Badge>
                {post.aiGenerated && (
                  <Badge variant="outline" className="text-xs shrink-0">
                    <Sparkles className="h-3 w-3 mr-1" />AI
                  </Badge>
                )}
              </div>
              <p className="text-sm text-muted-foreground line-clamp-2">{post.content}</p>
              {post.mediaUrls && post.mediaUrls.length > 0 && (
                <div className="flex gap-1 mt-2">
                  {post.mediaUrls.slice(0, 4).map((url, i) => (
                    <div key={i} className="w-10 h-10 rounded border overflow-hidden shrink-0">
                      <img src={url} alt="" className="w-full h-full object-cover" />
                    </div>
                  ))}
                  {post.mediaUrls.length > 4 && (
                    <div className="w-10 h-10 rounded border flex items-center justify-center text-xs text-muted-foreground">+{post.mediaUrls.length - 4}</div>
                  )}
                </div>
              )}
              <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
                {post.scheduledAt && (
                  <span className="flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    {format(new Date(post.scheduledAt), "MMM d, h:mm a")}
                  </span>
                )}
                {post.publishedAt && (
                  <span className="flex items-center gap-1">
                    <CheckCircle className="h-3 w-3" />
                    {format(new Date(post.publishedAt), "MMM d, h:mm a")}
                  </span>
                )}
                {post.campaignTag && (
                  <span className="flex items-center gap-1">
                    <Megaphone className="h-3 w-3" />
                    {post.campaignTag}
                  </span>
                )}
                {post.hashtags && post.hashtags.length > 0 && (
                  <span className="flex items-center gap-1">
                    <Hash className="h-3 w-3" />
                    {post.hashtags.length} tags
                  </span>
                )}
                {post.externalPostUrl && (
                  <a href={post.externalPostUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-primary hover:underline" onClick={e => e.stopPropagation()}>
                    <ExternalLink className="h-3 w-3" />View Post
                  </a>
                )}
              </div>
              {post.rejectionReason && post.approvalStatus === "rejected" && (
                <div className="mt-2 px-2 py-1.5 rounded bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 text-xs text-red-700 dark:text-red-400" data-testid={`rejection-reason-${post.id}`}>
                  <strong>Rejected:</strong> {post.rejectionReason}
                </div>
              )}
              {post.status === "FAILED" && post.lastError && (
                <div className="mt-2 px-2 py-1.5 rounded bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 text-xs text-red-700 dark:text-red-400">
                  <strong>Error:</strong> {post.lastError}
                </div>
              )}
            </div>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="shrink-0" data-testid={`post-actions-${post.id}`}>
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {post.status !== "POSTED" && (
                <DropdownMenuItem onClick={() => onEdit(post)} data-testid={`edit-post-${post.id}`}>
                  <Edit className="h-4 w-4 mr-2" />Edit
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onClick={() => onDuplicate(post.id)} data-testid={`duplicate-post-${post.id}`}>
                <Copy className="h-4 w-4 mr-2" />Duplicate
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              {post.status === "PENDING_APPROVAL" && onApprove && (
                <DropdownMenuItem onClick={() => onApprove(post.id)} className="text-green-600 focus:text-green-600" data-testid={`approve-post-${post.id}`}>
                  <ThumbsUp className="h-4 w-4 mr-2" />Approve
                </DropdownMenuItem>
              )}
              {post.status === "PENDING_APPROVAL" && (
                <DropdownMenuItem onClick={() => onReject(post.id)} className="text-amber-600 focus:text-amber-600" data-testid={`reject-post-${post.id}`}>
                  <AlertCircle className="h-4 w-4 mr-2" />Reject
                </DropdownMenuItem>
              )}
              {post.status !== "POSTED" && post.status !== "PENDING_APPROVAL" && (
                <DropdownMenuItem onClick={() => onPublish(post.id)} data-testid={`publish-post-${post.id}`}>
                  <Send className="h-4 w-4 mr-2" />Publish Now
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => {
                navigator.clipboard.writeText(post.content + (post.hashtags?.length ? "\n\n" + post.hashtags.map(h => "#" + h).join(" ") : ""));
              }} data-testid={`copy-content-${post.id}`}>
                <Copy className="h-4 w-4 mr-2" />Copy Content
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onDelete(post.id)} className="text-destructive focus:text-destructive" data-testid={`delete-post-${post.id}`}>
                <Trash2 className="h-4 w-4 mr-2" />Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </CardContent>
    </Card>
  );
}
