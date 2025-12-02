import { openai, AI_MODEL_GPT4O } from './openaiClient';
import { db } from '../db';
import { 
  emailMessages, 
  emailThreads, 
  emailTasks,
  projects,
  bids,
  crmOrganisations,
  type EmailMessage,
  type EmailThread,
  emailClassificationEnum
} from '@shared/schema';
import { eq, and, ilike, or, desc, sql } from 'drizzle-orm';

// Email classification categories
export const EMAIL_CLASSIFICATIONS = emailClassificationEnum.enumValues;

export type EmailClassification = typeof EMAIL_CLASSIFICATIONS[number];

// AI response types
export interface EmailAnalysisResult {
  classification: EmailClassification;
  confidence: number;
  summary: string;
  extractedEntities: {
    projectCode?: string;
    projectName?: string;
    bidNumber?: string;
    vendorName?: string;
    clientName?: string;
    deadlines?: string[];
    amounts?: string[];
    requestedActions?: string[];
  };
  suggestedPriority: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  suggestedTaskTitle?: string;
  suggestedTaskDescription?: string;
  requiresResponse: boolean;
}

export interface ThreadSummaryResult {
  summary: string;
  keyPoints: string[];
  actionItems: string[];
  participants: string[];
  latestDeadline?: string;
  overallSentiment: 'POSITIVE' | 'NEUTRAL' | 'NEGATIVE' | 'URGENT';
}

export interface ReplyDraft {
  tone: 'professional' | 'casual' | 'firm';
  subject: string;
  body: string;
}

export interface EmailSummaryDigest {
  periodDescription: string;
  totalEmails: number;
  byClassification: Record<string, number>;
  highlights: {
    title: string;
    description: string;
    priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
    threadId?: string;
  }[];
  actionNeeded: {
    title: string;
    description: string;
    dueDate?: string;
  }[];
  summaryNarrative: string;
}

// System prompts
const EMAIL_CLASSIFICATION_PROMPT = `You are an expert construction project management AI assistant. 
Your task is to analyze incoming emails and classify them into categories relevant to construction project management.

Classification categories:
- PROJECT_UPDATE: General project status updates, progress reports
- BID_INVITE: Invitations to bid on new projects
- BID_RFI: Requests for information related to bids
- CHANGE_ORDER_REQUEST: Requests for change orders or scope changes
- SUBMITTAL_REQUEST: Requests for submittals, shop drawings, samples
- PAY_APP: Payment applications, invoices, billing
- INVOICE: Vendor invoices, bills
- DELAY_NOTICE: Notifications about project delays
- SAFETY_ISSUE: Safety concerns, incidents, violations
- DELIVERY_NOTICE: Material/equipment delivery notifications
- TIME_CLOCK_ISSUE: Time tracking, scheduling issues
- VENDOR_PRICING: Vendor quotes, pricing updates
- GENERAL_COMMUNICATION: General correspondence
- SPAM_OR_IRRELEVANT: Spam or non-work related
- OTHER: Doesn't fit other categories

Also extract:
- Project codes/names if mentioned
- Bid numbers if mentioned
- Vendor/company names
- Due dates and deadlines
- Dollar amounts
- Specific action items requested
- Whether a response is required

Respond in JSON format.`;

const THREAD_SUMMARY_PROMPT = `You are an expert construction project management AI assistant.
Summarize the following email thread, focusing on:
- Key discussion points
- Action items and their owners
- Important deadlines
- Overall sentiment and urgency
- Participants and their roles

Respond in JSON format with summary, keyPoints, actionItems, participants, latestDeadline, and overallSentiment fields.`;

const REPLY_SUGGESTION_PROMPT = `You are a professional construction project manager assistant.
Generate a reply draft for the following email. 
Maintain a {tone} tone.
Be concise, professional, and action-oriented.
If specific information is needed to respond, indicate placeholders.

Respond in JSON format with subject and body fields.`;

