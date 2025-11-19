import cron from 'node-cron';
import { db } from "../db";
import { aiSettings } from "@shared/schema";
import { runAIAnalysis } from "./orchestrator";

let scheduledTask: cron.ScheduledTask | null = null;

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
}

export function stopAIScheduler() {
  if (scheduledTask) {
    scheduledTask.stop();
    scheduledTask = null;
    console.log('⏸️  AI scheduler stopped');
  }
}

export async function rescheduleAIRuns() {
  console.log('🔄 Rescheduling AI runs based on updated settings...');
  stopAIScheduler();
  await initializeAIScheduler();
}
