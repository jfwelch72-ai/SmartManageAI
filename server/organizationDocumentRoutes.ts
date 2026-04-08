import { logError } from "./utils/logger";
import { Router, type Request, type Response } from "express";
import { db } from "./db";
import { organizationDocuments, organizations, users, insertOrganizationDocumentSchema, type OrganizationDocument } from "@shared/schema";
import { eq, desc, and, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import { requireAuth, requireRole, type AuthRequest } from "./auth";
import { getOrgIdForFilter } from "./orgFilter";
import { ObjectStorageService } from "./objectStorage";

const router = Router();
const objectStorage = new ObjectStorageService();

const DOCUMENT_TYPE_LABELS: Record<string, string> = {
  LOGO_PRIMARY: "Primary Logo",
  LOGO_SECONDARY: "Secondary Logo",
  LETTERHEAD: "Letterhead Template",
  INSURANCE_CERT_GENERAL_LIABILITY: "Insurance - General Liability",
  INSURANCE_CERT_WORKERS_COMP: "Insurance - Workers Compensation",
  INSURANCE_CERT_AUTO: "Insurance - Auto",
  INSURANCE_CERT_UMBRELLA: "Insurance - Umbrella",
  W9: "W9 Tax Form",
  LICENSE: "Business/Contractor License",
  BONDING_LETTER: "Bonding Letter",
  BANKING_INFO: "Banking Information",
  SAFETY_PROGRAM: "Safety Program",
  COMPANY_PROFILE: "Company Profile",
  TEMPLATE_OTHER: "Other Document"
};

const VISIBILITY_LABELS: Record<string, string> = {
  PUBLIC: "Public (visible to clients)",
  INTERNAL: "Internal (company only)",
  CONFIDENTIAL: "Confidential (admins only)"
};

const BRANDING_DOCUMENT_TYPES = ["LOGO_PRIMARY", "LOGO_SECONDARY", "LETTERHEAD"];
const INSURANCE_DOCUMENT_TYPES = [
  "INSURANCE_CERT_GENERAL_LIABILITY",
  "INSURANCE_CERT_WORKERS_COMP",
  "INSURANCE_CERT_AUTO",
  "INSURANCE_CERT_UMBRELLA"
];
const COMPLIANCE_DOCUMENT_TYPES = [
  "W9",
  "LICENSE",
  "BONDING_LETTER",
  "BANKING_INFO",
  "SAFETY_PROGRAM",
  "COMPANY_PROFILE",
  "TEMPLATE_OTHER"
];

router.get("/organization-documents/types", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const types = Object.entries(DOCUMENT_TYPE_LABELS).map(([value, label]) => ({
      value,
      label,
      category: BRANDING_DOCUMENT_TYPES.includes(value) 
        ? "BRANDING" 
        : INSURANCE_DOCUMENT_TYPES.includes(value) 
          ? "INSURANCE" 
          : "COMPLIANCE"
    }));

    res.json({
      types,
      visibilities: Object.entries(VISIBILITY_LABELS).map(([value, label]) => ({ value, label })),
      categories: [
        { value: "BRANDING", label: "Branding & Identity", types: BRANDING_DOCUMENT_TYPES },
        { value: "INSURANCE", label: "Insurance Certificates", types: INSURANCE_DOCUMENT_TYPES },
        { value: "COMPLIANCE", label: "Compliance & Other", types: COMPLIANCE_DOCUMENT_TYPES }
      ]
    });
  } catch (error) {
    logError("Get document types error:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/organization-documents/summary", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
    
    if (mustDenyAccess || !orgId) {
      return res.json({
        branding: { total: 0, uploaded: 0 },
        insurance: { total: 0, uploaded: 0, expiringSoon: 0, expired: 0 },
        compliance: { total: 0, uploaded: 0 }
      });
    }

    const documents = await db
      .select()
      .from(organizationDocuments)
      .where(
        and(
          eq(organizationDocuments.organizationId, orgId),
          eq(organizationDocuments.isActive, true)
        )
      );

    const now = new Date();
    const thirtyDaysFromNow = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    const summary = {
      branding: {
        total: BRANDING_DOCUMENT_TYPES.length,
        uploaded: documents.filter(d => BRANDING_DOCUMENT_TYPES.includes(d.type)).length,
      },
      insurance: {
        total: INSURANCE_DOCUMENT_TYPES.length,
        uploaded: documents.filter(d => INSURANCE_DOCUMENT_TYPES.includes(d.type)).length,
        expiringSoon: documents.filter(d => 
          INSURANCE_DOCUMENT_TYPES.includes(d.type) && 
          d.expiresAt && 
          new Date(d.expiresAt) > now && 
          new Date(d.expiresAt) <= thirtyDaysFromNow
        ).length,
        expired: documents.filter(d => 
          INSURANCE_DOCUMENT_TYPES.includes(d.type) && 
          d.expiresAt && 
          new Date(d.expiresAt) < now
        ).length,
      },
      compliance: {
        total: COMPLIANCE_DOCUMENT_TYPES.length,
        uploaded: documents.filter(d => COMPLIANCE_DOCUMENT_TYPES.includes(d.type)).length,
      }
    };

    res.json(summary);
  } catch (error) {
    logError("Get document summary error:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/organization-documents/history/:type", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { type } = req.params;
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
    
    if (mustDenyAccess) {
      return res.json([]);
    }

    if (!orgId) {
      return res.status(400).json({ error: "Organization required" });
    }

    const documents = await db
      .select({
        id: organizationDocuments.id,
        organizationId: organizationDocuments.organizationId,
        type: organizationDocuments.type,
        name: organizationDocuments.name,
        fileUrl: organizationDocuments.fileUrl,
        version: organizationDocuments.version,
        uploadedById: organizationDocuments.uploadedById,
        isActive: organizationDocuments.isActive,
        createdAt: organizationDocuments.createdAt,
        uploadedByFirstName: users.firstName,
        uploadedByLastName: users.lastName,
      })
      .from(organizationDocuments)
      .leftJoin(users, eq(organizationDocuments.uploadedById, users.id))
      .where(
        and(
          eq(organizationDocuments.organizationId, orgId),
          eq(organizationDocuments.type, type as any)
        )
      )
      .orderBy(desc(organizationDocuments.version));

    const enrichedDocuments = documents.map(doc => ({
      ...doc,
      uploadedByName: doc.uploadedByFirstName && doc.uploadedByLastName 
        ? `${doc.uploadedByFirstName} ${doc.uploadedByLastName}` 
        : null,
    }));

    res.json(enrichedDocuments);
  } catch (error) {
    logError("Get document history error:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/organization-documents", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
    
    if (mustDenyAccess) {
      return res.json([]);
    }

    let query = db
      .select({
        id: organizationDocuments.id,
        organizationId: organizationDocuments.organizationId,
        type: organizationDocuments.type,
        name: organizationDocuments.name,
        description: organizationDocuments.description,
        fileUrl: organizationDocuments.fileUrl,
        objectKey: organizationDocuments.objectKey,
        mimeType: organizationDocuments.mimeType,
        fileSize: organizationDocuments.fileSize,
        visibility: organizationDocuments.visibility,
        uploadedById: organizationDocuments.uploadedById,
        effectiveDate: organizationDocuments.effectiveDate,
        expiresAt: organizationDocuments.expiresAt,
        notes: organizationDocuments.notes,
        replacesDocumentId: organizationDocuments.replacesDocumentId,
        isActive: organizationDocuments.isActive,
        version: organizationDocuments.version,
        createdAt: organizationDocuments.createdAt,
        updatedAt: organizationDocuments.updatedAt,
        uploadedByFirstName: users.firstName,
        uploadedByLastName: users.lastName,
      })
      .from(organizationDocuments)
      .leftJoin(users, eq(organizationDocuments.uploadedById, users.id))
      .orderBy(desc(organizationDocuments.createdAt));

    if (shouldFilter && orgId) {
      query = query.where(eq(organizationDocuments.organizationId, orgId)) as typeof query;
    }

    const documents = await query;

    const enrichedDocuments = documents.map(doc => ({
      ...doc,
      typeLabel: DOCUMENT_TYPE_LABELS[doc.type] || doc.type,
      visibilityLabel: VISIBILITY_LABELS[doc.visibility] || doc.visibility,
      uploadedByName: doc.uploadedByFirstName && doc.uploadedByLastName 
        ? `${doc.uploadedByFirstName} ${doc.uploadedByLastName}` 
        : null,
      isExpired: doc.expiresAt ? new Date(doc.expiresAt) < new Date() : false,
      isExpiringSoon: doc.expiresAt 
        ? new Date(doc.expiresAt) < new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) 
        : false,
      category: BRANDING_DOCUMENT_TYPES.includes(doc.type) 
        ? "BRANDING" 
        : INSURANCE_DOCUMENT_TYPES.includes(doc.type) 
          ? "INSURANCE" 
          : "COMPLIANCE"
    }));

    res.json(enrichedDocuments);
  } catch (error) {
    logError("Get organization documents error:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/organization-documents/:id", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
    
    if (mustDenyAccess) {
      return res.status(404).json({ error: "Document not found" });
    }

    const [document] = await db
      .select({
        id: organizationDocuments.id,
        organizationId: organizationDocuments.organizationId,
        type: organizationDocuments.type,
        name: organizationDocuments.name,
        description: organizationDocuments.description,
        fileUrl: organizationDocuments.fileUrl,
        objectKey: organizationDocuments.objectKey,
        mimeType: organizationDocuments.mimeType,
        fileSize: organizationDocuments.fileSize,
        visibility: organizationDocuments.visibility,
        version: organizationDocuments.version,
        uploadedById: organizationDocuments.uploadedById,
        effectiveDate: organizationDocuments.effectiveDate,
        expiresAt: organizationDocuments.expiresAt,
        notes: organizationDocuments.notes,
        replacesDocumentId: organizationDocuments.replacesDocumentId,
        isActive: organizationDocuments.isActive,
        createdAt: organizationDocuments.createdAt,
        updatedAt: organizationDocuments.updatedAt,
        uploadedByFirstName: users.firstName,
        uploadedByLastName: users.lastName,
      })
      .from(organizationDocuments)
      .leftJoin(users, eq(organizationDocuments.uploadedById, users.id))
      .where(eq(organizationDocuments.id, id))
      .limit(1);

    if (!document) {
      return res.status(404).json({ error: "Document not found" });
    }

    if (shouldFilter && orgId && document.organizationId !== orgId) {
      return res.status(403).json({ error: "Access denied" });
    }

    const enrichedDocument = {
      ...document,
      typeLabel: DOCUMENT_TYPE_LABELS[document.type] || document.type,
      visibilityLabel: VISIBILITY_LABELS[document.visibility] || document.visibility,
      uploadedByName: document.uploadedByFirstName && document.uploadedByLastName 
        ? `${document.uploadedByFirstName} ${document.uploadedByLastName}` 
        : null,
      isExpired: document.expiresAt ? new Date(document.expiresAt) < new Date() : false,
      isExpiringSoon: document.expiresAt 
        ? new Date(document.expiresAt) < new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) 
        : false,
      category: BRANDING_DOCUMENT_TYPES.includes(document.type) 
        ? "BRANDING" 
        : INSURANCE_DOCUMENT_TYPES.includes(document.type) 
          ? "INSURANCE" 
          : "COMPLIANCE"
    };

    res.json(enrichedDocument);
  } catch (error) {
    logError("Get organization document error:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Internal server error" });
  }
});

