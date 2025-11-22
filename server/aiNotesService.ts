import OpenAI from "openai";
import { db } from "./db";
import { 
  projectNotes, 
  companyDailyNotes, 
  aiRuns, 
  aiNoteInsights,
  users,
  projects 
} from "@shared/schema";
import { eq, and, gte, desc, sql } from "drizzle-orm";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

interface NoteForAnalysis {
  id: string;
  text: string;
  createdAt: Date;
  authorName: string;
  projectId: string | null;
  projectName: string | null;
  projectCode: string | null;
  sourceType: "PROJECT" | "COMPANY";
}

interface AIInsight {
  category: "SUPPLY_NEED" | "EQUIPMENT_REPAIR" | "WEATHER_DELAY" | "CHANGE_ORDER" | "SAFETY" | "CLIENT_COMMUNICATION" | "OTHER";
  summary: string;
  recommendedActions: string[];
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  recipients: string[]; // User roles that should be notified
  sourceNoteId: string;
  projectId: string | null;
  sourceType: "PROJECT" | "COMPANY";
}

export class AINotesService {
  /**
   * Fetch recent notes for AI analysis (optimized with joins to avoid N+1 queries)
   */
  private async fetchRecentNotes(sinceDate?: Date): Promise<NoteForAnalysis[]> {
    const cutoffDate = sinceDate || new Date(Date.now() - 24 * 60 * 60 * 1000); // Default: last 24 hours
    
    // Fetch project notes with author and project info in a single query
    const projectNotesData = await db
      .select({
        id: projectNotes.id,
        text: projectNotes.text,
        projectId: projectNotes.projectId,
        createdAt: projectNotes.createdAt,
        authorFirstName: users.firstName,
        authorLastName: users.lastName,
        projectName: projects.name,
        projectCode: projects.code,
      })
      .from(projectNotes)
      .innerJoin(users, eq(projectNotes.authorId, users.id))
      .leftJoin(projects, eq(projectNotes.projectId, projects.id))
      .where(gte(projectNotes.createdAt, cutoffDate))
      .orderBy(desc(projectNotes.createdAt));

    // Fetch company notes with author and project info in a single query
    const companyNotesData = await db
      .select({
        id: companyDailyNotes.id,
        text: companyDailyNotes.text,
        projectId: companyDailyNotes.projectId,
        createdAt: companyDailyNotes.createdAt,
        authorFirstName: users.firstName,
        authorLastName: users.lastName,
        projectName: projects.name,
        projectCode: projects.code,
      })
      .from(companyDailyNotes)
      .innerJoin(users, eq(companyDailyNotes.authorId, users.id))
      .leftJoin(projects, eq(companyDailyNotes.projectId, projects.id))
      .where(gte(companyDailyNotes.createdAt, cutoffDate))
      .orderBy(desc(companyDailyNotes.createdAt));

    // Map project notes
    const projectNotesList: NoteForAnalysis[] = projectNotesData.map(note => ({
      id: note.id,
      text: note.text,
      createdAt: note.createdAt,
      authorName: `${note.authorFirstName} ${note.authorLastName}`,
      projectId: note.projectId,
      projectName: note.projectName || null,
      projectCode: note.projectCode || null,
      sourceType: "PROJECT" as const,
    }));

    // Map company notes
    const companyNotesList: NoteForAnalysis[] = companyNotesData.map(note => ({
      id: note.id,
      text: note.text,
      createdAt: note.createdAt,
      authorName: `${note.authorFirstName} ${note.authorLastName}`,
      projectId: note.projectId || null,
      projectName: note.projectName || null,
      projectCode: note.projectCode || null,
      sourceType: "COMPANY" as const,
    }));

    return [...projectNotesList, ...companyNotesList];
  }

