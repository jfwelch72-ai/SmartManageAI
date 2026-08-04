/**
 * ContextualHelpPanel
 *
 * A slide-out panel that shows the current user's role and the 3–5 key
 * workflows relevant to the page they are on, sourced from
 * docs/user-role-business-flows.md.
 *
 * Opens via the "?" button in the TopHeader.
 * Remembers dismissal state in localStorage per user.
 */

import { useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { ROLE_DISPLAY_NAMES } from "@/lib/rbac";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  ArrowRight,
  HelpCircle,
  BookOpen,
  ChevronRight,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Workflow {
  title: string;
  steps: string[];
}

interface HelpContent {
  pageTitle: string;
  description: string;
  workflows: Workflow[];
  tip?: string;
}

// ---------------------------------------------------------------------------
// Route matcher helper
// ---------------------------------------------------------------------------

function matchRoute(location: string, pattern: string): boolean {
  if (pattern === location) return true;
  if (pattern.endsWith("*") && location.startsWith(pattern.slice(0, -1))) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Role-and-route content map
// Key: route pattern  →  Value: map of role → HelpContent
// ---------------------------------------------------------------------------

const HELP_CONTENT: Record<string, Partial<Record<string, HelpContent>>> = {
  "/dashboard": {
    ADMIN: {
      pageTitle: "Dashboard",
      description: "Your org-level command center.",
      workflows: [
        { title: "Review KPIs", steps: ["Check active project health", "Review revenue pipeline", "Monitor crew utilization"] },
        { title: "Onboard a new team member", steps: ["Go to Administration → Users", "Click Invite User", "Select role and send invite"] },
        { title: "Start the bid-to-invoice cycle", steps: ["Create or review bids in Win Work", "Convert won bid to Project", "Track billing in Finance"] },
      ],
      tip: "Pin the Dashboard to My Day for faster access.",
    },
    HUSTLER: {
      pageTitle: "Dashboard",
      description: "Manage your portfolio across all linked organizations.",
      workflows: [
        { title: "Switch organizations", steps: ["Click Portfolio (⚡ icon)", "Select the target org", "App reloads in that org's context"] },
        { title: "Compare org performance", steps: ["Open Portfolio → Analytics", "Review bid win rate, margins, safety"] },
        { title: "Run the bid-to-invoice cycle", steps: ["Same as Admin within each org"] },
      ],
    },
    MANAGER: {
      pageTitle: "Dashboard",
      description: "Track your active projects and team.",
      workflows: [
        { title: "Review project pipeline", steps: ["Check Projects for status updates", "Review open change orders", "Check pending time approvals"] },
        { title: "Manage today's schedule", steps: ["Open Dispatch Board for crew assignments", "Review calendar for milestones"] },
      ],
    },
    ESTIMATOR: {
      pageTitle: "Dashboard",
      description: "Your pre-construction workspace.",
      workflows: [
        { title: "Check active bids", steps: ["Navigate to Win Work → Bids", "Review upcoming bid deadlines", "Open any bid to continue work"] },
        { title: "Review won projects", steps: ["Navigate to Projects", "Confirm handoff to operations team"] },
      ],
    },
    SUPERINTENDENT: {
      pageTitle: "Dashboard",
      description: "Your field management hub.",
      workflows: [
        { title: "Start your day", steps: ["Check My Day for today's tasks", "Review Dispatch Board for crew assignments", "Check open Approvals"] },
        { title: "Review project status", steps: ["Open Projects to see active sites", "Check any corrective actions in Inspector Reports"] },
      ],
    },
    FIELD_WORKER: {
      pageTitle: "Dashboard",
      description: "Your daily workspace.",
      workflows: [
        { title: "Clock in", steps: ["Go to My Day or Time Clock", "Tap Clock In", "Select project and cost code"] },
        { title: "View your tasks", steps: ["Navigate to My Work", "Open tasks assigned to you", "Log progress or mark complete"] },
      ],
    },
    VENDOR: {
      pageTitle: "Vendor Dashboard",
      description: "Overview of your enrolled clients and activity.",
      workflows: [
        { title: "View enrolled clients", steps: ["Navigate to Clients", "Review each contractor org's details"] },
        { title: "Check bid invitations", steps: ["Go to Bid Inbox", "Review open invitations and due dates"] },
      ],
    },
    SUPER_ADMIN: {
      pageTitle: "Platform Dashboard",
      description: "Platform-level monitoring and management.",
      workflows: [
        { title: "Check platform health", steps: ["Navigate to Admin → Status", "Review uptime probes and alerts"] },
        { title: "Investigate a support issue", steps: ["Admin → Tools → select relevant tool", "Use Audit Logs to trace actions"] },
      ],
    },
  },

  "/my-day": {
    FIELD_WORKER: {
      pageTitle: "My Day",
      description: "Everything you need for today's shift.",
      workflows: [
        { title: "Clock in for your shift", steps: ["Tap Clock In", "Select your project and cost code", "System logs timestamp and location"] },
        { title: "Log a daily note", steps: ["Select your active project", "Tap Add Note", "Describe work, attach photos, submit"] },
        { title: "Clock out at end of day", steps: ["Return to Time Clock", "Tap Clock Out", "Confirm hours and cost code"] },
      ],
    },
    SUPERINTENDENT: {
      pageTitle: "My Day",
      description: "Your daily field operations view.",
      workflows: [
        { title: "Start the day", steps: ["Review today's tasks and crew assignments", "Check open approvals", "Review any corrective actions"] },
        { title: "Log daily report", steps: ["Go to the project → Daily Notes", "Log weather, crew count, work performed", "Attach photos and lock the report"] },
      ],
    },
    ADMIN: {
      pageTitle: "My Day",
      description: "Your daily org overview.",
      workflows: [
        { title: "Review priorities", steps: ["Check tasks assigned to you", "Review pending approvals", "Check notifications"] },
        { title: "Quick-access bids and projects", steps: ["Use the quick-action links to jump to active work"] },
      ],
    },
    MANAGER: {
      pageTitle: "My Day",
      description: "Your daily project management view.",
      workflows: [
        { title: "Review pending approvals", steps: ["Check time entries awaiting approval", "Review change orders pending sign-off"] },
        { title: "Track today's milestones", steps: ["Open Calendar for scheduled events", "Check Dispatch Board for crew status"] },
      ],
    },
  },

  "/my-work": {
    FIELD_WORKER: {
      pageTitle: "My Work",
      description: "Tasks assigned to you.",
      workflows: [
        { title: "Complete a task", steps: ["Open the task from your queue", "Review description and attachments", "Log progress or mark complete"] },
        { title: "Submit a safety observation", steps: ["Go to Safety → Inspector Reports", "Describe the hazard, attach a photo", "Submit for Superintendent review"] },
      ],
    },
    SUPERINTENDENT: {
      pageTitle: "My Work",
      description: "Your assigned tasks and approvals.",
      workflows: [
        { title: "Review pending tasks", steps: ["Check overdue and today's tasks", "Prioritize by project and deadline"] },
        { title: "Approve time entries", steps: ["Go to Workforce → Time Clock → Approvals", "Verify entries against daily reports", "Approve or reject each entry"] },
      ],
    },
  },

  "/bids": {
    ADMIN: {
      pageTitle: "Bids",
      description: "Manage your organization's bid pipeline.",
      workflows: [
        { title: "Review and approve a bid", steps: ["Open a bid in review status", "Check scope, costs, and markup", "Approve or request changes from Estimator"] },
        { title: "Convert a won bid to project", steps: ["Open the won bid", "Click Convert to Project", "Assign Superintendent and Manager"] },
        { title: "Delete a bid", steps: ["Open the bid", "Click the Actions menu → Delete", "Confirm deletion"] },
      ],
    },
    MANAGER: {
      pageTitle: "Bids",
      description: "Review and manage bids.",
      workflows: [
        { title: "Review a bid", steps: ["Open any bid to see full scope and costs", "Check AI analysis findings", "Coordinate with Estimator on any gaps"] },
        { title: "Convert bid to project", steps: ["Open a won bid → Convert to Project", "Set contract type and assign team"] },
      ],
    },
    ESTIMATOR: {
      pageTitle: "Bids",
      description: "Your pre-construction estimating workspace.",
      workflows: [
        { title: "Create a new bid", steps: ["Click New Bid", "Enter project name, client, bid date, and type", "Add scope line items using the Cost Book"] },
        { title: "Build a takeoff from plans", steps: ["Open bid → Takeoff tab → Upload Plan Set", "Calibrate scale, then measure areas/lengths/counts", "Measurements auto-populate bid quantities"] },
        { title: "Run AI Bid Analysis", steps: ["Open bid → AI Analysis tab", "Upload RFP/scope document → Analyze", "Review and accept/reject AI suggestions"] },
        { title: "Submit to Bid Network", steps: ["Open bid → Bid Network → Invite Subs", "Select trade packages, search marketplace for subs", "Send invitations with scope and due date"] },
      ],
      tip: "Use AI Detect Links on the Takeoff tab to catch measurements spanning multiple sheets.",
    },
    SUPERINTENDENT: {
      pageTitle: "Bids",
      description: "View bids for your projects.",
      workflows: [
        { title: "View a bid", steps: ["Open any bid to review scope", "Check quantities and cost breakdown", "Note: you cannot edit bids in this role"] },
      ],
    },
  },

  "/bids/*": {
    ESTIMATOR: {
      pageTitle: "Bid Detail",
      description: "Build and refine your estimate.",
      workflows: [
        { title: "Add scope line items", steps: ["Use the Cost Book to find items", "Set labor, material, equipment costs", "Apply markup via the configured rate"] },
        { title: "Run takeoff measurements", steps: ["Go to the Takeoff tab", "Upload plan pages and calibrate scale", "Measure and auto-populate quantities"] },
        { title: "Analyze with AI", steps: ["Go to AI Analysis tab", "Upload the RFP document", "Review scope gaps and risk items flagged by AI"] },
      ],
    },
    ADMIN: {
      pageTitle: "Bid Detail",
      description: "Review and manage this bid.",
      workflows: [
        { title: "Review bid details", steps: ["Check scope, costs, markup, and total", "Review AI analysis findings", "Approve or send back for revision"] },
        { title: "Convert to project", steps: ["Click Convert to Project when bid is won", "Set contract type, assign team, confirm budget"] },
      ],
    },
  },

  "/takeoff": {
    ESTIMATOR: {
      pageTitle: "Takeoff",
      description: "Measure plan sets to generate quantities.",
      workflows: [
        { title: "Open a takeoff workspace", steps: ["Select a bid from the list", "Click the takeoff icon to enter the workspace"] },
        { title: "Calibrate and measure", steps: ["Upload plan pages", "Calibrate scale with two reference points", "Use linear, area, or count tools to measure"] },
        { title: "Sync to bid", steps: ["Measurements auto-populate bid line item quantities", "Use AI Detect Links to catch cross-sheet references"] },
      ],
    },
  },

  "/projects": {
    ADMIN: {
      pageTitle: "Projects",
      description: "All your organization's projects.",
      workflows: [
        { title: "Create a new project", steps: ["Click New Project (or convert from a bid)", "Enter name, client, dates, and contract type", "Assign Superintendent and Manager"] },
        { title: "Monitor project health", steps: ["Check project status indicators", "Open a project to review budget vs. actual", "Review open change orders"] },
        { title: "Close out a project", steps: ["Confirm all billing is issued", "Lock daily reports and review KPIs", "Set status to Complete"] },
      ],
    },
    MANAGER: {
      pageTitle: "Projects",
      description: "Your project portfolio.",
      workflows: [
        { title: "Create a new project", steps: ["Click New Project or convert a won bid", "Set schedule baseline in the Gantt view", "Upload contract documents"] },
        { title: "Manage the schedule", steps: ["Open project → Schedule tab", "Add tasks, assign crew, track % complete"] },
        { title: "Process a change order", steps: ["Open project → Change Orders → New", "Describe scope change, attach docs", "Submit for approval"] },
      ],
    },
    ESTIMATOR: {
      pageTitle: "Projects",
      description: "View projects to reference historical data.",
      workflows: [
        { title: "View a project", steps: ["Open any project to see scope and costs", "Reference for estimating similar work"] },
        { title: "Convert bid to project", steps: ["From a won bid, click Convert to Project", "Assign team and confirm contract value"] },
      ],
    },
    SUPERINTENDENT: {
      pageTitle: "Projects",
      description: "Your active project sites.",
      workflows: [
        { title: "Manage daily operations", steps: ["Open your assigned project", "Log daily report and crew headcount", "Approve time entries"] },
        { title: "Submit a change order", steps: ["Open project → Change Orders → New", "Document field condition with photos", "Submit to Manager/Admin for pricing"] },
      ],
    },
    FIELD_WORKER: {
      pageTitle: "Projects",
      description: "Your active project sites.",
      workflows: [
        { title: "View your active project", steps: ["Open the project you are assigned to", "Check tasks, daily notes, and schedule"] },
      ],
      tip: "You only see active projects. Bid-stage and closed projects are not shown.",
    },
  },

  "/time-clock": {
    FIELD_WORKER: {
      pageTitle: "Time Clock",
      description: "Clock in and out for your shifts.",
      workflows: [
        { title: "Clock in", steps: ["Tap Clock In", "Select project and cost code", "System logs timestamp"] },
        { title: "Clock out", steps: ["Tap Clock Out", "Confirm hours and break time", "Entry goes to Superintendent for approval"] },
      ],
    },
    SUPERINTENDENT: {
      pageTitle: "Time Clock",
      description: "Manage and approve crew time entries.",
      workflows: [
        { title: "Approve time entries", steps: ["Click the Approvals tab", "Review entries grouped by employee and day", "Approve, reject, or edit entries"] },
        { title: "Lock a pay period", steps: ["Ensure all entries for the period are approved", "Click Lock Period to hand off to payroll"] },
      ],
    },
    MANAGER: {
      pageTitle: "Time Clock",
      description: "Manage crew time and payroll.",
      workflows: [
        { title: "Approve time entries", steps: ["Open Approvals tab", "Verify entries against daily reports and tasks", "Approve or reject"] },
        { title: "Lock and run payroll", steps: ["Lock the approved pay period", "Go to Workforce → Payroll to process"] },
      ],
    },
  },

  "/crews": {
    SUPERINTENDENT: {
      pageTitle: "Crews",
      description: "Manage your crew compositions.",
      workflows: [
        { title: "View and update crews", steps: ["Open a crew to see members and assignments", "Add or remove members as needed"] },
        { title: "Assign to dispatch", steps: ["Use Dispatch Board to assign crew to tasks"] },
      ],
    },
    ADMIN: {
      pageTitle: "Crews",
      description: "Manage organization crews.",
      workflows: [
        { title: "Create a crew", steps: ["Click New Crew", "Name the crew and add members", "Set the default foreman"] },
        { title: "Assign crew to projects", steps: ["Use Dispatch Board for scheduling"] },
      ],
    },
  },

  "/bid-inbox": {
    VENDOR: {
      pageTitle: "Bid Inbox",
      description: "Receive and respond to bid invitations from GCs.",
      workflows: [
        { title: "Respond to a bid invitation", steps: ["Open a new invitation", "Review scope documents and drawings", "Enter your sub-bid amount and exclusions", "Submit before the due date"] },
        { title: "Track response status", steps: ["Check each invitation's status: submitted, under review, awarded, declined"] },
      ],
    },
    ESTIMATOR: {
      pageTitle: "Bid Network Inbox",
      description: "Track subcontractor responses to your invitations.",
      workflows: [
        { title: "Review sub responses", steps: ["Open a bid invitation thread", "Compare vendor pricing responses", "Select the preferred vendor"] },
      ],
    },
  },

  "/compliance": {
    ADMIN: {
      pageTitle: "Compliance Dashboard",
      description: "Track contractor and vendor compliance.",
      workflows: [
        { title: "Review compliance status", steps: ["Check traffic-light statuses for all items", "Click expired items to upload renewals"] },
        { title: "Manage DBE goals", steps: ["Navigate to DBE Goals for minority sub targets", "Track awards against commitments"] },
      ],
    },
    SUPERINTENDENT: {
      pageTitle: "Compliance Dashboard",
      description: "Monitor field compliance.",
      workflows: [
        { title: "Review compliance items", steps: ["Check expiring certifications", "Upload renewal documents as needed"] },
      ],
    },
  },

  "/haul-tickets": {
    SUPERINTENDENT: {
      pageTitle: "Haul Tickets",
      description: "Track earthwork and material hauls.",
      workflows: [
        { title: "Create a haul ticket", steps: ["Click New Haul Ticket", "Enter source station, destination, material type, truck ID, quantity", "Capture driver signature", "Submit for approval"] },
        { title: "View haul summary", steps: ["Check the mass-haul curve for earthwork tracking"] },
      ],
    },
  },

  "/daily-inspector-reports": {
    SUPERINTENDENT: {
      pageTitle: "Inspector Reports",
      description: "Manage field inspection records.",
      workflows: [
        { title: "Create an inspector report", steps: ["Click New Report", "Select inspection type", "Log checklist items, pass/fail, observations", "Add photos and corrective action notes", "Submit for review"] },
        { title: "Track corrective actions", steps: ["Check open corrective actions until closed"] },
      ],
    },
    FIELD_WORKER: {
      pageTitle: "Inspector Reports",
      description: "Submit safety observations.",
      workflows: [
        { title: "Submit a safety observation", steps: ["Click Submit Observation", "Describe the hazard or condition", "Attach a photo", "Submit — routed to Superintendent"] },
      ],
    },
  },

  "/messages": {
    default: {
      pageTitle: "Messages",
      description: "Communicate with your team.",
      workflows: [
        { title: "Send a message", steps: ["Select or create a conversation", "Type your message and attach files if needed", "Press Send"] },
        { title: "Start a video call", steps: ["Open a conversation", "Click the video icon to start a call"] },
      ],
    },
  },

  "/cfo-dashboard": {
    ADMIN: {
      pageTitle: "CFO Dashboard",
      description: "Financial overview of your organization.",
      workflows: [
        { title: "Review financials", steps: ["Check revenue, costs, and margin by project", "Review cash flow and AR aging"] },
        { title: "Analyze overhead", steps: ["Navigate to Finance → Overhead Costs", "Review indirect cost allocations"] },
      ],
    },
    MANAGER: {
      pageTitle: "CFO Dashboard",
      description: "Project financial health.",
      workflows: [
        { title: "Check project margins", steps: ["Review budget vs. actual for each project", "Identify cost overruns early"] },
      ],
    },
  },

  "/payroll-management": {
    ADMIN: {
      pageTitle: "Payroll",
      description: "Process payroll for your team.",
      workflows: [
        { title: "Run payroll", steps: ["Select the locked pay period", "Review certified payroll report (if prevailing wage)", "Export to payroll provider or generate check run"] },
      ],
    },
    MANAGER: {
      pageTitle: "Payroll",
      description: "Process payroll for your team.",
      workflows: [
        { title: "Run payroll", steps: ["Confirm pay period is locked with all entries approved", "Select pay period and review", "Export to payroll or generate check run"] },
      ],
    },
  },

  "/crm": {
    ADMIN: {
      pageTitle: "CRM",
      description: "Manage your client relationships and pipeline.",
      workflows: [
        { title: "Add a contact or company", steps: ["Click New Contact or New Company", "Enter details and assign to a deal"] },
        { title: "Manage deals", steps: ["Open or create a deal", "Track pipeline stage, value, and close date", "Log activities and notes"] },
      ],
    },
    ESTIMATOR: {
      pageTitle: "CRM",
      description: "View and add contacts.",
      workflows: [
        { title: "Add a contact", steps: ["Click New Contact", "Enter name, company, and contact details"] },
        { title: "View client details", steps: ["Search for a company or contact", "Review history and associated bids"] },
      ],
    },
  },

  "/vendor/pricing": {
    VENDOR: {
      pageTitle: "Vendor Pricing",
      description: "Submit your unit prices to enrolled clients.",
      workflows: [
        { title: "Submit pricing", steps: ["Select the client organization", "Enter unit prices for each pay item or trade", "Attach supporting documentation", "Submit — contractor can now use your pricing in bids"] },
      ],
    },
  },

  "/vendor/documents": {
    VENDOR: {
      pageTitle: "Documents",
      description: "Manage your compliance documents.",
      workflows: [
        { title: "Upload a compliance document", steps: ["Click Upload", "Select document type (insurance, license, W-9, etc.)", "Enter expiration date", "Submit — contractor admin can verify"] },
      ],
      tip: "Set expiration dates accurately — automatic reminders are sent before expiry.",
    },
  },

  "/company-settings": {
    ADMIN: {
      pageTitle: "Company Settings",
      description: "Configure your organization's settings.",
      workflows: [
        { title: "Set up company profile", steps: ["Update name, logo, address, and fiscal settings"] },
        { title: "Manage users", steps: ["Go to the Users tab", "Invite users and assign roles", "Override individual permissions on user profiles"] },
        { title: "Configure AI settings", steps: ["Go to AI Settings tab", "Enter OpenAI key and estimator preferences"] },
      ],
    },
  },

  "/safety-training": {
    ADMIN: {
      pageTitle: "Safety Training",
      description: "Manage safety training programs.",
      workflows: [
        { title: "Create a training module", steps: ["Click New Training", "Add content, videos, and quizzes", "Assign to crew members or all employees"] },
        { title: "Track completion", steps: ["Review completion rates by employee and module", "Send reminders to incomplete trainees"] },
      ],
    },
    FIELD_WORKER: {
      pageTitle: "Safety Training",
      description: "Complete your assigned safety training.",
      workflows: [
        { title: "Complete a training module", steps: ["Open an assigned module", "Watch videos and read materials", "Complete the quiz and mark as done"] },
      ],
    },
  },

  "/admin": {
    SUPER_ADMIN: {
      pageTitle: "Platform Admin",
      description: "Platform-level management for SmartManageAI.",
      workflows: [
        { title: "Onboard a new organization", steps: ["Go to Organizations → Create Organization", "Fill in company name, plan tier, billing", "Create the initial Admin user"] },
        { title: "Manage feature flags", steps: ["Select an org in Organizations", "Open Feature Flags tab", "Toggle platform-level features for that org"] },
        { title: "Monitor platform health", steps: ["Navigate to Status for live uptime", "Review Analytics for platform-wide metrics"] },
      ],
    },
  },
};

// Fallback content when no specific route match
const FALLBACK_CONTENT: Partial<Record<string, HelpContent>> = {
  ADMIN: {
    pageTitle: "This Page",
    description: "As an Admin, you have full access to all organization features.",
    workflows: [
      { title: "Key areas to explore", steps: ["Win Work (Bids, Takeoff, AI Estimator)", "Projects (all statuses)", "Finance (billing, payroll, CFO Dashboard)", "Administration (users, settings, AI)"] },
    ],
  },
  MANAGER: {
    pageTitle: "This Page",
    description: "As a Manager, you run projects from award through closeout.",
    workflows: [
      { title: "Key areas to explore", steps: ["Projects (create, schedule, change orders)", "Workforce (crews, time approvals, payroll)", "Finance (billing, subcontracts)"] },
    ],
  },
  ESTIMATOR: {
    pageTitle: "This Page",
    description: "As an Estimator, you focus on winning work.",
    workflows: [
      { title: "Key areas to explore", steps: ["Win Work → Bids (create estimates)", "Takeoff (measure plan sets)", "AI Estimator & AI Bid Analysis", "Bid Network (request sub pricing)"] },
    ],
  },
  SUPERINTENDENT: {
    pageTitle: "This Page",
    description: "As a Superintendent, you manage field execution.",
    workflows: [
      { title: "Key areas to explore", steps: ["My Day (daily tasks and crew)", "Workforce → Time Clock (approve time)", "Safety & Compliance", "Projects (daily reports, change orders)"] },
    ],
  },
  FIELD_WORKER: {
    pageTitle: "This Page",
    description: "As a Field Worker, your essentials are always a tap away.",
    workflows: [
      { title: "Key areas", steps: ["My Day (clock in/out, daily notes)", "My Work (your tasks)", "Safety (observations, training)", "Time Clock (own entries)"] },
    ],
  },
  VENDOR: {
    pageTitle: "This Page",
    description: "As a Vendor, you operate in the Vendor Portal.",
    workflows: [
      { title: "Vendor Portal areas", steps: ["Bid Inbox (respond to invitations)", "Pricing (submit unit prices)", "Documents (upload compliance docs)", "Compliance (track expiry status)"] },
    ],
  },
  SUPER_ADMIN: {
    pageTitle: "This Page",
    description: "As a Super Admin, you manage the platform.",
    workflows: [
      { title: "Platform areas", steps: ["Organizations (manage tenants)", "Analytics (platform metrics)", "Tools (support & audit)", "Status (health probes)"] },
    ],
  },
  HUSTLER: {
    pageTitle: "This Page",
    description: "As a Hustler, you operate across multiple organizations.",
    workflows: [
      { title: "Key areas", steps: ["Portfolio (cross-org KPIs)", "Switch org context to work within each org", "All Admin-level features within each org"] },
    ],
  },
};

// ---------------------------------------------------------------------------
// Logic to find the best content for the current location + role
// ---------------------------------------------------------------------------

function getHelpContent(location: string, role: string): HelpContent | null {
  // Try exact and wildcard matches
  for (const [pattern, roleMap] of Object.entries(HELP_CONTENT)) {
    if (matchRoute(location, pattern)) {
      const content = roleMap[role] || roleMap["default"];
      if (content) return content;
    }
  }

  // Try prefix match (e.g. /bids/123 → /bids/*)
  for (const [pattern, roleMap] of Object.entries(HELP_CONTENT)) {
    if (pattern.endsWith("/*")) {
      const base = pattern.slice(0, -2);
      if (location.startsWith(base + "/") || location === base) {
        const content = roleMap[role] || roleMap["default"];
        if (content) return content;
      }
    }
  }

  // Fallback to generic role content
  return FALLBACK_CONTENT[role] || null;
}

// ---------------------------------------------------------------------------
// Component props
// ---------------------------------------------------------------------------

interface ContextualHelpPanelProps {
  open: boolean;
  onClose: () => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ContextualHelpPanel({ open, onClose }: ContextualHelpPanelProps) {
  const { user } = useAuth();
  const [location] = useLocation();

  if (!user) return null;

  const role = user.effectiveRole || user.role || "";
  const roleName = user.roleLabel || ROLE_DISPLAY_NAMES[role] || role;
  const content = getHelpContent(location, role);

  return (
    <Sheet open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-md p-0 flex flex-col"
        data-testid="contextual-help-panel"
      >
        {/* Header */}
        <SheetHeader className="px-6 pt-6 pb-4 border-b bg-muted/30">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
              <HelpCircle className="h-5 w-5 text-primary" />
            </div>
            <div>
              <SheetTitle className="text-base font-semibold">What can I do here?</SheetTitle>
              <SheetDescription className="text-xs mt-0.5">
                Role:{" "}
                <Badge variant="secondary" className="text-xs font-medium" data-testid="help-panel-role-badge">
                  {roleName}
                </Badge>
              </SheetDescription>
            </div>
          </div>
        </SheetHeader>

        {/* Body */}
        <ScrollArea className="flex-1 px-6 py-5">
          {content ? (
            <div className="space-y-6">
              {/* Page context */}
              <div>
                <p className="text-sm font-semibold text-foreground">{content.pageTitle}</p>
                <p className="text-sm text-muted-foreground mt-1">{content.description}</p>
              </div>

              <Separator />

              {/* Workflows */}
              <div className="space-y-5">
                {content.workflows.map((workflow, wi) => (
                  <div key={wi} className="space-y-2">
                    <div className="flex items-center gap-2">
                      <ArrowRight className="h-4 w-4 text-primary shrink-0" />
                      <p className="text-sm font-medium">{workflow.title}</p>
                    </div>
                    <ol className="ml-6 space-y-1.5">
                      {workflow.steps.map((step, si) => (
                        <li key={si} className="flex items-start gap-2 text-sm text-muted-foreground">
                          <span className="text-xs font-medium text-primary mt-0.5 shrink-0">
                            {si + 1}.
                          </span>
                          <span>{step}</span>
                        </li>
                      ))}
                    </ol>
                  </div>
                ))}
              </div>

              {/* Optional tip */}
              {content.tip && (
                <>
                  <Separator />
                  <div className="rounded-md bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 px-4 py-3">
                    <p className="text-xs font-medium text-amber-800 dark:text-amber-300">💡 Tip</p>
                    <p className="text-xs text-amber-700 dark:text-amber-400 mt-1">{content.tip}</p>
                  </div>
                </>
              )}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-40 text-center gap-3">
              <BookOpen className="h-8 w-8 text-muted-foreground/50" />
              <p className="text-sm text-muted-foreground">No help content available for this page yet.</p>
            </div>
          )}
        </ScrollArea>

        {/* Footer */}
        <div className="px-6 py-4 border-t bg-muted/20 text-xs text-muted-foreground flex items-center justify-between">
          <span>Role-specific guidance from your playbook</span>
          <ChevronRight className="h-3 w-3" />
        </div>
      </SheetContent>
    </Sheet>
  );
}
