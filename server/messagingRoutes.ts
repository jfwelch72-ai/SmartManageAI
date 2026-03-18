import { Router } from "express";
import { db } from "./db";
import { users, projects as projectsTable, aiTasks } from "@shared/schema";
import { requireAuth, requireRole, type AuthRequest } from "./auth";
import { eq, desc, sql, and, inArray, or, isNotNull, ilike, isNull } from "drizzle-orm";
import { sanitizeText } from "./sanitization";
import { getOrgIdForFilter } from "./orgFilter";
import multer from "multer";
import { randomUUID } from "crypto";
import { ObjectStorageService, objectStorageClient, ObjectNotFoundError } from "./objectStorage";

const router = Router();

const msgUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }, // 25MB limit for files/voice
});

const messagingSetup = (async () => {
  const {
    conversations,
    conversationParticipants,
    messages,
    messageReadReceipts,
    organizations,
    tasks,
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
  router.get("/api/conversations", requireAuth, async (req: AuthRequest, res) => {
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
      console.error("Get conversations error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // ── CHANNELS: list all org channels (named, project, crew) ──
  router.get("/api/channels", requireAuth, async (req: AuthRequest, res) => {
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
      console.error("Get channels error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // ── CHANNELS: create a named channel ──
  router.post("/api/channels", requireAuth, async (req: AuthRequest, res) => {
    try {
      const userId = req.user!.id;
      const organizationId = req.user!.organizationId;
      if (!organizationId) return res.status(400).json({ error: "Organization required" });

      const { name, description, topic } = req.body;
      if (!name?.trim()) return res.status(400).json({ error: "Channel name is required" });

      const slug = name.trim().toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");

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
      console.error("Create channel error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // ── CHANNELS: self-join a channel ──
  router.post("/api/channels/:id/join", requireAuth, async (req: AuthRequest, res) => {
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
      console.error("Join channel error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // ── CHANNELS: archive a channel (admin only) ──
  router.patch("/api/channels/:id/archive", requireAuth, async (req: AuthRequest, res) => {
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
      console.error("Archive channel error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Get or create company-wide channel (scoped to organization)
  router.get("/api/conversations/company-channel", requireAuth, async (req: AuthRequest, res) => {
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
      console.error("Get company channel error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Create a new conversation (direct message or group)
  router.post("/api/conversations", requireAuth, async (req: AuthRequest, res) => {
    try {
      const userId = req.user!.id;
      const organizationId = req.user!.organizationId;
      const { type, name, description, participantIds } = req.body;

      if (!organizationId) {
        res.status(400).json({ error: "You must belong to an organization to create conversations" });
        return;
      }

      if (!["DIRECT", "GROUP"].includes(type)) {
        res.status(400).json({ error: "Invalid conversation type" });
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
      console.error("Create conversation error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Get messages for a conversation
  router.get("/api/conversations/:id/messages", requireAuth, async (req: AuthRequest, res) => {
    try {
      const userId = req.user!.id;
      const conversationId = req.params.id;
      const limit = parseInt(req.query.limit as string) || 50;

      const isParticipant = await ensureParticipant(conversationId, userId);
      if (!isParticipant) {
        res.status(403).json({ error: "Not a participant of this conversation" });
        return;
      }

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
        .where(eq(messages.conversationId, conversationId))
        .orderBy(desc(messages.createdAt))
        .limit(limit);

      const messagesWithSenders = messageResults.reverse().map(m => ({
        ...m.message,
        sender: m.sender,
      }));

      res.json(messagesWithSenders);
    } catch (error) {
      console.error("Get messages error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Send a message (supports file attachments, voice, and task mentions)
  router.post("/api/conversations/:id/messages", requireAuth, async (req: AuthRequest, res) => {
    try {
      const userId = req.user!.id;
      const conversationId = req.params.id;
      const { content, attachmentUrl, attachmentName, attachmentType, voiceUrl, voiceDurationSeconds, mentionedTaskIds } = req.body;

      if (!content?.trim() && !attachmentUrl && !voiceUrl) {
        res.status(400).json({ error: "Message content or attachment is required" });
        return;
      }

      const isParticipant = await ensureParticipant(conversationId, userId);
      if (!isParticipant) {
        res.status(403).json({ error: "Not a participant of this conversation" });
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

      res.status(201).json({ ...newMessage, sender });
    } catch (error) {
      console.error("Send message error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // ── FILE UPLOAD for messaging ──
  router.post("/api/conversations/:id/upload", requireAuth, msgUpload.single("file"), async (req: AuthRequest, res) => {
    try {
      const userId = req.user!.id;
      const orgId = req.user!.organizationId;
      const conversationId = req.params.id;

      if (!orgId) return res.status(400).json({ error: "Organization required" });

      const isParticipant = await ensureParticipant(conversationId, userId);
      if (!isParticipant) return res.status(403).json({ error: "Not a participant of this conversation" });

      const file = req.file;
      if (!file) return res.status(400).json({ error: "No file provided" });

      const objectStorage = new ObjectStorageService();
      const publicPaths = objectStorage.getPublicObjectSearchPaths();
      if (publicPaths.length === 0) return res.status(500).json({ error: "Object storage not configured" });

      const basePath = publicPaths[0];
      const ext = file.originalname.split(".").pop() || "bin";
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
          contentType: file.mimetype,
          metadata: { originalName: file.originalname, source: "messaging" },
        },
      });

      const proxyUrl = `/api/conversations/${conversationId}/files/${uniqueId}.${ext}`;
      res.json({
        url: proxyUrl,
        name: file.originalname,
        type: file.mimetype,
        size: file.size,
      });
    } catch (error) {
      console.error("File upload error:", error);
      res.status(500).json({ error: "Failed to upload file" });
    }
  });

  // ── VOICE MESSAGE UPLOAD — uploads audio and creates the message in one step ──
  router.post("/api/conversations/:id/voice", requireAuth, msgUpload.single("audio"), async (req: AuthRequest, res) => {
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

      const objectStorage = new ObjectStorageService();
      const publicPaths = objectStorage.getPublicObjectSearchPaths();
      if (publicPaths.length === 0) return res.status(500).json({ error: "Object storage not configured" });

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
          contentType: file.mimetype || "audio/webm",
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

      res.status(201).json({ ...newMessage, sender });
    } catch (error) {
      console.error("Voice upload error:", error);
      res.status(500).json({ error: "Failed to upload voice message" });
    }
  });

  // ── SERVE FILES from object storage ──
  router.get("/api/conversations/:id/files/:filename", requireAuth, async (req: AuthRequest, res) => {
    try {
      const orgId = req.user!.organizationId;
      const conversationId = req.params.id;
      const filename = req.params.filename;

      const objectStorage = new ObjectStorageService();
      const publicPaths = objectStorage.getPublicObjectSearchPaths();
      if (publicPaths.length === 0) return res.status(500).json({ error: "Storage not configured" });

      const basePath = publicPaths[0];
      const filePath = `messaging/${orgId}/${conversationId}/${filename}`;
      const file = await objectStorage.searchPublicObject(filePath);
      if (!file) return res.status(404).json({ error: "File not found" });

      objectStorage.downloadObject(file, res, 86400);
    } catch (error: any) {
      console.error("Serve file error:", error);
      if (error instanceof ObjectNotFoundError) return res.status(404).json({ error: "File not found" });
      res.status(500).json({ error: "Failed to serve file" });
    }
  });

  // ── SERVE VOICE from object storage ──
  router.get("/api/conversations/:id/voice/:filename", requireAuth, async (req: AuthRequest, res) => {
    try {
      const orgId = req.user!.organizationId;
      const conversationId = req.params.id;
      const filename = req.params.filename;

      const objectStorage = new ObjectStorageService();
      const publicPaths = objectStorage.getPublicObjectSearchPaths();
      if (publicPaths.length === 0) return res.status(500).json({ error: "Storage not configured" });

      const filePath = `messaging/${orgId}/${conversationId}/${filename}`;
      const file = await objectStorage.searchPublicObject(filePath);
      if (!file) return res.status(404).json({ error: "Voice file not found" });

      objectStorage.downloadObject(file, res, 86400);
    } catch (error: any) {
      console.error("Serve voice error:", error);
      if (error instanceof ObjectNotFoundError) return res.status(404).json({ error: "File not found" });
      res.status(500).json({ error: "Failed to serve voice file" });
    }
  });

  // ── TASK MENTION SEARCH — scoped to conversation (and its linked project if any) ──
  // Returns { id, title, projectName } for both project tasks and AI tasks
  router.get("/api/conversations/:id/mention-search", requireAuth, async (req: AuthRequest, res) => {
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
      const taskConditions: any[] = [eq(tasks.organizationId, orgId)];
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

      // Query AI tasks joined with project name
      const aiConditions: any[] = [];
      if (q.trim()) aiConditions.push(ilike(aiTasks.title, `%${q}%`));
      if (scopedProjectId) aiConditions.push(eq(aiTasks.projectId, scopedProjectId));

      const aiTaskResults = await db
        .select({
          id: aiTasks.id,
          title: aiTasks.title,
          projectName: projectsTable.name,
        })
        .from(aiTasks)
        .leftJoin(projectsTable, eq(aiTasks.projectId, projectsTable.id))
        .where(aiConditions.length > 0 ? and(...aiConditions) : undefined)
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
      console.error("Task mention search error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Mark messages as read
  router.post("/api/conversations/:id/read", requireAuth, async (req: AuthRequest, res) => {
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
      console.error("Mark messages read error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Get total unread message count for navigation badge
  router.get("/api/messages/unread-count", requireAuth, async (req: AuthRequest, res) => {
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
      console.error("Get unread count error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Get users available for messaging
  router.get("/api/messaging/users", requireAuth, async (req: AuthRequest, res) => {
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
      console.error("Get messaging users error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });
})();

export { messagingSetup };
export default router;
