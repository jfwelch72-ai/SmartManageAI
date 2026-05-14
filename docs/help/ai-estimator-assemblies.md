# Use assemblies and org factors in the AI Estimator

The AI Estimator classifies every plan sheet by discipline, matches scope items to your assemblies catalog, and applies your org-level cost factors — all before it generates a draft estimate. This guide covers setup, sheet classification, generating a draft, and reviewing AI-suggested lines before they reach your estimate.

---

## How the sheet classifier works

When you upload a plan set to a bid, each sheet is automatically tagged with a discipline code based on the sheet title, filename, and visual content:

| Code | Discipline |
|---|---|
| G | General / Cover / Notes |
| A | Architectural |
| S | Structural |
| M | Mechanical / HVAC |
| E | Electrical |
| P | Plumbing |
| C | Civil / Site |
| L | Landscape |
| FP | Fire Protection |
| T | Technology / Low Voltage |
| Q | Equipment / Process |
| I | Instrumentation |
| O | Other / Specialty |

The **trade picker** on the Estimate step shows only the disciplines found in your uploaded plan set. Unrelated disciplines are hidden automatically so you are not offered trades that do not apply to this project.

> **Screenshot placeholder:** Trade picker showing only the disciplines present in the uploaded plan set (e.g., A, S, E checked; others grayed out).

If a sheet is classified incorrectly:
1. Open the sheet's detail view (click the sheet thumbnail in the Takeoff workspace).
1. Click the **Discipline** badge and select the correct code from the dropdown.
1. The classification override is saved immediately and used for all future AI drafts on this bid.

---

## Setting up the assemblies catalog

Assemblies let you pre-define the line-item structure your company uses for common scope items. When the AI recognizes a scope item in the plans, it maps it to your assembly so you get your preferred breakdown — not a generic one.

1. Open **Settings → AI Estimator → Assemblies**.
1. Click **Add assembly**.
1. Fill in the required fields:
   - **Name** — a clear label the AI can match against (e.g., "Cast-in-place spread footing").
   - **Unit of measure** — the billable unit (e.g., `CY`, `EA`, `SF`).
   - **Trade / Discipline** — which discipline this assembly belongs to (used to narrow matching).
1. Under **Components**, add one or more line items:
   - Each component has a **Description**, **UOM**, **Quantity per assembly unit**, and optional **Unit cost**.
   - Example: a "Cast-in-place spread footing (CY)" assembly might include components for forming (SF), reinforcing steel (LB), concrete (CY), and finishing (SF).
1. Click **Save assembly**.

> **Screenshot placeholder:** Assembly editor showing the Name, UOM, and Trade fields at the top and the component line-item grid below.

Repeat for each common scope item your crews work with. The more specific your assembly names and the more closely they mirror plan language, the higher the AI match rate.

---

## Configuring org-level factors

Org factors are multipliers applied to every AI-generated draft so estimates reflect your company's real-world conditions — not generic published costs.

1. Open **Settings → AI Estimator → Org Factors**.
1. Set the factors that apply to your operations:
   - **Waste %** — material overage allowance (e.g., `10` for 10% waste on concrete).
   - **Productivity index** — labor efficiency multiplier (e.g., `0.85` if your crews run 85% of published productivity rates).
   - **Regional cost index** — cost-of-living and market-rate multiplier for your geography (e.g., `1.12` for a high-cost metro).
1. Click **Save factors**.

These apply automatically to every new draft. You can override any factor on a per-bid basis during draft review without changing the org-level defaults.

---

## Generating a draft estimate from plans

1. Open the bid in the **Bids** section.
1. Progress to the **Estimate** step (step 3 of 6 in the bid workflow).
1. Click **AI Estimate from plans**.
1. The trade picker appears. Select the **disciplines** you want to include in this draft — for example, select S and C for a structural + civil estimate; leave out A if architecture is under a separate contract.
1. Click **Generate**. The AI processes up to 8 plan documents simultaneously. For large plan sets (100+ sheets) this typically takes 30–90 seconds.

> **Screenshot placeholder:** Trade picker with selected disciplines highlighted and the Generate button below.

---

## Reviewing AI-suggested lines

After generation completes, the **AI Suggestions** panel appears alongside the estimate grid.

Each suggestion row shows:
- **Description** — the scope item the AI identified.
- **Source sheet** — which plan sheet the item was found on (click to jump to that sheet in the Takeoff workspace).
- **Confidence** — a 0–100% score indicating how certain the AI is about the quantity and scope.
- **Matched assembly** — the assembly from your catalog that was applied (or "No match" if none was found).
- **Quantity** and **Unit** as extracted from the plans.

For each suggestion you can:
- **Accept** — adds the line to your estimate using the AI's quantity and your assembly's cost structure.
- **Edit** — opens the line for quantity or description adjustment before accepting.
- **Reject** — dismisses the suggestion without adding it to the estimate.

Use **Accept all** or **Reject all** to process suggestions in bulk, then manually edit the few lines that need attention.

1. When you are satisfied with the reviewed lines, click **Apply to estimate**. All accepted lines are added to the estimate grid.
1. Proceed with normal estimate editing — adjust quantities, costs, and markups as needed.

> **Screenshot placeholder:** AI Suggestions panel showing rows with confidence scores, source sheet links, and Accept / Edit / Reject buttons.

---

## Legend symbols

If your plans include a symbol legend, the AI Estimator can use it to resolve symbol-to-scope mappings more accurately.

1. Open **Settings → AI Estimator → Legend Symbols**.
1. Upload a screenshot or PDF page of a legend.
1. The AI extracts symbol-to-description mappings and stores them for use in all future drafts for your organization.

---

## Tips

- **High-confidence items** (above 85%) rarely need manual review; **low-confidence items** (below 60%) should be checked against the plan sheet before accepting.
- If an assembly is being matched to the wrong scope item, rename the assembly to more closely match the language used in your plan sets (e.g., use "CIP spread footing" if plans say "CIP" rather than "cast-in-place").
- Org factors can be overridden per bid: in the AI Suggestions panel, click **Factors** to open a per-bid override drawer without changing the org-level defaults.
- Generating a second draft after accepting lines from the first does not duplicate lines — the AI drafts are always additive to a staging area, not directly to the estimate grid, until you click **Apply**.

---

Need more help? Use the **?** widget to open a support ticket. See [/sla](/sla) for response-time targets by plan.
