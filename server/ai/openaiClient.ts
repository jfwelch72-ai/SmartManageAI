import OpenAI from 'openai';

if (!process.env.OPENAI_API_KEY) {
  console.warn('⚠️ OPENAI_API_KEY not found in environment variables. AI features will not work.');
}

export const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || 'placeholder-key',
});

export const AI_MODEL_GPT4O = 'gpt-4o';
export const AI_MODEL_GPT4_TURBO = 'gpt-4-turbo-preview';

export interface AIAnalysisResponse {
  analysis_summary: string;
  profitability_insights: {
    project_code: string;
    project_name: string;
    status: 'ON_BUDGET' | 'MINOR_CONCERN' | 'MAJOR_RISK';
    budget_variance_percent: number;
    projected_completion_cost: number;
    key_findings: string[];
    recommendations: string[];
  }[];
  tasks: {
    task_type: 'DAILY_TASK' | 'APPROVAL' | 'BILLING' | 'PROCUREMENT' | 'BID' | 'SCHEDULING';
    role: 'ADMIN' | 'MANAGER' | 'SUPERINTENDENT' | 'ESTIMATOR' | 'OFFICE_MANAGER' | 'HOURLY_EMPLOYEE';
    priority: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
    title: string;
    description: string;
    due_date_offset_days: number;
    project_code: string | null;
    metadata: {
      estimated_time_minutes: number;
      related_entity_id?: string | null;
      action_required: string;
    };
  }[];
  crew_scheduling: {
    recommendations: string[];
    understaffed_projects: string[];
    overtime_warnings: string[];
  };
  material_ordering: {
    urgent_orders: {
      project_code: string;
      item_description: string;
      needed_by: string;
      estimated_cost: number;
    }[];
  };
  billing_alerts: {
    overdue_invoices: {
      project_code: string;
      days_overdue: number;
      amount: number;
    }[];
    upcoming_billing_cycles: string[];
  };
  bid_reminders: {
    client_name: string;
    bid_amount: number;
    due_date: string;
    status: string;
    action_needed: string;
  }[];
}

export async function callOpenAIForAnalysis(
  systemPrompt: string,
  userPrompt: string,
  modelName: string = AI_MODEL_GPT4O
): Promise<AIAnalysisResponse> {
  const completion = await openai.chat.completions.create({
    model: modelName,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    response_format: { type: 'json_object' },
    temperature: 0.7,
    max_tokens: 4096,
  });

  const content = completion.choices[0]?.message?.content;
  if (!content) {
    throw new Error('No response from OpenAI');
  }

  try {
    const parsed = JSON.parse(content);
    return parsed as AIAnalysisResponse;
  } catch (error) {
    console.error('Failed to parse OpenAI response:', error);
    console.error('Raw response:', content);
    throw new Error('Invalid JSON response from OpenAI');
  }
}