const DAILY_SUMMARY_PROMPT = `You are an expert construction project management AI assistant.
Create a daily email digest summary for a construction project manager.
Focus on:
- Most important emails requiring attention
- Urgent items (delays, safety issues, deadlines)
- Bid opportunities
- Change order requests
- Payment/billing items

Provide a clear, actionable summary that helps prioritize the day.
Respond in JSON format.`;

/**
 * Analyze a single email message using AI
 */
export async function analyzeEmail(
  emailSubject: string,
  emailBody: string,
  fromAddress: string,
  organizationId: string
): Promise<EmailAnalysisResult> {
  const userPrompt = `Analyze this email:

From: ${fromAddress}
Subject: ${emailSubject}

Body:
${emailBody?.substring(0, 4000) || '(No body content)'} 

Return JSON with:
{
  "classification": "one of the classification categories",
  "confidence": 0.0-1.0,
  "summary": "brief summary",
  "extractedEntities": {
    "projectCode": "if found",
    "projectName": "if found", 
    "bidNumber": "if found",
    "vendorName": "if found",
    "clientName": "if found",
    "deadlines": ["array of dates"],
    "amounts": ["array of dollar amounts"],
    "requestedActions": ["array of action items"]
  },
  "suggestedPriority": "LOW|MEDIUM|HIGH|CRITICAL",
  "suggestedTaskTitle": "if action needed",
  "suggestedTaskDescription": "task description if needed",
  "requiresResponse": true/false
}`;

  try {
    const completion = await openai.chat.completions.create({
      model: AI_MODEL_GPT4O,
      messages: [
        { role: 'system', content: EMAIL_CLASSIFICATION_PROMPT },
        { role: 'user', content: userPrompt }
      ],
      response_format: { type: 'json_object' },
      temperature: 0.3,
      max_tokens: 1000,
    });

    const content = completion.choices[0]?.message?.content;
    if (!content) {
      throw new Error('No response from OpenAI');
    }

    const result = JSON.parse(content) as EmailAnalysisResult;
    
    // Validate classification is valid
    if (!EMAIL_CLASSIFICATIONS.includes(result.classification as EmailClassification)) {
      result.classification = 'OTHER';
    }

    return result;
  } catch (error) {
    console.error('Email analysis failed:', error);
    // Return default result on error
    return {
      classification: 'OTHER',
      confidence: 0,
      summary: 'Analysis failed',
      extractedEntities: {},
      suggestedPriority: 'MEDIUM',
      requiresResponse: false,
    };
  }
}

/**
 * Generate a summary for an email thread
 */
export async function summarizeThread(
  messages: Array<{ fromAddress: string; fromName?: string; subject: string; bodyText?: string; receivedAt: Date }>
): Promise<ThreadSummaryResult> {
  const threadContent = messages
    .map((m, i) => `[Message ${i + 1}] From: ${m.fromName || m.fromAddress}
Date: ${m.receivedAt.toISOString()}
Subject: ${m.subject}

${m.bodyText?.substring(0, 1500) || '(No content)'}
---`)
    .join('\n\n');

  try {
    const completion = await openai.chat.completions.create({
      model: AI_MODEL_GPT4O,
      messages: [
        { role: 'system', content: THREAD_SUMMARY_PROMPT },
        { role: 'user', content: `Summarize this email thread:\n\n${threadContent.substring(0, 8000)}` }
      ],
      response_format: { type: 'json_object' },
      temperature: 0.4,
      max_tokens: 1000,
    });

    const content = completion.choices[0]?.message?.content;
    if (!content) {
      throw new Error('No response from OpenAI');
    }

    return JSON.parse(content) as ThreadSummaryResult;
  } catch (error) {
    console.error('Thread summary failed:', error);
    return {
      summary: 'Unable to generate summary',
      keyPoints: [],
      actionItems: [],
      participants: messages.map(m => m.fromAddress),
      overallSentiment: 'NEUTRAL',
    };
  }
}

/**
 * Generate reply suggestions for an email
 */
