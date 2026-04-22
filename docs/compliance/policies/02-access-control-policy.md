# Access Control Policy

| Owner | CTO |
| ----- | --- |
| Approver | CEO |
| Review cadence | Annual |

## 1. Purpose

Ensure that access to information and information systems is granted on a
**need-to-know** and **least-privilege** basis, and that access is removed
promptly when no longer required.

## 2. Scope

All systems that hold customer data, source code, build pipelines, cloud
infrastructure, identity provider, and corporate SaaS.

## 3. Identity and authentication

1. Every staff identity originates in the Identity Provider (IdP). Local
   accounts on production systems are prohibited except for break-glass.
2. **Multi-factor authentication is mandatory** for:
   - All staff accounts on the IdP.
   - Cloud provider console access.
   - Source control (GitHub).
   - Production database administrative access.
3. **Customer admins** are required to enable MFA for their organization.
   Other customer users are offered MFA via WebAuthn passkeys
   (`server/passkeyRoutes.ts`).
4. Single Sign-On (SAML 2.0) is offered to enterprise customers via
   `server/ssoRoutes.ts`. Customers may enforce SSO-only login for their
   organization via `enforceSSO`.
5. Passwords stored in the application are hashed with bcrypt
   (`server/auth.ts`). Sessions are JWT-backed cookies with `httpOnly`,
   `sameSite=lax`, `secure` in production, and a 7-day TTL.
6. Token invalidation: `tokenVersion` is incremented on password change,
   role change, or forced logout (`revokeUserTokens` in `server/auth.ts`).

## 4. Authorization

1. The application uses role-based access control. Roles are defined in
   `shared/schema.ts` (`userRoleEnum`) and enforced in `server/auth.ts`
   (`requireRole`, `requireFeaturePermission`, `requireRoleOrFeature`).
2. Tenant isolation is enforced at every query by `organizationId`.
3. Object-level access (file uploads, attachments) is enforced by
   `server/objectAcl.ts`.
4. Production cloud and database privileges are granted via IdP groups, not
   individual accounts.

## 5. Provisioning and deprovisioning

1. New staff: account created in the IdP on Day 1 from the HRIS feed.
   Application access requires approval from the new hire's manager.
2. Role change: access is reconciled within **2 business days** of the
   role change in the HRIS.
3. Termination: all access is revoked **same-day**, both IdP and any
   long-lived tokens (`revokeUserTokens`).
4. Quarterly **access review**: each system owner exports the current user
   list (e.g. via `server/auditExportRoutes.ts` for application access),
   confirms each entry, and signs the review. Reviews are filed in
   `docs/compliance/evidence/`.

## 6. Privileged access

1. Production console access requires a justification ticket and is
   time-boxed (maximum 4 hours).
2. Break-glass credentials are stored in the password vault, sealed, and
   alerts fire on use.
3. SUPER_ADMIN role in the application is restricted to designated support
   staff and every action is recorded in `auditLog`.

## 7. Customer data access by staff

Staff access to customer data must be:
1. Authorized by a customer-raised support ticket or signed MSA clause, OR
2. Required to investigate a production incident (post-hoc justification
   filed within 24 hours).

Every such access is logged via the audit log table.