const createDocumentSchema = insertOrganizationDocumentSchema.extend({
  effectiveDate: z.preprocess(
    (val) => {
      if (!val) return undefined;
      return typeof val === "string" ? val : val;
    },
    z.string().nullish()
  ),
  expiresAt: z.preprocess(
    (val) => {
      if (!val) return undefined;
      return typeof val === "string" ? val : val;
    },
    z.string().nullish()
  ),
});

router.post("/organization-documents", requireAuth, requireRole("SUPER_ADMIN", "ADMIN"), async (req: AuthRequest, res: Response) => {
  try {
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
    
    if (mustDenyAccess) {
      return res.status(403).json({ error: "Access denied" });
    }

    const validationResult = createDocumentSchema.safeParse(req.body);
    if (!validationResult.success) {
      return res.status(400).json({ 
        error: "Validation failed", 
        details: validationResult.error.flatten() 
      });
    }

    const data = validationResult.data;

    if (shouldFilter && orgId) {
      data.organizationId = orgId;
    }

    const existingActiveDoc = await db
      .select()
      .from(organizationDocuments)
      .where(
        and(
          eq(organizationDocuments.organizationId, data.organizationId),
          eq(organizationDocuments.type, data.type as any),
          eq(organizationDocuments.isActive, true)
        )
      )
      .limit(1);

    let version = 1;
    let replacesDocumentId = null;

    if (existingActiveDoc.length > 0) {
      version = existingActiveDoc[0].version + 1;
      replacesDocumentId = existingActiveDoc[0].id;

      await db
        .update(organizationDocuments)
        .set({ isActive: false, updatedAt: new Date() })
        .where(eq(organizationDocuments.id, existingActiveDoc[0].id));
    }

    const [newDocument] = await db
      .insert(organizationDocuments)
      .values({
        ...data,
        version,
        replacesDocumentId,
        uploadedById: req.user?.id,
      })
      .returning();

    if (data.type === "LOGO_PRIMARY" && data.fileUrl) {
      await db
        .update(organizations)
        .set({ logoUrl: data.fileUrl, updatedAt: new Date() })
        .where(eq(organizations.id, data.organizationId));
    }

    res.status(201).json({
      ...newDocument,
      typeLabel: DOCUMENT_TYPE_LABELS[newDocument.type] || newDocument.type,
      visibilityLabel: VISIBILITY_LABELS[newDocument.visibility] || newDocument.visibility,
    });
  } catch (error) {
    logError("Create organization document error:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Internal server error" });
  }
});

