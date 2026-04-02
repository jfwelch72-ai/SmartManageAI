import { useState, useEffect, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  CheckCircle2,
  XCircle,
  ChevronDown,
  ChevronRight,
  Search,
  RotateCcw,
  ClipboardList,
  LogIn,
  LayoutDashboard,
  Gavel,
  FolderKanban,
  Calculator,
  FileEdit,
  ShoppingCart,
  Users,
  DollarSign,
  Truck,
  Building2,
  MessageSquare,
  BarChart3,
  Settings,
  ExternalLink,
  Store,
  Globe,
  Brain,
  CheckSquare,
  FileText,
  Shield,
} from "lucide-react";

const STORAGE_KEY = "test-flow-checklist-state";

type TestStatus = "untested" | "pass" | "fail";

interface TestScenario {
  id: string;
  title: string;
  steps: string[];
  expected: string;
}

interface TestSection {
  id: string;
  title: string;
  icon: typeof LogIn;
  scenarios: TestScenario[];
}

const TEST_SECTIONS: TestSection[] = [
  {
    id: "auth",
    title: "Authentication & Onboarding",
    icon: LogIn,
    scenarios: [
      {
        id: "auth-register",
        title: "User Registration",
        steps: [
          "Navigate to /register",
          "Fill in first name, last name, email, and password",
          "Submit the registration form",
          "Verify redirect to onboarding flow",
        ],
        expected: "New account created, user redirected to onboarding wizard",
      },
      {
        id: "auth-login",
        title: "User Login",
        steps: [
          "Navigate to /login",
          "Enter valid credentials",
          "Click Sign In",
          "Verify redirect to dashboard",
        ],
        expected: "User authenticated and redirected to dashboard with correct role badge",
      },
      {
        id: "auth-forgot-password",
        title: "Forgot / Reset Password",
        steps: [
          "Navigate to /forgot-password",
          "Enter registered email",
          "Submit and check for success message",
          "Follow reset link (if email configured)",
          "Set new password on /reset-password",
        ],
        expected: "Password reset email sent, new password accepted on reset page",
      },
      {
        id: "auth-profile-update",
        title: "Profile Update",
        steps: [
          "Navigate to /profile",
          "Update first name, last name, or avatar",
          "Save changes",
          "Verify toast confirmation and updated data",
        ],
        expected: "Profile fields updated and reflected in header/sidebar",
      },
      {
        id: "auth-rbac",
        title: "Role-Based Access Verification",
        steps: [
          "Log in as ADMIN — verify full sidebar menu",
          "Log in as FIELD_WORKER — verify restricted menu items",
          "Attempt accessing /company-settings as non-admin",
          "Verify Access Denied page renders",
        ],
        expected: "Each role sees only permitted navigation items; unauthorized routes show Access Denied",
      },
    ],
  },
  {
    id: "dashboard",
    title: "Dashboard",
    icon: LayoutDashboard,
    scenarios: [
      {
        id: "dash-widgets",
        title: "Widget Rendering",
        steps: [
          "Navigate to /dashboard",
          "Verify greeting displays correct time of day",
          "Confirm role badge is visible",
          "Check that dashboard grid loads widgets",
        ],
        expected: "Dashboard renders with greeting, role badge, and all configured widgets",
      },
      {
        id: "dash-navigation",
        title: "Navigation Links",
        steps: [
          "Click 'New Bid' button (if admin/manager)",
          "Verify redirect to bids page",
          "Return to dashboard",
          "Click sidebar navigation items",
        ],
        expected: "All navigation links route to correct pages",
      },
      {
        id: "dash-edit-mode",
        title: "Edit Mode & Widget Library",
        steps: [
          "Enter edit mode via dashboard controls",
          "Open widget library",
          "Add a widget to a section",
          "Exit edit mode",
          "Verify widget persists on refresh",
        ],
        expected: "Widget library opens, widgets can be added/removed, layout persists",
      },
      {
        id: "dash-theme",
        title: "Theme / Settings Persistence",
        steps: [
          "Click the theme picker",
          "Switch between light and dark mode",
          "Refresh the page",
          "Verify theme persists",
        ],
        expected: "Theme preference persists across page refreshes",
      },
    ],
  },
  {
    id: "bidding",
    title: "Bidding Lifecycle",
    icon: Gavel,
    scenarios: [
      {
        id: "bid-create",
        title: "Create Bid",
        steps: [
          "Navigate to /bids",
          "Click 'New Bid' button",
          "Fill in project name and client name",
          "Optionally select CRM organization",
          "Submit form",
        ],
        expected: "Bid created with auto-generated code, redirected to bid detail page",
      },
      {
        id: "bid-upload-plans",
        title: "Upload Plans",
        steps: [
          "Open a bid detail page",
          "Navigate to the Plans step in cost builder",
          "Upload a PDF document",
          "Verify file appears in document list",
        ],
        expected: "PDF uploaded and listed under bid documents",
      },
      {
        id: "bid-takeoff",
        title: "Run Takeoff Measurements",
        steps: [
          "Open Plans tab on bid detail",
          "Use takeoff tools for area/linear/count measurements",
          "Verify measurements display on plan overlay",
        ],
        expected: "Measurements captured and displayed on the plan viewer",
      },
      {
        id: "bid-estimate",
        title: "Build Estimate with Line Items",
        steps: [
          "Navigate to estimate page for a bid",
          "Add line items with descriptions, quantities, and unit costs",
          "Verify totals calculate correctly",
          "Apply overhead and profit percentages",
        ],
        expected: "Estimate totals update correctly with overhead and profit margins",
      },
      {
        id: "bid-subcontractor-quotes",
        title: "Subcontractor & Material Quotes",
        steps: [
          "Open bid detail",
          "Add a subcontractor quote with scope of work and amount",
          "Add a material quote with supplier info",
          "Add equipment selection",
          "Verify all appear in the cost builder sidebar",
        ],
        expected: "Quotes and equipment selections are listed and included in bid summary",
      },
      {
        id: "bid-submit-proposal",
        title: "Submit Proposal",
        steps: [
          "Open bid detail page",
          "Click Submit Proposal button",
          "Enter recipient email (if applicable)",
          "Confirm submission",
        ],
        expected: "Proposal submission triggered, status updated",
      },
      {
        id: "bid-award",
        title: "Award Bid",
        steps: [
          "Open a bid with a valid bid amount",
          "Click 'Convert to Project' / 'Award Bid'",
          "Select superintendent and project manager",
          "Set overhead and profit percentages",
          "Choose Active or Planning status",
          "Confirm conversion",
        ],
        expected: "Bid status changes to AWARDED, new project created with bid data carried over",
      },
      {
        id: "bid-to-project",
        title: "Bid-to-Project Data Carryover",
        steps: [
          "After awarding a bid, navigate to the new project",
          "Verify project name matches bid name",
          "Verify client information carried over",
          "Check that budget/contract amount reflects bid amount",
          "Verify estimate data is accessible from project",
        ],
        expected: "All bid data (name, client, budget, estimate) is present on the project",
      },
    ],
  },
  {
    id: "projects",
    title: "Project Management",
    icon: FolderKanban,
    scenarios: [
      {
        id: "proj-create",
        title: "Create Project",
        steps: [
          "Navigate to /projects",
          "Click 'New Project'",
          "Fill in project name and status",
          "Optionally link CRM organization",
          "Submit form",
        ],
        expected: "Project created with auto-generated code, redirected to project detail",
      },
      {
        id: "proj-detail",
        title: "View / Edit Project Details",
        steps: [
          "Open a project from the projects list",
          "Navigate through tabs: Overview, Job Info, Scope, Schedule",
          "Edit job information and save",
          "Verify changes persist on refresh",
        ],
        expected: "All tabs render correctly, edits save and persist",
      },
      {
        id: "proj-phases-tasks",
        title: "Manage Phases / Tasks",
        steps: [
          "Open Scope & Progress tab",
          "Add a scope item / task",
          "Update progress percentage",
          "Verify progress bar updates",
        ],
        expected: "Scope items created, progress tracked and displayed",
      },
      {
        id: "proj-daily-reports",
        title: "Daily Reports",
        steps: [
          "Open Daily Notes tab",
          "Create a new daily note",
          "Add weather, manpower, and work description",
          "Save and verify it appears in the feed",
        ],
        expected: "Daily report saved and visible in chronological feed",
      },
      {
        id: "proj-rfis",
        title: "RFIs",
        steps: [
          "Open RFIs tab on project detail",
          "Create a new RFI with subject and question",
          "Submit the RFI",
          "Verify status tracking works",
        ],
        expected: "RFI created, trackable with status changes",
      },
      {
        id: "proj-submittals",
        title: "Submittals",
        steps: [
          "Open Submittals tab",
          "Create a new submittal with description",
          "Upload supporting documents",
          "Track approval status",
        ],
        expected: "Submittal created and tracked through approval workflow",
      },
      {
        id: "proj-document-control",
        title: "Document Control",
        steps: [
          "Open Plans & Takeoff tab",
          "Upload a document",
          "Verify document appears in list",
          "Check Project Vault tab for document storage",
        ],
        expected: "Documents uploaded, organized, and accessible from project vault",
      },
    ],
  },
  {
    id: "estimating",
    title: "Estimating & Takeoff",
    icon: Calculator,
    scenarios: [
      {
        id: "est-upload-pdf",
        title: "Upload PDFs for Takeoff",
        steps: [
          "Open a bid's Plans tab",
          "Upload a construction plan PDF",
          "Verify PDF renders in the viewer",
        ],
        expected: "PDF uploaded and viewable in the plan viewer",
      },
      {
        id: "est-measurements",
        title: "Area / Linear / Count Measurements",
        steps: [
          "Open a plan in the takeoff viewer",
          "Use area measurement tool",
          "Use linear measurement tool",
          "Use count tool",
          "Verify measurements save",
        ],
        expected: "All measurement types capture and persist correctly",
      },
      {
        id: "est-pricebook",
        title: "Pricebook Lookups",
        steps: [
          "Navigate to estimate page",
          "Search for items in pricebook",
          "Add pricebook items to estimate",
          "Verify pricing auto-populates",
        ],
        expected: "Pricebook items found and added with correct pricing",
      },
      {
        id: "est-assemblies",
        title: "Assembly Usage",
        steps: [
          "Open estimate builder",
          "Select an assembly from the library",
          "Apply assembly to estimate",
          "Verify component line items are created",
        ],
        expected: "Assembly expands into component line items with correct quantities and pricing",
      },
      {
        id: "est-export",
        title: "Estimate Export",
        steps: [
          "Open a completed estimate",
          "Click export/download option",
          "Verify exported file format and data accuracy",
        ],
        expected: "Estimate exported with all line items, totals, and formatting intact",
      },
    ],
  },
  {
    id: "change-orders",
    title: "Change Orders",
    icon: FileEdit,
    scenarios: [
      {
        id: "co-create",
        title: "Create Change Order",
        steps: [
          "Open project detail > Financials tab",
          "Click 'New Change Order'",
          "Enter title, description, and amount",
          "Save as draft",
        ],
        expected: "Change order created in Draft status",
      },
      {
        id: "co-line-items",
        title: "Add Line Items to CO",
        steps: [
          "Open a draft change order",
          "Add line items with descriptions and amounts",
          "Verify total updates correctly",
        ],
        expected: "Line items added, CO total recalculates",
      },
      {
        id: "co-submit-approve",
        title: "Submit for Approval / Approve / Reject",
        steps: [
          "Submit change order for approval",
          "Log in as approver and approve the CO",
          "Verify status changes to Approved",
          "Test rejection flow with notes",
        ],
        expected: "CO flows through approval workflow; status updates correctly",
      },
      {
        id: "co-budget-impact",
        title: "Verify Budget Impact",
        steps: [
          "After approving a change order, check project financials",
          "Verify adjusted contract amount includes CO value",
          "Check that approved COs count is incremented",
        ],
        expected: "Approved CO amount reflected in project's adjusted contract and financials",
      },
    ],
  },
  {
    id: "procurement",
    title: "Procurement",
    icon: ShoppingCart,
    scenarios: [
      {
        id: "proc-create-pr",
        title: "Create Purchase Requisition",
        steps: [
          "Navigate to /procurement-module",
          "Click 'New Request' on Purchase Requests tab",
          "Select project, enter title, add line items",
          "Submit for approval",
        ],
        expected: "PR created with line items, submitted for approval",
      },
      {
        id: "proc-convert-po",
        title: "Convert PR to Purchase Order",
        steps: [
          "Approve a pending purchase request",
          "Click 'Convert to PO'",
          "Select vendor for the PO",
          "Verify PO created with PR line items",
        ],
        expected: "PO created from PR with matching line items and vendor assigned",
      },
      {
        id: "proc-receive",
        title: "Receive Goods",
        steps: [
          "Open an approved/sent PO",
          "Record receipt of goods with quantities",
          "Verify receipt appears in receipts list",
        ],
        expected: "Receipt recorded, PO status updates to reflect delivery",
      },
      {
        id: "proc-invoice-match",
        title: "Match Invoice (3-Way Match)",
        steps: [
          "Create a vendor invoice against a PO",
          "Run invoice matching",
          "Verify 3-way match: PO line items vs receipt vs invoice",
          "Resolve any discrepancies",
        ],
        expected: "3-way match completes; discrepancies flagged and resolvable",
      },
    ],
  },
  {
    id: "workforce",
    title: "Workforce & Time",
    icon: Users,
    scenarios: [
      {
        id: "wf-add-workers",
        title: "Add Workers",
        steps: [
          "Navigate to /manage-workers",
          "Click 'Add Worker'",
          "Fill in worker details (name, role, rates)",
          "Save and verify worker appears in list",
        ],
        expected: "Worker created and listed with correct information",
      },
      {
        id: "wf-assign-project",
        title: "Assign Workers to Projects",
        steps: [
          "Open a project's Labor tab",
          "Assign workers to the project",
          "Verify assignments appear in crew list",
        ],
        expected: "Workers assigned and visible in project labor tab",
      },
      {
        id: "wf-clock-in-out",
        title: "Clock In / Out",
        steps: [
          "Navigate to /time-clock",
          "Clock in to a project",
          "Verify active clock display",
          "Clock out and verify time entry created",
        ],
        expected: "Time clock tracks entry/exit; time entries created with correct duration",
      },
      {
        id: "wf-super-approval",
        title: "Superintendent Approval",
        steps: [
          "Navigate to /time-clock-manager",
          "Review pending time entries",
          "Approve or reject entries",
          "Verify status updates",
        ],
        expected: "Time entries approved/rejected with status changes reflected",
      },
      {
        id: "wf-overtime-rules",
        title: "Overtime Rules",
        steps: [
          "Navigate to /overtime-rules",
          "Configure overtime thresholds (daily/weekly)",
          "Create time entries exceeding thresholds",
          "Verify overtime hours calculated correctly",
        ],
        expected: "Overtime calculated based on configured rules",
      },
    ],
  },
  {
    id: "payroll",
    title: "Payroll",
    icon: DollarSign,
    scenarios: [
      {
        id: "pay-create-run",
        title: "Create Pay Run",
        steps: [
          "Navigate to /payroll-management",
          "Click 'Create Pay Run'",
          "Set pay period start and end dates",
          "Submit to create the pay run",
        ],
        expected: "Pay run created in Draft status with correct period",
      },
      {
        id: "pay-burden",
        title: "Verify Burden Calculations",
        steps: [
          "Open a pay run with line items",
          "Check that burden/overhead is applied to labor costs",
          "Verify total gross, deductions, and net amounts",
        ],
        expected: "Burden calculations applied correctly; totals are accurate",
      },
      {
        id: "pay-approve-items",
        title: "Approve Pay Run Line Items",
        steps: [
          "Open a draft pay run",
          "Submit for approval",
          "Approve the pay run",
          "Progress through processing to paid status",
        ],
        expected: "Pay run flows through DRAFT → PENDING → APPROVED → PROCESSING → PAID",
      },
      {
        id: "pay-void",
        title: "Void / Reprocess Pay Run",
        steps: [
          "Open a paid or processing pay run",
          "Click Void",
          "Verify status changes to VOIDED",
          "Check that a new pay run can be created for the same period",
        ],
        expected: "Pay run voided, period available for reprocessing",
      },
      {
        id: "pay-wh347",
        title: "WH-347 Report",
        steps: [
          "Open a pay run",
          "Click 'Certified Payroll' / WH-347 button",
          "Verify report generates with correct data",
          "Check formatting matches WH-347 requirements",
        ],
        expected: "WH-347 certified payroll report generated with accurate data",
      },
    ],
  },
  {
    id: "equipment",
    title: "Equipment",
    icon: Truck,
    scenarios: [
      {
        id: "eq-add",
        title: "Add Equipment",
        steps: [
          "Navigate to /equipment",
          "Click 'Add Equipment'",
          "Fill in name, type, make, model",
          "Save and verify equipment appears in list",
        ],
        expected: "Equipment created with auto-generated code and listed correctly",
      },
      {
        id: "eq-assign",
        title: "Assign to Project",
        steps: [
          "Open an equipment detail page",
          "Assign equipment to a project",
          "Verify status changes to ASSIGNED",
          "Check equipment appears on project's Equipment tab",
        ],
        expected: "Equipment assigned, status updated, visible on project",
      },
      {
        id: "eq-utilization",
        title: "Track Utilization",
        steps: [
          "Open equipment detail page",
          "View utilization metrics and hours",
          "Update current hours",
          "Check maintenance schedule alerts",
        ],
        expected: "Utilization data tracked and maintenance alerts triggered at thresholds",
      },
      {
        id: "eq-csv",
        title: "CSV Import / Export",
        steps: [
          "Navigate to equipment list",
          "Click Export CSV and verify downloaded file",
          "Prepare a CSV file matching the template",
          "Import CSV and verify records created",
        ],
        expected: "CSV export downloads correct data; CSV import creates equipment records",
      },
    ],
  },
  {
    id: "crm",
    title: "CRM & Pipeline",
    icon: Building2,
    scenarios: [
      {
        id: "crm-create-org",
        title: "Create Contact / Organization",
        steps: [
          "Navigate to /crm",
          "Click 'New Organization'",
          "Fill in name, type (Subcontractor/Supplier/etc.)",
          "Add a contact with name, email, phone",
          "Save and verify organization and contact created",
        ],
        expected: "Organization and contact created, listed in CRM directory",
      },
      {
        id: "crm-opportunity",
        title: "Add Opportunity",
        steps: [
          "Open Pipeline view in CRM",
          "Create a new opportunity",
          "Set value, expected close date, and probability",
          "Assign to a sales rep",
        ],
        expected: "Opportunity created and visible in pipeline kanban",
      },
      {
        id: "crm-pipeline-stages",
        title: "Move Through Pipeline Stages",
        steps: [
          "Open an opportunity in the pipeline",
          "Move it from Lead → Qualification → Proposal → Negotiation → Won",
          "Verify stage history is tracked",
        ],
        expected: "Opportunity progresses through stages with history recorded",
      },
      {
        id: "crm-convert-to-bid",
        title: "Convert Opportunity to Bid",
        steps: [
          "Open a won opportunity",
          "Click 'Convert to Bid'",
          "Verify bid created with organization data pre-filled",
        ],
        expected: "Bid created from opportunity with CRM data carried over",
      },
      {
        id: "crm-duplicates",
        title: "Duplicate Detection",
        steps: [
          "Open CRM page",
          "Click duplicate detection / merge tool",
          "Review potential duplicate organizations",
          "Merge or dismiss duplicates",
        ],
        expected: "Potential duplicates identified with option to merge or dismiss",
      },
    ],
  },
  {
    id: "messaging",
    title: "Messaging",
    icon: MessageSquare,
    scenarios: [
      {
        id: "msg-create",
        title: "Create Conversation",
        steps: [
          "Navigate to /dashboard (messaging is a widget, /messages redirects here)",
          "Open the messaging widget via the chat icon",
          "Click 'New Conversation' or start a new thread",
          "Select participants",
          "Name the conversation",
        ],
        expected: "Conversation created and visible in messaging widget",
      },
      {
        id: "msg-send",
        title: "Send Messages",
        steps: [
          "Open a conversation in the messaging widget",
          "Type a message and send",
          "Verify message appears in the thread",
          "Check timestamp and sender info",
        ],
        expected: "Message sent, displayed with correct sender and timestamp",
      },
      {
        id: "msg-edit-delete",
        title: "Edit / Delete Messages",
        steps: [
          "Send a message in a conversation",
          "Edit the message content",
          "Verify edited content displays",
          "Delete a message",
          "Verify it is removed or marked as deleted",
        ],
        expected: "Messages editable and deletable by sender",
      },
      {
        id: "msg-reactions",
        title: "Reactions & Mentions",
        steps: [
          "Open a conversation with messages",
          "Add a reaction to a message",
          "Type a message with @mention",
          "Verify mention notification (if applicable)",
        ],
        expected: "Reactions displayed on messages; mentions trigger notifications",
      },
      {
        id: "msg-archive",
        title: "Archive Conversation",
        steps: [
          "Open a conversation in the messaging widget",
          "Archive the conversation",
          "Verify it moves to archived list",
          "Unarchive and verify it returns",
        ],
        expected: "Conversations can be archived and restored",
      },
    ],
  },
  {
    id: "financials",
    title: "Financials (CFO)",
    icon: BarChart3,
    scenarios: [
      {
        id: "fin-dashboard",
        title: "CFO Dashboard KPIs",
        steps: [
          "Navigate to /cfo",
          "Verify KPI cards render (revenue, costs, profit)",
          "Check project financial summaries",
          "Verify drill-down links work",
        ],
        expected: "CFO dashboard displays accurate KPIs with working drill-down navigation",
      },
      {
        id: "fin-wip",
        title: "WIP Report",
        steps: [
          "Navigate to /wip-report",
          "Verify project list with contract values, costs, and completion %",
          "Check over/under billing calculations",
          "Export WIP data",
        ],
        expected: "WIP report shows correct over/under billing for all active projects",
      },
      {
        id: "fin-progress-billing",
        title: "Progress Billing",
        steps: [
          "Navigate to /progress-billing",
          "Create a billing application for a project",
          "Set completion percentages per line item",
          "Generate billing summary",
        ],
        expected: "Progress billing application created with correct calculations",
      },
      {
        id: "fin-sub-payables",
        title: "Subcontractor Payables",
        steps: [
          "Navigate to /subcontracts",
          "View subcontractor pay applications",
          "Approve or reject pay applications",
          "Verify amounts flow to project financials",
        ],
        expected: "Subcontractor payables tracked and reflected in project financials",
      },
      {
        id: "fin-cost-budget",
        title: "Cost Code Budget vs Actual",
        steps: [
          "Open project detail > Financials tab",
          "View cost code breakdown",
          "Compare budgeted vs actual costs",
          "Check variance indicators",
        ],
        expected: "Cost codes show accurate budget vs actual with variance highlighting",
      },
    ],
  },
  {
    id: "company-settings",
    title: "Company Settings",
    icon: Settings,
    scenarios: [
      {
        id: "cs-users-roles",
        title: "Users & Roles",
        steps: [
          "Navigate to /company-settings?tab=users",
          "View user list",
          "Invite a new user",
          "Change a user's role",
          "Deactivate a user",
        ],
        expected: "Users manageable: invite, role change, and deactivation work correctly",
      },
      {
        id: "cs-cost-codes",
        title: "Cost Codes",
        steps: [
          "Navigate to /company-settings?tab=cost-codes",
          "View existing cost codes",
          "Add a new cost code with category",
          "Edit an existing cost code",
        ],
        expected: "Cost codes CRUD operations work; codes available in other modules",
      },
      {
        id: "cs-labor-rates",
        title: "Labor Rates",
        steps: [
          "Navigate to /cost-rates",
          "View labor rate configuration",
          "Update regular and overtime rates",
          "Set burden multiplier",
        ],
        expected: "Labor rates configured and applied to payroll calculations",
      },
      {
        id: "cs-theme",
        title: "Organization Theme",
        steps: [
          "Open company settings",
          "Update organization logo and colors",
          "Save theme settings",
          "Verify branding applied across the app",
        ],
        expected: "Organization branding reflected in app header and client-facing pages",
      },
      {
        id: "cs-notifications",
        title: "Notification Preferences",
        steps: [
          "Open notification settings",
          "Toggle email notifications on/off",
          "Configure push notification preferences",
          "Save and verify settings persist",
        ],
        expected: "Notification preferences saved and respected",
      },
    ],
  },
  {
    id: "client-portal",
    title: "Client Portal",
    icon: ExternalLink,
    scenarios: [
      {
        id: "cp-view",
        title: "External Portal View",
        steps: [
          "Navigate to /portal/:projectId",
          "Verify project overview displays",
          "Check that sensitive internal data is hidden",
          "Verify public-facing styling",
        ],
        expected: "Client portal shows project progress without exposing internal data",
      },
      {
        id: "cp-photos",
        title: "Photo Gallery",
        steps: [
          "Open client portal for a project",
          "Navigate to photos section",
          "Verify project photos display",
          "Check photo categorization",
        ],
        expected: "Client can view published project photos in gallery format",
      },
      {
        id: "cp-co-approval",
        title: "Change Order Approval (Client Side)",
        steps: [
          "Open client portal for a project with pending COs",
          "View change order details",
          "Approve or reject from client perspective",
          "Verify status update flows back to project",
        ],
        expected: "Client can review and respond to change orders from the portal",
      },
    ],
  },
  {
    id: "vendor-portal",
    title: "Vendor Portal",
    icon: Store,
    scenarios: [
      {
        id: "vp-dashboard",
        title: "Vendor Dashboard",
        steps: [
          "Log in as a VENDOR role user",
          "Navigate to /vendor",
          "Verify vendor-specific dashboard renders",
          "Check available navigation items",
        ],
        expected: "Vendor sees their dashboard with relevant metrics and actions",
      },
      {
        id: "vp-rfq",
        title: "RFQ Response",
        steps: [
          "Open an RFQ via /rfq-response/:token",
          "Review the request details",
          "Submit a quote response with pricing",
          "Verify confirmation message",
        ],
        expected: "Vendor can view RFQ details and submit a quote response",
      },
      {
        id: "vp-documents",
        title: "Document Sharing",
        steps: [
          "Log in as vendor",
          "Navigate to /vendor/documents",
          "View shared documents",
          "Upload a document",
        ],
        expected: "Vendor can access shared documents and upload their own",
      },
    ],
  },
  {
    id: "website-builder",
    title: "Website Builder",
    icon: Globe,
    scenarios: [
      {
        id: "wb-create-page",
        title: "Create / Edit Pages",
        steps: [
          "Navigate to /company-settings?tab=website",
          "Create a new page or edit existing",
          "Add content blocks and text",
          "Save changes",
        ],
        expected: "Pages created/edited and changes saved",
      },
      {
        id: "wb-seo",
        title: "SEO Settings",
        steps: [
          "Open website builder settings",
          "Set page titles, meta descriptions",
          "Configure Open Graph tags",
          "Save SEO settings",
        ],
        expected: "SEO metadata configured and applied to public pages",
      },
      {
        id: "wb-publish",
        title: "Publish / Preview",
        steps: [
          "Open website builder",
          "Click Preview to see staging version",
          "Verify staging page renders at /site/:subdomain/staging",
          "Publish the site",
          "Verify live page at /site/:subdomain",
        ],
        expected: "Staging preview available; publishing makes site live",
      },
    ],
  },
  {
    id: "ai-features",
    title: "AI Features",
    icon: Brain,
    scenarios: [
      {
        id: "ai-pm-dashboard",
        title: "AI PM Dashboard",
        steps: [
          "Navigate to /ai-pm",
          "Verify AI insights cards render",
          "Check project health indicators",
          "Review AI-generated recommendations",
        ],
        expected: "AI PM dashboard displays insights and actionable recommendations",
      },
      {
        id: "ai-insights-widget",
        title: "AI Insights Widget",
        steps: [
          "Check dashboard for AI insights widget",
          "Verify insights are relevant to current projects",
          "Click through to detailed view",
        ],
        expected: "AI insights widget shows relevant project insights",
      },
      {
        id: "ai-document-analysis",
        title: "Document Analysis",
        steps: [
          "Navigate to /ai-document-analysis",
          "Upload a document for analysis",
          "Wait for AI processing",
          "Review analysis results",
        ],
        expected: "AI analyzes document and provides structured results",
      },
      {
        id: "ai-bid-analysis",
        title: "Bid Analysis",
        steps: [
          "Navigate to /ai-document-analysis?mode=bid",
          "Upload bid documents",
          "Review AI analysis of bid competitiveness",
          "Check risk assessments",
        ],
        expected: "AI provides bid analysis with risk assessments and recommendations",
      },
    ],
  },
  {
    id: "approvals",
    title: "Approvals",
    icon: CheckSquare,
    scenarios: [
      {
        id: "appr-queue",
        title: "Approval Queue",
        steps: [
          "Navigate to /approvals",
          "View pending approval items",
          "Filter by type (COs, time entries, pay runs, etc.)",
          "Verify items from multiple modules appear",
        ],
        expected: "Approval queue shows all pending items across modules",
      },
      {
        id: "appr-actions",
        title: "Approve / Reject Actions",
        steps: [
          "Open an item in the approval queue",
          "Review details",
          "Approve the item",
          "Test rejection with notes",
          "Verify status updates in source module",
        ],
        expected: "Approvals and rejections flow back to originating modules",
      },
      {
        id: "appr-notifications",
        title: "Notification Delivery",
        steps: [
          "Submit an item for approval",
          "Check that approver receives notification",
          "Approve and verify submitter is notified",
        ],
        expected: "Notifications delivered to relevant parties on approval workflow events",
      },
    ],
  },
  {
    id: "reports",
    title: "Reports",
    icon: FileText,
    scenarios: [
      {
        id: "rep-generate",
        title: "Generate Reports",
        steps: [
          "Navigate to /reports",
          "Select a report type",
          "Set date range and filters",
          "Generate the report",
          "Verify data displays correctly",
        ],
        expected: "Report generated with accurate data matching filters",
      },
      {
        id: "rep-accuracy",
        title: "Verify Data Accuracy",
        steps: [
          "Generate a project financial report",
          "Cross-reference totals with project detail financials",
          "Check that all line items are included",
          "Verify calculations match",
        ],
        expected: "Report data matches source data with no discrepancies",
      },
      {
        id: "rep-export",
        title: "Export Functionality",
        steps: [
          "Generate any report",
          "Click export/download button",
          "Verify file downloads",
          "Check exported data formatting and completeness",
        ],
        expected: "Report exports cleanly with all data intact",
      },
    ],
  },
  {
    id: "platform-admin",
    title: "Platform Admin",
    icon: Shield,
    scenarios: [
      {
        id: "pa-org-management",
        title: "Organization Management",
        steps: [
          "Log in as SUPER_ADMIN",
          "Navigate to /admin/organizations",
          "View organization list",
          "Open an organization detail",
          "Edit organization settings",
        ],
        expected: "Super admin can view and manage all organizations",
      },
      {
        id: "pa-subscriptions",
        title: "Subscription Management",
        steps: [
          "Navigate to /admin/subscriptions",
          "View subscription plans and status",
          "Modify an organization's subscription",
          "Verify changes reflected in organization",
        ],
        expected: "Subscriptions viewable and manageable by platform admin",
      },
      {
        id: "pa-audit-logs",
        title: "Audit Logs",
        steps: [
          "Navigate to /admin/audit or /audit-logs",
          "View recent audit entries",
          "Filter by user, action, or date range",
          "Verify critical actions are logged",
        ],
        expected: "Audit logs capture all critical actions with filtering support",
      },
      {
        id: "pa-monitoring",
        title: "Platform Monitoring",
        steps: [
          "Navigate to /admin/monitoring",
          "View system health metrics",
          "Check for active alerts",
          "Review performance dashboards",
        ],
        expected: "Monitoring dashboard shows system health and performance metrics",
      },
    ],
  },
];