  /**
   * Analyze notes using OpenAI GPT-4
   */
  private async analyzeNotesWithAI(notes: NoteForAnalysis[]): Promise<AIInsight[]> {
    if (notes.length === 0) {
      return [];
    }

    const notesContext = notes.map((note, idx) => 
      `[Note ${idx + 1}]
ID: ${note.id}
Date: ${note.createdAt.toISOString().split('T')[0]}
Author: ${note.authorName}
Project: ${note.projectName ? `${note.projectCode} - ${note.projectName}` : "General/Company-wide"}
Type: ${note.sourceType}
Text: ${note.text}
---`
    ).join('\n\n');

    const systemPrompt = `You are an AI assistant for a construction management company (TFR Construction). Your job is to analyze daily field notes and identify actionable items that require attention from management or specific team members.

Categories to identify:
1. SUPPLY_NEED - Materials or supplies needed (gloves, PPE, lumber, concrete, etc.)
2. EQUIPMENT_REPAIR - Equipment or vehicle repairs needed
3. WEATHER_DELAY - Weather-related delays or concerns
4. CHANGE_ORDER - Potential change order situations (scope changes, client requests, unforeseen conditions)
5. SAFETY - Safety concerns or incidents
6. CLIENT_COMMUNICATION - Items requiring client follow-up or communication
7. OTHER - Other actionable items

Severity levels:
- CRITICAL: Immediate safety issues, work stoppage, urgent client matters
- HIGH: Significant delays, major equipment failures, important client requests
- MEDIUM: Standard supplies needed, routine equipment maintenance, minor delays
- LOW: General observations, minor notes

Recipients (who should be notified):
- ADMIN: For all critical issues, major financial impacts
- MANAGER: For high-priority items, change orders, client communication
- OFFICE_MANAGER: For supply orders, administrative tasks, billing-related items
- SUPERINTENDENT: For field operations, crew management, daily logistics
- ESTIMATOR: For potential change orders, scope clarifications
- HOURLY_EMPLOYEE: Generally not a recipient (field workers report, don't receive)

Analyze each note and extract actionable insights. Return your analysis as a JSON array.`;

    const userPrompt = `Analyze the following construction daily notes and identify actionable items:

${notesContext}

Return a JSON array of insights. Each insight should have:
{
  "sourceNoteId": "the note ID",
  "category": "one of the categories above",
  "summary": "brief summary of the actionable item (max 200 chars)",
  "recommendedActions": ["action 1", "action 2", ...],
  "severity": "LOW | MEDIUM | HIGH | CRITICAL",
  "recipients": ["ROLE1", "ROLE2", ...],
  "reasoning": "brief explanation of why this is actionable"
}

Only include notes that have actionable items. Skip general observations or non-actionable comments.
Return ONLY the JSON array, no additional text.`;

    try {
      const completion = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt }
        ],
        temperature: 0.3,
        response_format: { type: "json_object" }
      });

      const responseText = completion.choices[0]?.message?.content;
      if (!responseText) {
        throw new Error("No response from OpenAI");
      }

      // Parse the response
      const parsed = JSON.parse(responseText);
      const insights = parsed.insights || parsed.items || parsed;
      
      if (!Array.isArray(insights)) {
        console.error("Unexpected AI response format:", parsed);
        return [];
      }

      // Map to our insight format and enrich with project data
      return insights.map((insight: {
        category: string;
        summary: string;
        recommendedActions?: string[];
        severity: string;
        recipients?: string[];
        sourceNoteId: string;
        reasoning?: string;
      }) => {
        const sourceNote = notes.find(n => n.id === insight.sourceNoteId);
        return {
          category: insight.category as AIInsight["category"],
          summary: insight.summary,
          recommendedActions: insight.recommendedActions || [],
          severity: insight.severity as AIInsight["severity"],
          recipients: insight.recipients || [],
          sourceNoteId: insight.sourceNoteId,
          projectId: sourceNote?.projectId || null,
          sourceType: (sourceNote?.sourceType || "COMPANY") as "PROJECT" | "COMPANY",
        };
      });
    } catch (error) {
      console.error("Error analyzing notes with AI:", error);
      throw error;
    }
  }

  /**
   * Store insights in the database (with deduplication)
   */
  private async storeInsights(runId: string, insights: AIInsight[]): Promise<void> {
    for (const insight of insights) {
      // Check if insight already exists for this source note + category (deduplication)
      const existing = await db
        .select({ id: aiNoteInsights.id })
        .from(aiNoteInsights)
        .where(
          and(
            eq(aiNoteInsights.sourceId, insight.sourceNoteId),
            eq(aiNoteInsights.category, insight.category)
          )
        )
        .limit(1);

      // Skip if duplicate
      if (existing.length > 0) {
        console.log(`[AI Notes Service] Skipping duplicate insight for note ${insight.sourceNoteId}, category ${insight.category}`);
        continue;
      }

      // Insert new insight
      await db.insert(aiNoteInsights).values({
        runId,
        sourceType: insight.sourceType,
        sourceId: insight.sourceNoteId,
        projectId: insight.projectId,
        category: insight.category,
        summary: insight.summary,
        recommendedActions: JSON.stringify(insight.recommendedActions),
        severity: insight.severity,
        recipients: JSON.stringify(insight.recipients),
      });
    }
  }

  /**
   * Run AI analysis on recent notes
   */
  async analyzeRecentNotes(triggeredById?: string, sinceDate?: Date): Promise<{
    runId: string;
    insightsCount: number;
    insights: AIInsight[];
  }> {
    // Create AI run record
    const [run] = await db.insert(aiRuns).values({
      runType: "notes_analysis",
      status: "in_progress",
      triggeredById: triggeredById || null,
    }).returning();

    try {
      // Fetch recent notes
      const notes = await this.fetchRecentNotes(sinceDate);
      
      if (notes.length === 0) {
        await db.update(aiRuns)
          .set({ 
            status: "completed", 
            completedAt: new Date(),
            aiResponse: JSON.stringify({ message: "No recent notes to analyze" })
          })
          .where(eq(aiRuns.id, run.id));
        
        return {
          runId: run.id,
          insightsCount: 0,
          insights: [],
        };
      }

      // Analyze with AI
      const insights = await this.analyzeNotesWithAI(notes);

      // Store insights
      await this.storeInsights(run.id, insights);

      // Update run status
      await db.update(aiRuns)
        .set({ 
          status: "completed", 
          completedAt: new Date(),
          snapshotData: JSON.stringify({ notesAnalyzed: notes.length }),
          aiResponse: JSON.stringify({ insightsGenerated: insights.length })
        })
        .where(eq(aiRuns.id, run.id));

      return {
        runId: run.id,
        insightsCount: insights.length,
        insights,
      };
    } catch (error) {
      // Update run with error
      await db.update(aiRuns)
        .set({ 
          status: "error",
          errorMessage: error instanceof Error ? error.message : "Unknown error",
          completedAt: new Date(),
        })
        .where(eq(aiRuns.id, run.id));

      throw error;
    }
  }

  /**
   * Get insights for a specific project (filtered by user role for RBAC)
   */
  async getProjectInsights(projectId: string, limit = 50, userRole?: string): Promise<any[]> {
    const insights = await db
      .select({
        id: aiNoteInsights.id,
        category: aiNoteInsights.category,
        summary: aiNoteInsights.summary,
        recommendedActions: aiNoteInsights.recommendedActions,
        severity: aiNoteInsights.severity,
        recipients: aiNoteInsights.recipients,
        sourceType: aiNoteInsights.sourceType,
        sourceId: aiNoteInsights.sourceId,
        createdAt: aiNoteInsights.createdAt,
        runId: aiNoteInsights.runId,
      })
      .from(aiNoteInsights)
      .where(eq(aiNoteInsights.projectId, projectId))
      .orderBy(desc(aiNoteInsights.createdAt))
      .limit(limit * 2); // Fetch more to filter

    let parsedInsights = insights.map(insight => ({
      ...insight,
      recommendedActions: JSON.parse(insight.recommendedActions || "[]"),
      recipients: JSON.parse(insight.recipients || "[]"),
    }));

    // Filter by user role if provided (RBAC)
    if (userRole && !["ADMIN", "MANAGER"].includes(userRole)) {
      parsedInsights = parsedInsights.filter(insight => 
        insight.recipients.includes(userRole)
      );
    }

    return parsedInsights.slice(0, limit);
  }

  /**
   * Get all recent insights (company-wide, filtered by user role for RBAC)
   */
  async getAllInsights(limit = 100, userRole?: string): Promise<any[]> {
    const insights = await db
      .select({
        id: aiNoteInsights.id,
        category: aiNoteInsights.category,
        summary: aiNoteInsights.summary,
        recommendedActions: aiNoteInsights.recommendedActions,
        severity: aiNoteInsights.severity,
        recipients: aiNoteInsights.recipients,
        sourceType: aiNoteInsights.sourceType,
        sourceId: aiNoteInsights.sourceId,
        projectId: aiNoteInsights.projectId,
        createdAt: aiNoteInsights.createdAt,
        runId: aiNoteInsights.runId,
      })
      .from(aiNoteInsights)
      .orderBy(desc(aiNoteInsights.createdAt))
      .limit(limit * 2); // Fetch more to filter

    // Enrich with project details
    let enrichedInsights = await Promise.all(
      insights.map(async (insight) => {
        let projectInfo = null;
        if (insight.projectId) {
          const project = await db
            .select({ code: projects.code, name: projects.name })
            .from(projects)
            .where(eq(projects.id, insight.projectId))
            .limit(1);
          projectInfo = project[0] || null;
        }

        const recipientsList = JSON.parse(insight.recipients || "[]");
        return {
          ...insight,
          recommendedActions: JSON.parse(insight.recommendedActions || "[]"),
          recipients: recipientsList,
          project: projectInfo,
        };
      })
    );

    // Filter by user role if provided (RBAC)
    if (userRole && !["ADMIN", "MANAGER"].includes(userRole)) {
      enrichedInsights = enrichedInsights.filter(insight => 
        insight.recipients.includes(userRole)
      );
    }

    return enrichedInsights.slice(0, limit);
  }

  /**
   * Get insights relevant to a specific user role
   */
  async getInsightsForRole(role: string, limit = 50): Promise<any[]> {
    const allInsights = await this.getAllInsights(limit * 2); // Fetch more to filter
    
    return allInsights
      .filter(insight => insight.recipients.includes(role))
      .slice(0, limit);
  }
}

export const aiNotesService = new AINotesService();
