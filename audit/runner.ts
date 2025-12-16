import type { AuditCheck, AuditReport } from './types';
import { aggregateResults, printSummary } from './utils/base';
import { generateAllReports } from './utils/report-generator';

export type AuditModule = {
  name: string;
  run: () => Promise<AuditCheck[]>;
};

const registeredModules: AuditModule[] = [];

export function registerModule(module: AuditModule): void {
  registeredModules.push(module);
}

export async function runAudit(
  options: {
    categories?: string[];
    quick?: boolean;
    generateReports?: boolean;
  } = {}
): Promise<AuditReport> {
  const startTime = Date.now();
  const allChecks: AuditCheck[] = [];

  console.log('\n🔍 SmartManageAI Platform Audit');
  console.log('='.repeat(60));

  const modulesToRun = options.categories 
    ? registeredModules.filter(m => options.categories!.some(c => m.name.includes(c)))
    : registeredModules;

  for (const module of modulesToRun) {
    console.log(`\n📋 Running: ${module.name}`);
    try {
      const checks = await module.run();
      allChecks.push(...checks);
      const passed = checks.filter(c => c.status === 'pass').length;
      const failed = checks.filter(c => c.status === 'fail').length;
      console.log(`   ${passed} passed, ${failed} failed`);
    } catch (error) {
      console.error(`   ❌ Module failed with error:`, error);
      allChecks.push({
        id: `${module.name}-error`,
        name: `${module.name} execution`,
        category: 'observability',
        status: 'fail',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const report = aggregateResults(allChecks);
  report.duration = Date.now() - startTime;

  printSummary(report);

  if (options.generateReports !== false) {
    generateAllReports(report);
  }

  return report;
}

export async function runQuickAudit(): Promise<AuditReport> {
  return runAudit({
    categories: ['tenant', 'rbac', 'api'],
    quick: true,
  });
}

export async function runDbAudit(): Promise<AuditReport> {
  return runAudit({
    categories: ['database'],
  });
}

export async function runApiAudit(): Promise<AuditReport> {
  return runAudit({
    categories: ['api', 'route'],
  });
}

export async function runUiAudit(): Promise<AuditReport> {
  return runAudit({
    categories: ['ui'],
  });
}

export async function runIntegrationsAudit(): Promise<AuditReport> {
  return runAudit({
    categories: ['integration'],
  });
}

export async function runAiAudit(): Promise<AuditReport> {
  return runAudit({
    categories: ['ai'],
  });
}
