import { readFileSync } from 'fs';
import { writeFileSync } from 'fs';
import type { AuditCheck, RouteManifestEntry, TenantGuardCoverageReport } from '../../types';
import { createCheck, ensureReportDir } from '../../utils/base';

const AUTH_MIDDLEWARE_PATTERNS = [
  'requireAuth',
  'requireRole',
  'authenticate',
  'isAuthenticated',
];

const ORG_GUARD_PATTERNS = [
  'getOrgIdForFilter',
  'organizationId',
  'req.user.organizationId',
  'req.user!.organizationId',
  'orgId',
];

export async function runRouteDiscovery(): Promise<AuditCheck[]> {
  const checks: AuditCheck[] = [];
  const routeManifest: RouteManifestEntry[] = [];
  
  try {
    const routesContent = readFileSync('server/routes.ts', 'utf-8');
    const lines = routesContent.split('\n');
    
    const routeRegex = /app\.(get|post|put|patch|delete)\s*\(\s*["']([^"']+)["']/gi;
    const matches = routesContent.matchAll(routeRegex);
    
    const protectedRoutes: string[] = [];
    const unprotectedRoutes: string[] = [];
    const missingTenantGuard: RouteManifestEntry[] = [];

    for (const match of matches) {
      const method = match[1].toUpperCase();
      const path = match[2];
      const matchIndex = match.index || 0;
      
      const lineNumber = routesContent.substring(0, matchIndex).split('\n').length;
      const contextStart = Math.max(0, matchIndex - 500);
      const contextEnd = Math.min(routesContent.length, matchIndex + 1000);
      const context = routesContent.substring(contextStart, contextEnd);
      
      const hasAuth = AUTH_MIDDLEWARE_PATTERNS.some(p => context.includes(p));
      const hasOrgGuard = ORG_GUARD_PATTERNS.some(p => context.includes(p));
      
      const rolesMatch = context.match(/requireRole\s*\(\s*["']([^"']+)["']/g);
      const roles = rolesMatch 
        ? rolesMatch.map(r => r.match(/["']([^"']+)["']/)?.[1] || '').filter(Boolean)
        : [];

      const entry: RouteManifestEntry = {
        method,
        path,
        authRequired: hasAuth,
        tenantGuardApplied: hasOrgGuard,
        rolesAllowed: roles,
        file: 'server/routes.ts',
        line: lineNumber,
      };
      
      routeManifest.push(entry);
      
      if (hasAuth) {
        protectedRoutes.push(`${method} ${path}`);
      } else if (!path.includes('/health') && !path.includes('/api/auth/login') && !path.includes('/api/auth/register')) {
        unprotectedRoutes.push(`${method} ${path}`);
      }
      
      if (hasAuth && !hasOrgGuard && !path.includes('/super-admin') && !path.includes('/api/auth/')) {
        missingTenantGuard.push(entry);
      }
    }

    ensureReportDir();
    writeFileSync('audit/reports/routes.json', JSON.stringify(routeManifest, null, 2));
    console.log('Generated: audit/reports/routes.json');

    const coverageReport: TenantGuardCoverageReport = {
      totalRoutes: routeManifest.length,
      protectedRoutes: protectedRoutes.length,
      unprotectedRoutes: unprotectedRoutes.length,
      missingTenantGuard,
      missingAuth: routeManifest.filter(r => !r.authRequired),
    };
    writeFileSync('audit/reports/tenant-guard-coverage.json', JSON.stringify(coverageReport, null, 2));
    console.log('Generated: audit/reports/tenant-guard-coverage.json');

    checks.push(createCheck(
      'route-discovery-complete',
      'Route discovery completed',
      'api-security',
      'pass',
      {
        message: `Discovered ${routeManifest.length} API routes`,
      }
    ));

    checks.push(createCheck(
      'route-auth-coverage',
      'Routes have authentication middleware',
      'api-security',
      unprotectedRoutes.length < 5 ? 'pass' : 'warn',
      {
        message: `${protectedRoutes.length}/${routeManifest.length} routes require authentication`,
        details: unprotectedRoutes.length > 0 
          ? `Unprotected routes: ${unprotectedRoutes.slice(0, 5).join(', ')}${unprotectedRoutes.length > 5 ? '...' : ''}`
          : undefined,
      }
    ));

    checks.push(createCheck(
      'route-tenant-guard-coverage',
      'Routes have tenant/org scoping',
      'api-security',
      missingTenantGuard.length < 10 ? 'pass' : 'warn',
      {
        message: `${routeManifest.length - missingTenantGuard.length}/${routeManifest.length} routes have org scoping`,
        details: missingTenantGuard.length > 0 
          ? `Routes potentially missing org scope: ${missingTenantGuard.slice(0, 5).map(r => `${r.method} ${r.path}`).join(', ')}${missingTenantGuard.length > 5 ? '...' : ''}`
          : undefined,
      }
    ));

  } catch (error) {
    checks.push(createCheck(
      'route-discovery-error',
      'Route discovery execution',
      'api-security',
      'fail',
      {
        message: error instanceof Error ? error.message : String(error),
      }
    ));
  }

  return checks;
}
