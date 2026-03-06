import { Router, Response } from "express";
import { z } from "zod";
import { db } from "./db";
import { 
  scheduleOfValues, 
  sovLineItems,
  projects, 
  organizations,
  changeOrders,
} from "@shared/schema";
import { eq, and, desc } from "drizzle-orm";
import { requireAuth, AuthRequest, requireRole } from "./auth";
import { getOrgIdForFilter } from "./orgFilter";
import { createApprovalRequest } from "./services/approvalService";
import { isFeatureEnabled } from "./services/featureFlagService";
import { generateSOVPDF } from "./sov-pdf-service";
import { verifySOVAccess } from "./sovHelpers";

const router = Router();

router.get("/sov/co-tieout", requireAuth, requireRole("SUPER_ADMIN", "ADMIN", "MANAGER", "OFFICE_MANAGER"), async (req: AuthRequest, res: Response) => {
  try {
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess) return res.json({ changeOrders: [], sovSummary: [] });

    const coConditions: any[] = [eq(changeOrders.status, "APPROVED")];
    const sovConditions: any[] = [];

    if (shouldFilter && orgId) {
      sovConditions.push(eq(scheduleOfValues.organizationId, orgId));
    }

    const approvedCOs = await db.select({
      id: changeOrders.id,
      projectId: changeOrders.projectId,
      changeOrderNumber: changeOrders.changeOrderNumber,
      description: changeOrders.description,
      amount: changeOrders.amount,
      status: changeOrders.status,
      approvedAt: changeOrders.approvedAt,
      projectName: projects.name,
      projectCode: projects.code,
    })
    .from(changeOrders)
    .innerJoin(projects, eq(changeOrders.projectId, projects.id))
    .where(coConditions.length > 0 ? and(...coConditions) : undefined)
    .orderBy(desc(changeOrders.approvedAt));

    const filteredCOs = shouldFilter && orgId
      ? approvedCOs.filter(co => {
          return true;
        })
      : approvedCOs;

    const sovSummary = await db.select({
      id: scheduleOfValues.id,
      projectId: scheduleOfValues.projectId,
      sovNumber: scheduleOfValues.sovNumber,
      title: scheduleOfValues.title,
      contractValue: scheduleOfValues.contractValue,
      totalScheduledValue: scheduleOfValues.totalScheduledValue,
      status: scheduleOfValues.status,
      projectName: projects.name,
      projectCode: projects.code,
    })
    .from(scheduleOfValues)
    .innerJoin(projects, eq(scheduleOfValues.projectId, projects.id))
    .where(sovConditions.length > 0 ? and(...sovConditions) : undefined)
    .orderBy(desc(scheduleOfValues.updatedAt));

    const projectMap: Record<string, { coTotal: number; sovTotal: number; contractValue: number; cos: any[]; sovs: any[] }> = {};

    for (const co of filteredCOs) {
      if (!projectMap[co.projectId]) {
        projectMap[co.projectId] = { coTotal: 0, sovTotal: 0, contractValue: 0, cos: [], sovs: [] };
      }
      projectMap[co.projectId].coTotal += parseFloat(co.amount || "0");
      projectMap[co.projectId].cos.push(co);
    }

    for (const sov of sovSummary) {
      if (!projectMap[sov.projectId]) {
        projectMap[sov.projectId] = { coTotal: 0, sovTotal: 0, contractValue: 0, cos: [], sovs: [] };
      }
      projectMap[sov.projectId].sovTotal += parseFloat(sov.totalScheduledValue || "0");
      projectMap[sov.projectId].contractValue = parseFloat(sov.contractValue || "0");
      projectMap[sov.projectId].sovs.push(sov);
    }

    const reconciliation = Object.entries(projectMap).map(([projectId, data]) => {
      const expectedSovTotal = data.contractValue + data.coTotal;
      const variance = data.sovTotal - expectedSovTotal;
      return {
        projectId,
        projectName: data.cos[0]?.projectName || data.sovs[0]?.projectName || "Unknown",
        projectCode: data.cos[0]?.projectCode || data.sovs[0]?.projectCode || "",
        contractValue: data.contractValue,
        approvedCOTotal: data.coTotal,
        expectedSovTotal,
        actualSovTotal: data.sovTotal,
        variance,
        isReconciled: Math.abs(variance) < 0.01,
        changeOrderCount: data.cos.length,
        sovCount: data.sovs.length,
        changeOrders: data.cos,
        sovs: data.sovs,
      };
    });

    res.json(reconciliation);
  } catch (error) {
    console.error("CO tie-out error:", error);
    res.status(500).json({ error: "Failed to fetch CO tie-out data" });
  }
});

