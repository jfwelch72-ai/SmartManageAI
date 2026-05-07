#!/usr/bin/env node
// One-shot generator for the help-center library. Each entry has a real,
// task-specific walkthrough — not a template. Re-run after edits to refresh
// the on-disk Markdown.

import { writeFile } from "fs/promises";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const HELP_DIR = join(__dirname, "..", "docs", "help");

const ARTICLES = {
  "getting-started": {
    title: "Getting started with SmartManageAI",
    intro: "A 10-minute tour from a fresh login to a production-ready workspace.",
    steps: [
      "Sign in at /login. Your first sign-in lands on /dashboard with the onboarding checklist open.",
      "Open Company Settings → Profile. Set your legal name, EIN, default address, logo, and primary trade. The trade controls which dashboards and AI suggestions appear by default.",
      "From the checklist, click *Invite teammates* and add at least one Project Manager and one Field user. Each gets an email invite and a temporary password.",
      "Open *Projects* and create one sample project so the dashboard tiles populate with real data instead of empty states.",
      "Visit *Integrations* and connect QuickBooks/Sage if you do accounting outside SmartManageAI — this enables the 3-way match and AIA billing exports.",
    ],
    tips: [
      "The onboarding checklist on /dashboard hides itself once every step is done. You can re-open it any time from *Help → Setup checklist*.",
      "If you don't see a feature you expect, check Company Settings → Feature flags. Some advanced modules (BIM, LiDAR, AI Estimator) are gated per-plan.",
    ],
    troubleshooting: [
      "**I can't see Field users on the time-clock map** — confirm each user has a role of *Field* and a phone with location permission, then ask them to clock in once to register their device.",
    ],
  },

  "invite-team": {
    title: "Invite teammates and assign roles",
    intro: "Add new users, pick the right role, and (optionally) restrict them to specific projects.",
    steps: [
      "Go to /company-settings → *Users*.",
      "Click *Invite user*. Enter an email and pick a role: Admin, Project Manager, Field, Estimator, Accounting, or Subcontractor.",
      "(Optional) Under *Project access*, switch from *All projects* to *Selected projects* to scope the invite — useful for subs you only want on one job.",
      "Click *Send invite*. The user receives an email with a one-time link that expires in 72 hours.",
      "Re-send or revoke the invite from the same Users table at any time.",
    ],
    tips: [
      "Roles are additive: a user can be both *Field* and *Estimator*. Permissions are the union of both roles.",
      "*HUSTLER* and *SUPER_ADMIN* are internal roles for SmartManageAI staff and are not visible in the customer Users table.",
    ],
    troubleshooting: [
      "**Invite never arrived** — ask the user to check spam, then re-send. If still missing, copy the link from the Users → ⋮ menu and share it directly.",
    ],
  },

  "create-project": {
    title: "Create your first project",
    intro: "Spin up a project with the right template, address, and team in under two minutes.",
    steps: [
      "Open /projects and click *New project*.",
      "Pick a template (Commercial / Residential / Civil) — this seeds the cost-code list, default schedule milestones, and document folder structure.",
      "Fill in *Project name*, *Site address*, *Owner / GC contact*, and *Contract amount* if known. The address is what powers the weather widget and the GPS geofence for time-clock.",
      "Assign a Project Manager and (optionally) a default Superintendent. Both will receive RFI / submittal / daily-report notifications.",
      "Click *Create*. You'll land on the new project's *Overview* tab with all the side-tabs (Bids, Schedule, Daily Reports, etc.) ready.",
    ],
    tips: [
      "You can change the template-seeded cost codes from *Project → Financial → Cost Codes* later — nothing is locked in.",
    ],
    troubleshooting: [
      "**No templates show up** — your org's admin disabled them. Ask them to re-enable templates under *Company Settings → Project templates*.",
    ],
  },

  "project-detail": {
    title: "Navigate the Project workspace",
    intro: "Each project is a single page with side-tabs for every workflow. Here's where each one lives.",
    steps: [
      "*Overview* — KPIs, recent activity, and the Live Profitability tile.",
      "*Schedule* — CPM Gantt with critical path, baseline compare, and PDF export.",
      "*Daily Reports* — file from the field or web; supports photos, weather auto-fill, and crew time.",
      "*RFIs / Submittals* — full pipeline with external assignees and overdue alerts.",
      "*Procurement* — POs, vendor invoices, and 3-way match.",
      "*Financial* — Schedule of Values, AIA billings, change orders, retention, lien waivers.",
      "*Documents* — versioned plan sets, contracts, and BIM/IFC files.",
    ],
    tips: [
      "The tab order is configurable per-organization — Admins can reorder it under *Company Settings → Project tabs*.",
      "Press `g` then a tab letter (e.g. `gs` for Schedule) when focused on the project workspace for keyboard navigation.",
    ],
  },

  "submit-bid": {
    title: "Build and submit a bid",
    intro: "The 6-step bid workflow walks you from RFP capture to a sealed PDF proposal.",
    steps: [
      "*Bids → New bid*. Attach the RFP PDF and the project plans.",
      "Step 1 *Documents*: tag each upload as *RFP*, *Plans*, *Specifications*, or *Addenda* so AI parsing knows what to do.",
      "Step 2 *Takeoff*: open the integrated takeoff workspace, set the page scale, and run the measurements you need (linear, area, count).",
      "Step 3 *Estimate*: pick assemblies from the catalog. Quantities flow in from the takeoff automatically.",
      "Step 4 *Vendors / RFQs*: send RFQs for any line item without a current price. Vendor responses populate the unit costs.",
      "Step 5 *Markup*: apply OH&P, contingency, and bond rates. Live profitability updates per division.",
      "Step 6 *Proposal*: pick a proposal template, review the rendered PDF, and click *Send* to email it to the owner.",
    ],
    tips: [
      "Toggle *AI Estimator* in step 3 to draft a complete estimate from the takeoff — review every line before submitting.",
      "Versioned bids let you respond to an addendum without losing the original numbers — duplicate the bid and start from step 4.",
    ],
  },

  "takeoff-basics": {
    title: "Run a quick PDF takeoff",
    intro: "Set scale, measure, and tag each measurement against a cost code.",
    steps: [
      "Open a bid → *Takeoff* tab → upload a PDF plan set (single file, up to 32 GB).",
      "Once the sheet thumbnails appear, click the sheet you want to measure.",
      "Click the *Calibrate* tool, then click two points on a known dimension (e.g. a 20'-0\" line). Type `20` ft. Scale is now locked for this sheet.",
      "Pick a tool — *Linear*, *Area*, *Count*, or *Volume* — and start measuring. Each measurement appears in the right-hand panel with quantity and unit.",
      "Right-click any measurement to assign a cost code or assembly. Quantities flow into the estimate the moment you tag them.",
    ],
    tips: [
      "Hold `Shift` while drawing to constrain a line to 0° / 45° / 90°.",
      "Each sheet remembers its own scale — re-calibrating one sheet does not affect another.",
      "Use *Copy to similar sheets* on the right-click menu to broadcast a measurement across all sheets that share a layout (e.g. typical floor plates).",
    ],
    troubleshooting: [
      "**Tiles look blurry on a large PDF** — the renderer is still streaming high-res tiles. Wait 10–15 seconds; quality improves as more of the file downloads.",
    ],
  },

  "ai-estimator": {
    title: "Use the AI Estimator",
    intro: "Draft a full estimate from a plan set in minutes; you stay in control of every line.",
    steps: [
      "Open a bid with at least one PDF in the Documents step.",
      "Open the *Estimate* step and click *AI Estimate from plans*.",
      "Pick the trades you want included (the sheet-index classifier already labelled each sheet as G/A/S/M/E/P/etc., so the picker only shows trades present in the set).",
      "(Optional) Limit to a subset of plan documents and a region of interest. Click *Generate*.",
      "Review the draft. Each line shows its source sheet, a confidence score, and the assembly used. Accept, edit, or reject lines individually or in bulk.",
      "When you're satisfied, click *Apply to estimate*. Lines are added; you can keep editing manually.",
    ],
    tips: [
      "Org-level factors (waste %, productivity, regional cost index) live under *Settings → AI Estimator factors*. Tune them once and every draft inherits them.",
      "Routing to OpenAI vs. Anthropic Claude is controlled by the `AI_PROVIDER_TAKEOFF` feature flag.",
    ],
  },

  "change-orders": {
    title: "Create and approve change orders",
    intro: "Track scope changes from request through approval and into billing.",
    steps: [
      "Open the project → *Change Orders → New*.",
      "Pick *Type* (Owner CO, Subcontract CO, or Internal).",
      "Add line items. Each line is a cost code + quantity + unit cost; the contract value updates automatically.",
      "Attach supporting documents (RFI thread, sub quote, sketch).",
      "Send for approval. The CO appears in the owner's queue (*Approvals* tab) — they sign electronically.",
      "Once approved, the CO posts to the SOV and the GMP/contract value updates everywhere (forecast, AIA billing, profitability).",
    ],
    tips: [
      "Internal COs don't go to the owner — use them to record scope shifts that don't change contract value.",
      "If the owner uses email-only signoff, switch *Approval mode* to *Email* — they get a one-click approval link with no login.",
    ],
  },

  "schedule-of-values": {
    title: "Manage the Schedule of Values",
    intro: "The SOV is the source of truth for your billings and your forecast.",
    steps: [
      "Open *Project → Financial → Schedule of Values*.",
      "Either import from a CSV (template available in the import dialog) or build line-by-line. Each line has *Cost code*, *Description*, *Scheduled value*, *Retention %*.",
      "Lock the SOV when the owner has signed off — locked rows can still receive billings but their values can't change without an approved CO.",
      "Each AIA billing pulls from the locked SOV automatically; previously billed amounts and retention are calculated for you.",
    ],
    tips: [
      "Use *Group by division* to keep large SOVs readable (16-division CSI by default; configurable).",
      "Need to split one SOV line into two? Use *Reapportion* — it preserves billed-to-date totals across the new lines.",
    ],
  },

  "aia-billing": {
    title: "Send AIA progress billings",
    intro: "Generate G702/G703 PDFs against the SOV, get owner sign-off, and post to A/R.",
    steps: [
      "*Project → Financial → AIA Billings → New billing*.",
      "Pick the billing period (defaults to month-to-date).",
      "For each SOV line, enter *% complete this period* or *Stored materials*. Retention applies automatically per line.",
      "Click *Preview*. Review the rendered G702 / G703 — page numbers, totals, and stored-material columns are calculated.",
      "Click *Send for owner signature*. The owner signs electronically; once signed, the billing is locked and posts to A/R.",
    ],
    tips: [
      "If your owner requires the AIA Document logo, upload your AIA license under *Company Settings → Branding* and the watermark is added automatically.",
      "Toggle *Apply lien waivers* in the send dialog to require conditional / unconditional waivers from each sub before posting their pay app.",
    ],
  },

  "time-clock": {
    title: "Clock in / out and approve time",
    intro: "Field clocks in from the mobile app; managers approve weekly time on the web.",
    steps: [
      "Field crew: open the mobile app → *Time clock* → tap *Clock in*. The app captures GPS, geofence status, and a face/badge photo if your org requires one.",
      "During the shift, *Switch cost code* moves time between activities without clocking out.",
      "*Clock out* at the end of the day. If the geofence wasn't satisfied, the entry is flagged for the manager.",
      "Manager: open /time-clock-manager. Each user shows weekly hours bucketed by cost code.",
      "Approve a row to push it into payroll; reject (with a reason) to send it back for the user to fix.",
    ],
    tips: [
      "Overtime rules are configurable per-org (daily, weekly, or California-style 8/12) — set them under *Company Settings → Payroll rules*.",
      "Use *Bulk approve* to clear an entire crew once you've spot-checked the outliers.",
    ],
    troubleshooting: [
      "**A clock-in is flagged for geofence violation but the user was on site** — check the project's geofence radius (defaults to 300 ft). Increase it or shift the centroid in *Project → Settings → Geofence*.",
    ],
  },

  "daily-reports": {
    title: "File a daily report",
    intro: "Capture crew, weather, photos, and notes for every project, every day.",
    steps: [
      "Open the project → *Daily Reports → New report* (or use the mobile app, which works offline).",
      "Date is set to today; weather auto-fills from the project address.",
      "Add crews — each crew row records hours, headcount, and the cost code worked.",
      "Add notes (delays, deliveries, visitors). The Markdown editor accepts inline images.",
      "Attach photos. The mobile app uploads in the background once it's back online.",
      "Click *Submit*. The report is emailed to subscribers (configured under *Project → Settings → Email distribution*).",
    ],
    tips: [
      "Use the *Voice note* field on mobile — the transcript becomes the report body, ready to edit.",
      "Schedule the daily report email to send automatically each evening under *Project → Settings → Daily report schedule*.",
    ],
  },

  "rfis-submittals": {
    title: "Manage RFIs and submittals",
    intro: "Pipelines for both RFIs and submittals support external assignees and overdue alerts.",
    steps: [
      "Open the project → *RFIs* (or *Submittals*) → *New*.",
      "Pick a recipient. Internal users get the RFI in their queue; external recipients get an email with a one-click link (no login required).",
      "Set *Required by* to enable overdue tracking. Two reminders go out before the due date and a daily reminder after.",
      "Attach drawings, photos, or PDFs. Markups added in the plan viewer can be linked directly to the RFI.",
      "Recipient answers in the portal. Their response is recorded in the audit trail and the RFI is marked *Closed*.",
    ],
    tips: [
      "Convert an answered RFI into a Change Order in one click from the RFI detail page — line items pre-populate from the response.",
      "Submittal review chains support multi-stage approval (Architect → Engineer → Owner) with automatic forwarding.",
    ],
  },

  "client-portal": {
    title: "Share progress in the client portal",
    intro: "Give the owner a read-only view of schedule, photos, billings, and documents.",
    steps: [
      "Open the project → *Client portal → Invite client*.",
      "Add the client's email and pick which sections they should see (Schedule, Daily Reports, Photos, Billings, Documents). Defaults to all of the above except internal cost data.",
      "Click *Send invite*. The client gets a magic-link email; no password required.",
      "From the same page you can revoke or re-send the invite, and view a log of every page they viewed.",
    ],
    tips: [
      "The portal lives at /portal — bookmark-friendly for the client.",
      "Use *Brand portal* under *Company Settings → White-label* to push your logo and colors into the portal so it feels like your site.",
    ],
  },

  "subcontractor-portal": {
    title: "Onboard subcontractors via the portal",
    intro: "Subs upload insurance, sign the master agreement, and accept work orders without a SmartManageAI login.",
    steps: [
      "Open *Vendors → Subs → New sub* and add the company's email.",
      "Click *Send onboarding link*. The sub lands at /portal and is walked through: company info → COI upload → W-9 upload → master subcontract signature.",
      "Each upload is verified server-side (file type, page count, expiration date for COI).",
      "Once complete, the sub appears as *Onboarded* in the Vendors table and can be assigned to subcontracts and POs.",
    ],
    tips: [
      "If a sub's COI is about to expire, the compliance dashboard surfaces it 30 days out and they get a self-service re-upload link.",
    ],
  },

  "vendor-pricing": {
    title: "Sync vendor pricing catalogs",
    intro: "Keep unit costs current by importing vendor catalogs and tagging them by region.",
    steps: [
      "Open /vendor-pricing → *Import catalog*.",
      "Drop a CSV (template provided) or a vendor's Excel price list. Columns are auto-mapped; review the mapping before confirming.",
      "Tag the catalog with *Vendor*, *Effective date*, and *Region*. Estimates pick the most recent catalog for the project's region automatically.",
      "Re-import any time — old prices become *Historical* and stop populating new estimates.",
    ],
    tips: [
      "Catalogs support unit conversions (LF → CY, EA → BX). Set the conversion factor once per item.",
    ],
  },

  "compliance-dashboard": {
    title: "Track compliance and expirations",
    intro: "One screen for COIs, W-9s, business licenses, OSHA training, and more.",
    steps: [
      "Open /compliance.",
      "Filter by *Type*, *Vendor*, or *Days until expiration*. The default view shows everything expiring in the next 60 days.",
      "Click any row to see the document, the expiration date, and the contact for renewal.",
      "Use *Send reminder* to email the vendor a self-service re-upload link.",
    ],
    tips: [
      "Compliance categories are configurable per-org — add custom ones (e.g. *Bonding capacity letter*) under *Company Settings → Compliance categories*.",
    ],
  },

  "mobile-offline": {
    title: "Use the mobile app offline",
    intro: "The mobile app works fully offline and syncs in the background when reception returns.",
    steps: [
      "Before heading to a no-signal site, open the app and tap *Sync now* on the home screen. This pre-downloads your assigned projects, current daily reports, and active RFIs.",
      "While offline, file daily reports, take photos, fill out punch list items, clock in/out, and answer RFIs. Each action is queued locally.",
      "When the device reconnects, the queue drains automatically. The home screen shows *Pending sync: N* until everything is uploaded.",
      "If a conflict happens (e.g. someone edited the same RFI on the web), the app shows a side-by-side diff and you pick the winner.",
    ],
    tips: [
      "Photos are queued at full resolution but uploaded in batches to conserve battery and data.",
      "View /mobile-sync on the web to see the same queue from a manager's perspective.",
    ],
  },

  "messaging": {
    title: "Message coworkers, clients, and subs",
    intro: "Unified inbox for direct messages, project channels, and external chat with subs/clients.",
    steps: [
      "Open /messages.",
      "*New conversation* lets you pick anyone in your org or any external contact (sub, client, vendor).",
      "Project channels are auto-created per project — anyone assigned to the project is a member.",
      "Drag a file into the message box to share it. Files attached here also appear under the project's *Documents* tab.",
    ],
    tips: [
      "Mention someone with `@` to send them a notification even if they've muted the channel.",
      "External recipients get an email with the message and a reply link — they don't need a login.",
    ],
  },

  "approvals": {
    title: "Approve work in your queue",
    intro: "Change orders, time entries, POs, vendor invoices, and lien waivers all funnel into one queue.",
    steps: [
      "Open /approvals. The default view shows everything assigned to you.",
      "Click an item to see the full record (the CO line items, the time entry geo-trail, the PO and matched invoice, etc.).",
      "*Approve*, *Reject* (with reason), or *Request changes* (sends it back to the originator with notes).",
      "Use the *Bulk approve* checkbox to clear straightforward items in one pass.",
    ],
    tips: [
      "Approval chains (multi-step) are configurable in the no-code Workflow Builder.",
    ],
  },

  "calendar": {
    title: "Plan with the project calendar",
    intro: "Combined calendar across all your projects with filters and iCal export.",
    steps: [
      "Open /calendar.",
      "Filter by project, event type (milestones, deliveries, inspections, time-off), and assignee.",
      "Click + to add an event. Events created here also appear on the related project schedule.",
      "Subscribe via iCal — *Settings → Personal → iCal feed* — to mirror the calendar into Google / Outlook.",
    ],
  },

  "tasks": {
    title: "Track tasks across projects",
    intro: "A personal task list and a per-project task list share the same engine.",
    steps: [
      "Open /my-work for your personal queue or /tasks for the cross-project view.",
      "*New task* — set assignee, due date, priority, and (optional) related project / RFI / submittal.",
      "Status pipeline is configurable per-org under *Company Settings → Task pipelines* (defaults: Open → In Progress → Blocked → Done).",
    ],
    tips: [
      "Tasks created from a daily report or RFI keep a back-link so you can jump to context with one click.",
    ],
  },

  "crm-deals": {
    title: "Move deals through the CRM pipeline",
    intro: "A 7-stage pipeline for converting leads into signed contracts.",
    steps: [
      "Open /crm → *Deals*.",
      "Drag a deal across the pipeline stages: Lead → Qualified → Estimating → Proposal Sent → Negotiation → Won → Lost.",
      "Each card shows owner, value, expected close date, and the next activity. Click for the full detail (notes, calls, emails, meetings).",
      "When a deal hits *Won*, click *Convert to project* to spin up a project with the deal's contacts, value, and notes pre-filled.",
    ],
    tips: [
      "Stage transitions can trigger notifications, document generation, or task creation via the Workflow Builder.",
    ],
  },

  "crm-leads": {
    title: "Capture leads with public forms",
    intro: "Embed lead-capture forms on your marketing site or share them as a public link.",
    steps: [
      "Open /crm → *Forms → New form*.",
      "Drag fields onto the canvas (text, email, phone, dropdown, file upload, signature).",
      "Set the routing rules: which CRM owner gets the lead, which pipeline stage to drop it into, and what email to send the lead in confirmation.",
      "Publish. You get an embed snippet and a public URL.",
    ],
    tips: [
      "Forms support hCaptcha and honeypot fields automatically — no spam config needed.",
    ],
  },

  "ai-cfo": {
    title: "Read the AI CFO insights",
    intro: "Daily-refreshed AI commentary on your portfolio's cashflow, margin, and risk.",
    steps: [
      "Open /dashboard. The AI CFO card sits in the top-right.",
      "It surfaces three things every day: *projects at margin risk*, *cashflow gaps in the next 60 days*, and *unusual cost variances vs. estimate*.",
      "Click any insight to drill into the underlying data (the offending project, the variance breakdown).",
      "Use *Snooze* to dismiss an insight for 7 days if it's a known/accepted situation.",
    ],
    tips: [
      "The model only ingests aggregate KPIs from your org — it never sees customer or financial detail outside your tenant.",
    ],
  },

  "scheduling": {
    title: "Build a CPM schedule",
    intro: "Build dependencies, set baselines, and export a print-quality Gantt PDF.",
    steps: [
      "Open the project → *Schedule*.",
      "Add tasks. Each task has duration, predecessors (FS, SS, FF, SF), and an optional resource.",
      "Run *Calculate critical path*. The critical chain is highlighted in red.",
      "Set a baseline (*Baseline → Save current as baseline*). Future views show a baseline-vs-actual delta band.",
      "*Export PDF* renders a print-quality Gantt sized to your paper choice.",
    ],
    tips: [
      "Imports support MS Project XML and Primavera XER files.",
      "Drag a task on the Gantt to reschedule; predecessors update automatically.",
    ],
  },

  "dispatch-board": {
    title: "Dispatch crews and equipment",
    intro: "A drag-and-drop board for tomorrow's crews, foremen, and shared equipment.",
    steps: [
      "Open /dispatch-board.",
      "Each row is a project; each column is the next 7 days.",
      "Drag a crew (or piece of equipment) onto a project/day cell. Conflicts (over-assigned crew, equipment in the shop) are flagged in red.",
      "Click *Publish* to push the dispatch to each crew's mobile home screen — they see their next-day assignment as soon as it's published.",
    ],
    tips: [
      "Use *Templates* to repeat a typical crew layout from week to week.",
    ],
  },

  "equipment": {
    title: "Track equipment and maintenance",
    intro: "Asset register with utilization, maintenance schedule, and rental tracking.",
    steps: [
      "Open /equipment.",
      "Add a piece of equipment: type, serial, owned/rented, hour-meter or odometer, location.",
      "Schedule preventive maintenance (every X hours / miles / days). Upcoming PMs appear on the maintenance dashboard.",
      "Field users can log fuel, hours, and breakdowns from the mobile app — entries automatically debit the project they're assigned to.",
    ],
    tips: [
      "Rental returns generate a reminder 7 days before the rental end-date so you don't get hit with extension fees.",
    ],
  },

  "haul-tickets": {
    title: "Log haul tickets and mass haul",
    intro: "Capture every load with truck #, material, weight/volume, and origin/destination.",
    steps: [
      "Open /haul-tickets.",
      "*New ticket* — pick truck, project, material, and unit (TON, CY, LD).",
      "Quantity comes from the scale (manual entry or a connected scale via the Integrations module).",
      "Sign with finger or stylus on the mobile app — both driver and operator signatures are stored on the ticket.",
      "Reports roll up per project / per material / per haul direction for DOT submittals.",
    ],
    tips: [
      "Calibrate scales periodically — *Equipment → Scales → Calibration*. Out-of-calibration scales block ticket creation.",
    ],
  },

  "dbe-goals": {
    title: "Track DBE goals and certifications",
    intro: "Monitor DBE participation against project goals; export the certified report for the agency.",
    steps: [
      "Open /dbe-goals.",
      "Each project shows the goal % and the actual DBE participation calculated from subcontracts and POs.",
      "Drill into a project to see the per-vendor breakdown: certifying agency, certification expiration, and dollars committed/paid.",
      "*Export agency report* generates the form your funding agency requires (FHWA, state DOT, etc.).",
    ],
    tips: [
      "Certifications nearing expiration appear in the compliance dashboard so you can renew before the project closeout report.",
    ],
  },

  "surety-bonds": {
    title: "Manage surety bonds",
    intro: "Track bid, performance, and payment bonds against bonding capacity.",
    steps: [
      "Open /surety-bonds.",
      "Add bonds: type (Bid/Performance/Payment), surety, premium, principal amount, and expiration.",
      "The capacity tile shows *Bonded backlog vs. aggregate capacity* so you can see remaining headroom at a glance.",
      "Renewal alerts fire 60 days before expiration.",
    ],
  },

  "swppp-inspections": {
    title: "Run SWPPP inspections",
    intro: "Weekly and post-rain SWPPP inspections with photo evidence and corrective actions.",
    steps: [
      "Open /swppp-inspections → *New inspection*.",
      "Inspection type defaults based on weather (post-rain if NWS reports >0.25\" rain in last 24h).",
      "Walk the BMPs. For each control, mark *Pass* or *Issue* and (if an issue) attach photos and a corrective action with assignee + due date.",
      "Submit. The inspection is logged with timestamps; corrective actions appear in the responsible person's task queue.",
    ],
    tips: [
      "Overdue inspections trigger reminders to the project manager and (configurably) the safety officer.",
    ],
  },

  "material-certifications": {
    title: "Upload material certifications",
    intro: "Capture cert sheets per delivery so DOT submittals stay airtight.",
    steps: [
      "Open /material-certifications → *New certification*.",
      "Enter material spec (DOT pay-item or your own catalog), supplier, lot number, and quantity.",
      "Upload the cert PDF. The system OCRs the heat number and lot to make later searches easy.",
      "Tie the certification to a project and (optionally) a specific haul ticket.",
    ],
  },

  "ai-document-analysis": {
    title: "Let AI summarize a contract or bid",
    intro: "Turn a 200-page contract into a one-page summary with risk flags.",
    steps: [
      "Open the document (contract, bid, or specification) inside any project.",
      "Click *AI summarize*. Pick a profile: *Risk*, *Scope*, *Schedule*, or *Custom prompt*.",
      "The summary appears alongside the document with each claim back-linked to the source page/paragraph.",
      "Click any flagged risk to jump to the offending clause.",
    ],
    tips: [
      "Use *Compare* on two versions of the same contract to see redlines plus an AI commentary on what changed and why it might matter.",
    ],
  },

  "ai-scheduling": {
    title: "Auto-generate a schedule with AI",
    intro: "Generate a CPM schedule from a project type, scope, and target completion date.",
    steps: [
      "Open the project → *Schedule → AI generate*.",
      "Pick a template (Commercial TI, Single-family, Highway, Bridge, etc.) and confirm the start date and key milestones.",
      "The AI proposes tasks with durations and dependencies. Review the diff before applying.",
      "Click *Apply* — tasks are created on your schedule, you take it from there.",
    ],
    tips: [
      "AI durations come from your org's historical data when available; otherwise it falls back to industry medians.",
    ],
  },

  "vendors-rfqs": {
    title: "Send and track RFQs to vendors",
    intro: "Solicit quotes from multiple vendors at once and compare side-by-side.",
    steps: [
      "Open the project → *Procurement → RFQs → New*.",
      "Add line items (or pull from the estimate).",
      "Pick vendors. They get an email with a one-click response link.",
      "As responses come in, the comparison grid shows side-by-side unit prices, lead time, and total.",
      "Click *Award* on a vendor to convert the RFQ to a PO automatically.",
    ],
  },

  "procurement": {
    title: "Run 3-way match procurement",
    intro: "Purchase order → goods receipt → vendor invoice. The match is automatic.",
    steps: [
      "Issue a PO from an awarded RFQ or directly under *Project → Procurement*.",
      "When materials arrive, the field receives them on the mobile app — quantities and a delivery photo are captured.",
      "When the vendor invoice arrives, drop the PDF into *AP Inbox*. The system OCRs and matches it against the PO and receipt.",
      "Variances over the configured tolerance flag the invoice for review; clean matches auto-post to A/P.",
    ],
    tips: [
      "Tolerance is configured per-org under *Company Settings → AP rules* (default ±2% on price, ±5% on quantity).",
    ],
  },

  "lien-waivers": {
    title: "Collect and store lien waivers",
    intro: "Conditional and unconditional waivers tied to each pay app and each sub.",
    steps: [
      "When you send an AIA billing, toggle *Require lien waivers* to require subs to upload signed waivers before their portion of the pay app is paid.",
      "Subs receive an email with the waiver template (your jurisdiction is auto-detected); they sign electronically.",
      "Signed waivers appear under *Project → Financial → Lien waivers* and are attached to the corresponding pay app.",
    ],
  },

  "retention": {
    title: "Manage retention and releases",
    intro: "Track withheld retention by project and release it at substantial / final completion.",
    steps: [
      "Open *Project → Financial → Retention*.",
      "The dashboard shows withheld retention per pay app and per sub.",
      "*Release retention* lets you release in part (e.g. at substantial completion) or in full (final).",
      "Released retention flows to the next AIA billing automatically.",
    ],
  },

  "certified-payroll": {
    title: "Generate certified payroll reports",
    intro: "Produce DOL WH-347 and state-specific certified payroll reports.",
    steps: [
      "Open /payroll → *Certified payroll → Generate*.",
      "Pick the project and pay period. The system pulls approved time entries and matches each worker to their Davis-Bacon classification.",
      "Review fringe benefit splits. Non-union shops can pay fringes as cash; union shops use the trust contributions.",
      "*Generate* renders a WH-347 (and any state form your project requires). Sign electronically and submit.",
    ],
    tips: [
      "Classification mappings (DOL → your roles) live under *Company Settings → Classifications* and only need to be set once.",
    ],
  },

  "leave-management": {
    title: "Request and approve leave",
    intro: "PTO, sick, jury, bereavement — request, balance, and accrual all in one place.",
    steps: [
      "Open /leave-management.",
      "*Request leave* — pick type, dates (full or partial day), and reason.",
      "Manager gets the request in their /approvals queue. Approval pushes the leave onto the project calendar and pre-blocks the time-clock.",
      "Balances and accruals are visible to the user in real time.",
    ],
  },

  "kpi-templates": {
    title: "Score teams with KPI templates",
    intro: "Standardized KPI templates per role, scored monthly.",
    steps: [
      "Open /kpi.",
      "Pick a template (Field Foreman, Project Manager, Estimator, Office Admin) — or build a custom one.",
      "Each metric has a weight, a source (manual or auto-pulled from project data), and a target.",
      "Run the *Monthly score* job to compute scores; managers review and adjust before publishing to the team.",
    ],
  },

  "white-label-website": {
    title: "Publish your white-label website",
    intro: "Spin up a marketing site at your own domain, fully branded, in under an hour.",
    steps: [
      "Open /site.",
      "Pick a template, drop in your logo, set primary/secondary brand colors. Live preview updates instantly.",
      "Add pages: Home, Services, Projects, About, Contact (forms route to your CRM).",
      "Connect a custom domain — *Settings → Domain* — and follow the DNS instructions. SSL is provisioned automatically.",
    ],
    tips: [
      "Project case studies pull from your real projects (with photos and stats) once you mark them *Public*.",
    ],
  },

  "feature-flags": {
    title: "Toggle features per organization",
    intro: "Super Admins enable/disable modules per tenant via feature flags.",
    steps: [
      "Open /admin → *Feature flags*.",
      "Search for the flag (e.g. `AI_PROVIDER_TAKEOFF`, `BIM_VIEWER`).",
      "Toggle per-organization or set a default. Changes are audit-logged.",
      "Use *Presets* to apply a bundle of flags (e.g. *Enterprise plan*) in one click.",
    ],
    tips: [
      "Customers don't see the flag UI — only Super Admins do. Customer-visible toggles live in Company Settings.",
    ],
  },

  "data-import": {
    title: "Import data from CSV or other systems",
    intro: "Bulk-load projects, contacts, vendors, cost codes, and historical estimates.",
    steps: [
      "Open *Company Settings → Data import*.",
      "Pick the entity (Projects, Contacts, Vendors, Cost codes, Estimates).",
      "Download the template CSV, fill it out, and upload. The mapping screen lets you confirm/override each column.",
      "Click *Validate* to dry-run. Errors are reported per row; fix and re-upload before committing.",
    ],
    tips: [
      "QuickBooks, Procore, and Sage exports have one-click presets — no manual mapping needed.",
    ],
  },

  "integrations": {
    title: "Connect QuickBooks, Sage, and more",
    intro: "Provider-agnostic Integrations Hub for accounting, email, calendar, telephony, and storage.",
    steps: [
      "Open /integrations.",
      "Click the provider tile (e.g. QuickBooks Online). Sign in via OAuth — credentials never leave the provider.",
      "Map your accounts: AR, AP, COGS, Bank, and the cost-code ledger.",
      "Pick sync direction: *Push* (SmartManageAI → provider), *Pull*, or *Two-way*.",
      "Hit *Save*. The first sync runs immediately; subsequent syncs are scheduled (defaults to every 15 min).",
    ],
    tips: [
      "Each integration is gated behind a feature flag so Super Admins can pilot it before opening it to all users.",
    ],
  },

  "notifications": {
    title: "Tune your notification preferences",
    intro: "Per-channel (email, push, in-app, SMS) and per-event preferences.",
    steps: [
      "Open /profile → *Notifications*.",
      "For each event (RFI assigned, daily report submitted, time-clock approval, etc.), pick the channels you want.",
      "Set quiet hours (e.g. 8 PM – 7 AM). Notifications during quiet hours batch into a digest.",
      "*Test notification* sends a sample to confirm your settings work end-to-end.",
    ],
  },

  "sso-security": {
    title: "Enable SSO and security policies",
    intro: "SAML / OIDC SSO, password policy, MFA, and session controls.",
    steps: [
      "Open *Company Settings → Security → SSO*.",
      "Pick your IdP (Okta, Azure AD, Google Workspace, generic SAML/OIDC).",
      "Paste the metadata URL or upload the metadata XML. Map IdP groups to SmartManageAI roles.",
      "Test with *Run SSO test*. Once passing, flip *Require SSO for all users* — non-SSO logins are rejected from then on.",
    ],
    tips: [
      "MFA, password length, and session timeout are configured under *Security → Policies* — independently of SSO for orgs that don't use SSO.",
    ],
  },

  "billing-plans": {
    title: "Manage billing and plan tier",
    intro: "Switch plans, update payment method, and download invoices.",
    steps: [
      "Open /billing.",
      "Current plan, seats in use, and the next renewal date are at the top.",
      "*Change plan* — pick Starter, Pro, or Enterprise. Pro-rated charges/credits show before you confirm.",
      "*Payment method* — replace the card or add an ACH source.",
      "Past invoices are downloadable as PDF.",
    ],
    tips: [
      "Annual billing gets a 15% discount vs. monthly; the toggle is in the plan selector.",
      "Plan tier directly drives your support SLA — see /sla for details.",
    ],
  },

  "support-and-sla": {
    title: "Get support and read the SLA",
    intro: "Where to file a ticket, what response times to expect, and how to reach an on-call engineer.",
    steps: [
      "Click the *?* button at the bottom-right of any page to open the in-app Help widget.",
      "*Articles* tab shows context-aware suggestions for the page you're on. Search anything across all 50+ help articles.",
      "*Contact* tab opens a ticket with your org, page, and browser auto-attached.",
      "Or visit /help for the public help center and /sla for the tiered SLA targets.",
      "For platform-wide outages, check the status page linked from the widget footer.",
    ],
    tips: [
      "Pro and Enterprise plans get faster first-response and resolution targets — see /sla for the table.",
      "Enterprise customers can request an on-call escalation contact via their CSM.",
    ],
  },
};

function render(article) {
  const lines = [];
  lines.push(`# ${article.title}`);
  lines.push("");
  lines.push(article.intro);
  lines.push("");
  lines.push("## How to do it");
  lines.push("");
  for (const s of article.steps) lines.push(`1. ${s}`);
  if (article.tips?.length) {
    lines.push("");
    lines.push("## Tips");
    lines.push("");
    for (const t of article.tips) lines.push(`- ${t}`);
  }
  if (article.troubleshooting?.length) {
    lines.push("");
    lines.push("## Troubleshooting");
    lines.push("");
    for (const t of article.troubleshooting) lines.push(`- ${t}`);
  }
  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push("Need more help? Use the *?* widget at the bottom-right of any page to open a support ticket. See [/sla](/sla) for response-time targets by plan.");
  lines.push("");
  return lines.join("\n");
}

const slugs = Object.keys(ARTICLES);
let written = 0;
for (const slug of slugs) {
  await writeFile(join(HELP_DIR, `${slug}.md`), render(ARTICLES[slug]), "utf8");
  written++;
}
console.log(`Wrote ${written} help articles to ${HELP_DIR}`);
