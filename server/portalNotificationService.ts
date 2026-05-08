import { db } from "./db";
import {
  portalNotifications,
  portalNotificationPrefs,
  clientPortalAccess,
  subcontractorPortalTokens,
} from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { logError } from "./utils/logger";
import { emitPortalNotification, isPortalClientConnected } from "./portalChatEvents";
import { publishPortalNotificationEvent } from "./portalNotificationBus";
import { sendEmail } from "./email";

export interface CreatePortalNotificationInput {
  organizationId: string;
  recipientType: "client" | "subcontractor" | "vendor";
  clientPortalAccessId?: string | null;
  portalTokenId?: string | null;
  userId?: string | null;
  type: string;
  title: string;
  message: string;
  actionUrl?: string | null;
  metadata?: Record<string, unknown> | null;
  /**
   * When true, email is sent even if the recipient is actively connected via SSE.
   * When false/omitted, email is only sent for high-priority events and only when
   * the recipient is not currently viewing the portal (SSE disconnected).
   */
  highPriority?: boolean;
}

async function getRecipientDetails(
  recipientType: string,
  clientPortalAccessId: string | null | undefined,
  portalTokenId: string | null | undefined,
  userId: string | null | undefined,
): Promise<{ email: string | null; name: string | null; sseIdentifier: string | null }> {
  try {
    if (recipientType === "client" && clientPortalAccessId) {
      const [row] = await db
        .select({
          email: clientPortalAccess.email,
          name: clientPortalAccess.name,
          projectId: clientPortalAccess.projectId,
        })
        .from(clientPortalAccess)
        .where(eq(clientPortalAccess.id, clientPortalAccessId))
        .limit(1);
      if (!row) return { email: null, name: null, sseIdentifier: null };
      return {
        email: row.email,
        name: row.name,
        sseIdentifier: `${row.email}:${row.projectId}`,
      };
    }
    if (recipientType === "subcontractor" && portalTokenId) {
      const [row] = await db
        .select({
          email: subcontractorPortalTokens.contactEmail,
          name: subcontractorPortalTokens.contactName,
        })
        .from(subcontractorPortalTokens)
        .where(eq(subcontractorPortalTokens.id, portalTokenId))
        .limit(1);
      return {
        email: row?.email ?? null,
        name: row?.name ?? null,
        sseIdentifier: portalTokenId,
      };
    }
    if (recipientType === "vendor" && userId) {
      const { users } = await import("@shared/schema");
      const [row] = await db
        .select({
          email: users.email,
          firstName: users.firstName,
          lastName: users.lastName,
        })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);
      return {
        email: row?.email ?? null,
        name: row ? `${row.firstName || ""} ${row.lastName || ""}`.trim() : null,
        sseIdentifier: userId,
      };
    }
  } catch {
    // best-effort
  }
  return { email: null, name: null, sseIdentifier: null };
}

async function getPrefs(
  recipientType: string,
  clientPortalAccessId: string | null | undefined,
  portalTokenId: string | null | undefined,
  userId: string | null | undefined,
): Promise<{ emailEnabled: boolean; inAppEnabled: boolean }> {
  try {
    let filter;
    if (recipientType === "client" && clientPortalAccessId) {
      filter = eq(portalNotificationPrefs.clientPortalAccessId, clientPortalAccessId);
    } else if (recipientType === "subcontractor" && portalTokenId) {
      filter = eq(portalNotificationPrefs.portalTokenId, portalTokenId);
    } else if (recipientType === "vendor" && userId) {
      filter = eq(portalNotificationPrefs.userId, userId);
    } else {
      return { emailEnabled: true, inAppEnabled: true };
    }
    const [row] = await db
      .select({
        emailEnabled: portalNotificationPrefs.emailEnabled,
        inAppEnabled: portalNotificationPrefs.inAppEnabled,
      })
      .from(portalNotificationPrefs)
      .where(filter)
      .limit(1);
    if (!row) return { emailEnabled: true, inAppEnabled: true };
    return { emailEnabled: row.emailEnabled, inAppEnabled: row.inAppEnabled };
  } catch {
    return { emailEnabled: true, inAppEnabled: true };
  }
}

