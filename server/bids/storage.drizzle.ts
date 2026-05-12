/**
 * Drizzle implementation of IBidStorage.  Pilot for Task #2431 — see
 * docs/architecture/storage-pattern.md.
 *
 * Every method that loads a row scoped to the bound orgId asserts the row's
 * gcOrganizationId/organizationId matches.  Cross-org access throws
 * CrossOrgAccessError; routes map that to HTTP 403 to mirror the legacy
 * verifyOrgAccess() response.  An `orgId` of `null` means "platform mode"
 * (SUPER_ADMIN session) and disables the org assertions, mirroring
 * isSuperAdmin() in server/orgFilter.ts.
 *
 * Behaviour MUST stay byte-identical to the previous direct-db code in
 * server/bidRoutes2.ts; the test at server/bids/__tests__/storage.test.ts
 * exercises the cross-org refusal contract.
 */

import { db } from "../db";
import { eq, desc, inArray, sql, and, or } from "drizzle-orm";
import {
  bids,
  estimates,
  estimateLineItems,
  projects,
  users,
  scopeItems,
  subcontractors,
  subcontractorContracts,
  bidEquipmentSelections,
  bidDocuments,
  scheduleOfValues,
  sovLineItems,
  organizations,
} from "@shared/schema";
import type {
  Bid,
  InsertBid,
  Estimate,
  EstimateLineItem,
  BidSubcontractorQuote,
  InsertBidSubcontractorQuote,
  BidMaterialQuote,
  InsertBidMaterialQuote,
  BidDocument,
  HandoffPacket,
  BidEquipmentSelection,
} from "@shared/schema";
import { logError, logInfo, logWarn } from "../utils/logger";
import { queueWageDecisionSync } from "../integrations/providers/dol_davis_bacon/sync";

import {
  CrossOrgAccessError,
  type IBidStorage,
  type BidListRow,
  type EstimateLineItemTotals,
  type EstimateWithLineItems,
  type ConvertBidParams,
  type ConvertBidResult,
  type UpsertHandoffPacketByBidInput,
  type ProjectInfo,
  type InsertBidDocumentInput,
  type ReviewSummary,
} from "./storage.ts";

const ZERO_TOTALS: EstimateLineItemTotals = {
  materialCost: 0,
  laborCost: 0,
  laborHours: 0,
  equipmentCost: 0,
  consumablesCost: 0,
  subcontractCost: 0,
  overheadAllocation: 0,
  profitAllocation: 0,
  totalCost: 0,
};

function reduceTotals(items: EstimateLineItem[]): EstimateLineItemTotals {
  return items.reduce<EstimateLineItemTotals>(
    (acc, item) => ({
      materialCost: acc.materialCost + Number(item.materialCost || 0),
      laborCost: acc.laborCost + Number(item.laborCost || 0),
      laborHours: acc.laborHours + Number(item.laborHours || 0),
      equipmentCost: acc.equipmentCost + Number(item.equipmentCost || 0),
      consumablesCost: acc.consumablesCost + Number(item.consumablesCost || 0),
      subcontractCost: acc.subcontractCost + Number(item.subcontractCost || 0),
      overheadAllocation:
        acc.overheadAllocation + Number(item.overheadAllocation || 0),
      profitAllocation: acc.profitAllocation + Number(item.profitAllocation || 0),
      totalCost: acc.totalCost + Number(item.totalCost || 0),
    }),
    { ...ZERO_TOTALS },
  );
}

const BID_CODE_START = 260001;

export class BidStorageDrizzle implements IBidStorage {
  /**
   * `null` = platform / super-admin mode (no org assertion).  Routes pass
   * `null` for SUPER_ADMIN sessions and for the unauthenticated public RFQ
   * flow (which authenticates via the response token).
   */
  constructor(private readonly orgId: string | null) {}

  // ---------------------------------------------------------------------------
  // Internal: org assertions.
  // ---------------------------------------------------------------------------

  /** Throws CrossOrgAccessError if the row's owning org doesn't match. */
  private assertOrg(
    entity: string,
    entityId: string,
    rowOrgId: string | null | undefined,
  ): void {
    if (this.orgId === null) return;
    if (rowOrgId !== this.orgId) {
      throw new CrossOrgAccessError(entity, entityId, this.orgId, rowOrgId ?? null);
    }
  }

  /** Loads a bid by id (raw) and asserts org.  Returns null when missing. */
  private async loadBidByIdAsserted(bidId: string): Promise<Bid | null> {
    const [row] = await db.select().from(bids).where(eq(bids.id, bidId)).limit(1);
    if (!row) return null;
    this.assertOrg("bid", row.id, row.gcOrganizationId);
    return row;
  }

  // ---------------------------------------------------------------------------
  // Bid CRUD
  // ---------------------------------------------------------------------------

  async listBidsWithEstimateSummary(): Promise<BidListRow[]> {
    const baseQuery = db
      .select({
        bid: bids,
        estimatorName: sql<
          string | null
        >`CONCAT(${users.firstName}, ' ', ${users.lastName})`.as("estimator_name"),
      })
      .from(bids)
      .leftJoin(users, eq(bids.estimatorId, users.id));

    const allRows = this.orgId
      ? await baseQuery.where(eq(bids.gcOrganizationId, this.orgId)).orderBy(bids.createdAt)
      : await baseQuery.orderBy(bids.createdAt);

    const flat = allRows.map(({ bid, estimatorName }) => ({
      ...bid,
      estimatorName: estimatorName || null,
    }));

    if (flat.length === 0) return [];

    const bidIds = flat.map((b) => b.id);
    const estimateRows = await db
      .select({
        bidId: estimates.bidId,
        estimateId: estimates.id,
        status: estimates.status,
        createdAt: estimates.createdAt,
      })
      .from(estimates)
      .where(inArray(estimates.bidId, bidIds))
      .orderBy(desc(estimates.createdAt));

    const latestByBid = new Map<string, { estimateId: string; status: string }>();
    for (const e of estimateRows) {
      if (e.bidId && !latestByBid.has(e.bidId)) {
        latestByBid.set(e.bidId, { estimateId: e.estimateId, status: e.status });
      }
    }

    const latestEstimateIds = Array.from(latestByBid.values()).map((e) => e.estimateId);
    let lineSummaries: Array<{
      estimateId: string;
      totalCost: number;
      lineItemCount: number;
    }> = [];
    if (latestEstimateIds.length > 0) {
      lineSummaries = await db
        .select({
          estimateId: estimateLineItems.estimateId,
          totalCost: sql<number>`
            SUM(
              COALESCE(CAST(${estimateLineItems.materialCost} AS NUMERIC), 0) +
              COALESCE(CAST(${estimateLineItems.laborCost} AS NUMERIC), 0) +
              COALESCE(CAST(${estimateLineItems.equipmentCost} AS NUMERIC), 0) +
              COALESCE(CAST(${estimateLineItems.consumablesCost} AS NUMERIC), 0) +
              COALESCE(CAST(${estimateLineItems.subcontractCost} AS NUMERIC), 0) +
              COALESCE(CAST(${estimateLineItems.overheadAllocation} AS NUMERIC), 0) +
              COALESCE(CAST(${estimateLineItems.profitAllocation} AS NUMERIC), 0)
            )
          `.as("total_cost"),
          lineItemCount: sql<number>`COUNT(*)`.as("line_item_count"),
        })
        .from(estimateLineItems)
        .where(inArray(estimateLineItems.estimateId, latestEstimateIds))
        .groupBy(estimateLineItems.estimateId);
    }
    const lineMap = new Map(
      lineSummaries.map((s) => [
        s.estimateId,
        { totalCost: Number(s.totalCost) || 0, lineItemCount: Number(s.lineItemCount) || 0 },
      ]),
    );

    const summaryByBid = new Map<
      string,
      { totalCost: number; lineItemCount: number; status: string }
    >();
    latestByBid.forEach((est, bidId) => {
      const ld = lineMap.get(est.estimateId) || { totalCost: 0, lineItemCount: 0 };
      summaryByBid.set(bidId, {
        totalCost: ld.totalCost,
        lineItemCount: ld.lineItemCount,
        status: est.status,
      });
    });

    return flat.map((bid) => ({
      ...bid,
      estimateSummary: summaryByBid.get(bid.id) || null,
    }));
  }

  async getBidByCode(code: string): Promise<Bid | null> {
    const [row] = await db.select().from(bids).where(eq(bids.code, code)).limit(1);
    if (!row) return null;
    this.assertOrg("bid", row.id, row.gcOrganizationId);
    return row;
  }

