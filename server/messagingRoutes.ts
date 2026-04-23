/**
 * @openapi
 * /api/conversations:
 *   get:
 *     tags: [Messaging]
 *     summary: List conversations
 *     description: Returns all conversations for the authenticated user including direct messages and group chats.
 *     responses:
 *       200: { description: List of conversations with last message preview }
 *   post:
 *     tags: [Messaging]
 *     summary: Create a new conversation
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [participantIds]
 *             properties:
 *               name: { type: string }
 *               participantIds: { type: array, items: { type: string, format: uuid } }
 *               type: { type: string }
 *               projectId: { type: string, format: uuid }
 *     responses:
 *       201: { description: Conversation created }
 *       400: { description: Invalid input }
 * /api/conversations/company-channel:
 *   get:
 *     tags: [Messaging]
 *     summary: Get or create the company-wide channel
 *     description: Returns the organization's company-wide channel, creating it if it doesn't exist.
 *     responses:
 *       200: { description: Company channel }
 * /api/channels:
 *   get:
 *     tags: [Messaging]
 *     summary: List channels
 *     description: Returns all channels for the organization.
 *     responses:
 *       200: { description: List of channels }
 *   post:
 *     tags: [Messaging]
 *     summary: Create a channel
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name]
 *             properties:
 *               name: { type: string }
 *               description: { type: string }
 *     responses:
 *       201: { description: Channel created }
 * /api/channels/{id}/join:
 *   post:
 *     tags: [Messaging]
 *     summary: Join a channel
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Joined channel }
 * /api/channels/{id}/archive:
 *   patch:
 *     tags: [Messaging]
 *     summary: Archive a channel
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Channel archived }
 * /api/conversations/{id}/messages:
 *   get:
 *     tags: [Messaging]
 *     summary: Get messages in a conversation
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - name: before
 *         in: query
 *         schema: { type: string, format: date-time }
 *       - name: limit
 *         in: query
 *         schema: { type: integer, default: 50 }
 *     responses:
 *       200: { description: List of messages }
 *   post:
 *     tags: [Messaging]
 *     summary: Send a message
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [content]
 *             properties:
 *               content: { type: string }
 *               replyToId: { type: string, format: uuid }
 *     responses:
 *       201: { description: Message sent }
 * /api/conversations/{id}/upload:
 *   post:
 *     tags: [Messaging]
 *     summary: Upload a file to a conversation
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               file:
 *                 type: string
 *                 format: binary
 *     responses:
 *       201: { description: File uploaded }
 * /api/conversations/{id}/voice:
 *   post:
 *     tags: [Messaging]
 *     summary: Send a voice message
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               audio:
 *                 type: string
 *                 format: binary
 *     responses:
 *       201: { description: Voice message sent }
 * /api/conversations/{id}/files/{filename}:
 *   get:
 *     tags: [Messaging]
 *     summary: Download a file from a conversation
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - name: filename
 *         in: path
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: File content }
 * /api/conversations/{id}/voice/{filename}:
 *   get:
 *     tags: [Messaging]
 *     summary: Download a voice message
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - name: filename
 *         in: path
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Voice message audio }
 * /api/conversations/{id}/mention-search:
 *   get:
 *     tags: [Messaging]
 *     summary: Search mentionable users in conversation
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - name: q
 *         in: query
 *         schema: { type: string }
 *     responses:
 *       200: { description: List of mentionable users }
 * /api/conversations/{id}/read:
 *   post:
 *     tags: [Messaging]
 *     summary: Mark conversation as read
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Conversation marked as read }
 * /api/conversations/{id}/typing:
 *   post:
 *     tags: [Messaging]
 *     summary: Send typing indicator
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Typing indicator sent }
 * /api/messages/unread-count:
 *   get:
 *     tags: [Messaging]
 *     summary: Get total unread message count
 *     responses:
 *       200:
 *         description: Unread count
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 count: { type: integer }
 * /api/messages/{msgId}:
 *   patch:
 *     tags: [Messaging]
 *     summary: Edit a message
 *     parameters:
 *       - name: msgId
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [content]
 *             properties:
 *               content: { type: string }
 *     responses:
 *       200: { description: Message updated }
 *   delete:
 *     tags: [Messaging]
 *     summary: Delete a message
 *     parameters:
 *       - name: msgId
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Message deleted }
 * /api/messages/{msgId}/reactions:
 *   post:
 *     tags: [Messaging]
 *     summary: Add a reaction to a message
 *     parameters:
 *       - name: msgId
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [emoji]
 *             properties:
 *               emoji: { type: string }
 *     responses:
 *       201: { description: Reaction added }
 * /api/messages/{msgId}/reactions/{emoji}:
 *   delete:
 *     tags: [Messaging]
 *     summary: Remove a reaction from a message
 *     parameters:
 *       - name: msgId
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - name: emoji
 *         in: path
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Reaction removed }
 * /api/messages/{msgId}/entity-links:
 *   get:
 *     tags: [Messaging]
 *     summary: Get entity links for a message
 *     parameters:
 *       - name: msgId
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: List of entity links }
 *   post:
 *     tags: [Messaging]
 *     summary: Link an entity to a message
 *     parameters:
 *       - name: msgId
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [entityType, entityId]
 *             properties:
 *               entityType: { type: string }
 *               entityId: { type: string, format: uuid }
 *     responses:
 *       201: { description: Entity linked }
 * /api/messages/{msgId}/entity-links/{linkId}:
 *   delete:
 *     tags: [Messaging]
 *     summary: Remove entity link from a message
 *     parameters:
 *       - name: msgId
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - name: linkId
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Entity link removed }
 * /api/messaging/users:
 *   get:
 *     tags: [Messaging]
 *     summary: List users for messaging
 *     description: Returns users in the organization available for messaging.
 *     responses:
 *       200: { description: List of users }
 * /api/messaging/events:
 *   get:
 *     tags: [Messaging]
 *     summary: Server-Sent Events stream for messaging
 *     description: Opens an SSE connection for real-time messaging updates (new messages, edits, deletes, reactions, typing).
 *     responses:
 *       200:
 *         description: SSE event stream
 *         content:
 *           text/event-stream: {}
 * /api/entity-search:
 *   get:
 *     tags: [Messaging]
 *     summary: Search entities for linking in messages
 *     parameters:
 *       - name: q
 *         in: query
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Search results }
 * /api/entity-project/{entityType}/{entityId}:
 *   get:
 *     tags: [Messaging]
 *     summary: Get entity project context
 *     parameters:
 *       - name: entityType
 *         in: path
 *         required: true
 *         schema: { type: string }
 *       - name: entityId
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Entity project context }
 * /api/entity-messages/{entityType}/{entityId}:
 *   get:
 *     tags: [Messaging]
 *     summary: Get messages linked to an entity
 *     parameters:
 *       - name: entityType
 *         in: path
 *         required: true
 *         schema: { type: string }
 *       - name: entityId
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: List of linked messages }
 * /api/entity-conversation/{entityType}/{entityId}:
 *   get:
 *     tags: [Messaging]
 *     summary: Get conversation for an entity
 *     parameters:
 *       - name: entityType
 *         in: path
 *         required: true
 *         schema: { type: string }
 *       - name: entityId
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Entity conversation }
 * /api/entity-conversation:
 *   post:
 *     tags: [Messaging]
 *     summary: Create a conversation linked to an entity
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [entityType, entityId]
 *             properties:
 *               entityType: { type: string }
 *               entityId: { type: string, format: uuid }
 *     responses:
 *       201: { description: Entity conversation created }
 */
import {logError, logInfo, logWarn } from "./utils/logger";
import { Router } from "express";
import { db } from "./db";
import { users, projects as projectsTable, aiTasks } from "@shared/schema";
import { requireAuth, requireRole, type AuthRequest } from "./auth";
import { isFeatureEnabled } from "./services/featureFlagService";
import { eq, desc, sql, and, lt, inArray, or, isNotNull, ilike, isNull, type SQL } from "drizzle-orm";
import { sanitizeText } from "./sanitization";
import { getOrgIdForFilter } from "./orgFilter";
import multer from "multer";
import { randomUUID } from "crypto";
import { z } from "zod";
import { ObjectStorageService, objectStorageClient, ObjectNotFoundError } from "./objectStorage";
import { assertStorageKeyBelongsToOrg } from "./services/storageKeyOwnership";
import { registerSseClient, emitMessageNew, emitMessageEdited, emitMessageDeleted, emitMessageReaction, emitTyping, emitCallStarted, emitCallJoined, emitCallLeft, emitCallEnded } from "./messagingEvents";
import { fileTypeFromBuffer } from "file-type";

const router = Router();

// ── Max voice payload: 2 min × 128 kbps / 8 = 1,920,000 bytes ≈ 2 MB ──
// This is a conservative upper-bound for WebM/Opus compressed audio at 2 minutes.
const MAX_VOICE_BYTES = 2 * 1024 * 1024;

const msgUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }, // 25MB limit for regular files
});

const voiceUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_VOICE_BYTES }, // ~2 min of compressed audio
});

