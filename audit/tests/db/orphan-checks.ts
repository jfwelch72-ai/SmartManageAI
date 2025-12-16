import type { AuditCheck } from '../../types';
import { createCheck } from '../../utils/base';

export async function runOrphanChecks(): Promise<AuditCheck[]> {
  const checks: AuditCheck[] = [];
  
  try {
    const { db } = await import('../../../server/db');
    const { sql } = await import('drizzle-orm');

    const orphanedProjects = await db.execute(sql`
      SELECT COUNT(*) as count FROM projects p
      WHERE p.gc_organization_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM organizations o WHERE o.id = p.gc_organization_id)
    `);
    const orphanedCount = Number((orphanedProjects.rows[0] as any)?.count || 0);
    
    checks.push(createCheck(
      'orphan-projects',
      'No orphaned projects (missing organization)',
      'database',
      orphanedCount === 0 ? 'pass' : 'fail',
      {
        message: orphanedCount === 0 
          ? 'All projects have valid organization references' 
          : `Found ${orphanedCount} orphaned projects`,
      }
    ));

    const orphanedUsers = await db.execute(sql`
      SELECT COUNT(*) as count FROM users u
      WHERE u.organization_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM organizations o WHERE o.id = u.organization_id)
    `);
    const orphanedUsersCount = Number((orphanedUsers.rows[0] as any)?.count || 0);
    
    checks.push(createCheck(
      'orphan-users',
      'No orphaned users (missing organization)',
      'database',
      orphanedUsersCount === 0 ? 'pass' : 'warn',
      {
        message: orphanedUsersCount === 0 
          ? 'All users with org assignment have valid references' 
          : `Found ${orphanedUsersCount} users with invalid organization references`,
      }
    ));

    const orphanedBids = await db.execute(sql`
      SELECT COUNT(*) as count FROM bids b
      WHERE b.gc_organization_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM organizations o WHERE o.id = b.gc_organization_id)
    `);
    const orphanedBidsCount = Number((orphanedBids.rows[0] as any)?.count || 0);
    
    checks.push(createCheck(
      'orphan-bids',
      'No orphaned bids (missing organization)',
      'database',
      orphanedBidsCount === 0 ? 'pass' : 'fail',
      {
        message: orphanedBidsCount === 0 
          ? 'All bids have valid organization references' 
          : `Found ${orphanedBidsCount} orphaned bids`,
      }
    ));

    const orphanedEstimates = await db.execute(sql`
      SELECT COUNT(*) as count FROM estimates e
      WHERE e.project_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM projects p WHERE p.id = e.project_id)
    `);
    const orphanedEstimatesCount = Number((orphanedEstimates.rows[0] as any)?.count || 0);
    
    checks.push(createCheck(
      'orphan-estimates',
      'No orphaned estimates (missing project)',
      'database',
      orphanedEstimatesCount === 0 ? 'pass' : 'fail',
      {
        message: orphanedEstimatesCount === 0 
          ? 'All estimates have valid project references' 
          : `Found ${orphanedEstimatesCount} orphaned estimates`,
      }
    ));

    const orphanedTasks = await db.execute(sql`
      SELECT COUNT(*) as count FROM tasks t
      WHERE t.organization_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM organizations o WHERE o.id = t.organization_id)
    `);
    const orphanedTasksCount = Number((orphanedTasks.rows[0] as any)?.count || 0);
    
    checks.push(createCheck(
      'orphan-tasks',
      'No orphaned tasks (missing organization)',
      'database',
      orphanedTasksCount === 0 ? 'pass' : 'fail',
      {
        message: orphanedTasksCount === 0 
          ? 'All tasks have valid organization references' 
          : `Found ${orphanedTasksCount} orphaned tasks`,
      }
    ));

    checks.push(createCheck(
      'orphan-check-complete',
      'Orphan detection completed successfully',
      'database',
      'pass',
      {
        message: 'All orphan checks executed',
      }
    ));

  } catch (error) {
    checks.push(createCheck(
      'orphan-check-error',
      'Orphan checks execution',
      'database',
      'fail',
      {
        message: error instanceof Error ? error.message : String(error),
      }
    ));
  }

  return checks;
}
