import * as cron from "node-cron";
import { db } from "./db";
import { crmTasks, crmOpportunities, organizationNetworkSettings } from "@shared/schema";
import { and, eq, lte, gte, isNull, ne } from "drizzle-orm";
import { insertNotification } from "./services/notificationService";
import { logError, logInfo } from "./utils/logger";

/**
 * CRM Task Reminder Scheduler
 * - Sends in-app notifications for tasks due within the next 24 hours
 *   that haven't already had a reminder sent.
 * - Sends overdue reminders once per day for incomplete tasks.
 * Runs every hour.
 */
export class CrmTaskReminderScheduler {
  private task: ReturnType<typeof cron.schedule> | null = null;

  start() {
    this.task = cron.schedule("0 * * * *", async () => {
      try {
        await this.runOnce();
      } catch (err) {
        logError("[CRM Task Reminder] hourly run failed", {}, err instanceof Error ? err : new Error(String(err)));
      }
    });
    logInfo("[CRM Task Reminder] Scheduler started (hourly at :00)");
  }

  stop() {
    if (this.task) { this.task.stop(); this.task = null; }
  }

  async runOnce(): Promise<{ remindersSent: number }> {
    const now = new Date();
    const in24h = new Date(now.getTime() + 24 * 60 * 60 * 1000);

    const due = await db
      .select({ task: crmTasks, opportunityName: crmOpportunities.name })
      .from(crmTasks)
      .leftJoin(crmOpportunities, eq(crmTasks.opportunityId, crmOpportunities.id))
      .where(and(
        lte(crmTasks.dueDate, in24h),
        ne(crmTasks.status, "COMPLETED"),
        ne(crmTasks.status, "CANCELLED"),
        isNull(crmTasks.reminderSentAt),
      ));

    let sent = 0;
    for (const row of due) {
      const t = row.task;
      if (!t.assignedToId) continue;

      const [orgSetting] = await db
        .select({ notifyInApp: organizationNetworkSettings.notifyInApp })
        .from(organizationNetworkSettings)
        .where(eq(organizationNetworkSettings.organizationId, t.organizationId))
        .limit(1);
      if (orgSetting && orgSetting.notifyInApp === false) continue;

      const overdue = t.dueDate < now;
      await insertNotification({
        userId: t.assignedToId,
        organizationId: t.organizationId,
        type: "CRM_TASK_REMINDER",
        title: overdue ? "Overdue task" : "Task due soon",
        message: `"${t.title}" — due ${t.dueDate.toLocaleString()}${row.opportunityName ? ` (re: ${row.opportunityName})` : ""}`,
        link: t.opportunityId ? `/crm?tab=pipeline&opportunity=${t.opportunityId}` : `/crm?tab=tasks`,
      });

      await db.update(crmTasks).set({ reminderSentAt: now }).where(eq(crmTasks.id, t.id));
      sent++;
    }
    if (sent > 0) logInfo(`[CRM Task Reminder] sent ${sent} reminder(s)`);
    return { remindersSent: sent };
  }
}

export const crmTaskReminderScheduler = new CrmTaskReminderScheduler();
