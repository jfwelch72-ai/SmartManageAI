import { logError } from "../utils/logger";
import * as cron from 'node-cron';
import { db } from "../db";
import { aiSettings, changeOrders, projects, users, notifications, projectDbeGoals, organizations } from "@shared/schema";
import { runAIAnalysis } from "./orchestrator";
import { sql, eq, and, inArray } from 'drizzle-orm';
import { insertNotifications } from "../services/notificationService";
import { computeDbeRiskAssessment } from "../aiHeavyCivilFeatureRoutes";
import { isFeatureEnabled } from "../services/featureFlagService";
import { withSchedulerLock } from "../utils/schedulerLock";

let scheduledTask: cron.ScheduledTask | null = null;
let weeklyAlertTask: cron.ScheduledTask | null = null;
let dailyDbeRiskTask: cron.ScheduledTask | null = null;

export async function initializeAIScheduler() {
  console.log('🤖 Initializing AI PM + CFO scheduler...');

  // Get or create AI settings
  let [settings] = await db.select().from(aiSettings).limit(1);

  if (!settings) {
    console.log('📝 Creating default AI settings...');
    [settings] = await db.insert(aiSettings).values({}).returning();
  }

  // DBE risk job is independent of `dailyRunsEnabled` (which only gates the
  // PM + CFO orchestrator). Initialize it before the early-return so admins
  // who disable the PM/CFO runs still get DBE compliance alerts.
  initializeDailyDbeRiskJob();

  if (!settings.dailyRunsEnabled) {
    console.log('⏸️  Daily AI runs are disabled in settings');
    return;
  }

  const [hour, minute] = settings.dailyRunTime.split(':').map(Number);

  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    logError('Invalid daily run time in settings', { dailyRunTime: settings.dailyRunTime });
    return;
  }

  const cronExpression = `${minute} ${hour} * * *`;

  console.log(`⏰ Scheduling daily AI runs at ${settings.dailyRunTime} (${cronExpression})`);

  if (scheduledTask) {
    scheduledTask.stop();
  }

  scheduledTask = cron.schedule(cronExpression, async () => {
    try {
      // Task #2427 — only the leader replica runs the daily AI orchestrator.
      await withSchedulerLock('ai:pm-cfo-daily', async () => {
        console.log('🚀 Triggering scheduled AI PM + CFO analysis...');
        await runAIAnalysis(null);
        console.log('✅ Scheduled AI analysis completed successfully');
      });
    } catch (error) {
      logError('❌ Scheduled AI analysis failed:', {}, error instanceof Error ? error : new Error(String(error)));
    }
  }, {
    timezone: 'America/New_York',
  });

  console.log('✅ AI scheduler initialized successfully');
  
  // Initialize weekly change order alert (every Monday at 8:00 AM)
  await initializeWeeklyChangeOrderAlerts();
}

/**
 * Daily DBE risk scoring — computes participation risk for every active project
 * with DBE goals in any organization that has DBE_TRACKING enabled, and
 * notifies admins/managers when a project lands in the HIGH risk band.
 */
function initializeDailyDbeRiskJob() {
  if (dailyDbeRiskTask) dailyDbeRiskTask.stop();
  console.log('📊 Scheduling daily DBE risk job (06:00 EST)...');
  dailyDbeRiskTask = cron.schedule('0 6 * * *', async () => {
    try {
      // Task #2427 — single-leader so DBE alerts aren't duplicated.
      await withSchedulerLock('ai:dbe-risk-daily', () => runDailyDbeRiskJob());
    } catch (err) {
      logError('❌ Daily DBE risk job failed', {}, err instanceof Error ? err : new Error(String(err)));
    }
  }, { timezone: 'America/New_York' });
}

