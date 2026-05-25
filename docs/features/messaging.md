# messaging — Conversations, Participants, Messages, Reactions, Video Calls, Real-Time Delivery, Typing Indicators, Pagination

## Overview

The messaging module provides an integrated team communications platform. Conversations can be **direct messages** (1:1) or **group channels** (project-specific or org-wide). Messages support rich text, file attachments, emoji reactions, threads/replies, read receipts, and typing indicators. Real-time delivery uses WebSocket; the REST API provides paginated message history. Video calls are initiated from a conversation and tracked with duration and participant records.

## Data Models

**Key tables (`shared/schema/features/messaging.ts`)**

| Table | Description |
|---|---|
| `conversations` | `type` (DIRECT/GROUP/PROJECT), `name`, `projectId`, `organizationId`, `createdById`, `isArchived`, `lastMessageAt` |
| `conversation_participants` | `conversationId`, `userId`, `joinedAt`, `lastReadAt`, `isAdmin`, `isMuted` |
| `messages` | `conversationId`, `senderId`, `content`, `contentType` (TEXT/IMAGE/FILE/SYSTEM), `parentMessageId` (thread), `editedAt`, `deletedAt`, `organizationId` |
| `message_attachments` | `messageId`, `fileName`, `fileUrl`, `fileSize`, `mimeType` |
| `message_reactions` | `messageId`, `userId`, `emoji`, `reactedAt` |
| `message_read_receipts` | `messageId`, `userId`, `readAt` |
| `video_calls` | `conversationId`, `initiatedById`, `status` (ACTIVE/ENDED), `startedAt`, `endedAt`, `durationSeconds`, `providerSessionId` |
| `video_call_participants` | `callId`, `userId`, `joinedAt`, `leftAt` |
| `message_pins` | Pinned messages within a conversation |
| `conversation_links` | Links to project entities (RFI, issue, daily report) shared in chat |

## Backend Routes

**File: `server/messagingRoutes.ts`**
| Method | Path | Description | Auth |
|---|---|---|---|
| GET | `/api/conversations` | Lists conversations for user | `requireAuth` + `canAccessMessages` |
| POST | `/api/conversations` | Creates conversation | `canAccessMessages` |
| GET | `/api/conversations/:id` | Conversation detail with participants | `canAccessMessages` |
| PATCH | `/api/conversations/:id` | Updates name/archive | `canAccessMessages` (admin of convo) |
| POST | `/api/conversations/:id/participants` | Adds participant | `canAccessMessages` |
| DELETE | `/api/conversations/:id/participants/:userId` | Removes participant | `canAccessMessages` |
| GET | `/api/conversations/:id/messages` | Paginated message history | `canAccessMessages` |
| POST | `/api/conversations/:id/messages` | Sends message | `canAccessMessages` |
| PATCH | `/api/conversations/:id/messages/:msgId` | Edits message | own message + `canAccessMessages` |
| DELETE | `/api/conversations/:id/messages/:msgId` | Soft-deletes message | own message + `canAccessMessages` |
| POST | `/api/conversations/:id/messages/:msgId/reactions` | Adds reaction | `canAccessMessages` |
| DELETE | `/api/conversations/:id/messages/:msgId/reactions` | Removes reaction | `canAccessMessages` |
| POST | `/api/conversations/:id/read` | Marks messages as read (updates `lastReadAt`) | `canAccessMessages` |
| POST | `/api/conversations/:id/typing` | Broadcasts typing indicator | `canAccessMessages` |
| POST | `/api/conversations/:id/video-call` | Initiates video call | `canAccessMessages` |
| PATCH | `/api/conversations/:id/video-call/:callId` | Updates call status (end) | `canAccessMessages` |
| POST | `/api/conversations/:id/messages/:msgId/pin` | Pins message | `canAccessMessages` (convo admin) |

## Frontend Pages & Components

| Route | Page File | Description |
|---|---|---|
| `/messages` | `client/src/pages/unified-messages.tsx` | Full messaging interface |
| `/portal-chat` | `client/src/pages/unified-messages.tsx` | Messaging alias for portal chat context |

Components: `ConversationList`, `MessageThread`, `MessageInput` (with attachments, emoji picker), `TypingIndicator`, `VideoCallModal`, `ReactionPicker`, `MessageReplyThread`.

## Roles & Permissions

| Action | Gate |
|---|---|
| Access messages | `canAccessMessages` — all roles except VENDOR |
| Message vendors | `canMessageVendors` — ADMIN, MANAGER |
| Access video calls | `canAccessVideoConferencing` |
| Create project channels | `canManageProjectConversations` — ADMIN, MANAGER, SUPERINTENDENT |

## Integration Points

- **WebSocket server** — `server/websocket.ts` manages a `Map<userId, WebSocket>` connection pool; `broadcastToUser(userId, event)` and `broadcastToConversation(conversationId, event)` deliver real-time messages, typing indicators, and read receipts
- **File uploads** — message attachments are uploaded to GCS via `uploadLimiter`-gated signed PUT URLs; `message_attachments.fileUrl` is a signed GET URL (5-min TTL)
- **Portal chat** — sub/vendor portal participants can be added to project conversations via `portalChatRoutes.ts`; their messages are tagged with `conversationParticipants.portalUserId`
- **Notification fan-out** — new messages trigger `notificationDelivery.ts` for users with `isMuted = false` and `lastReadAt` older than message `createdAt`; delivery via web push, email, or Slack
- **Video** — video call sessions use a pluggable provider (Daily.co or Daily.co embedded); `video_calls.providerSessionId` stores the provider's room ID
- **Pagination** — cursor-based pagination: `GET /api/conversations/:id/messages?before=<messageId>&limit=50`