export async function suggestReplies(
  originalEmail: { subject: string; body: string; fromAddress: string },
  tones: Array<'professional' | 'casual' | 'firm'> = ['professional']
): Promise<ReplyDraft[]> {
  const drafts: ReplyDraft[] = [];

  for (const tone of tones) {
    try {
      const prompt = REPLY_SUGGESTION_PROMPT.replace('{tone}', tone);
      
      const completion = await openai.chat.completions.create({
        model: AI_MODEL_GPT4O,
        messages: [
          { role: 'system', content: prompt },
          { role: 'user', content: `Generate a ${tone} reply to this email:

From: ${originalEmail.fromAddress}
Subject: ${originalEmail.subject}

Body:
${originalEmail.body?.substring(0, 3000) || '(No content)'}

Return JSON with subject and body fields.` }
        ],
        response_format: { type: 'json_object' },
        temperature: 0.6,
        max_tokens: 800,
      });

      const content = completion.choices[0]?.message?.content;
      if (content) {
        const parsed = JSON.parse(content);
        drafts.push({
          tone,
          subject: parsed.subject || `Re: ${originalEmail.subject}`,
          body: parsed.body || '',
        });
      }
    } catch (error) {
      console.error(`Failed to generate ${tone} reply:`, error);
    }
  }

  return drafts;
}

/**
 * Generate a daily or weekly email summary
 */
export async function generateEmailSummary(
  emails: Array<{ 
    classification?: string; 
    subject: string; 
    fromAddress: string;
    snippet?: string;
    threadId: string;
    receivedAt: Date;
  }>,
  periodType: 'DAILY' | 'WEEKLY'
): Promise<EmailSummaryDigest> {
  // Count by classification
  const byClassification: Record<string, number> = {};
  for (const email of emails) {
    const cls = email.classification || 'UNCLASSIFIED';
    byClassification[cls] = (byClassification[cls] || 0) + 1;
  }

  // Build email list for AI
  const emailList = emails
    .slice(0, 50) // Limit for context
    .map((e, i) => `${i + 1}. [${e.classification || 'UNCLASSIFIED'}] From: ${e.fromAddress}
Subject: ${e.subject}
Preview: ${e.snippet?.substring(0, 100) || 'N/A'}
Date: ${e.receivedAt.toISOString()}`)
    .join('\n\n');

  try {
    const completion = await openai.chat.completions.create({
      model: AI_MODEL_GPT4O,
      messages: [
        { role: 'system', content: DAILY_SUMMARY_PROMPT },
        { role: 'user', content: `Create a ${periodType.toLowerCase()} email summary for these ${emails.length} emails:

${emailList}

Classification breakdown: ${JSON.stringify(byClassification)}

Return JSON with:
{
  "highlights": [{"title": "...", "description": "...", "priority": "HIGH"}],
  "actionNeeded": [{"title": "...", "description": "...", "dueDate": "..."}],
  "summaryNarrative": "A paragraph summary of the period"
}` }
        ],
        response_format: { type: 'json_object' },
        temperature: 0.5,
        max_tokens: 1500,
      });

    const content = completion.choices[0]?.message?.content;
    if (!content) {
      throw new Error('No response from OpenAI');
    }

    const parsed = JSON.parse(content);
    
    return {
      periodDescription: periodType === 'DAILY' ? 'Last 24 hours' : 'Last 7 days',
      totalEmails: emails.length,
      byClassification,
      highlights: parsed.highlights || [],
      actionNeeded: parsed.actionNeeded || [],
      summaryNarrative: parsed.summaryNarrative || 'No summary available.',
    };
  } catch (error) {
    console.error('Summary generation failed:', error);
    return {
      periodDescription: periodType === 'DAILY' ? 'Last 24 hours' : 'Last 7 days',
      totalEmails: emails.length,
      byClassification,
      highlights: [],
      actionNeeded: [],
      summaryNarrative: 'Unable to generate summary.',
    };
  }
}

/**
 * Try to match email content to existing projects/bids/vendors
 */
