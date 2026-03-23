import { Router } from "express";
import { db } from "./db";
import { bimExtractions, takeoffMeasurements, takeoffSheets, bids } from "@shared/schema";
import { eq, and, desc } from "drizzle-orm";
import { z } from "zod";
import { requireAuth, type AuthRequest } from "./auth";
import { verifyOrgAccess } from "./orgFilter";

const router = Router();

const extractionDataSchema = z.object({
  documentId: z.string().optional(),
  documentName: z.string().optional(),
  extractedData: z.string(),
});

router.post("/api/bids/:id/bim-extractions", requireAuth, async (req: AuthRequest, res) => {
  try {
    const bidId = req.params.id;
    const [bid] = await db.select().from(bids).where(eq(bids.id, bidId)).limit(1);
    if (!bid) {
      res.status(404).json({ error: "Bid not found" });
      return;
    }
    if (!verifyOrgAccess(req, res, bid.gcOrganizationId)) return;

    const parsed = extractionDataSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid input", details: parsed.error.errors });
      return;
    }

    const [extraction] = await db.insert(bimExtractions).values({
      bidId,
      documentId: parsed.data.documentId,
      documentName: parsed.data.documentName,
      extractedData: parsed.data.extractedData,
    }).returning();

    res.status(201).json(extraction);
  } catch (error) {
    console.error("Create BIM extraction error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/api/bids/:id/bim-extractions", requireAuth, async (req: AuthRequest, res) => {
  try {
    const bidId = req.params.id;
    const [bid] = await db.select().from(bids).where(eq(bids.id, bidId)).limit(1);
    if (!bid) {
      res.status(404).json({ error: "Bid not found" });
      return;
    }
    if (!verifyOrgAccess(req, res, bid.gcOrganizationId)) return;

    const extractions = await db
      .select()
      .from(bimExtractions)
      .where(eq(bimExtractions.bidId, bidId))
      .orderBy(desc(bimExtractions.createdAt));

    res.json(extractions);
  } catch (error) {
    console.error("Get BIM extractions error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

const importSchema = z.object({
  groups: z.array(z.object({
    ifcType: z.string(),
    displayName: z.string(),
    count: z.number(),
    totalLength: z.number().nullable(),
    totalArea: z.number().nullable(),
    totalVolume: z.number().nullable(),
    materials: z.array(z.string()),
    categoryId: z.string().optional().nullable(),
  })),
  extractionId: z.string(),
  sheetName: z.string().optional(),
});

router.post("/api/bids/:id/bim-extractions/import", requireAuth, async (req: AuthRequest, res) => {
  try {
    const bidId = req.params.id;
    const [bid] = await db.select().from(bids).where(eq(bids.id, bidId)).limit(1);
    if (!bid) {
      res.status(404).json({ error: "Bid not found" });
      return;
    }
    if (!verifyOrgAccess(req, res, bid.gcOrganizationId)) return;

    const parsed = importSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid input", details: parsed.error.errors });
      return;
    }

    const { groups, extractionId, sheetName } = parsed.data;

    const [extraction] = await db
      .select()
      .from(bimExtractions)
      .where(and(eq(bimExtractions.id, extractionId), eq(bimExtractions.bidId, bidId)))
      .limit(1);

    if (!extraction) {
      res.status(404).json({ error: "Extraction not found for this bid" });
      return;
    }

    const [sheet] = await db.insert(takeoffSheets).values({
      bidId,
      imageUrl: "bim-extraction",
      sheetIndex: 0,
      sheetName: sheetName || "BIM Takeoff",
      folderGroup: "BIM",
      units: "ft",
    }).returning();

    const measurements: any[] = [];
    for (const group of groups) {
      let measurementType: string;
      let computedValue: Record<string, number> = {};

      if (group.totalVolume && group.totalVolume > 0) {
        measurementType = "VOLUME";
        computedValue = { computedVolumeCy: Math.round((group.totalVolume / 27) * 100) / 100 };
      } else if (group.totalArea && group.totalArea > 0) {
        measurementType = "AREA";
        computedValue = { computedAreaFt2: group.totalArea };
      } else if (group.totalLength && group.totalLength > 0) {
        measurementType = "LINEAR";
        computedValue = { computedLengthFt: group.totalLength };
      } else {
        measurementType = "COUNT";
        computedValue = {};
      }

      const materialStr = group.materials.length > 0 ? ` (${group.materials.join(", ")})` : "";
      const label = `${group.displayName}${materialStr} — ${group.count} elements`;

      const metadata = JSON.stringify({
        bimSource: true,
        bimExtractionId: extractionId,
        bimDocumentId: extraction.documentId,
        ifcType: group.ifcType,
        elementCount: group.count,
      });

      const [measurement] = await db.insert(takeoffMeasurements).values({
        sheetId: sheet.id,
        type: measurementType as any,
        label,
        points: JSON.stringify([{ x: 0, y: 0 }]),
        source: "BIM",
        status: "CONFIRMED",
        count: measurementType === "COUNT" ? group.count : null,
        categoryId: group.categoryId || null,
        metadata,
        ...computedValue,
      }).returning();

      measurements.push(measurement);
    }

    const mappings = groups
      .filter(g => g.categoryId)
      .map(g => ({ ifcType: g.ifcType, displayName: g.displayName, categoryId: g.categoryId }));

    await db.update(bimExtractions).set({
      importedAt: new Date(),
      mappings: JSON.stringify(mappings),
      updatedAt: new Date(),
    }).where(eq(bimExtractions.id, extractionId));

    res.status(201).json({
      sheet,
      measurements,
      count: measurements.length,
    });
  } catch (error) {
    console.error("Import BIM extraction error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/api/bids/:bidId/bim-extractions/:id/mappings", requireAuth, async (req: AuthRequest, res) => {
  try {
    const { bidId, id } = req.params;
    const [bid] = await db.select().from(bids).where(eq(bids.id, bidId)).limit(1);
    if (!bid) {
      res.status(404).json({ error: "Bid not found" });
      return;
    }
    if (!verifyOrgAccess(req, res, bid.gcOrganizationId)) return;

    const { mappings } = req.body;
    if (!mappings) {
      res.status(400).json({ error: "Mappings required" });
      return;
    }

    const [extraction] = await db
      .select()
      .from(bimExtractions)
      .where(and(eq(bimExtractions.id, id), eq(bimExtractions.bidId, bidId)))
      .limit(1);

    if (!extraction) {
      res.status(404).json({ error: "Extraction not found for this bid" });
      return;
    }

    const [updated] = await db
      .update(bimExtractions)
      .set({ mappings: JSON.stringify(mappings), updatedAt: new Date() })
      .where(eq(bimExtractions.id, id))
      .returning();

    res.json(updated);
  } catch (error) {
    console.error("Update BIM mappings error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