const validStatusTransitions: Record<string, { nextStates: string[]; allowedRoles: string[] }> = {
  DRAFT: { 
    nextStates: ["PENDING"], 
    allowedRoles: ["SUPER_ADMIN", "ADMIN", "MANAGER", "SUPERINTENDENT", "OFFICE_MANAGER"]
  },
  PENDING: { 
    nextStates: ["APPROVED", "DRAFT"], 
    allowedRoles: ["SUPER_ADMIN", "ADMIN", "MANAGER"]
  },
  APPROVED: { 
    nextStates: ["SUBMITTED", "PENDING"], 
    allowedRoles: ["SUPER_ADMIN", "ADMIN", "MANAGER"] 
  },
  SUBMITTED: { 
    nextStates: ["PAID", "APPROVED"], 
    allowedRoles: ["SUPER_ADMIN", "ADMIN"] 
  },
  PAID: { 
    nextStates: ["ARCHIVED"], 
    allowedRoles: ["SUPER_ADMIN", "ADMIN"] 
  },
  ARCHIVED: { 
    nextStates: [], 
    allowedRoles: [] 
  },
};

const updateSOVStatusSchema = z.object({
  status: z.enum(["DRAFT", "PENDING", "APPROVED", "SUBMITTED", "PAID", "ARCHIVED"]),
});

router.patch("/sov/:id/status", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
    
    if (mustDenyAccess) {
      return res.status(404).json({ error: "SOV not found" });
    }

    const { sov, hasAccess } = await verifySOVAccess(id, orgId, shouldFilter);

    if (!sov || !hasAccess) {
      return res.status(404).json({ error: "SOV not found" });
    }

    const validationResult = updateSOVStatusSchema.safeParse(req.body);
    if (!validationResult.success) {
      return res.status(400).json({ 
        error: "Validation failed", 
        details: validationResult.error.flatten() 
      });
    }

    const { status: newStatus } = validationResult.data;
    const currentStatus = sov.status;
    const userRole = req.user?.role;

    if (!userRole) {
      return res.status(401).json({ error: "Authentication required" });
    }

    const transition = validStatusTransitions[currentStatus];
    if (!transition) {
      return res.status(400).json({ error: `Invalid current status: ${currentStatus}` });
    }

    if (!transition.nextStates.includes(newStatus)) {
      return res.status(400).json({ 
        error: `Cannot transition from ${currentStatus} to ${newStatus}. Valid transitions: ${transition.nextStates.join(', ') || 'none'}` 
      });
    }

    if (!transition.allowedRoles.includes(userRole)) {
      return res.status(403).json({ 
        error: `Your role (${userRole}) cannot perform this status transition` 
      });
    }

    const updateData: any = {
      status: newStatus,
      updatedAt: new Date(),
    };

    if (newStatus === "APPROVED") {
      updateData.approvedById = req.user?.id;
      updateData.approvedAt = new Date();
    } else if (newStatus === "SUBMITTED") {
      updateData.submittedAt = new Date();
    } else if (newStatus === "PAID") {
      updateData.paidAt = new Date();
    }

    const [updated] = await db
      .update(scheduleOfValues)
      .set(updateData)
      .where(eq(scheduleOfValues.id, id))
      .returning();

    if (newStatus === "SUBMITTED" && req.user?.organizationId) {
      try {
        const approvalsEnabled = await isFeatureEnabled(req.user.organizationId, "APPROVALS_FRAMEWORK");
        if (approvalsEnabled) {
          await createApprovalRequest(
            req.user.organizationId,
            "SOV_PAY_APP",
            id,
            req.user.id,
            `SOV/Pay App submitted for approval`
          );
        }
      } catch (e) { /* non-blocking */ }
    }

    res.json(updated);
  } catch (error) {
    console.error("Update SOV status error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/sov/:id/pdf", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const billingMode = (req.query.billingMode as string) || 'all';
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
    
    if (mustDenyAccess) {
      return res.status(404).json({ error: "SOV not found" });
    }

    const { sov, hasAccess } = await verifySOVAccess(id, orgId, shouldFilter);

    if (!sov || !hasAccess) {
      return res.status(404).json({ error: "SOV not found" });
    }

    const lineItems = await db
      .select()
      .from(sovLineItems)
      .where(eq(sovLineItems.sovId, id))
      .orderBy(sovLineItems.lineNumber);

    const [project] = await db
      .select()
      .from(projects)
      .where(eq(projects.id, sov.projectId))
      .limit(1);

    const [org] = await db
      .select()
      .from(organizations)
      .where(eq(organizations.id, sov.organizationId))
      .limit(1);

    const modeLabel = billingMode !== 'all' ? `-${billingMode}` : '';
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${sov.sovNumber}${modeLabel}.pdf"`);
    res.setHeader('Cache-Control', 'no-cache');

    const pdfStream = generateSOVPDF({
      sov,
      lineItems,
      project: project || { name: "Unknown Project", code: "N/A" },
      branding: org ? {
        organizationName: org.name,
        primaryColor: org.primaryColor || undefined,
        accentColor: org.accentColor || undefined,
      } : undefined,
      billingMode: billingMode as any,
    });

    pdfStream.on('error', (err) => {
      console.error("PDF stream error:", err);
      if (!res.headersSent) {
        res.status(500).json({ error: "Failed to generate PDF" });
      }
    });

    pdfStream.pipe(res);
  } catch (error) {
    console.error("Generate SOV PDF error:", error);
    if (!res.headersSent) {
      res.status(500).json({ error: "Internal server error" });
    }
  }
});