const updateDocumentSchema = z.object({
  name: z.string().optional(),
  description: z.string().nullish(),
  visibility: z.enum(["PUBLIC", "INTERNAL", "CONFIDENTIAL"]).optional(),
  effectiveDate: z.string().nullish(),
  expiresAt: z.string().nullish(),
  notes: z.string().nullish(),
  isActive: z.boolean().optional(),
});

router.patch("/organization-documents/:id", requireAuth, requireRole("SUPER_ADMIN", "ADMIN"), async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
    
    if (mustDenyAccess) {
      return res.status(404).json({ error: "Document not found" });
    }

    const [existingDoc] = await db
      .select()
      .from(organizationDocuments)
      .where(eq(organizationDocuments.id, id))
      .limit(1);

    if (!existingDoc) {
      return res.status(404).json({ error: "Document not found" });
    }

    if (shouldFilter && orgId && existingDoc.organizationId !== orgId) {
      return res.status(403).json({ error: "Access denied" });
    }

    const validationResult = updateDocumentSchema.safeParse(req.body);
    if (!validationResult.success) {
      return res.status(400).json({ 
        error: "Validation failed", 
        details: validationResult.error.flatten() 
      });
    }

    const [updatedDoc] = await db
      .update(organizationDocuments)
      .set({
        ...validationResult.data,
        updatedAt: new Date(),
      })
      .where(eq(organizationDocuments.id, id))
      .returning();

    res.json({
      ...updatedDoc,
      typeLabel: DOCUMENT_TYPE_LABELS[updatedDoc.type] || updatedDoc.type,
      visibilityLabel: VISIBILITY_LABELS[updatedDoc.visibility] || updatedDoc.visibility,
    });
  } catch (error) {
    logError("Update organization document error:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/organization-documents/:id", requireAuth, requireRole("SUPER_ADMIN", "ADMIN"), async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
    
    if (mustDenyAccess) {
      return res.status(404).json({ error: "Document not found" });
    }

    const [existingDoc] = await db
      .select()
      .from(organizationDocuments)
      .where(eq(organizationDocuments.id, id))
      .limit(1);

    if (!existingDoc) {
      return res.status(404).json({ error: "Document not found" });
    }

    if (shouldFilter && orgId && existingDoc.organizationId !== orgId) {
      return res.status(403).json({ error: "Access denied" });
    }

    await db
      .update(organizationDocuments)
      .set({ isActive: false, updatedAt: new Date() })
      .where(eq(organizationDocuments.id, id));

    if (existingDoc.replacesDocumentId) {
      await db
        .update(organizationDocuments)
        .set({ isActive: true, updatedAt: new Date() })
        .where(eq(organizationDocuments.id, existingDoc.replacesDocumentId));
    }

    res.json({ success: true, message: "Document deactivated" });
  } catch (error) {
    logError("Delete organization document error:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/api/organization-documents/:id/download", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const orgId = await getOrgIdForFilter(req);
    if (!orgId) return res.status(403).json({ error: "Organization required" });

    const [doc] = await db
      .select({ fileUrl: organizationDocuments.fileUrl, name: organizationDocuments.name })
      .from(organizationDocuments)
      .where(and(eq(organizationDocuments.id, id), eq(organizationDocuments.organizationId, orgId)));

    if (!doc || !doc.fileUrl) return res.status(404).json({ error: "Document not found" });

    let objectFile;

    if (doc.fileUrl.startsWith("/objects/")) {
      objectFile = await objectStorage.getObjectEntityFile(doc.fileUrl);
    } else {
      const gcsPrefix = "https://storage.googleapis.com/";
      let bucketName: string;
      let objectName: string;

      if (doc.fileUrl.startsWith(gcsPrefix)) {
        const pathAfterPrefix = doc.fileUrl.slice(gcsPrefix.length);
        const slashIdx = pathAfterPrefix.indexOf("/");
        bucketName = pathAfterPrefix.slice(0, slashIdx);
        objectName = pathAfterPrefix.slice(slashIdx + 1);
      } else {
        const parts = doc.fileUrl.startsWith("/") ? doc.fileUrl.slice(1).split("/") : doc.fileUrl.split("/");
        bucketName = parts[0];
        objectName = parts.slice(1).join("/");
      }

      const { objectStorageClient } = await import("./objectStorage");
      const bucket = objectStorageClient.bucket(bucketName);
      objectFile = bucket.file(objectName);
    }

    await objectStorage.downloadObject(objectFile, res, 3600);
  } catch (error) {
    logError("Download organization document error:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
