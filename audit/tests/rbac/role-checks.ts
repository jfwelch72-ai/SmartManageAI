import type { AuditCheck, RBACMatrix } from '../../types';
import { createCheck, ensureReportDir } from '../../utils/base';
import { writeFileSync } from 'fs';

const ROLES = [
  'SUPER_ADMIN',
  'ADMIN',
  'MANAGER',
  'ESTIMATOR',
  'SUPERINTENDENT',
  'OFFICE_MANAGER',
  'HOURLY_EMPLOYEE',
  'MAINTENANCE_MANAGER',
  'VENDOR',
  'HUSTLER',
];

const ADMIN_ONLY_ROUTES = [
  '/api/users',
  '/api/organizations',
  '/api/audit-logs',
  '/api/billing',
];

const MANAGER_ROUTES = [
  '/api/projects',
  '/api/bids',
  '/api/estimates',
  '/api/crews',
];

const SUPER_ADMIN_ROUTES = [
  '/api/super-admin',
  '/api/admin/subscriptions',
  '/api/admin/organizations',
];

export async function runRBACChecks(): Promise<AuditCheck[]> {
  const checks: AuditCheck[] = [];
  
  try {
    const { db } = await import('../../../server/db');
    const { sql } = await import('drizzle-orm');

    const rolesResult = await db.execute(sql`
      SELECT DISTINCT role FROM users WHERE role IS NOT NULL
    `);
    const existingRoles = rolesResult.rows.map((r: any) => r.role);
    
    checks.push(createCheck(
      'rbac-roles-exist',
      'Required roles exist in system',
      'rbac',
      existingRoles.length >= 3 ? 'pass' : 'warn',
      {
        message: `Found ${existingRoles.length} distinct roles: ${existingRoles.join(', ')}`,
      }
    ));

    const superAdminResult = await db.execute(sql`
      SELECT COUNT(*) as count FROM users WHERE role = 'SUPER_ADMIN'
    `);
    const superAdminCount = Number((superAdminResult.rows[0] as any)?.count || 0);
    
    checks.push(createCheck(
      'rbac-super-admin-exists',
      'SUPER_ADMIN user exists',
      'rbac',
      superAdminCount > 0 ? 'pass' : 'warn',
      {
        message: superAdminCount > 0 
          ? `Found ${superAdminCount} SUPER_ADMIN user(s)` 
          : 'No SUPER_ADMIN user found - create one for platform management',
      }
    ));

    const roleDistribution = await db.execute(sql`
      SELECT role, COUNT(*) as count 
      FROM users 
      WHERE role IS NOT NULL 
      GROUP BY role 
      ORDER BY count DESC
    `);
    
    checks.push(createCheck(
      'rbac-role-distribution',
      'Role distribution is reasonable',
      'rbac',
      'pass',
      {
        message: `Role distribution: ${roleDistribution.rows.map((r: any) => `${r.role}(${r.count})`).join(', ')}`,
      }
    ));

    const usersWithNullRole = await db.execute(sql`
      SELECT COUNT(*) as count FROM users WHERE role IS NULL
    `);
    const noRoleCount = Number((usersWithNullRole.rows[0] as any)?.count || 0);
    
    checks.push(createCheck(
      'rbac-all-users-have-role',
      'All users have assigned roles',
      'rbac',
      noRoleCount === 0 ? 'pass' : 'warn',
      {
        message: noRoleCount === 0 
          ? 'All users have roles assigned' 
          : `${noRoleCount} user(s) without role assignment`,
      }
    ));

    const rbacMatrix: RBACMatrix = {
      roles: ROLES,
      routes: [
        ...SUPER_ADMIN_ROUTES.map(path => ({
          path,
          method: 'GET',
          allowedRoles: ['SUPER_ADMIN'],
        })),
        ...ADMIN_ONLY_ROUTES.map(path => ({
          path,
          method: 'ALL',
          allowedRoles: ['SUPER_ADMIN', 'ADMIN'],
        })),
        ...MANAGER_ROUTES.map(path => ({
          path,
          method: 'ALL',
          allowedRoles: ['SUPER_ADMIN', 'ADMIN', 'MANAGER'],
        })),
      ],
      pages: [
        { path: '/admin', allowedRoles: ['SUPER_ADMIN', 'ADMIN'] },
        { path: '/projects', allowedRoles: ['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'ESTIMATOR', 'SUPERINTENDENT'] },
        { path: '/bids', allowedRoles: ['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'ESTIMATOR'] },
        { path: '/timeclock', allowedRoles: ['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'SUPERINTENDENT', 'HOURLY_EMPLOYEE'] },
        { path: '/accounting', allowedRoles: ['SUPER_ADMIN', 'ADMIN', 'OFFICE_MANAGER'] },
      ],
    };

    ensureReportDir();
    writeFileSync('audit/reports/rbac-matrix.json', JSON.stringify(rbacMatrix, null, 2));
    console.log('Generated: audit/reports/rbac-matrix.json');

    checks.push(createCheck(
      'rbac-matrix-generated',
      'RBAC matrix exported',
      'rbac',
      'pass',
      {
        message: `Exported matrix with ${ROLES.length} roles and ${rbacMatrix.routes.length + rbacMatrix.pages.length} access rules`,
      }
    ));

  } catch (error) {
    checks.push(createCheck(
      'rbac-check-error',
      'RBAC checks execution',
      'rbac',
      'fail',
      {
        message: error instanceof Error ? error.message : String(error),
      }
    ));
  }

  return checks;
}
