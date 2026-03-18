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

export type ChannelRow = Conversation & { _unjoined?: boolean };

export interface MessageReaction {
  emoji: string;
  count: number;
  userIds: string[];
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
  reactions: MessageReaction[];
  createdAt: string;
  sender: User;
}

export interface TaskMention {
  id: string;
  title: string;
  projectName: string | null;
}

export function getInitials(firstName: string, lastName: string) {
  return `${firstName?.charAt(0) || ""}${lastName?.charAt(0) || ""}`.toUpperCase();
}
