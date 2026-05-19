// Task #2956 — Unit tests for the bid→project file bridging logic in fileResolver.
//
// Tests:
//   • When resolveEstimatorFiles is called with a projectId, bid_documents from the
//     bid that was converted into that project are included alongside plan_documents.
//   • Files that appear in both bid_documents and plan_documents are deduped by fileUrl.
//   • Quote attachments (subcontractor + material) are included when bidId is provided.
//   • Cross-org bids are not bridged (org isolation).

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { sql } from "drizzle-orm";
import { db } from "../db";
import {
  organizations,
  users,
  bids,
  projects,
  bidDocuments,
  planDocuments,
  bidSubcontractorQuotes,
  bidMaterialQuotes,
} from "@shared/schema";
import { resolveEstimatorFiles } from "../services/aiEstimator/fileResolver";

const PREFIX = "__file_resolver_test__";

interface SeedCtx {
  orgId: string;
  orgBId: string;
  userId: string;
  bidId: string;
  projectId: string;
  orphanBidId: string;
  bidDocUrl: string;
  planDocUrl: string;
  sharedUrl: string;
  subQuoteUrl: string;
  matQuoteUrl: string;
}

let ctx: SeedCtx;

async function cleanup(): Promise<void> {
  await db.execute(sql`
    DELETE FROM bid_material_quotes WHERE bid_id IN (
      SELECT id FROM bids WHERE gc_organization_id IN (
        SELECT id FROM organizations WHERE slug LIKE ${PREFIX + "%"}
      )
    )
  `).catch(() => {});
  await db.execute(sql`
    DELETE FROM bid_subcontractor_quotes WHERE bid_id IN (
      SELECT id FROM bids WHERE gc_organization_id IN (
        SELECT id FROM organizations WHERE slug LIKE ${PREFIX + "%"}
      )
    )
  `).catch(() => {});
  await db.execute(sql`
    DELETE FROM bid_documents WHERE bid_id IN (
      SELECT id FROM bids WHERE gc_organization_id IN (
        SELECT id FROM organizations WHERE slug LIKE ${PREFIX + "%"}
      )
    )
  `).catch(() => {});
  await db.execute(sql`
    DELETE FROM plan_documents WHERE project_id IN (
      SELECT id FROM projects WHERE gc_organization_id IN (
        SELECT id FROM organizations WHERE slug LIKE ${PREFIX + "%"}
      )
    )
  `).catch(() => {});
  await db.execute(sql`
    DELETE FROM bids WHERE gc_organization_id IN (
      SELECT id FROM organizations WHERE slug LIKE ${PREFIX + "%"}
    )
  `).catch(() => {});
  await db.execute(sql`
    DELETE FROM projects WHERE gc_organization_id IN (
      SELECT id FROM organizations WHERE slug LIKE ${PREFIX + "%"}
    )
  `).catch(() => {});
  await db.execute(sql`
    DELETE FROM users WHERE email LIKE ${PREFIX + "%"}
  `).catch(() => {});
  await db.execute(sql`
    DELETE FROM organizations WHERE slug LIKE ${PREFIX + "%"}
  `).catch(() => {});
}

beforeAll(async () => {
  await cleanup();

  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const [orgA, orgB] = await db
    .insert(organizations)
    .values([
      {
        name: "FileResolver Org A",
        slug: `${PREFIX}a-${stamp}`,
        tradeType: "GENERAL_CONTRACTOR",
        onboardingStatus: "COMPLETED",
        isActive: true,
      },
      {
        name: "FileResolver Org B",
        slug: `${PREFIX}b-${stamp}`,
        tradeType: "GENERAL_CONTRACTOR",
        onboardingStatus: "COMPLETED",
        isActive: true,
      },
    ])
    .returning();

  const [user] = await db
    .insert(users)
    .values({
      email: `${PREFIX}admin-${stamp}@test.local`,
      passwordHash: "x",
      firstName: "Test",
      lastName: "Admin",
      role: "ADMIN",
      organizationId: orgA.id,
      isActive: true,
    })
    .returning();

  // Create a project in org A
  const [project] = await db
    .insert(projects)
    .values({
      name: "Test Project",
      code: `FR-PROJ-${stamp}`,
      clientName: "Test Client",
      gcOrganizationId: orgA.id,
      status: "ACTIVE",
    })
    .returning();

  // Create a bid in org A that was converted into the project
  const [bid] = await db
    .insert(bids)
    .values({
      name: "Test Bid",
      code: `FR-BID-${stamp}`,
      clientName: "Test Client",
      gcOrganizationId: orgA.id,
      status: "AWARDED",
      convertedToProjectId: project.id,
    })
    .returning();

  // Create a bid in org B (orphan — should never cross into org A queries)
  const [orphanBid] = await db
    .insert(bids)
    .values({
      name: "Orphan Bid",
      code: `FR-ORPHAN-${stamp}`,
      clientName: "Orphan Client",
      gcOrganizationId: orgB.id,
      status: "ACTIVE",
    })
    .returning();

  const bidDocUrl = `storage.googleapis.com/test-bucket/orgs/${orgA.id}/bid-spec.pdf`;
  const planDocUrl = `storage.googleapis.com/test-bucket/orgs/${orgA.id}/site-plan.pdf`;
  const sharedUrl = `storage.googleapis.com/test-bucket/orgs/${orgA.id}/shared-file.pdf`;
  const subQuoteUrl = `storage.googleapis.com/test-bucket/orgs/${orgA.id}/sub-quote.pdf`;
  const matQuoteUrl = `storage.googleapis.com/test-bucket/orgs/${orgA.id}/mat-quote.xlsx`;

  // bid_documents for the bid
  await db.insert(bidDocuments).values([
    {
      bidId: bid.id,
      title: "Bid Spec",
      fileName: "bid-spec.pdf",
      fileUrl: bidDocUrl,
      uploadedById: user.id,
      mimeType: "application/pdf",
    },
    {
      bidId: bid.id,
      title: "Shared File",
      fileName: "shared-file.pdf",
      fileUrl: sharedUrl,
      uploadedById: user.id,
      mimeType: "application/pdf",
    },
  ]);

  // plan_documents for the project
  await db.insert(planDocuments).values([
    {
      projectId: project.id,
      organizationId: orgA.id,
      title: "Site Plan",
      fileName: "site-plan.pdf",
      fileUrl: planDocUrl,
      uploadedById: user.id,
      mimeType: "application/pdf",
    },
    {
      projectId: project.id,
      organizationId: orgA.id,
      title: "Shared File",
      fileName: "shared-file.pdf",
      fileUrl: sharedUrl,  // same URL as the bid_document — should be deduped
      uploadedById: user.id,
      mimeType: "application/pdf",
    },
  ]);

  // subcontractor quote with attachment
  await db.insert(bidSubcontractorQuotes).values({
    bidId: bid.id,
    subcontractorName: "Sub Co",
    scopeOfWork: "Concrete work",
    quoteAmount: "50000",
    fileUrl: subQuoteUrl,
    fileName: "sub-quote.pdf",
    mimeType: "application/pdf",
  });

  // material quote with attachment
  await db.insert(bidMaterialQuotes).values({
    bidId: bid.id,
    materialName: "Rebar",
    description: "Grade 60 rebar",
    cost: "12000",
    fileUrl: matQuoteUrl,
    fileName: "mat-quote.xlsx",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });

  ctx = {
    orgId: orgA.id,
    orgBId: orgB.id,
    userId: user.id,
    bidId: bid.id,
    projectId: project.id,
    orphanBidId: orphanBid.id,
    bidDocUrl,
    planDocUrl,
    sharedUrl,
    subQuoteUrl,
    matQuoteUrl,
  };
}, 60_000);

