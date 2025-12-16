import { registerModule, runAudit, runQuickAudit, runDbAudit, runApiAudit, runIntegrationsAudit, runAiAudit } from './runner';
import { runSchemaChecks } from './tests/db/schema-checks';
import { runOrphanChecks } from './tests/db/orphan-checks';
import { runTenantIsolationChecks } from './tests/tenant/isolation-checks';
import { runRouteDiscovery } from './tests/api/route-discovery';
import { runApiSecurityChecks } from './tests/api/security-checks';
import { runRBACChecks } from './tests/rbac/role-checks';
import { runIntegrationHealthChecks } from './tests/integrations/health-checks';
import { runAIIsolationChecks } from './tests/ai/isolation-checks';

registerModule({
  name: 'database-schema',
  run: runSchemaChecks,
});

registerModule({
  name: 'database-orphans',
  run: runOrphanChecks,
});

registerModule({
  name: 'tenant-isolation',
  run: runTenantIsolationChecks,
});

registerModule({
  name: 'api-route-discovery',
  run: runRouteDiscovery,
});

registerModule({
  name: 'api-security',
  run: runApiSecurityChecks,
});

registerModule({
  name: 'rbac-verification',
  run: runRBACChecks,
});

registerModule({
  name: 'integration-health',
  run: runIntegrationHealthChecks,
});

registerModule({
  name: 'ai-isolation',
  run: runAIIsolationChecks,
});

async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || 'full';

  console.log(`\n🔧 SmartManageAI Audit Harness`);
  console.log(`Command: ${command}\n`);

  try {
    let report;

    switch (command) {
      case 'quick':
        report = await runQuickAudit();
        break;
      case 'db':
        report = await runDbAudit();
        break;
      case 'api':
        report = await runApiAudit();
        break;
      case 'integrations':
        report = await runIntegrationsAudit();
        break;
      case 'ai':
        report = await runAiAudit();
        break;
      case 'full':
      default:
        report = await runAudit();
        break;
    }

    process.exit(report.summary.failed > 0 ? 1 : 0);
  } catch (error) {
    console.error('Audit failed with error:', error);
    process.exit(1);
  }
}

main();