export async function createPortalNotification(
  input: CreatePortalNotificationInput,
): Promise<void> {
  try {
    const prefs = await getPrefs(
      input.recipientType,
      input.clientPortalAccessId,
      input.portalTokenId,
      input.userId,
    );

    const ssePayload: Record<string, unknown> = {
      type: input.type,
      title: input.title,
      message: input.message,
      actionUrl: input.actionUrl ?? null,
    };

    if (prefs.inAppEnabled) {
      const [inserted] = await db
        .insert(portalNotifications)
        .values({
          organizationId: input.organizationId,
          recipientType: input.recipientType,
          clientPortalAccessId: input.clientPortalAccessId ?? null,
          portalTokenId: input.portalTokenId ?? null,
          userId: input.userId ?? null,
          type: input.type,
          title: input.title,
          message: input.message,
          actionUrl: input.actionUrl ?? null,
          isRead: false,
          metadata: input.metadata ?? null,
        })
        .returning();

      if (inserted) {
        const fullPayload = { ...ssePayload, id: inserted.id, createdAt: inserted.createdAt.toISOString() };

        if (input.recipientType === "client" && input.clientPortalAccessId) {
          const details = await getRecipientDetails("client", input.clientPortalAccessId, null, null);
          if (details.sseIdentifier) {
            emitPortalNotification("client", details.sseIdentifier, fullPayload);
            void publishPortalNotificationEvent("client", details.sseIdentifier, fullPayload);
          }
        } else if (input.recipientType === "subcontractor" && input.portalTokenId) {
          emitPortalNotification("sub", input.portalTokenId, fullPayload);
          void publishPortalNotificationEvent("sub", input.portalTokenId, fullPayload);
        } else if (input.recipientType === "vendor" && input.userId) {
          emitPortalNotification("vendor", input.userId, fullPayload);
          void publishPortalNotificationEvent("vendor", input.userId, fullPayload);
        }
      }
    }

    if (prefs.emailEnabled && input.highPriority) {
      setImmediate(() => {
        void (async () => {
          try {
            const details = await getRecipientDetails(
              input.recipientType,
              input.clientPortalAccessId,
              input.portalTokenId,
              input.userId,
            );
            if (!details.email) return;

            // Always suppress email if recipient is actively viewing the portal,
            // even for high-priority events — in-app SSE already delivers it.
            if (details.sseIdentifier) {
              const sseType =
                input.recipientType === "client"
                  ? "client"
                  : input.recipientType === "subcontractor"
                    ? "sub"
                    : "vendor";
              if (isPortalClientConnected(sseType, details.sseIdentifier)) {
                return;
              }
            }

            const baseUrl = process.env.APP_BASE_URL ||
              (process.env.REPLIT_DOMAINS ? `https://${process.env.REPLIT_DOMAINS}` : "");
            const actionLink = input.actionUrl
              ? (input.actionUrl.startsWith("http") ? input.actionUrl : `${baseUrl}${input.actionUrl}`)
              : null;

            const html = `
              <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                <h2 style="color: #333; margin-bottom: 8px;">${escapeHtml(input.title)}</h2>
                <p style="color: #555; line-height: 1.6;">${escapeHtml(input.message)}</p>
                ${actionLink ? `
                <p style="margin-top: 20px;">
                  <a href="${actionLink}" style="background-color: #0070f3; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">
                    View Details
                  </a>
                </p>` : ""}
                <hr style="margin-top: 30px; border: none; border-top: 1px solid #eee;">
                <p style="color: #999; font-size: 12px;">You are receiving this because you have an active portal session with this project team.</p>
              </div>
            `;

            await sendEmail({
              to: details.email,
              subject: `${input.title} — SmartManageAI`,
              html,
              text: input.message,
            });
          } catch (emailErr) {
            logError("portalNotificationService: email delivery failed", { error: String(emailErr) });
          }
        })();
      });
    }
  } catch (err) {
    logError("portalNotificationService: createPortalNotification failed", { error: String(err) });
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export async function createPortalNotificationsForProject(
  projectId: string,
  organizationId: string,
  input: Omit<
    CreatePortalNotificationInput,
    "organizationId" | "recipientType" | "clientPortalAccessId" | "portalTokenId" | "userId"
  >,
): Promise<void> {
  try {
    const [clientAccessRows, subTokenRows] = await Promise.all([
      db
        .select({ id: clientPortalAccess.id })
        .from(clientPortalAccess)
        .where(
          and(
            eq(clientPortalAccess.projectId, projectId),
            eq(clientPortalAccess.isActive, true),
          ),
        ),
      db
        .select({ id: subcontractorPortalTokens.id })
        .from(subcontractorPortalTokens)
        .where(eq(subcontractorPortalTokens.projectId, projectId)),
    ]);

    const tasks: Promise<void>[] = [];
    for (const row of clientAccessRows) {
      tasks.push(
        createPortalNotification({
          ...input,
          organizationId,
          recipientType: "client",
          clientPortalAccessId: row.id,
        }),
      );
    }
    for (const row of subTokenRows) {
      tasks.push(
        createPortalNotification({
          ...input,
          organizationId,
          recipientType: "subcontractor",
          portalTokenId: row.id,
        }),
      );
    }
    await Promise.allSettled(tasks);
  } catch (err) {
    logError("portalNotificationService: createPortalNotificationsForProject failed", { error: String(err) });
  }
}
