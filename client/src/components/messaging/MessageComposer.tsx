import { useRef, useState } from "react";
import { Loader2, Paperclip, Mic, MicOff, Send, AtSign, X, Link2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { MentionAutocomplete } from "./MentionAutocomplete";
import { EntityLinkPicker, ENTITY_ICONS, ENTITY_LABELS, ENTITY_COLORS } from "./EntityLinkPicker";
import type { TaskMention, EntitySearchResult } from "./types";

interface MessageComposerProps {
  messageInput: string;
  isRecording: boolean;
  recordingSeconds: number;
  uploadingFile: boolean;
  uploadingVoice: boolean;
  uploadProgress: number;
  pendingTaskIds: string[];
  pendingEntityLinks: EntitySearchResult[];
  mentionQuery: string | null;
  mentionResults: TaskMention[];
  mentionSelectedIdx: number;
  typingNames: Record<string, string>;
  sendPending: boolean;
  disabled?: boolean;
  onInputChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  onSend: () => void;
  onFileSelect: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onStartRecording: () => void;
  onStopRecording: () => void;
  onMentionSelect: (task: TaskMention) => void;
  onRemovePendingTask: (id: string) => void;
  onAddEntityLink: (entity: EntitySearchResult) => void;
  onRemoveEntityLink: (entityType: string, entityId: string) => void;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
}

function fmtSeconds(s: number) {
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function MessageComposer({
  messageInput,
  isRecording,
  recordingSeconds,
  uploadingFile,
  uploadingVoice,
  uploadProgress,
  pendingTaskIds,
  pendingEntityLinks,
  mentionQuery,
  mentionResults,
  mentionSelectedIdx,
  typingNames,
  sendPending,
  disabled,
  onInputChange,
  onKeyDown,
  onSend,
  onFileSelect,
  onStartRecording,
  onStopRecording,
  onMentionSelect,
  onRemovePendingTask,
  onAddEntityLink,
  onRemoveEntityLink,
  textareaRef,
}: MessageComposerProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [entityPickerOpen, setEntityPickerOpen] = useState(false);

  return (
    <div className="p-3 border-t shrink-0">
      {/* File upload progress bar */}
      {uploadingFile && uploadProgress > 0 && uploadProgress < 100 && (
        <div className="mb-2">
          <div className="flex justify-between text-xs text-muted-foreground mb-1">
            <span>Uploading file...</span>
            <span>{uploadProgress}%</span>
          </div>
          <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full bg-primary rounded-full transition-all duration-150"
              style={{ width: `${uploadProgress}%` }}
            />
          </div>
        </div>
      )}

      {/* Entity link picker dropdown */}
      <EntityLinkPicker
        open={entityPickerOpen}
        onClose={() => setEntityPickerOpen(false)}
        onSelect={(entity) => {
          onAddEntityLink(entity);
          setEntityPickerOpen(false);
        }}
        selectedEntities={pendingEntityLinks}
      />

      {/* Task mention dropdown */}
      {mentionQuery !== null && (
        <MentionAutocomplete
          results={mentionResults}
          selectedIdx={mentionSelectedIdx}
          onSelect={onMentionSelect}
        />
      )}

      {/* Pending entity link badges */}
      {pendingEntityLinks.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-2">
          {pendingEntityLinks.map(entity => {
            const Icon = ENTITY_ICONS[entity.entityType];
            return (
              <Badge
                key={`${entity.entityType}-${entity.entityId}`}
                variant="secondary"
                className={cn("gap-1 text-xs", ENTITY_COLORS[entity.entityType])}
                data-testid={`badge-pending-entity-${entity.entityType}-${entity.entityId}`}
              >
                <Icon className="w-2.5 h-2.5" />
                {ENTITY_LABELS[entity.entityType]} {entity.identifier}
                <button onClick={() => onRemoveEntityLink(entity.entityType, entity.entityId)}>
                  <X className="w-2.5 h-2.5" />
                </button>
              </Badge>
            );
          })}
        </div>
      )}

      {/* Pending task mentions */}
      {pendingTaskIds.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-2">
          {pendingTaskIds.map(tid => (
            <Badge key={tid} variant="secondary" className="gap-1 text-xs">
              <AtSign className="w-2.5 h-2.5" />
              Task
              <button onClick={() => onRemovePendingTask(tid)}>
                <X className="w-2.5 h-2.5" />
              </button>
            </Badge>
          ))}
        </div>
      )}

      {/* Typing indicator */}
      {Object.keys(typingNames).length > 0 && (
        <div className="flex items-center gap-1.5 mb-1.5 px-1 text-xs text-muted-foreground" data-testid="typing-indicator">
          <span className="inline-flex items-end gap-0.5">
            <span className="w-1 h-1 bg-muted-foreground rounded-full animate-bounce [animation-delay:0ms]" />
            <span className="w-1 h-1 bg-muted-foreground rounded-full animate-bounce [animation-delay:150ms]" />
            <span className="w-1 h-1 bg-muted-foreground rounded-full animate-bounce [animation-delay:300ms]" />
          </span>
          <span>
            {Object.values(typingNames).join(", ")}{" "}
            {Object.values(typingNames).length === 1 ? "is" : "are"} typing…
          </span>
        </div>
      )}

      {/* Recording indicator */}
      {isRecording && (
        <div className="flex items-center gap-2 mb-2 px-3 py-1.5 bg-destructive/10 rounded-lg text-destructive text-sm">
          <span className="w-2 h-2 rounded-full bg-destructive animate-pulse" />
          Recording {fmtSeconds(recordingSeconds)}
          <Button size="sm" variant="ghost" className="ml-auto h-6 text-xs" onClick={onStopRecording}>
            Stop & Send
          </Button>
        </div>
      )}

      <div className="flex items-end gap-2">
        {/* File attachment */}
        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          onChange={onFileSelect}
          data-testid="input-file-upload"
        />
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="h-9 w-9 shrink-0"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploadingFile || isRecording}
              data-testid="button-attach-file"
            >
              {uploadingFile ? <Loader2 className="w-4 h-4 animate-spin" /> : <Paperclip className="w-4 h-4" />}
            </Button>
          </TooltipTrigger>
          <TooltipContent>Attach file</TooltipContent>
        </Tooltip>

        {/* Voice message */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              size="icon"
              variant={isRecording ? "destructive" : "ghost"}
              className="h-9 w-9 shrink-0"
              onClick={isRecording ? onStopRecording : onStartRecording}
              disabled={uploadingVoice || uploadingFile}
              data-testid="button-voice-record"
            >
              {uploadingVoice
                ? <Loader2 className="w-4 h-4 animate-spin" />
                : isRecording
                  ? <MicOff className="w-4 h-4" />
                  : <Mic className="w-4 h-4" />
              }
            </Button>
          </TooltipTrigger>
          <TooltipContent>{isRecording ? "Stop recording" : "Record voice message"}</TooltipContent>
        </Tooltip>

        {/* Link entity */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              size="icon"
              variant={entityPickerOpen ? "secondary" : "ghost"}
              className="h-9 w-9 shrink-0"
              onClick={() => setEntityPickerOpen(!entityPickerOpen)}
              disabled={isRecording}
              data-testid="button-link-entity"
            >
              <Link2 className="w-4 h-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Link RFI, Change Order, or Task</TooltipContent>
        </Tooltip>

        {/* Text input */}
        <div className="flex-1 relative">
          <Textarea
            ref={textareaRef as React.Ref<HTMLTextAreaElement>}
            placeholder="Type a message… (@ to mention a task)"
            value={messageInput}
            onChange={onInputChange}
            onKeyDown={onKeyDown}
            className="resize-none min-h-[36px] max-h-32 py-2 pr-10 text-sm"
            rows={1}
            disabled={isRecording || disabled}
            data-testid="input-message"
          />
        </div>

        {/* Send */}
        <Button
          type="submit"
          size="icon"
          className="h-9 w-9 shrink-0"
          onClick={onSend}
          disabled={!messageInput.trim() || sendPending || isRecording}
          data-testid="button-send-message"
        >
          {sendPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
        </Button>
      </div>
    </div>
  );
}
