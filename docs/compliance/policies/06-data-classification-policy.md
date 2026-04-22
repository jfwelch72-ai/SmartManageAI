# Data Classification & Handling Policy

| Owner | CTO |
| ----- | --- |
| Approver | CEO |
| Review cadence | Annual |

## 1. Classification levels

| Level | Description | Examples |
| ----- | ----------- | -------- |
| **Public** | Intended for general release | Marketing site copy, public Trust page content |
| **Internal** | Company use only; low harm if disclosed | Internal docs, org charts |
| **Confidential** | Material harm if disclosed | Source code, strategy docs, sales pipeline |
| **Restricted** | Severe harm if disclosed | Customer data (project details, financial data, PII), credentials, signing keys |

All customer data is treated as **Restricted** by default.

## 2. Handling requirements

| Requirement | Public | Internal | Confidential | Restricted |
| ----------- | ------ | -------- | ------------ | ---------- |
| Encryption in transit | TLS recommended | TLS required | TLS required | TLS 1.2+ required |
| Encryption at rest | not required | not required | required | required |
| Access | anyone | staff | named roles / IdP groups | least-privilege + audit logged |
| Sharing externally | OK | NDA | NDA + approval | DPA + approval + logged |
| Storage on endpoints | OK | OK | OK if disk-encrypted | Avoid; never on personal devices |
| Retention | indefinite | per business need | per business need | per Section 4 |

## 3. Customer data handling in the application

- All customer data is partitioned by `organizationId` and queries are
  forced to scope by it (see RBAC layer in `server/auth.ts`).
- File uploads are protected by `server/objectAcl.ts`. ACL policy is
  written to both GCS object metadata and the `objectAclPolicies` table
  for redundancy.
- Audit log entries (`server/auditLogger.ts`) record access to and
  mutation of customer data by staff via SUPER_ADMIN.

## 4. Retention

| Data type | Retention | Basis |
| --------- | --------- | ----- |
| Active customer data | Lifetime of the customer relationship | Service provision |
| Customer data after account deletion | 30 days (soft) → purged | DPA |
| Audit logs | 1 year minimum (tamper-evident) | SOC 2 + customer commitments |
| Backups | 30 days | DR objective |
| Application logs | 90 days | Operational need |
| Billing records | 7 years | Tax/finance |

## 5. Data subject rights

- **Access**: customer admins can export their organization's data via
  the in-app export endpoints. Manual SAR (subject access request)
  fulfillment SLA: 30 days.
- **Deletion**: customer-initiated account deletion triggers soft-delete,
  then hard-delete after 30 days. Backups containing the data age out
  within the 30-day backup retention window.

## 6. Disposal

Physical media is decommissioned through the cloud provider's certified
disposal process (covered by their SOC 2). Cryptographic erasure is used
where supported.