const messagingSetup = (async () => {
  const {
    conversations,
    conversationParticipants,
    messages,
    messageReactions,
    messageReadReceipts,
    messageEntityLinks,
    organizations,
    tasks,
    notifications,
    rfis,
    changeOrders,
    videoCalls,
    videoCallParticipants,
    videoCallNotes,
  } = await import("@shared/schema");

  // ── Helper: ensure user is a participant (or auto-join for org channels) ──
  async function ensureParticipant(conversationId: string, userId: string): Promise<boolean> {
    const [p] = await db
      .select()
      .from(conversationParticipants)
      .where(and(eq(conversationParticipants.conversationId, conversationId), eq(conversationParticipants.userId, userId)))
      .limit(1);
    return !!p;
  }

  // Get all conversations for current user
  router.get("/api/conversations", requireAuth, async (req: AuthRequest, res, next) => {
    try {
      const userId = req.user!.id;

      const userConversations = await db
        .select({
          conversation: conversations,
          participant: conversationParticipants,
        })
        .from(conversationParticipants)
        .innerJoin(conversations, eq(conversationParticipants.conversationId, conversations.id))
        .where(eq(conversationParticipants.userId, userId))
        .orderBy(desc(conversations.updatedAt));

      const conversationsWithDetails = await Promise.all(
        userConversations.map(async ({ conversation, participant }) => {
          const participants = await db
            .select({
              participant: conversationParticipants,
              user: {
                id: users.id,
                firstName: users.firstName,
                lastName: users.lastName,
                role: users.role,
              },
            })
            .from(conversationParticipants)
            .innerJoin(users, eq(conversationParticipants.userId, users.id))
            .where(eq(conversationParticipants.conversationId, conversation.id));

          const [lastMessage] = await db
            .select({
              message: messages,
              sender: {
                id: users.id,
                firstName: users.firstName,
                lastName: users.lastName,
              },
            })
            .from(messages)
            .innerJoin(users, eq(messages.senderId, users.id))
            .where(eq(messages.conversationId, conversation.id))
            .orderBy(desc(messages.createdAt))
            .limit(1);

          const unreadMessages = await db
            .select({ count: sql<number>`count(*)` })
            .from(messages)
            .leftJoin(
              messageReadReceipts,
              and(
                eq(messageReadReceipts.messageId, messages.id),
                eq(messageReadReceipts.userId, userId)
              )
            )
            .where(
              and(
                eq(messages.conversationId, conversation.id),
                sql`${messageReadReceipts.id} IS NULL`,
                sql`${messages.senderId} != ${userId}`
              )
            );

          return {
            ...conversation,
            participants: participants.map(p => ({
              ...p.participant,
              user: p.user,
            })),
            lastMessage: lastMessage ? {
              ...lastMessage.message,
              sender: lastMessage.sender,
            } : null,
            unreadCount: Number(unreadMessages[0]?.count || 0),
            currentUserParticipant: participant,
          };
        })
      );

      res.json(conversationsWithDetails);
    } catch (error) {
      next(error);
    }
  });

  // ── CHANNELS: list all org channels (named, project, crew) ──
  router.get("/api/channels", requireAuth, async (req: AuthRequest, res, next) => {
    try {
      const organizationId = req.user!.organizationId;
      if (!organizationId) return res.status(400).json({ error: "Organization required" });

      const orgChannels = await db
        .select()
        .from(conversations)
        .where(
          and(
            eq(conversations.organizationId, organizationId),
            eq(conversations.isArchived, false),
            or(
              isNotNull(conversations.channelSlug),
              isNotNull(conversations.projectId),
              isNotNull(conversations.crewId)
            )
          )
        )
        .orderBy(conversations.name);

      res.json(orgChannels);
    } catch (error) {
      next(error);
    }
  });

  const createChannelSchema = z.object({
    name: z.string().min(1).max(200),
    description: z.string().max(1000).optional(),
    topic: z.string().max(500).optional(),
    slug: z.string().max(80).optional(),
  });

  router.post("/api/channels", requireAuth, async (req: AuthRequest, res, next) => {
    try {
      const userId = req.user!.id;
      const organizationId = req.user!.organizationId;
      if (!organizationId) return res.status(400).json({ error: "Organization required" });

      const validation = createChannelSchema.safeParse(req.body);
      if (!validation.success) return res.status(400).json({ error: "Invalid channel data", details: validation.error.errors });
      const { name, description, topic, slug: rawSlug } = validation.data;
      if (!name?.trim()) return res.status(400).json({ error: "Channel name is required" });

      // Allow explicit slug; fall back to deriving from name
      const slug = rawSlug
        ? rawSlug.trim().toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "").slice(0, 80)
        : name.trim().toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "").slice(0, 80);
      if (!slug) return res.status(400).json({ error: "Channel slug could not be derived from the given name" });

      // Check for duplicate slug
      const [existing] = await db
        .select({ id: conversations.id })
        .from(conversations)
        .where(and(eq(conversations.organizationId, organizationId), eq(conversations.channelSlug, slug)))
        .limit(1);
      if (existing) return res.status(409).json({ error: "A channel with that name already exists" });

      const [newChannel] = await db
        .insert(conversations)
        .values({
          type: "GROUP",
          name: name.trim(),
          description: description || null,
          topic: topic || null,
          channelSlug: slug,
          isCompanyChannel: false,
          organizationId,
          createdById: userId,
        })
        .returning();

      // Add creator
      await db.insert(conversationParticipants).values({
        conversationId: newChannel.id,
        userId,
        isAdmin: true,
      });

      res.status(201).json(newChannel);
    } catch (error) {
      next(error);
    }
  });

  // ── CHANNELS: self-join a channel ──
  router.post("/api/channels/:id/join", requireAuth, async (req: AuthRequest, res, next) => {
    try {
      const userId = req.user!.id;
      const orgId = req.user!.organizationId;
      const conversationId = req.params.id;

      if (!orgId) return res.status(400).json({ error: "Organization required" });

      // Verify target is a real channel (not a DM), belongs to this org, and is not archived
      const [channel] = await db
        .select()
        .from(conversations)
        .where(
          and(
            eq(conversations.id, conversationId),
            eq(conversations.organizationId, orgId),
            eq(conversations.isArchived, false),
            // Must be an actual channel (named, project, or crew) — not a DM
            or(
              isNotNull(conversations.channelSlug),
              isNotNull(conversations.projectId),
              isNotNull(conversations.crewId)
            )
          )
        )
        .limit(1);

      if (!channel) return res.status(404).json({ error: "Channel not found or not accessible" });

      await db
        .insert(conversationParticipants)
        .values({ conversationId, userId, isAdmin: false })
        .onConflictDoNothing();

      res.json({ success: true });
    } catch (error) {
      next(error);
    }
  });

  // ── CHANNELS: archive a channel (admin only) ──
  router.patch("/api/channels/:id/archive", requireAuth, async (req: AuthRequest, res, next) => {
    try {
      const userId = req.user!.id;
      const conversationId = req.params.id;

      const [p] = await db
        .select()
        .from(conversationParticipants)
        .where(and(eq(conversationParticipants.conversationId, conversationId), eq(conversationParticipants.userId, userId), eq(conversationParticipants.isAdmin, true)))
        .limit(1);

      if (!p) return res.status(403).json({ error: "Only channel admins can archive channels" });

      await db.update(conversations).set({ isArchived: true }).where(eq(conversations.id, conversationId));
      res.json({ success: true });
    } catch (error) {
      next(error);
    }
  });

  // Get or create company-wide channel (scoped to organization)
  router.get("/api/conversations/company-channel", requireAuth, async (req: AuthRequest, res, next) => {
    try {
      const userId = req.user!.id;
      const organizationId = req.user!.organizationId;

      if (!organizationId) {
        res.status(400).json({ error: "You must belong to an organization to access company chat" });
        return;
      }

      let [companyChannel] = await db
        .select()
        .from(conversations)
        .where(
          and(
            eq(conversations.isCompanyChannel, true),
            eq(conversations.organizationId, organizationId)
          )
        )
        .limit(1);

      if (!companyChannel) {
        const [org] = await db
          .select({ name: organizations.name })
          .from(organizations)
          .where(eq(organizations.id, organizationId))
          .limit(1);

        const orgName = org?.name || "Company";

        [companyChannel] = await db
          .insert(conversations)
          .values({
            type: "COMPANY",
            name: `${orgName} Team Chat`,
            description: "Company-wide announcements and general discussion",
            isCompanyChannel: true,
            organizationId: organizationId,
            createdById: userId,
          })
          .returning();

        const orgUsers = await db
          .select({ id: users.id })
          .from(users)
          .where(
            and(
              eq(users.isActive, true),
              eq(users.organizationId, organizationId)
            )
          );

        if (orgUsers.length > 0) {
          await db.insert(conversationParticipants).values(
            orgUsers.map(u => ({
              conversationId: companyChannel.id,
              userId: u.id,
              isAdmin: u.id === userId,
            }))
          );
        }
      } else {
        const [existingParticipant] = await db
          .select()
          .from(conversationParticipants)
          .where(
            and(
              eq(conversationParticipants.conversationId, companyChannel.id),
              eq(conversationParticipants.userId, userId)
            )
          )
          .limit(1);

        if (!existingParticipant) {
          await db.insert(conversationParticipants).values({
            conversationId: companyChannel.id,
            userId: userId,
            isAdmin: false,
          });
        }
      }

      res.json(companyChannel);
    } catch (error) {
      next(error);
    }
  });

  // Create a new conversation (direct message or group)
  const createConversationSchema = z.object({
    type: z.enum(["DIRECT", "GROUP"]),
    name: z.string().max(200).optional(),
    description: z.string().max(1000).optional(),
    participantIds: z.array(z.string().uuid()).optional(),
    projectId: z.string().uuid().optional(),
  });

  router.post("/api/conversations", requireAuth, async (req: AuthRequest, res, next) => {
    try {
      const userId = req.user!.id;
      const organizationId = req.user!.organizationId;
      const validation = createConversationSchema.safeParse(req.body);
      if (!validation.success) {
        res.status(400).json({ error: "Invalid conversation data", details: validation.error.errors });
        return;
      }
      const { type, name, description, participantIds } = validation.data;

      if (!organizationId) {
        res.status(400).json({ error: "You must belong to an organization to create conversations" });
        return;
      }

      if (participantIds && participantIds.length > 0) {
        const participantUsers = await db
          .select({ id: users.id, organizationId: users.organizationId })
          .from(users)
          .where(sql`${users.id} IN ${participantIds}`);

        const crossOrgParticipants = participantUsers.filter(u => u.organizationId !== organizationId);
        if (crossOrgParticipants.length > 0) {
          res.status(400).json({ error: "Cannot create conversations with users from different organizations" });
          return;
        }
      }

      if (type === "DIRECT" && participantIds?.length === 1) {
        const otherUserId = participantIds[0];

        const existingConversations = await db
          .select({ conversationId: conversationParticipants.conversationId })
          .from(conversationParticipants)
          .innerJoin(conversations, eq(conversationParticipants.conversationId, conversations.id))
          .where(
            and(
              eq(conversations.type, "DIRECT"),
              eq(conversationParticipants.userId, userId)
            )
          );

        for (const { conversationId } of existingConversations) {
          const [otherParticipant] = await db
            .select()
            .from(conversationParticipants)
            .where(
              and(
                eq(conversationParticipants.conversationId, conversationId),
                eq(conversationParticipants.userId, otherUserId)
              )
            )
            .limit(1);

          if (otherParticipant) {
            const [existingConv] = await db
              .select()
              .from(conversations)
              .where(eq(conversations.id, conversationId))
              .limit(1);
            res.json(existingConv);
            return;
          }
        }
      }

      const [newConversation] = await db
        .insert(conversations)
        .values({
          type: type as "DIRECT" | "GROUP",
          name: type === "GROUP" ? (name || "Group Chat") : null,
          description: description || null,
          isCompanyChannel: false,
          organizationId: organizationId,
          createdById: userId,
        })
        .returning();

      await db.insert(conversationParticipants).values({
        conversationId: newConversation.id,
        userId: userId,
        isAdmin: true,
      });

      if (participantIds && participantIds.length > 0) {
        await db.insert(conversationParticipants).values(
          participantIds.map((pId: string) => ({
            conversationId: newConversation.id,
            userId: pId,
            isAdmin: false,
          }))
        );
      }

      res.status(201).json(newConversation);
    } catch (error) {
      next(error);
    }
  });

  const addParticipantsSchema = z.object({
    userIds: z.array(z.string().uuid()).min(1),
  });

  router.post("/api/conversations/:id/participants", requireAuth, async (req: AuthRequest, res, next) => {
    try {
      const userId = req.user!.id;
      const organizationId = req.user!.organizationId;
      const conversationId = req.params.id;

      if (!organizationId) {
        res.status(400).json({ error: "You must belong to an organization" });
        return;
      }

      const validation = addParticipantsSchema.safeParse(req.body);
      if (!validation.success) {
        res.status(400).json({ error: "userIds must be a non-empty array of valid user IDs" });
        return;
      }
      const { userIds } = validation.data;

      const dedupedUserIds = [...new Set(userIds as string[])];

      const isParticipant = await ensureParticipant(conversationId, userId);
      if (!isParticipant) {
        res.status(403).json({ error: "Not a participant of this conversation" });
        return;
      }

      const [conv] = await db
        .select()
        .from(conversations)
        .where(and(eq(conversations.id, conversationId), eq(conversations.organizationId, organizationId)))
        .limit(1);

      if (!conv) {
        res.status(404).json({ error: "Conversation not found" });
        return;
      }

      if (conv.type === "DIRECT") {
        res.status(400).json({ error: "Cannot add participants to direct conversations" });
        return;
      }

      const validUsers = await db
        .select({ id: users.id, organizationId: users.organizationId })
        .from(users)
        .where(inArray(users.id, dedupedUserIds));

      if (validUsers.length !== dedupedUserIds.length) {
        res.status(400).json({ error: "One or more user IDs are invalid" });
        return;
      }

      const crossOrgUsers = validUsers.filter(u => u.organizationId !== organizationId);
      if (crossOrgUsers.length > 0) {
        res.status(400).json({ error: "Cannot add users from different organizations" });
        return;
      }

      const existingParticipants = await db
        .select({ userId: conversationParticipants.userId })
        .from(conversationParticipants)
        .where(eq(conversationParticipants.conversationId, conversationId));

      const existingUserIds = new Set(existingParticipants.map(p => p.userId));
      const newUserIds = dedupedUserIds.filter(id => !existingUserIds.has(id));

      if (newUserIds.length > 0) {
        await db.insert(conversationParticipants).values(
          newUserIds.map((uid: string) => ({
            conversationId,
            userId: uid,
            isAdmin: false,
          }))
        );
      }

      res.status(201).json({ added: newUserIds.length });
    } catch (error) {
      next(error);
    }
  });

  // Get messages for a conversation (cursor-based pagination)
  // Query params:
  //   before=<messageId> — return the PAGE_SIZE messages immediately preceding this message
  // Response: { messages: Message[], hasMore: boolean }
  router.get("/api/conversations/:id/messages", requireAuth, async (req: AuthRequest, res, next) => {
    try {
      const userId = req.user!.id;
      const conversationId = req.params.id;
      const PAGE_SIZE = 50;
      const before = (req.query.before as string) || undefined;

      const isParticipant = await ensureParticipant(conversationId, userId);
      if (!isParticipant) {
        res.status(403).json({ error: "Not a participant of this conversation" });
        return;
      }

      // Build where clause — add cursor condition when `before` is provided.
      // `before` may be a message ID (UUID) or an ISO 8601 timestamp string.
      // For message-ID cursors a deterministic tie-breaker is added so pages
      // never skip or repeat messages that share the same createdAt value.
      let whereClause: SQL<unknown> = eq(messages.conversationId, conversationId);
      if (before) {
        // Detect ISO timestamp: contains "T" and parses as a valid date
        const asDate = new Date(before);
        const isTimestamp = before.includes("T") && !isNaN(asDate.getTime());

        if (isTimestamp) {
          // Timestamp cursor — filter strictly before this date
          whereClause = and(
            eq(messages.conversationId, conversationId),
            lt(messages.createdAt, asDate)
          ) as SQL<unknown>;
        } else {
          // Message-ID cursor — resolve (createdAt, id) for stable pagination
          const cursorRows = await db
            .select({ id: messages.id, createdAt: messages.createdAt })
            .from(messages)
            .where(eq(messages.id, before))
            .limit(1);

          if (cursorRows[0]) {
            const { id: cursorId, createdAt: cursorCreatedAt } = cursorRows[0];
            // Tie-breaker: include messages at the same timestamp that sort
            // before the cursor by ID, guaranteeing no gaps at page boundaries.
            whereClause = and(
              eq(messages.conversationId, conversationId),
              or(
                lt(messages.createdAt, cursorCreatedAt),
                and(
                  eq(messages.createdAt, cursorCreatedAt),
                  lt(messages.id, cursorId)
                )
              )
            ) as SQL<unknown>;
          }
        }
      }

      // Fetch PAGE_SIZE + 1 to detect whether older messages exist.
      // Secondary sort by id ensures a stable page order when createdAt ties.
      const messageResults = await db
        .select({
          message: messages,
          sender: {
            id: users.id,
            firstName: users.firstName,
            lastName: users.lastName,
            role: users.role,
          },
        })
        .from(messages)
        .innerJoin(users, eq(messages.senderId, users.id))
        .where(whereClause)
        .orderBy(desc(messages.createdAt), desc(messages.id))
        .limit(PAGE_SIZE + 1);

      const hasMore = messageResults.length > PAGE_SIZE;
      const messagesWithSenders = messageResults
        .slice(0, PAGE_SIZE)
        .reverse()
        .map(m => ({ ...m.message, sender: m.sender }));

      const messageIds = messagesWithSenders.map(m => m.id);
      const reactionMap = await loadReactions(messageIds);
      const entityLinkMap = await loadEntityLinks(messageIds);
      const messagesWithExtras = messagesWithSenders.map(m => ({
        ...m,
        reactions: reactionMap.get(m.id) ?? [],
        entityLinks: entityLinkMap.get(m.id) ?? [],
      }));

      res.json({ messages: messagesWithExtras, hasMore });
    } catch (error) {
      next(error);
    }
  });

  // Send a message (supports file attachments, voice, and task mentions)
  const sendMessageSchema = z.object({
    content: z.string().max(10000).optional(),
    attachmentUrl: z.string().max(2000).optional(),
    attachmentName: z.string().max(500).optional(),
    attachmentType: z.string().max(200).optional(),
    attachmentSize: z.union([z.number(), z.string()]).optional(),
    voiceUrl: z.string().max(2000).optional(),
    voiceDurationSeconds: z.union([z.number(), z.string()]).optional(),
    mentionedTaskIds: z.array(z.string()).optional().nullable(),
    entityLinks: z.array(z.object({
      entityType: z.string(),
      entityId: z.string(),
    })).optional(),
  });

  router.post("/api/conversations/:id/messages", requireAuth, async (req: AuthRequest, res, next) => {
    try {
      const userId = req.user!.id;
      const orgId = req.user!.organizationId;
      const conversationId = req.params.id;
      const validation = sendMessageSchema.safeParse(req.body);
      if (!validation.success) {
        res.status(400).json({ error: "Invalid message data", details: validation.error.errors });
        return;
      }
      const { content, attachmentUrl, attachmentName, attachmentType, attachmentSize, voiceUrl, voiceDurationSeconds, mentionedTaskIds, entityLinks } = validation.data;

      if (!content?.trim() && !attachmentUrl && !voiceUrl) {
        res.status(400).json({ error: "Message content or attachment is required" });
        return;
      }

      const isParticipant = await ensureParticipant(conversationId, userId);
      if (!isParticipant) {
        res.status(403).json({ error: "Not a participant of this conversation" });
        return;
      }

      // ── Tenancy gate for client-supplied attachment / voice URLs (Task #1347) ──
      // The chat history embeds these URLs verbatim and pushes them out over realtime
      // to all participants. Without validation, Org A could post a message in their
      // own conversation referencing an Org B object — leaking the existence/path of
      // that object even though the read endpoints would still ACL-check on access.
      // Allowed forms:
      //   1. /api/conversations/<this-conversation>/files/<filename>
      //   2. /api/conversations/<this-conversation>/voice/<filename>
      //   3. /objects/<entity>  — must belong to caller's org per stored ACL/intent
      // Anything else (including a sibling conversation in the same org) is rejected
      // so we don't leak object existence across tenants OR across conversations.
      const validateMessageMediaUrl = async (url: string, kind: "attachment" | "voice"): Promise<void> => {
        if (typeof url !== "string" || url.length === 0) return;
        const subPath = kind === "voice" ? "voice" : "files";
        const expectedPrefix = `/api/conversations/${conversationId}/${subPath}/`;
        if (url.startsWith(expectedPrefix)) {
          const filename = url.slice(expectedPrefix.length);
          // Reject path-traversal or nested paths — filename only.
          if (!filename || filename.includes("/") || filename.includes("..")) {
            throw Object.assign(new Error("Invalid attachment URL"), { status: 400 });
          }
          return;
        }
        if (url.startsWith("/objects/")) {
          await assertStorageKeyBelongsToOrg(url, orgId!, userId, req.user?.role);
          return;
        }
        throw Object.assign(
          new Error(`${kind === "voice" ? "Voice" : "Attachment"} URL must reference this conversation or an object owned by your organization`),
          { status: 403 },
        );
      };

      if (!orgId && (attachmentUrl || voiceUrl)) {
        res.status(400).json({ error: "Organization required" });
        return;
      }

      try {
        if (attachmentUrl) await validateMessageMediaUrl(attachmentUrl, "attachment");
        if (voiceUrl) await validateMessageMediaUrl(voiceUrl, "voice");
      } catch (err: any) {
        const status = err?.status === 400 ? 400 : 403;
        res.status(status).json({ error: err?.message || "Forbidden" });
        return;
      }

      const sanitizedContent = content ? sanitizeText(content) : "";

      const [newMessage] = await db
        .insert(messages)
        .values({
          conversationId: conversationId as string,
          senderId: userId,
          content: sanitizedContent || (voiceUrl ? "[Voice message]" : "[Attachment]"),
          attachmentUrl: attachmentUrl || null,
          attachmentName: attachmentName || null,
          attachmentType: attachmentType || null,
          attachmentSize: attachmentSize ? Number(attachmentSize) : null,
          voiceUrl: voiceUrl || null,
          voiceDurationSeconds: voiceDurationSeconds ? Number(voiceDurationSeconds) : null,
          mentionedTaskIds: mentionedTaskIds || null,
        })
        .returning();

      await db
        .update(conversations)
        .set({ updatedAt: new Date() })
        .where(eq(conversations.id, conversationId));

      await db.insert(messageReadReceipts).values({
        messageId: newMessage.id,
        userId: userId,
      }).onConflictDoNothing();

      const [sender] = await db
        .select({
          id: users.id,
          firstName: users.firstName,
          lastName: users.lastName,
          role: users.role,
        })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);

      let insertedEntityLinks: { id: string; entityType: string; entityId: string }[] = [];
      if (Array.isArray(entityLinks) && entityLinks.length > 0 && orgId) {
        const validEntityTypes = ["RFI", "CHANGE_ORDER", "TASK"] as const;
        type ValidType = typeof validEntityTypes[number];
        const candidateLinks = entityLinks
          .filter((l: { entityType: string; entityId: string }) => (validEntityTypes as readonly string[]).includes(l.entityType) && l.entityId);
        const validatedLinks = await validateEntityLinksOrg(candidateLinks, orgId);
        const linkValues = validatedLinks.map((l) => ({
          messageId: newMessage.id,
          entityType: l.entityType as ValidType,
          entityId: l.entityId,
        }));
        if (linkValues.length > 0) {
          insertedEntityLinks = await db.insert(messageEntityLinks).values(linkValues).onConflictDoNothing().returning();
        }
      }

      let enrichedEntityLinks = insertedEntityLinks;
      if (insertedEntityLinks.length > 0) {
        const enrichedMap = await loadEntityLinks([newMessage.id]);
        enrichedEntityLinks = enrichedMap.get(newMessage.id) || insertedEntityLinks;
      }
      const fullMessage = { ...newMessage, sender, reactions: [], entityLinks: enrichedEntityLinks };

      if (orgId) {
        const participants = await db
          .select({ userId: conversationParticipants.userId })
          .from(conversationParticipants)
          .where(eq(conversationParticipants.conversationId, conversationId));
        const participantUserIds = new Set(participants.map(p => p.userId));
        emitMessageNew(orgId, conversationId, participantUserIds, fullMessage);
      }

      // ── Mention notifications — notify each task's assigned user ──
      // Constrained to caller's org to prevent cross-tenant notification injection.
      if (Array.isArray(mentionedTaskIds) && mentionedTaskIds.length > 0 && orgId) {
        const mentionedTasks = await db
          .select({ id: tasks.id, assignedToId: tasks.assignedToId, title: tasks.title, projectId: tasks.projectId })
          .from(tasks)
          .where(and(
            inArray(tasks.id, mentionedTaskIds),
            eq(tasks.organizationId, orgId),
          ));

        const notifiedUsers = new Set<string>();
        for (const t of mentionedTasks) {
          if (t.assignedToId && t.assignedToId !== userId && !notifiedUsers.has(t.assignedToId)) {
            notifiedUsers.add(t.assignedToId);
            // Link target: /projects?taskId=<id> — encoded in relatedEntityType/Id for notification routing
            const [insertedNotif] = await db.insert(notifications).values({
              userId: t.assignedToId,
              organizationId: orgId,
              type: "TASK_MENTIONED",
              title: "You were mentioned in a message",
              message: `Someone referenced your task "${t.title}" in a conversation.`,
              relatedEntityId: t.id,
              relatedEntityType: "task",
            }).returning();
            if (insertedNotif) {
              const { deliverNotification } = await import("./services/notificationDelivery");
              setImmediate(() => {
                deliverNotification(insertedNotif as Parameters<typeof deliverNotification>[0]).catch(() => undefined);
              });
            }
          }
        }
      }

      res.status(201).json(fullMessage);
    } catch (error) {
      next(error);
    }
  });

  // ── FILE UPLOAD for messaging ──
  router.post("/api/conversations/:id/upload", requireAuth, msgUpload.single("file"), async (req: AuthRequest, res, next) => {
    try {
      const userId = req.user!.id;
      const orgId = req.user!.organizationId;
      const conversationId = req.params.id;

      if (!orgId) return res.status(400).json({ error: "Organization required" });

      const isParticipant = await ensureParticipant(conversationId, userId);
      if (!isParticipant) return res.status(403).json({ error: "Not a participant of this conversation" });

      const file = req.file;
      if (!file) return res.status(400).json({ error: "No file provided" });

      // ── Server-side MIME detection: use actual file bytes rather than browser-supplied Content-Type ──
      const detectedType = await fileTypeFromBuffer(file.buffer);
      // Reject if detected type contradicts the browser-reported type.
      // We compare exact MIME strings first; the only narrow exception is that some containers
      // (e.g. "application/octet-stream" or legacy application/zip) are legitimately reported as
      // application/* by browsers when the underlying format is a document type we still accept.
      // Any file whose bytes detect as a category totally different from the declared category is rejected.
      if (detectedType) {
        const clientMime = file.mimetype.toLowerCase();
        const detectedMime = detectedType.mime.toLowerCase();
        if (detectedMime !== clientMime) {
          // Allow only if both agree on the top-level category AND client declared application/octet-stream
          // (generic binary); otherwise reject as a mismatch.
          const clientCategory = clientMime.split("/")[0];
          const detectedCategory = detectedMime.split("/")[0];
          const isGenericBinary = clientMime === "application/octet-stream";
          const categoryMatch = clientCategory === detectedCategory;
          if (!isGenericBinary && !categoryMatch) {
            return res.status(415).json({ error: "File type does not match uploaded content." });
          }
          if (!isGenericBinary && categoryMatch) {
            // Same category but different sub-type (e.g. image/png vs image/jpeg) — reject
            return res.status(415).json({ error: "Declared MIME type does not match the actual file content." });
          }
          // isGenericBinary: allow and canonicalise to detected type below
        }
      }
      // Use server-detected MIME type as the canonical stored type (falls back to browser-reported if undetectable)
      const canonicalMime = detectedType ? detectedType.mime : file.mimetype;
      // Use server-detected extension if available to keep the filename consistent with the actual content
      const ext = detectedType ? detectedType.ext : (file.originalname.split(".").pop() || "bin");

      const objectStorage = new ObjectStorageService();
      const publicPaths = objectStorage.getPublicObjectSearchPaths();
      if (publicPaths.length === 0) return next(new Error("Object storage not configured"));

      const basePath = publicPaths[0];
      const uniqueId = randomUUID();
      const fileName = `messaging/${orgId}/${conversationId}/${uniqueId}.${ext}`;
      const fullPath = `${basePath}/${fileName}`;
      const pathParts = fullPath.split("/").filter(p => p.length > 0);
      const bucketName = pathParts[0];
      const objectName = pathParts.slice(1).join("/");

      const bucket = objectStorageClient.bucket(bucketName);
      const blob = bucket.file(objectName);

      await blob.save(file.buffer, {
        metadata: {
          contentType: canonicalMime,
          metadata: { originalName: file.originalname, source: "messaging" },
        },
      });

      const proxyUrl = `/api/conversations/${conversationId}/files/${uniqueId}.${ext}`;
      res.json({
        url: proxyUrl,
        name: file.originalname,
        type: canonicalMime,
        size: file.size,
      });
    } catch (error) {
      next(error);
    }
  });

  // ── VOICE MESSAGE UPLOAD — uploads audio and creates the message in one step ──
  // Uses voiceUpload (2 MB limit) so oversized payloads are rejected by multer before business logic runs.
  router.post("/api/conversations/:id/voice", requireAuth, (req, res, next) => {
    voiceUpload.single("audio")(req, res, (err) => {
      if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
        res.status(413).json({ error: "Voice message exceeds the 2-minute limit. Please record a shorter message." });
        return;
      }
      next(err);
    });
  }, async (req: AuthRequest, res, next) => {
    try {
      const userId = req.user!.id;
      const orgId = req.user!.organizationId;
      const conversationId = req.params.id;
      const durationSeconds = req.body.duration ? Math.min(Number(req.body.duration), 120) : null;

      if (!orgId) return res.status(400).json({ error: "Organization required" });

      const isParticipant = await ensureParticipant(conversationId, userId);
      if (!isParticipant) return res.status(403).json({ error: "Not a participant of this conversation" });

      const file = req.file;
      if (!file) return res.status(400).json({ error: "No audio file provided" });

      // ── MIME detection: verify uploaded bytes are audio, not a disguised non-audio file ──
      const detectedVoiceType = await fileTypeFromBuffer(file.buffer);
      // Allowlist of accepted MIME types for voice messages.
      // MediaRecorder in Chrome/Firefox typically produces audio/webm (Opus), but file-type
      // often detects WebM containers as video/webm regardless of codec — both are valid voice.
      const ACCEPTED_VOICE_MIMES = new Set([
        "audio/webm", "video/webm",
        "audio/ogg", "video/ogg",
        "audio/mp4", "video/mp4",
        "audio/mpeg", "audio/wav", "audio/flac", "audio/aac",
        "audio/x-m4a",
      ]);
      // Explicit equivalence pairs: these MIME strings refer to the same container/format
      // and should be treated as matching each other (e.g. WebM container reported differently
      // by browser vs file-type library).
      const WEBM_PAIR: [string, string] = ["audio/webm", "video/webm"];
      const isEquivalentPair = (a: string, b: string) =>
        (a === WEBM_PAIR[0] && b === WEBM_PAIR[1]) ||
        (a === WEBM_PAIR[1] && b === WEBM_PAIR[0]);

      if (detectedVoiceType) {
        const detectedMime = detectedVoiceType.mime;
        // Reject if detected bytes are clearly not audio/video
        if (!ACCEPTED_VOICE_MIMES.has(detectedMime)) {
          return res.status(415).json({ error: "Uploaded file is not a valid audio format." });
        }
        // Enforce client MIME matches detected MIME (spoofing guard).
        // Only narrow equivalence exceptions are permitted.
        const clientMime = (file.mimetype || "").toLowerCase();
        if (clientMime) {
          const exactMatch = clientMime === detectedMime;
          if (!exactMatch && !isEquivalentPair(clientMime, detectedMime)) {
            return res.status(415).json({ error: "Declared MIME type does not match the actual audio content." });
          }
        }
      } else {
        // File type undetectable — only allow if client reported an accepted audio/video MIME
        const clientMime = (file.mimetype || "").toLowerCase();
        if (!ACCEPTED_VOICE_MIMES.has(clientMime)) {
          return res.status(415).json({ error: "Uploaded file is not a valid audio format." });
        }
      }
      const canonicalVoiceMime = detectedVoiceType ? detectedVoiceType.mime : (file.mimetype || "audio/webm");

      const objectStorage = new ObjectStorageService();
      const publicPaths = objectStorage.getPublicObjectSearchPaths();
      if (publicPaths.length === 0) return next(new Error("Object storage not configured"));

      const basePath = publicPaths[0];
      const uniqueId = randomUUID();
      const fileName = `messaging/${orgId}/${conversationId}/voice-${uniqueId}.webm`;
      const fullPath = `${basePath}/${fileName}`;
      const pathParts = fullPath.split("/").filter(p => p.length > 0);
      const bucketName = pathParts[0];
      const objectName = pathParts.slice(1).join("/");

      const bucket = objectStorageClient.bucket(bucketName);
      const blob = bucket.file(objectName);

      await blob.save(file.buffer, {
        metadata: {
          contentType: canonicalVoiceMime,
          metadata: { source: "messaging-voice" },
        },
      });

      const proxyUrl = `/api/conversations/${conversationId}/voice/${uniqueId}.webm`;

      // Save and return the message immediately
      const [newMessage] = await db
        .insert(messages)
        .values({
          conversationId: conversationId as string,
          senderId: userId,
          content: "[Voice message]",
          voiceUrl: proxyUrl,
          voiceDurationSeconds: durationSeconds,
        })
        .returning();

      await db.update(conversations).set({ updatedAt: new Date() }).where(eq(conversations.id, conversationId));
      await db.insert(messageReadReceipts).values({ messageId: newMessage.id, userId }).onConflictDoNothing();

      const [sender] = await db
        .select({ id: users.id, firstName: users.firstName, lastName: users.lastName, role: users.role })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);

      const voiceMsg = { ...newMessage, sender };

      if (orgId) {
        const participants = await db
          .select({ userId: conversationParticipants.userId })
          .from(conversationParticipants)
          .where(eq(conversationParticipants.conversationId, conversationId));
        const participantUserIds = new Set(participants.map(p => p.userId));
        emitMessageNew(orgId, conversationId, participantUserIds, voiceMsg);
      }

      res.status(201).json(voiceMsg);
    } catch (error) {
      next(error);
    }
  });

  // ── SERVE FILES from object storage ──
  router.get("/api/conversations/:id/files/:filename", requireAuth, async (req: AuthRequest, res, next) => {
    try {
      const orgId = req.user!.organizationId;
      const userId = req.user!.id;
      const conversationId = req.params.id;
      const filename = req.params.filename;

      const isParticipant = await ensureParticipant(conversationId, userId);
      if (!isParticipant) {
        res.status(403).json({ error: "Not a participant of this conversation" });
        return;
      }

      const objectStorage = new ObjectStorageService();
      const publicPaths = objectStorage.getPublicObjectSearchPaths();
      if (publicPaths.length === 0) return next(new Error("Object storage not configured"));

      const basePath = publicPaths[0];
      const filePath = `messaging/${orgId}/${conversationId}/${filename}`;
      const file = await objectStorage.searchPublicObject(filePath);
      if (!file) return res.status(404).json({ error: "File not found" });

      objectStorage.downloadObject(file, res, 86400);
    } catch (error: any) {
      logError("Serve file error:", {}, error instanceof Error ? error : new Error(String(error)));
      if (error instanceof ObjectNotFoundError) return res.status(404).json({ error: "File not found" });
      next(error);
    }
  });

  // ── SERVE VOICE from object storage ──
  async function serveVoiceStream(file: any, req: any, res: any) {
    const [metadata] = await file.getMetadata();
    const fileSize = Number(metadata.size || 0);
    const rawContentType = metadata.contentType || "audio/webm";
    const contentType = rawContentType === "video/webm" ? "audio/webm" : rawContentType;
    logInfo(`[Voice] Serving file: size=${fileSize}, contentType=${contentType} (raw: ${rawContentType}), range=${req.headers.range || "none"}`);

    res.set("Accept-Ranges", "bytes");
    res.set("Content-Type", contentType);
    res.set("Cache-Control", "private, max-age=86400");

    if (fileSize > 0) {
      res.set("Content-Length", String(fileSize));
    }
    const stream = file.createReadStream();
    stream.on("error", (streamErr: Error) => {
      logError("Voice stream error:", {}, streamErr instanceof Error ? streamErr : new Error(String(streamErr)));
      if (!res.headersSent) next(streamErr);
    });
    stream.pipe(res);
  }

  router.get("/api/conversations/:id/voice/:filename", requireAuth, async (req: AuthRequest, res, next) => {
    try {
      const orgId = req.user!.organizationId;
      const userId = req.user!.id;
      const conversationId = req.params.id;
      const filename = req.params.filename;

      const isParticipant = await ensureParticipant(conversationId, userId);
      if (!isParticipant) {
        res.status(403).json({ error: "Not a participant of this conversation" });
        return;
      }

      const objectStorage = new ObjectStorageService();
      const publicPaths = objectStorage.getPublicObjectSearchPaths();
      if (publicPaths.length === 0) return next(new Error("Object storage not configured"));

      const primaryPath = `messaging/${orgId}/${conversationId}/voice-${filename}`;
      let file = await objectStorage.searchPublicObject(primaryPath);
      if (!file) {
        logInfo(`[Voice] Primary path not found: ${primaryPath}, trying fallback`);
        const fallbackPath = `messaging/${orgId}/${conversationId}/${filename}`;
        file = await objectStorage.searchPublicObject(fallbackPath);
        if (!file) logInfo(`[Voice] Fallback path also not found: ${fallbackPath}`);
      }
      if (!file) return res.status(404).json({ error: "Voice file not found" });

      await serveVoiceStream(file, req, res);
    } catch (error: any) {
      logError("Serve voice error:", {}, error instanceof Error ? error : new Error(String(error)));
      if (error instanceof ObjectNotFoundError) return res.status(404).json({ error: "File not found" });
      next(error);
    }
  });

  // ── TASK MENTION SEARCH — scoped to conversation (and its linked project if any) ──
  // Returns { id, title, projectName } for both project tasks and AI tasks
  router.get("/api/conversations/:id/mention-search", requireAuth, async (req: AuthRequest, res, next) => {
    try {
      const userId = req.user!.id;
      const orgId = req.user!.organizationId;
      const conversationId = req.params.id;
      if (!orgId) return res.status(400).json({ error: "Organization required" });

      const isParticipant = await ensureParticipant(conversationId, userId);
      if (!isParticipant) return res.status(403).json({ error: "Not a participant of this conversation" });

      const q = (req.query.q as string) || "";

      // Optionally narrow to the conversation's linked project
      const [conv] = await db
        .select({ projectId: conversations.projectId })
        .from(conversations)
        .where(eq(conversations.id, conversationId))
        .limit(1);
      const scopedProjectId = conv?.projectId;

      // Query project tasks joined with project name
      const taskConditions: SQL<unknown>[] = [eq(tasks.organizationId, orgId)];
      if (q.trim()) taskConditions.push(ilike(tasks.title, `%${q}%`));
      if (scopedProjectId) taskConditions.push(eq(tasks.projectId, scopedProjectId));

      const taskResults = await db
        .select({
          id: tasks.id,
          title: tasks.title,
          projectName: projectsTable.name,
        })
        .from(tasks)
        .leftJoin(projectsTable, eq(tasks.projectId, projectsTable.id))
        .where(and(...taskConditions))
        .limit(8);

      // Query AI tasks — must be scoped to org via project join (innerJoin enforces org isolation)
      const aiConditions: SQL<unknown>[] = [eq(projectsTable.gcOrganizationId, orgId)];
      if (q.trim()) aiConditions.push(ilike(aiTasks.title, `%${q}%`));
      if (scopedProjectId) aiConditions.push(eq(aiTasks.projectId, scopedProjectId));

      const aiTaskResults = await db
        .select({
          id: aiTasks.id,
          title: aiTasks.title,
          projectName: projectsTable.name,
        })
        .from(aiTasks)
        .innerJoin(projectsTable, eq(aiTasks.projectId, projectsTable.id))
        .where(and(...aiConditions))
        .limit(5);

      // Merge and de-duplicate by id, cap at 10 total
      const seen = new Set<string>();
      const combined: { id: string; title: string; projectName: string | null }[] = [];
      for (const r of [...taskResults, ...aiTaskResults]) {
        if (!seen.has(r.id)) {
          seen.add(r.id);
          combined.push(r);
          if (combined.length >= 10) break;
        }
      }

      res.json(combined);
    } catch (error) {
      next(error);
    }
  });

  // Mark messages as read
  router.post("/api/conversations/:id/read", requireAuth, async (req: AuthRequest, res, next) => {
    try {
      const userId = req.user!.id;
      const conversationId = req.params.id;

      const [participant] = await db
        .select()
        .from(conversationParticipants)
        .where(
          and(
            eq(conversationParticipants.conversationId, conversationId),
            eq(conversationParticipants.userId, userId)
          )
        )
        .limit(1);

      if (!participant) {
        res.status(403).json({ error: "Not a participant of this conversation" });
        return;
      }

      const unreadMessages = await db
        .select({ id: messages.id })
        .from(messages)
        .leftJoin(
          messageReadReceipts,
          and(
            eq(messageReadReceipts.messageId, messages.id),
            eq(messageReadReceipts.userId, userId)
          )
        )
        .where(
          and(
            eq(messages.conversationId, conversationId),
            sql`${messageReadReceipts.id} IS NULL`
          )
        );

      if (unreadMessages.length > 0) {
        await db.insert(messageReadReceipts).values(
          unreadMessages.map(m => ({
            messageId: m.id,
            userId: userId,
          }))
        ).onConflictDoNothing();
      }

      await db
        .update(conversationParticipants)
        .set({ lastReadAt: new Date() })
        .where(
          and(
            eq(conversationParticipants.conversationId, conversationId),
            eq(conversationParticipants.userId, userId)
          )
        );

      res.json({ success: true, markedAsRead: unreadMessages.length });
    } catch (error) {
      next(error);
    }
  });

  router.delete("/api/conversations/:id/leave", requireAuth, async (req: AuthRequest, res, next) => {
    try {
      const userId = req.user!.id;
      const conversationId = req.params.id;

      const [conv] = await db
        .select()
        .from(conversations)
        .where(eq(conversations.id, conversationId))
        .limit(1);

      if (!conv) {
        res.status(404).json({ error: "Conversation not found" });
        return;
      }

      if (conv.type !== "DIRECT") {
        res.status(400).json({ error: "Only direct message conversations can be removed this way" });
        return;
      }

      const [participant] = await db
        .select()
        .from(conversationParticipants)
        .where(
          and(
            eq(conversationParticipants.conversationId, conversationId),
            eq(conversationParticipants.userId, userId)
          )
        )
        .limit(1);

      if (!participant) {
        res.status(403).json({ error: "Not a participant of this conversation" });
        return;
      }

      await db
        .delete(conversationParticipants)
        .where(
          and(
            eq(conversationParticipants.conversationId, conversationId),
            eq(conversationParticipants.userId, userId)
          )
        );

      res.json({ success: true });
    } catch (error) {
      next(error);
    }
  });

  // Get total unread message count for navigation badge
  router.get("/api/messages/unread-count", requireAuth, async (req: AuthRequest, res, next) => {
    try {
      const userId = req.user!.id;

      const userConversationIds = await db
        .select({ conversationId: conversationParticipants.conversationId })
        .from(conversationParticipants)
        .where(eq(conversationParticipants.userId, userId));

      if (userConversationIds.length === 0) {
        res.json({ unreadCount: 0 });
        return;
      }

      const convIds = userConversationIds.map(c => c.conversationId);

      const unreadCount = await db
        .select({ count: sql<number>`count(*)` })
        .from(messages)
        .leftJoin(
          messageReadReceipts,
          and(
            eq(messageReadReceipts.messageId, messages.id),
            eq(messageReadReceipts.userId, userId)
          )
        )
        .where(
          and(
            inArray(messages.conversationId, convIds),
            sql`${messageReadReceipts.id} IS NULL`,
            sql`${messages.senderId} != ${userId}`
          )
        );

      res.json({ unreadCount: Number(unreadCount[0]?.count || 0) });
    } catch (error) {
      next(error);
    }
  });

  // Get users available for messaging
  router.get("/api/messaging/users", requireAuth, async (req: AuthRequest, res, next) => {
    try {
      const userId = req.user!.id;

      const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);

      if (mustDenyAccess) {
        return res.json([]);
      }

      const conditions = [
        eq(users.isActive, true),
        sql`${users.id} != ${userId}`
      ];

      if (shouldFilter && orgId) {
        conditions.push(eq(users.organizationId, orgId));
      }

      const availableUsers = await db
        .select({
          id: users.id,
          firstName: users.firstName,
          lastName: users.lastName,
          role: users.role,
        })
        .from(users)
        .where(and(...conditions))
        .orderBy(users.firstName, users.lastName);

      res.json(availableUsers);
    } catch (error) {
      next(error);
    }
  });

  // ── SSE: real-time messaging events ──
  // Streams `message_new` and `user_typing` events to authenticated clients.
  // Scoped per organization to prevent cross-tenant leakage.
  router.get("/api/messaging/events", requireAuth, (req: AuthRequest, res) => {
    const userId = req.user!.id;
    const orgId = req.user!.organizationId;

    if (!orgId) {
      res.status(400).json({ error: "Organization required" });
      return;
    }

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();

    // Send a heartbeat immediately so the client knows it connected
    res.write("event: connected\ndata: {}\n\n");

    const unregister = registerSseClient(userId, orgId, res);

    // Keep-alive ping every 25 seconds (prevents proxy timeouts)
    const pingInterval = setInterval(() => {
      try {
        res.write(": ping\n\n");
      } catch {
        logWarn("Non-critical operation failed");
        clearInterval(pingInterval);
      }
    }, 25_000);

    req.on("close", () => {
      clearInterval(pingInterval);
      unregister();
    });
  });

  // ── Helper: load reactions for an array of message IDs ──
  // Returns a map: messageId → { emoji, count, userIds }[]
  async function loadReactions(messageIds: string[]): Promise<Map<string, { emoji: string; count: number; userIds: string[] }[]>> {
    if (messageIds.length === 0) return new Map();
    const rows = await db
      .select({ messageId: messageReactions.messageId, userId: messageReactions.userId, emoji: messageReactions.emoji })
      .from(messageReactions)
      .where(inArray(messageReactions.messageId, messageIds));

    const grouped = new Map<string, Map<string, string[]>>();
    for (const row of rows) {
      if (!grouped.has(row.messageId)) grouped.set(row.messageId, new Map());
      const emojiMap = grouped.get(row.messageId)!;
      if (!emojiMap.has(row.emoji)) emojiMap.set(row.emoji, []);
      emojiMap.get(row.emoji)!.push(row.userId);
    }

    const result = new Map<string, { emoji: string; count: number; userIds: string[] }[]>();
    for (const [msgId, emojiMap] of grouped) {
      const reactions = Array.from(emojiMap.entries()).map(([emoji, userIds]) => ({ emoji, count: userIds.length, userIds }));
      result.set(msgId, reactions);
    }
    return result;
  }

  async function loadEntityLinks(messageIds: string[]): Promise<Map<string, { id: string; entityType: string; entityId: string; label?: string; identifier?: string; projectCode?: string }[]>> {
    if (messageIds.length === 0) return new Map();
    const rows = await db
      .select({
        id: messageEntityLinks.id,
        messageId: messageEntityLinks.messageId,
        entityType: messageEntityLinks.entityType,
        entityId: messageEntityLinks.entityId,
      })
      .from(messageEntityLinks)
      .where(inArray(messageEntityLinks.messageId, messageIds));

    const rfiIds = rows.filter(r => r.entityType === "RFI").map(r => r.entityId);
    const coIds = rows.filter(r => r.entityType === "CHANGE_ORDER").map(r => r.entityId);
    const taskIds = rows.filter(r => r.entityType === "TASK").map(r => r.entityId);

    const entityMeta = new Map<string, { label: string; identifier: string; projectCode?: string }>();

    if (rfiIds.length > 0) {
      const rfiRows = await db.select({ id: rfis.id, rfiNumber: rfis.rfiNumber, subject: rfis.subject, projectId: rfis.projectId }).from(rfis).where(inArray(rfis.id, rfiIds));
      const projectIds = [...new Set(rfiRows.map(r => r.projectId).filter(Boolean))] as string[];
      const projectCodes = new Map<string, string>();
      if (projectIds.length > 0) {
        const projRows = await db.select({ id: projectsTable.id, projectCode: projectsTable.projectCode }).from(projectsTable).where(inArray(projectsTable.id, projectIds));
        for (const p of projRows) if (p.projectCode) projectCodes.set(p.id, p.projectCode);
      }
      for (const r of rfiRows) entityMeta.set(r.id, { label: r.subject, identifier: r.rfiNumber, projectCode: r.projectId ? projectCodes.get(r.projectId) : undefined });
    }
    if (coIds.length > 0) {
      const coRows = await db.select({ id: changeOrders.id, changeOrderNumber: changeOrders.changeOrderNumber, description: changeOrders.description, projectId: changeOrders.projectId }).from(changeOrders).where(inArray(changeOrders.id, coIds));
      const projectIds = [...new Set(coRows.map(r => r.projectId).filter(Boolean))] as string[];
      const projectCodes = new Map<string, string>();
      if (projectIds.length > 0) {
        const projRows = await db.select({ id: projectsTable.id, projectCode: projectsTable.projectCode }).from(projectsTable).where(inArray(projectsTable.id, projectIds));
        for (const p of projRows) if (p.projectCode) projectCodes.set(p.id, p.projectCode);
      }
      for (const r of coRows) entityMeta.set(r.id, { label: r.description || "Change Order", identifier: `CO ${r.changeOrderNumber}`, projectCode: r.projectId ? projectCodes.get(r.projectId) : undefined });
    }
    if (taskIds.length > 0) {
      const taskRows = await db.select({ id: tasks.id, title: tasks.title, projectId: tasks.projectId }).from(tasks).where(inArray(tasks.id, taskIds));
      const projectIds = [...new Set(taskRows.map(r => r.projectId).filter(Boolean))] as string[];
      const projectCodes = new Map<string, string>();
      if (projectIds.length > 0) {
        const projRows = await db.select({ id: projectsTable.id, projectCode: projectsTable.projectCode }).from(projectsTable).where(inArray(projectsTable.id, projectIds));
        for (const p of projRows) if (p.projectCode) projectCodes.set(p.id, p.projectCode);
      }
      for (const r of taskRows) entityMeta.set(r.id, { label: r.title, identifier: "Task", projectCode: r.projectId ? projectCodes.get(r.projectId) : undefined });
    }

    const result = new Map<string, { id: string; entityType: string; entityId: string; label?: string; identifier?: string; projectCode?: string }[]>();
    for (const row of rows) {
      if (!result.has(row.messageId)) result.set(row.messageId, []);
      const meta = entityMeta.get(row.entityId);
      result.get(row.messageId)!.push({
        id: row.id,
        entityType: row.entityType,
        entityId: row.entityId,
        label: meta?.label,
        identifier: meta?.identifier,
        projectCode: meta?.projectCode,
      });
    }
    return result;
  }

  async function validateEntityLinksOrg(links: { entityType: string; entityId: string }[], orgId: string): Promise<{ entityType: string; entityId: string }[]> {
    if (links.length === 0) return [];

    const rfiIds = links.filter(l => l.entityType === "RFI").map(l => l.entityId);
    const coIds = links.filter(l => l.entityType === "CHANGE_ORDER").map(l => l.entityId);
    const taskIds = links.filter(l => l.entityType === "TASK").map(l => l.entityId);

    const validEntityIds = new Set<string>();

    if (rfiIds.length > 0) {
      const rows = await db.select({ id: rfis.id }).from(rfis).where(and(inArray(rfis.id, rfiIds), eq(rfis.organizationId, orgId)));
      for (const r of rows) validEntityIds.add(r.id);
    }
    if (coIds.length > 0) {
      const rows = await db.select({ id: changeOrders.id }).from(changeOrders)
        .innerJoin(projectsTable, eq(changeOrders.projectId, projectsTable.id))
        .where(and(inArray(changeOrders.id, coIds), eq(projectsTable.gcOrganizationId, orgId)));
      for (const r of rows) validEntityIds.add(r.id);
    }
    if (taskIds.length > 0) {
      const rows = await db.select({ id: tasks.id }).from(tasks).where(and(inArray(tasks.id, taskIds), eq(tasks.organizationId, orgId)));
      for (const r of rows) validEntityIds.add(r.id);
    }

    return links.filter(l => validEntityIds.has(l.entityId));
  }

  async function fetchParticipantIds(conversationId: string): Promise<Set<string>> {
    const rows = await db
      .select({ userId: conversationParticipants.userId })
      .from(conversationParticipants)
      .where(eq(conversationParticipants.conversationId, conversationId));
    return new Set(rows.map(r => r.userId));
  }

  // ── EDIT MESSAGE — sender or channel admin only ──
  const editMessageSchema = z.object({
    content: z.string().min(1).max(10000),
  });

  router.patch("/api/messages/:msgId", requireAuth, async (req: AuthRequest, res, next) => {
    try {
      const userId = req.user!.id;
      const orgId = req.user!.organizationId;
      const { msgId } = req.params;
      const validation = editMessageSchema.safeParse(req.body);
      if (!validation.success) return res.status(400).json({ error: "Content cannot be empty" });
      const { content } = validation.data;

      if (!content?.trim()) return res.status(400).json({ error: "Content cannot be empty" });

      const [msg] = await db.select().from(messages).where(eq(messages.id, msgId)).limit(1);
      if (!msg) return res.status(404).json({ error: "Message not found" });
      if (msg.isDeleted) return res.status(400).json({ error: "Cannot edit a deleted message" });
      if (msg.voiceUrl) return res.status(400).json({ error: "Voice messages cannot be edited" });
      if (msg.isFieldNote) return res.status(400).json({ error: "Field note messages cannot be edited" });

      // Verify caller is a participant of this conversation (always required)
      const isMember = await ensureParticipant(msg.conversationId, userId);
      if (!isMember) return res.status(403).json({ error: "Not a participant of this conversation" });

      // Only sender (or channel admin) may edit
      if (msg.senderId !== userId) {
        const [admin] = await db
          .select()
          .from(conversationParticipants)
          .where(and(eq(conversationParticipants.conversationId, msg.conversationId), eq(conversationParticipants.userId, userId), eq(conversationParticipants.isAdmin, true)))
          .limit(1);
        if (!admin) return res.status(403).json({ error: "Only the sender or a channel admin can edit messages" });
      }

      const [updated] = await db
        .update(messages)
        .set({ content: sanitizeText(content), isEdited: true, editedAt: new Date() })
        .where(eq(messages.id, msgId))
        .returning();

      const [sender] = await db
        .select({ id: users.id, firstName: users.firstName, lastName: users.lastName, role: users.role })
        .from(users).where(eq(users.id, updated.senderId)).limit(1);

      const reactionMap = await loadReactions([msgId]);
      const reactions = reactionMap.get(msgId) ?? [];

      const entityLinkMap = await loadEntityLinks([msgId]);
      const entityLinks = entityLinkMap.get(msgId) ?? [];

      const updatedMsg = { ...updated, sender, reactions, entityLinks };

      if (orgId) {
        const participantUserIds = await fetchParticipantIds(msg.conversationId);
        emitMessageEdited(orgId, msg.conversationId, participantUserIds, updatedMsg);
      }

      res.json(updatedMsg);
    } catch (error) {
      next(error);
    }
  });

  // ── DELETE MESSAGE (soft delete) — sender or channel admin only ──
  router.delete("/api/messages/:msgId", requireAuth, async (req: AuthRequest, res, next) => {
    try {
      const userId = req.user!.id;
      const orgId = req.user!.organizationId;
      const { msgId } = req.params;

      const [msg] = await db.select().from(messages).where(eq(messages.id, msgId)).limit(1);
      if (!msg) return res.status(404).json({ error: "Message not found" });
      if (msg.isDeleted) return res.status(400).json({ error: "Message already deleted" });
      if (msg.isFieldNote) return res.status(400).json({ error: "Field note messages cannot be deleted" });

      // Verify caller is a participant of this conversation (always required)
      const isMember = await ensureParticipant(msg.conversationId, userId);
      if (!isMember) return res.status(403).json({ error: "Not a participant of this conversation" });

      // Only sender (or channel admin) may delete
      if (msg.senderId !== userId) {
        const [admin] = await db
          .select()
          .from(conversationParticipants)
          .where(and(eq(conversationParticipants.conversationId, msg.conversationId), eq(conversationParticipants.userId, userId), eq(conversationParticipants.isAdmin, true)))
          .limit(1);
        if (!admin) return res.status(403).json({ error: "Only the sender or a channel admin can delete messages" });
      }

      const [deleted] = await db
        .update(messages)
        .set({ isDeleted: true, content: "" })
        .where(eq(messages.id, msgId))
        .returning();

      const [sender] = await db
        .select({ id: users.id, firstName: users.firstName, lastName: users.lastName, role: users.role })
        .from(users).where(eq(users.id, deleted.senderId)).limit(1);

      const deletedMsg = { ...deleted, sender, reactions: [] };

      if (orgId) {
        const participantUserIds = await fetchParticipantIds(msg.conversationId);
        emitMessageDeleted(orgId, msg.conversationId, participantUserIds, msgId);
      }

      res.json(deletedMsg);
    } catch (error) {
      next(error);
    }
  });

  // ── TOGGLE REACTION — POST /api/messages/:msgId/reactions { emoji } ──
  // Adds the reaction if absent, removes it if already present (toggle).
  // Returns updated reaction counts for the message.
  const ALLOWED_EMOJIS = ["👍", "❤️", "😂", "😮", "🎉", "✅"] as const;
  const reactionSchema = z.object({
    emoji: z.enum(ALLOWED_EMOJIS),
  });

  router.post("/api/messages/:msgId/reactions", requireAuth, async (req: AuthRequest, res, next) => {
    try {
      const userId = req.user!.id;
      const orgId = req.user!.organizationId;
      const { msgId } = req.params;
      const reactionValidation = reactionSchema.safeParse(req.body);
      if (!reactionValidation.success) {
        return res.status(400).json({ error: "Invalid emoji. Allowed: " + ALLOWED_EMOJIS.join(" ") });
      }
      const { emoji } = reactionValidation.data;

      if (!emoji || !ALLOWED_EMOJIS.includes(emoji)) {
        return res.status(400).json({ error: "Invalid emoji. Allowed: " + ALLOWED_EMOJIS.join(" ") });
      }

      const [msg] = await db.select({ id: messages.id, conversationId: messages.conversationId, isDeleted: messages.isDeleted })
        .from(messages).where(eq(messages.id, msgId)).limit(1);
      if (!msg) return res.status(404).json({ error: "Message not found" });
      if (msg.isDeleted) return res.status(400).json({ error: "Cannot react to a deleted message" });

      // Verify caller is a participant
      const isParticipant = await ensureParticipant(msg.conversationId, userId);
      if (!isParticipant) return res.status(403).json({ error: "Not a participant of this conversation" });

      // Toggle: check if reaction exists
      const [existing] = await db
        .select()
        .from(messageReactions)
        .where(and(eq(messageReactions.messageId, msgId), eq(messageReactions.userId, userId), eq(messageReactions.emoji, emoji)))
        .limit(1);

      if (existing) {
        await db.delete(messageReactions).where(and(eq(messageReactions.messageId, msgId), eq(messageReactions.userId, userId), eq(messageReactions.emoji, emoji)));
      } else {
        await db.insert(messageReactions).values({ messageId: msgId, userId, emoji }).onConflictDoNothing();
      }

      const reactionMap = await loadReactions([msgId]);
      const reactions = reactionMap.get(msgId) ?? [];

      if (orgId) {
        const participantUserIds = await fetchParticipantIds(msg.conversationId);
        emitMessageReaction(orgId, msg.conversationId, participantUserIds, msgId, reactions);
      }

      res.json({ reactions });
    } catch (error) {
      next(error);
    }
  });

  // ── REMOVE REACTION (explicit DELETE) — DELETE /api/messages/:msgId/reactions/:emoji ──
  // Removes the caller's specific emoji reaction. Returns updated reaction counts.
  router.delete("/api/messages/:msgId/reactions/:emoji", requireAuth, async (req: AuthRequest, res, next) => {
    try {
      const userId = req.user!.id;
      const orgId = req.user!.organizationId;
      const { msgId, emoji } = req.params;

      const ALLOWED_EMOJIS = ["👍", "❤️", "😂", "😮", "🎉", "✅"];
      if (!ALLOWED_EMOJIS.includes(emoji)) {
        return res.status(400).json({ error: "Invalid emoji" });
      }

      const [msg] = await db
        .select({ id: messages.id, conversationId: messages.conversationId, isDeleted: messages.isDeleted })
        .from(messages).where(eq(messages.id, msgId)).limit(1);
      if (!msg) return res.status(404).json({ error: "Message not found" });
      if (msg.isDeleted) return res.status(400).json({ error: "Cannot remove reaction from a deleted message" });

      // Verify caller is a participant
      const isMember = await ensureParticipant(msg.conversationId, userId);
      if (!isMember) return res.status(403).json({ error: "Not a participant of this conversation" });

      await db.delete(messageReactions).where(
        and(eq(messageReactions.messageId, msgId), eq(messageReactions.userId, userId), eq(messageReactions.emoji, emoji))
      );

      const reactionMap = await loadReactions([msgId]);
      const reactions = reactionMap.get(msgId) ?? [];

      if (orgId) {
        const participantUserIds = await fetchParticipantIds(msg.conversationId);
        emitMessageReaction(orgId, msg.conversationId, participantUserIds, msgId, reactions);
      }

      res.json({ reactions });
    } catch (error) {
      next(error);
    }
  });

  // ── TYPING INDICATOR — clients POST here when the user is typing ──
  // Rate-limited server-side: ignores requests fired within 2 s of the last one per user+conversation.
  const typingLastSent = new Map<string, number>();

  router.post("/api/conversations/:id/typing", requireAuth, async (req: AuthRequest, res, next) => {
    const userId = req.user!.id;
    const orgId = req.user!.organizationId;
    const conversationId = req.params.id;

    if (!orgId) {
      res.status(400).json({ error: "Organization required" });
      return;
    }

    const key = `${userId}:${conversationId}`;
    const now = Date.now();
    const last = typingLastSent.get(key) ?? 0;

    if (now - last < 2_000) {
      res.status(204).end();
      return;
    }

    // Verify the caller is a participant of this conversation before broadcasting
    const isParticipant = await ensureParticipant(conversationId, userId);
    if (!isParticipant) {
      res.status(403).json({ error: "Not a participant of this conversation" });
      return;
    }

    typingLastSent.set(key, now);

    const firstName = req.user!.firstName ?? "";
    const lastName = req.user!.lastName ?? "";

    // Fetch participant IDs to scope the typing event to conversation members only
    const participants = await db
      .select({ userId: conversationParticipants.userId })
      .from(conversationParticipants)
      .where(eq(conversationParticipants.conversationId, conversationId));
    const participantUserIds = new Set(participants.map(p => p.userId));

    emitTyping(orgId, conversationId, participantUserIds, userId, firstName, lastName);
    res.status(204).end();
  });

  // ── ENTITY SEARCH — search RFIs, Change Orders, and Tasks for the entity link picker ──
  router.get("/api/entity-project/:entityType/:entityId", requireAuth, async (req: AuthRequest, res, next) => {
    try {
      const orgId = req.user!.organizationId;
      if (!orgId) return res.status(400).json({ error: "Organization required" });
      const { entityType, entityId } = req.params;

      let projectCode: string | null = null;
      if (entityType === "RFI") {
        const [rfi] = await db.select({ projectId: rfis.projectId }).from(rfis)
          .where(and(eq(rfis.id, entityId), eq(rfis.organizationId, orgId))).limit(1);
        if (rfi?.projectId) {
          const [proj] = await db.select({ projectCode: projectsTable.projectCode }).from(projectsTable)
            .where(eq(projectsTable.id, rfi.projectId)).limit(1);
          projectCode = proj?.projectCode || null;
        }
      } else if (entityType === "CHANGE_ORDER") {
        const [co] = await db.select({ projectId: changeOrders.projectId }).from(changeOrders)
          .innerJoin(projectsTable, eq(changeOrders.projectId, projectsTable.id))
          .where(and(eq(changeOrders.id, entityId), eq(projectsTable.gcOrganizationId, orgId))).limit(1);
        if (co?.projectId) {
          const [proj] = await db.select({ projectCode: projectsTable.projectCode }).from(projectsTable)
            .where(eq(projectsTable.id, co.projectId)).limit(1);
          projectCode = proj?.projectCode || null;
        }
      } else if (entityType === "TASK") {
        const [task] = await db.select({ projectId: tasks.projectId }).from(tasks)
          .where(and(eq(tasks.id, entityId), eq(tasks.organizationId, orgId))).limit(1);
        if (task?.projectId) {
          const [proj] = await db.select({ projectCode: projectsTable.projectCode }).from(projectsTable)
            .where(eq(projectsTable.id, task.projectId)).limit(1);
          projectCode = proj?.projectCode || null;
        }
      }

      res.json({ projectCode });
    } catch (error) {
      next(error);
    }
  });

  router.get("/api/entity-search", requireAuth, async (req: AuthRequest, res, next) => {
    try {
      const orgId = req.user!.organizationId;
      if (!orgId) return res.status(400).json({ error: "Organization required" });

      const q = ((req.query.q as string) || "").trim();
      const entityType = req.query.type as string | undefined;
      const results: { entityType: string; entityId: string; label: string; identifier: string }[] = [];

      if (!entityType || entityType === "RFI") {
        const rfiConditions: SQL<unknown>[] = [eq(rfis.organizationId, orgId)];
        if (q) rfiConditions.push(or(ilike(rfis.subject, `%${q}%`), ilike(rfis.rfiNumber, `%${q}%`)) as SQL<unknown>);
        const rfiResults = await db
          .select({ id: rfis.id, rfiNumber: rfis.rfiNumber, subject: rfis.subject })
          .from(rfis)
          .where(and(...rfiConditions))
          .limit(5);
        for (const r of rfiResults) {
          results.push({ entityType: "RFI", entityId: r.id, label: r.subject, identifier: r.rfiNumber });
        }
      }

      if (!entityType || entityType === "CHANGE_ORDER") {
        const coConditions: SQL<unknown>[] = [eq(projectsTable.gcOrganizationId, orgId)];
        if (q) coConditions.push(or(ilike(changeOrders.description, `%${q}%`), ilike(changeOrders.changeOrderNumber, `%${q}%`)) as SQL<unknown>);
        const coResults = await db
          .select({ id: changeOrders.id, changeOrderNumber: changeOrders.changeOrderNumber, description: changeOrders.description })
          .from(changeOrders)
          .innerJoin(projectsTable, eq(changeOrders.projectId, projectsTable.id))
          .where(and(...coConditions))
          .limit(5);
        for (const r of coResults) {
          results.push({ entityType: "CHANGE_ORDER", entityId: r.id, label: r.description || "Change Order", identifier: r.changeOrderNumber });
        }
      }

      if (!entityType || entityType === "TASK") {
        const taskConditions: SQL<unknown>[] = [eq(tasks.organizationId, orgId)];
        if (q) taskConditions.push(ilike(tasks.title, `%${q}%`));
        const taskResults = await db
          .select({ id: tasks.id, title: tasks.title })
          .from(tasks)
          .where(and(...taskConditions))
          .limit(5);
        for (const r of taskResults) {
          results.push({ entityType: "TASK", entityId: r.id, label: r.title, identifier: `Task` });
        }
      }

      res.json(results);
    } catch (error) {
      next(error);
    }
  });

  // ── ADD ENTITY LINKS to a message ──
  const entityLinkSchema = z.object({
    links: z.array(z.object({
      entityType: z.enum(["RFI", "CHANGE_ORDER", "TASK"]),
      entityId: z.string().min(1),
    })).min(1),
  });

  router.post("/api/messages/:msgId/entity-links", requireAuth, async (req: AuthRequest, res, next) => {
    try {
      const userId = req.user!.id;
      const { msgId } = req.params;
      const linkValidation = entityLinkSchema.safeParse(req.body);
      if (!linkValidation.success) {
        return res.status(400).json({ error: "links array is required" });
      }
      const { links } = linkValidation.data;

      const [msg] = await db.select().from(messages).where(eq(messages.id, msgId)).limit(1);
      if (!msg) return res.status(404).json({ error: "Message not found" });

      const isMember = await ensureParticipant(msg.conversationId, userId);
      if (!isMember) return res.status(403).json({ error: "Not a participant of this conversation" });

      const orgId = req.user!.organizationId;
      if (!orgId) return res.status(403).json({ error: "No organization" });

      const validTypes: readonly string[] = ["RFI", "CHANGE_ORDER", "TASK"];
      type ValidEntityType = "RFI" | "CHANGE_ORDER" | "TASK";
      const candidateLinks = links
        .filter((l: { entityType: string; entityId: string }) => validTypes.includes(l.entityType) && l.entityId);

      const validatedLinks = await validateEntityLinksOrg(candidateLinks, orgId);
      if (validatedLinks.length === 0) return res.status(400).json({ error: "No valid links provided" });

      const values = validatedLinks.map((l) => ({
        messageId: msgId,
        entityType: l.entityType as ValidEntityType,
        entityId: l.entityId,
      }));

      const inserted = await db.insert(messageEntityLinks).values(values).onConflictDoNothing().returning();
      res.status(201).json(inserted);
    } catch (error) {
      next(error);
    }
  });

  // ── REMOVE an entity link from a message ──
  router.delete("/api/messages/:msgId/entity-links/:linkId", requireAuth, async (req: AuthRequest, res, next) => {
    try {
      const userId = req.user!.id;
      const { msgId, linkId } = req.params;

      const [msg] = await db.select().from(messages).where(eq(messages.id, msgId)).limit(1);
      if (!msg) return res.status(404).json({ error: "Message not found" });

      const isMember = await ensureParticipant(msg.conversationId, userId);
      if (!isMember) return res.status(403).json({ error: "Not a participant of this conversation" });

      await db.delete(messageEntityLinks).where(and(eq(messageEntityLinks.id, linkId), eq(messageEntityLinks.messageId, msgId)));
      res.json({ success: true });
    } catch (error) {
      next(error);
    }
  });

  router.get("/api/messages/:msgId/entity-links", requireAuth, async (req: AuthRequest, res, next) => {
    try {
      const userId = req.user!.id;
      const { msgId } = req.params;

      const [msg] = await db.select().from(messages).where(eq(messages.id, msgId)).limit(1);
      if (!msg) return res.status(404).json({ error: "Message not found" });

      const isMember = await ensureParticipant(msg.conversationId, userId);
      if (!isMember) return res.status(403).json({ error: "Not a participant of this conversation" });

      const links = await db.select().from(messageEntityLinks).where(eq(messageEntityLinks.messageId, msgId));
      res.json(links);
    } catch (error) {
      next(error);
    }
  });

  router.get("/api/entity-messages/:entityType/:entityId", requireAuth, async (req: AuthRequest, res, next) => {
    try {
      const userId = req.user!.id;
      const orgId = req.user!.organizationId;
      if (!orgId) return res.status(400).json({ error: "Organization required" });

      const { entityType, entityId } = req.params;
      const validTypes = ["RFI", "CHANGE_ORDER", "TASK"];
      if (!validTypes.includes(entityType)) return res.status(400).json({ error: "Invalid entity type" });

      const userConversations = await db
        .select({ conversationId: conversationParticipants.conversationId })
        .from(conversationParticipants)
        .where(eq(conversationParticipants.userId, userId));
      const userConvIds = userConversations.map(c => c.conversationId);

      if (userConvIds.length === 0) return res.json([]);

      const linkedMessages = await db
        .select({
          message: messages,
          sender: {
            id: users.id,
            firstName: users.firstName,
            lastName: users.lastName,
            role: users.role,
          },
          link: messageEntityLinks,
          conversationName: conversations.name,
          conversationId: conversations.id,
        })
        .from(messageEntityLinks)
        .innerJoin(messages, eq(messageEntityLinks.messageId, messages.id))
        .innerJoin(users, eq(messages.senderId, users.id))
        .innerJoin(conversations, eq(messages.conversationId, conversations.id))
        .where(and(
          eq(messageEntityLinks.entityType, entityType as "RFI" | "CHANGE_ORDER" | "TASK"),
          eq(messageEntityLinks.entityId, entityId),
          eq(conversations.organizationId, orgId),
          inArray(messages.conversationId, userConvIds)
        ))
        .orderBy(desc(messages.createdAt))
        .limit(50);

      const result = linkedMessages.map(m => ({
        ...m.message,
        sender: m.sender,
        reactions: [],
        entityLinks: [m.link],
        conversationName: m.conversationName,
        conversationId: m.conversationId,
      }));

      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  // ── GET or CREATE entity-scoped conversation thread ──
  router.get("/api/entity-conversation/:entityType/:entityId", requireAuth, async (req: AuthRequest, res, next) => {
    try {
      const userId = req.user!.id;
      const orgId = req.user!.organizationId;
      if (!orgId) return res.status(400).json({ error: "Organization required" });
      const { entityType, entityId } = req.params;
      const validTypes = ["RFI", "CHANGE_ORDER", "TASK"];
      if (!validTypes.includes(entityType) || !entityId) {
        return res.status(400).json({ error: "entityType and entityId are required" });
      }
      const entityFieldCondition =
        entityType === "RFI" ? eq(conversations.rfiId, entityId) :
        entityType === "CHANGE_ORDER" ? eq(conversations.changeOrderId, entityId) :
        eq(conversations.taskId, entityId);
      const [existing] = await db.select({ id: conversations.id }).from(conversations)
        .where(and(eq(conversations.organizationId, orgId), entityFieldCondition)).limit(1);
      if (existing) {
        await db.insert(conversationParticipants)
          .values({ conversationId: existing.id, userId, isAdmin: false })
          .onConflictDoNothing();
      }
      res.json(existing || null);
    } catch (error) {
      next(error);
    }
  });

  const entityConversationSchema = z.object({
    entityType: z.enum(["RFI", "CHANGE_ORDER", "TASK"]),
    entityId: z.string().uuid(),
  });

  router.post("/api/entity-conversation", requireAuth, async (req: AuthRequest, res, next) => {
    try {
      const userId = req.user!.id;
      const orgId = req.user!.organizationId;
      if (!orgId) return res.status(400).json({ error: "Organization required" });

      const validation = entityConversationSchema.safeParse(req.body);
      if (!validation.success) {
        return res.status(400).json({ error: "entityType and entityId are required" });
      }
      const { entityType, entityId } = validation.data;

      const entityFieldCondition =
        entityType === "RFI" ? eq(conversations.rfiId, entityId) :
        entityType === "CHANGE_ORDER" ? eq(conversations.changeOrderId, entityId) :
        eq(conversations.taskId, entityId);

      const [existing] = await db
        .select()
        .from(conversations)
        .where(and(eq(conversations.organizationId, orgId), entityFieldCondition))
        .limit(1);

      if (existing) {
        await db.insert(conversationParticipants)
          .values({ conversationId: existing.id, userId, isAdmin: false })
          .onConflictDoNothing();
        return res.json(existing);
      }

      let entityName = "Discussion";
      let entityVerified = false;
      if (entityType === "RFI") {
        const [rfi] = await db.select({ rfiNumber: rfis.rfiNumber, subject: rfis.subject, organizationId: rfis.organizationId }).from(rfis).where(eq(rfis.id, entityId)).limit(1);
        if (rfi && rfi.organizationId === orgId) {
          entityName = `${rfi.rfiNumber}: ${rfi.subject}`;
          entityVerified = true;
        }
      } else if (entityType === "CHANGE_ORDER") {
        const [co] = await db
          .select({ changeOrderNumber: changeOrders.changeOrderNumber, description: changeOrders.description, orgId: projectsTable.gcOrganizationId })
          .from(changeOrders)
          .innerJoin(projectsTable, eq(changeOrders.projectId, projectsTable.id))
          .where(eq(changeOrders.id, entityId)).limit(1);
        if (co && co.orgId === orgId) {
          entityName = `CO ${co.changeOrderNumber}: ${co.description || "Change Order"}`;
          entityVerified = true;
        }
      } else if (entityType === "TASK") {
        const [task] = await db.select({ title: tasks.title, organizationId: tasks.organizationId }).from(tasks).where(eq(tasks.id, entityId)).limit(1);
        if (task && task.organizationId === orgId) {
          entityName = `Task: ${task.title}`;
          entityVerified = true;
        }
      }

      if (!entityVerified) {
        return res.status(404).json({ error: "Entity not found or does not belong to your organization" });
      }

      const baseValues = {
        type: "GROUP" as const,
        name: entityName,
        organizationId: orgId,
        createdById: userId,
        isCompanyChannel: false,
        rfiId: entityType === "RFI" ? entityId : null,
        changeOrderId: entityType === "CHANGE_ORDER" ? entityId : null,
        taskId: entityType === "TASK" ? entityId : null,
      };

      const [raceCheck] = await db
        .select()
        .from(conversations)
        .where(and(eq(conversations.organizationId, orgId), entityFieldCondition))
        .limit(1);

      if (raceCheck) {
        await db.insert(conversationParticipants)
          .values({ conversationId: raceCheck.id, userId, isAdmin: false })
          .onConflictDoNothing();
        return res.json(raceCheck);
      }

      const [newConversation] = await db
        .insert(conversations)
        .values(baseValues)
        .returning();

      await db.insert(conversationParticipants).values({
        conversationId: newConversation.id,
        userId,
        isAdmin: true,
      });

      res.status(201).json(newConversation);
    } catch (error) {
      next(error);
    }
  });

  // ── VIDEO CALLS ──

  async function getConversationParticipantIds(conversationId: string): Promise<Set<string>> {
    const parts = await db
      .select({ userId: conversationParticipants.userId })
      .from(conversationParticipants)
      .where(eq(conversationParticipants.conversationId, conversationId));
    return new Set(parts.map(p => p.userId));
  }

  async function getConversationOrgId(conversationId: string): Promise<string | null> {
    const [conv] = await db
      .select({ organizationId: conversations.organizationId })
      .from(conversations)
      .where(eq(conversations.id, conversationId))
      .limit(1);
    return conv?.organizationId ?? null;
  }

  router.post("/api/conversations/:id/calls", requireAuth, async (req: AuthRequest, res, next) => {
    try {
      const userId = req.user!.id;
      const conversationId = req.params.id;

      if (!process.env.LIVEKIT_API_KEY || !process.env.LIVEKIT_API_SECRET || !process.env.LIVEKIT_URL) {
        return res.status(503).json({ error: "Video calls are not available. LiveKit is not configured.", code: "LIVEKIT_NOT_CONFIGURED" });
      }

      const userOrg = req.user!.organizationId;
      if (userOrg) {
        const videoCallsEnabled = await isFeatureEnabled(userOrg, "VIDEO_CALLS");
        if (!videoCallsEnabled) {
          return res.status(403).json({ error: "Video calls are not enabled for your organization.", code: "VIDEO_CALLS_DISABLED" });
        }
      }

      const isParticipant = await ensureParticipant(conversationId, userId);
      if (!isParticipant) return res.status(403).json({ error: "Not a participant" });

      const existingActive = await db
        .select()
        .from(videoCalls)
        .where(and(
          eq(videoCalls.conversationId, conversationId),
          sql`${videoCalls.status} IN ('RINGING', 'ACTIVE')`
        ))
        .limit(1);

      if (existingActive.length > 0) {
        return res.status(409).json({ error: "A call is already active in this conversation", call: existingActive[0] });
      }

      let call;
      try {
        [call] = await db
          .insert(videoCalls)
          .values({ conversationId, initiatorId: userId, status: "RINGING" })
          .returning();
      } catch (insertError: unknown) {
        const pgErr = insertError as { code?: string; constraint?: string };
        if (pgErr?.code === "23505" && pgErr?.constraint?.includes("video_calls_unique_active")) {
          const [existingCall] = await db
            .select()
            .from(videoCalls)
            .where(and(
              eq(videoCalls.conversationId, conversationId),
              sql`${videoCalls.status} IN ('RINGING', 'ACTIVE')`
            ))
            .limit(1);
          if (existingCall) {
            const participants = await db
              .select()
              .from(videoCallParticipants)
              .where(eq(videoCallParticipants.callId, existingCall.id));
            const participantUsers = await Promise.all(
              participants.map(async (p) => {
                const [u] = await db.select({ id: users.id, firstName: users.firstName, lastName: users.lastName, role: users.role })
                  .from(users).where(eq(users.id, p.userId)).limit(1);
                return { ...p, user: u };
              })
            );
            const [initiator] = await db.select({ id: users.id, firstName: users.firstName, lastName: users.lastName, role: users.role })
              .from(users).where(eq(users.id, existingCall.initiatorId)).limit(1);
            return res.status(200).json({ ...existingCall, initiator, participants: participantUsers });
          }
          return res.status(409).json({ error: "A call is already active in this conversation" });
        }
        throw insertError;
      }

      const [participant] = await db.insert(videoCallParticipants).values({
        callId: call.id,
        userId,
      }).returning();

      const initiatorInfo = await db.select({
        id: users.id,
        firstName: users.firstName,
        lastName: users.lastName,
        role: users.role,
      }).from(users).where(eq(users.id, userId)).limit(1);

      const callWithInitiator = {
        ...call,
        initiator: initiatorInfo[0],
        participants: [{ id: participant.id, callId: call.id, userId, user: initiatorInfo[0], joinedAt: participant.joinedAt?.toISOString() ?? new Date().toISOString(), leftAt: null }],
      };

      const participantIds = await getConversationParticipantIds(conversationId);
      const orgId = await getConversationOrgId(conversationId);
      if (orgId) {
        emitCallStarted(orgId, conversationId, participantIds, callWithInitiator);
      }

      res.status(201).json(callWithInitiator);
    } catch (error) {
      next(error);
    }
  });

  router.post("/api/calls/:callId/join", requireAuth, async (req: AuthRequest, res, next) => {
    try {
      const userId = req.user!.id;
      const callId = req.params.callId;

      const [call] = await db.select().from(videoCalls).where(eq(videoCalls.id, callId)).limit(1);
      if (!call) return res.status(404).json({ error: "Call not found" });
      if (call.status === "ENDED") return res.status(400).json({ error: "Call has ended" });

      const isParticipant = await ensureParticipant(call.conversationId, userId);
      if (!isParticipant) return res.status(403).json({ error: "Not a participant of this conversation" });

      const existingParticipant = await db.select().from(videoCallParticipants)
        .where(and(eq(videoCallParticipants.callId, callId), eq(videoCallParticipants.userId, userId)))
        .limit(1);

      if (existingParticipant.length === 0) {
        await db.insert(videoCallParticipants).values({ callId, userId });
      } else if (existingParticipant[0].leftAt) {
        await db.update(videoCallParticipants)
          .set({ leftAt: null, joinedAt: new Date() })
          .where(eq(videoCallParticipants.id, existingParticipant[0].id));
      }

      if (call.status === "RINGING") {
        await db.update(videoCalls).set({ status: "ACTIVE" }).where(eq(videoCalls.id, callId));
      }

      const userInfo = await db.select({
        id: users.id, firstName: users.firstName, lastName: users.lastName, role: users.role,
      }).from(users).where(eq(users.id, userId)).limit(1);

      const participantIds = await getConversationParticipantIds(call.conversationId);
      const orgId = await getConversationOrgId(call.conversationId);
      if (orgId) {
        emitCallJoined(orgId, call.conversationId, participantIds, callId, userId, `${userInfo[0].firstName} ${userInfo[0].lastName}`);
      }

      const updatedCall = await db.select().from(videoCalls).where(eq(videoCalls.id, callId)).limit(1);
      const allParticipants = await db
        .select({
          participant: videoCallParticipants,
          user: { id: users.id, firstName: users.firstName, lastName: users.lastName, role: users.role },
        })
        .from(videoCallParticipants)
        .innerJoin(users, eq(videoCallParticipants.userId, users.id))
        .where(and(eq(videoCallParticipants.callId, callId), sql`${videoCallParticipants.leftAt} IS NULL`));

      const initiatorData = await db.select({
        id: users.id, firstName: users.firstName, lastName: users.lastName, role: users.role,
      }).from(users).where(eq(users.id, call.initiatorId)).limit(1);

      res.json({
        ...updatedCall[0],
        initiator: initiatorData[0],
        participants: allParticipants.map(p => ({ ...p.participant, user: p.user })),
      });
    } catch (error) {
      next(error);
    }
  });

  router.post("/api/calls/:callId/leave", requireAuth, async (req: AuthRequest, res, next) => {
    try {
      const userId = req.user!.id;
      const callId = req.params.callId;

      const [call] = await db.select().from(videoCalls).where(eq(videoCalls.id, callId)).limit(1);
      if (!call) return res.status(404).json({ error: "Call not found" });

      const isConvParticipant = await ensureParticipant(call.conversationId, userId);
      if (!isConvParticipant) return res.status(403).json({ error: "Not a participant" });

      await db.update(videoCallParticipants)
        .set({ leftAt: new Date() })
        .where(and(eq(videoCallParticipants.callId, callId), eq(videoCallParticipants.userId, userId)));

      const remainingActive = await db.select().from(videoCallParticipants)
        .where(and(eq(videoCallParticipants.callId, callId), sql`${videoCallParticipants.leftAt} IS NULL`));

      const participantIds = await getConversationParticipantIds(call.conversationId);
      const orgId = await getConversationOrgId(call.conversationId);

      if (remainingActive.length <= 1) {
        if (remainingActive.length === 1) {
          await db.update(videoCallParticipants)
            .set({ leftAt: new Date() })
            .where(and(eq(videoCallParticipants.callId, callId), sql`${videoCallParticipants.leftAt} IS NULL`));
        }

        await db.update(videoCalls).set({ status: "ENDED", endedAt: new Date() }).where(eq(videoCalls.id, callId));

        const callParticipants = await db
          .select({ userId: videoCallParticipants.userId, firstName: users.firstName, lastName: users.lastName })
          .from(videoCallParticipants)
          .innerJoin(users, eq(videoCallParticipants.userId, users.id))
          .where(eq(videoCallParticipants.callId, callId));

        const duration = Math.round((Date.now() - new Date(call.startedAt).getTime()) / 1000);
        const participantNames = callParticipants.map(p => `${p.firstName} ${p.lastName}`).join(", ");
        const durationFormatted = duration >= 60 ? `${Math.floor(duration / 60)}m ${duration % 60}s` : `${duration}s`;

        await db.insert(messages).values({
          conversationId: call.conversationId,
          senderId: call.initiatorId,
          content: `📹 Video call ended • ${durationFormatted} • ${participantNames}`,
        });

        if (orgId) {
          emitCallEnded(orgId, call.conversationId, participantIds, callId);
          const [systemMsg] = await db.select().from(messages)
            .where(eq(messages.conversationId, call.conversationId))
            .orderBy(desc(messages.createdAt)).limit(1);
          if (systemMsg) {
            const senderInfo = await db.select({ id: users.id, firstName: users.firstName, lastName: users.lastName, role: users.role })
              .from(users).where(eq(users.id, call.initiatorId)).limit(1);
            emitMessageNew(orgId, call.conversationId, participantIds, { ...systemMsg, reactions: [], entityLinks: [], sender: senderInfo[0] });
          }
        }

        const leaveCallNotes = await db
          .select({ content: videoCallNotes.content, firstName: users.firstName, lastName: users.lastName })
          .from(videoCallNotes)
          .innerJoin(users, eq(videoCallNotes.authorId, users.id))
          .where(eq(videoCallNotes.callId, callId));

        if (leaveCallNotes.length > 0) {
          const notesContent = leaveCallNotes
            .filter(n => n.content && n.content.trim())
            .map(n => `**${n.firstName} ${n.lastName}:** ${n.content}`)
            .join("\n\n");

          if (notesContent) {
            const [notesMsg] = await db.insert(messages).values({
              conversationId: call.conversationId,
              senderId: call.initiatorId,
              content: `📝 **Call Notes**\n\n${notesContent}`,
            }).returning();

            if (orgId && notesMsg) {
              const senderInfo = await db.select({ id: users.id, firstName: users.firstName, lastName: users.lastName, role: users.role })
                .from(users).where(eq(users.id, call.initiatorId)).limit(1);
              emitMessageNew(orgId, call.conversationId, participantIds, { ...notesMsg, reactions: [], entityLinks: [], sender: senderInfo[0] });
            }
          }
        }
      } else if (orgId) {
        emitCallLeft(orgId, call.conversationId, participantIds, callId, userId);
      }

      res.json({ success: true });
    } catch (error) {
      next(error);
    }
  });

  router.post("/api/calls/:callId/end", requireAuth, async (req: AuthRequest, res, next) => {
    try {
      const userId = req.user!.id;
      const callId = req.params.callId;

      const [call] = await db.select().from(videoCalls).where(eq(videoCalls.id, callId)).limit(1);
      if (!call) return res.status(404).json({ error: "Call not found" });
      if (call.status === "ENDED") return res.json({ success: true });

      const isConvParticipant = await ensureParticipant(call.conversationId, userId);
      if (!isConvParticipant) return res.status(403).json({ error: "Not a participant" });

      await db.update(videoCallParticipants)
        .set({ leftAt: new Date() })
        .where(and(eq(videoCallParticipants.callId, callId), sql`${videoCallParticipants.leftAt} IS NULL`));

      await db.update(videoCalls).set({ status: "ENDED", endedAt: new Date() }).where(eq(videoCalls.id, callId));

      const callParticipants = await db
        .select({ userId: videoCallParticipants.userId, firstName: users.firstName, lastName: users.lastName })
        .from(videoCallParticipants)
        .innerJoin(users, eq(videoCallParticipants.userId, users.id))
        .where(eq(videoCallParticipants.callId, callId));

      const duration = Math.round((Date.now() - new Date(call.startedAt).getTime()) / 1000);
      const participantNames = callParticipants.map(p => `${p.firstName} ${p.lastName}`).join(", ");
      const durationFormatted = duration >= 60 ? `${Math.floor(duration / 60)}m ${duration % 60}s` : `${duration}s`;

      await db.insert(messages).values({
        conversationId: call.conversationId,
        senderId: call.initiatorId,
        content: `📹 Video call ended • ${durationFormatted} • ${participantNames}`,
      });

      const participantIds = await getConversationParticipantIds(call.conversationId);
      const orgId = await getConversationOrgId(call.conversationId);
      if (orgId) {
        emitCallEnded(orgId, call.conversationId, participantIds, callId);
        const [systemMsg] = await db.select().from(messages)
          .where(eq(messages.conversationId, call.conversationId))
          .orderBy(desc(messages.createdAt)).limit(1);
        if (systemMsg) {
          const senderInfo = await db.select({ id: users.id, firstName: users.firstName, lastName: users.lastName, role: users.role })
            .from(users).where(eq(users.id, call.initiatorId)).limit(1);
          emitMessageNew(orgId, call.conversationId, participantIds, { ...systemMsg, reactions: [], entityLinks: [], sender: senderInfo[0] });
        }
      }

      const endCallNotes = await db
        .select({ content: videoCallNotes.content, firstName: users.firstName, lastName: users.lastName })
        .from(videoCallNotes)
        .innerJoin(users, eq(videoCallNotes.authorId, users.id))
        .where(eq(videoCallNotes.callId, callId));

      if (endCallNotes.length > 0) {
        const notesContent = endCallNotes
          .filter(n => n.content && n.content.trim())
          .map(n => `**${n.firstName} ${n.lastName}:** ${n.content}`)
          .join("\n\n");

        if (notesContent) {
          const [notesMsg] = await db.insert(messages).values({
            conversationId: call.conversationId,
            senderId: call.initiatorId,
            content: `📝 **Call Notes**\n\n${notesContent}`,
          }).returning();

          if (orgId && notesMsg) {
            const senderInfo = await db.select({ id: users.id, firstName: users.firstName, lastName: users.lastName, role: users.role })
              .from(users).where(eq(users.id, call.initiatorId)).limit(1);
            emitMessageNew(orgId, call.conversationId, participantIds, { ...notesMsg, reactions: [], entityLinks: [], sender: senderInfo[0] });
          }
        }
      }

      res.json({ success: true });
    } catch (error) {
      next(error);
    }
  });

  router.get("/api/calls/:callId/livekit-token", requireAuth, async (req: AuthRequest, res, next) => {
    try {
      const userId = req.user!.id;
      const callId = req.params.callId;

      const [call] = await db.select().from(videoCalls).where(eq(videoCalls.id, callId)).limit(1);
      if (!call) return res.status(404).json({ error: "Call not found" });
      if (call.status === "ENDED") return res.status(400).json({ error: "Call has ended" });

      const isConvParticipant = await ensureParticipant(call.conversationId, userId);
      if (!isConvParticipant) return res.status(403).json({ error: "Not a participant of this conversation" });

      const livekitApiKey = process.env.LIVEKIT_API_KEY;
      const livekitApiSecret = process.env.LIVEKIT_API_SECRET;
      const livekitUrl = process.env.LIVEKIT_URL;

      if (!livekitApiKey || !livekitApiSecret || !livekitUrl) {
        return res.status(503).json({ error: "Video calls are not available. LiveKit is not configured.", code: "LIVEKIT_NOT_CONFIGURED" });
      }

      const userOrg = req.user!.organizationId;
      if (userOrg) {
        const videoCallsEnabled = await isFeatureEnabled(userOrg, "VIDEO_CALLS");
        if (!videoCallsEnabled) {
          return res.status(403).json({ error: "Video calls are not enabled for your organization.", code: "VIDEO_CALLS_DISABLED" });
        }
      }

      const { AccessToken } = await import("livekit-server-sdk");
      const roomName = `call-${callId}`;
      const userInfo = await db.select({
        firstName: users.firstName,
        lastName: users.lastName,
      }).from(users).where(eq(users.id, userId)).limit(1);

      const participantName = userInfo.length > 0
        ? `${userInfo[0].firstName} ${userInfo[0].lastName}`
        : userId;

      const at = new AccessToken(livekitApiKey, livekitApiSecret, {
        identity: userId,
        name: participantName,
        ttl: "4h",
      });
      at.addGrant({
        roomJoin: true,
        room: roomName,
        canPublish: true,
        canSubscribe: true,
        canPublishData: true,
      });

      const token = await at.toJwt();
      res.json({ token, url: livekitUrl });
    } catch (error) {
      next(error);
    }
  });

  const callNotesSchema = z.object({
    content: z.string().max(50000),
  });

  router.put("/api/calls/:callId/notes", requireAuth, async (req: AuthRequest, res, next) => {
    try {
      const userId = req.user!.id;
      const callId = req.params.callId;
      const notesValidation = callNotesSchema.safeParse(req.body);
      if (!notesValidation.success) return res.status(400).json({ error: "content required" });
      const { content } = notesValidation.data;

      const [call] = await db.select().from(videoCalls).where(eq(videoCalls.id, callId)).limit(1);
      if (!call) return res.status(404).json({ error: "Call not found" });

      const isConvParticipant = await ensureParticipant(call.conversationId, userId);
      if (!isConvParticipant) return res.status(403).json({ error: "Not a participant" });

      const existing = await db.select().from(videoCallNotes)
        .where(and(eq(videoCallNotes.callId, callId), eq(videoCallNotes.authorId, userId)))
        .limit(1);

      if (existing.length > 0) {
        const [updated] = await db.update(videoCallNotes)
          .set({ content, updatedAt: new Date() })
          .where(eq(videoCallNotes.id, existing[0].id))
          .returning();
        return res.json(updated);
      }

      const [note] = await db.insert(videoCallNotes)
        .values({ callId, authorId: userId, content })
        .returning();
      res.status(201).json(note);
    } catch (error) {
      next(error);
    }
  });

  router.get("/api/calls/:callId/notes", requireAuth, async (req: AuthRequest, res, next) => {
    try {
      const userId = req.user!.id;
      const callId = req.params.callId;

      const [call] = await db.select().from(videoCalls).where(eq(videoCalls.id, callId)).limit(1);
      if (!call) return res.status(404).json({ error: "Call not found" });

      const isConvParticipant = await ensureParticipant(call.conversationId, userId);
      if (!isConvParticipant) return res.status(403).json({ error: "Not a participant" });

      const notes = await db.select().from(videoCallNotes)
        .where(and(eq(videoCallNotes.callId, callId), eq(videoCallNotes.authorId, userId)))
        .orderBy(desc(videoCallNotes.createdAt));
      res.json(notes);
    } catch (error) {
      next(error);
    }
  });

  router.post("/api/calls/:callId/notes/summarize", requireAuth, async (req: AuthRequest, res, next) => {
    try {
      const userId = req.user!.id;
      const callId = req.params.callId;

      const [call] = await db.select().from(videoCalls).where(eq(videoCalls.id, callId)).limit(1);
      if (!call) return res.status(404).json({ error: "Call not found" });

      const isConvParticipant = await ensureParticipant(call.conversationId, userId);
      if (!isConvParticipant) return res.status(403).json({ error: "Not a participant" });

      const allNotes = await db
        .select({
          content: videoCallNotes.content,
          firstName: users.firstName,
          lastName: users.lastName,
        })
        .from(videoCallNotes)
        .innerJoin(users, eq(videoCallNotes.authorId, users.id))
        .where(eq(videoCallNotes.callId, callId));

      const nonEmptyNotes = allNotes.filter(n => n.content && n.content.trim().length > 0);
      if (nonEmptyNotes.length === 0) {
        return res.status(400).json({ error: "No notes to summarize" });
      }

      const notesText = nonEmptyNotes
        .map(n => `${n.firstName} ${n.lastName}'s notes:\n${n.content}`)
        .join("\n\n---\n\n");

      const { openai: openaiClient, AI_MODEL_GPT5 } = await import("./ai/openaiClient");
      const { governedAiCall } = await import("./services/aiGovernance");

      const orgId = req.user!.organizationId;
      if (!orgId) {
        return res.status(400).json({ error: "Organization context required" });
      }

      const { result: summary, blocked, reason } = await governedAiCall<string | null>({
        orgId,
        userId,
        actionType: "call_notes_summarize",
        inputRefs: { callId },
        fn: async () => {
          const completion = await openaiClient.chat.completions.create({
            model: AI_MODEL_GPT5,
            messages: [
              {
                role: "system",
                content: "You are a helpful assistant that summarizes meeting notes. Produce a clear, concise summary of the key points discussed, decisions made, and action items identified. Use bullet points for clarity. Keep it brief but comprehensive.",
              },
              {
                role: "user",
                content: `Please summarize the following call notes:\n\n${notesText}`,
              },
            ],
            max_completion_tokens: 1024,
          });
          return { result: completion.choices[0]?.message?.content || null, completion };
        },
      });

      if (blocked) {
        return res.status(429).json({ error: reason || "AI usage limit reached" });
      }
      if (!summary) {
        return res.status(502).json({ error: "AI service returned an empty response. Please try again." });
      }

      res.json({ summary });
    } catch (error) {
      next(error);
    }
  });

  router.get("/api/conversations/:id/calls", requireAuth, async (req: AuthRequest, res, next) => {
    try {
      const userId = req.user!.id;
      const conversationId = req.params.id;

      const isParticipant = await ensureParticipant(conversationId, userId);
      if (!isParticipant) return res.status(403).json({ error: "Not a participant" });

      const calls = await db.select().from(videoCalls)
        .where(eq(videoCalls.conversationId, conversationId))
        .orderBy(desc(videoCalls.startedAt))
        .limit(50);

      const callsWithDetails = await Promise.all(calls.map(async (call) => {
        const participantsData = await db
          .select({
            participant: videoCallParticipants,
            user: { id: users.id, firstName: users.firstName, lastName: users.lastName, role: users.role },
          })
          .from(videoCallParticipants)
          .innerJoin(users, eq(videoCallParticipants.userId, users.id))
          .where(eq(videoCallParticipants.callId, call.id));

        const initiatorData = await db.select({
          id: users.id, firstName: users.firstName, lastName: users.lastName, role: users.role,
        }).from(users).where(eq(users.id, call.initiatorId)).limit(1);

        const notes = await db.select().from(videoCallNotes)
          .where(and(eq(videoCallNotes.callId, call.id), eq(videoCallNotes.authorId, userId)));

        const durationSeconds = call.endedAt
          ? Math.round((new Date(call.endedAt).getTime() - new Date(call.startedAt).getTime()) / 1000)
          : null;

        return {
          ...call,
          durationSeconds,
          initiator: initiatorData[0],
          participants: participantsData.map(p => ({ ...p.participant, user: p.user })),
          notes,
        };
      }));

      res.json(callsWithDetails);
    } catch (error) {
      next(error);
    }
  });

  router.get("/api/calls/:callId", requireAuth, async (req: AuthRequest, res, next) => {
    try {
      const userId = req.user!.id;
      const callId = req.params.callId;

      const [call] = await db.select().from(videoCalls).where(eq(videoCalls.id, callId)).limit(1);
      if (!call) return res.status(404).json({ error: "Call not found" });

      const isParticipant = await ensureParticipant(call.conversationId, userId);
      if (!isParticipant) return res.status(403).json({ error: "Not a participant of this conversation" });

      const participantsData = await db
        .select({
          participant: videoCallParticipants,
          user: { id: users.id, firstName: users.firstName, lastName: users.lastName, role: users.role },
        })
        .from(videoCallParticipants)
        .innerJoin(users, eq(videoCallParticipants.userId, users.id))
        .where(and(eq(videoCallParticipants.callId, callId), sql`${videoCallParticipants.leftAt} IS NULL`));

      const initiatorData = await db.select({
        id: users.id, firstName: users.firstName, lastName: users.lastName, role: users.role,
      }).from(users).where(eq(users.id, call.initiatorId)).limit(1);

      res.json({
        ...call,
        initiator: initiatorData[0],
        participants: participantsData.map(p => ({ ...p.participant, user: p.user })),
      });
    } catch (error) {
      next(error);
    }
  });

  router.get("/api/conversations/active-calls", requireAuth, async (req: AuthRequest, res, next) => {
    try {
      const userId = req.user!.id;

      const userConvs = await db
        .select({ conversationId: conversationParticipants.conversationId })
        .from(conversationParticipants)
        .where(eq(conversationParticipants.userId, userId));

      if (userConvs.length === 0) return res.json([]);

      const convIds = userConvs.map(c => c.conversationId);

      const activeCalls = await db.select().from(videoCalls)
        .where(and(
          sql`${videoCalls.conversationId} IN (${sql.join(convIds.map(id => sql`${id}`), sql`, `)})`,
          sql`${videoCalls.status} IN ('RINGING', 'ACTIVE')`
        ));

      if (activeCalls.length === 0) return res.json([]);

      const callsWithDetails = await Promise.all(activeCalls.map(async (call) => {
        const participantsData = await db
          .select({
            participant: videoCallParticipants,
            user: { id: users.id, firstName: users.firstName, lastName: users.lastName, role: users.role },
          })
          .from(videoCallParticipants)
          .innerJoin(users, eq(videoCallParticipants.userId, users.id))
          .where(and(eq(videoCallParticipants.callId, call.id), sql`${videoCallParticipants.leftAt} IS NULL`));

        const initiatorData = await db.select({
          id: users.id, firstName: users.firstName, lastName: users.lastName, role: users.role,
        }).from(users).where(eq(users.id, call.initiatorId)).limit(1);

        return {
          ...call,
          initiator: initiatorData[0],
          participants: participantsData.map(p => ({ ...p.participant, user: p.user })),
        };
      }));

      res.json(callsWithDetails);
    } catch (error) {
      next(error);
    }
  });

  router.get("/api/conversations/:id/active-call", requireAuth, async (req: AuthRequest, res, next) => {
    try {
      const userId = req.user!.id;
      const conversationId = req.params.id;

      const isConvParticipant = await ensureParticipant(conversationId, userId);
      if (!isConvParticipant) return res.status(403).json({ error: "Not a participant" });

      const [activeCall] = await db.select().from(videoCalls)
        .where(and(
          eq(videoCalls.conversationId, conversationId),
          sql`${videoCalls.status} IN ('RINGING', 'ACTIVE')`
        ))
        .limit(1);

      if (!activeCall) return res.json(null);

      const participantsData = await db
        .select({
          participant: videoCallParticipants,
          user: { id: users.id, firstName: users.firstName, lastName: users.lastName, role: users.role },
        })
        .from(videoCallParticipants)
        .innerJoin(users, eq(videoCallParticipants.userId, users.id))
        .where(and(eq(videoCallParticipants.callId, activeCall.id), sql`${videoCallParticipants.leftAt} IS NULL`));

      const initiatorData = await db.select({
        id: users.id, firstName: users.firstName, lastName: users.lastName, role: users.role,
      }).from(users).where(eq(users.id, activeCall.initiatorId)).limit(1);

      res.json({
        ...activeCall,
        initiator: initiatorData[0],
        participants: participantsData.map(p => ({ ...p.participant, user: p.user })),
      });
    } catch (error) {
      next(error);
    }
  });
  router.get("/api/call-notes", requireAuth, async (req: AuthRequest, res, next) => {
    try {
      const userId = req.user!.id;
      const { orgId, mustDenyAccess } = getOrgIdForFilter(req);
      const page = Math.max(1, parseInt(req.query.page as string) || 1);
      const limit = Math.min(50, Math.max(1, parseInt(req.query.limit as string) || 20));
      const search = (req.query.search as string || "").trim();
      const dateFrom = req.query.dateFrom as string | undefined;
      const dateTo = req.query.dateTo as string | undefined;
      const offset = (page - 1) * limit;

      if (mustDenyAccess) {
        return res.json({ calls: [], total: 0, page, limit });
      }

      const conditions: SQL[] = [
        eq(videoCalls.status, "ENDED"),
      ];

      if (orgId) {
        conditions.push(eq(conversations.organizationId, orgId));
      }

      const userConvIds = await db
        .select({ conversationId: conversationParticipants.conversationId })
        .from(conversationParticipants)
        .where(eq(conversationParticipants.userId, userId));
      const convIdSet = userConvIds.map(r => r.conversationId);

      if (convIdSet.length === 0) {
        return res.json({ calls: [], total: 0, page, limit });
      }

      conditions.push(inArray(videoCalls.conversationId, convIdSet));

      if (dateFrom) {
        conditions.push(sql`${videoCalls.startedAt} >= ${new Date(dateFrom)}`);
      }
      if (dateTo) {
        const toDate = new Date(dateTo);
        toDate.setDate(toDate.getDate() + 1);
        conditions.push(sql`${videoCalls.startedAt} < ${toDate}`);
      }

      if (search) {
        conditions.push(
          sql`EXISTS (
            SELECT 1 FROM video_call_notes vcn
            WHERE vcn.call_id = ${videoCalls.id}
            AND LOWER(vcn.content) LIKE ${'%' + search.toLowerCase() + '%'}
          )`
        );
      }

      const whereClause = and(...conditions);

      const countResult = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(videoCalls)
        .innerJoin(conversations, eq(videoCalls.conversationId, conversations.id))
        .where(whereClause);
      const total = countResult[0]?.count ?? 0;

      const calls = await db
        .select({
          id: videoCalls.id,
          conversationId: videoCalls.conversationId,
          initiatorId: videoCalls.initiatorId,
          status: videoCalls.status,
          startedAt: videoCalls.startedAt,
          endedAt: videoCalls.endedAt,
          conversationName: conversations.name,
          conversationType: conversations.type,
        })
        .from(videoCalls)
        .innerJoin(conversations, eq(videoCalls.conversationId, conversations.id))
        .where(whereClause)
        .orderBy(desc(videoCalls.startedAt))
        .limit(limit)
        .offset(offset);

      const callsWithDetails = await Promise.all(calls.map(async (call) => {
        const participantsData = await db
          .select({
            participant: videoCallParticipants,
            user: { id: users.id, firstName: users.firstName, lastName: users.lastName, role: users.role },
          })
          .from(videoCallParticipants)
          .innerJoin(users, eq(videoCallParticipants.userId, users.id))
          .where(eq(videoCallParticipants.callId, call.id));

        const initiatorData = await db.select({
          id: users.id, firstName: users.firstName, lastName: users.lastName, role: users.role,
        }).from(users).where(eq(users.id, call.initiatorId)).limit(1);

        const notes = await db.select().from(videoCallNotes)
          .where(eq(videoCallNotes.callId, call.id))
          .orderBy(desc(videoCallNotes.updatedAt));

        const noteAuthors = notes.length > 0
          ? await db.select({ id: users.id, firstName: users.firstName, lastName: users.lastName })
            .from(users)
            .where(inArray(users.id, notes.map(n => n.authorId)))
          : [];
        const authorMap = Object.fromEntries(noteAuthors.map(a => [a.id, a]));

        const durationSeconds = call.endedAt
          ? Math.round((new Date(call.endedAt).getTime() - new Date(call.startedAt).getTime()) / 1000)
          : null;

        return {
          id: call.id,
          conversationId: call.conversationId,
          conversationName: call.conversationName,
          conversationType: call.conversationType,
          initiatorId: call.initiatorId,
          status: call.status,
          startedAt: call.startedAt,
          endedAt: call.endedAt,
          durationSeconds,
          initiator: initiatorData[0],
          participants: participantsData.map(p => ({ ...p.participant, user: p.user })),
          notes: notes.map(n => ({
            ...n,
            author: authorMap[n.authorId] || null,
          })),
        };
      }));

      res.json({ calls: callsWithDetails, total, page, limit });
    } catch (error) {
      next(error);
    }
  });

})();

export { messagingSetup };
export default router;
