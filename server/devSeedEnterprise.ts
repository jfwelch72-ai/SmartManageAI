import { Router } from "express";
import { requireAuth } from "./auth";
import { db } from "./db";
import {
  organizations,
  organizationSubscriptions,
  organizationAddOns,
  integrationConnections,
  aiActionAudit,
  approvalRequests,
  documentRevisions,
  projectHealthSnapshots,
  projects,
  users,
  crmOrganisations,
  crmContacts,
  crmOpportunities,
  crmOpportunityActivities,
  crmTasks,
  crmQuotes,
  crmQuoteLineItems,
} from "@shared/schema";
import { eq, and, sql } from "drizzle-orm";
import { logInfo } from "./utils/logger";
import { FEATURE_FLAG_KEYS } from "@shared/schema";
import { setAllFeatureFlags } from "./services/featureFlagService";
import { requireDevSeed } from "./utils/devSeedFlag";

const router = Router();

router.post("/seed-enterprise", requireDevSeed, requireAuth, async (req, res, next) => {
  try {
    const user = (req as any).user;
    if (!["SUPER_ADMIN", "ADMIN"].includes(user.role)) {
      return res.status(403).json({ error: "Admin access required" });
    }

    const orgId = user.organizationId;
    if (!orgId) {
      return res.status(400).json({ error: "Organization required" });
    }

    const results: Record<string, any> = {};

    const [existingSub] = await db.select().from(organizationSubscriptions)
      .where(eq(organizationSubscriptions.organizationId, orgId)).limit(1);

    if (existingSub) {
      if (existingSub.planTier !== "enterprise") {
        await db.update(organizationSubscriptions)
          .set({ planTier: "enterprise", status: "active", updatedAt: new Date() })
          .where(eq(organizationSubscriptions.id, existingSub.id));
        results.subscription = "Upgraded to enterprise (Scale) plan";
      } else {
        results.subscription = "Already on enterprise (Scale) plan";
      }
    } else {
      await db.insert(organizationSubscriptions).values({
        organizationId: orgId,
        planTier: "enterprise",
        status: "active",
        billingProvider: "manual",
      });
      results.subscription = "Created enterprise (Scale) subscription";
    }

    const addonKeys = ["integration_qbo", "integration_esign", "ai_governance_pack"] as const;
    const addonResults: string[] = [];

    for (const addonKey of addonKeys) {
      const [existing] = await db.select().from(organizationAddOns)
        .where(and(
          eq(organizationAddOns.organizationId, orgId),
          eq(organizationAddOns.addonKey, addonKey)
        )).limit(1);

      if (existing) {
        if (existing.status !== "active") {
          await db.update(organizationAddOns)
            .set({ status: "active", updatedAt: new Date() })
            .where(eq(organizationAddOns.id, existing.id));
          addonResults.push(`${addonKey}: activated`);
        } else {
          addonResults.push(`${addonKey}: already active`);
        }
      } else {
        await db.insert(organizationAddOns).values({
          organizationId: orgId,
          addonKey: addonKey as any,
          status: "active",
        });
        addonResults.push(`${addonKey}: created & activated`);
      }
    }
    results.addons = addonResults;

    const providerConfigs = [
      { provider: "qbo", displayName: "QuickBooks Online (Dev)" },
      { provider: "google", displayName: "Google Workspace (Dev)" },
      { provider: "microsoft", displayName: "Microsoft 365 (Dev)" },
      { provider: "docusign", displayName: "DocuSign (Dev)" },
    ];

    const connectionResults: string[] = [];
    for (const cfg of providerConfigs) {
      const [existing] = await db.select().from(integrationConnections)
        .where(and(
          eq(integrationConnections.organizationId, orgId),
          eq(integrationConnections.provider, cfg.provider as any)
        )).limit(1);

      if (existing) {
        if (existing.status !== "active") {
          await db.update(integrationConnections)
            .set({
              status: "active",
              displayName: cfg.displayName,
              metadata: { devMode: true, simulatedAt: new Date().toISOString() },
              lastSyncAt: new Date(),
              updatedAt: new Date(),
            })
            .where(eq(integrationConnections.id, existing.id));
          connectionResults.push(`${cfg.provider}: activated (dev mode)`);
        } else {
          connectionResults.push(`${cfg.provider}: already active`);
        }
      } else {
        await db.insert(integrationConnections).values({
          organizationId: orgId,
          provider: cfg.provider as any,
          displayName: cfg.displayName,
          status: "active",
          createdByUserId: user.id,
          metadata: { devMode: true, simulatedAt: new Date().toISOString() },
          lastSyncAt: new Date(),
        });
        connectionResults.push(`${cfg.provider}: created (dev mode)`);
      }
    }
    results.connections = connectionResults;

    const aiActionTypes = [
      { actionType: "estimate_generation", model: "gpt-4o", tokensIn: 1250, tokensOut: 3400, cost: "0.0245" },
      { actionType: "bid_analysis", model: "gpt-4o", tokensIn: 2100, tokensOut: 4800, cost: "0.0410" },
      { actionType: "schedule_optimization", model: "gpt-4o-mini", tokensIn: 800, tokensOut: 1200, cost: "0.0085" },
      { actionType: "change_order_draft", model: "gpt-4o", tokensIn: 1500, tokensOut: 2200, cost: "0.0195" },
      { actionType: "safety_report_analysis", model: "gpt-4o", tokensIn: 3000, tokensOut: 5000, cost: "0.0520" },
      { actionType: "email_classification", model: "gpt-4o-mini", tokensIn: 500, tokensOut: 200, cost: "0.0035" },
      { actionType: "document_extraction", model: "gpt-4o", tokensIn: 4000, tokensOut: 6000, cost: "0.0680" },
      { actionType: "project_summary", model: "gpt-4o-mini", tokensIn: 600, tokensOut: 1800, cost: "0.0065" },
    ];

    let aiCount = 0;
    for (const action of aiActionTypes) {
      await db.insert(aiActionAudit).values({
        organizationId: orgId,
        actorUserId: user.id,
        actionType: action.actionType,
        model: action.model,
        tokensIn: action.tokensIn,
        tokensOut: action.tokensOut,
        costEstimate: action.cost,
        inputRefs: { source: "dev_seed", description: `Sample ${action.actionType} action` },
        outputRefs: { summary: `Generated ${action.actionType} result successfully` },
        rationale: null,
        approvalRequired: action.actionType === "change_order_draft",
        approvalStatus: action.actionType === "change_order_draft" ? "pending" : null,
        durationMs: Math.floor(Math.random() * 5000) + 1000,
      });
      aiCount++;
    }
    results.aiAuditEntries = `Created ${aiCount} sample entries`;

    const entityTypes = ["CHANGE_ORDER", "SOV_PAY_APP", "TIME_APPROVAL", "VENDOR_BILL", "ESIGN_SEND", "QBO_EXPORT"];
    const statuses = ["pending", "pending", "pending", "approved", "rejected", "approved"];
    let approvalCount = 0;

    for (let i = 0; i < entityTypes.length; i++) {
      await db.insert(approvalRequests).values({
        organizationId: orgId,
        entityType: entityTypes[i] as any,
        entityId: `DEV-${String(i + 1).padStart(4, "0")}`,
        requestedByUserId: user.id,
        status: statuses[i] as any,
        notes: `Sample ${entityTypes[i].toLowerCase().replace(/_/g, " ")} approval request`,
        approverUserId: statuses[i] !== "pending" ? user.id : null,
        approverRole: statuses[i] !== "pending" ? user.role : null,
        decidedAt: statuses[i] !== "pending" ? new Date() : null,
      });
      approvalCount++;
    }
    results.approvalRequests = `Created ${approvalCount} sample requests (3 pending, 2 approved, 1 rejected)`;

    const docTypes = [
      { entityType: "contract", entityId: "CONTRACT-001", fileName: "General_Contract_v1.pdf" },
      { entityType: "contract", entityId: "CONTRACT-001", fileName: "General_Contract_v2.pdf" },
      { entityType: "change_order", entityId: "CO-001", fileName: "Change_Order_001.pdf" },
      { entityType: "submittal", entityId: "SUB-001", fileName: "Submittal_Materials.pdf" },
    ];

    let docCount = 0;
    let revisionNumber = 1;
    for (const doc of docTypes) {
      const isSecondRevision = doc.entityType === "contract" && revisionNumber === 2;
      await db.insert(documentRevisions).values({
        organizationId: orgId,
        entityType: doc.entityType,
        entityId: doc.entityId,
        revisionNumber: doc.entityType === "contract" ? revisionNumber++ : 1,
        status: isSecondRevision ? "active" : (doc.entityType === "contract" && revisionNumber > 2 ? "superseded" : "active"),
        fileName: doc.fileName,
        fileUrl: `/dev/files/${doc.fileName}`,
        fileSize: Math.floor(Math.random() * 500000) + 50000,
        mimeType: "application/pdf",
        source: "upload",
        uploadedByUserId: user.id,
        notes: `Dev seed: ${doc.fileName}`,
      });
      docCount++;
    }
    results.documentRevisions = `Created ${docCount} sample revisions`;

    const orgProjects = await db.select({ id: projects.id, code: projects.code })
      .from(projects)
      .where(eq(projects.gcOrganizationId, orgId))
      .limit(5);

    let healthCount = 0;
    for (const project of orgProjects) {
      const score = Math.floor(Math.random() * 40) + 55;
      await db.insert(projectHealthSnapshots).values({
        organizationId: orgId,
        projectId: project.id,
        overallScore: score,
        scheduleScore: Math.floor(Math.random() * 30) + 60,
        budgetScore: Math.floor(Math.random() * 30) + 65,
        rfiSubmittalScore: Math.floor(Math.random() * 40) + 50,
        changeOrderScore: Math.floor(Math.random() * 30) + 70,
        safetyScore: Math.floor(Math.random() * 20) + 75,
        details: {
          scheduleWeight: 0.25,
          budgetWeight: 0.25,
          rfiSubmittalWeight: 0.20,
          changeOrderWeight: 0.15,
          safetyWeight: 0.15,
          source: "dev_seed",
        },
      });
      healthCount++;
    }
    results.projectHealthSnapshots = `Created ${healthCount} snapshots for ${orgProjects.length} projects`;

    const allFlagsOn = Object.fromEntries(
      FEATURE_FLAG_KEYS.map(key => [key, true])
    );
    await setAllFeatureFlags(orgId, allFlagsOn);
    results.featureFlags = `All ${FEATURE_FLAG_KEYS.length} feature flags enabled`;

    logInfo("Enterprise dev seed completed", { orgId, results });

    res.json({
      success: true,
      message: "Enterprise features seeded successfully for development testing",
      results,
    });
  } catch (err) {
    next(err);
  }
});

