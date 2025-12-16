import type { AuditCheck } from '../../types';
import { createCheck, ensureReportDir } from '../../utils/base';
import { writeFileSync, readFileSync, existsSync } from 'fs';

export async function runAIIsolationChecks(): Promise<AuditCheck[]> {
  const checks: AuditCheck[] = [];
  
  try {
    const { db } = await import('../../../server/db');
    const { sql } = await import('drizzle-orm');

    const aiRunsCount = await db.execute(sql`
      SELECT COUNT(*) as count FROM ai_runs
    `);
    const runsCount = Number((aiRunsCount.rows[0] as any)?.count || 0);
    
    checks.push(createCheck(
      'ai-runs-exist',
      'AI runs table accessible',
      'ai-safety',
      'pass',
      {
        message: `Found ${runsCount} AI run records`,
      }
    ));

    const crossOrgTasks = await db.execute(sql`
      SELECT COUNT(*) as count FROM tasks t
      JOIN users u ON t.created_by_id = u.id
      WHERE t.source_type = 'AI_GENERATED'
      AND t.organization_id IS NOT NULL 
      AND u.organization_id IS NOT NULL
      AND t.organization_id != u.organization_id
    `);
    const crossOrgTasksCount = Number((crossOrgTasks.rows[0] as any)?.count || 0);
    
    checks.push(createCheck(
      'ai-generated-tasks-isolation',
      'AI-generated tasks are scoped to creator organization',
      'ai-safety',
      crossOrgTasksCount === 0 ? 'pass' : 'fail',
      {
        message: crossOrgTasksCount === 0 
          ? 'All AI-generated tasks are org-scoped correctly' 
          : `Found ${crossOrgTasksCount} cross-org AI-generated tasks`,
      }
    ));

    const aiRoutesFile = 'server/aiFeatureRoutes.ts';
    let orgContextInjectionFound = false;
    let potentialLeaks: string[] = [];

    if (existsSync(aiRoutesFile)) {
      try {
        const content = readFileSync(aiRoutesFile, 'utf-8');
        
        if (content.includes('organizationId') || content.includes('org_id') || content.includes('getOrgIdForFilter')) {
          orgContextInjectionFound = true;
        }
        
        if (content.includes('SELECT *') && !content.includes('WHERE')) {
          potentialLeaks.push(aiRoutesFile);
        }
      } catch {
      }
    }

    checks.push(createCheck(
      'ai-org-context-injection',
      'AI features have organization context injection',
      'ai-safety',
      orgContextInjectionFound ? 'pass' : 'warn',
      {
        message: orgContextInjectionFound 
          ? 'Organization context found in AI routes' 
          : 'Could not verify organization context injection in AI modules',
      }
    ));

    checks.push(createCheck(
      'ai-no-unscoped-queries',
      'AI modules do not have unscoped database queries',
      'ai-safety',
      potentialLeaks.length === 0 ? 'pass' : 'warn',
      {
        message: potentialLeaks.length === 0 
          ? 'No obvious unscoped queries found' 
          : `Potential unscoped queries in: ${potentialLeaks.join(', ')}`,
      }
    ));

    const hasOpenAIKey = !!process.env.OPENAI_API_KEY || !!process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
    
    checks.push(createCheck(
      'ai-api-key-configured',
      'AI API key is configured',
      'ai-safety',
      hasOpenAIKey ? 'pass' : 'skip',
      {
        message: hasOpenAIKey 
          ? 'OpenAI API key is configured' 
          : 'No OpenAI API key configured - AI features will not work',
      }
    ));

    const aiSummary = {
      timestamp: new Date().toISOString(),
      aiRunsCount: runsCount,
      crossOrgAiTaskCount: crossOrgTasksCount,
      orgContextInjectionVerified: orgContextInjectionFound,
      potentialLeakFiles: potentialLeaks,
      apiKeyConfigured: hasOpenAIKey,
    };

    ensureReportDir();
    writeFileSync('audit/reports/ai-isolation-summary.json', JSON.stringify(aiSummary, null, 2));
    console.log('Generated: audit/reports/ai-isolation-summary.json');

  } catch (error) {
    checks.push(createCheck(
      'ai-isolation-error',
      'AI isolation checks execution',
      'ai-safety',
      'fail',
      {
        message: error instanceof Error ? error.message : String(error),
      }
    ));
  }

  return checks;
}
