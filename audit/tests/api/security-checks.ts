import { readFileSync, existsSync, readdirSync } from 'fs';
import type { AuditCheck } from '../../types';
import { createCheck } from '../../utils/base';

export async function runApiSecurityChecks(): Promise<AuditCheck[]> {
  const checks: AuditCheck[] = [];
  
  try {
    if (existsSync('server/index.ts')) {
      const indexContent = readFileSync('server/index.ts', 'utf-8');
      
      const hasCors = indexContent.includes('cors(') || indexContent.includes('cors({');
      checks.push(createCheck(
        'api-cors-configured',
        'CORS is configured',
        'api-security',
        hasCors ? 'pass' : 'warn',
        {
          message: hasCors ? 'CORS middleware is configured' : 'CORS middleware not detected in index.ts',
        }
      ));

      const hasRateLimiting = indexContent.includes('rateLimit') || indexContent.includes('express-rate-limit');
      checks.push(createCheck(
        'api-rate-limiting',
        'Rate limiting is configured',
        'api-security',
        hasRateLimiting ? 'pass' : 'warn',
        {
          message: hasRateLimiting ? 'Rate limiting middleware detected' : 'Rate limiting not detected - consider adding for API protection',
        }
      ));

      const hasSecureCookies = indexContent.includes('httpOnly') || indexContent.includes('secure:') || indexContent.includes('sameSite');
      checks.push(createCheck(
        'api-secure-cookies',
        'Secure cookie configuration',
        'api-security',
        hasSecureCookies ? 'pass' : 'warn',
        {
          message: hasSecureCookies ? 'Secure cookie options detected' : 'Cookie security settings not detected',
        }
      ));
    }

    if (existsSync('server/routes.ts')) {
      const routesContent = readFileSync('server/routes.ts', 'utf-8');
      
      const inputValidationPatterns = [
        'zod',
        'validate',
        '.parse(',
        'insertSchema',
        'createInsertSchema',
      ];
      const hasInputValidation = inputValidationPatterns.some(p => routesContent.includes(p));
      checks.push(createCheck(
        'api-input-validation',
        'Input validation is implemented',
        'api-security',
        hasInputValidation ? 'pass' : 'warn',
        {
          message: hasInputValidation ? 'Input validation (Zod) detected in routes' : 'Input validation not detected - ensure all inputs are validated',
        }
      ));

      const hasSqlInjectionProtection = routesContent.includes('drizzle') || routesContent.includes('sql`') || routesContent.includes('parameterized');
      checks.push(createCheck(
        'api-sql-injection-protection',
        'SQL injection protection',
        'api-security',
        hasSqlInjectionProtection ? 'pass' : 'warn',
        {
          message: hasSqlInjectionProtection ? 'Using Drizzle ORM (parameterized queries)' : 'Verify SQL queries are parameterized',
        }
      ));
    }

    const uploadFiles = ['server/routes.ts', 'server/objectStorage.ts'];
    let hasOrgScopedUploads = false;
    let hasPathTraversalProtection = false;

    for (const file of uploadFiles) {
      if (existsSync(file)) {
        const content = readFileSync(file, 'utf-8');
        if (content.includes('organizationId') && (content.includes('upload') || content.includes('multer'))) {
          hasOrgScopedUploads = true;
        }
        if (content.includes('path.basename') || content.includes('sanitize') || content.includes('../')) {
          hasPathTraversalProtection = true;
        }
      }
    }

    checks.push(createCheck(
      'api-upload-org-scoping',
      'File uploads are organization-scoped',
      'api-security',
      hasOrgScopedUploads ? 'pass' : 'warn',
      {
        message: hasOrgScopedUploads ? 'Uploads appear to be org-scoped' : 'Verify file uploads include organization scoping',
      }
    ));

    checks.push(createCheck(
      'api-path-traversal',
      'Path traversal protection',
      'api-security',
      hasPathTraversalProtection ? 'pass' : 'warn',
      {
        message: hasPathTraversalProtection ? 'Path traversal protection detected' : 'Verify file paths are sanitized',
      }
    ));

    if (existsSync('server/auth.ts') || existsSync('server/routes.ts')) {
      const authFile = existsSync('server/auth.ts') ? 'server/auth.ts' : 'server/routes.ts';
      const authContent = readFileSync(authFile, 'utf-8');
      
      const hasPasswordHashing = authContent.includes('bcrypt') || authContent.includes('argon2') || authContent.includes('scrypt');
      checks.push(createCheck(
        'api-password-hashing',
        'Password hashing is implemented',
        'api-security',
        hasPasswordHashing ? 'pass' : 'warn',
        {
          message: hasPasswordHashing ? 'Password hashing (bcrypt/argon2) detected' : 'Verify passwords are properly hashed',
        }
      ));

      const hasJwtExpiry = authContent.includes('expiresIn') || authContent.includes('exp:');
      checks.push(createCheck(
        'api-jwt-expiry',
        'JWT tokens have expiration',
        'api-security',
        hasJwtExpiry ? 'pass' : 'warn',
        {
          message: hasJwtExpiry ? 'JWT expiration configured' : 'Verify JWT tokens have expiration',
        }
      ));
    }

    const sensitivePatterns = [
      { pattern: /console\.log.*password/i, message: 'Potential password logging' },
      { pattern: /console\.log.*token/i, message: 'Potential token logging' },
      { pattern: /console\.log.*secret/i, message: 'Potential secret logging' },
      { pattern: /console\.log.*apiKey/i, message: 'Potential API key logging' },
    ];

    let sensitiveLogFound = false;
    let sensitiveLogDetails = '';

    const serverDir = 'server';
    let serverFiles: string[] = [];
    try {
      const entries = readdirSync(serverDir);
      serverFiles = entries.filter(f => f.endsWith('.ts')).map(f => `${serverDir}/${f}`);
    } catch {
      serverFiles = ['server/routes.ts', 'server/auth.ts', 'server/index.ts'];
    }

    for (const file of serverFiles) {
      if (existsSync(file)) {
        const content = readFileSync(file, 'utf-8');
        for (const { pattern, message } of sensitivePatterns) {
          if (pattern.test(content)) {
            sensitiveLogFound = true;
            sensitiveLogDetails = `${message} in ${file}`;
            break;
          }
        }
        if (sensitiveLogFound) break;
      }
    }

    checks.push(createCheck(
      'api-no-sensitive-logging',
      'No sensitive data logging',
      'api-security',
      !sensitiveLogFound ? 'pass' : 'fail',
      {
        message: !sensitiveLogFound ? 'No obvious sensitive data logging found' : sensitiveLogDetails,
      }
    ));

  } catch (error) {
    checks.push(createCheck(
      'api-security-error',
      'API security checks execution',
      'api-security',
      'fail',
      {
        message: error instanceof Error ? error.message : String(error),
      }
    ));
  }

  return checks;
}
