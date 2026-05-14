# Use assemblies and org factors in the AI Estimator

The AI Estimator classifies every plan sheet by discipline, matches scope items to your assemblies catalog, and applies your org-level cost factors — all before it generates a draft estimate.

## How the sheet classifier works

When you upload plans to a bid, each sheet is automatically tagged by discipline: **G** (General), **A** (Architectural), **S** (Structural), **M** (Mechanical), **E** (Electrical), **P** (Plumbing), **C** (Civil), **L** (Landscape), **FP** (Fire Protection), and others. The trade picker then shows only the disciplines present in your plan set.

## Setting up the assemblies catalog

1. Open **Settings → AI Estimator → Assemblies**.
1. Add assemblies that match your common scope items (e.g., "Cast-in-place footing"). Each assembly includes a name, unit of measure, and component line items.
1. When generating a draft, the AI matches recognized items to your assemblies so your preferred line-item structure is used automatically.

## Configuring org-level factors

Under **Settings → AI Estimator → Org Factors**, set waste %, productivity index, and regional cost index. These apply to every draft automatically and can be overridden per bid.

## Generating a draft

1. Open a bid, go to the **Estimate** step, and click **AI Estimate from plans**.
1. Select the disciplines to include and click **Generate**.
1. Review each line — source sheet, confidence score, and matched assembly are shown. Accept, edit, or reject lines individually or in bulk, then click **Apply to estimate**.

## Tips

- If a sheet is classified incorrectly, open the sheet detail and override the discipline tag.

---

Need more help? Use the *?* widget to open a support ticket. See [/sla](/sla) for response-time targets by plan.
