import { execSync } from 'child_process';
import { existsSync, mkdirSync } from 'fs';
import type { AuditCheck, AuditReport, AuditCategory } from '../types';

export function getGitCommit(): string {
  try {
    return execSync('git rev-parse HEAD').toString().trim().substring(0, 8);
  } catch {
    return 'unknown';
  }
}

export function getEnvironment(): string {
  return process.env.NODE_ENV || 'development';
}

export function ensureReportDir(): void {
  const reportDir = 'audit/reports';
  if (!existsSync(reportDir)) {
    mkdirSync(reportDir, { recursive: true });
  }
}

export function createCheck(
  id: string,
  name: string,
  category: AuditCategory,
  status: 'pass' | 'fail' | 'skip' | 'warn',
  options?: Partial<AuditCheck>
): AuditCheck {
  return {
    id,
    name,
    category,
    status,
    ...options,
  };
}

export function aggregateResults(checks: AuditCheck[]): AuditReport {
  const now = new Date();
  const categories: AuditReport['categories'] = {};

  for (const check of checks) {
    if (!categories[check.category]) {
      categories[check.category] = { passed: 0, failed: 0, skipped: 0, warnings: 0 };
    }
    switch (check.status) {
      case 'pass':
        categories[check.category]!.passed++;
        break;
      case 'fail':
        categories[check.category]!.failed++;
        break;
      case 'skip':
        categories[check.category]!.skipped++;
        break;
      case 'warn':
        categories[check.category]!.warnings++;
        break;
    }
  }

  return {
    timestamp: now.toISOString(),
    gitCommit: getGitCommit(),
    environment: getEnvironment(),
    summary: {
      total: checks.length,
      passed: checks.filter(c => c.status === 'pass').length,
      failed: checks.filter(c => c.status === 'fail').length,
      skipped: checks.filter(c => c.status === 'skip').length,
      warnings: checks.filter(c => c.status === 'warn').length,
    },
    categories,
    checks,
    duration: 0,
  };
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(2)}s`;
  return `${Math.floor(ms / 60000)}m ${((ms % 60000) / 1000).toFixed(0)}s`;
}

export function printSummary(report: AuditReport): void {
  console.log('\n' + '='.repeat(60));
  console.log('AUDIT SUMMARY');
  console.log('='.repeat(60));
  console.log(`Timestamp: ${report.timestamp}`);
  console.log(`Git Commit: ${report.gitCommit}`);
  console.log(`Environment: ${report.environment}`);
  console.log(`Duration: ${formatDuration(report.duration)}`);
  console.log('');
  console.log(`Total Checks: ${report.summary.total}`);
  console.log(`  Passed:   ${report.summary.passed}`);
  console.log(`  Failed:   ${report.summary.failed}`);
  console.log(`  Warnings: ${report.summary.warnings}`);
  console.log(`  Skipped:  ${report.summary.skipped}`);
  console.log('');

  console.log('By Category:');
  for (const [category, stats] of Object.entries(report.categories)) {
    const emoji = stats!.failed > 0 ? '❌' : stats!.warnings > 0 ? '⚠️' : '✅';
    console.log(`  ${emoji} ${category}: ${stats!.passed}/${stats!.passed + stats!.failed} passed`);
  }

  if (report.summary.failed > 0) {
    console.log('\n' + '='.repeat(60));
    console.log('FAILED CHECKS:');
    console.log('='.repeat(60));
    for (const check of report.checks.filter(c => c.status === 'fail')) {
      console.log(`\n❌ [${check.category}] ${check.name}`);
      if (check.message) console.log(`   Message: ${check.message}`);
      if (check.file) console.log(`   File: ${check.file}${check.line ? `:${check.line}` : ''}`);
      if (check.reproductionSteps?.length) {
        console.log('   Reproduction Steps:');
        check.reproductionSteps.forEach((step, i) => console.log(`     ${i + 1}. ${step}`));
      }
    }
  }

  console.log('\n' + '='.repeat(60));
  const overallStatus = report.summary.failed === 0 ? 'PASS' : 'FAIL';
  console.log(`OVERALL RESULT: ${overallStatus}`);
  console.log('='.repeat(60) + '\n');
}
