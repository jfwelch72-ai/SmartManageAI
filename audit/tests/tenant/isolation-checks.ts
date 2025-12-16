import type { AuditCheck } from '../../types';
import { createCheck } from '../../utils/base';

export async function runTenantIsolationChecks(): Promise<AuditCheck[]> {
  const checks: AuditCheck[] = [];
  
  try {
    const { db } = await import('../../../server/db');
    const { sql } = await import('drizzle-orm');

    const crossOrgProjects = await db.execute(sql`
      SELECT COUNT(*) as count FROM projects p
      LEFT JOIN users pm ON p.project_manager_id = pm.id
      LEFT JOIN users s ON p.superintendent_id = s.id
      LEFT JOIN users e ON p.estimator_id = e.id
      WHERE p.gc_organization_id IS NOT NULL 
      AND (
        (pm.organization_id IS NOT NULL AND p.gc_organization_id != pm.organization_id)
        OR (s.organization_id IS NOT NULL AND p.gc_organization_id != s.organization_id)
        OR (e.organization_id IS NOT NULL AND p.gc_organization_id != e.organization_id)
      )
    `);
    const crossOrgCount = Number((crossOrgProjects.rows[0] as any)?.count || 0);
    
    checks.push(createCheck(
      'tenant-projects-staff-isolation',
      'Project staff belong to same organization as project',
      'tenant-isolation',
      crossOrgCount === 0 ? 'pass' : 'fail',
      {
        message: crossOrgCount === 0 
          ? 'All project staff are from the same organization' 
          : `Found ${crossOrgCount} cross-org project assignments`,
      }
    ));

    const crossOrgBids = await db.execute(sql`
      SELECT COUNT(*) as count FROM bids b
      LEFT JOIN users u ON b.estimator_id = u.id
      WHERE b.gc_organization_id IS NOT NULL 
      AND u.organization_id IS NOT NULL
      AND b.gc_organization_id != u.organization_id
    `);
    const crossOrgBidsCount = Number((crossOrgBids.rows[0] as any)?.count || 0);
    
    checks.push(createCheck(
      'tenant-bids-estimator-isolation',
      'Bids estimators belong to same organization as bid',
      'tenant-isolation',
      crossOrgBidsCount === 0 ? 'pass' : 'fail',
      {
        message: crossOrgBidsCount === 0 
          ? 'All bids have correct org scoping' 
          : `Found ${crossOrgBidsCount} cross-org bid estimator assignments`,
      }
    ));

    const crossOrgEstimates = await db.execute(sql`
      SELECT COUNT(*) as count FROM estimates e
      JOIN users u ON e.created_by_id = u.id
      LEFT JOIN projects p ON e.project_id = p.id
      WHERE p.gc_organization_id IS NOT NULL 
      AND u.organization_id IS NOT NULL
      AND p.gc_organization_id != u.organization_id
    `);
    const crossOrgEstimatesCount = Number((crossOrgEstimates.rows[0] as any)?.count || 0);
    
    checks.push(createCheck(
      'tenant-estimates-creator-isolation',
      'Estimate creators belong to same organization as project',
      'tenant-isolation',
      crossOrgEstimatesCount === 0 ? 'pass' : 'fail',
      {
        message: crossOrgEstimatesCount === 0 
          ? 'All estimates are org-scoped correctly' 
          : `Found ${crossOrgEstimatesCount} cross-org estimate creator relationships`,
      }
    ));

    const crossOrgChangeOrders = await db.execute(sql`
      SELECT COUNT(*) as count FROM change_orders co
      JOIN users u ON co.requested_by_id = u.id
      JOIN projects p ON co.project_id = p.id
      WHERE p.gc_organization_id IS NOT NULL 
      AND u.organization_id IS NOT NULL
      AND p.gc_organization_id != u.organization_id
    `);
    const crossOrgCOCount = Number((crossOrgChangeOrders.rows[0] as any)?.count || 0);
    
    checks.push(createCheck(
      'tenant-change-orders-isolation',
      'Change order requestors belong to same organization as project',
      'tenant-isolation',
      crossOrgCOCount === 0 ? 'pass' : 'fail',
      {
        message: crossOrgCOCount === 0 
          ? 'All change orders are org-scoped correctly' 
          : `Found ${crossOrgCOCount} cross-org change orders`,
      }
    ));

    const crossOrgTasks = await db.execute(sql`
      SELECT COUNT(*) as count FROM tasks t
      LEFT JOIN projects p ON t.project_id = p.id
      WHERE t.organization_id IS NOT NULL 
      AND p.gc_organization_id IS NOT NULL
      AND t.organization_id != p.gc_organization_id
    `);
    const crossOrgTasksCount = Number((crossOrgTasks.rows[0] as any)?.count || 0);
    
    checks.push(createCheck(
      'tenant-tasks-isolation',
      'Tasks belong to same organization as project',
      'tenant-isolation',
      crossOrgTasksCount === 0 ? 'pass' : 'fail',
      {
        message: crossOrgTasksCount === 0 
          ? 'All tasks are org-scoped correctly' 
          : `Found ${crossOrgTasksCount} cross-org task assignments`,
      }
    ));

    const orgsCount = await db.execute(sql`SELECT COUNT(*) as count FROM organizations`);
    const orgCount = Number((orgsCount.rows[0] as any)?.count || 0);
    
    checks.push(createCheck(
      'tenant-multi-org-exists',
      'Multiple organizations exist for testing',
      'tenant-isolation',
      orgCount >= 2 ? 'pass' : 'warn',
      {
        message: orgCount >= 2 
          ? `Found ${orgCount} organizations for multi-tenant testing` 
          : `Only ${orgCount} organization(s) found - add more for thorough testing`,
      }
    ));

  } catch (error) {
    checks.push(createCheck(
      'tenant-isolation-error',
      'Tenant isolation checks execution',
      'tenant-isolation',
      'fail',
      {
        message: error instanceof Error ? error.message : String(error),
      }
    ));
  }

  return checks;
}