router.post("/sov/:id/send", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { email, billingMode = 'all' } = req.body;
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);

    if (mustDenyAccess) {
      return res.status(404).json({ error: "SOV not found" });
    }

    if (!email || typeof email !== 'string') {
      return res.status(400).json({ error: "Recipient email is required" });
    }

    const { sov, hasAccess } = await verifySOVAccess(id, orgId, shouldFilter);

    if (!sov || !hasAccess) {
      return res.status(404).json({ error: "SOV not found" });
    }

    const lineItems = await db
      .select()
      .from(sovLineItems)
      .where(eq(sovLineItems.sovId, id))
      .orderBy(sovLineItems.lineNumber);

    const [project] = await db
      .select()
      .from(projects)
      .where(eq(projects.id, sov.projectId))
      .limit(1);

    const [org] = await db
      .select()
      .from(organizations)
      .where(eq(organizations.id, sov.organizationId))
      .limit(1);

    const pdfStream = generateSOVPDF({
      sov,
      lineItems,
      project: project || { name: "Unknown Project", code: "N/A" },
      branding: org ? {
        organizationName: org.name,
        primaryColor: org.primaryColor || undefined,
        accentColor: org.accentColor || undefined,
      } : undefined,
      billingMode: billingMode as any,
    });

    const chunks: Buffer[] = [];
    await new Promise<void>((resolve, reject) => {
      pdfStream.on('data', (chunk: Buffer) => chunks.push(chunk));
      pdfStream.on('end', resolve);
      pdfStream.on('error', reject);
    });
    const pdfBuffer = Buffer.concat(chunks);

    const billingLabels: Record<string, string> = {
      all: 'All Categories',
      material: 'Material Only',
      labor: 'Labor Only',
      material_labor: 'Material + Labor',
    };
    const billingLabel = billingLabels[billingMode] || 'All Categories';
    const orgName = org?.name || 'SmartManageAI';
    const projectName = project?.name || 'Unknown Project';

    const { sendEmail: sendEmailFn } = await import('./email');

    const modeLabel = billingMode !== 'all' ? `-${billingMode}` : '';
    const pdfFilename = `${sov.sovNumber}${modeLabel}.pdf`;

    const sent = await sendEmailFn({
      to: email,
      subject: `${orgName} - Schedule of Values: ${sov.sovNumber} (${billingLabel})`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #1a365d;">Schedule of Values - Billing Breakdown</h2>
          <p>Please find the attached Schedule of Values billing breakdown.</p>
          <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
            <tr><td style="padding: 8px; border-bottom: 1px solid #e5e7eb; font-weight: bold;">SOV Number</td><td style="padding: 8px; border-bottom: 1px solid #e5e7eb;">${sov.sovNumber}</td></tr>
            <tr><td style="padding: 8px; border-bottom: 1px solid #e5e7eb; font-weight: bold;">Project</td><td style="padding: 8px; border-bottom: 1px solid #e5e7eb;">${projectName}</td></tr>
            <tr><td style="padding: 8px; border-bottom: 1px solid #e5e7eb; font-weight: bold;">Billing Type</td><td style="padding: 8px; border-bottom: 1px solid #e5e7eb;">${billingLabel}</td></tr>
            <tr><td style="padding: 8px; border-bottom: 1px solid #e5e7eb; font-weight: bold;">Status</td><td style="padding: 8px; border-bottom: 1px solid #e5e7eb;">${sov.status}</td></tr>
          </table>
          <p style="color: #6b7280; font-size: 12px;">This email was sent from ${orgName} via SmartManageAI.</p>
        </div>
      `,
      text: `Schedule of Values ${sov.sovNumber} - ${billingLabel}\nProject: ${projectName}\nStatus: ${sov.status}`,
      attachments: [{
        filename: pdfFilename,
        content: pdfBuffer,
        contentType: 'application/pdf',
      }],
    });

    if (!sent) {
      return res.status(500).json({ error: "Failed to send email. Please try downloading the PDF instead." });
    }

    res.json({ success: true, message: `PDF sent to ${email}` });
  } catch (error) {
    console.error("Send SOV PDF error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
