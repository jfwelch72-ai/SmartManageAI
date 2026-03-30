import { z } from "zod";
import {
  insertUserSchema, insertProjectSchema, insertBidSchema,
  insertEstimateSchema, insertProcurementItemSchema,
  insertChangeOrderSchema, insertNotificationSchema,
  insertCrewSchema, insertSkillSchema,
  insertScopeItemSchema, insertCalendarEventSchema,
  insertCrmOrganisationSchema, insertCrmContactSchema,
  insertCrmOpportunitySchema,
  insertRfiSchema, insertSubmittalSchema, insertSubmittalItemSchema,
  insertSubmittalReviewSchema, insertPayRunSchema,
  insertPayrollDeductionTypeSchema, insertEmployeeDeductionSchema,
  insertTaskSchema, insertTimeEntrySchema,
  insertSafetyIncidentSchema, insertSafetyTrainingSchema,
} from "@shared/schema";

function zodToOpenApiSchema(schema: z.ZodTypeAny): Record<string, any> {
  if (schema instanceof z.ZodObject) {
    const shape = schema.shape;
    const properties: Record<string, any> = {};
    const required: string[] = [];

    for (const [key, value] of Object.entries(shape)) {
      properties[key] = zodToOpenApiSchema(value as z.ZodTypeAny);
      if (!(value instanceof z.ZodOptional) && !(value instanceof z.ZodNullable) && !(value instanceof z.ZodDefault)) {
        required.push(key);
      }
    }

    const result: Record<string, any> = { type: "object", properties };
    if (required.length > 0) result.required = required;
    return result;
  }

  if (schema instanceof z.ZodString) {
    return { type: "string" };
  }

  if (schema instanceof z.ZodNumber) {
    return { type: "number" };
  }

  if (schema instanceof z.ZodBoolean) {
    return { type: "boolean" };
  }

  if (schema instanceof z.ZodDate) {
    return { type: "string", format: "date-time" };
  }

  if (schema instanceof z.ZodEnum) {
    return { type: "string", enum: schema.options };
  }

  if (schema instanceof z.ZodNativeEnum) {
    return { type: "string" };
  }

  if (schema instanceof z.ZodArray) {
    return { type: "array", items: zodToOpenApiSchema(schema.element) };
  }

  if (schema instanceof z.ZodOptional) {
    return zodToOpenApiSchema(schema.unwrap());
  }

  if (schema instanceof z.ZodNullable) {
    const inner = zodToOpenApiSchema(schema.unwrap());
    return { ...inner, nullable: true };
  }

  if (schema instanceof z.ZodDefault) {
    const inner = zodToOpenApiSchema(schema._def.innerType);
    return inner;
  }

  if (schema instanceof z.ZodEffects) {
    return zodToOpenApiSchema(schema._def.schema);
  }

  if (schema instanceof z.ZodUnion) {
    const options = schema._def.options.map((o: z.ZodTypeAny) => zodToOpenApiSchema(o));
    if (options.length === 2 && options.some((o: any) => o.type === "null")) {
      const nonNull = options.find((o: any) => o.type !== "null");
      return { ...nonNull, nullable: true };
    }
    return { oneOf: options };
  }

  if (schema instanceof z.ZodLiteral) {
    return { type: typeof schema.value, enum: [schema.value] };
  }

  if (schema instanceof z.ZodRecord) {
    return { type: "object", additionalProperties: true };
  }

  if (schema instanceof z.ZodAny || schema instanceof z.ZodUnknown) {
    return {};
  }

  return { type: "string" };
}

