import { Fragment } from "react";
import { useLocation } from "wouter";
import { Loader2 } from "lucide-react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { MessageBubble } from "./MessageBubble";
import { MessageComposer } from "./MessageComposer";
import { type Message, type MessageReaction, type TaskMention, type Conversation } from "./types";
import { cn } from "@/lib/utils";

interface MessageListProps {
  conversation: Conversation;
  messages: Message[];
  olderMessages: Message[];
  hasMore: boolean;
  isLoadingMore: boolean;
  messagesLoading: boolean;
  currentUserId: string;
  selectedConversationId: string;

  // Edit state
  editingMessageId: string | null;
  editContent: string;
  popoverMsgId: string | null;
  onEditStart: (id: string, content: string) => void;
  onEditCancel: () => void;
  onEditSave: (id: string, content: string) => void;
  onEditContentChange: (val: string) => void;
  onDelete: (id: string) => void;
  onPickerToggle: (id: string) => void;
  onReact: (messageId: string, emoji: string) => void;
  editPending: boolean;

  // Composer state
  messageInput: string;
  isRecording: boolean;
  recordingSeconds: number;
  uploadingFile: boolean;
  uploadingVoice: boolean;
  uploadProgress: number;
  pendingTaskIds: string[];
  mentionQuery: string | null;
  mentionResults: TaskMention[];
  mentionSelectedIdx: number;
  typingNames: Record<string, string>;
  sendPending: boolean;
  onInputChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  onSend: () => void;
  onFileSelect: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onStartRecording: () => void;
  onStopRecording: () => void;
  onMentionSelect: (task: TaskMention) => void;
  onRemovePendingTask: (id: string) => void;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;

  // Scroll refs
  messagesEndRef: React.RefObject<HTMLDivElement | null>;
  scrollContainerRef: React.RefObject<HTMLDivElement | null>;
  sentinelRef: React.RefObject<HTMLDivElement | null>;
}

export function MessageList({
  conversation,
  messages,
  hasMore,
  isLoadingMore,
  messagesLoading,
  currentUserId,
  selectedConversationId,
  editingMessageId,
  editContent,
  popoverMsgId,
  onEditStart,
  onEditCancel,
  onEditSave,
  onEditContentChange,
  onDelete,
  onPickerToggle,
  onReact,
  editPending,
  messageInput,
  isRecording,
  recordingSeconds,
  uploadingFile,
  uploadingVoice,
  uploadProgress,
  pendingTaskIds,
  mentionQuery,
  mentionResults,
  mentionSelectedIdx,
  typingNames,
  sendPending,
  onInputChange,
  onKeyDown,
  onSend,
  onFileSelect,
  onStartRecording,
  onStopRecording,
  onMentionSelect,
  onRemovePendingTask,
  textareaRef,
  messagesEndRef,
  scrollContainerRef,
  sentinelRef,
}: MessageListProps) {
  const [, setLocation] = useLocation();

  const renderContent = (content: string) => {
    const parts = content.split(/(@\[[^\]]*\]\([^)]+\))/g);
    return parts.map((part, i) => {
      const mentionMatch = part.match(/^@\[([^\]]*)\]\(([^)]+)\)$/);
      if (mentionMatch) {
        const [, title, taskId] = mentionMatch;
        return (
          <a
            key={i}
            href={`/projects?taskId=${taskId}`}
            className="text-primary font-medium hover:underline cursor-pointer"
            onClick={e => { e.preventDefault(); setLocation(`/projects?taskId=${taskId}`); }}
          >
            @{title}
          </a>
        );
      }
      return <Fragment key={i}>{part}</Fragment>;
    });
  };

  const getConvDescription = () => {
    if (conversation.description) return conversation.description;
    return "No messages yet. Say hello!";
  };

  const renderConvIcon = () => {
    if (conversation.isCompanyChannel) return "🏢";
    if (conversation.projectId) return "📁";
    if (conversation.crewId) return "👷";
    if (conversation.channelSlug) return "#";
    return "💬";
  };

  const getConvName = () => {
    if (conversation.isCompanyChannel) return "Company Chat";
    return conversation.name ?? "Conversation";
  };

  return (
    <div className="flex flex-col flex-1 min-w-0">
      {/* Messages area */}
      <div
        ref={scrollContainerRef}
        className="flex-1 overflow-y-auto px-4 py-3"
      >
        {messagesLoading ? (
          <div className="flex items-center justify-center h-full">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          </div>
        ) : messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mb-3 text-2xl">
              {renderConvIcon()}
            </div>
            <p className="text-sm font-medium">{getConvName()}</p>
            <p className="text-xs text-muted-foreground mt-1">{getConvDescription()}</p>
          </div>
        ) : (
          <div className="space-y-3">
            {/* Load-earlier sentinel */}
            {hasMore && (
              <div
                ref={sentinelRef}
                className="flex justify-center py-2"
                data-testid="load-more-sentinel"
              >
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  {isLoadingMore ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>Loading earlier messages…</span>
                    </>
                  ) : (
                    <span className="opacity-50">Scroll up for earlier messages</span>
                  )}
                </div>
              </div>
            )}

            {messages.map((message) => {
              const isOwn = message.senderId === currentUserId;
              const currentParticipant = conversation?.participants.find(p => p.userId === currentUserId);
              const isAdmin = currentParticipant?.isAdmin === true;

              return (
                <MessageBubble
                  key={message.id}
                  message={message}
                  isOwn={isOwn}
                  isAdmin={isAdmin}
                  currentUserId={currentUserId}
                  editingMessageId={editingMessageId}
                  editContent={editContent}
                  popoverMsgId={popoverMsgId}
                  editPending={editPending}
                  onEditStart={onEditStart}
                  onEditCancel={onEditCancel}
                  onEditSave={onEditSave}
                  onEditContentChange={onEditContentChange}
                  onDelete={onDelete}
                  onPickerToggle={onPickerToggle}
                  onReact={onReact}
                  renderContent={renderContent}
                />
              );
            })}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* Composer */}
      <MessageComposer
        messageInput={messageInput}
        isRecording={isRecording}
        recordingSeconds={recordingSeconds}
        uploadingFile={uploadingFile}
        uploadingVoice={uploadingVoice}
        uploadProgress={uploadProgress}
        pendingTaskIds={pendingTaskIds}
        mentionQuery={mentionQuery}
        mentionResults={mentionResults}
        mentionSelectedIdx={mentionSelectedIdx}
        typingNames={typingNames}
        sendPending={sendPending}
        onInputChange={onInputChange}
        onKeyDown={onKeyDown}
        onSend={onSend}
        onFileSelect={onFileSelect}
        onStartRecording={onStartRecording}
        onStopRecording={onStopRecording}
        onMentionSelect={onMentionSelect}
        onRemovePendingTask={onRemovePendingTask}
        textareaRef={textareaRef}
      />
    </div>
  );
}
