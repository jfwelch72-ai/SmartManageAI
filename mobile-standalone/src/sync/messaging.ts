// Task #3094: mobile messaging API helpers.
// Wraps the existing web messaging endpoints so the field app can list
// threads, page messages, mark-read, and read the unread badge count.
// Outgoing sends go through the outbox (see pushMessages in coordinator.ts).
import { api } from "@/api/client";

export type ThreadParticipantUser = {
  id: string;
  firstName: string | null;
  lastName: string | null;
  role?: string;
};

export type ThreadParticipant = {
  userId: string;
  user: ThreadParticipantUser;
};

export type ThreadSummary = {
  id: string;
  type: "DIRECT" | "GROUP" | "COMPANY";
  name: string | null;
  projectId: string | null;
  isCompanyChannel: boolean;
  channelSlug: string | null;
  updatedAt: string;
  participants: ThreadParticipant[];
  lastMessage: {
    id: string;
    content: string;
    createdAt: string;
    sender: { id: string; firstName: string | null; lastName: string | null };
  } | null;
  unreadCount: number;
};

export type MessageSummary = {
  id: string;
  conversationId: string;
  senderId: string;
  content: string;
  attachmentUrl: string | null;
  attachmentName: string | null;
  attachmentType: string | null;
  voiceUrl: string | null;
  createdAt: string;
  sender: { id: string; firstName: string | null; lastName: string | null };
};

export async function listThreads(): Promise<ThreadSummary[]> {
  return api<ThreadSummary[]>("/api/conversations");
}

export async function listMessages(
  conversationId: string,
  before?: string,
): Promise<{ messages: MessageSummary[]; hasMore: boolean }> {
  const qs = before ? `?before=${encodeURIComponent(before)}` : "";
  return api<{ messages: MessageSummary[]; hasMore: boolean }>(
    `/api/conversations/${conversationId}/messages${qs}`,
  );
}

export async function markThreadRead(conversationId: string): Promise<void> {
  try {
    await api(`/api/conversations/${conversationId}/read`, { method: "POST" });
  } catch {
    // best-effort
  }
}

export async function getUnreadCount(): Promise<number> {
  try {
    const r = await api<{ unreadCount: number }>("/api/messages/unread-count");
    return r.unreadCount ?? 0;
  } catch {
    return 0;
  }
}

export function threadTitle(t: ThreadSummary, selfUserId: string | undefined): string {
  if (t.name) return t.name;
  if (t.type === "DIRECT") {
    const other = t.participants.find((p) => p.userId !== selfUserId);
    if (other?.user) {
      const fn = other.user.firstName ?? "";
      const ln = other.user.lastName ?? "";
      const full = `${fn} ${ln}`.trim();
      return full || "Direct message";
    }
    return "Direct message";
  }
  if (t.isCompanyChannel) return "Company";
  return "Channel";
}