export function zodSchemaToOpenApi(): Record<string, any> {
  const schemas: Record<string, any> = {};

  const schemaMap: Record<string, z.ZodTypeAny> = {
    InsertUser: insertUserSchema,
    InsertProject: insertProjectSchema,
    InsertBid: insertBidSchema,
    InsertEstimate: insertEstimateSchema,
    InsertProcurementItem: insertProcurementItemSchema,
    InsertChangeOrder: insertChangeOrderSchema,
    InsertNotification: insertNotificationSchema,
    InsertCrew: insertCrewSchema,
    InsertSkill: insertSkillSchema,
    InsertScopeItem: insertScopeItemSchema,
    InsertCalendarEvent: insertCalendarEventSchema,
    InsertCrmOrganisation: insertCrmOrganisationSchema,
    InsertCrmContact: insertCrmContactSchema,
    InsertCrmOpportunity: insertCrmOpportunitySchema,
    InsertRfi: insertRfiSchema,
    InsertSubmittal: insertSubmittalSchema,
    InsertSubmittalItem: insertSubmittalItemSchema,
    InsertSubmittalReview: insertSubmittalReviewSchema,
    InsertPayRun: insertPayRunSchema,
    InsertPayrollDeductionType: insertPayrollDeductionTypeSchema,
    InsertEmployeeDeduction: insertEmployeeDeductionSchema,
    InsertTask: insertTaskSchema,
    InsertTimeEntry: insertTimeEntrySchema,
    InsertSafetyIncident: insertSafetyIncidentSchema,
    InsertSafetyTraining: insertSafetyTrainingSchema,
  };

  for (const [name, schema] of Object.entries(schemaMap)) {
    try {
      schemas[name] = zodToOpenApiSchema(schema);
    } catch {
      schemas[name] = { type: "object", description: `Auto-generated from ${name} Zod schema` };
    }
  }

  schemas.Error = {
    type: "object",
    properties: {
      error: { type: "string" },
    },
  };

  schemas.User = {
    type: "object",
    properties: {
      id: { type: "string", format: "uuid" },
      firstName: { type: "string" },
      lastName: { type: "string" },
      email: { type: "string", format: "email" },
      phone: { type: "string", nullable: true },
      role: {
        type: "string",
        enum: [
          "SUPER_ADMIN", "ADMIN", "MANAGER", "SUPERINTENDENT", "ESTIMATOR",
          "OFFICE_MANAGER", "HOURLY_EMPLOYEE", "MAINTENANCE_MANAGER", "VENDOR",
          "HUSTLER", "SALES", "MARKETING", "SAFETY_MANAGER", "HR_MANAGER",
          "EQUIPMENT_MANAGER", "PROJECT_ENGINEER", "PROCUREMENT_MANAGER", "DISPATCHER",
        ],
      },
      isActive: { type: "boolean" },
      organizationId: { type: "string", format: "uuid" },
      createdAt: { type: "string", format: "date-time" },
      updatedAt: { type: "string", format: "date-time" },
    },
  };

  schemas.Project = {
    type: "object",
    properties: {
      id: { type: "string", format: "uuid" },
      code: { type: "string" },
      name: { type: "string" },
      status: { type: "string", enum: ["BID", "PLANNING", "ACTIVE", "COMPLETE", "CLOSED"] },
      clientName: { type: "string", nullable: true },
      description: { type: "string", nullable: true },
      contractAmount: { type: "string", nullable: true },
      gcOrganizationId: { type: "string", format: "uuid" },
      estimatorId: { type: "string", format: "uuid", nullable: true },
      superintendentId: { type: "string", format: "uuid", nullable: true },
      createdAt: { type: "string", format: "date-time" },
      updatedAt: { type: "string", format: "date-time" },
    },
  };

  schemas.Bid = {
    type: "object",
    properties: {
      id: { type: "string", format: "uuid" },
      code: { type: "string" },
      name: { type: "string" },
      clientName: { type: "string", nullable: true },
      status: { type: "string", enum: ["DRAFT", "ACTIVE", "SUBMITTED", "AWARDED", "LOST", "CANCELLED"] },
      bidAmount: { type: "string", nullable: true },
      description: { type: "string", nullable: true },
      dueDate: { type: "string", format: "date-time", nullable: true },
      estimatorId: { type: "string", format: "uuid", nullable: true },
      gcOrganizationId: { type: "string", format: "uuid" },
      createdAt: { type: "string", format: "date-time" },
      updatedAt: { type: "string", format: "date-time" },
    },
  };

  schemas.TimeClockShift = {
    type: "object",
    properties: {
      id: { type: "string", format: "uuid" },
      userId: { type: "string", format: "uuid" },
      projectId: { type: "string", format: "uuid", nullable: true },
      costCode: { type: "string", nullable: true },
      clockIn: { type: "string", format: "date-time" },
      clockOut: { type: "string", format: "date-time", nullable: true },
      totalHours: { type: "string", nullable: true },
      notes: { type: "string", nullable: true },
      geofenceStatus: { type: "string" },
      approvalStatus: { type: "string" },
    },
  };

  schemas.PayRun = {
    type: "object",
    properties: {
      id: { type: "string", format: "uuid" },
      organizationId: { type: "string", format: "uuid" },
      payPeriodStart: { type: "string", format: "date" },
      payPeriodEnd: { type: "string", format: "date" },
      status: { type: "string" },
      totalGross: { type: "string" },
      totalNet: { type: "string" },
      createdAt: { type: "string", format: "date-time" },
    },
  };

  schemas.CrmOrganisation = {
    type: "object",
    properties: {
      id: { type: "string", format: "uuid" },
      name: { type: "string" },
      type: { type: "string" },
      organizationId: { type: "string", format: "uuid" },
      isActive: { type: "boolean" },
      city: { type: "string", nullable: true },
      state: { type: "string", nullable: true },
      crmStatus: { type: "string", nullable: true },
      createdAt: { type: "string", format: "date-time" },
    },
  };

  schemas.PurchaseRequest = {
    type: "object",
    properties: {
      id: { type: "string", format: "uuid" },
      orgId: { type: "string", format: "uuid" },
      projectId: { type: "string", format: "uuid" },
      prNumber: { type: "string" },
      title: { type: "string" },
      status: { type: "string", enum: ["DRAFT", "PENDING_APPROVAL", "APPROVED", "REJECTED", "CONVERTED_TO_PO"] },
      totalEstimatedCost: { type: "string", nullable: true },
      createdAt: { type: "string", format: "date-time" },
    },
  };

  schemas.PurchaseOrder = {
    type: "object",
    properties: {
      id: { type: "string", format: "uuid" },
      orgId: { type: "string", format: "uuid" },
      projectId: { type: "string", format: "uuid" },
      poNumber: { type: "string" },
      vendorId: { type: "string", format: "uuid", nullable: true },
      status: { type: "string", enum: ["DRAFT", "PENDING_APPROVAL", "APPROVED", "SENT", "ACKNOWLEDGED", "PARTIAL", "FULFILLED", "CANCELLED"] },
      totalCost: { type: "string", nullable: true },
      createdAt: { type: "string", format: "date-time" },
    },
  };

  schemas.ChangeOrder = {
    type: "object",
    properties: {
      id: { type: "string", format: "uuid" },
      projectId: { type: "string", format: "uuid" },
      title: { type: "string" },
      description: { type: "string", nullable: true },
      status: { type: "string" },
      amount: { type: "string" },
      createdAt: { type: "string", format: "date-time" },
    },
  };

  schemas.Notification = {
    type: "object",
    properties: {
      id: { type: "string", format: "uuid" },
      userId: { type: "string", format: "uuid" },
      type: { type: "string" },
      title: { type: "string" },
      message: { type: "string" },
      isRead: { type: "boolean" },
      createdAt: { type: "string", format: "date-time" },
    },
  };

  schemas.Equipment = {
    type: "object",
    properties: {
      id: { type: "string", format: "uuid" },
      name: { type: "string" },
      type: { type: "string", nullable: true },
      status: { type: "string" },
      organizationId: { type: "string", format: "uuid" },
      createdAt: { type: "string", format: "date-time" },
    },
  };

  schemas.Rfi = {
    type: "object",
    properties: {
      id: { type: "string", format: "uuid" },
      projectId: { type: "string", format: "uuid" },
      rfiNumber: { type: "string" },
      subject: { type: "string" },
      question: { type: "string" },
      status: { type: "string", enum: ["DRAFT", "OPEN", "UNDER_REVIEW", "ANSWERED", "CLOSED"] },
      priority: { type: "string", nullable: true },
      assignedToId: { type: "string", format: "uuid", nullable: true },
      dueDate: { type: "string", format: "date", nullable: true },
      createdAt: { type: "string", format: "date-time" },
    },
  };

  schemas.Submittal = {
    type: "object",
    properties: {
      id: { type: "string", format: "uuid" },
      projectId: { type: "string", format: "uuid" },
      submittalNumber: { type: "string" },
      title: { type: "string" },
      specSection: { type: "string" },
      status: { type: "string" },
      phase: { type: "string", nullable: true },
      assignedToId: { type: "string", format: "uuid", nullable: true },
      dueDate: { type: "string", format: "date", nullable: true },
      createdAt: { type: "string", format: "date-time" },
    },
  };

  schemas.TimeEntry = {
    type: "object",
    properties: {
      id: { type: "string", format: "uuid" },
      userId: { type: "string", format: "uuid" },
      projectId: { type: "string", format: "uuid" },
      date: { type: "string", format: "date" },
      hours: { type: "string" },
      costCode: { type: "string", nullable: true },
      notes: { type: "string", nullable: true },
      createdAt: { type: "string", format: "date-time" },
    },
  };

  schemas.SafetyIncident = {
    type: "object",
    properties: {
      id: { type: "string", format: "uuid" },
      projectId: { type: "string", format: "uuid" },
      reportedById: { type: "string", format: "uuid" },
      type: { type: "string" },
      severity: { type: "string" },
      description: { type: "string" },
      status: { type: "string" },
      createdAt: { type: "string", format: "date-time" },
    },
  };

  schemas.VendorInvoice = {
    type: "object",
    properties: {
      id: { type: "string", format: "uuid" },
      orgId: { type: "string", format: "uuid" },
      poId: { type: "string", format: "uuid", nullable: true },
      invoiceNumber: { type: "string" },
      vendorId: { type: "string", format: "uuid", nullable: true },
      totalAmount: { type: "string" },
      status: { type: "string", enum: ["PENDING", "MATCHED", "APPROVED", "PAID", "DISPUTED"] },
      createdAt: { type: "string", format: "date-time" },
    },
  };

  schemas.Pagination = {
    type: "object",
    properties: {
      page: { type: "integer" },
      limit: { type: "integer" },
      totalCount: { type: "integer" },
      totalPages: { type: "integer" },
    },
  };

  return schemas;
}
