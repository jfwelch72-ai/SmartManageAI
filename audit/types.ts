export interface AuditCheck {
  id: string;
  name: string;
  category: AuditCategory;
  status: 'pass' | 'fail' | 'skip' | 'warn';
  message?: string;
  details?: string;
  file?: string;
  line?: number;
  reproductionSteps?: string[];
  duration?: number;
}

export type AuditCategory = 
  | 'tenant-isolation'
  | 'rbac'
  | 'database'
  | 'api-security'
  | 'ui-gating'
  | 'integrations'
  | 'ai-safety'
  | 'communications'
  | 'observability';

export interface AuditReport {
  timestamp: string;
  gitCommit: string;
  environment: string;
  summary: {
    total: number;
    passed: number;
    failed: number;
    skipped: number;
    warnings: number;
  };
  categories: {
    [key in AuditCategory]?: {
      passed: number;
      failed: number;
      skipped: number;
      warnings: number;
    };
  };
  checks: AuditCheck[];
  duration: number;
}

export interface RouteManifestEntry {
  method: string;
  path: string;
  authRequired: boolean;
  tenantGuardApplied: boolean;
  rolesAllowed: string[];
  file?: string;
  line?: number;
}

export interface TenantGuardCoverageReport {
  totalRoutes: number;
  protectedRoutes: number;
  unprotectedRoutes: number;
  missingTenantGuard: RouteManifestEntry[];
  missingAuth: RouteManifestEntry[];
}

export interface RBACMatrix {
  roles: string[];
  routes: {
    path: string;
    method: string;
    allowedRoles: string[];
  }[];
  pages: {
    path: string;
    allowedRoles: string[];
  }[];
}

export interface IntegrationHealth {
  name: string;
  status: 'healthy' | 'degraded' | 'unhealthy' | 'not-configured';
  lastCheck: string;
  details?: string;
  configPresent: boolean;
}

export interface TestFixtureUser {
  id: string;
  email: string;
  password: string;
  role: string;
  organizationId: string;
  organizationName: string;
}

export interface TestFixtureOrg {
  id: string;
  name: string;
  slug: string;
}
