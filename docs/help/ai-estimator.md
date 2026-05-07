# Use the AI Estimator

Draft a full estimate from a plan set in minutes; you stay in control of every line.

## How to do it

1. Open a bid with at least one PDF in the Documents step.
1. Open the *Estimate* step and click *AI Estimate from plans*.
1. Pick the trades you want included (the sheet-index classifier already labelled each sheet as G/A/S/M/E/P/etc., so the picker only shows trades present in the set).
1. (Optional) Limit to a subset of plan documents and a region of interest. Click *Generate*.
1. Review the draft. Each line shows its source sheet, a confidence score, and the assembly used. Accept, edit, or reject lines individually or in bulk.
1. When you're satisfied, click *Apply to estimate*. Lines are added; you can keep editing manually.

## Tips

- Org-level factors (waste %, productivity, regional cost index) live under *Settings → AI Estimator factors*. Tune them once and every draft inherits them.
- Routing to OpenAI vs. Anthropic Claude is controlled by the `AI_PROVIDER_TAKEOFF` feature flag.

---

Need more help? Use the *?* widget at the bottom-right of any page to open a support ticket. See [/sla](/sla) for response-time targets by plan.
