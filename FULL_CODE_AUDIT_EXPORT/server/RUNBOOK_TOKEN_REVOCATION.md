# Token Revocation System - Operational Runbook

## Overview
The TFR Construction platform implements JWT token versioning to enable "logout all devices" functionality. When an admin revokes a user's tokens, all existing sessions are invalidated and the user must re-authenticate.

## Architecture

### Database Schema
```sql
users table:
  - token_version: integer NOT NULL DEFAULT 0
```

### JWT Payload
```json
{
  "userId": "uuid",
  "tokenVersion": 0,
  "iat": 1234567890,
  "exp": 1234567890
}
```

### Revocation Flow
1. Admin calls `POST /api/users/:id/revoke-tokens`
2. System increments `token_version` for target user
3. Existing JWTs contain old tokenVersion (e.g., 0)
4. Next API request with old JWT fails auth middleware check
5. User must log in again to receive new JWT with current tokenVersion

## API Endpoints

### Revoke User Tokens (Admin Only)
```http
POST /api/users/:userId/revoke-tokens
Authorization: Cookie (admin session)

Response:
{
  "success": true,
  "message": "All tokens revoked. User will need to log in again."
}
```

### Change Password (Self-Service)
```http
POST /api/auth/change-password
Authorization: Cookie (authenticated session)
Content-Type: application/json

{
  "currentPassword": "oldpass123",
  "newPassword": "newpass456"
}

Response:
{
  "success": true,
  "message": "Password changed successfully"
}
```

**Note:** Password change does NOT revoke existing sessions. User's current session remains valid.

## Security Guarantees

### Atomicity
- `UPDATE users SET token_version = token_version + 1` is atomic in PostgreSQL
- No race conditions even under concurrent revocation attempts
- Single transaction ensures consistency

### Null Safety
- Schema enforces `NOT NULL` constraint with `DEFAULT 0`
- Application code defensively coerces `null` to `0` in:
  - `generateToken()`: `tokenVersion ?? 0`
  - `authMiddleware()`: Both user and payload treated as 0 if null
- Migration backfills any legacy NULL values

### Audit Trail
- All token revocations logged to `audit_log` table:
  - `entity_type`: "USER"
  - `entity_id`: target user ID
  - `action`: "REVOKE_TOKENS"
  - `old_value`: null
  - `new_value`: `{"revokedBy": "admin@example.com"}`
  - `ip_address`: Admin's IP
  - `user_agent`: Admin's browser

## Migration Instructions

### Initial Setup (Already Applied)
```bash
# Schema already includes:
# - token_version column with NOT NULL and DEFAULT 0
# - All existing users have non-null values
```

### Production Deployment
```bash
# 1. Run migration to backfill any legacy data
psql $DATABASE_URL < server/migrations/001_backfill_token_version.sql

# 2. Verify all users have valid tokenVersion
psql $DATABASE_URL -c "SELECT COUNT(*) FROM users WHERE token_version IS NULL;"
# Expected output: count = 0

# 3. Deploy application code
npm run build
npm start

# 4. Test revocation with admin account
curl -X POST https://your-domain.com/api/users/:userId/revoke-tokens \
  -H "Cookie: auth_token=..." \
  -H "Content-Type: application/json"
```

## Monitoring & Verification

### Check Token Version Distribution
```sql
SELECT 
  token_version,
  COUNT(*) as user_count,
  MAX(updated_at) as last_update
FROM users
GROUP BY token_version
ORDER BY token_version;
```

### Audit Recent Revocations
```sql
SELECT 
  created_at,
  user_id,
  entity_id as revoked_user_id,
  new_value->'revokedBy' as admin_email,
  ip_address
FROM audit_log
WHERE entity_type = 'USER' AND action = 'REVOKE_TOKENS'
ORDER BY created_at DESC
LIMIT 20;
```

### Verify JWT Structure
```javascript
// Decode JWT (server-side only - never expose JWT_SECRET)
const jwt = require('jsonwebtoken');
const token = req.cookies.auth_token;
const decoded = jwt.verify(token, process.env.JWT_SECRET);
console.log(decoded);
// Expected: { userId: "...", tokenVersion: 0, iat: ..., exp: ... }
```

## Troubleshooting

### Issue: User immediately logged out after login
**Cause:** Token version mismatch
**Solution:**
```sql
-- Check user's current tokenVersion
SELECT id, email, token_version FROM users WHERE email = 'user@example.com';

-- If needed, reset to 0
UPDATE users SET token_version = 0 WHERE email = 'user@example.com';
```

### Issue: Revocation doesn't work
**Verification Steps:**
1. Check tokenVersion incremented:
   ```sql
   SELECT token_version FROM users WHERE id = :userId;
   ```
2. Decode user's JWT to see old tokenVersion
3. Verify auth middleware comparison logic
4. Check audit_log for revocation event

### Issue: All users logged out unexpectedly
**Cause:** Mass tokenVersion increment (check audit_log)
**Solution:**
```sql
-- Find who triggered mass revocation
SELECT * FROM audit_log 
WHERE action = 'REVOKE_TOKENS' 
  AND created_at > NOW() - INTERVAL '1 hour'
ORDER BY created_at;

-- If unauthorized, restore from backup or reset all to 0
-- (Note: This will log everyone out again)
UPDATE users SET token_version = 0;
```

## Best Practices

1. **Revoke tokens when:**
   - User reports stolen device
   - Suspicious login activity detected
   - Employee termination
   - Security breach suspected

2. **Don't revoke tokens for:**
   - Password changes (use password change endpoint)
   - Role changes (sessions remain valid)
   - Minor account updates

3. **Audit trail:**
   - Always document reason for revocation in audit log notes
   - Review audit_log monthly for unusual patterns

4. **Performance:**
   - Token revocation is O(1) database operation
   - No impact on other users
   - Auth middleware check adds ~1ms per request

## Emergency Procedures

### Revoke ALL Users (Security Breach)
```sql
-- Nuclear option: Force everyone to re-authenticate
UPDATE users SET token_version = token_version + 1;

-- Verify
SELECT COUNT(*) FROM users WHERE token_version = 0;
-- Expected: 0
```

### Restore Single User Session
```sql
-- User locked out incorrectly
UPDATE users 
SET token_version = 0, updated_at = NOW() 
WHERE id = :userId;

-- User must log in again to get new JWT
```

## Related Documentation
- Authentication: `server/auth.ts`
- User Management: `server/routes.ts` (lines 338-383)
- Audit Logging: `server/auditLogger.ts`
- Schema: `shared/schema.ts` (line 33)
