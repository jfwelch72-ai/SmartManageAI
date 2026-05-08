export interface User {
  id: string;
  firstName: string;
  lastName: string;
  role: string;
}

export interface Channel {
  id: string;
  name: string | null;
  description: string | null;
  topic: string | null;
  channelSlug: string | null;
  projectId: string | null;
  crewId: string | null;
  type: string;
  isCompanyChannel: boolean;
}

export interface Conversation {
  id: string;
  type: "DIRECT" | "GROUP" | "COMPANY";
  name: string | null;
  description: string | null;
  topic: string | null;
  channelSlug: string | null;
  projectId: string | null;
  crewId: string | null;
  rfiId: string | null;
  changeOrderId: string | null;
  taskId: string | null;
  isCompanyChannel: boolean;
  isArchived: boolean;
  createdAt: string;
  updatedAt: string;
  participants: {
    id: string;
    userId: string;
    isAdmin: boolean;
    user: User;
  }[];
  lastMessage: {
    id: string;
    content: string;
    createdAt: string;
    sender: User;
  } | null;
  unreadCount: number;
}

export type ChannelRow = (Conversation & { _unjoined?: boolean }) | (Channel & { _unjoined: true });

export interface MessageReaction {
  emoji: string;
  count: number;
  userIds: string[];
}

export interface EntityLink {
  id: string;
  entityType: "RFI" | "CHANGE_ORDER" | "TASK";
  entityId: string;
  label?: string;
  identifier?: string;
  projectCode?: string;
}

export interface EntitySearchResult {
  entityType: "RFI" | "CHANGE_ORDER" | "TASK";
  entityId: string;
  label: string;
  identifier: string;
}

export interface Message {
  id: string;
  conversationId: string;
  senderId: string;
  content: string;
  attachmentUrl: string | null;
  attachmentName: string | null;
  attachmentType: string | null;
  attachmentSize: number | null;
  voiceUrl: string | null;
  voiceDurationSeconds: number | null;
  mentionedTaskIds: string[] | null;
  isEdited: boolean;
  editedAt: string | null;
  isDeleted: boolean;
  isFieldNote: boolean;
  reactions: MessageReaction[];
  entityLinks: EntityLink[];
  createdAt: string;
  sender: User;
}

export interface TaskMention {
  id: string;
  title: string;
  projectName: string | null;
}

export interface VideoCallData {
  id: string;
  conversationId: string;
  initiatorId: string;
  status: "RINGING" | "ACTIVE" | "ENDED";
  startedAt: string;
  endedAt: string | null;
  initiator: User;
  participants: VideoCallParticipantData[];
}

export interface VideoCallParticipantData {
  id: string;
  callId: string;
  userId: string;
  joinedAt: string;
  leftAt: string | null;
  user: User;
}

export interface VideoCallNoteData {
  id: string;
  callId: string;
  authorId: string;
  content: string;
  updatedAt: string;
  createdAt: string;
}

export interface CallHistoryEntry {
  id: string;
  conversationId: string;
  initiatorId: string;
  status: string;
  startedAt: string;
  endedAt: string | null;
  durationSeconds: number | null;
  initiator: User;
  participants: VideoCallParticipantData[];
  notes: VideoCallNoteData[];
}

export function getInitials(firstName: string, lastName: string) {
  return `${firstName?.charAt(0) || ""}${lastName?.charAt(0) || ""}`.toUpperCase();
}
