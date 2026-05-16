# Test Company Accounts

> **FOR LOCAL / QA USE ONLY**
> This file documents test credentials seeded into the development database.
> Never commit real credentials. Never use these accounts in production.

---

## Shared Password

All test accounts use the same password:

```
TestPass123!
```

---

## Main Organization: RealTest Construction

- **Plan**: Enterprise (all add-ons enabled: AI PM, AI CFO, AI Email, Website SEO, Bid Network, AI Vision)
- **Trade**: General Contractor
- **Location**: Construction City, TX

| Name | Email | Role |
|---|---|---|
| Super Admin | superadmin@realtest.com | SUPER_ADMIN |
| Organization Admin | admin@realtest.com | ADMIN |
| Project Manager | manager@realtest.com | MANAGER |
| Site Superintendent | super@realtest.com | SUPERINTENDENT |
| Cost Estimator | estimator@realtest.com | ESTIMATOR |
| Office Manager | office@realtest.com | MANAGER |
| Field Worker | worker@realtest.com | FIELD_WORKER |
| Equipment Manager (Maintenance) | maintenance@realtest.com | FIELD_WORKER |
| Vendor Contact | vendor@realtest.com | VENDOR |
| Business Owner | hustler@realtest.com | HUSTLER |
| Sales Rep | sales@realtest.com | MANAGER |
| Marketing Lead | marketing@realtest.com | MANAGER |
| Safety Manager | safety@realtest.com | SUPERINTENDENT |
| HR Manager | hr@realtest.com | MANAGER |
| Equipment Manager | equipment@realtest.com | FIELD_WORKER |
| Project Engineer | engineer@realtest.com | ESTIMATOR |
| Procurement Manager | procurement@realtest.com | MANAGER |
| Fleet Dispatcher | dispatcher@realtest.com | SUPERINTENDENT |

---

## Subcontractor Organization: RealTest Subcontractors

- **Plan**: Professional
- **Trade**: Concrete

| Name | Email | Role |
|---|---|---|
| Sub Admin | subadmin@realtest.com | ADMIN |
| Sub Estimator | subestimator@realtest.com | ESTIMATOR |
| Sub Foreman | subforeman@realtest.com | SUPERINTENDENT |

---

## Seeding

To recreate these accounts from scratch, run:

```bash
npx tsx scripts/seed-test-company.ts
```

The script safely handles re-runs — if the organizations already exist (e.g. due to FK constraints preventing cleanup), it reuses them and skips conflicts on users, subscriptions, and add-ons.
