import { and, eq, isNotNull } from "drizzle-orm";
import { db } from "../../db";
import { bidDocuments, bidMaterialQuotes, bidSubcontractorQuotes, planDocuments, projects, bids } from "@shared/schema";

export type EstimatorFileType = "pdf_plan" | "pdf_spec" | "spreadsheet" | "image" | "other";

export interface EstimatorFileRef {
  id: string;
  fileName: string;
  fileUrl: string;
  fileSize: number | null;
  mimeType: string | null;
  fileType: EstimatorFileType;
  source: "bid_document" | "plan_document" | "quote_document";
  bidId: string | null;
  projectId: string | null;
}

const FILE_TYPE_PRIORITY: Record<EstimatorFileType, number> = {
  pdf_plan: 0,
  pdf_spec: 1,
  spreadsheet: 2,
  image: 3,
  other: 4,
};

const MAX_FILES_PER_RESOLVER = 30;

const SPREADSHEET_EXTS = new Set(["xlsx", "xls", "csv", "ods"]);
const SPREADSHEET_MIMES = new Set([
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/csv",
  "application/csv",
  "application/vnd.oasis.opendocument.spreadsheet",
]);

const IMAGE_EXTS = new Set(["jpg", "jpeg", "png", "gif", "webp", "tiff", "tif", "bmp"]);

// Keywords that suggest a PDF is a plan/drawing sheet rather than a spec or submittal.
const PLAN_KEYWORDS =
  /\b(plan|drawing|sheet|layout|elevation|section|detail|site|floor|civil|structural|architectural|mechanical|electrical|plumbing|survey)\b/i;

export function classifyFile(fileName: string, mimeType: string | null): EstimatorFileType {
  const ext = (fileName.split(".").pop() ?? "").toLowerCase();
  const mime = (mimeType ?? "").toLowerCase();

  if (SPREADSHEET_EXTS.has(ext) || SPREADSHEET_MIMES.has(mime)) {
    return "spreadsheet";
  }
  if (mime.startsWith("image/") || IMAGE_EXTS.has(ext)) {
    return "image";
  }
  if (mime === "application/pdf" || ext === "pdf") {
    return PLAN_KEYWORDS.test(fileName) ? "pdf_plan" : "pdf_spec";
  }
  return "other";
}

/**
 * Resolve all file references relevant to a draft-takeoff context.
 *
 * - When `bidId` is set, queries `bid_documents` for that bid (verifying org ownership),
 *   then also queries `bid_subcontractor_quotes` and `bid_material_quotes` for attachments.
 * - When `projectId` is set, queries `plan_documents` for that project (verifying org ownership),
 *   and also bridges to any bid that was converted into that project so its `bid_documents` are
 *   included without re-upload.
 *
 * Results are sorted by file type priority (PDF plans first, images/other last)
 * and capped at MAX_FILES_PER_RESOLVER to prevent runaway extraction costs.
 * Files are deduplicated by `fileUrl` so a file present in multiple sources is only sent once.
 */
