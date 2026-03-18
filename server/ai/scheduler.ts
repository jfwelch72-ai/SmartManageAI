import * as cron from 'node-cron';
import { db } from "../db";
import { aiSettings, changeOrders, projects, users, notifications } from "@shared/schema";
import { runAIAnalysis } from "./orchestrator";
import { sql, eq } from 'drizzle-orm';
import { insertNotifications } from "../services/notificationService";

let scheduledTask: cron.ScheduledTask | null = null;
let weeklyAlertTask: cron.ScheduledTask | null = null;

export async function initializeAIScheduler() {
  console.log('🤖 Initializing AI PM + CFO scheduler...');

  // Get or create AI settings
  let [settings] = await db.select().from(aiSettings).limit(1);

  if (!settings) {
    console.log('📝 Creating default AI settings...');
    [settings] = await db.insert(aiSettings).values({}).returning();
  }

  if (!settings.dailyRunsEnabled) {
    console.log('⏸️  Daily AI runs are disabled in settings');
    return;
  }

  const [hour, minute] = settings.dailyRunTime.split(':').map(Number);

  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    console.error('❌ Invalid daily run time in settings:', settings.dailyRunTime);
    return;
  }

  const cronExpression = `${minute} ${hour} * * *`;

  console.log(`⏰ Scheduling daily AI runs at ${settings.dailyRunTime} (${cronExpression})`);

  if (scheduledTask) {
    scheduledTask.stop();
  }

  scheduledTask = cron.schedule(cronExpression, async () => {
    console.log('🚀 Triggering scheduled AI PM + CFO analysis...');
    
    try {
      await runAIAnalysis(null);
      console.log('✅ Scheduled AI analysis completed successfully');
    } catch (error) {
      console.error('❌ Scheduled AI analysis failed:', error);
    }
  }, {
    timezone: 'America/New_York',
  });

  console.log('✅ AI scheduler initialized successfully');
  
  // Initialize weekly change order alert (every Monday at 8:00 AM)
  await initializeWeeklyChangeOrderAlerts();
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
    console.log('📋 Running weekly change order status check...');
    
    try {
      await checkStaleChangeOrders();
      console.log('✅ Weekly change order check completed');
    } catch (error) {
      console.error('❌ Weekly change order check failed:', error);
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
    .select({ id: users.id, role: users.role })
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
      console.error('❌ Failed to insert weekly CO alert notifications:', insertError);
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
}

export async function rescheduleAIRuns() {
  console.log('🔄 Rescheduling AI runs based on updated settings...');
  stopAIScheduler();
  await initializeAIScheduler();
}
