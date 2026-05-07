// Task #2517 — `bulk_export` generator for the prevailing-wage
// acknowledgement compliance export. Handles both per-decision
// (`/api/payroll/wage-decisions/:decisionNumber/acknowledgement-export`)
// and org-wide (`/api/payroll/acknowledgement-export`) variants by
// dispatching on `payload.scope`.

import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { db } from "../../db";
import {
  wageDecisionRateChanges,
  users,
  projects,
  prevailingWageRates,
  jobClassifications,
} from "@shared/schema";
import { logWarn } from "../../utils/logger";
import { registerExportGenerator } from "../handlers";
import { uploadExportArtifact } from "./uploadExportArtifact";
import type { JobContext } from "../index";

export const PAYROLL_ACK_EXPORT_TYPE = "payroll_ack_export";

export type PayrollAckExportParams =
  | {
      scope: "decision";
      organizationId: string;
      decisionNumber: string;
      format: "csv" | "json" | "pdf";
    }
  | {
      scope: "org";
      organizationId: string;
      format: "csv" | "json" | "pdf";
    };

function normalizeKey(s: string): string {
  return (s || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function fmtRate(v: unknown): string {
  if (v === null || v === undefined) return "";
  const n = typeof v === "string" ? parseFloat(v) : Number(v);
  if (!Number.isFinite(n)) return "";
  return n.toFixed(2);
}

function fmtName(
  first: string | null | undefined,
  last: string | null | undefined,
  email: string | null | undefined,
  userId: string | null | undefined,
): string {
  const name = `${first ?? ""} ${last ?? ""}`.trim();
  return name || email || (userId ?? "");
}

function csvEscape(val: unknown): string {
  if (val === null || val === undefined) return "";
  const s = String(val);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

async function loadDecisionRows(orgId: string, decisionNumber: string) {
  return db
    .select({
      classification: wageDecisionRateChanges.classification,
      changeKind: wageDecisionRateChanges.changeKind,
      oldBaseRate: wageDecisionRateChanges.oldBaseRate,
      newBaseRate: wageDecisionRateChanges.newBaseRate,
      oldFringeRate: wageDecisionRateChanges.oldFringeRate,
      newFringeRate: wageDecisionRateChanges.newFringeRate,
      oldTotalRate: wageDecisionRateChanges.oldTotalRate,
      newTotalRate: wageDecisionRateChanges.newTotalRate,
      detectedAt: wageDecisionRateChanges.detectedAt,
      acknowledgedAt: wageDecisionRateChanges.acknowledgedAt,
      acknowledgedByUserId: wageDecisionRateChanges.acknowledgedByUserId,
      acknowledgerFirstName: users.firstName,
      acknowledgerLastName: users.lastName,
      acknowledgerEmail: users.email,
    })
    .from(wageDecisionRateChanges)
    .leftJoin(users, eq(wageDecisionRateChanges.acknowledgedByUserId, users.id))
    .where(
      and(
        eq(wageDecisionRateChanges.organizationId, orgId),
        eq(wageDecisionRateChanges.decisionNumber, decisionNumber),
      ),
    );
}

async function generateDecisionExport(
  p: Extract<PayrollAckExportParams, { scope: "decision" }>,
): Promise<{ url: string; bytes: number }> {
  const orgId = p.organizationId;
  const decisionNumber = p.decisionNumber;
  const changeRows = await loadDecisionRows(orgId, decisionNumber);
  const changeByKey = new Map<string, (typeof changeRows)[number]>();
  for (const r of changeRows) {
    changeByKey.set(normalizeKey(r.classification), r);
  }

  const projectRows = await db
    .select({ id: projects.id, code: projects.code, name: projects.name })
    .from(projects)
    .where(
      and(
        eq(projects.gcOrganizationId, orgId),
        eq(projects.wageDecision, decisionNumber),
      ),
    )
    .orderBy(asc(projects.name));

  type Enum = { classification: string; sources: Set<"DOL_FEED" | "PROJECT_OVERRIDE"> };
  const enumerated = new Map<string, Enum>();
  const ensure = (name: string, source: "DOL_FEED" | "PROJECT_OVERRIDE") => {
    const trimmed = (name || "").trim();
    if (!trimmed) return;
    const key = normalizeKey(trimmed);
    const existing = enumerated.get(key);
    if (existing) existing.sources.add(source);
    else enumerated.set(key, { classification: trimmed, sources: new Set([source]) });
  };

  try {
    const { listCachedDecisionClassifications } = await import(
      "../../integrations/providers/dol_davis_bacon/sync"
    );
    const cached = await listCachedDecisionClassifications(orgId, decisionNumber);
    if (cached) {
      for (const r of cached) {
        if (r?.classification) ensure(r.classification, "DOL_FEED");
      }
    }
  } catch (err) {
    logWarn("payroll_ack_export: cached decision listing failed", {
      orgId,
      decisionNumber,
      error: String(err),
    });
  }

  if (projectRows.length > 0) {
    const overrideRows = await db
      .select({ name: jobClassifications.name })
      .from(prevailingWageRates)
      .innerJoin(jobClassifications, eq(prevailingWageRates.classificationId, jobClassifications.id))
      .where(
        and(
          eq(prevailingWageRates.organizationId, orgId),
          eq(prevailingWageRates.wageDecision, decisionNumber),
          inArray(
            prevailingWageRates.projectId,
            projectRows.map((p) => p.id),
          ),
        ),
      );
    for (const o of overrideRows) ensure(o.name, "PROJECT_OVERRIDE");
  }
  for (const r of changeRows) ensure(r.classification, "DOL_FEED");

  const rows = Array.from(enumerated.values())
    .map((e) => {
      const change = changeByKey.get(normalizeKey(e.classification));
      const sourceLabel = Array.from(e.sources).sort().join("+");
      return { entry: e, change, sourceLabel };
    })
    .sort((a, b) => a.entry.classification.localeCompare(b.entry.classification));

  const projectsLabel =
    projectRows.length === 0
      ? "(no projects reference this decision)"
      : projectRows.map((pr) => (pr.code ? `${pr.code} ${pr.name}` : pr.name)).join("; ");

  const generatedAt = new Date();
  const fileStem = `wage-decision-acknowledgements-${decisionNumber.replace(/[^A-Za-z0-9_-]+/g, "_")}-${generatedAt
    .toISOString()
    .slice(0, 10)}`;

  const ackStatusLabel = (change: (typeof changeRows)[number] | undefined): string => {
    if (!change) return "No recorded rate change";
    return change.acknowledgedAt ? "Acknowledged" : "Unacknowledged";
  };

  if (p.format === "json") {
    const body = Buffer.from(
      JSON.stringify(
        {
          organizationId: orgId,
          decisionNumber,
          generatedAt: generatedAt.toISOString(),
          projects: projectRows,
          classifications: rows.map(({ entry, change, sourceLabel }) => ({
            classification: entry.classification,
            sources: Array.from(entry.sources).sort(),
            sourceLabel,
            changeKind: change?.changeKind ?? null,
            oldBaseRate: change?.oldBaseRate ?? null,
            newBaseRate: change?.newBaseRate ?? null,
            oldFringeRate: change?.oldFringeRate ?? null,
            newFringeRate: change?.newFringeRate ?? null,
            oldTotalRate: change?.oldTotalRate ?? null,
            newTotalRate: change?.newTotalRate ?? null,
            detectedAt:
              change?.detectedAt instanceof Date
                ? change.detectedAt.toISOString()
                : (change?.detectedAt ?? null),
            acknowledgedAt:
              change?.acknowledgedAt instanceof Date
                ? change.acknowledgedAt.toISOString()
                : (change?.acknowledgedAt ?? null),
            acknowledgedByUserId: change?.acknowledgedByUserId ?? null,
            acknowledgedByName: change?.acknowledgedByUserId
              ? fmtName(
                  change.acknowledgerFirstName,
                  change.acknowledgerLastName,
                  change.acknowledgerEmail,
                  change.acknowledgedByUserId,
                )
              : null,
            acknowledgementStatus: ackStatusLabel(change),
          })),
        },
        null,
        2,
      ),
      "utf8",
    );
    return uploadExportArtifact({
      organizationId: orgId,
      extension: "json",
      filename: fileStem,
      contentType: "application/json",
      body,
    });
  }

  if (p.format === "csv") {
    const header = [
      "Wage Decision",
      "Classification",
      "Source",
      "Change Kind",
      "Old Base Rate",
      "New Base Rate",
      "Old Fringe Rate",
      "New Fringe Rate",
      "Old Total Rate",
      "New Total Rate",
      "Detected At",
      "Acknowledged At",
      "Acknowledged By",
      "Acknowledgement Status",
      "Affected Projects",
    ];
    const lines = [header.join(",")];
    if (rows.length === 0) {
      lines.push(
        [
          decisionNumber,
          "(no classifications resolved for this wage decision)",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "No recorded rate change",
          projectsLabel,
        ]
          .map(csvEscape)
          .join(","),
      );
    } else {
      for (const { entry, change, sourceLabel } of rows) {
        const ackName = change?.acknowledgedByUserId
          ? fmtName(
              change.acknowledgerFirstName,
              change.acknowledgerLastName,
              change.acknowledgerEmail,
              change.acknowledgedByUserId,
            )
          : "";
        lines.push(
          [
            decisionNumber,
            entry.classification,
            sourceLabel,
            change?.changeKind ?? "",
            fmtRate(change?.oldBaseRate),
            fmtRate(change?.newBaseRate),
            fmtRate(change?.oldFringeRate),
            fmtRate(change?.newFringeRate),
            fmtRate(change?.oldTotalRate),
            fmtRate(change?.newTotalRate),
            change?.detectedAt instanceof Date
              ? change.detectedAt.toISOString()
              : (change?.detectedAt ?? ""),
            change?.acknowledgedAt instanceof Date
              ? change.acknowledgedAt.toISOString()
              : (change?.acknowledgedAt ?? ""),
            ackName,
            ackStatusLabel(change),
            projectsLabel,
          ]
            .map(csvEscape)
            .join(","),
        );
      }
    }
    const body = Buffer.from(lines.join("\n"), "utf8");
    return uploadExportArtifact({
      organizationId: orgId,
      extension: "csv",
      filename: fileStem,
      contentType: "text/csv; charset=utf-8",
      body,
    });
  }

  // PDF — render via pdfkit into a memory buffer.
  const PDFDocument = (await import("pdfkit")).default;
  const doc = new PDFDocument({ size: "LETTER", margin: 50 });
  const pdfChunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => pdfChunks.push(c));
  const pdfDone = new Promise<Buffer>((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(pdfChunks)));
    doc.on("error", reject);
  });

  doc.fontSize(16).font("Helvetica-Bold").text("Prevailing Wage Acknowledgement Report");
  doc.moveDown(0.3);
  doc.fontSize(10).font("Helvetica").fillColor("#444444");
  doc.text(`Wage Decision: ${decisionNumber}`);
  doc.text(`Generated: ${generatedAt.toISOString()}`);
  doc.text(
    `Affected Projects (${projectRows.length}): ${
      projectRows.length === 0
        ? "(no projects reference this decision)"
        : projectRows.map((pr) => (pr.code ? `${pr.code} — ${pr.name}` : pr.name)).join(", ")
    }`,
    { width: 500 },
  );
  doc.moveDown(0.5);
  doc.fillColor("#000000");
  const ackedCount = changeRows.filter((r) => r.acknowledgedAt).length;
  const unackedCount = changeRows.length - ackedCount;
  doc
    .fontSize(11)
    .font("Helvetica-Bold")
    .text(
      `Classifications: ${rows.length} (with rate change ${changeRows.length} — ${ackedCount} acknowledged, ${unackedCount} unacknowledged)`,
    );
  doc.moveDown(0.3);

  if (rows.length === 0) {
    doc
      .fontSize(10)
      .font("Helvetica")
      .text(
        "No classifications resolved for this wage decision. Either the DOL Davis-Bacon decision has not been cached for this organization, or no project references it with overrides.",
        { width: 500 },
      );
  } else {
    for (const { entry, change, sourceLabel } of rows) {
      const ackName = change?.acknowledgedByUserId
        ? fmtName(
            change.acknowledgerFirstName,
            change.acknowledgerLastName,
            change.acknowledgerEmail,
            change.acknowledgedByUserId,
          )
        : "";
      const ackStatus = !change
        ? "No recorded rate change"
        : change.acknowledgedAt
          ? `Acknowledged by ${ackName || "unknown"} on ${
              change.acknowledgedAt instanceof Date
                ? change.acknowledgedAt.toISOString()
                : change.acknowledgedAt
            }`
          : "Unacknowledged";
      doc.fontSize(10).font("Helvetica-Bold").text(`• ${entry.classification}`);
      doc.font("Helvetica").fontSize(9);
      doc.text(`   Source: ${sourceLabel}`);
      if (change) {
        doc.text(`   Change kind: ${change.changeKind}`);
        doc.text(
          `   Base: ${fmtRate(change.oldBaseRate) || "—"} → ${fmtRate(change.newBaseRate) || "—"}    Fringe: ${
            fmtRate(change.oldFringeRate) || "—"
          } → ${fmtRate(change.newFringeRate) || "—"}    Total: ${fmtRate(change.oldTotalRate) || "—"} → ${
            fmtRate(change.newTotalRate) || "—"
          }`,
        );
        doc.text(
          `   Detected: ${
            change.detectedAt instanceof Date ? change.detectedAt.toISOString() : (change.detectedAt ?? "—")
          }`,
        );
      }
      doc.text(`   ${ackStatus}`);
      doc.moveDown(0.4);
    }
  }
  doc.end();
  const pdfBuf = await pdfDone;

  return uploadExportArtifact({
    organizationId: orgId,
    extension: "pdf",
    filename: fileStem,
    contentType: "application/pdf",
    body: pdfBuf,
  });
}

