/**
 * Per-domain storage seam for the Bids domain (pilot for Task #2431).
 *
 * Goals
 *  - Routes never see Drizzle types, raw SQL, or table objects.
 *  - Every method is org-scoped: implementations refuse cross-org reads/writes
 *    by throwing CrossOrgAccessError.
 *  - Behaviour is byte-identical to the previous direct-db code from the
 *    perspective of an API consumer.
 *
 * The interface is intentionally chunky (one method per route operation)
 * so the routes stay thin and the storage owns the SQL, joins, and
 * transactional boundaries.  See docs/architecture/storage-pattern.md for
 * the rationale and the roadmap to the next domains (takeoff, payroll,
 * crm, dot, integrations).
 */

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
  Project,
} from "@shared/schema";

/**
 * Thrown when a caller asks the storage for a row that exists but lives in
 * a different organization than the one bound to this storage instance.
 *
 * Routes should map this to HTTP 403 to mirror the behaviour of the legacy
 * verifyOrgAccess() helper.  A row that simply doesn't exist returns
 * `null`/`undefined` from the storage and should be mapped to 404 in the
 * route layer (matching the pre-refactor responses).
 */
export class CrossOrgAccessError extends Error {
  public readonly entity: string;
  public readonly entityId: string;
  public readonly attemptedOrgId: string | null;
  public readonly actualOrgId: string | null;

  constructor(
    entity: string,
    entityId: string,
    attemptedOrgId: string | null,
    actualOrgId: string | null,
  ) {
    super(
      `CrossOrgAccessError: ${entity}#${entityId} belongs to org ` +
        `${actualOrgId ?? "<null>"} but storage is scoped to ${attemptedOrgId ?? "<null>"}`,
    );
    this.name = "CrossOrgAccessError";
    this.entity = entity;
    this.entityId = entityId;
    this.attemptedOrgId = attemptedOrgId;
    this.actualOrgId = actualOrgId;
  }
}

/**
 * Bid list-row shape returned by listBidsWithEstimateSummary().  Mirrors the
 * legacy response (bid columns + estimatorName + estimateSummary).
 */
export interface BidListRow extends Bid {
  estimatorName: string | null;
  estimateSummary: {
    totalCost: number;
    lineItemCount: number;
    status: string;
  } | null;
}

export interface EstimateLineItemTotals {
  materialCost: number;
  laborCost: number;
  laborHours: number;
  equipmentCost: number;
  consumablesCost: number;
  subcontractCost: number;
  overheadAllocation: number;
  profitAllocation: number;
  totalCost: number;
}

export interface EstimateWithLineItems extends Estimate {
  lineItems: EstimateLineItem[];
  totals: EstimateLineItemTotals;
}

export interface ConvertBidParams {
  superintendentId?: string | null;
  projectManagerId?: string | null;
  projectEngineerId?: string | null;
  foremanId?: string | null;
  overheadPercent?: number;
  profitPercent?: number;
  startStatus?: "ACTIVE" | "PLANNING";
  startDate?: string | null;
  endDate?: string | null;
}

export interface ConvertBidResult {
  /**
   * The newly created project row (full row).  Returned to the route which
   * is responsible for emitting the bid.converted_to_project event and
   * queuing Davis-Bacon sync.
   */
  project: Project;
  /** True if a draft contract was auto-created for the new project. */
  draftContractCreated: boolean;
  /** Number of estimates that were transferred (informational). */
  estimateCount: number;
}

export interface UpsertHandoffPacketByBidInput {
  gcName?: string | null;
  gcContactName?: string | null;
  gcPhone?: string | null;
  gcEmail?: string | null;
  accessDetails?: string | null;
  scopeOfWorkSummary?: string | null;
  contractValue?: string | null;
  bidDate?: string | null;
  awardDate?: string | null;
  markupPercent?: string | null;
  duration?: string | null;
  projectStartDate?: string | null;
  projectCompletionDate?: string | null;
  manpower?: string | null;
  alternates?: string | null;
  subcontractExecuted?: boolean | null;
  insuranceCerts?: string | null;
  bondRequired?: boolean | null;
  permits?: string | null;
  retentionPercent?: string | null;
  paymentTerms?: string | null;
  scheduleOfValuesReady?: boolean | null;
  drawSchedule?: string | null;
  prevailingWage?: boolean | null;
  concreteSupplier?: string | null;
  mixInfo?: string | null;
  rebarVendor?: string | null;
  formingMaterialPlan?: string | null;
  curingSpecs?: string | null;
  specialItems?: string | null;
  leadTimeRisks?: string | null;
  submittalStatus?: string | null;
  layoutSurveyBy?: string | null;
  benchmarkInfo?: string | null;
  accessZones?: string | null;
  workHours?: string | null;
  safetyOrientation?: string | null;
  inspectionNeeds?: string | null;
  coordinationIssues?: string | null;
  weatherRisks?: string | null;
  soilConditions?: string | null;
  estimatorNotes?: string | null;
  gcContactMethod?: string | null;
  projectManager?: string | null;
  superintendent?: string | null;
  officeAdmin?: string | null;
  safetyContact?: string | null;
}

