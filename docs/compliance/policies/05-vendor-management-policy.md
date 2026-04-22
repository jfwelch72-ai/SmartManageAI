# Vendor Management Policy

| Owner | CTO |
| ----- | --- |
| Approver | CEO |
| Review cadence | Annual |

## 1. Purpose

Ensure that third parties (vendors, sub-processors, SaaS tools) that touch
customer data or critical systems meet the Company's security and privacy
expectations.

## 2. Vendor inventory

A current vendor inventory is maintained in the GRC platform and mirrored
publicly (for sub-processors only) at `docs/compliance/sub-processors.md`,
which is the source of the public `/sub-processors` page.

For each vendor we record:
- Name and service provided
- Type (sub-processor / sub-service organization / tool)
- Data accessed (none / metadata / customer PII / financial)
- Region of processing
- Latest SOC 2 / ISO 27001 / DPA on file
- Risk tier (Low / Medium / High / Critical)
- Owner inside the Company
- Date of last review

## 3. Onboarding a vendor

Before granting a vendor access to production data or staff systems:
1. Owner files a vendor intake in the GRC platform.
2. Security review checks: SOC 2 (or equivalent), DPA, sub-processor list,
   data residency, breach notification commitments.
3. **High** or **Critical** tier vendors require CTO approval.
4. The vendor is added to the inventory and (if a sub-processor)
   `sub-processors.md` is updated and the customer notice clock starts
   per the DPA.

## 4. Ongoing review

| Tier | Review cadence |
| ---- | -------------- |
| Critical | Annually + on any incident |
| High | Annually |
| Medium | Every 2 years |
| Low | Every 3 years |

Reviews check that SOC 2 / ISO 27001 attestations remain current, that
sub-processor lists are unchanged or properly noticed, and that no security
incidents involving the vendor went unreported to us.

## 5. Sub-processor changes

Customers must be notified at least **30 days** before a new sub-processor
begins processing their personal data, per the DPA. Changes are published
to `/sub-processors` with the effective date.

## 6. Off-boarding

When a vendor relationship ends:
- Revoke all credentials and tokens.
- Confirm in writing that customer data has been deleted from the vendor.
- Remove from the inventory and `sub-processors.md`.
