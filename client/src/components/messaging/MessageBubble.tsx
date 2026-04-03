import { Fragment } from "react";
import { Loader2, Edit2, Trash2, Smile, Check, FileQuestion, ArrowRightLeft, CheckSquare, ClipboardList } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatDistanceToNow } from "date-fns";
import { cn } from "@/lib/utils";
import { AttachmentRenderer } from "./AttachmentRenderer";
import { VoicePlayer } from "./VoicePlayer";
import { getInitials, type Message, type MessageReaction, type EntityLink } from "./types";

const CURATED_EMOJIS = ["👍", "❤️", "😂", "😮", "🎉", "✅"] as const;

const ENTITY_CONFIG = {
  RFI: { icon: FileQuestion, label: "RFI", color: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300 border-blue-200 dark:border-blue-800" },
  CHANGE_ORDER: { icon: ArrowRightLeft, label: "CO", color: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300 border-amber-200 dark:border-amber-800" },
  TASK: { icon: CheckSquare, label: "Task", color: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300 border-green-200 dark:border-green-800" },
} as const;

interface MessageBubbleProps {
  message: Message;
  isOwn: boolean;
  isAdmin: boolean;
  currentUserId: string;
  editingMessageId: string | null;
  editContent: string;
  popoverMsgId: string | null;
  editPending: boolean;
  isFirstInGroup?: boolean;
  onEditStart: (id: string, content: string) => void;
  onEditCancel: () => void;
  onEditSave: (id: string, content: string) => void;
  onEditContentChange: (val: string) => void;
  onDelete: (id: string) => void;
  onPickerToggle: (id: string) => void;
  onReact: (messageId: string, emoji: string) => void;
  onEntityClick?: (entityType: string, entityId: string, link?: EntityLink) => void;
  renderContent: (content: string) => React.ReactNode;
}

export function MessageBubble({
  message,
  isOwn,
  isAdmin,
  currentUserId,
  editingMessageId,
  editContent,
  popoverMsgId,
  editPending,
  isFirstInGroup = true,
  onEditStart,
  onEditCancel,
  onEditSave,
  onEditContentChange,
  onDelete,
  onPickerToggle,
  onReact,
  onEntityClick,
  renderContent,
}: MessageBubbleProps) {
  const isEditing = editingMessageId === message.id;
  const isPickerOpen = popoverMsgId === message.id;
  const isFieldNote = message.isFieldNote === true;
  const canEdit = isOwn && !message.isDeleted && !message.voiceUrl && !isFieldNote;
  const canDelete = (isOwn || isAdmin) && !message.isDeleted && !isFieldNote;

  const showHeader = isFirstInGroup;

  return (
    <div
      key={message.id}
      className={cn("flex gap-2.5 group relative", isOwn && "flex-row-reverse")}
      data-testid={`message-${message.id}`}
    >
      {showHeader ? (
        <Avatar className="h-7 w-7 shrink-0 mt-0.5">
          <AvatarFallback className="text-[10px]">
            {getInitials(message.sender.firstName, message.sender.lastName)}
          </AvatarFallback>
        </Avatar>
      ) : (
        <div className="w-7 shrink-0" />
      )}

      <div className={cn("max-w-[72%]", isOwn && "text-right")}>
        {showHeader && (
          <div className={cn("flex items-center gap-1.5 mb-0.5", isOwn && "flex-row-reverse")}>
            <span className="text-xs font-semibold">
              {isOwn ? "You" : `${message.sender.firstName} ${message.sender.lastName}`}
            </span>
            <span className="text-[10px] text-muted-foreground">
              {formatDistanceToNow(new Date(message.createdAt), { addSuffix: true })}
            </span>
          </div>
        )}

        {/* Deleted placeholder */}
        {message.isDeleted ? (
          <p className="text-xs italic text-muted-foreground px-1">This message was deleted.</p>
        ) : isEditing ? (
          /* ── Inline edit mode ── */
          <div className="flex flex-col gap-1 min-w-[180px]">
            <Textarea
              value={editContent}
              onChange={e => onEditContentChange(e.target.value)}
              className="resize-none text-sm min-h-[60px]"
              autoFocus
              onKeyDown={e => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  if (editContent.trim()) onEditSave(message.id, editContent);
                }
                if (e.key === "Escape") onEditCancel();
              }}
              data-testid={`input-edit-message-${message.id}`}
            />
            <div className="flex gap-1 justify-end">
              <Button size="sm" variant="ghost" className="h-6 text-xs px-2"
                onClick={onEditCancel}
                data-testid={`button-cancel-edit-${message.id}`}
              >
                Cancel
              </Button>
              <Button size="sm" className="h-6 text-xs px-2"
                onClick={() => { if (editContent.trim()) onEditSave(message.id, editContent); }}
                disabled={!editContent.trim() || editPending}
                data-testid={`button-save-edit-${message.id}`}
              >
                {editPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                Save
              </Button>
            </div>
          </div>
        ) : (
          /* ── Normal bubble ── */
          <>
            {isFieldNote && (
              <div className={cn("flex items-center gap-1 mb-1", isOwn && "justify-end")} data-testid={`field-note-badge-${message.id}`}>
                <span className="inline-flex items-center gap-1 text-[10px] font-semibold rounded-full px-2 py-0.5 bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300 border border-amber-200 dark:border-amber-800">
                  <ClipboardList className="w-3 h-3" />
                  Field Note
                </span>
              </div>
            )}
            {message.voiceUrl ? (
              <div className={cn(isOwn && "flex justify-end")}>
                <VoicePlayer url={message.voiceUrl} durationSeconds={message.voiceDurationSeconds} />
              </div>
            ) : (
              <div className={cn(
                "rounded-2xl px-3 py-2 text-sm inline-block text-left",
                isFieldNote
                  ? "bg-amber-50 text-amber-950 border border-amber-200 dark:bg-amber-950/30 dark:text-amber-100 dark:border-amber-800"
                  : isOwn ? "bg-primary text-primary-foreground" : "bg-muted"
              )}>
                {renderContent(message.content)}
                {message.attachmentUrl && (
                  <AttachmentRenderer
                    url={message.attachmentUrl}
                    name={message.attachmentName}
                    type={message.attachmentType}
                    size={message.attachmentSize}
                  />
                )}
              </div>
            )}
            {/* Edited label with timestamp */}
            {message.isEdited && (
              <p className="text-[10px] text-muted-foreground mt-0.5 px-1">
                (edited{message.editedAt ? ` · ${formatDistanceToNow(new Date(message.editedAt), { addSuffix: true })}` : ""})
              </p>
            )}
          </>
        )}

        {/* ── Entity link badges ── */}
        {(message.entityLinks?.length ?? 0) > 0 && (
          <div className={cn("flex flex-wrap gap-1 mt-1", isOwn && "justify-end")}>
            {message.entityLinks.map((link: EntityLink) => {
              const config = ENTITY_CONFIG[link.entityType];
              const Icon = config.icon;
              const displayText = link.identifier
                ? `${link.identifier}${link.label ? `: ${link.label}` : ""}`
                : config.label;
              return (
                <button
                  key={`${link.entityType}-${link.entityId}`}
                  onClick={() => onEntityClick?.(link.entityType, link.entityId, link)}
                  className={cn(
                    "inline-flex items-center gap-1 text-[10px] font-medium rounded-full px-2 py-0.5 border cursor-pointer hover:opacity-80 transition-opacity max-w-[200px]",
                    config.color
                  )}
                  title={link.label || config.label}
                  data-testid={`entity-badge-${link.entityType}-${link.entityId}`}
                >
                  <Icon className="w-3 h-3 shrink-0" />
                  <span className="truncate">{displayText}</span>
                </button>
              );
            })}
          </div>
        )}

        {/* ── Reactions row ── */}
        {(message.reactions?.length ?? 0) > 0 && (
          <div className={cn("flex flex-wrap gap-1 mt-1", isOwn && "justify-end")}>
            {message.reactions.map((r: MessageReaction) => {
              const iMine = r.userIds.includes(currentUserId);
              return (
                <button
                  key={r.emoji}
                  onClick={() => onReact(message.id, r.emoji)}
                  className={cn(
                    "inline-flex items-center gap-0.5 text-xs rounded-full px-1.5 py-0.5 border transition-colors",
                    iMine ? "bg-primary/10 border-primary/40 text-primary" : "bg-muted border-transparent hover:border-border"
                  )}
                  data-testid={`button-reaction-${message.id}-${r.emoji}`}
                >
                  <span>{r.emoji}</span>
                  <span className="tabular-nums">{r.count}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Hover action toolbar ── */}
      {!isEditing && (
        <div className={cn(
          "self-start mt-1 shrink-0 relative",
          isOwn ? "order-first" : ""
        )}>
          <div className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-0.5">
            {/* React button */}
            {!message.isDeleted && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => onPickerToggle(message.id)}
                    className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                    data-testid={`button-react-${message.id}`}
                  >
                    <Smile className="w-3.5 h-3.5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent>React</TooltipContent>
              </Tooltip>
            )}
            {/* Edit button */}
            {canEdit && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => { onEditStart(message.id, message.content); }}
                    className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                    data-testid={`button-edit-${message.id}`}
                  >
                    <Edit2 className="w-3.5 h-3.5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent>Edit</TooltipContent>
              </Tooltip>
            )}
            {/* Delete button */}
            {canDelete && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => onDelete(message.id)}
                    className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
                    data-testid={`button-delete-${message.id}`}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent>Delete</TooltipContent>
              </Tooltip>
            )}
          </div>
          {/* Emoji picker popover */}
          {isPickerOpen && (
            <div className={cn(
              "absolute top-full mt-1 bg-popover border rounded-xl shadow-lg p-1.5 flex gap-1 z-50",
              isOwn ? "right-0" : "left-0"
            )}
              data-testid={`emoji-picker-${message.id}`}
            >
              {CURATED_EMOJIS.map(emoji => (
                <button
                  key={emoji}
                  onClick={() => onReact(message.id, emoji)}
                  className="text-xl hover:scale-125 transition-transform p-0.5 rounded"
                  data-testid={`button-emoji-${message.id}-${emoji}`}
                >
                  {emoji}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
