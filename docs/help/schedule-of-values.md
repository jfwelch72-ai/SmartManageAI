# Manage the Schedule of Values

The SOV is the source of truth for your billings and your forecast.

## How to do it

1. Open *Project → Financial → Schedule of Values*.
1. Either import from a CSV (template available in the import dialog) or build line-by-line. Each line has *Cost code*, *Description*, *Scheduled value*, *Retention %*.
1. Lock the SOV when the owner has signed off — locked rows can still receive billings but their values can't change without an approved CO.
1. Each AIA billing pulls from the locked SOV automatically; previously billed amounts and retention are calculated for you.

## Tips

- Use *Group by division* to keep large SOVs readable (16-division CSI by default; configurable).
- Need to split one SOV line into two? Use *Reapportion* — it preserves billed-to-date totals across the new lines.

---

Need more help? Use the *?* widget at the bottom-right of any page to open a support ticket. See [/sla](/sla) for response-time targets by plan.
