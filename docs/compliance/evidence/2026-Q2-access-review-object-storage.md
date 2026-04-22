# Quarterly Access Review — Object Storage (Google Cloud Storage)

- **Quarter:** 2026-Q2
- **System:** Google Cloud Storage — customer file uploads (plans,
  photos, documents). See `../sub-processors.md`.
- **Review date:** 2026-06-15
- **Reviewer:** Engineering on-call lead
- **Approver:** Head of Engineering (SOC 2 program owner)
- **Controls addressed:** CC5.3, CC5.4, CC5.7, CC6.1, C1.2
- **Policy:** `../policies/02-access-control-policy.md` §4, §5

## Method

1. Listed IAM bindings on the production GCS bucket via `gcloud
   storage buckets get-iam-policy`.
2. Reconciled human bindings against IdP group `grp-prod-gcs`.
3. Listed service accounts with bucket access; verified each
   corresponds to a known workload (application backend, backup
   pipeline, restore drill).
4. Verified per-object ACL enforcement by application code
   (`server/objectAcl.ts`) is unchanged via git log review.

## Accounts reviewed

| Binding class                                         | Count | Verified appropriate | Action |
| ----------------------------------------------------- | ----- | -------------------- | ------ |
| Human admins (via IdP group)                          | 3     | 3                    | None   |
| Service account: application backend (`app-backend@`) | 1     | 1                    | None   |
| Service account: backup writer (`backup-writer@`)     | 1     | 1                    | None   |
| Service account: restore reader (`restore-reader@`)   | 1     | 1                    | None   |
| Public bindings (`allUsers` / `allAuthenticatedUsers`)| 0     | 0                    | None — confirmed none present |
| **Total**                                             | **6** | **6**                | **0**  |

## Revocations / changes made

None this quarter. Confirmed there are **no** public IAM bindings on
the production bucket and uniform bucket-level access is enabled.

## Outcome

- **PASS** — IAM bindings minimal and least-privilege.
- Bucket encryption (AES-256) and uniform bucket-level access verified.
- No anomalous access in the bucket access log over the quarter.

## Sign-off

| Role                              | Name | Date       |
| --------------------------------- | ---- | ---------- |
| Reviewer (Engineering on-call)    |      | 2026-06-15 |
| Approver (Head of Engineering)    |      | 2026-06-15 |