  async getBidById(id: string): Promise<Bid | null> {
    return this.loadBidByIdAsserted(id);
  }

  async createBid(
    data: InsertBid & { gcOrganizationId: string | null },
  ): Promise<Bid> {
    // The route is responsible for getNextBidCode + retry on 23505.  Keep this
    // method a thin insert so the unique-violation retry stays at the call site.
    const [row] = await db.insert(bids).values(data).returning();
    return row;
  }

  async updateBidByCode(
    code: string,
    patch: Record<string, unknown>,
  ): Promise<Bid | null> {
    // Pre-load to assert org so cross-org PATCHes throw rather than silently
    // updating zero rows.
    const existing = await this.getBidByCode(code);
    if (!existing) return null;
    const [row] = await db
      .update(bids)
      .set(patch as any)
      .where(eq(bids.code, code))
      .returning();
    return row ?? null;
  }

  async deleteBidByCode(code: string): Promise<Bid | null> {
    const existing = await this.getBidByCode(code);
    if (!existing) return null;

    const { handoffPackets, bidSubcontractorQuotes, bidMaterialQuotes } =
      await import("@shared/schema");

    await db.delete(handoffPackets).where(eq(handoffPackets.bidId, existing.id));
    await db
      .delete(bidSubcontractorQuotes)
      .where(eq(bidSubcontractorQuotes.bidId, existing.id));
    await db
      .delete(bidMaterialQuotes)
      .where(eq(bidMaterialQuotes.bidId, existing.id));

    const bidEstimates = await db
      .select()
      .from(estimates)
      .where(eq(estimates.bidId, existing.id));
    for (const est of bidEstimates) {
      await db
        .delete(estimateLineItems)
        .where(eq(estimateLineItems.estimateId, est.id));
    }
    await db.delete(estimates).where(eq(estimates.bidId, existing.id));

    const [deleted] = await db.delete(bids).where(eq(bids.code, code)).returning();
    return deleted ?? null;
  }

  async getNextBidCode(): Promise<string> {
    const result = await db.execute(sql`
      SELECT GREATEST(
        COALESCE((
          SELECT MAX(CAST(code AS INTEGER))
          FROM bids
          WHERE code ~ '^[0-9]+$'
          AND CAST(code AS INTEGER) >= ${BID_CODE_START}
        ), ${BID_CODE_START - 1}),
        COALESCE((
          SELECT MAX(CAST(code AS INTEGER))
          FROM projects
          WHERE code ~ '^[0-9]+$'
          AND CAST(code AS INTEGER) >= ${BID_CODE_START}
        ), ${BID_CODE_START - 1})
      ) as max_code
    `);
    const maxCode = Number((result as any).rows[0]?.max_code) || BID_CODE_START - 1;
    return String(maxCode + 1);
  }

  async getProjectByCode(code: string): Promise<ProjectInfo | null> {
    const [row] = await db
      .select({
        id: projects.id,
        code: projects.code,
        name: projects.name,
        gcOrganizationId: projects.gcOrganizationId,
        superintendentId: projects.superintendentId,
      })
      .from(projects)
      .where(eq(projects.code, code))
      .limit(1);
    if (!row) return null;
    this.assertOrg("project", row.id, row.gcOrganizationId);
    return row;
  }

  // ---------------------------------------------------------------------------
  // Estimates
  // ---------------------------------------------------------------------------

  async listEstimatesForBid(bidId: string): Promise<Estimate[]> {
    await this.loadBidByIdAsserted(bidId);
    return db
      .select()
      .from(estimates)
      .where(eq(estimates.bidId, bidId))
      .orderBy(desc(estimates.versionNumber));
  }

  async getActiveEstimateWithLineItems(
    bidId: string,
  ): Promise<EstimateWithLineItems | null> {
    await this.loadBidByIdAsserted(bidId);
    const bidEstimates = await db
      .select()
      .from(estimates)
      .where(eq(estimates.bidId, bidId))
      .orderBy(desc(estimates.versionNumber));
    if (bidEstimates.length === 0) return null;

    const active =
      bidEstimates.find((e) => e.status === "APPROVED") || bidEstimates[0];
    const lineItems = await db
      .select()
      .from(estimateLineItems)
      .where(eq(estimateLineItems.estimateId, active.id));

    return { ...active, lineItems, totals: reduceTotals(lineItems) };
  }

  async getOrCreateEstimateForBid(
    bidId: string,
    createdById: string,
  ): Promise<{ estimate: EstimateWithLineItems; created: boolean }> {
    await this.loadBidByIdAsserted(bidId);
    const existing = await db
      .select()
      .from(estimates)
      .where(eq(estimates.bidId, bidId))
      .limit(1);
    if (existing.length > 0) {
      const est = existing[0];
      const lineItems = await db
        .select()
        .from(estimateLineItems)
        .where(eq(estimateLineItems.estimateId, est.id));
      return {
        estimate: { ...est, lineItems, totals: reduceTotals(lineItems) },
        created: false,
      };
    }
    const [newEstimate] = await db
      .insert(estimates)
      .values({ bidId, createdById, status: "DRAFT", versionNumber: 1 })
      .returning();
    return {
      estimate: { ...newEstimate, lineItems: [], totals: { ...ZERO_TOTALS } },
      created: true,
    };
  }

  async getFirstEstimateForBid(bidId: string): Promise<Estimate | null> {
    await this.loadBidByIdAsserted(bidId);
    const [est] = await db
      .select()
      .from(estimates)
      .where(eq(estimates.bidId, bidId))
      .limit(1);
    return est ?? null;
  }

  async getLatestEstimateForBid(bidId: string): Promise<Estimate | null> {
    await this.loadBidByIdAsserted(bidId);
    const [est] = await db.query.estimates.findMany({
      where: eq(estimates.bidId, bidId),
      orderBy: [desc(estimates.versionNumber)],
      limit: 1,
    });
    return est ?? null;
  }

  async listEstimateLineItems(estimateId: string): Promise<EstimateLineItem[]> {
    // estimate is implicitly bid-scoped because routes pass an estimateId only
    // after asserting the bid via getBidByCode.  Caller is responsible for
    // not leaking estimateIds across orgs.
    return db
      .select()
      .from(estimateLineItems)
      .where(eq(estimateLineItems.estimateId, estimateId));
  }

  // ---------------------------------------------------------------------------
  // Sub quotes
  // ---------------------------------------------------------------------------

  async listSubQuotes(bidId: string): Promise<BidSubcontractorQuote[]> {
    await this.loadBidByIdAsserted(bidId);
    const { bidSubcontractorQuotes } = await import("@shared/schema");
    return db
      .select()
      .from(bidSubcontractorQuotes)
      .where(eq(bidSubcontractorQuotes.bidId, bidId))
      .orderBy(desc(bidSubcontractorQuotes.createdAt));
  }

  async createSubQuote(
    bidId: string,
    data: InsertBidSubcontractorQuote,
  ): Promise<BidSubcontractorQuote> {
    await this.loadBidByIdAsserted(bidId);
    const { bidSubcontractorQuotes } = await import("@shared/schema");
    const [row] = await db
      .insert(bidSubcontractorQuotes)
      .values({ ...data, bidId })
      .returning();
    return row;
  }

  async getSubQuoteForBid(
    bidId: string,
    quoteId: string,
  ): Promise<BidSubcontractorQuote | null> {
    await this.loadBidByIdAsserted(bidId);
    const { bidSubcontractorQuotes } = await import("@shared/schema");
    const [row] = await db
      .select()
      .from(bidSubcontractorQuotes)
      .where(eq(bidSubcontractorQuotes.id, quoteId))
      .limit(1);
    if (!row) return null;
    if (row.bidId !== bidId) return null;
    return row;
  }

  async updateSubQuote(
    bidId: string,
    quoteId: string,
    data: Record<string, unknown>,
  ): Promise<BidSubcontractorQuote | null> {
    const found = await this.getSubQuoteForBid(bidId, quoteId);
    if (!found) return null;
    const { bidSubcontractorQuotes } = await import("@shared/schema");
    const [row] = await db
      .update(bidSubcontractorQuotes)
      .set({ ...(data as any), updatedAt: new Date() })
      .where(eq(bidSubcontractorQuotes.id, quoteId))
      .returning();
    return row ?? null;
  }