/** Plain projection of the projects row used in bid routes (delete check + handoff). */
export interface ProjectInfo {
  id: string;
  code: string;
  name: string;
  gcOrganizationId: string | null;
  superintendentId: string | null;
}

export interface InsertBidDocumentInput {
  title: string;
  fileName: string;
  fileUrl: string;
  objectKey?: string;
  fileSize?: number;
  mimeType?: string;
  type: "PLANS" | "SPECS" | "TAKEOFF" | "OTHER" | "BIM";
  uploadedById: string;
}

export interface ReviewSummary {
  totalDollars: number;
  approvedDollars: number;
}

export interface BidMutationResult<T> {
  /** Whether the bid existed (and lived in this org). */
  found: boolean;
  /** The mutated row, when found. */
  row: T | null;
}

/**
 * Per-domain storage interface for everything the bid routes touch.
 *
 * Implementations MUST refuse cross-org access:
 *   - For methods that load by id/code, they throw CrossOrgAccessError when
 *     the row exists but doesn't belong to the bound orgId.  (Returning
 *     `null` is reserved for "row does not exist", which routes map to 404.)
 *   - For listing methods, the WHERE clause is filtered by the bound orgId.
 *
 * `null` orgId is the platform/super-admin / public-token mode and disables
 * the org check.  Routes pass `null` for SUPER_ADMIN sessions and for the
 * unauthenticated `/api/public/rfq-response/:token` flow which authenticates
 * via the RFQ token itself.
 */
export interface IBidStorage {
  // ===== Bid CRUD =====
  listBidsWithEstimateSummary(): Promise<BidListRow[]>;
  getBidByCode(code: string): Promise<Bid | null>;
  getBidById(id: string): Promise<Bid | null>;
  createBid(data: InsertBid & { gcOrganizationId: string | null }): Promise<Bid>;
  updateBidByCode(code: string, patch: Record<string, unknown>): Promise<Bid | null>;
  /**
   * Hard-deletes a bid and its dependent rows (handoff packets, sub/material
   * quotes, estimates+line items).  The route is expected to have already
   * checked that no project shares the bid's code.
   */
  deleteBidByCode(code: string): Promise<Bid | null>;
  getNextBidCode(): Promise<string>;
  getProjectByCode(code: string): Promise<ProjectInfo | null>;

  // ===== Estimates =====
  listEstimatesForBid(bidId: string): Promise<Estimate[]>;
  getActiveEstimateWithLineItems(
    bidId: string,
  ): Promise<EstimateWithLineItems | null>;
  getOrCreateEstimateForBid(
    bidId: string,
    createdById: string,
  ): Promise<{ estimate: EstimateWithLineItems; created: boolean }>;
  getFirstEstimateForBid(bidId: string): Promise<Estimate | null>;
  getLatestEstimateForBid(bidId: string): Promise<Estimate | null>;
  listEstimateLineItems(estimateId: string): Promise<EstimateLineItem[]>;

  // ===== Bid sub quotes =====
  listSubQuotes(bidId: string): Promise<BidSubcontractorQuote[]>;
  createSubQuote(
    bidId: string,
    data: InsertBidSubcontractorQuote,
  ): Promise<BidSubcontractorQuote>;
  /** Returns the quote scoped to the bid; null when missing or wrong bid. */
  getSubQuoteForBid(
    bidId: string,
    quoteId: string,
  ): Promise<BidSubcontractorQuote | null>;
  updateSubQuote(
    bidId: string,
    quoteId: string,
    data: Record<string, unknown>,
  ): Promise<BidSubcontractorQuote | null>;
  deleteSubQuote(
    bidId: string,
    quoteId: string,
  ): Promise<BidSubcontractorQuote | null>;
  /**
   * Marks the given quote as selected for its scopeOfWork and clears the
   * selection on every other quote within the same bid+scope.
   */
  selectSubQuote(bidId: string, quoteId: string): Promise<void>;

