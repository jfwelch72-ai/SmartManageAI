import { logError } from "./utils/logger";
import * as cron from "node-cron";
import { aiNotesService } from "./aiNotesService";
import { withSchedulerLock } from "./utils/schedulerLock";

/**
 * AI Notes Scheduler
 * Automatically analyzes recent notes on a schedule
 */
export class AINotesScheduler {
  private dailyTask: ReturnType<typeof cron.schedule> | null = null;
  private hourlyTask: ReturnType<typeof cron.schedule> | null = null;

  /**
   * Start the scheduler
   * - Hourly: Analyze notes from last 2 hours (catches recent urgent items)
   * - Daily: Analyze notes from last 24 hours (comprehensive daily analysis)
   */
  start() {
    console.log("[AI Notes Scheduler] Starting automated note analysis...");

    // Run hourly at :00 minutes
    // Analyzes notes from the last 2 hours to catch urgent items quickly
    this.hourlyTask = cron.schedule("0 * * * *", async () => {
      try {
        // Task #2427 — only the leader replica runs the work; peers
        // observe `ran=false` and skip silently.
        await withSchedulerLock("ai-notes:hourly", async () => {
          console.log("[AI Notes Scheduler] Running hourly note analysis...");
          const cutoffDate = new Date(Date.now() - 2 * 60 * 60 * 1000); // Last 2 hours
          const result = await aiNotesService.analyzeRecentNotes(undefined, cutoffDate);
          console.log(`[AI Notes Scheduler] Hourly analysis complete: ${result.insightsCount} insights generated`);
        });
      } catch (error) {
        logError("[AI Notes Scheduler] Hourly analysis failed:", {}, error instanceof Error ? error : new Error(String(error)));
      }
    });

    // Run daily at 6 PM (18:00)
    // Comprehensive analysis of the day's notes
    this.dailyTask = cron.schedule("0 18 * * *", async () => {
      try {
        await withSchedulerLock("ai-notes:daily", async () => {
          console.log("[AI Notes Scheduler] Running daily note analysis...");
          const cutoffDate = new Date(Date.now() - 24 * 60 * 60 * 1000); // Last 24 hours
          const result = await aiNotesService.analyzeRecentNotes(undefined, cutoffDate);
          console.log(`[AI Notes Scheduler] Daily analysis complete: ${result.insightsCount} insights generated`);
        });
      } catch (error) {
        logError("[AI Notes Scheduler] Daily analysis failed:", {}, error instanceof Error ? error : new Error(String(error)));
      }
    });

    console.log("[AI Notes Scheduler] Scheduled tasks:");
    console.log("  - Hourly analysis: Every hour at :00 (analyzes last 2 hours)");
    console.log("  - Daily analysis: Every day at 6:00 PM (analyzes last 24 hours)");
  }

  /**
   * Stop the scheduler
   */
  stop() {
    if (this.hourlyTask) {
      this.hourlyTask.stop();
      this.hourlyTask = null;
    }
    if (this.dailyTask) {
      this.dailyTask.stop();
      this.dailyTask = null;
    }
    console.log("[AI Notes Scheduler] Stopped automated note analysis");
  }

  /**
   * Run an immediate analysis (useful for testing or manual trigger)
   */
  async runNow(hoursBack = 24): Promise<void> {
    console.log(`[AI Notes Scheduler] Running immediate analysis (last ${hoursBack} hours)...`);
    const cutoffDate = new Date(Date.now() - hoursBack * 60 * 60 * 1000);
    const result = await aiNotesService.analyzeRecentNotes(undefined, cutoffDate);
    console.log(`[AI Notes Scheduler] Immediate analysis complete: ${result.insightsCount} insights generated`);
  }
}

// Export singleton instance
export const aiNotesScheduler = new AINotesScheduler();