  async deleteSubQuote(
    bidId: string,
    quoteId: string,
  ): Promise<BidSubcontractorQuote | null> {
    const found = await this.getSubQuoteForBid(bidId, quoteId);
    if (!found) return null;
    const { bidSubcontractorQuotes } = await import("@shared/schema");
    const [row] = await db
      .delete(bidSubcontractorQuotes)
      .where(eq(bidSubcontractorQuotes.id, quoteId))
      .returning();
    return row ?? null;
  }

  async selectSubQuote(bidId: string, quoteId: string): Promise<void> {
    const quote = await this.getSubQuoteForBid(bidId, quoteId);
    if (!quote) return;
    const { bidSubcontractorQuotes } = await import("@shared/schema");
    await db
      .update(bidSubcontractorQuotes)
      .set({ isSelected: false, updatedAt: new Date() })
      .where(
        and(
          eq(bidSubcontractorQuotes.bidId, bidId),
          eq(bidSubcontractorQuotes.scopeOfWork, quote.scopeOfWork),
        ),
      );
    await db
      .update(bidSubcontractorQuotes)
      .set({ isSelected: true, updatedAt: new Date() })
      .where(eq(bidSubcontractorQuotes.id, quoteId));
  }

  async setSubQuoteRfqSent(
    bidId: string,
    quoteId: string,
    responseToken: string,
  ): Promise<BidSubcontractorQuote | null> {
    const found = await this.getSubQuoteForBid(bidId, quoteId);
    if (!found) return null;
    const { bidSubcontractorQuotes } = await import("@shared/schema");
    await db
      .update(bidSubcontractorQuotes)
      .set({
        rfqSentAt: new Date(),
        rfqStatus: "sent",
        rfqResponseToken: responseToken,
        updatedAt: new Date(),
      })
      .where(eq(bidSubcontractorQuotes.id, quoteId));
    const [row] = await db
      .select()
      .from(bidSubcontractorQuotes)
      .where(eq(bidSubcontractorQuotes.id, quoteId))
      .limit(1);
    return row ?? null;
  }

  async setSubQuoteContactEmail(
    bidId: string,
    quoteId: string,
    email: string,
  ): Promise<void> {
    const found = await this.getSubQuoteForBid(bidId, quoteId);
    if (!found) return;
    const { bidSubcontractorQuotes } = await import("@shared/schema");
    await db
      .update(bidSubcontractorQuotes)
      .set({ contactEmail: email, updatedAt: new Date() })
      .where(eq(bidSubcontractorQuotes.id, quoteId));
  }

  // ---------------------------------------------------------------------------
  // Material quotes
  // ---------------------------------------------------------------------------

  async listMaterialQuotes(bidId: string): Promise<BidMaterialQuote[]> {
    await this.loadBidByIdAsserted(bidId);
    const { bidMaterialQuotes } = await import("@shared/schema");
    return db
      .select()
      .from(bidMaterialQuotes)
      .where(eq(bidMaterialQuotes.bidId, bidId))
      .orderBy(desc(bidMaterialQuotes.createdAt));
  }

  async createMaterialQuote(
    bidId: string,
    data: InsertBidMaterialQuote,
  ): Promise<BidMaterialQuote> {
    await this.loadBidByIdAsserted(bidId);
    const { bidMaterialQuotes } = await import("@shared/schema");
    const [row] = await db
      .insert(bidMaterialQuotes)
      .values({ ...data, bidId })
      .returning();
    return row;
  }

  async getMaterialQuoteForBid(
    bidId: string,
    quoteId: string,
  ): Promise<BidMaterialQuote | null> {
    await this.loadBidByIdAsserted(bidId);
    const { bidMaterialQuotes } = await import("@shared/schema");
    const [row] = await db
      .select()
      .from(bidMaterialQuotes)
      .where(eq(bidMaterialQuotes.id, quoteId))
      .limit(1);
    if (!row) return null;
    if (row.bidId !== bidId) return null;
    return row;
  }

  async updateMaterialQuote(
    bidId: string,
    quoteId: string,
    data: Record<string, unknown>,
  ): Promise<BidMaterialQuote | null> {
    const found = await this.getMaterialQuoteForBid(bidId, quoteId);
    if (!found) return null;
    const { bidMaterialQuotes } = await import("@shared/schema");
    const [row] = await db
      .update(bidMaterialQuotes)
      .set({ ...(data as any), updatedAt: new Date() })
      .where(eq(bidMaterialQuotes.id, quoteId))
      .returning();
    return row ?? null;
  }

  async deleteMaterialQuote(
    bidId: string,
    quoteId: string,
  ): Promise<BidMaterialQuote | null> {
    const found = await this.getMaterialQuoteForBid(bidId, quoteId);
    if (!found) return null;
    const { bidMaterialQuotes } = await import("@shared/schema");
    const [row] = await db
      .delete(bidMaterialQuotes)
      .where(eq(bidMaterialQuotes.id, quoteId))
      .returning();
    return row ?? null;
  }

  async setMaterialQuoteRfqSent(
    bidId: string,
    quoteId: string,
  ): Promise<BidMaterialQuote | null> {
    const found = await this.getMaterialQuoteForBid(bidId, quoteId);
    if (!found) return null;
    const { bidMaterialQuotes } = await import("@shared/schema");
    await db
      .update(bidMaterialQuotes)
      .set({ rfqSentAt: new Date(), rfqStatus: "sent", updatedAt: new Date() })
      .where(eq(bidMaterialQuotes.id, quoteId));
    const [row] = await db
      .select()
      .from(bidMaterialQuotes)
      .where(eq(bidMaterialQuotes.id, quoteId))
      .limit(1);
    return row ?? null;
  }

  // ---------------------------------------------------------------------------
  // Handoff packets
  // ---------------------------------------------------------------------------

  async getHandoffPacketByBid(bidId: string): Promise<HandoffPacket | null> {
    await this.loadBidByIdAsserted(bidId);
    const { handoffPackets } = await import("@shared/schema");
    const [row] = await db
      .select()
      .from(handoffPackets)
      .where(eq(handoffPackets.bidId, bidId))
      .limit(1);
    return row ?? null;
  }

  async upsertHandoffPacketByBid(
    bidId: string,
    createdById: string,
    data: UpsertHandoffPacketByBidInput,
  ): Promise<HandoffPacket> {
    await this.loadBidByIdAsserted(bidId);
    const { handoffPackets } = await import("@shared/schema");
    const [existing] = await db
      .select()
      .from(handoffPackets)
      .where(eq(handoffPackets.bidId, bidId))
      .limit(1);

    const packetData = { ...data, bidId, createdById, updatedAt: new Date() };

    if (existing) {
      const [row] = await db
        .update(handoffPackets)
        .set(packetData)
        .where(eq(handoffPackets.id, existing.id))
        .returning();
      return row;
    }
    const [row] = await db.insert(handoffPackets).values(packetData).returning();
    return row;
  }