export async function matchEmailToEntities(
  analysis: EmailAnalysisResult,
  organizationId: string
): Promise<{
  projectId?: string;
  bidId?: string;
  vendorId?: string;
}> {
  const result: { projectId?: string; bidId?: string; vendorId?: string } = {};

  // Try to match project by code or name
  if (analysis.extractedEntities.projectCode || analysis.extractedEntities.projectName) {
    const searchTerm = analysis.extractedEntities.projectCode || analysis.extractedEntities.projectName;
    
    const [project] = await db
      .select({ id: projects.id })
      .from(projects)
      .where(
        and(
          eq(projects.gcOrganizationId, organizationId),
          or(
            ilike(projects.code, `%${searchTerm}%`),
            ilike(projects.name, `%${searchTerm}%`)
          )
        )
      )
      .limit(1);

    if (project) {
      result.projectId = project.id;
    }
  }

  // Try to match bid
  if (analysis.extractedEntities.bidNumber) {
    const [bid] = await db
      .select({ id: bids.id })
      .from(bids)
      .where(
        and(
          eq(bids.gcOrganizationId, organizationId),
          ilike(bids.code, `%${analysis.extractedEntities.bidNumber}%`)
        )
      )
      .limit(1);

    if (bid) {
      result.bidId = bid.id;
    }
  }

  // Try to match vendor
  if (analysis.extractedEntities.vendorName) {
    const [vendor] = await db
      .select({ id: crmOrganisations.id })
      .from(crmOrganisations)
      .where(
        and(
          eq(crmOrganisations.organizationId, organizationId),
          ilike(crmOrganisations.name, `%${analysis.extractedEntities.vendorName}%`)
        )
      )
      .limit(1);

    if (vendor) {
      result.vendorId = vendor.id;
    }
  }

  return result;
}

/**
 * Create a task from email analysis
 */
export async function createTaskFromEmail(
  analysis: EmailAnalysisResult,
  messageId: string,
  threadId: string,
  organizationId: string,
  createdByUserId: string,
  matchedEntities: { projectId?: string; bidId?: string; vendorId?: string }
): Promise<string | null> {
  // Only create task if there's something actionable
  if (!analysis.suggestedTaskTitle || !analysis.requiresResponse) {
    return null;
  }

  // Map classification to priority if not set
  const priorityMap: Record<string, 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'> = {
    'SAFETY_ISSUE': 'CRITICAL',
    'DELAY_NOTICE': 'HIGH',
    'CHANGE_ORDER_REQUEST': 'HIGH',
    'PAY_APP': 'HIGH',
    'BID_INVITE': 'MEDIUM',
    'SUBMITTAL_REQUEST': 'MEDIUM',
  };

  const priority = analysis.suggestedPriority || 
    priorityMap[analysis.classification] || 
    'MEDIUM';

  // Parse due date if present
  let dueDate: Date | undefined;
  if (analysis.extractedEntities.deadlines?.length) {
    try {
      const firstDeadline = analysis.extractedEntities.deadlines[0];
      dueDate = new Date(firstDeadline);
      if (isNaN(dueDate.getTime())) {
        dueDate = undefined;
      }
    } catch {
      // Ignore parsing errors
    }
  }

  const [task] = await db
    .insert(emailTasks)
    .values({
      organizationId,
      createdByUserId,
      title: analysis.suggestedTaskTitle.substring(0, 200),
      description: analysis.suggestedTaskDescription?.substring(0, 2000),
      status: 'PENDING',
      priority,
      dueDate,
      sourceType: 'AI_GENERATED',
      emailThreadId: threadId,
      emailMessageId: messageId,
      projectId: matchedEntities.projectId,
      bidId: matchedEntities.bidId,
      vendorId: matchedEntities.vendorId,
      aiMetadata: JSON.stringify({
        classification: analysis.classification,
        confidence: analysis.confidence,
        extractedEntities: analysis.extractedEntities,
      }),
    })
    .returning({ id: emailTasks.id });

  return task?.id || null;
}