// Seed CRM demo data — orgs, contacts, opportunities across stages, activities, tasks, quotes
// Available in any env: gated by manager+ role and one-shot per org (refuses if any CRM data exists).
router.post("/seed-crm", requireAuth, async (req, res, next) => {
  try {
    const user = (req as any).user;
    if (!["SUPER_ADMIN", "ADMIN", "HUSTLER", "MANAGER"].includes(user.role)) {
      return res.status(403).json({ error: "Manager+ access required" });
    }
    const orgId = user.organizationId;
    if (!orgId) return res.status(400).json({ error: "Organization required" });

    const existing = await db.select({ id: crmOrganisations.id }).from(crmOrganisations)
      .where(eq(crmOrganisations.organizationId, orgId)).limit(1);
    if (existing.length > 0) {
      return res.status(409).json({
        error: "CRM already has data",
        message: "This organization already has CRM records. Delete them first or use a fresh org.",
      });
    }

    const ORGS_DATA = [
      { type: "OWNER_REP" as const, name: "Pacific Coast Developers", city: "San Diego", state: "CA", website: "pacificcoastdev.com", specialties: ["Mixed-use", "Multi-family"] },
      { type: "OWNER_REP" as const, name: "Westfield Properties Group", city: "Los Angeles", state: "CA", website: "westfieldgroup.com", specialties: ["Commercial", "Retail"] },
      { type: "CONTRACTOR" as const, name: "Bayside General Contractors", city: "San Francisco", state: "CA", specialties: ["Healthcare", "Education"] },
      { type: "OWNER_REP" as const, name: "Mountain View Hospitals", city: "Mountain View", state: "CA", specialties: ["Healthcare"] },
      { type: "OWNER_REP" as const, name: "Stanford Education Trust", city: "Palo Alto", state: "CA", specialties: ["K-12", "Higher Ed"] },
      { type: "SUBCONTRACTOR" as const, name: "Apex Mechanical Inc", city: "Oakland", state: "CA", tradeSpecialty: "HVAC" },
      { type: "SUPPLIER" as const, name: "Granite Materials Supply", city: "Sacramento", state: "CA", materialCategories: ["Aggregate", "Concrete"] },
    ];
    const insertedOrgs = await db.insert(crmOrganisations).values(
      ORGS_DATA.map(o => ({ ...o, organizationId: orgId, createdById: user.id }))
    ).returning({ id: crmOrganisations.id, name: crmOrganisations.name });

    const orgByName = Object.fromEntries(insertedOrgs.map(o => [o.name, o.id]));

    const CONTACTS_DATA = [
      { orgName: "Pacific Coast Developers", firstName: "Jennifer", lastName: "Martinez", title: "VP Development", role: "OWNER" as const, email: "j.martinez@pacificcoastdev.com", phone: "619-555-0142", isPrimary: true },
      { orgName: "Pacific Coast Developers", firstName: "David", lastName: "Chen", title: "Project Director", role: "PM" as const, email: "d.chen@pacificcoastdev.com", phone: "619-555-0143" },
      { orgName: "Westfield Properties Group", firstName: "Sarah", lastName: "Thompson", title: "Director of Construction", role: "PM" as const, email: "sthompson@westfieldgroup.com", phone: "310-555-0188", isPrimary: true },
      { orgName: "Bayside General Contractors", firstName: "Michael", lastName: "O'Brien", title: "Senior Estimator", role: "ESTIMATOR" as const, email: "mobrien@baysidegc.com", phone: "415-555-0221", isPrimary: true },
      { orgName: "Mountain View Hospitals", firstName: "Dr. Robert", lastName: "Singh", title: "Facilities Director", role: "OWNER" as const, email: "r.singh@mvhospitals.org", phone: "650-555-0312", isPrimary: true },
      { orgName: "Stanford Education Trust", firstName: "Lisa", lastName: "Park", title: "Capital Projects Mgr", role: "PM" as const, email: "lpark@stanfordtrust.edu", phone: "650-555-0455", isPrimary: true },
      { orgName: "Apex Mechanical Inc", firstName: "Tony", lastName: "Ricci", title: "Operations Mgr", role: "GENERAL_MANAGER" as const, email: "tricci@apexmech.com", phone: "510-555-0177", isPrimary: true },
      { orgName: "Granite Materials Supply", firstName: "Maria", lastName: "Gonzalez", title: "Sales Rep", role: "SALES" as const, email: "mgonzalez@granitesupply.com", phone: "916-555-0301", isPrimary: true },
    ];
    const insertedContacts = await db.insert(crmContacts).values(
      CONTACTS_DATA.map(c => ({
        organizationId: orgId,
        organisationId: orgByName[c.orgName],
        firstName: c.firstName, lastName: c.lastName, title: c.title, role: c.role,
        email: c.email, phone: c.phone, isPrimary: c.isPrimary ?? false,
        createdById: user.id,
      }))
    ).returning({ id: crmContacts.id, firstName: crmContacts.firstName, lastName: crmContacts.lastName, organisationId: crmContacts.organisationId });

    const contactByName = Object.fromEntries(insertedContacts.map(c => [`${c.firstName} ${c.lastName}`, c.id]));

    const today = new Date();
    const daysFromNow = (d: number) => { const x = new Date(today); x.setDate(x.getDate() + d); return x.toISOString().split("T")[0]; };
    const daysAgo = (d: number) => { const x = new Date(today); x.setDate(x.getDate() - d); return x; };

    const OPPS_DATA = [
      { name: "PCD - Mission Bay Tower (12-story)", stage: "NEGOTIATION", dealValue: "8500000", probability: 75, orgName: "Pacific Coast Developers", contactName: "Jennifer Martinez", projectType: "Multi-family Residential", projectLocation: "San Diego, CA", expectedCloseDate: daysFromNow(14), source: "Existing relationship", leadScore: 82, ageDays: 45, aiWinProbability: 72, aiWinProbabilityRationale: "Strong existing relationship and competitive bid; client has confirmed budget." },
      { name: "Westfield Plaza Renovation", stage: "BID_SUBMITTED", dealValue: "3200000", probability: 60, orgName: "Westfield Properties Group", contactName: "Sarah Thompson", projectType: "Commercial Retail", projectLocation: "Los Angeles, CA", expectedCloseDate: daysFromNow(7), source: "Referral", leadScore: 68, ageDays: 30, aiWinProbability: 55, aiWinProbabilityRationale: "Three competitors bidding; our number is mid-pack." },
      { name: "MVH Surgical Wing Expansion", stage: "ESTIMATING", dealValue: "12400000", probability: 40, orgName: "Mountain View Hospitals", contactName: "Dr. Robert Singh", projectType: "Healthcare", projectLocation: "Mountain View, CA", expectedCloseDate: daysFromNow(45), source: "RFP", leadScore: 75, ageDays: 18, aiWinProbability: 48 },
      { name: "Stanford Engineering Quad", stage: "QUALIFIED", dealValue: "6800000", probability: 25, orgName: "Stanford Education Trust", contactName: "Lisa Park", projectType: "Higher Education", projectLocation: "Palo Alto, CA", expectedCloseDate: daysFromNow(60), source: "Inbound web", leadScore: 55, ageDays: 12 },
      { name: "PCD - Coastal Mixed-Use Phase II", stage: "LEAD", dealValue: "15000000", probability: 10, orgName: "Pacific Coast Developers", contactName: "David Chen", projectType: "Mixed-use", projectLocation: "Carlsbad, CA", expectedCloseDate: daysFromNow(120), source: "Existing relationship", leadScore: 45, ageDays: 5 },
      { name: "Bayside School District - 3 Sites", stage: "QUALIFIED", dealValue: "9200000", probability: 30, orgName: "Bayside General Contractors", contactName: "Michael O'Brien", projectType: "K-12 Education", projectLocation: "Oakland, CA", expectedCloseDate: daysFromNow(90), source: "Public RFP", leadScore: 62, ageDays: 22 },
      { name: "Westfield - North LA Distribution Center", stage: "ESTIMATING", dealValue: "5400000", probability: 50, orgName: "Westfield Properties Group", contactName: "Sarah Thompson", projectType: "Industrial", projectLocation: "North Hollywood, CA", expectedCloseDate: daysFromNow(35), source: "Referral", leadScore: 70, ageDays: 25, aiWinProbability: 58 },
      { name: "Old Town Boutique Hotel", stage: "WON", dealValue: "4200000", probability: 100, orgName: "Pacific Coast Developers", contactName: "Jennifer Martinez", projectType: "Hospitality", projectLocation: "San Diego, CA", source: "Existing relationship", leadScore: 88, ageDays: 65 },
      { name: "Riverside Medical Center Parking", stage: "LOST", dealValue: "2100000", probability: 0, orgName: "Mountain View Hospitals", contactName: "Dr. Robert Singh", projectType: "Healthcare", projectLocation: "Riverside, CA", source: "RFP", leadScore: 35, ageDays: 80, lostCategory: "PRICE" as const, lostReason: "Lost to lower bid by ~8%; competitor accepted slimmer margin." },
      { name: "Stanford Library Modernization", stage: "LEAD", dealValue: "3800000", probability: 10, orgName: "Stanford Education Trust", contactName: "Lisa Park", projectType: "Higher Education", projectLocation: "Palo Alto, CA", expectedCloseDate: daysFromNow(180), source: "Inbound web", leadScore: 38, ageDays: 2 },
      { name: "Granite Supply - Long-term MSA", stage: "NEGOTIATION", dealValue: "1800000", probability: 80, orgName: "Granite Materials Supply", contactName: "Maria Gonzalez", projectType: "Supplier Agreement", source: "Existing relationship", leadScore: 78, ageDays: 38, aiWinProbability: 81, aiWinProbabilityRationale: "Final terms only — pricing locked, contract in legal review." },
      { name: "Apex HVAC - Master Sub Agreement", stage: "BID_SUBMITTED", dealValue: "2400000", probability: 65, orgName: "Apex Mechanical Inc", contactName: "Tony Ricci", projectType: "Subcontractor MSA", source: "Existing relationship", leadScore: 72, ageDays: 28 },
    ];

    const wonAt = (stage: string, age: number) => stage === "WON" ? daysAgo(Math.floor(age / 3)) : null;
    const lostAt = (stage: string, age: number) => stage === "LOST" ? daysAgo(Math.floor(age / 4)) : null;

    const insertedOpps = await db.insert(crmOpportunities).values(
      OPPS_DATA.map(o => ({
        organizationId: orgId,
        name: o.name,
        stage: o.stage as any,
        dealValue: o.dealValue,
        probability: o.probability,
        crmOrganisationId: orgByName[o.orgName],
        contactId: contactByName[o.contactName] ?? null,
        assignedToId: user.id,
        projectType: o.projectType,
        projectLocation: o.projectLocation ?? null,
        expectedCloseDate: o.expectedCloseDate ?? null,
        source: o.source,
        leadScore: o.leadScore,
        lostCategory: (o as any).lostCategory ?? null,
        lostReason: (o as any).lostReason ?? null,
        aiWinProbability: (o as any).aiWinProbability ?? null,
        aiWinProbabilityRationale: (o as any).aiWinProbabilityRationale ?? null,
        wonAt: wonAt(o.stage, o.ageDays),
        lostAt: lostAt(o.stage, o.ageDays),
        createdById: user.id,
        createdAt: daysAgo(o.ageDays),
        updatedAt: daysAgo(Math.min(o.ageDays, Math.floor(Math.random() * 18))),
      }))
    ).returning({ id: crmOpportunities.id, name: crmOpportunities.name, stage: crmOpportunities.stage });

    const oppByName = Object.fromEntries(insertedOpps.map(o => [o.name, o.id]));

    const ACTIVITIES: { oppName: string; type: any; description: string; daysAgo: number }[] = [
      { oppName: "PCD - Mission Bay Tower (12-story)", type: "MEETING", description: "On-site walk-through with Jennifer + project architect. Discussed schedule constraints.", daysAgo: 8 },
      { oppName: "PCD - Mission Bay Tower (12-story)", type: "EMAIL", description: "Sent revised pricing memo addressing the alternates we discussed.", daysAgo: 4 },
      { oppName: "PCD - Mission Bay Tower (12-story)", type: "CALL", description: "Quick call to confirm receipt of memo. Decision expected next week.", daysAgo: 2 },
      { oppName: "Westfield Plaza Renovation", type: "EMAIL", description: "Submitted bid package via portal. Confirmation received.", daysAgo: 6 },
      { oppName: "MVH Surgical Wing Expansion", type: "SITE_VISIT", description: "Pre-bid site visit with mechanical and electrical leads.", daysAgo: 12 },
      { oppName: "Stanford Engineering Quad", type: "MEETING", description: "Initial scope review with Lisa Park.", daysAgo: 10 },
      { oppName: "Old Town Boutique Hotel", type: "NOTE", description: "Contract signed! Kickoff scheduled for next month.", daysAgo: 18 },
      { oppName: "Riverside Medical Center Parking", type: "NOTE", description: "Lost to competitor. Debrief: pricing was the only differentiator.", daysAgo: 20 },
      { oppName: "Granite Supply - Long-term MSA", type: "CALL", description: "Final terms negotiation. Legal sending redline this week.", daysAgo: 3 },
      { oppName: "Apex HVAC - Master Sub Agreement", type: "MEETING", description: "Reviewed MSA template with Tony. He's on board with our terms.", daysAgo: 7 },
    ];
    if (ACTIVITIES.length > 0) {
      await db.insert(crmOpportunityActivities).values(
        ACTIVITIES.filter(a => oppByName[a.oppName]).map(a => ({
          opportunityId: oppByName[a.oppName],
          activityType: a.type,
          description: a.description,
          completedAt: daysAgo(a.daysAgo),
          createdById: user.id,
          createdAt: daysAgo(a.daysAgo),
        }))
      );
    }

    const TASKS = [
      { oppName: "PCD - Mission Bay Tower (12-story)", title: "Follow up with Jennifer on decision", dueIn: 2, priority: "HIGH" },
      { oppName: "Westfield Plaza Renovation", title: "Schedule post-bid clarification call", dueIn: 3, priority: "HIGH" },
      { oppName: "MVH Surgical Wing Expansion", title: "Submit estimate package", dueIn: 10, priority: "NORMAL" },
      { oppName: "Stanford Engineering Quad", title: "Send qualifying questions to Lisa", dueIn: 5, priority: "NORMAL" },
      { oppName: "Granite Supply - Long-term MSA", title: "Review redlined MSA from legal", dueIn: 4, priority: "HIGH" },
      { oppName: "Apex HVAC - Master Sub Agreement", title: "Send signed MSA copy", dueIn: 7, priority: "NORMAL" },
    ];
    await db.insert(crmTasks).values(
      TASKS.filter(t => oppByName[t.oppName]).map(t => ({
        organizationId: orgId,
        title: t.title,
        dueDate: (() => { const x = new Date(); x.setDate(x.getDate() + t.dueIn); return x; })(),
        status: "PENDING",
        priority: t.priority,
        opportunityId: oppByName[t.oppName],
        assignedToId: user.id,
        createdById: user.id,
      }))
    );

    // A couple of demo quotes
    const yearPrefix = `Q${new Date().getFullYear()}`;
    const QUOTES = [
      { oppName: "PCD - Mission Bay Tower (12-story)", title: "Mission Bay Tower — Construction Proposal", number: `${yearPrefix}-DEMO1`, status: "SENT", subtotal: "8500000" },
      { oppName: "Westfield Plaza Renovation", title: "Westfield Plaza Renovation — Bid", number: `${yearPrefix}-DEMO2`, status: "VIEWED", subtotal: "3200000" },
      { oppName: "Granite Supply - Long-term MSA", title: "Granite Materials MSA — Pricing Schedule", number: `${yearPrefix}-DEMO3`, status: "ACCEPTED", subtotal: "1800000" },
    ];
    for (const q of QUOTES) {
      if (!oppByName[q.oppName]) continue;
      const orgIdRef = insertedOpps.find(o => o.name === q.oppName);
      const oppOrg = OPPS_DATA.find(o => o.name === q.oppName);
      const [quote] = await db.insert(crmQuotes).values({
        organizationId: orgId,
        opportunityId: oppByName[q.oppName],
        crmOrganisationId: oppOrg ? orgByName[oppOrg.orgName] : null,
        quoteNumber: q.number,
        title: q.title,
        status: q.status,
        subtotal: q.subtotal,
        taxRate: "0",
        taxAmount: "0",
        discountAmount: "0",
        totalAmount: q.subtotal,
        validUntil: daysFromNow(30),
        createdById: user.id,
      } as any).returning({ id: crmQuotes.id });
      const sub = parseFloat(q.subtotal);
      await db.insert(crmQuoteLineItems).values([
        { quoteId: quote.id, description: "General Conditions", quantity: "1", unit: "LS", unitPrice: (sub * 0.08).toFixed(4), lineTotal: (sub * 0.08).toFixed(2), sortOrder: 0 },
        { quoteId: quote.id, description: "Direct Costs (labor, material, equipment)", quantity: "1", unit: "LS", unitPrice: (sub * 0.78).toFixed(4), lineTotal: (sub * 0.78).toFixed(2), sortOrder: 1 },
        { quoteId: quote.id, description: "Overhead & Profit", quantity: "1", unit: "LS", unitPrice: (sub * 0.14).toFixed(4), lineTotal: (sub * 0.14).toFixed(2), sortOrder: 2 },
      ] as any);
    }

    res.json({
      success: true,
      message: "CRM demo data seeded successfully",
      counts: {
        organisations: insertedOrgs.length,
        contacts: insertedContacts.length,
        opportunities: insertedOpps.length,
        activities: ACTIVITIES.length,
        tasks: TASKS.length,
        quotes: QUOTES.length,
      },
    });
  } catch (err) {
    logInfo("[seed-crm] error", { error: (err as Error).message });
    next(err);
  }
});