async function generateOrgExport(
  p: Extract<PayrollAckExportParams, { scope: "org" }>,
): Promise<{ url: string; bytes: number }> {
  const orgId = p.organizationId;
  const rows = await db
    .select({
      decisionNumber: wageDecisionRateChanges.decisionNumber,
      classification: wageDecisionRateChanges.classification,
      changeKind: wageDecisionRateChanges.changeKind,
      oldBaseRate: wageDecisionRateChanges.oldBaseRate,
      newBaseRate: wageDecisionRateChanges.newBaseRate,
      oldFringeRate: wageDecisionRateChanges.oldFringeRate,
      newFringeRate: wageDecisionRateChanges.newFringeRate,
      oldTotalRate: wageDecisionRateChanges.oldTotalRate,
      newTotalRate: wageDecisionRateChanges.newTotalRate,
      detectedAt: wageDecisionRateChanges.detectedAt,
      acknowledgedAt: wageDecisionRateChanges.acknowledgedAt,
      acknowledgedByUserId: wageDecisionRateChanges.acknowledgedByUserId,
      acknowledgerFirstName: users.firstName,
      acknowledgerLastName: users.lastName,
      acknowledgerEmail: users.email,
    })
    .from(wageDecisionRateChanges)
    .leftJoin(users, eq(wageDecisionRateChanges.acknowledgedByUserId, users.id))
    .where(eq(wageDecisionRateChanges.organizationId, orgId))
    .orderBy(asc(wageDecisionRateChanges.decisionNumber), asc(wageDecisionRateChanges.classification));

  const projectRows = await db
    .select({ code: projects.code, name: projects.name, wageDecision: projects.wageDecision })
    .from(projects)
    .where(
      and(eq(projects.gcOrganizationId, orgId), sql`${projects.wageDecision} IS NOT NULL`),
    )
    .orderBy(asc(projects.wageDecision), asc(projects.name));
  const projectsByDecision = new Map<string, string[]>();
  for (const pr of projectRows) {
    const key = (pr.wageDecision || "").trim();
    if (!key) continue;
    const label = pr.code ? `${pr.code} ${pr.name}` : pr.name;
    const list = projectsByDecision.get(key) ?? [];
    list.push(label);
    projectsByDecision.set(key, list);
  }

  const generatedAt = new Date();
  const fileStem = `wage-decision-acknowledgements-org-${generatedAt.toISOString().slice(0, 10)}`;

  if (p.format === "json") {
    const body = Buffer.from(
      JSON.stringify(
        {
          organizationId: orgId,
          generatedAt: generatedAt.toISOString(),
          rows: rows.map((r) => ({
            decisionNumber: r.decisionNumber,
            classification: r.classification,
            changeKind: r.changeKind,
            oldBaseRate: r.oldBaseRate,
            newBaseRate: r.newBaseRate,
            oldFringeRate: r.oldFringeRate,
            newFringeRate: r.newFringeRate,
            oldTotalRate: r.oldTotalRate,
            newTotalRate: r.newTotalRate,
            detectedAt: r.detectedAt instanceof Date ? r.detectedAt.toISOString() : r.detectedAt,
            acknowledgedAt:
              r.acknowledgedAt instanceof Date ? r.acknowledgedAt.toISOString() : r.acknowledgedAt,
            acknowledgedByUserId: r.acknowledgedByUserId,
            acknowledgedByName: r.acknowledgedByUserId
              ? fmtName(
                  r.acknowledgerFirstName,
                  r.acknowledgerLastName,
                  r.acknowledgerEmail,
                  r.acknowledgedByUserId,
                )
              : null,
            affectedProjects: projectsByDecision.get(r.decisionNumber) ?? [],
          })),
        },
        null,
        2,
      ),
      "utf8",
    );
    return uploadExportArtifact({
      organizationId: orgId,
      extension: "json",
      filename: fileStem,
      contentType: "application/json",
      body,
    });
  }

  if (p.format === "csv") {
    const header = [
      "Wage Decision",
      "Classification",
      "Change Kind",
      "Old Base Rate",
      "New Base Rate",
      "Old Fringe Rate",
      "New Fringe Rate",
      "Old Total Rate",
      "New Total Rate",
      "Detected At",
      "Acknowledged At",
      "Acknowledged By",
      "Affected Projects",
    ];
    const lines = [header.join(",")];
    for (const r of rows) {
      const ackName = r.acknowledgedByUserId
        ? fmtName(
            r.acknowledgerFirstName,
            r.acknowledgerLastName,
            r.acknowledgerEmail,
            r.acknowledgedByUserId,
          )
        : "";
      lines.push(
        [
          r.decisionNumber,
          r.classification,
          r.changeKind ?? "",
          fmtRate(r.oldBaseRate),
          fmtRate(r.newBaseRate),
          fmtRate(r.oldFringeRate),
          fmtRate(r.newFringeRate),
          fmtRate(r.oldTotalRate),
          fmtRate(r.newTotalRate),
          r.detectedAt instanceof Date ? r.detectedAt.toISOString() : (r.detectedAt ?? ""),
          r.acknowledgedAt instanceof Date
            ? r.acknowledgedAt.toISOString()
            : (r.acknowledgedAt ?? ""),
          ackName,
          (projectsByDecision.get(r.decisionNumber) ?? []).join("; "),
        ]
          .map(csvEscape)
          .join(","),
      );
    }
    const body = Buffer.from(lines.join("\n"), "utf8");
    return uploadExportArtifact({
      organizationId: orgId,
      extension: "csv",
      filename: fileStem,
      contentType: "text/csv; charset=utf-8",
      body,
    });
  }

  // PDF — group by decision.
  const PDFDocument = (await import("pdfkit")).default;
  const doc = new PDFDocument({ size: "LETTER", margin: 50 });
  const pdfChunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => pdfChunks.push(c));
  const pdfDone = new Promise<Buffer>((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(pdfChunks)));
    doc.on("error", reject);
  });

  doc.fontSize(16).font("Helvetica-Bold").text("Prevailing Wage Acknowledgement Report — Org-Wide");
  doc.moveDown(0.3);
  doc.fontSize(10).font("Helvetica").fillColor("#444444");
  doc.text(`Generated: ${generatedAt.toISOString()}`);
  doc.moveDown(0.4);
  doc.fillColor("#000000");

  const grouped = new Map<string, typeof rows>();
  for (const r of rows) {
    const list = grouped.get(r.decisionNumber) ?? [];
    list.push(r);
    grouped.set(r.decisionNumber, list);
  }
  for (const [decisionNumber, decisionRows] of Array.from(grouped.entries()).sort((a, b) =>
    a[0].localeCompare(b[0]),
  )) {
    doc.fontSize(12).font("Helvetica-Bold").text(`Wage Decision: ${decisionNumber}`);
    const projList = projectsByDecision.get(decisionNumber) ?? [];
    doc
      .fontSize(9)
      .font("Helvetica")
      .text(`Affected projects: ${projList.length === 0 ? "(none)" : projList.join(", ")}`, {
        width: 500,
      });
    doc.moveDown(0.2);
    for (const r of decisionRows) {
      const ackName = r.acknowledgedByUserId
        ? fmtName(
            r.acknowledgerFirstName,
            r.acknowledgerLastName,
            r.acknowledgerEmail,
            r.acknowledgedByUserId,
          )
        : "";
      doc.fontSize(9).text(
        `  • ${r.classification} — ${r.changeKind ?? ""}; total ${fmtRate(r.oldTotalRate) || "—"} → ${
          fmtRate(r.newTotalRate) || "—"
        }; ${r.acknowledgedAt ? `Ack by ${ackName}` : "Unacknowledged"}`,
        { width: 500 },
      );
    }
    doc.moveDown(0.4);
  }
  doc.end();
  const pdfBuf = await pdfDone;

  return uploadExportArtifact({
    organizationId: orgId,
    extension: "pdf",
    filename: fileStem,
    contentType: "application/pdf",
    body: pdfBuf,
  });
}

export async function runPayrollAckExport(
  params: PayrollAckExportParams,
  _ctx: JobContext,
): Promise<{ url: string; bytes: number }> {
  if (params.scope === "decision") return generateDecisionExport(params);
  return generateOrgExport(params);
}

registerExportGenerator(PAYROLL_ACK_EXPORT_TYPE, async (params, ctx) => {
  const typed = params as unknown as PayrollAckExportParams;
  return runPayrollAckExport(typed, ctx);
});