  async getHandoffPacketByProject(
    projectId: string,
  ): Promise<HandoffPacket | null> {
    // Org assertion via the project's gcOrganizationId.
    const [proj] = await db
      .select({ id: projects.id, gcOrganizationId: projects.gcOrganizationId })
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1);
    if (!proj) return null;
    this.assertOrg("project", proj.id, proj.gcOrganizationId);
    const { handoffPackets } = await import("@shared/schema");
    const [row] = await db
      .select()
      .from(handoffPackets)
      .where(eq(handoffPackets.projectId, projectId))
      .limit(1);
    return row ?? null;
  }

  async updateHandoffPacketByProject(
    projectId: string,
    data: UpsertHandoffPacketByBidInput,
    createdById?: string,
  ): Promise<HandoffPacket> {
    const existing = await this.getHandoffPacketByProject(projectId);
    const { handoffPackets } = await import("@shared/schema");
    if (existing) {
      const [row] = await db
        .update(handoffPackets)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(handoffPackets.id, existing.id))
        .returning();
      return row;
    }
    // No packet yet — create one (upsert behaviour)
    const [row] = await db
      .insert(handoffPackets)
      .values({ ...data, projectId, createdById: createdById ?? "system", updatedAt: new Date() })
      .returning();
    return row;
  }

  // ---------------------------------------------------------------------------
  // Bid documents
  // ---------------------------------------------------------------------------

  async listBidDocuments(bidId: string): Promise<BidDocument[]> {
    await this.loadBidByIdAsserted(bidId);
    return db
      .select()
      .from(bidDocuments)
      .where(eq(bidDocuments.bidId, bidId))
      .orderBy(desc(bidDocuments.uploadedAt));
  }

  async createBidDocument(
    bidId: string,
    data: InsertBidDocumentInput,
  ): Promise<BidDocument> {
    await this.loadBidByIdAsserted(bidId);
    const [row] = await db
      .insert(bidDocuments)
      .values({ ...data, bidId })
      .returning();
    return row;
  }

  async getBidDocumentForBid(
    bidId: string,
    docId: string,
  ): Promise<BidDocument | null> {
    await this.loadBidByIdAsserted(bidId);
    const [row] = await db
      .select()
      .from(bidDocuments)
      .where(and(eq(bidDocuments.id, docId), eq(bidDocuments.bidId, bidId)))
      .limit(1);
    return row ?? null;
  }

  async deleteBidDocumentForBid(bidId: string, docId: string): Promise<void> {
    const found = await this.getBidDocumentForBid(bidId, docId);
    if (!found) return;
    await db.delete(bidDocuments).where(eq(bidDocuments.id, docId));
  }

  // ---------------------------------------------------------------------------
  // Equipment selections
  // ---------------------------------------------------------------------------

  async listBidEquipmentSelections(
    bidId: string,
  ): Promise<BidEquipmentSelection[]> {
    await this.loadBidByIdAsserted(bidId);
    return db
      .select()
      .from(bidEquipmentSelections)
      .where(eq(bidEquipmentSelections.bidId, bidId));
  }

  // ---------------------------------------------------------------------------
  // Misc helpers
  // ---------------------------------------------------------------------------

  async getOrganizationContact(orgId: string) {
    // Tight surface — only the columns bid routes actually use.
    if (this.orgId !== null && this.orgId !== orgId) {
      throw new CrossOrgAccessError("organization", orgId, this.orgId, orgId);
    }
    const [row] = await db
      .select({
        name: organizations.name,
        phone: organizations.phone,
        email: organizations.email,
      })
      .from(organizations)
      .where(eq(organizations.id, orgId))
      .limit(1);
    return row ?? null;
  }

  async getReviewBidLockThresholdPct(orgId: string): Promise<string | null> {
    if (this.orgId !== null && this.orgId !== orgId) {
      throw new CrossOrgAccessError("organization", orgId, this.orgId, orgId);
    }
    const [row] = await db
      .select({ threshold: organizations.takeoffReviewBidLockThresholdPct })
      .from(organizations)
      .where(eq(organizations.id, orgId))
      .limit(1);
    const v = row?.threshold;
    return v == null || v === "" ? null : String(v);
  }

  async getBidReviewDollarSummary(bidId: string): Promise<ReviewSummary> {
    await this.loadBidByIdAsserted(bidId);
    const { takeoffMeasurements: tmTbl, takeoffSheets: tsTbl } = await import(
      "@shared/schema"
    );
    // Task #2321 — IMPORTANT: this formula must stay in lock-step with
    // `measurementDollarValueSql` in server/takeoffMeasurementRoutes.ts.
    const dollarSql = sql`(
      COALESCE(${tmTbl.unitCost}, 0) * COALESCE(
        CASE ${tmTbl.type}::text
          WHEN 'AREA' THEN ${tmTbl.computedAreaFt2}
          WHEN 'PITCHED_AREA' THEN ${tmTbl.computedAreaFt2}
          WHEN 'SURFACE_AREA' THEN ${tmTbl.computedAreaFt2}
          WHEN 'LINEAR' THEN ${tmTbl.computedLengthFt}
          WHEN 'LINEAR_WITH_DROP' THEN ${tmTbl.computedLengthFt}
          WHEN 'PITCHED_LINEAR' THEN ${tmTbl.computedLengthFt}
          WHEN 'VOLUME' THEN ${tmTbl.computedVolumeCy}
          WHEN 'COUNT' THEN ${tmTbl.count}
          ELSE 0
        END,
        0
      )
    )`;
    const [summary] = await db
      .select({
        totalDollars: sql<number>`COALESCE(SUM(${dollarSql}), 0)::float8`,
        approvedDollars: sql<
          number
        >`COALESCE(SUM(${dollarSql}) FILTER (WHERE ${tmTbl.reviewStatus} = 'APPROVED'), 0)::float8`,
      })
      .from(tmTbl)
      .innerJoin(tsTbl, eq(tsTbl.id, tmTbl.sheetId))
      .where(eq(tsTbl.bidId, bidId));
    return {
      totalDollars: Number(summary?.totalDollars ?? 0),
      approvedDollars: Number(summary?.approvedDollars ?? 0),
    };
  }

  async getUserDisplayName(userId: string): Promise<string | null> {
    const [row] = await db
      .select({ firstName: users.firstName, lastName: users.lastName })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (!row) return null;
    return `${row.firstName} ${row.lastName}`.trim();
  }

  async markBidSubmitted(
    code: string,
    nextStatus: string | null,
    submittedAt: Date,
  ): Promise<Bid | null> {
    const existing = await this.getBidByCode(code);
    if (!existing) return null;
    const patch: Record<string, unknown> = { submittedAt, updatedAt: new Date() };
    if (nextStatus) patch.status = nextStatus;
    const [row] = await db
      .update(bids)
      .set(patch as any)
      .where(eq(bids.code, code))
      .returning();
    return row ?? null;
  }

  // ---------------------------------------------------------------------------
  // Public RFQ flow — not org-scoped (token-authenticated).  These methods
  // exist on the same class for convenience, but ignore this.orgId.
  // ---------------------------------------------------------------------------

  async getSubQuoteByRfqToken(token: string): Promise<BidSubcontractorQuote | null> {
    const { bidSubcontractorQuotes } = await import("@shared/schema");
    const [row] = await db
      .select()
      .from(bidSubcontractorQuotes)
      .where(eq(bidSubcontractorQuotes.rfqResponseToken, token))
      .limit(1);
    return row ?? null;
  }

  async getBidByIdUnscoped(id: string): Promise<Bid | null> {
    const [row] = await db.select().from(bids).where(eq(bids.id, id)).limit(1);
    return row ?? null;
  }

  async updateSubQuoteResponseByToken(
    token: string,
    data: Record<string, unknown>,
  ): Promise<void> {
    const { bidSubcontractorQuotes } = await import("@shared/schema");
    await db
      .update(bidSubcontractorQuotes)
      .set(data as any)
      .where(eq(bidSubcontractorQuotes.rfqResponseToken, token));
  }

  // ---------------------------------------------------------------------------
  // Convert bid → project (megaroutine).  Mirrors the previous in-route
  // transaction byte-for-byte.  See server/bidRoutes2.ts pre-refactor for
  // the original.
  // ---------------------------------------------------------------------------

  async convertBidToProject(input: {
    bid: Bid;
    params: ConvertBidParams;
    actorId: string;
  }): Promise<ConvertBidResult> {
    const { bid, params, actorId } = input;
    this.assertOrg("bid", bid.id, bid.gcOrganizationId);

    const bidEstimates = await db
      .select()
      .from(estimates)
      .where(eq(estimates.bidId, bid.id));

    logInfo(
      `[Bid Conversion] Found ${bidEstimates.length} estimates to transfer`,
    );

    const OVERHEAD_PERCENT =
      typeof params.overheadPercent === "number" && params.overheadPercent >= 0
        ? params.overheadPercent
        : 10;
    const PROFIT_MARGIN_PERCENT =
      typeof params.profitPercent === "number" && params.profitPercent >= 0
        ? params.profitPercent
        : 15;
    const projectStartStatus: "ACTIVE" | "PLANNING" =
      params.startStatus === "PLANNING" ? "PLANNING" : "ACTIVE";

    let directCostBudget = "0";
    let contractAmount = bid.bidAmount || "0";
    let sovSeedLineItems: EstimateLineItem[] = [];

    if (bidEstimates.length > 0) {
      const activeEstimate =
        bidEstimates.find((e) => e.status === "APPROVED") || bidEstimates[0];
      if (activeEstimate) {
        const lineItems = await db
          .select()
          .from(estimateLineItems)
          .where(eq(estimateLineItems.estimateId, activeEstimate.id));
        sovSeedLineItems = lineItems;
        const totalDirectCost = lineItems.reduce((sum, item) => {
          const m = Number(item.materialCost || 0);
          const l = Number(item.laborCost || 0);
          const e = Number(item.equipmentCost || 0);
          const c = Number(item.consumablesCost || 0);
          const s = Number(item.subcontractCost || 0);
          return sum + m + l + e + c + s;
        }, 0);
        if (totalDirectCost > 0) {
          directCostBudget = totalDirectCost.toFixed(2);
          const overhead = totalDirectCost * (OVERHEAD_PERCENT / 100);
          const profit = (totalDirectCost + overhead) * (PROFIT_MARGIN_PERCENT / 100);
          const totalContract = totalDirectCost + overhead + profit;
          if (!bid.bidAmount) {
            contractAmount = totalContract.toFixed(2);
          }
          logInfo(`[Bid Conversion] Budget (direct costs): $${directCostBudget}`);
          logInfo(
            `[Bid Conversion] Contract amount (with ${OVERHEAD_PERCENT}% overhead + ${PROFIT_MARGIN_PERCENT}% profit): $${contractAmount}`,
          );
        }
      }
    }

    const {
      projectMaterialBudgets,
      budgetLineItems,
      projectLaborRates,
      jobClassifications,
      bidSubcontractorQuotes: subQuotesTable,
      bidMaterialQuotes: matQuotesTable,
      procurementItems,
      handoffPackets: handoffTable,
      bidEquipmentSelections: equipSelectionsTable,
      projectEquipmentPlans: equipPlansTable,
      planDocuments,
      takeoffSheets,
      takeoffMeasurements,
      quantityCategories,
      takeoffMeasurementGroups,
      takeoffVersions,
      contracts: contractsTable,
      contractVersions: contractVersionsTable,
      notifications: notificationsTable,
    } = await import("@shared/schema");

    const newProject = await db.transaction(async (tx) => {
      const [createdProject] = await tx
        .insert(projects)
        .values({
          name: bid.name,
          code: bid.code,
          clientName: bid.clientName,
          clientContactName: bid.clientContactName,
          clientContactEmail: bid.clientContactEmail,
          clientContactPhone: bid.clientContactPhone,
          status: projectStartStatus,
          locationAddress: bid.locationAddress,
          city: bid.city,
          state: bid.state,
          description: bid.description,
          estimatorId: bid.estimatorId,
          superintendentId: params.superintendentId || null,
          projectManagerId: params.projectManagerId || null,
          contractAmount: contractAmount,
          budget: directCostBudget,
          gcOrganizationId: bid.gcOrganizationId,
          startDate: params.startDate ? new Date(params.startDate) : null,
          endDate: params.endDate ? new Date(params.endDate) : null,
          // Task #1386 — propagate any prevailing-wage decision number set on
          // the bid so the new project picks it up on day one.
          wageDecision: bid.wageDecision || null,
        })
        .returning();

      for (const estimate of bidEstimates) {
        await tx
          .update(estimates)
          .set({ projectId: createdProject.id })
          .where(eq(estimates.id, estimate.id));

        const lineItems = await tx
          .select()
          .from(estimateLineItems)
          .where(eq(estimateLineItems.estimateId, estimate.id));

        logInfo(
          `[Bid Conversion] Syncing ${lineItems.length} line items to scope of work`,
        );

        for (const lineItem of lineItems) {
          const existingScopeItem = await tx.query.scopeItems.findFirst({
            where: eq(scopeItems.estimateLineItemId, lineItem.id),
          });
          if (!existingScopeItem) {
            const [newScopeItem] = await tx
              .insert(scopeItems)
              .values({
                projectId: createdProject.id,
                estimateLineItemId: lineItem.id,
                organizationSowItemId: lineItem.organizationSowItemId || null,
                subcontractorQuoteId: lineItem.subcontractorQuoteId || null,
                description: lineItem.description,
                unit: lineItem.unit,
                totalQuantity: lineItem.quantity,
                unitPrice: lineItem.totalCost
                  ? (Number(lineItem.totalCost) / Number(lineItem.quantity)).toFixed(2)
                  : null,
                estimatedConcreteYards: lineItem.calculatedConcreteYards || null,
                estimatedStoneTons: lineItem.calculatedStoneTons || null,
                estimatedExcavationYards:
                  lineItem.calculatedExcavationYards || null,
                materialResponsibility: lineItem.subcontractorQuoteId
                  ? "SUBCONTRACTOR"
                  : "TFR",
              })
              .returning();

            const materialCost = Number(lineItem.materialCost || 0);
            const quantity = Number(lineItem.quantity || 0);
            if (materialCost > 0 && quantity > 0) {
              const unitCost = materialCost / quantity;
              await tx.insert(projectMaterialBudgets).values({
                projectId: createdProject.id,
                scopeItemId: newScopeItem.id,
                estimateLineItemId: lineItem.id,
                description: lineItem.description,
                unit: lineItem.unit,
                budgetedQuantity: lineItem.quantity,
                budgetedUnitCost: unitCost.toFixed(2),
                budgetedTotalCost: materialCost.toFixed(2),
              });
            }
          }
        }
        logInfo(
          `[Bid Conversion] Created material budgets for project ${createdProject.code}`,
        );
      }

      // Seed SOV from estimate line items
      if (sovSeedLineItems.length > 0) {
        const sovContractValue =
          contractAmount && parseFloat(contractAmount) > 0 ? contractAmount : "0";
        const totalScheduled = sovSeedLineItems.reduce(
          (sum, li) => sum + Number(li.totalCost || 0),
          0,
        );
        const [newSov] = await tx
          .insert(scheduleOfValues)
          .values({
            organizationId: bid.gcOrganizationId!,
            projectId: createdProject.id,
            sovNumber: `SOV-${createdProject.code}-001`,
            title: `${createdProject.name} — Initial Contract`,
            contractValue: sovContractValue,
            totalScheduledValue: totalScheduled.toFixed(2),
            createdById: actorId || null,
          })
          .returning();

        const { validateDotPayItemLink } = await import(
          "../utils/dotPayItemValidation"
        );
        for (let i = 0; i < sovSeedLineItems.length; i++) {
          const li = sovSeedLineItems[i];
          const scheduledValue = Number(li.totalCost || 0);
          const dotFields = {
            dotPayItemId: (li as any).dotPayItemId ?? null,
            payItemNumber: (li as any).payItemNumber ?? null,
            specSection: (li as any).specSection ?? null,
            dotSpecBookId: (li as any).dotSpecBookId ?? null,
          };
          if (dotFields.dotPayItemId) {
            const check = await validateDotPayItemLink(dotFields);
            if (!check.ok) {
              logWarn(
                `[Bid Conversion] Dropping invalid DOT pay-item link on estimate line ${li.id}: ${check.error}`,
              );
              dotFields.dotPayItemId = null;
              dotFields.payItemNumber = null;
              dotFields.specSection = null;
            }
          }
          await tx.insert(sovLineItems).values({
            sovId: newSov.id,
            lineNumber: i + 1,
            itemCode: (li as any).workTypeCode || null,
            description: li.description || `Line Item ${i + 1}`,
            category: (li as any).category || null,
            scheduledValue: scheduledValue.toFixed(2),
            estimateLineItemId: li.id,
            balanceToFinish: scheduledValue.toFixed(2),
            dotPayItemId: dotFields.dotPayItemId,
            payItemNumber: dotFields.payItemNumber,
            specSection: dotFields.specSection,
          });
        }
        logInfo(
          `[Bid Conversion] Seeded SOV ${newSov.sovNumber} with ${sovSeedLineItems.length} line items for project ${createdProject.code}`,
        );
      }

      // Seed budget line items
      if (sovSeedLineItems.length > 0) {
        const seededAt = new Date().toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric",
        });
        const budgetSeedRows: Array<{
          projectId: string;
          costCode: string;
          description: string;
          division: string;
          laborBudget: string;
          materialBudget: string;
          subcontractorBudget: string;
          equipmentBudget: string;
          otherBudget: string;
          totalBudget: string;
        }> = [];

        const CATEGORY_DIVISION_MAP: Record<
          string,
          { division: string; codePrefix: string }
        > = {
          CONCRETE: { division: "Division 03 — Concrete", codePrefix: "03" },
          EXCAVATION: { division: "Division 31 — Earthwork", codePrefix: "31" },
          PAVERS: {
            division: "Division 32 — Exterior Improvements",
            codePrefix: "32",
          },
          BOLLARDS: {
            division: "Division 32 — Exterior Improvements",
            codePrefix: "32",
          },
          GC: { division: "Division 01 — General Requirements", codePrefix: "01" },
          OVERHEAD: {
            division: "Division 01 — General Requirements",
            codePrefix: "01",
          },
          PROFIT: {
            division: "Division 01 — General Requirements",
            codePrefix: "01",
          },
          GENERAL: {
            division: "Division 01 — General Requirements",
            codePrefix: "01",
          },
        };

        const usedCostCodes = new Set<string>();
        for (let i = 0; i < sovSeedLineItems.length; i++) {
          const li = sovSeedLineItems[i];
          const labor = Number(li.laborCost || 0);
          const material = Number(li.materialCost || 0);
          const equipment = Number(li.equipmentCost || 0);
          const subcontract = Number(li.subcontractCost || 0);
          const other =
            Number(li.consumablesCost || 0) +
            Number(li.overheadAllocation || 0) +
            Number(li.profitAllocation || 0);
          const total = labor + material + subcontract + equipment + other;
          if (total <= 0) continue;

          const category = (li as any).category || "GENERAL";
          const divInfo =
            CATEGORY_DIVISION_MAP[category] || CATEGORY_DIVISION_MAP.GENERAL;
          const baseCostCode =
            (li as any).workTypeCode ||
            `${divInfo.codePrefix}-${String(i + 1).padStart(3, "0")}`;
          const division = divInfo.division;

          let costCode = baseCostCode;
          if (usedCostCodes.has(costCode)) {
            let suffix = 2;
            while (usedCostCodes.has(`${baseCostCode}.${suffix}`)) suffix++;
            costCode = `${baseCostCode}.${suffix}`;
          }
          usedCostCodes.add(costCode);

          budgetSeedRows.push({
            projectId: createdProject.id,
            costCode,
            description: `${li.description || `Line Item ${i + 1}`} — Seeded from estimate on ${seededAt}`,
            division,
            laborBudget: labor.toFixed(2),
            materialBudget: material.toFixed(2),
            subcontractorBudget: subcontract.toFixed(2),
            equipmentBudget: equipment.toFixed(2),
            otherBudget: other.toFixed(2),
            totalBudget: total.toFixed(2),
          });
        }
        if (budgetSeedRows.length > 0) {
          await tx.insert(budgetLineItems).values(budgetSeedRows);
          logInfo(
            `[Bid Conversion] Seeded ${budgetSeedRows.length} granular budget line(s) for project ${createdProject.code}`,
          );
        }
      }

      // Seed project labor rates
      if (sovSeedLineItems.length > 0) {
        const classificationIds = new Set<string>();
        for (const li of sovSeedLineItems) {
          if ((li as any).jobClassificationId) {
            classificationIds.add((li as any).jobClassificationId);
          }
        }
        if (classificationIds.size > 0) {
          const classifications = await tx
            .select()
            .from(jobClassifications)
            .where(
              inArray(jobClassifications.id, Array.from(classificationIds)),
            );
          if (classifications.length > 0) {
            const [existingRate] = await tx
              .select()
              .from(projectLaborRates)
              .where(eq(projectLaborRates.projectId, createdProject.id))
              .limit(1);
            if (!existingRate) {
              const primary = classifications[0];
              const regularRate = primary.defaultRegularRate || "0.00";
              const overtimeRate =
                primary.defaultOvertimeRate ||
                (Number(regularRate) * 1.5).toFixed(2);
              const classificationSummary = classifications
                .map((c) => {
                  const reg = c.defaultRegularRate || "0.00";
                  const ot =
                    c.defaultOvertimeRate ||
                    (Number(reg) * 1.5).toFixed(2);
                  return `${c.name}: $${reg}/hr reg, $${ot}/hr OT`;
                })
                .join("; ");
              await tx.insert(projectLaborRates).values({
                projectId: createdProject.id,
                defaultRegularRate: regularRate,
                defaultOvertimeRate: overtimeRate,
                burdenMultiplier: "1.0000",
                notes: `Seeded from estimate classifications — ${classificationSummary}`,
              });
              logInfo(
                `[Bid Conversion] Seeded project labor rate from primary classification: ${primary.name}`,
              );
            }
          }
        }
      }

      // Subcontractor quote transfer
      const allSubQuotes = await tx
        .select()
        .from(subQuotesTable)
        .where(eq(subQuotesTable.bidId, bid.id));
      if (allSubQuotes.length > 0) {
        await tx
          .update(subQuotesTable)
          .set({ projectId: createdProject.id })
          .where(eq(subQuotesTable.bidId, bid.id));
      }
      const selectedSubQuotes = allSubQuotes.filter((q) => q.isSelected);
      const pendingSubQuotes = allSubQuotes.filter((q) => !q.isSelected);
      logInfo(
        `[Bid Conversion] Transferred ${allSubQuotes.length} subcontractor quotes to project (${selectedSubQuotes.length} selected, ${pendingSubQuotes.length} pending)`,
      );

      for (const quote of selectedSubQuotes) {
        let subcontractor: typeof subcontractors.$inferSelect | undefined;
        if (quote.contactEmail || quote.contactPhone) {
          const contactConditions: any[] = [];
          if (quote.contactEmail) {
            contactConditions.push(eq(subcontractors.email, quote.contactEmail));
          }
          if (quote.contactPhone) {
            contactConditions.push(eq(subcontractors.phone, quote.contactPhone));
          }
          subcontractor = await tx.query.subcontractors.findFirst({
            where: and(
              eq(subcontractors.companyName, quote.subcontractorName),
              or(...contactConditions),
            ),
          });
        }
        if (!subcontractor) {
          subcontractor = await tx.query.subcontractors.findFirst({
            where: eq(subcontractors.companyName, quote.subcontractorName),
          });
        }
        if (!subcontractor) {
          [subcontractor] = await tx
            .insert(subcontractors)
            .values({
              companyName: quote.subcontractorName,
              contactName: quote.contactName || null,
              email: quote.contactEmail || null,
              phone: quote.contactPhone || null,
              notes: quote.notes || null,
              isActive: true,
            })
            .returning();
        }
        const contractNumber = `SC-${createdProject.code}-${String(selectedSubQuotes.indexOf(quote) + 1).padStart(3, "0")}`;
        const paymentTerms = quote.leadTime
          ? `Lead Time: ${quote.leadTime}`.substring(0, 500)
          : null;
        const notesParts: string[] = [];
        if (quote.estimatedCompletionTime)
          notesParts.push(`Estimated Completion: ${quote.estimatedCompletionTime}`);
        if (quote.notes) notesParts.push(quote.notes);
        if (quote.fileUrl) {
          const sanitizedFileName = (quote.fileName || "Document").replace(
            /[\r\n]/g,
            " ",
          ).trim();
          notesParts.push(`[Quote Attachment: ${sanitizedFileName}]`);
        }
        const notes =
          notesParts.length > 0
            ? notesParts.join("\n").substring(0, 1000)
            : null;
        await tx.insert(subcontractorContracts).values({
          subcontractorId: subcontractor.id,
          projectId: createdProject.id,
          contractNumber,
          scopeOfWork: quote.scopeOfWork,
          contractAmount: quote.quoteAmount,
          status: "PENDING",
          paymentTerms,
          notes,
          createdById: actorId,
        });
      }

      // Material quote transfer
      const allMatQuotes = await tx
        .select()
        .from(matQuotesTable)
        .where(eq(matQuotesTable.bidId, bid.id));
      if (allMatQuotes.length > 0) {
        await tx
          .update(matQuotesTable)
          .set({ projectId: createdProject.id })
          .where(eq(matQuotesTable.bidId, bid.id));
      }
      const selectedMatQuotes = allMatQuotes.filter((q) => q.isSelected);
      const pendingMatQuotes = allMatQuotes.filter((q) => !q.isSelected);
      logInfo(
        `[Bid Conversion] Transferred ${allMatQuotes.length} material quotes to project (${selectedMatQuotes.length} selected, ${pendingMatQuotes.length} pending)`,
      );
      for (const quote of selectedMatQuotes) {
        let fullDescription = quote.materialName;
        if (quote.specs) fullDescription += ` - ${quote.specs}`;
        if (quote.description) fullDescription += `\n${quote.description}`;
        const additionalInfo: string[] = [];
        if (quote.leadTime) additionalInfo.push(`Lead Time: ${quote.leadTime}`);
        if (quote.supplierContact)
          additionalInfo.push(`Supplier Contact: ${quote.supplierContact}`);
        if (additionalInfo.length > 0) {
          fullDescription += `\n\n[Quote Details]\n${additionalInfo.join("\n")}`;
        }
        await tx.insert(procurementItems).values({
          projectId: createdProject.id,
          description: fullDescription,
          vendor: quote.supplierName || null,
          quantity: "1",
          unit: "LOT",
          unitCost: quote.cost,
          status: "PLANNED",
          neededByDate: null,
        });
      }

      // Handoff packet transfer
      const [existingPacket] = await tx
        .select()
        .from(handoffTable)
        .where(eq(handoffTable.bidId, bid.id))
        .limit(1);
      if (existingPacket) {
        await tx
          .update(handoffTable)
          .set({
            projectId: createdProject.id,
            awardDate: new Date().toISOString().split("T")[0],
            updatedAt: new Date(),
          })
          .where(eq(handoffTable.id, existingPacket.id));
        logInfo(`[Bid Conversion] Transferred handoff packet to project`);
      }

      // Equipment selections → equipment plans
      const bidEquipSelections = await tx
        .select()
        .from(equipSelectionsTable)
        .where(eq(equipSelectionsTable.bidId, bid.id));
      if (bidEquipSelections.length > 0) {
        for (const selection of bidEquipSelections) {
          await tx.insert(equipPlansTable).values({
            projectId: createdProject.id,
            bidEquipmentSelectionId: selection.id,
            source: selection.source,
            status: "PLANNED",
            equipmentId: selection.equipmentId,
            rentalCatalogId: selection.rentalCatalogId,
            rentalVendorId: selection.rentalVendorId,
            equipmentName: selection.equipmentName,
            equipmentType: selection.equipmentType,
            plannedHours: selection.plannedHours,
            plannedDays: selection.plannedDays,
            plannedStartDate: selection.startDate,
            plannedEndDate: selection.endDate,
            plannedCost: selection.estimatedCost,
            hourlyRate: selection.hourlyRate,
            dailyRate: selection.dailyRate,
            notes: selection.notes,
            createdById: actorId,
          });
        }
        logInfo(
          `[Bid Conversion] Transferred ${bidEquipSelections.length} equipment selections to project equipment plans`,
        );
      }

      // Bid documents → plan documents
      const bidDocs = await tx
        .select()
        .from(bidDocuments)
        .where(eq(bidDocuments.bidId, bid.id));
      // Task #2517 — Track inserted plan-doc rows so we can enqueue a
      // best-effort `pdf_tile_prerender` job per document AFTER the
      // transaction commits (enqueueing inside the tx would race the
      // worker against the not-yet-committed row).
      const insertedPlanDocIds: string[] = [];
      if (bidDocs.length > 0) {
        for (const doc of bidDocs) {
          const [inserted] = await tx
            .insert(planDocuments)
            .values({
              projectId: createdProject.id,
              type: doc.type,
              title: doc.title,
              fileName: doc.fileName,
              fileUrl: doc.fileUrl,
              objectKey: doc.objectKey,
              fileSize: doc.fileSize,
              mimeType: doc.mimeType,
              uploadedById: doc.uploadedById,
            })
            .returning({ id: planDocuments.id });
          if (inserted?.id) insertedPlanDocIds.push(inserted.id);
        }
        logInfo(
          `[Bid Conversion] Transferred ${bidDocs.length} bid documents to project plan_documents`,
        );
      }
      // Stash the plan-doc IDs on the transaction return path; the
      // outer caller will fan out enqueues post-commit.
      (createdProject as { _planDocumentIds?: string[] })._planDocumentIds = insertedPlanDocIds;

      // Duplicate takeoff sheets/measurements/categories/groups
      const bidSheets = await tx
        .select()
        .from(takeoffSheets)
        .where(eq(takeoffSheets.bidId, bid.id));
      const bidCategories = await tx
        .select()
        .from(quantityCategories)
        .where(eq(quantityCategories.bidId, bid.id));
      const bidGroups = await tx
        .select()
        .from(takeoffMeasurementGroups)
        .where(eq(takeoffMeasurementGroups.bidId, bid.id));

      const categoryIdMap = new Map<string, string>();
      for (const cat of bidCategories) {
        const [newCat] = await tx
          .insert(quantityCategories)
          .values({
            projectId: createdProject.id,
            name: cat.name,
            color: cat.color,
            lineStyle: cat.lineStyle,
            lineWidth: cat.lineWidth,
            wasteFactor: cat.wasteFactor,
            unitCost: cat.unitCost,
            displayOrder: cat.displayOrder,
          })
          .returning();
        categoryIdMap.set(cat.id, newCat.id);
      }

      const sheetIdMap = new Map<string, string>();
      for (const sheet of bidSheets) {
        const [newSheet] = await tx
          .insert(takeoffSheets)
          .values({
            projectId: createdProject.id,
            imageUrl: sheet.imageUrl,
            sheetIndex: sheet.sheetIndex,
            sheetName: sheet.sheetName,
            scalePxPerFoot: sheet.scalePxPerFoot,
            units: sheet.units,
            folderGroup: sheet.folderGroup,
            revisionLabel: sheet.revisionLabel,
            isActive: true,
            rotation: sheet.rotation,
          })
          .returning();
        sheetIdMap.set(sheet.id, newSheet.id);
      }

      const groupIdMap = new Map<string, string>();
      for (const group of bidGroups) {
        const newSheetId = group.sheetId
          ? sheetIdMap.get(group.sheetId) || null
          : null;
        const [newGroup] = await tx
          .insert(takeoffMeasurementGroups)
          .values({
            name: group.name,
            projectId: createdProject.id,
            sheetId: newSheetId,
            sortOrder: group.sortOrder,
            color: group.color,
          })
          .returning();
        groupIdMap.set(group.id, newGroup.id);
      }

      let measurementsCopied = 0;
      for (const [oldSheetId, newSheetId] of sheetIdMap) {
        const sheetVersions = await tx
          .select()
          .from(takeoffVersions)
          .where(eq(takeoffVersions.sheetId, oldSheetId))
          .orderBy(takeoffVersions.versionNumber);
        const latestVersion =
          sheetVersions.length > 0 ? sheetVersions[sheetVersions.length - 1] : null;

        if (latestVersion) {
          const orphaned = await tx
            .select({ id: takeoffMeasurements.id })
            .from(takeoffMeasurements)
            .where(
              and(
                eq(takeoffMeasurements.sheetId, oldSheetId),
                sql`takeoff_measurements.takeoff_version_id IS NULL`,
              ),
            );
          for (const m of orphaned) {
            await tx
              .update(takeoffMeasurements)
              .set({ takeoffVersionId: latestVersion.id })
              .where(eq(takeoffMeasurements.id, m.id));
          }
        }

        const bidMeasurements = latestVersion
          ? await tx
              .select()
              .from(takeoffMeasurements)
              .where(
                and(
                  eq(takeoffMeasurements.sheetId, oldSheetId),
                  eq(takeoffMeasurements.takeoffVersionId, latestVersion.id),
                ),
              )
          : await tx
              .select()
              .from(takeoffMeasurements)
              .where(eq(takeoffMeasurements.sheetId, oldSheetId));

        const [projectVersion] = await tx
          .insert(takeoffVersions)
          .values({
            projectId: createdProject.id,
            sheetId: newSheetId,
            versionNumber: 1,
            status: "DRAFT",
            createdById: actorId,
            label: "Project Takeoff v1",
          })
          .returning();

        if (bidMeasurements.length > 0) {
          const cloned = bidMeasurements.map((m) => ({
            sheetId: newSheetId,
            categoryId: m.categoryId
              ? categoryIdMap.get(m.categoryId) || null
              : null,
            groupId: m.groupId ? groupIdMap.get(m.groupId) || null : null,
            takeoffVersionId: projectVersion.id,
            originMeasurementId: m.originMeasurementId || m.id,
            type: m.type,
            label: m.label,
            points: m.points,
            arcData: m.arcData,
            depthFeet: m.depthFeet,
            count: m.count,
            note: m.note,
            color: m.color,
            visible: m.visible,
            source: m.source,
            status: m.status,
            pitchRatio: m.pitchRatio,
            costCodeId: m.costCodeId,
            unitCost: m.unitCost,
            lineStyle: m.lineStyle,
            lineWidth: m.lineWidth,
            computedLengthFt: m.computedLengthFt,
            computedAreaFt2: m.computedAreaFt2,
            computedVolumeCy: m.computedVolumeCy,
            computedSurfaceAreaFt2: m.computedSurfaceAreaFt2,
            deductions: m.deductions,
            metadata: m.metadata,
            subcontractorId: m.subcontractorId,
            supplierId: m.supplierId,
            locationTag: m.locationTag,
            installationStatus: m.installationStatus,
          }));
          await tx.insert(takeoffMeasurements).values(cloned);
          measurementsCopied += cloned.length;
        }

        const bidVersions = await tx
          .select()
          .from(takeoffVersions)
          .where(eq(takeoffVersions.sheetId, oldSheetId));
        if (bidVersions.length > 0) {
          const latestBidVersion = bidVersions[bidVersions.length - 1];
          const orphanedMeasurements = await tx
            .select({ id: takeoffMeasurements.id })
            .from(takeoffMeasurements)
            .where(
              and(
                eq(takeoffMeasurements.sheetId, oldSheetId),
                sql`takeoff_measurements.takeoff_version_id IS NULL`,
              ),
            );
          for (const m of orphanedMeasurements) {
            await tx
              .update(takeoffMeasurements)
              .set({ takeoffVersionId: latestBidVersion.id })
              .where(eq(takeoffMeasurements.id, m.id));
          }
          for (const bv of bidVersions) {
            await tx
              .update(takeoffVersions)
              .set({ status: "LOCKED" })
              .where(eq(takeoffVersions.id, bv.id));
          }
        } else {
          const [lockedBidVersion] = await tx
            .insert(takeoffVersions)
            .values({
              bidId: bid.id,
              sheetId: oldSheetId,
              versionNumber: 1,
              status: "LOCKED",
              createdById: actorId,
              label: "Bid Takeoff (Locked)",
            })
            .returning();
          const unversioned = await tx
            .select({ id: takeoffMeasurements.id })
            .from(takeoffMeasurements)
            .where(
              and(
                eq(takeoffMeasurements.sheetId, oldSheetId),
                sql`takeoff_measurements.takeoff_version_id IS NULL`,
              ),
            );
          for (const m of unversioned) {
            await tx
              .update(takeoffMeasurements)
              .set({ takeoffVersionId: lockedBidVersion.id })
              .where(eq(takeoffMeasurements.id, m.id));
          }
        }
      }
      logInfo(
        `[Bid Conversion] Duplicated ${bidSheets.length} takeoff sheets with ${measurementsCopied} measurements, ${bidCategories.length} categories, ${bidGroups.length} groups to project`,
      );

      await tx
        .update(bids)
        .set({
          status: "AWARDED",
          convertedToProjectId: createdProject.id,
          awardedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(bids.code, bid.code));

      return createdProject;
    });

    // Task #2757 / #2761 — Best-effort enqueue PDF tile prerender for every
    // plan document carried over from the bid, gated behind
    // TILE_RENDERING_ENABLED. Runs AFTER the tx commits so the worker
    // is guaranteed to see the new rows. Logic extracted to
    // `services/pdfTileDispatch` so the gate can be unit-tested.
    const planDocIds =
      (newProject as { _planDocumentIds?: string[] })._planDocumentIds ?? [];
    if (planDocIds.length > 0) {
      const { tryEnqueueTilePrerender } = await import("../services/pdfTileDispatch");
      for (const planDocId of planDocIds) {
        await tryEnqueueTilePrerender({
          planDocumentId: planDocId,
          organizationId: newProject.gcOrganizationId!,
          userId: input.actorId,
          site: "bid-conversion",
        });
      }
    }

    // Task #1386 — fire-and-forget Davis-Bacon auto-sync.
    if (newProject.wageDecision && newProject.gcOrganizationId) {
      const orgId = newProject.gcOrganizationId;
      const decision = newProject.wageDecision;
      void queueWageDecisionSync(orgId, decision).catch((err) => {
        logError("[Bid Conversion] queueWageDecisionSync failed", {
          orgId,
          decision,
          error: err instanceof Error ? err.message : String(err),
        });
      });
    }

    // Auto-create draft contract (best-effort).
    let draftContractCreated = false;
    try {
      const contractNum = `CTR-${newProject.code}-001`;
      const partiesStr = [bid.clientName].filter(Boolean).join(", ");
      const [newContract] = await db
        .insert(contractsTable)
        .values({
          organizationId: newProject.gcOrganizationId!,
          projectId: newProject.id,
          bidId: bid.id,
          contractNumber: contractNum,
          contractType: "PRIME",
          status: "DRAFT",
          parties: partiesStr || null,
          contractValue: contractAmount || null,
          scopeSummary: bid.description || null,
          currentVersion: 1,
          createdById: actorId,
        })
        .returning();
      await db.insert(contractVersionsTable).values({
        contractId: newContract.id,
        versionNumber: 1,
        snapshotJson: JSON.stringify(newContract),
        changedById: actorId,
        changeNote: "Auto-created from bid conversion",
      });
      draftContractCreated = true;
      logInfo(
        `[Bid Conversion] Auto-created draft contract ${contractNum} for project ${newProject.code}`,
      );
    } catch (contractErr) {
      const errMsg =
        contractErr instanceof Error ? contractErr.message : String(contractErr);
      logError(`[Bid Conversion] Failed to auto-create contract: ${errMsg}`);
    }

    // Task #2833 — BID_CONVERSION_AUTO_ESIGN: when the flag is on and the
    // draft contract was successfully created, immediately queue an ESIGN_SEND
    // approval request so PMs can send for signature without a manual trigger.
    if (draftContractCreated && newProject.gcOrganizationId) {
      try {
        const { isFeatureEnabled } = await import("../services/featureFlagService");
        const autoEsign = await isFeatureEnabled(newProject.gcOrganizationId, "BID_CONVERSION_AUTO_ESIGN");
        if (autoEsign) {
          const { createApprovalRequest } = await import("../services/approvalService");
          // Create one ESIGN_SEND approval per subcontractor contract in PENDING status
          // generated for this project — not a single project-level approval.
          const { subcontractorContracts: subContracts } = await import("@shared/schema");
          const { eq: deqEq, and: deqAnd } = await import("drizzle-orm");
          const { db: deqDb } = await import("../db");
          const pendingContracts = await deqDb
            .select({ id: subContracts.id, contractNumber: subContracts.contractNumber })
            .from(subContracts)
            .where(deqAnd(
              deqEq(subContracts.projectId, newProject.id),
              deqEq(subContracts.status, "PENDING"),
            ));
          let esignCreated = 0;
          for (const contract of pendingContracts) {
            await createApprovalRequest(
              newProject.gcOrganizationId,
              "ESIGN_SEND",
              contract.id,
              actorId,
              `Auto e-sign for subcontractor contract ${contract.contractNumber ?? contract.id} on project ${newProject.code}`,
            );
            // Transition the contract to ESIGN_PENDING immediately so the
            // e-sign workflow is visible without a separate manual trigger.
            await deqDb.update(subContracts)
              .set({ status: "ESIGN_PENDING", updatedAt: new Date() })
              .where(deqEq(subContracts.id, contract.id));
            esignCreated++;
          }
          logInfo(`[Bid Conversion] Created ${esignCreated} ESIGN_SEND approval request(s) and transitioned contracts to ESIGN_PENDING for project ${newProject.code}`);
        }
      } catch (esignErr) {
        logError(`[Bid Conversion] BID_CONVERSION_AUTO_ESIGN wiring failed: ${esignErr instanceof Error ? esignErr.message : String(esignErr)}`);
      }
    }

    // Project assignment notifications.
    const notifTargets: Array<{ id: string; role: string }> = [];
    if (params.superintendentId)
      notifTargets.push({ id: params.superintendentId, role: "Superintendent" });
    if (params.projectManagerId)
      notifTargets.push({ id: params.projectManagerId, role: "Project Manager" });
    if (params.projectEngineerId)
      notifTargets.push({ id: params.projectEngineerId, role: "Project Engineer" });
    if (params.foremanId)
      notifTargets.push({ id: params.foremanId, role: "Foreman" });
    for (const t of notifTargets) {
      await db.insert(notificationsTable).values({
        userId: t.id,
        type: "PROJECT_ASSIGNMENT",
        title: "New Project Assignment",
        message: `You have been assigned as ${t.role} for project "${newProject.name}" (${newProject.code})`,
        relatedEntityId: newProject.id,
        relatedEntityType: "project",
      });
      logInfo(
        `[Bid Conversion] Created PROJECT_ASSIGNMENT notification for ${t.role.toLowerCase()} ${t.id}`,
      );
    }

    return {
      project: newProject,
      draftContractCreated,
      estimateCount: bidEstimates.length,
    };
  }
}