afterAll(async () => {
  await cleanup();
});

describe("resolveEstimatorFiles — bid→project bridging", () => {
  it("includes bid_documents from the source bid when called with projectId", async () => {
    const refs = await resolveEstimatorFiles({
      projectId: ctx.projectId,
      organizationId: ctx.orgId,
    });
    const urls = refs.map((r) => r.fileUrl);
    expect(urls).toContain(ctx.planDocUrl);
    expect(urls).toContain(ctx.bidDocUrl);
  });

  it("deduplicates files that appear in both bid_documents and plan_documents by fileUrl", async () => {
    const refs = await resolveEstimatorFiles({
      projectId: ctx.projectId,
      organizationId: ctx.orgId,
    });
    const sharedRefs = refs.filter((r) => r.fileUrl === ctx.sharedUrl);
    expect(sharedRefs).toHaveLength(1);
  });

  it("marks bridged bid docs with source=bid_document and correct bidId", async () => {
    const refs = await resolveEstimatorFiles({
      projectId: ctx.projectId,
      organizationId: ctx.orgId,
    });
    const bidDocRef = refs.find((r) => r.fileUrl === ctx.bidDocUrl);
    expect(bidDocRef).toBeDefined();
    expect(bidDocRef!.source).toBe("bid_document");
    expect(bidDocRef!.bidId).toBe(ctx.bidId);
  });

  it("does not bridge a bid from a different org into the project", async () => {
    // The orphan bid belongs to orgB — it must never appear when querying orgA's project.
    const refs = await resolveEstimatorFiles({
      projectId: ctx.projectId,
      organizationId: ctx.orgId,
    });
    const orphanFileUrls = refs.filter((r) => r.bidId === ctx.orphanBidId);
    expect(orphanFileUrls).toHaveLength(0);
  });
});

describe("resolveEstimatorFiles — quote attachments", () => {
  it("includes subcontractor quote attachments when bidId is provided", async () => {
    const refs = await resolveEstimatorFiles({
      bidId: ctx.bidId,
      organizationId: ctx.orgId,
    });
    const urls = refs.map((r) => r.fileUrl);
    expect(urls).toContain(ctx.subQuoteUrl);
  });

  it("includes material quote attachments when bidId is provided", async () => {
    const refs = await resolveEstimatorFiles({
      bidId: ctx.bidId,
      organizationId: ctx.orgId,
    });
    const urls = refs.map((r) => r.fileUrl);
    expect(urls).toContain(ctx.matQuoteUrl);
  });

  it("marks quote attachments with source=quote_document", async () => {
    const refs = await resolveEstimatorFiles({
      bidId: ctx.bidId,
      organizationId: ctx.orgId,
    });
    const subRef = refs.find((r) => r.fileUrl === ctx.subQuoteUrl);
    const matRef = refs.find((r) => r.fileUrl === ctx.matQuoteUrl);
    expect(subRef?.source).toBe("quote_document");
    expect(matRef?.source).toBe("quote_document");
  });

  it("classifies the material quote spreadsheet as fileType=spreadsheet", async () => {
    const refs = await resolveEstimatorFiles({
      bidId: ctx.bidId,
      organizationId: ctx.orgId,
    });
    const matRef = refs.find((r) => r.fileUrl === ctx.matQuoteUrl);
    expect(matRef?.fileType).toBe("spreadsheet");
  });
});

describe("resolveEstimatorFiles — org isolation", () => {
  it("does not return bid_documents from a bid belonging to another org", async () => {
    const refs = await resolveEstimatorFiles({
      bidId: ctx.bidId,
      organizationId: ctx.orgBId,  // wrong org
    });
    expect(refs).toHaveLength(0);
  });
});
