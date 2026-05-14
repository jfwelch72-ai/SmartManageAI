# Close out a project with the Closeout Package

Collect all handover deliverables — warranties, lien waivers, as-builts, permits, and inspection records — on a single checklist, then export a verified ZIP package for the owner in one click. The export is integrity-checked and stored securely so the owner can download it even after you leave the project.

---

## Opening the Closeout tab

1. Open a project from the **Projects** list or from the dashboard.
1. Click the **Closeout** tab at the top of the project detail page.

> **Screenshot placeholder:** Project detail page with the Closeout tab highlighted in the tab bar.

---

## Setting up a closeout checklist

When you open the Closeout tab for the first time, a default checklist is created automatically from the system template. It includes eight standard categories:

| Category | Typical contents |
|---|---|
| O&M Manual | Operations & maintenance documentation |
| Warranty | Manufacturer and contractor warranties |
| As-Built | Redlined drawings reflecting final conditions |
| Lien Release | Final and conditional lien waivers |
| Final COI | Certificate of insurance for completed work |
| Punch List | All punch items marked complete |
| Inspection | Final inspection reports and sign-offs |
| Permit | Permits with final inspection stamps |

To customize the checklist for this project:

1. Click **Add item** to create a category-specific line not covered by the default template.
1. Click the pencil icon on any existing item to rename it or update its description.
1. Click **Assign** on an item to pick the responsible team member and set a due date.

> **Screenshot placeholder:** Closeout checklist with category rows, assigned names, due dates, and status badges.

---

## Using Auto-Pull

Auto-Pull scans the project's existing records and attaches matching documents to checklist items automatically, saving you from hunting down files manually.

1. Click the **Auto-Pull** button at the top of the checklist.
1. The system scans:
   - **Warranty Documents** → Warranty items
   - **Lien Waivers** → Lien Release items
   - **Project Permits** → Permit items
   - **Project Inspections** → Inspection items
   - **Punch List Items** → Punch List items
   - **Plan Documents (as-builts)** → As-Built items
   - **Asset Handover Items** → O&M Manual items
1. Each matched source is attached to the appropriate item and the item status moves to **Ready** automatically.
1. Items with no matching source remain **Pending** for manual upload.

> **Screenshot placeholder:** Auto-Pull result showing green "Ready" badges on matched items and amber "Pending" on unmatched ones.

---

## Completing items manually

For items that Auto-Pull could not resolve:

1. Click the item row to expand it.
1. Click **Upload document** and choose a file. Supported formats: **PDF**, **DOCX**, **XLSX**, **PNG**, **JPG**, and most common image types.
1. Add a short note if the reviewer needs context (e.g., "Received from subcontractor 2026-04-10").
1. Click **Mark ready** once the item is complete.

You can attach multiple documents to a single checklist item — for example, attaching both a conditional and final lien waiver to the same Lien Release line.

---

## Walkthrough mode (punch list)

Before exporting, confirm all punch items are resolved.

1. Inside the Closeout tab, click **Punch List → Walkthrough**.
1. Open punch items are grouped by **location** (room, floor, or zone as tagged on each item).
1. Work through each location in sequence — tap an item to mark it complete, add a photo, or reassign it.
1. When every item in a location is resolved, the location collapses and disappears from the walkthrough list.

> **Screenshot placeholder:** Walkthrough view showing location groups with open punch items listed beneath each one.

---

## Exporting the closeout package

When all checklist items show **Ready**, you can generate the owner's handover package.

1. Click **Export Package** at the top right of the Closeout tab.
1. The system builds a ZIP file containing every attached document, verifies the archive's integrity, and uploads it to secure storage. Status changes from **Building** to **Ready** within a few seconds for typical packages (larger sets may take up to a minute).
1. When status shows **Ready**:
   - Click **Download** to retrieve the package immediately via a signed link (valid for 5 minutes).
   - If the link expires, revisit the Closeout tab and click **Download** again — a fresh link is generated each time.
1. If the export **fails**, the status shows **Failed** with an error message. No partial archive is stored. Click **Export Package** again to retry.

> **Screenshot placeholder:** Export card showing status badge cycling from Building → Ready, and the Download button.

**What's inside the ZIP:**
- One folder per checklist category.
- All documents attached to items in that category.
- A machine-readable `manifest.json` listing every file with its SHA-256 checksum, source category, and the date it was attached.

---

## Sharing the package with the owner

The signed download URL from the **Download** button can be pasted directly into an email or a project-closeout email template. The recipient does not need a SmartManageAI account — the signed URL grants temporary, read-only access to the file.

For long-term delivery, copy the **Download endpoint** URL (shown in the export card) and send it to the owner. They can request a fresh signed link at any time as long as the package exists in storage.

---

## Tips

- You can re-export at any time — each export creates a new, independently verified package. Previous packages remain downloadable.
- To create a custom checklist template for all future projects of a given type, go to **Settings → Closeout Templates** and build a template there. New projects using that template will pre-populate with your custom items instead of the system defaults.
- Items marked **Ready** can still be updated — just upload a revised document and the new version is included in the next export.

---

Need more help? Use the **?** widget to open a support ticket. See [/sla](/sla) for response-time targets by plan.
