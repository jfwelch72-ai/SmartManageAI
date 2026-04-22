import swaggerJsdoc from "swagger-jsdoc";
import swaggerUi from "swagger-ui-express";
import type { Express } from "express";
import { zodSchemaToOpenApi } from "./swaggerSchemas";

const componentSchemas = zodSchemaToOpenApi();

const swaggerOptions: swaggerJsdoc.Options = {
  definition: {
    openapi: "3.0.3",
    info: {
      title: "Construction Management Platform API",
      version: "1.0.0",
      description:
        "Comprehensive API for managing construction projects, bids, estimates, payroll, procurement, CRM, equipment, time tracking, safety, and more.",
      contact: {
        name: "API Support",
      },
    },
    servers: [
      {
        url: "/",
        description: "Current server",
      },
    ],
    components: {
      securitySchemes: {
        cookieAuth: {
          type: "apiKey",
          in: "cookie",
          name: "auth_token",
          description:
            "JWT authentication token stored in an httpOnly cookie. Obtained via POST /api/auth/login.",
        },
        publicApiKey: {
          type: "http",
          scheme: "bearer",
          description:
            "Public API key (format: ckp_xxxx.yyyy) issued via the Developer Portal. Send as 'Authorization: Bearer <key>' or 'X-API-Key: <key>'.",
        },
        publicApiOAuth: {
          type: "oauth2",
          description:
            "OAuth 2.0 client credentials. POST /api/v1/public/oauth/token with grant_type=client_credentials and your API key as client credentials to obtain a short-lived bearer token.",
          flows: {
            clientCredentials: {
              tokenUrl: "/api/v1/public/oauth/token",
              scopes: {
                "projects:read": "Read projects",
                "bids:read": "Read bids",
                "change_orders:read": "Read change orders",
                "rfis:read": "Read RFIs",
                "submittals:read": "Read submittals",
                "webhooks:manage": "Manage webhook subscriptions",
              },
            },
          },
        },
      },
      schemas: componentSchemas,
      parameters: {
        PageParam: {
          name: "page",
          in: "query",
          schema: { type: "integer", default: 1 },
          description: "Page number for pagination",
        },
        LimitParam: {
          name: "limit",
          in: "query",
          schema: { type: "integer", default: 50 },
          description: "Number of items per page",
        },
      },
    },
    security: [{ cookieAuth: [] }],
    tags: [
      { name: "Authentication", description: "User registration, login, logout, password reset, and profile management" },
      { name: "Projects", description: "Project CRUD operations, financials, labor rates, and scope management" },
      { name: "Bids & Estimates", description: "Bid lifecycle management, estimates, and line items" },
      { name: "CRM", description: "Customer/vendor relationship management, contacts, and opportunities" },
      { name: "Payroll", description: "Pay runs, payroll overview, deductions, and prevailing wage management" },
      { name: "Time & Attendance", description: "Time clock shifts, clock in/out, overtime, and time entry approvals" },
      { name: "Procurement", description: "Purchase requests, purchase orders, receipts, and vendor invoices" },
      { name: "Equipment", description: "Equipment management, assignments, repairs, maintenance, and rentals" },
      { name: "Change Orders", description: "Change order lifecycle, approvals, and export" },
      { name: "Messaging", description: "Internal messaging system with conversations and messages" },
      { name: "Notifications", description: "User notifications, preferences, and push subscriptions" },
      { name: "Safety", description: "Safety training, inspections, incidents, and compliance" },
      { name: "Financials", description: "Schedule of values, AIA billing, cost ledger, and revenue recognition" },
      { name: "Documents", description: "RFIs, submittals, transmittals, document revisions, and drawing sets" },
      { name: "Scheduling", description: "Project scheduling, CPM, Gantt chart, resource loading, delay analysis, and calendar events" },
      { name: "Workforce", description: "Workers, crews, skills, certifications, and hiring" },
      { name: "Admin", description: "Organization management, feature flags, SSO, audit exports, and platform administration" },
      { name: "Subcontractors", description: "Subcontract agreements, pay apps, retention, and performance" },
      { name: "Billing", description: "AIA G702/G703 billing, pay applications, retention releases, and stored materials" },
      { name: "Reports", description: "Takeoff reports, estimate reports, and KPI dashboards" },
      { name: "Integrations", description: "Third-party integrations and webhooks" },
      { name: "Public API", description: "External Public API at /api/v1/public — API key or OAuth2 client_credentials authentication, scoped permissions, per-key rate limits, HMAC-signed outbound webhooks" },
      { name: "Operations", description: "Health checks and operational endpoints" },
    ],
  },
  apis: [
    "./server/routes.ts",
    "./server/authProfileRoutes.ts",
    "./server/timeClockRoutes.ts",
    "./server/payrollRoutes.ts",
    "./server/crmRoutes.ts",
    "./server/bidRoutes2.ts",
    "./server/projectCrudRoutes.ts",
    "./server/procurementModuleRoutes.ts",
    "./server/equipmentRoutes.ts",
    "./server/messagingRoutes.ts",
    "./server/notificationRoutes2.ts",
    "./server/inspectionRoutes.ts",
    "./server/rfiRoutes.ts",
    "./server/submittalRoutes.ts",
    "./server/changeOrderCrudRoutes.ts",
    "./server/opsRoutes.ts",
    "./server/platformRoutes.ts",
    "./server/sovRoutes.ts",
    "./server/workforceRoutes.ts",
    "./server/crewRoutes2.ts",
    "./server/skillRoutes.ts",
    "./server/safetyTrainingRoutes.ts",
    "./server/dashboardRoutes.ts",
    "./server/overtimeRoutes.ts",
    "./server/subcontractRoutes.ts",
    "./server/scheduleRoutes.ts",
    "./server/changeOrderApprovalRoutes.ts",
    "./server/changeOrderExportRoutes.ts",
    "./server/notificationPreferencesRoutes.ts",
    "./server/aiaBillingRoutes.ts",
    "./server/publicApi/routes.ts",
    "./server/publicApi/oauthRoutes.ts",
  ],
};

const swaggerSpec = swaggerJsdoc(swaggerOptions);

export function setupSwagger(app: Express): void {
  app.use(
    "/api-docs",
    swaggerUi.serve,
    swaggerUi.setup(swaggerSpec, {
      customCss: ".swagger-ui .topbar { display: none }",
      customSiteTitle: "Construction Management Platform - API Docs",
      swaggerOptions: {
        persistAuthorization: true,
        docExpansion: "list",
        filter: true,
        tagsSorter: "alpha",
        operationsSorter: "alpha",
      },
    })
  );

  app.get("/api-docs.json", (_req, res) => {
    res.json(swaggerSpec);
  });
}