async function runDailyDbeRiskJob() {
  console.log('📊 Running daily DBE risk job...');

  // Find every org that has DBE_TRACKING enabled (flag stored in organizations.featureFlags JSON)
  const allOrgs = await db.select({ id: organizations.id }).from(organizations);
  const orgIds: string[] = [];
  for (const o of allOrgs) {
    if (await isFeatureEnabled(o.id, 'DBE_TRACKING')) orgIds.push(o.id);
  }
  if (orgIds.length === 0) {
    console.log('📊 No orgs with DBE_TRACKING enabled');
    return;
  }

  // All projects in those orgs that have at least one DBE goal
  const projectsWithGoals = await db
    .selectDistinct({ projectId: projectDbeGoals.projectId, organizationId: projectDbeGoals.organizationId })
    .from(projectDbeGoals)
    .where(inArray(projectDbeGoals.organizationId, orgIds));

  let highRisk = 0;
  for (const row of projectsWithGoals) {
    try {
      // No userId — system-triggered run; skip AI commentary to keep cost predictable
      const result = await computeDbeRiskAssessment(row.projectId, row.organizationId, null, { withAi: false });
      if (!result) continue;
      if (result.overallRiskBand !== 'HIGH') continue;
      highRisk += 1;

      const recipients = await db
        .select({ id: users.id })
        .from(users)
        .where(and(
          eq(users.organizationId, row.organizationId),
          sql`${users.role} IN ('ADMIN', 'MANAGER')`,
          eq(users.isActive, true),
        ));
      if (recipients.length === 0) continue;

      const goalLine = result.goals
        .map(g => `${g.certificationType}: ${g.actualPercent.toFixed(1)}% / goal ${g.goalPercent}% (risk ${g.riskScore})`)
        .join('; ');
      const title = `DBE participation HIGH risk on ${result.projectCode}`.substring(0, 250);
      const message = `Overall risk ${result.overallRiskScore}/100. ${goalLine}`.substring(0, 1000);

      await insertNotifications(recipients.map(r => ({
        userId: r.id,
        organizationId: row.organizationId,
        type: 'AI_ALERT' as const,
        title,
        message,
        relatedEntityType: 'projectDbeGoal',
        relatedEntityId: row.projectId,
      })));
    } catch (err) {
      logError('❌ DBE risk computation failed for project', { projectId: row.projectId }, err instanceof Error ? err : new Error(String(err)));
    }
  }
  console.log(`✅ Daily DBE risk job completed — ${projectsWithGoals.length} projects scanned, ${highRisk} high-risk alerts issued`);
}

/**
 * Weekly change order status check
 * Runs every Monday at 8:00 AM to alert managers about stale change orders
 */
async function initializeWeeklyChangeOrderAlerts() {
  console.log('📋 Initializing weekly change order alerts...');
  
  if (weeklyAlertTask) {
    weeklyAlertTask.stop();
  }
  
  // Run every Monday at 8:00 AM EST
  weeklyAlertTask = cron.schedule('0 8 * * 1', async () => {
    try {
      // Task #2427 — leader-only so the weekly alert isn't fanned out.
      await withSchedulerLock('ai:change-order-weekly', async () => {
        console.log('📋 Running weekly change order status check...');
        await checkStaleChangeOrders();
        console.log('✅ Weekly change order check completed');
      });
    } catch (error) {
      logError('❌ Weekly change order check failed:', {}, error instanceof Error ? error : new Error(String(error)));
    }
  }, {
    timezone: 'America/New_York',
  });
  
  console.log('✅ Weekly change order alerts scheduled (Monday 8:00 AM EST)');
}

/**
 * Check for stale change orders and create notifications
 */
