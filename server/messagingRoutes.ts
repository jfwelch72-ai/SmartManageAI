import { Router } from "express";
import { db } from "./db";
import { users } from "@shared/schema";
import { requireAuth, requireRole, type AuthRequest } from "./auth";
import { eq, desc, sql, and, inArray } from "drizzle-orm";
import { sanitizeText } from "./sanitization";
import { getOrgIdForFilter } from "./orgFilter";

const router = Router();

const messagingSetup = (async () => {
  const {
    conversations,
    conversationParticipants,
    messages,
    messageReadReceipts,
    insertConversationSchema,
    insertMessageSchema,
    organizations
  } = await import("@shared/schema");

  // Get all conversations for current user
  router.get("/api/conversations", requireAuth, async (req: AuthRequest, res) => {
    try {
      const userId = req.user!.id;

      // Get all conversations the user participates in
      const userConversations = await db
        .select({
          conversation: conversations,
          participant: conversationParticipants,
        })
        .from(conversationParticipants)
        .innerJoin(conversations, eq(conversationParticipants.conversationId, conversations.id))
        .where(eq(conversationParticipants.userId, userId))
        .orderBy(desc(conversations.updatedAt));

      // For each conversation, get participants and last message
      const conversationsWithDetails = await Promise.all(
        userConversations.map(async ({ conversation, participant }) => {
          // Get all participants
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

          // Get last message
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

          // Get unread count for this user
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

  // Get or create company-wide channel (scoped to organization)
  router.get("/api/conversations/company-channel", requireAuth, async (req: AuthRequest, res) => {
    try {
      const userId = req.user!.id;
      const organizationId = req.user!.organizationId;

      if (!organizationId) {
        res.status(400).json({ error: "You must belong to an organization to access company chat" });
        return;
      }

      // Find existing company channel for this organization
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

      // Create if doesn't exist for this organization
      if (!companyChannel) {
        // Get organization name for channel title
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

        // Add all active users from this organization as participants
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
        // Ensure current user is a participant
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

  // Create a new conversation (direct message or group) - scoped to organization
  router.post("/api/conversations", requireAuth, async (req: AuthRequest, res) => {
    try {
      const userId = req.user!.id;
      const organizationId = req.user!.organizationId;
      const { type, name, description, participantIds } = req.body;

      if (!organizationId) {
        res.status(400).json({ error: "You must belong to an organization to create conversations" });
        return;
      }

      // Validate type
      if (!["DIRECT", "GROUP"].includes(type)) {
        res.status(400).json({ error: "Invalid conversation type" });
        return;
      }

      // Validate that all participants are from the same organization
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

      // For direct messages, check if conversation already exists
      if (type === "DIRECT" && participantIds?.length === 1) {
        const otherUserId = participantIds[0];
        
        // Find existing direct conversation between these two users
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
            // Return existing conversation
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

      // Create new conversation with organization scope
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

      // Add creator as participant
      await db.insert(conversationParticipants).values({
        conversationId: newConversation.id,
        userId: userId,
        isAdmin: true,
      });

      // Add other participants
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
      const before = req.query.before as string | undefined;

      // Verify user is a participant
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

      // Build query for messages
      let query = db
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

      const messageResults = await query;

      // Reverse to get chronological order
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

  // Send a message
  router.post("/api/conversations/:id/messages", requireAuth, async (req: AuthRequest, res) => {
    try {
      const userId = req.user!.id;
      const conversationId = req.params.id;
      const { content, attachmentUrl, attachmentName, attachmentType } = req.body;

      if (!content?.trim()) {
        res.status(400).json({ error: "Message content is required" });
        return;
      }

      // Verify user is a participant
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

      // Create message
      const sanitizedContent = sanitizeText(content);
      if (!sanitizedContent) {
        res.status(400).json({ error: "Message content is required" });
        return;
      }
      
      const [newMessage] = await db
        .insert(messages)
        .values({
          conversationId: conversationId as string,
          senderId: userId,
          content: sanitizedContent,
          attachmentUrl: attachmentUrl || null,
          attachmentName: attachmentName || null,
          attachmentType: attachmentType || null,
        })
        .returning();

      // Update conversation timestamp
      await db
        .update(conversations)
        .set({ updatedAt: new Date() })
        .where(eq(conversations.id, conversationId));

      // Mark as read for sender
      await db.insert(messageReadReceipts).values({
        messageId: newMessage.id,
        userId: userId,
      }).onConflictDoNothing();

      // Get sender info
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

      res.status(201).json({
        ...newMessage,
        sender,
      });
    } catch (error) {
      console.error("Send message error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Mark messages as read
  router.post("/api/conversations/:id/read", requireAuth, async (req: AuthRequest, res) => {
    try {
      const userId = req.user!.id;
      const conversationId = req.params.id;

      // Verify user is a participant
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

      // Get all unread messages in this conversation
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

      // Mark all as read
      if (unreadMessages.length > 0) {
        await db.insert(messageReadReceipts).values(
          unreadMessages.map(m => ({
            messageId: m.id,
            userId: userId,
          }))
        ).onConflictDoNothing();
      }

      // Update last read timestamp
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

      // Get all conversations user participates in
      const userConversationIds = await db
        .select({ conversationId: conversationParticipants.conversationId })
        .from(conversationParticipants)
        .where(eq(conversationParticipants.userId, userId));

      if (userConversationIds.length === 0) {
        res.json({ unreadCount: 0 });
        return;
      }

      const convIds = userConversationIds.map(c => c.conversationId);

      // Count unread messages across all conversations
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

  // Get users available for messaging (for starting new conversations)
  router.get("/api/messaging/users", requireAuth, async (req: AuthRequest, res) => {
    try {
      const userId = req.user!.id;
      
      // Organization filtering: Only show users from same organization for messaging
      // SUPER_ADMIN can message anyone
      const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
      
      // SECURITY: Users without org can't see any messaging users
      if (mustDenyAccess) {
        return res.json([]);
      }

      const conditions = [
        eq(users.isActive, true),
        sql`${users.id} != ${userId}`
      ];
      
      // Non-SUPER_ADMIN can only message users in their organization
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