router.post("/clear-crm", requireAuth, async (req, res, next) => {
  try {
    const user = (req as any).user;
    if (!["SUPER_ADMIN", "ADMIN"].includes(user.role)) {
      return res.status(403).json({ error: "Admin access required" });
    }
    const orgId = user.organizationId;
    if (!orgId) return res.status(400).json({ error: "Organization required" });

    // Delete in FK-safe order; cascades handle line items / activities
    await db.delete(crmTasks).where(eq(crmTasks.organizationId, orgId));
    await db.delete(crmQuotes).where(eq(crmQuotes.organizationId, orgId));
    await db.delete(crmOpportunities).where(eq(crmOpportunities.organizationId, orgId));
    await db.delete(crmContacts).where(eq(crmContacts.organizationId, orgId));
    await db.delete(crmOrganisations).where(eq(crmOrganisations.organizationId, orgId));

    res.json({ success: true, message: "CRM data cleared" });
  } catch (err) {
    next(err);
  }
});

router.post("/clear-enterprise", requireAuth, async (req, res, next) => {
  try {
    const user = (req as any).user;
    if (user.role !== "ADMIN" && user.role !== "SUPER_ADMIN") {
      return res.status(403).json({ error: "Admin access required" });
    }

    const orgId = user.organizationId;
    if (!orgId) return res.status(400).json({ error: "Organization required" });

    await db.delete(aiActionAudit).where(eq(aiActionAudit.organizationId, orgId));
    await db.delete(approvalRequests).where(eq(approvalRequests.organizationId, orgId));
    await db.delete(documentRevisions).where(eq(documentRevisions.organizationId, orgId));
    await db.delete(projectHealthSnapshots).where(eq(projectHealthSnapshots.organizationId, orgId));
    await db.delete(integrationConnections).where(eq(integrationConnections.organizationId, orgId));

    res.json({ success: true, message: "Enterprise seed data cleared" });
  } catch (err) {
    next(err);
  }
});

export default router;
