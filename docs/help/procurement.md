# Run 3-way match procurement

Purchase order → goods receipt → vendor invoice. The match is automatic.

## How to do it

1. Issue a PO from an awarded RFQ or directly under *Project → Procurement*.
1. When materials arrive, the field receives them on the mobile app — quantities and a delivery photo are captured.
1. When the vendor invoice arrives, drop the PDF into *AP Inbox*. The system OCRs and matches it against the PO and receipt.
1. Variances over the configured tolerance flag the invoice for review; clean matches auto-post to A/P.

## Tips

- Tolerance is configured per-org under *Company Settings → AP rules* (default ±2% on price, ±5% on quantity).

---

Need more help? Use the *?* widget at the bottom-right of any page to open a support ticket. See [/sla](/sla) for response-time targets by plan.