async function checkStaleChangeOrders() {
  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
  
  // Get all submitted change orders
  const submittedOrders = await db
    .select({
      id: changeOrders.id,
      changeOrderNumber: changeOrders.changeOrderNumber,
      description: changeOrders.description,
      amount: changeOrders.amount,
      projectId: changeOrders.projectId,
      submittedAt: changeOrders.submittedAt,
      createdAt: changeOrders.createdAt,
      requestedById: changeOrders.requestedById,
    })
    .from(changeOrders)
    .where(eq(changeOrders.status, 'SUBMITTED'));
  
  // Get project info for context
  const projectMap = new Map<string, string>();
  const allProjects = await db
    .select({ id: projects.id, code: projects.code, name: projects.name })
    .from(projects);
  allProjects.forEach(p => projectMap.set(p.id, `${p.code} - ${p.name}`));
  
  // Get admins and managers for notifications
  const adminsAndManagers = await db
    .select({ id: users.id, role: users.role, organizationId: users.organizationId })
    .from(users)
    .where(sql`${users.role} IN ('ADMIN', 'MANAGER') AND ${users.isActive} = true`);
  
  const staleOrders = submittedOrders.filter(co => {
    const checkDate = co.submittedAt ? new Date(co.submittedAt) : new Date(co.createdAt);
    return checkDate < sevenDaysAgo;
  });
  
  if (staleOrders.length === 0) {
    console.log('📋 No stale change orders found');
    return;
  }
  
  console.log(`📋 Found ${staleOrders.length} stale change order(s)`);
  
  // Categorize by severity
  const critical = staleOrders.filter(co => {
    const checkDate = co.submittedAt ? new Date(co.submittedAt) : new Date(co.createdAt);
    return checkDate < fourteenDaysAgo;
  });
  const warning = staleOrders.filter(co => {
    const checkDate = co.submittedAt ? new Date(co.submittedAt) : new Date(co.createdAt);
    return checkDate >= fourteenDaysAgo && checkDate < sevenDaysAgo;
  });
  
  // Create summary notification for managers with safe truncation
  const notificationsToCreate: any[] = [];
  const MAX_TITLE_LENGTH = 250;
  const MAX_MESSAGE_LENGTH = 1000;
  
  for (const manager of adminsAndManagers) {
    // Create summary alert with truncation safety
    let message = `Weekly Change Order Status Report:\n`;
    message += `Total pending client response: ${staleOrders.length}\n`;
    
    if (critical.length > 0) {
      message += `\n⚠️ CRITICAL (>14 days):\n`;
      for (const co of critical) {
        if (message.length > MAX_MESSAGE_LENGTH - 100) {
          message += `... and ${critical.length - critical.indexOf(co)} more critical items\n`;
          break;
        }
        const projectInfo = (projectMap.get(co.projectId) || co.projectId).substring(0, 50);
        const days = Math.floor((now.getTime() - new Date(co.submittedAt || co.createdAt).getTime()) / (1000 * 60 * 60 * 24));
        message += `• ${co.changeOrderNumber} on ${projectInfo}: $${Number(co.amount).toLocaleString()} (${days} days)\n`;
      }
    }
    
    if (warning.length > 0 && message.length < MAX_MESSAGE_LENGTH - 150) {
      message += `\n⏳ Needs Follow-up (7-14 days):\n`;
      for (const co of warning) {
        if (message.length > MAX_MESSAGE_LENGTH - 100) {
          message += `... and ${warning.length - warning.indexOf(co)} more items\n`;
          break;
        }
        const projectInfo = (projectMap.get(co.projectId) || co.projectId).substring(0, 50);
        const days = Math.floor((now.getTime() - new Date(co.submittedAt || co.createdAt).getTime()) / (1000 * 60 * 60 * 24));
        message += `• ${co.changeOrderNumber} on ${projectInfo}: $${Number(co.amount).toLocaleString()} (${days} days)\n`;
      }
    }
    
    // Ensure final truncation safety
    const safeTitle = `Weekly CO Alert: ${staleOrders.length} Pending Client Response`.substring(0, MAX_TITLE_LENGTH);
    const safeMessage = message.substring(0, MAX_MESSAGE_LENGTH);
    
    notificationsToCreate.push({
      userId: manager.id,
      organizationId: manager.organizationId || null,
      type: 'AI_ALERT' as const,
      title: safeTitle,
      message: safeMessage,
      relatedEntityType: 'changeOrderSummary',
    });
  }
  
  if (notificationsToCreate.length > 0) {
    try {
      await insertNotifications(notificationsToCreate);
      console.log(`📋 Created ${notificationsToCreate.length} weekly CO alert notification(s)`);
    } catch (insertError) {
      logError('❌ Failed to insert weekly CO alert notifications:', {}, insertError instanceof Error ? insertError : new Error(String(insertError)));
    }
  }
}

export function stopAIScheduler() {
  if (scheduledTask) {
    scheduledTask.stop();
    scheduledTask = null;
    console.log('⏸️  AI scheduler stopped');
  }
  if (weeklyAlertTask) {
    weeklyAlertTask.stop();
    weeklyAlertTask = null;
    console.log('⏸️  Weekly alert scheduler stopped');
  }
  if (dailyDbeRiskTask) {
    dailyDbeRiskTask.stop();
    dailyDbeRiskTask = null;
    console.log('⏸️  Daily DBE risk scheduler stopped');
  }
}

export async function rescheduleAIRuns() {
  console.log('🔄 Rescheduling AI runs based on updated settings...');
  stopAIScheduler();
  await initializeAIScheduler();
}