  // ===== Bid material quotes =====
  listMaterialQuotes(bidId: string): Promise<BidMaterialQuote[]>;
  createMaterialQuote(
    bidId: string,
    data: InsertBidMaterialQuote,
  ): Promise<BidMaterialQuote>;
  getMaterialQuoteForBid(
    bidId: string,
    quoteId: string,
  ): Promise<BidMaterialQuote | null>;
  updateMaterialQuote(
    bidId: string,
    quoteId: string,
    data: Record<string, unknown>,
  ): Promise<BidMaterialQuote | null>;
  deleteMaterialQuote(
    bidId: string,
    quoteId: string,
  ): Promise<BidMaterialQuote | null>;

  // ===== Handoff Packets =====
  getHandoffPacketByBid(bidId: string): Promise<HandoffPacket | null>;
  upsertHandoffPacketByBid(
    bidId: string,
    createdById: string,
    data: UpsertHandoffPacketByBidInput,
  ): Promise<HandoffPacket>;
  getHandoffPacketByProject(projectId: string): Promise<HandoffPacket | null>;
  updateHandoffPacketByProject(
    projectId: string,
    data: UpsertHandoffPacketByBidInput,
  ): Promise<HandoffPacket | null>;

  // ===== Bid documents =====
  listBidDocuments(bidId: string): Promise<BidDocument[]>;
  createBidDocument(
    bidId: string,
    data: InsertBidDocumentInput,
  ): Promise<BidDocument>;
  /** Returns the doc scoped to the bid; null when missing or wrong bid. */
  getBidDocumentForBid(
    bidId: string,
    docId: string,
  ): Promise<BidDocument | null>;
  deleteBidDocumentForBid(bidId: string, docId: string): Promise<void>;

  // ===== Equipment Selections (read-only here) =====
  listBidEquipmentSelections(bidId: string): Promise<BidEquipmentSelection[]>;

  // ===== Misc helpers used by bid routes =====
  /**
   * Reads only the columns bid routes actually use (name/phone/email)
   * — keeps the surface tight and avoids leaking unrelated org data.
   */
  getOrganizationContact(
    orgId: string,
  ): Promise<{ name: string | null; phone: string | null; email: string | null } | null>;
  /** The decimal % column (string from pg) on organizations.takeoffReviewBidLockThresholdPct. */
  getReviewBidLockThresholdPct(orgId: string): Promise<string | null>;
  /** Sum of approved/total dollar value of measurements under a bid (Task #2321 gate). */
  getBidReviewDollarSummary(bidId: string): Promise<ReviewSummary>;
  /** Used by the bid.assigned event payload. */
  getUserDisplayName(userId: string): Promise<string | null>;

  // ===== Public RFQ flow (token-authenticated; no org context) =====
  getSubQuoteByRfqToken(token: string): Promise<BidSubcontractorQuote | null>;
  getBidByIdUnscoped(id: string): Promise<Bid | null>;
  updateSubQuoteResponseByToken(
    token: string,
    data: Record<string, unknown>,
  ): Promise<void>;

  // ===== Mark sub quote as RFQ-sent =====
  setSubQuoteRfqSent(
    bidId: string,
    quoteId: string,
    responseToken: string,
  ): Promise<BidSubcontractorQuote | null>;
  setSubQuoteContactEmail(
    bidId: string,
    quoteId: string,
    email: string,
  ): Promise<void>;
  setMaterialQuoteRfqSent(
    bidId: string,
    quoteId: string,
  ): Promise<BidMaterialQuote | null>;

  // ===== Submit gate (status update + audit anchor) =====
  markBidSubmitted(
    code: string,
    nextStatus: string | null,
    submittedAt: Date,
  ): Promise<Bid | null>;

  // ===== Convert (megaroutine; runs entire transaction) =====
  convertBidToProject(input: {
    bid: Bid;
    params: ConvertBidParams;
    actorId: string;
  }): Promise<ConvertBidResult>;
}