function loadState(): Record<string, TestStatus> {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) return JSON.parse(stored);
  } catch {}
  return {};
}

function saveState(state: Record<string, TestStatus>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {}
}

export default function TestFlowPage() {
  const [statuses, setStatuses] = useState<Record<string, TestStatus>>(loadState);
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());
  const [searchTerm, setSearchTerm] = useState("");

  useEffect(() => {
    saveState(statuses);
  }, [statuses]);

  const toggleStatus = (id: string) => {
    setStatuses((prev) => {
      const current = prev[id] || "untested";
      const next: TestStatus =
        current === "untested" ? "pass" : current === "pass" ? "fail" : "untested";
      return { ...prev, [id]: next };
    });
  };

  const toggleSection = (sectionId: string) => {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(sectionId)) {
        next.delete(sectionId);
      } else {
        next.add(sectionId);
      }
      return next;
    });
  };

  const expandAll = () => {
    setExpandedSections(new Set(TEST_SECTIONS.map((s) => s.id)));
  };

  const collapseAll = () => {
    setExpandedSections(new Set());
  };

  const resetAll = () => {
    setStatuses({});
    localStorage.removeItem(STORAGE_KEY);
  };

  const filteredSections = useMemo(() => {
    if (!searchTerm.trim()) return TEST_SECTIONS;
    const term = searchTerm.toLowerCase();
    return TEST_SECTIONS.map((section) => ({
      ...section,
      scenarios: section.scenarios.filter(
        (s) =>
          s.title.toLowerCase().includes(term) ||
          s.steps.some((step) => step.toLowerCase().includes(term)) ||
          s.expected.toLowerCase().includes(term) ||
          section.title.toLowerCase().includes(term)
      ),
    })).filter((s) => s.scenarios.length > 0);
  }, [searchTerm]);

  const totalScenarios = TEST_SECTIONS.reduce((sum, s) => sum + s.scenarios.length, 0);
  const passCount = Object.values(statuses).filter((s) => s === "pass").length;
  const failCount = Object.values(statuses).filter((s) => s === "fail").length;
  const untestedCount = totalScenarios - passCount - failCount;
  const progressPercent = totalScenarios > 0 ? Math.round(((passCount + failCount) / totalScenarios) * 100) : 0;

  return (
    <div className="min-h-screen bg-background">
      <main className="mx-auto max-w-5xl px-4 sm:px-6 py-6 sm:py-8 space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-foreground flex items-center gap-2" data-testid="text-page-title">
              <ClipboardList className="w-6 h-6" />
              End-to-End Test Flow
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Manual walkthrough checklist for verifying all platform functionality
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Button variant="outline" size="sm" onClick={expandAll} data-testid="button-expand-all">
              Expand All
            </Button>
            <Button variant="outline" size="sm" onClick={collapseAll} data-testid="button-collapse-all">
              Collapse All
            </Button>
            <Button variant="outline" size="sm" onClick={resetAll} data-testid="button-reset-all">
              <RotateCcw className="w-4 h-4 mr-1" />
              Reset
            </Button>
          </div>
        </div>

        <Card data-testid="card-progress-summary">
          <CardContent className="pt-6 space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium" data-testid="text-progress-label">
                Progress: {progressPercent}% ({passCount + failCount} / {totalScenarios} tested)
              </span>
              <div className="flex items-center gap-4 text-sm">
                <span className="flex items-center gap-1 text-green-600 dark:text-green-400" data-testid="text-pass-count">
                  <CheckCircle2 className="w-4 h-4" /> {passCount} Pass
                </span>
                <span className="flex items-center gap-1 text-red-600 dark:text-red-400" data-testid="text-fail-count">
                  <XCircle className="w-4 h-4" /> {failCount} Fail
                </span>
                <span className="text-muted-foreground" data-testid="text-untested-count">
                  {untestedCount} Untested
                </span>
              </div>
            </div>
            <Progress value={progressPercent} className="h-3" data-testid="progress-bar" />
          </CardContent>
        </Card>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search test scenarios..."
            className="pl-9"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            data-testid="input-search"
          />
        </div>

        <div className="space-y-4">
          {filteredSections.map((section) => {
            const SectionIcon = section.icon;
            const sectionPassCount = section.scenarios.filter(
              (s) => statuses[s.id] === "pass"
            ).length;
            const sectionFailCount = section.scenarios.filter(
              (s) => statuses[s.id] === "fail"
            ).length;
            const sectionTotal = section.scenarios.length;
            const sectionTested = sectionPassCount + sectionFailCount;
            const isExpanded = expandedSections.has(section.id);

            return (
              <Collapsible
                key={section.id}
                open={isExpanded}
                onOpenChange={() => toggleSection(section.id)}
              >
                <Card data-testid={`section-${section.id}`}>
                  <CollapsibleTrigger asChild>
                    <CardHeader className="cursor-pointer hover:bg-muted/50 transition-colors">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          {isExpanded ? (
                            <ChevronDown className="w-5 h-5 text-muted-foreground" />
                          ) : (
                            <ChevronRight className="w-5 h-5 text-muted-foreground" />
                          )}
                          <SectionIcon className="w-5 h-5 text-primary" />
                          <CardTitle className="text-lg" data-testid={`text-section-title-${section.id}`}>
                            {section.title}
                          </CardTitle>
                        </div>
                        <div className="flex items-center gap-2">
                          {sectionPassCount > 0 && (
                            <Badge variant="secondary" className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">
                              {sectionPassCount} pass
                            </Badge>
                          )}
                          {sectionFailCount > 0 && (
                            <Badge variant="secondary" className="bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200">
                              {sectionFailCount} fail
                            </Badge>
                          )}
                          <Badge variant="outline">
                            {sectionTested}/{sectionTotal}
                          </Badge>
                        </div>
                      </div>
                    </CardHeader>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <CardContent className="pt-0 space-y-3">
                      {section.scenarios.map((scenario) => {
                        const status = statuses[scenario.id] || "untested";
                        return (
                          <div
                            key={scenario.id}
                            className={`border rounded-lg p-4 transition-colors ${
                              status === "pass"
                                ? "border-green-200 bg-green-50/50 dark:border-green-800 dark:bg-green-950/30"
                                : status === "fail"
                                  ? "border-red-200 bg-red-50/50 dark:border-red-800 dark:bg-red-950/30"
                                  : "border-border"
                            }`}
                            data-testid={`scenario-${scenario.id}`}
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 mb-2">
                                  <h4 className="font-medium text-sm" data-testid={`text-scenario-title-${scenario.id}`}>
                                    {scenario.title}
                                  </h4>
                                  {status !== "untested" && (
                                    <Badge
                                      variant="secondary"
                                      className={
                                        status === "pass"
                                          ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200"
                                          : "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200"
                                      }
                                    >
                                      {status === "pass" ? "Pass" : "Fail"}
                                    </Badge>
                                  )}
                                </div>

                                <div className="mb-2">
                                  <p className="text-xs font-medium text-muted-foreground mb-1">Steps:</p>
                                  <ol className="list-decimal list-inside text-sm text-muted-foreground space-y-0.5 ml-1">
                                    {scenario.steps.map((step, i) => (
                                      <li key={i}>{step}</li>
                                    ))}
                                  </ol>
                                </div>

                                <div>
                                  <p className="text-xs font-medium text-muted-foreground mb-0.5">Expected:</p>
                                  <p className="text-sm text-foreground">{scenario.expected}</p>
                                </div>
                              </div>

                              <Button
                                variant={
                                  status === "pass"
                                    ? "default"
                                    : status === "fail"
                                      ? "destructive"
                                      : "outline"
                                }
                                size="sm"
                                className="shrink-0"
                                onClick={() => toggleStatus(scenario.id)}
                                data-testid={`button-toggle-${scenario.id}`}
                              >
                                {status === "untested" && "Mark"}
                                {status === "pass" && (
                                  <>
                                    <CheckCircle2 className="w-4 h-4 mr-1" /> Pass
                                  </>
                                )}
                                {status === "fail" && (
                                  <>
                                    <XCircle className="w-4 h-4 mr-1" /> Fail
                                  </>
                                )}
                              </Button>
                            </div>
                          </div>
                        );
                      })}
                    </CardContent>
                  </CollapsibleContent>
                </Card>
              </Collapsible>
            );
          })}
        </div>

        {filteredSections.length === 0 && (
          <div className="text-center py-12 text-muted-foreground" data-testid="text-no-results">
            No test scenarios match your search.
          </div>
        )}
      </main>
    </div>
  );
}