export async function resolveEstimatorFiles(params: {
  bidId?: string;
  projectId?: string;
  organizationId: string;
}): Promise<EstimatorFileRef[]> {
  const refs: EstimatorFileRef[] = [];
  const seenUrls = new Set<string>();

  function addRef(ref: EstimatorFileRef): void {
    if (!seenUrls.has(ref.fileUrl)) {
      seenUrls.add(ref.fileUrl);
      refs.push(ref);
    }
  }

  if (params.bidId) {
    const [bid] = await db
      .select({ id: bids.id })
      .from(bids)
      .where(
        and(
          eq(bids.id, params.bidId),
          eq(bids.gcOrganizationId, params.organizationId),
        ),
      )
      .limit(1);

    if (bid) {
      // bid_documents
      const docs = await db
        .select({
          id: bidDocuments.id,
          fileName: bidDocuments.fileName,
          fileUrl: bidDocuments.fileUrl,
          fileSize: bidDocuments.fileSize,
          mimeType: bidDocuments.mimeType,
        })
        .from(bidDocuments)
        .where(eq(bidDocuments.bidId, params.bidId));

      for (const doc of docs) {
        addRef({
          id: doc.id,
          fileName: doc.fileName,
          fileUrl: doc.fileUrl,
          fileSize: doc.fileSize,
          mimeType: doc.mimeType,
          fileType: classifyFile(doc.fileName, doc.mimeType),
          source: "bid_document",
          bidId: params.bidId,
          projectId: null,
        });
      }

      // Step 2 — quote attachments (sub quotes + material quotes)
      const [subQuotes, matQuotes] = await Promise.all([
        db
          .select({
            id: bidSubcontractorQuotes.id,
            fileName: bidSubcontractorQuotes.fileName,
            fileUrl: bidSubcontractorQuotes.fileUrl,
            fileSize: bidSubcontractorQuotes.fileSize,
            mimeType: bidSubcontractorQuotes.mimeType,
          })
          .from(bidSubcontractorQuotes)
          .where(
            and(
              eq(bidSubcontractorQuotes.bidId, params.bidId),
              isNotNull(bidSubcontractorQuotes.fileUrl),
            ),
          ),
        db
          .select({
            id: bidMaterialQuotes.id,
            fileName: bidMaterialQuotes.fileName,
            fileUrl: bidMaterialQuotes.fileUrl,
            fileSize: bidMaterialQuotes.fileSize,
            mimeType: bidMaterialQuotes.mimeType,
          })
          .from(bidMaterialQuotes)
          .where(
            and(
              eq(bidMaterialQuotes.bidId, params.bidId),
              isNotNull(bidMaterialQuotes.fileUrl),
            ),
          ),
      ]);

      for (const q of subQuotes) {
        if (!q.fileUrl || !q.fileName) continue;
        addRef({
          id: q.id,
          fileName: q.fileName,
          fileUrl: q.fileUrl,
          fileSize: q.fileSize ?? null,
          mimeType: q.mimeType ?? null,
          fileType: classifyFile(q.fileName, q.mimeType ?? null),
          source: "quote_document",
          bidId: params.bidId,
          projectId: null,
        });
      }

      for (const q of matQuotes) {
        if (!q.fileUrl || !q.fileName) continue;
        addRef({
          id: q.id,
          fileName: q.fileName,
          fileUrl: q.fileUrl,
          fileSize: q.fileSize ?? null,
          mimeType: q.mimeType ?? null,
          fileType: classifyFile(q.fileName, q.mimeType ?? null),
          source: "quote_document",
          bidId: params.bidId,
          projectId: null,
        });
      }
    }
  }

  if (params.projectId) {
    const [project] = await db
      .select({ id: projects.id })
      .from(projects)
      .where(
        and(
          eq(projects.id, params.projectId),
          eq(projects.gcOrganizationId, params.organizationId),
        ),
      )
      .limit(1);

    if (project) {
      // plan_documents for this project
      const docs = await db
        .select({
          id: planDocuments.id,
          fileName: planDocuments.fileName,
          fileUrl: planDocuments.fileUrl,
          fileSize: planDocuments.fileSize,
          mimeType: planDocuments.mimeType,
        })
        .from(planDocuments)
        .where(eq(planDocuments.projectId, params.projectId));

      for (const doc of docs) {
        addRef({
          id: doc.id,
          fileName: doc.fileName,
          fileUrl: doc.fileUrl,
          fileSize: doc.fileSize,
          mimeType: doc.mimeType,
          fileType: classifyFile(doc.fileName, doc.mimeType),
          source: "plan_document",
          bidId: null,
          projectId: params.projectId,
        });
      }

      // Step 1 — bridge bid→project: find any bid whose convertedToProjectId points here,
      // then pull its bid_documents (deduped by fileUrl against what's already loaded).
      const sourceBids = await db
        .select({ id: bids.id })
        .from(bids)
        .where(
          and(
            eq(bids.convertedToProjectId, params.projectId),
            eq(bids.gcOrganizationId, params.organizationId),
          ),
        );

      for (const sourceBid of sourceBids) {
        const bidDocs = await db
          .select({
            id: bidDocuments.id,
            fileName: bidDocuments.fileName,
            fileUrl: bidDocuments.fileUrl,
            fileSize: bidDocuments.fileSize,
            mimeType: bidDocuments.mimeType,
          })
          .from(bidDocuments)
          .where(eq(bidDocuments.bidId, sourceBid.id));

        for (const doc of bidDocs) {
          addRef({
            id: doc.id,
            fileName: doc.fileName,
            fileUrl: doc.fileUrl,
            fileSize: doc.fileSize,
            mimeType: doc.mimeType,
            fileType: classifyFile(doc.fileName, doc.mimeType),
            source: "bid_document",
            bidId: sourceBid.id,
            projectId: params.projectId,
          });
        }
      }
    }
  }

  refs.sort(
    (a, b) => FILE_TYPE_PRIORITY[a.fileType] - FILE_TYPE_PRIORITY[b.fileType],
  );
  return refs.slice(0, MAX_FILES_PER_RESOLVER);
}
