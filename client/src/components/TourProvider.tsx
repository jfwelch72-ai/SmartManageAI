import { createContext, useContext, useState, useCallback, useEffect, useMemo, useRef } from "react";
import Joyride, { CallBackProps, STATUS, EVENTS, ACTIONS, Step } from "react-joyride";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CheckCircle2, Sparkles, ArrowRight } from "lucide-react";

interface TourStep extends Omit<Step, 'target'> {
  target: string;
  path?: string;
  profitabilityTip?: string;
}

interface TourContextType {
  startTour: () => void;
  skipTour: () => void;
  isTourActive: boolean;
  currentStep: number;
  currentTourTarget: string | null;
  // Task #1663 — Plans-surface guided tour. Independent from the
  // role-based dashboard tour above; persisted per user via
  // localStorage so it does not auto-replay once dismissed.
  startPlansTour: () => void;
  skipPlansTour: () => void;
  isPlansTourActive: boolean;
  isPlansTourCompleted: boolean;
  // Task #1696 — Same pattern but for the bid Plans tab. Reuses most
  // of the project plans tour copy with bid-flavored wording on the
  // last step (bids do not host RFI/punch/submittal pin layers, so
  // the pin step is replaced with a takeoff/measurement-import note).
  startBidPlansTour: () => void;
  skipBidPlansTour: () => void;
  isBidPlansTourActive: boolean;
  isBidPlansTourCompleted: boolean;
}

const TourContext = createContext<TourContextType | null>(null);

export function useTour() {
  const context = useContext(TourContext);
  if (!context) {
    throw new Error("useTour must be used within a TourProvider");
  }
  return context;
}

const superAdminTourSteps: TourStep[] = [
  {
    target: '[data-testid="nav-admin-dashboard"]',
    title: "Platform Command Center",
    content: "Your dashboard shows platform health, active organizations, user activity, and anything that needs attention from one central place.",
    profitabilityTip: "Full platform visibility lets you spot and resolve issues before they escalate.",
    path: "/admin",
    disableBeacon: true,
  },
  {
    target: '[data-testid="nav-admin-organizations"]',
    title: "Organization Management",
    content: "See all contractors using the platform. Monitor onboarding progress, activity levels, and jump in to help when needed.",
    profitabilityTip: "Proactive organization support drives adoption and retention.",
    path: "/admin",
    disableBeacon: true,
  },
  {
    target: '[data-testid="nav-admin-analytics"]',
    title: "Platform Analytics",
    content: "Charts, trends, and feature adoption across the platform. See what's popular, what's underused, and overall performance.",
    profitabilityTip: "Data-driven insights help you prioritize improvements that matter most.",
    path: "/admin",
    disableBeacon: true,
  },
  {
    target: '[data-testid="nav-admin-tools"]',
    title: "Support Tools",
    content: "Manage platform-wide settings, update trade templates, handle integrations, and support users who need help.",
    profitabilityTip: "Centralized tools keep platform operations smooth and efficient.",
    path: "/admin",
    disableBeacon: true,
  },
];

const adminTourSteps: TourStep[] = [
  {
    target: '[data-testid="nav-dashboard"]',
    title: "Your Command Center",
    content: "The dashboard gives you a real-time view of your entire operation - active projects, pending bids, crew utilization, and key financial metrics.",
    profitabilityTip: "Quick visibility means faster decisions and less money left on the table.",
    path: "/dashboard",
    disableBeacon: true,
  },
  {
    target: '[data-testid="nav-projects"]',
    title: "Project Management",
    content: "Track every project from start to finish. Monitor progress, manage change orders, and keep all project documents in one place.",
    profitabilityTip: "Organized projects mean fewer delays and cost overruns.",
    path: "/dashboard",
    disableBeacon: true,
  },
  {
    target: '[data-testid="nav-bids"]',
    title: "Bid Pipeline",
    content: "Manage your entire bid process - from initial leads to awarded contracts. Never miss a deadline or opportunity.",
    profitabilityTip: "A structured bid process improves win rates and helps you focus on profitable work.",
    path: "/dashboard",
    disableBeacon: true,
  },
  {
    target: '[data-testid="nav-equipment"]',
    title: "Equipment Tracking",
    content: "Track trucks, tools, and heavy equipment. Assign them to projects, schedule maintenance, and know where everything is.",
    profitabilityTip: "Proper equipment tracking prevents costly downtime and lost assets.",
    path: "/dashboard",
    disableBeacon: true,
  },
  {
    target: '[data-testid="nav-procurement"]',
    title: "Procurement",
    content: "Manage purchase orders, material requests, and vendor quotes. Streamline your procurement process from request to delivery.",
    profitabilityTip: "Centralized procurement reduces waste and gets you better pricing.",
    path: "/dashboard",
    disableBeacon: true,
  },
  {
    target: '[data-testid="nav-my-time-clock"]',
    title: "Time Tracking",
    content: "GPS-verified time clock captures labor hours automatically. Crew members clock in/out from their phones.",
    profitabilityTip: "Accurate time tracking means accurate job costing and no payroll disputes.",
    path: "/time-clock",
    disableBeacon: true,
  },
  {
    target: '[data-testid="nav-cfo-dashboard"]',
    title: "CFO Dashboard",
    content: "Deep financial analysis — cash flow, profitability trends, job costing breakdowns, and financial forecasting all in one place.",
    profitabilityTip: "Financial clarity drives better business decisions and higher margins.",
    path: "/dashboard",
    disableBeacon: true,
  },
  {
    target: '[data-testid="nav-crm"]',
    title: "Customer & Vendor Management",
    content: "Manage all your business relationships - clients, subcontractors, suppliers, and vendors with pricing catalogs.",
    profitabilityTip: "Strong vendor relationships and negotiated pricing directly impact your bottom line.",
    path: "/dashboard",
    disableBeacon: true,
  },
  {
    target: '[data-testid="nav-messages"]',
    title: "Messages",
    content: "Keep all work communication in one place. No more scattered texts and emails — everything is secure and searchable.",
    profitabilityTip: "Centralized communication eliminates miscommunication and costly mistakes.",
    path: "/dashboard",
    disableBeacon: true,
  },
  {
    target: '[data-testid="nav-users"]',
    title: "Team Management",
    content: "Add team members, assign roles, and control what each person can access in the system.",
    profitabilityTip: "Right access for right people keeps your data secure and your team efficient.",
    path: "/users",
    disableBeacon: true,
  },
];

const hustlerTourSteps: TourStep[] = [
  {
    target: '[data-testid="sidebar-portfolio"]',
    title: "Your Portfolio",
    content: "See all your linked organizations at a glance. Switch between companies and manage your entire business portfolio from one account.",
    profitabilityTip: "One login to manage your entire portfolio of businesses.",
    path: "/dashboard",
    disableBeacon: true,
  },
  {
    target: '[data-testid="nav-dashboard"]',
    title: "Executive Dashboard",
    content: "See aggregated metrics across all your organizations - total revenue, project counts, and performance comparisons.",
    profitabilityTip: "Portfolio-wide visibility helps you allocate resources to your highest-performing companies.",
    path: "/dashboard",
    disableBeacon: true,
  },
  {
    target: '[data-testid="nav-cfo-dashboard"]',
    title: "CFO Analytics",
    content: "Deep financial analysis across your portfolio - cash flow, profitability trends, and financial forecasting.",
    profitabilityTip: "Data-driven decisions about where to invest and where to cut.",
    path: "/cfo-dashboard",
    disableBeacon: true,
  },
  {
    target: '[data-testid="nav-projects"]',
    title: "Cross-Org Projects",
    content: "View projects across all your organizations. Track work happening across your entire portfolio and spot patterns.",
    profitabilityTip: "Cross-company visibility reveals optimization opportunities.",
    path: "/dashboard",
    disableBeacon: true,
  },
  {
    target: '[data-testid="nav-users"]',
    title: "COO Delegation",
    content: "Assign COO-level access to trusted managers who can help oversee operations across organizations.",
    profitabilityTip: "Scale your oversight without being in every meeting.",
    path: "/users",
    disableBeacon: true,
  },
];

const managerTourSteps: TourStep[] = [
  {
    target: '[data-testid="nav-dashboard"]',
    title: "Your Dashboard",
    content: "See the projects and bids you're responsible for, upcoming deadlines, and crew assignments at a glance.",
    profitabilityTip: "Stay on top of everything without searching through emails.",
    path: "/dashboard",
    disableBeacon: true,
  },
  {
    target: '[data-testid="nav-projects"]',
    title: "Project Tracking",
    content: "Monitor project progress, manage schedules, and track change orders for your assigned projects.",
    profitabilityTip: "Proactive management prevents costly delays.",
    path: "/projects",
    disableBeacon: true,
  },
  {
    target: '[data-testid="nav-bids"]',
    title: "Bid Management",
    content: "Create and track bids, collaborate with estimators, and manage the proposal process.",
    profitabilityTip: "Organized bid tracking improves your win rate.",
    path: "/bids",
    disableBeacon: true,
  },
  {
    target: '[data-testid="nav-crm"]',
    title: "CRM & Vendors",
    content: "Manage your business relationships — clients, subcontractors, and suppliers with contact info and pricing.",
    profitabilityTip: "Organized vendor relationships lead to better pricing and faster responses.",
    path: "/dashboard",
    disableBeacon: true,
  },
  {
    target: '[data-testid="nav-manage-time-clock"]',
    title: "Time Approval",
    content: "Review and approve crew time entries. Ensure accurate labor tracking for job costing.",
    profitabilityTip: "Catch time discrepancies before they hit payroll.",
    path: "/time-clock-manager",
    disableBeacon: true,
  },
  {
    target: '[data-testid="nav-cfo-dashboard"]',
    title: "CFO Dashboard",
    content: "Financial analysis at your fingertips — cash flow, profitability trends, and job costing breakdowns.",
    profitabilityTip: "Financial insight helps you keep projects profitable.",
    path: "/dashboard",
    disableBeacon: true,
  },
  {
    target: '[data-testid="nav-messages"]',
    title: "Messages",
    content: "Keep your team communication organized. Share updates, coordinate with estimators, supers, and crews all in one place.",
    profitabilityTip: "Clear communication prevents costly miscommunication.",
    path: "/dashboard",
    disableBeacon: true,
  },
  {
    target: '[data-testid="nav-crews"]',
    title: "Crew Management",
    content: "Organize your workforce into crews, assign foremen, and track who's working where.",
    profitabilityTip: "Right crew on the right job maximizes productivity.",
    path: "/crews",
    disableBeacon: true,
  },
];

const superintendentTourSteps: TourStep[] = [
  {
    target: '[data-testid="nav-my-time-clock"]',
    title: "Your Time Clock",
    content: "Clock in and out each day. Your location is captured to verify jobsite attendance.",
    profitabilityTip: "Leading by example — accurate time tracking starts with you.",
    path: "/time-clock",
    disableBeacon: true,
  },
  {
    target: '[data-testid="nav-dashboard"]',
    title: "Your Dashboard",
    content: "See all the projects you're supervising, their timelines, crew assignments, and what needs your attention today.",
    profitabilityTip: "Start each day knowing exactly what needs your focus.",
    path: "/dashboard",
    disableBeacon: true,
  },
  {
    target: '[data-testid="nav-manage-time-clock"]',
    title: "Manage Crew Time",
    content: "Review and approve your crew's time entries. GPS-tracked hours linked to the right projects for accurate job costing.",
    profitabilityTip: "Catching time issues early prevents payroll headaches.",
    path: "/time-clock-manager",
    disableBeacon: true,
  },
  {
    target: '[data-testid="nav-projects"]',
    title: "Project Management",
    content: "Track progress on your assigned projects — schedules, daily reports, budgets, and change orders all in one place.",
    profitabilityTip: "Proactive field management prevents costly delays and rework.",
    path: "/projects",
    disableBeacon: true,
  },
  {
    target: '[data-testid="nav-approvals"]',
    title: "Approvals",
    content: "Review and approve daily reports, time entries, and change orders that need your sign-off.",
    profitabilityTip: "Quick approvals keep the project moving and the team productive.",
    path: "/dashboard",
    disableBeacon: true,
  },
  {
    target: '[data-testid="nav-equipment"]',
    title: "Equipment",
    content: "See which equipment is assigned to your jobsites, check availability, and request what you need.",
    profitabilityTip: "Having the right equipment on site keeps production on track.",
    path: "/dashboard",
    disableBeacon: true,
  },
  {
    target: '[data-testid="nav-procurement"]',
    title: "Procurement",
    content: "Submit material requests and track purchase orders for your projects. Get what you need without delays.",
    profitabilityTip: "Streamlined procurement means materials arrive when you need them.",
    path: "/dashboard",
    disableBeacon: true,
  },
];

const estimatorTourSteps: TourStep[] = [
  {
    target: '[data-testid="nav-dashboard"]',
    title: "Estimator Dashboard",
    content: "View bids requiring estimates, track your workload, and see upcoming bid deadlines.",
    profitabilityTip: "Never miss a bid deadline with clear visibility.",
    path: "/dashboard",
    disableBeacon: true,
  },
  {
    target: '[data-testid="nav-bids"]',
    title: "Bid Pipeline",
    content: "Access all active bids. Start new estimates or continue working on existing ones.",
    profitabilityTip: "Organized workflow means more bids completed on time.",
    path: "/bids",
    disableBeacon: true,
  },
  {
    target: '[data-testid="nav-bid-network"]',
    title: "Bid Network",
    content: "Find and connect with subcontractors for your bids. Send bid invitations and receive competitive quotes.",
    profitabilityTip: "More competitive sub quotes mean better margins on your estimates.",
    path: "/dashboard",
    disableBeacon: true,
  },
  {
    target: '[data-testid="nav-scope-settings"]',
    title: "Scope of Work Library",
    content: "Your trade-specific scope items with standard units, labor rates, and material costs. Build estimates faster.",
    profitabilityTip: "Standardized scope items ensure consistent, profitable pricing.",
    path: "/scope-settings",
    disableBeacon: true,
  },
  {
    target: '[data-testid="nav-production-rates"]',
    title: "Historical Production Data",
    content: "See actual production rates from completed work. Know exactly how long tasks really take.",
    profitabilityTip: "Real data beats guesswork - price with confidence.",
    path: "/production-rates",
    disableBeacon: true,
  },
  {
    target: '[data-testid="nav-cost-rates"]',
    title: "Cost Rates",
    content: "Access current cost rates for labor and materials. Keep estimates accurate and competitive.",
    profitabilityTip: "Up-to-date pricing prevents costly estimating errors.",
    path: "/cost-rates",
    disableBeacon: true,
  },
  {
    target: '[data-testid="nav-calculator"]',
    title: "Trade Calculator",
    content: "Built-in calculators for your trade with waste factors included. Punch in dimensions and get accurate quantities.",
    profitabilityTip: "Precise quantities mean accurate bids — no guesswork needed.",
    path: "/dashboard",
    disableBeacon: true,
  },
];

const crewTourSteps: TourStep[] = [
  {
    target: '[data-testid="nav-my-time-clock"]',
    title: "Time Clock",
    content: "Clock in and out for each shift. Your location is captured to verify jobsite attendance.",
    profitabilityTip: "Easy time tracking means you get paid accurately.",
    path: "/time-clock",
    disableBeacon: true,
  },
  {
    target: '[data-testid="nav-tasks"]',
    title: "Your Tasks",
    content: "View tasks assigned to you, mark them complete, and add notes about your work.",
    profitabilityTip: "Clear task lists keep the job moving forward.",
    path: "/tasks",
    disableBeacon: true,
  },
  {
    target: '[data-testid="nav-calendar"]',
    title: "Calendar",
    content: "View your schedule and upcoming assignments at a glance.",
    profitabilityTip: "Quick access to your calendar keeps the job moving forward.",
    path: "/calendar",
    disableBeacon: true,
  },
  {
    target: '[data-testid="nav-bulletins"]',
    title: "Bulletins & Communications",
    content: "Stay in the loop with company announcements, safety updates, and important notices from the office.",
    profitabilityTip: "Staying informed keeps you safe and productive on the job.",
    path: "/dashboard",
    disableBeacon: true,
  },
  {
    target: '[data-testid="nav-dashboard"]',
    title: "Your Dashboard",
    content: "See your assigned projects, today's schedule, and important announcements from the office.",
    profitabilityTip: "Know what you need to do without waiting for instructions.",
    path: "/dashboard",
    disableBeacon: true,
  },
];

const vendorTourSteps: TourStep[] = [
  {
    target: '[data-testid="nav-vendor-dashboard"]',
    title: "Dashboard",
    content: "Welcome to your dashboard. Get an overview of messages, events, and quick actions.",
    profitabilityTip: "Direct access to your customers streamlines communication.",
    path: "/dashboard",
    disableBeacon: true,
  },
  {
    target: '[data-testid="nav-vendor-pricing"]',
    title: "Your Pricing",
    content: "Update your material pricing. Contractors see your current prices when building estimates.",
    profitabilityTip: "Current pricing means fewer price disputes and faster approvals.",
    path: "/vendor/pricing",
    disableBeacon: true,
  },
  {
    target: '[data-testid="nav-vendor-clients"]',
    title: "Your Clients",
    content: "See which contractors are using your pricing and manage your relationships.",
    profitabilityTip: "Know your customers to provide better service.",
    path: "/vendor/clients",
    disableBeacon: true,
  },
  {
    target: '[data-testid="nav-vendor-messages"]',
    title: "Messages",
    content: "Communicate directly with your contractor partners. Answer questions, send quotes, and coordinate deliveries.",
    profitabilityTip: "Quick responses to contractor inquiries build stronger partnerships.",
    path: "/dashboard",
    disableBeacon: true,
  },
  {
    target: '[data-testid="nav-vendor-bid-inbox"]',
    title: "Bid Inbox",
    content: "Receive bid invitations from contractors. Review project details and submit your competitive quotes.",
    profitabilityTip: "More bid opportunities means more business — respond quickly to win.",
    path: "/dashboard",
    disableBeacon: true,
  },
];

function getTourStepsForRole(role: string): TourStep[] {
  switch (role) {
    case "SUPER_ADMIN":
      return superAdminTourSteps;
    case "ADMIN":
      return adminTourSteps;
    case "HUSTLER":
      return hustlerTourSteps;
    case "MANAGER":
      return managerTourSteps;
    case "SUPERINTENDENT":
      return superintendentTourSteps;
    case "ESTIMATOR":
      return estimatorTourSteps;
    case "FIELD_WORKER":
      return crewTourSteps;
    case "VENDOR":
      return vendorTourSteps;
    default:
      return crewTourSteps;
  }
}

function TourCompletionModal({ onClose }: { onClose: () => void }) {
  const [, setLocation] = useLocation();
  
  const handleGoToDashboard = () => {
    onClose();
    setLocation("/dashboard");
  };
  
  return (
    <div className="fixed inset-0 z-[10001] flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <Card className="w-full max-w-lg mx-4 border-2 border-primary/20 shadow-2xl">
        <CardHeader className="text-center pb-2">
          <div className="mx-auto mb-4 w-20 h-20 rounded-full bg-primary/10 flex items-center justify-center">
            <CheckCircle2 className="w-12 h-12 text-primary" />
          </div>
          <CardTitle className="text-2xl flex items-center justify-center gap-2">
            <Sparkles className="w-6 h-6 text-yellow-500" />
            Tour Complete!
            <Sparkles className="w-6 h-6 text-yellow-500" />
          </CardTitle>
        </CardHeader>
        <CardContent className="text-center space-y-4">
          <p className="text-muted-foreground">
            You've seen the key features of SmartManage. Each tool is designed to help you 
            work more efficiently and make more money on every project.
          </p>
          <div className="bg-muted/50 rounded-lg p-4 text-left space-y-2">
            <p className="font-medium text-sm">What's Next:</p>
            <ul className="text-sm text-muted-foreground space-y-1">
              <li>• Complete the Setup Wizard to configure your account</li>
              <li>• Add your team members and assign roles</li>
              <li>• Create your first bid or project</li>
            </ul>
          </div>
          <Button 
            onClick={handleGoToDashboard}
            className="w-full"
            size="lg"
            data-testid="button-tour-complete-dashboard"
          >
            Go to Dashboard
            <ArrowRight className="w-4 h-4 ml-2" />
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

// Task #1663 — Plans-surface tour. Steps target the takeoff workspace
// sidebar (visible by default when no PDF is previewed), which is where
// new users first encounter the intimidating icon-only toolbars. Each
// step explains a toolbar group: Navigate, Calibrate, Measure, Mark Up,
// the spacebar-pan shortcut, and the Pin features they'll find when
// previewing a PDF.
const plansTourSteps: Step[] = [
  {
    target: '[data-testid="button-tool-pan"]',
    title: "Navigate the plan",
    content: (
      <div className="space-y-2">
        <p>Use <strong>Pan</strong> and <strong>Select</strong> to move around your sheet without drawing anything.</p>
        <p className="text-sm text-muted-foreground">Tip: hold <kbd className="px-1 py-0.5 rounded border bg-muted text-xs">Space</kbd> from any tool to pan temporarily — release Space to restore your tool.</p>
      </div>
    ),
    placement: "right" as const,
    disableBeacon: true,
  },
  {
    target: '[data-testid="button-tool-calibrate"]',
    title: "Calibrate first",
    content: (
      <p>Before measuring, click <strong>Calibrate</strong> and pick two points of a known distance on the sheet. Every measurement after that comes out in real-world units.</p>
    ),
    placement: "right" as const,
    disableBeacon: true,
  },
  {
    target: '[data-testid="button-measure-group"]',
    title: "Measure",
    content: (
      <p>Linear, area, volume, count and more — all the takeoff measurement tools live here. Pick one, click on the sheet, and the quantities flow straight into your bid.</p>
    ),
    placement: "right" as const,
    disableBeacon: true,
  },
  {
    target: '[data-testid="button-markup-group"]',
    title: "Mark Up",
    content: (
      <p>Draw arrows, clouds, highlights, or freehand notes on top of the sheet to communicate intent. Markups don't affect quantities — they're just for collaboration.</p>
    ),
    placement: "right" as const,
    disableBeacon: true,
  },
  {
    target: '[data-testid="sidebar-doc-list"], [data-testid="button-upload-plan"]',
    title: "Pin RFIs, Punches & Submittals",
    content: (
      <div className="space-y-2">
        <p>When you open a PDF preview, the toolbar at the top of the page lets you drop <strong>Pins</strong> for RFIs, punch items, and submittals tied to a specific spot on the drawing.</p>
        <p className="text-sm text-muted-foreground">Open any sheet from the list to try it.</p>
      </div>
    ),
    placement: "right" as const,
    disableBeacon: true,
  },
];

// Task #1695 — The plans-tour dismissal marker moved server-side under
// `users.plansTourCompleted` so it syncs across devices alongside the
// labeled-toolbar preference. The legacy per-user-id localStorage key
// is still read for one-shot migration (read once, push to the server,
// then clear) so users who already dismissed the tour on a previous
// session do not see it replay on the new flow. The same key is also
// written synchronously when the user dismisses the tour as a sticky
// backstop — see the looping-tour fix below.
const LEGACY_PLANS_TOUR_KEY_PREFIX = "plans-tour-completed-";

function readLegacyPlansTourCompleted(userId: string | undefined | null): boolean {
  if (!userId || typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(`${LEGACY_PLANS_TOUR_KEY_PREFIX}${userId}`) === "1";
  } catch {
    return false;
  }
}

function clearLegacyPlansTourCompleted(userId: string | undefined | null) {
  if (!userId || typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(`${LEGACY_PLANS_TOUR_KEY_PREFIX}${userId}`);
  } catch {
    // localStorage unavailable (private browsing, quota) — silently ignore
  }
}

function writePlansTourCompletedLocal(userId: string | undefined | null) {
  if (!userId || typeof window === "undefined") return;
  try {
    window.localStorage.setItem(`${LEGACY_PLANS_TOUR_KEY_PREFIX}${userId}`, "1");
  } catch {
    // localStorage unavailable (private browsing, quota) — silently ignore
  }
}

// Looping-tour fix — when the user dismisses the plans tour, optimistically
// flip `user.plansTourCompleted` in the React Query cache so the next render
// sees the dismissed state immediately, instead of waiting for the PATCH +
// `/api/auth/me` refetch to land. Without this, a child remount during the
// in-flight window (e.g. navigating away from the plans subtab and back, or
// closing a PDF preview) re-fires the auto-tour trigger.
function optimisticallyMarkPlansTourCompleted() {
  queryClient.setQueriesData<{ user?: { plansTourCompleted?: boolean } } | undefined>(
    { queryKey: ["/api/auth/me"] },
    (prev) => {
      if (!prev || !prev.user) return prev;
      if (prev.user.plansTourCompleted) return prev;
      return { ...prev, user: { ...prev.user, plansTourCompleted: true } };
    },
  );
}

async function persistPlansTourCompleted(completed: boolean): Promise<void> {
  await apiRequest("PATCH", "/api/auth/profile", {
    plansTourCompleted: completed,
  });
  // No invalidate needed when `completed: true` — the optimistic cache
  // update already reflects the new value and the requireAuth user-cache
  // bust on the server side keeps a fresh /api/auth/me consistent. We
  // still invalidate on the rare `completed: false` path (replay) so the
  // server's authoritative state wins.
  if (!completed) {
    await queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
  }
}

// Task #1696 — Bid Plans tour. The first four steps mirror the
// project plans tour (Pan/Select, Calibrate, Measure, Mark Up) since
// the bid surface uses the same `<TakeoffWorkspace>` toolbar. The
// final step swaps the "drop pins for RFIs/punches/submittals" copy
// (bids have no plan-pin layer) for a callout about importing the
// finished takeoff measurements into the bid estimate, which is the
// natural next step on the bid surface.
//
// Note (rebase #1695 → #1696): the project plans-tour completion
// flag was moved server-side under `users.plansTourCompleted` in
// Task #1695. The bid plans-tour completion flag intentionally stays
// in localStorage for now to avoid an out-of-scope schema change —
// see the follow-up task to mirror it server-side once a column
// exists. Cross-device sync is a known gap but the auto-tour and
// replay UX work correctly per device.
//
// Task #1726 — On viewports below the takeoff toolbar's `sm:`
// breakpoint (640 px), the desktop sidebar collapses and the toolbar
// reflows to a horizontally-scrolling bottom bar with different
// testids (`button-tool-mobile-*`) and no `button-measure-group` /
// `button-markup-group` aggregator buttons. The desktop targets stay
// in the DOM (with `display: none`), so a comma-list selector still
// resolves them first via `querySelector` and the spotlight lands on
// an invisible node. To prevent that we build the step list off a
// live viewport check and swap to mobile-equivalent anchors below the
// breakpoint, collapsing Measure + Mark Up into a single step that
// spotlights the whole scrolling toolbar (no group anchor exists).
const TAKEOFF_MOBILE_BREAKPOINT_PX = 640;

function useTakeoffViewportIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mql = window.matchMedia(
      `(max-width: ${TAKEOFF_MOBILE_BREAKPOINT_PX - 1}px)`,
    );
    const update = () => setIsMobile(mql.matches);
    update();
    mql.addEventListener("change", update);
    return () => mql.removeEventListener("change", update);
  }, []);
  return isMobile;
}

function getBidPlansTourSteps(isMobile: boolean): Step[] {
  if (isMobile) {
    return [
      {
        target: '[data-testid="button-tool-mobile-pan"]',
        title: "Navigate the plan",
        content: (
          <div className="space-y-2">
            <p>Use <strong>Pan</strong> and <strong>Select</strong> to move around your sheet without drawing anything.</p>
            <p className="text-sm text-muted-foreground">Tip: pinch to zoom and drag with one finger to pan.</p>
          </div>
        ),
        placement: "top" as const,
        disableBeacon: true,
      },
      {
        target: '[data-testid="button-tool-mobile-calibrate"]',
        title: "Calibrate first",
        content: (
          <p>Before measuring, tap <strong>Calibrate</strong> and pick two points of a known distance on the sheet. Every measurement after that comes out in real-world units.</p>
        ),
        placement: "top" as const,
        disableBeacon: true,
      },
      {
        target: '[data-testid="takeoff-toolbar-mobile"]',
        title: "Measure & mark up",
        content: (
          <div className="space-y-2">
            <p>Scroll this toolbar sideways to find <strong>Linear, Area, Volume, Count</strong> and the <strong>markup</strong> tools (arrows, clouds, highlights, freehand notes).</p>
            <p className="text-sm text-muted-foreground">Measurements flow into your bid; markups stay on the sheet for collaboration.</p>
          </div>
        ),
        placement: "top" as const,
        disableBeacon: true,
      },
      {
        target: '[data-testid="bid-plans-view-settings"]',
        title: "Push quantities into your estimate",
        content: (
          <div className="space-y-2">
            <p>Once your takeoff measurements look right, send them straight into the bid estimate from the <strong>Import Measurements</strong> button on the sheet sidebar — no copy/paste required.</p>
            <p className="text-sm text-muted-foreground">You can replay this tour anytime from the gear menu up top.</p>
          </div>
        ),
        placement: "bottom" as const,
        disableBeacon: true,
      },
    ];
  }

  return [
    {
      target: '[data-testid="button-tool-pan"]',
      title: "Navigate the plan",
      content: (
        <div className="space-y-2">
          <p>Use <strong>Pan</strong> and <strong>Select</strong> to move around your sheet without drawing anything.</p>
          <p className="text-sm text-muted-foreground">Tip: hold <kbd className="px-1 py-0.5 rounded border bg-muted text-xs">Space</kbd> from any tool to pan temporarily — release Space to restore your tool.</p>
        </div>
      ),
      placement: "right" as const,
      disableBeacon: true,
    },
    {
      target: '[data-testid="button-tool-calibrate"]',
      title: "Calibrate first",
      content: (
        <p>Before measuring, click <strong>Calibrate</strong> and pick two points of a known distance on the sheet. Every measurement after that comes out in real-world units.</p>
      ),
      placement: "right" as const,
      disableBeacon: true,
    },
    {
      target: '[data-testid="button-measure-group"]',
      title: "Measure",
      content: (
        <p>Linear, area, volume, count and more — all the takeoff measurement tools live here. Pick one, click on the sheet, and the quantities flow straight into your bid.</p>
      ),
      placement: "right" as const,
      disableBeacon: true,
    },
    {
      target: '[data-testid="button-markup-group"]',
      title: "Mark Up",
      content: (
        <p>Draw arrows, clouds, highlights, or freehand notes on top of the sheet to communicate intent. Markups don't affect quantities — they're just for collaboration.</p>
      ),
      placement: "right" as const,
      disableBeacon: true,
    },
    {
      target: '[data-testid="bid-plans-view-settings"], [data-testid="button-upload-plan"]',
      title: "Push quantities into your estimate",
      content: (
        <div className="space-y-2">
          <p>Once your takeoff measurements look right, send them straight into the bid estimate from the sidebar's <strong>Import Measurements</strong> button — no copy/paste required.</p>
          <p className="text-sm text-muted-foreground">You can replay this tour anytime from the gear menu in the top right.</p>
        </div>
      ),
      placement: "left" as const,
      disableBeacon: true,
    },
  ];
}

const BID_PLANS_TOUR_KEY_PREFIX = "bid-plans-tour-completed-";

function getBidPlansTourCompleted(userId: string | undefined | null): boolean {
  if (!userId || typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(`${BID_PLANS_TOUR_KEY_PREFIX}${userId}`) === "1";
  } catch {
    return false;
  }
}

function setBidPlansTourCompleted(userId: string | undefined | null, completed: boolean) {
  if (!userId || typeof window === "undefined") return;
  try {
    if (completed) {
      window.localStorage.setItem(`${BID_PLANS_TOUR_KEY_PREFIX}${userId}`, "1");
    } else {
      window.localStorage.removeItem(`${BID_PLANS_TOUR_KEY_PREFIX}${userId}`);
    }
  } catch {
    // localStorage unavailable (private browsing, quota) — silently ignore
  }
}

export function TourProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [location, setLocation] = useLocation();
  const { toast } = useToast();
  
  const [isTourActive, setIsTourActive] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [showCompletion, setShowCompletion] = useState(false);
  const [tourSteps, setTourSteps] = useState<Step[]>([]);
  const [pendingNavigation, setPendingNavigation] = useState<{ path: string; targetStep: number } | null>(null);
  const skipCheckRef = useRef(false);
  const [targetReady, setTargetReady] = useState(false);

  // Task #1663 / #1695 — Plans-surface tour state, independent from the
  // role-based dashboard tour above. The dismissal marker now lives on
  // the user profile (`users.plansTourCompleted`) so it carries across
  // devices and survives cache clears. We also one-shot migrate the
  // legacy per-user-id localStorage key (`plans-tour-completed-<uid>`)
  // up to the server the first time we see a previously-dismissed
  // user with the new server flag still false.
  const [isPlansTourActive, setIsPlansTourActive] = useState(false);
  const plansTourCompleted = user?.plansTourCompleted ?? false;
  const legacyPlansTourMigratedRef = useRef<string | null>(null);
  useEffect(() => {
    const uid = user?.id;
    if (!uid) return;
    if (user?.plansTourCompleted) return;
    if (legacyPlansTourMigratedRef.current === uid) return;
    if (!readLegacyPlansTourCompleted(uid)) return;
    legacyPlansTourMigratedRef.current = uid;
    // Optimistically flip the cache before the migration PATCH lands so
    // the auto-trigger in PlansTab/BidPlansTab can short-circuit on this
    // very render even though the server-side `users.plansTourCompleted`
    // isn't yet `true`. Without this, a slow PATCH on a previously-
    // dismissed user could let the tour replay during the migration
    // window — exactly the looping-tour symptom this fix is meant to
    // eliminate.
    optimisticallyMarkPlansTourCompleted();
    void (async () => {
      try {
        await persistPlansTourCompleted(true);
        clearLegacyPlansTourCompleted(uid);
      } catch (error) {
        console.error("Failed to migrate legacy plans-tour completion flag:", error);
        // Allow another attempt on the next render so a transient
        // failure does not strand a previously-dismissed user with
        // the tour replaying every visit.
        legacyPlansTourMigratedRef.current = null;
      }
    })();
  }, [user?.id, user?.plansTourCompleted]);

  // Task #1696 — Bid Plans tour state. Tracked separately from the
  // project plans tour so users get the bid-context walkthrough the
  // first time they open the bid Plans tab even if they already saw
  // (and dismissed) the project plans tour. Stored in localStorage
  // (per-user-id) until a server-side `bidPlansTourCompleted` column
  // is added; see the rebase note above the bid tour steps.
  const [isBidPlansTourActive, setIsBidPlansTourActive] = useState(false);
  const [bidPlansTourCompleted, setBidPlansTourCompletedState] = useState<boolean>(false);
  useEffect(() => {
    setBidPlansTourCompletedState(getBidPlansTourCompleted(user?.id));
  }, [user?.id]);

  // Task #1726 — Recompute the bid Plans tour step list whenever the
  // viewport crosses the takeoff toolbar's `sm:` breakpoint so each
  // step always anchors to a visible target (the desktop sidebar or
  // the mobile bottom bar). Joyride is keyed off the active flag, so
  // a resize during an active tour just updates the in-flight steps;
  // a resize while the tour is dormant only affects the next launch.
  const isTakeoffViewportMobile = useTakeoffViewportIsMobile();
  const bidPlansTourSteps = useMemo(
    () => getBidPlansTourSteps(isTakeoffViewportMobile),
    [isTakeoffViewportMobile],
  );
  
  const role = user?.effectiveRole || user?.role || "FIELD_WORKER";
  
  const roleStepsRef = useRef<TourStep[]>([]);
  useEffect(() => {
    if (role) {
      roleStepsRef.current = getTourStepsForRole(role);
    }
  }, [role]);
  
  const currentTourTarget = isTourActive && roleStepsRef.current[currentStep]
    ? roleStepsRef.current[currentStep].target
    : null;
  
  useEffect(() => {
    if (role) {
      const roleSteps = getTourStepsForRole(role);
      const formattedSteps: Step[] = roleSteps.map((step) => ({
        target: step.target,
        title: step.title,
        content: (
          <div className="space-y-3">
            <p>{step.content}</p>
            {step.profitabilityTip && (
              <div className="bg-primary/10 rounded-md p-3 border-l-4 border-primary">
                <p className="text-sm font-medium text-primary">
                  💰 {step.profitabilityTip}
                </p>
              </div>
            )}
          </div>
        ),
        disableBeacon: step.disableBeacon,
        placement: "right" as const,
        floaterProps: {
          disableAnimation: true,
        },
      }));
      setTourSteps(formattedSteps);
    }
  }, [role]);
  
  useEffect(() => {
    if (!isTourActive || pendingNavigation) {
      setTargetReady(false);
      return;
    }
    
    const roleSteps = roleStepsRef.current;
    if (currentStep >= roleSteps.length) return;
    
    const targetSelector = roleSteps[currentStep].target;
    setTargetReady(false);
    
    let attempts = 0;
    const maxAttempts = 20;
    
    const poll = setInterval(() => {
      attempts++;
      const targetEl = document.querySelector(targetSelector);
      
      if (targetEl) {
        clearInterval(poll);
        setTargetReady(true);
        return;
      }
      
      if (attempts >= maxAttempts) {
        clearInterval(poll);
        skipCheckRef.current = true;
        const nextStep = currentStep + 1;
        if (nextStep >= roleSteps.length) {
          setIsTourActive(false);
          setShowCompletion(true);
        } else {
          const nextRoleStep = roleSteps[nextStep];
          if (nextRoleStep?.path && nextRoleStep.path !== location) {
            setPendingNavigation({ path: nextRoleStep.path, targetStep: nextStep });
            setLocation(nextRoleStep.path);
          } else {
            setCurrentStep(nextStep);
          }
        }
        setTimeout(() => { skipCheckRef.current = false; }, 100);
      }
    }, 100);
    
    return () => clearInterval(poll);
  }, [isTourActive, currentStep, pendingNavigation, location, setLocation]);
  
  useEffect(() => {
    if (pendingNavigation && location === pendingNavigation.path) {
      const targetStep = pendingNavigation.targetStep;
      setPendingNavigation(null);
      
      // Wait for DOM to settle, then persist step and update state
      const timeoutId = setTimeout(async () => {
        try {
          // Persist to backend FIRST before updating local state
          await apiRequest("PATCH", "/api/ai/walkthrough/step", {
            step: targetStep + 1,
            completed: false,
          });
          queryClient.invalidateQueries({ queryKey: ["/api/ai/walkthrough/status"] });
        } catch (error) {
          console.error("Failed to persist tour step after navigation:", error);
        }
        // Update local state AFTER persistence succeeds
        setCurrentStep(targetStep);
      }, 500);
      
      return () => clearTimeout(timeoutId);
    }
  }, [location, pendingNavigation]);
  
  const startTour = useCallback(async () => {
    if (!role) return;
    
    const roleSteps = getTourStepsForRole(role);
    if (roleSteps.length === 0) {
      toast({
        title: "No tour available",
        description: "There's no guided tour configured for your role.",
      });
      return;
    }
    
    const firstStep = roleSteps[0];
    if (firstStep.path && location !== firstStep.path) {
      setLocation(firstStep.path);
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    
    setCurrentStep(0);
    setIsTourActive(true);
    
    try {
      await apiRequest("PATCH", "/api/ai/walkthrough/step", {
        step: 1,
        completed: false,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/ai/walkthrough/status"] });
    } catch (error) {
      console.error("Failed to update walkthrough status:", error);
    }
  }, [role, location, setLocation, toast]);
  
  const skipTour = useCallback(async () => {
    setIsTourActive(false);
    setCurrentStep(0);
    
    try {
      await apiRequest("PATCH", "/api/ai/walkthrough/step", {
        step: 0,
        completed: true,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/ai/walkthrough/status"] });
      queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
    } catch (error) {
      console.error("Failed to update walkthrough status:", error);
    }
    
    toast({
      title: "Tour skipped",
      description: "You can restart the tour anytime from Settings.",
    });
  }, [toast]);
  
  const handleJoyrideCallback = useCallback(
    async (data: CallBackProps) => {
      const { status, action, index, type } = data;
      
      if (type === EVENTS.STEP_AFTER && action === ACTIONS.NEXT) {
        const roleSteps = getTourStepsForRole(role);
        const nextStep = roleSteps[index + 1];
        const targetStep = index + 1;
        
        // Update step immediately for Joyride controlled mode
        setCurrentStep(targetStep);
        
        if (nextStep?.path && nextStep.path !== location) {
          setPendingNavigation({ path: nextStep.path, targetStep });
          setLocation(nextStep.path);
          // Persist after navigation completes via useEffect
          return;
        }
        
        try {
          await apiRequest("PATCH", "/api/ai/walkthrough/step", {
            step: targetStep + 1,
            completed: false,
          });
          queryClient.invalidateQueries({ queryKey: ["/api/ai/walkthrough/status"] });
        } catch (error) {
          console.error("Failed to persist tour step:", error);
        }
      }
      
      if (type === EVENTS.STEP_AFTER && action === ACTIONS.PREV) {
        const roleSteps = getTourStepsForRole(role);
        const prevStep = roleSteps[index - 1];
        const targetStep = index - 1;
        
        if (targetStep < 0) return; // Can't go back from first step
        
        // Update step immediately for Joyride controlled mode
        setCurrentStep(targetStep);
        
        if (prevStep?.path && prevStep.path !== location) {
          setPendingNavigation({ path: prevStep.path, targetStep });
          setLocation(prevStep.path);
          // Persist after navigation completes via useEffect
          return;
        }
        
        try {
          await apiRequest("PATCH", "/api/ai/walkthrough/step", {
            step: targetStep + 1,
            completed: false,
          });
          queryClient.invalidateQueries({ queryKey: ["/api/ai/walkthrough/status"] });
        } catch (error) {
          console.error("Failed to persist tour step:", error);
        }
      }
      
      if (status === STATUS.FINISHED) {
        setIsTourActive(false);
        setShowCompletion(true);
        
        try {
          await apiRequest("PATCH", "/api/ai/walkthrough/step", {
            step: tourSteps.length,
            completed: true,
          });
          queryClient.invalidateQueries({ queryKey: ["/api/ai/walkthrough/status"] });
          queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
        } catch (error) {
          console.error("Failed to update walkthrough status:", error);
        }
      }
      
      if (status === STATUS.SKIPPED || action === ACTIONS.CLOSE) {
        skipTour();
      }
    },
    [role, location, setLocation, tourSteps.length, skipTour]
  );
  
  const handleCompletionClose = useCallback(() => {
    setShowCompletion(false);
  }, []);

  // ── Task #1663 / #1695 — Plans-surface tour controls ────────────────
  // The dismissal marker (`users.plansTourCompleted`) is persisted on
  // the server so it carries across devices. To stop the tour from
  // looping when a child like PlansTab unmounts/remounts during the
  // in-flight PATCH window (looping-tour fix), we also flip three
  // synchronous backstops the moment the user dismisses:
  //   1. `plansTourDismissedSession` — in-memory state on the provider
  //      (which lives above the router and never unmounts during a
  //      session) so re-mounted children see the dismissal immediately.
  //   2. The React Query cache for `/api/auth/me` is optimistically
  //      patched so `user.plansTourCompleted` flips synchronously
  //      without waiting for the server round-trip.
  //   3. The legacy localStorage key is rewritten so a hard reload
  //      during the in-flight window still hydrates as dismissed
  //      (the migration effect above promotes it back to the server).
  // Failures are logged but do not block the UX.
  const [plansTourDismissedSession, setPlansTourDismissedSession] = useState(false);
  // Reset the session-sticky dismissal whenever the active user changes
  // (initial sign-in, account switch, sign-out → sign-in) so user B never
  // inherits user A's "dismissed this session" backstop and miss their
  // own first-run tour. The provider lives above the router so without
  // this guard the in-memory flag would persist across user switches.
  useEffect(() => {
    setPlansTourDismissedSession(false);
  }, [user?.id]);
  const startPlansTour = useCallback(() => {
    setPlansTourDismissedSession(false);
    setIsPlansTourActive(true);
  }, []);

  const finishPlansTour = useCallback(async () => {
    setIsPlansTourActive(false);
    setPlansTourDismissedSession(true);
    if (!user?.id) return;
    optimisticallyMarkPlansTourCompleted();
    writePlansTourCompletedLocal(user.id);
    try {
      await persistPlansTourCompleted(true);
    } catch (error) {
      console.error("Failed to persist plans-tour completion:", error);
    }
  }, [user?.id]);

  const skipPlansTour = useCallback(() => {
    void finishPlansTour();
  }, [finishPlansTour]);

  const handlePlansTourCallback = useCallback(
    (data: CallBackProps) => {
      const { status, action } = data;
      if (status === STATUS.FINISHED) {
        void finishPlansTour();
        return;
      }
      if (status === STATUS.SKIPPED || action === ACTIONS.CLOSE) {
        void finishPlansTour();
      }
    },
    [finishPlansTour],
  );

  // ── Task #1696 — Bid Plans tour controls ─────────────────────────────
  // Same looping-tour fix: the in-memory `bidPlansTourDismissedSession`
  // backstop lives on the provider so a BidPlansTab unmount/remount
  // can't slip past the dismissal between the localStorage write and
  // the next render. The localStorage write itself is already
  // synchronous, so cross-session persistence is unaffected.
  const [bidPlansTourDismissedSession, setBidPlansTourDismissedSession] = useState(false);
  // Same account-switch reset as the project plans dismissal above —
  // user B should never inherit user A's in-memory bid-tour dismissal.
  useEffect(() => {
    setBidPlansTourDismissedSession(false);
  }, [user?.id]);
  const startBidPlansTour = useCallback(() => {
    setBidPlansTourDismissedSession(false);
    setIsBidPlansTourActive(true);
  }, []);

  const dismissBidPlansTour = useCallback(() => {
    setIsBidPlansTourActive(false);
    setBidPlansTourCompleted(user?.id, true);
    setBidPlansTourCompletedState(true);
    setBidPlansTourDismissedSession(true);
  }, [user?.id]);

  const skipBidPlansTour = useCallback(() => {
    dismissBidPlansTour();
  }, [dismissBidPlansTour]);

  const handleBidPlansTourCallback = useCallback(
    (data: CallBackProps) => {
      const { status, action } = data;
      if (status === STATUS.FINISHED) {
        dismissBidPlansTour();
        return;
      }
      if (status === STATUS.SKIPPED || action === ACTIONS.CLOSE) {
        dismissBidPlansTour();
      }
    },
    [dismissBidPlansTour],
  );

  return (
    <TourContext.Provider value={{
      startTour,
      skipTour,
      isTourActive,
      currentStep,
      currentTourTarget,
      startPlansTour,
      skipPlansTour,
      isPlansTourActive,
      // Looping-tour fix — surface the in-memory session dismissal AND the
      // synchronous localStorage backstop too so child components like
      // <PlansTab> see the close synchronously and their auto-trigger
      // effect cannot re-fire on remount before the /api/auth/me refetch
      // lands. The localStorage read also covers the hard-reload case
      // where the user dismissed but the server PATCH was still in flight
      // when they refreshed: the legacy key is hydrated synchronously
      // here while the existing migration effect promotes it back to the
      // server in the background.
      isPlansTourCompleted:
        plansTourCompleted ||
        plansTourDismissedSession ||
        readLegacyPlansTourCompleted(user?.id),
      startBidPlansTour,
      skipBidPlansTour,
      isBidPlansTourActive,
      isBidPlansTourCompleted: bidPlansTourCompleted || bidPlansTourDismissedSession,
    }}>
      {children}
      
      {isTourActive && tourSteps.length > 0 && (
        <Joyride
          steps={tourSteps}
          stepIndex={currentStep}
          run={isTourActive && targetReady}
          continuous
          showProgress
          showSkipButton
          hideCloseButton={false}
          scrollToFirstStep
          disableOverlayClose
          spotlightClicks={false}
          callback={handleJoyrideCallback}
          styles={{
            options: {
              primaryColor: "hsl(var(--primary))",
              textColor: "hsl(var(--foreground))",
              backgroundColor: "hsl(var(--card))",
              arrowColor: "hsl(var(--card))",
              overlayColor: "rgba(0, 0, 0, 0.6)",
              zIndex: 10000,
            },
            tooltip: {
              borderRadius: "8px",
              padding: "16px",
            },
            tooltipContainer: {
              textAlign: "left",
            },
            tooltipTitle: {
              fontSize: "18px",
              fontWeight: 600,
              marginBottom: "8px",
            },
            tooltipContent: {
              fontSize: "14px",
            },
            buttonNext: {
              backgroundColor: "hsl(var(--primary))",
              color: "hsl(var(--primary-foreground))",
              borderRadius: "6px",
              padding: "8px 16px",
            },
            buttonBack: {
              color: "hsl(var(--muted-foreground))",
              marginRight: "8px",
            },
            buttonSkip: {
              color: "hsl(var(--muted-foreground))",
            },
            spotlight: {
              borderRadius: "8px",
            },
          }}
          locale={{
            back: "Back",
            close: "Close",
            last: "Finish",
            next: "Next",
            skip: "Skip Tour",
          }}
        />
      )}
      
      {showCompletion && <TourCompletionModal onClose={handleCompletionClose} />}

      {/* Task #1663 — Plans-surface tour. Joyride manages its own step
          state (uncontrolled) since this tour stays on a single page. */}
      {isPlansTourActive && (
        <Joyride
          steps={plansTourSteps}
          run={isPlansTourActive}
          continuous
          showProgress
          showSkipButton
          hideCloseButton={false}
          scrollToFirstStep
          disableOverlayClose
          spotlightClicks={false}
          callback={handlePlansTourCallback}
          styles={{
            options: {
              primaryColor: "hsl(var(--primary))",
              textColor: "hsl(var(--foreground))",
              backgroundColor: "hsl(var(--card))",
              arrowColor: "hsl(var(--card))",
              overlayColor: "rgba(0, 0, 0, 0.5)",
              zIndex: 10000,
            },
            tooltip: { borderRadius: "8px", padding: "16px" },
            tooltipContainer: { textAlign: "left" },
            tooltipTitle: { fontSize: "16px", fontWeight: 600, marginBottom: "8px" },
            tooltipContent: { fontSize: "13px" },
            buttonNext: {
              backgroundColor: "hsl(var(--primary))",
              color: "hsl(var(--primary-foreground))",
              borderRadius: "6px",
              padding: "8px 16px",
            },
            buttonBack: { color: "hsl(var(--muted-foreground))", marginRight: "8px" },
            buttonSkip: { color: "hsl(var(--muted-foreground))" },
            spotlight: { borderRadius: "8px" },
          }}
          locale={{ back: "Back", close: "Close", last: "Got it", next: "Next", skip: "Skip" }}
        />
      )}

      {/* Task #1696 — Bid Plans tour. Mirrors the project plans tour
          configuration (uncontrolled, single-page) with a separate
          completion key so each surface gets its own first-run
          walkthrough. */}
      {isBidPlansTourActive && (
        <Joyride
          steps={bidPlansTourSteps}
          run={isBidPlansTourActive}
          continuous
          showProgress
          showSkipButton
          hideCloseButton={false}
          scrollToFirstStep
          disableOverlayClose
          spotlightClicks={false}
          callback={handleBidPlansTourCallback}
          styles={{
            options: {
              primaryColor: "hsl(var(--primary))",
              textColor: "hsl(var(--foreground))",
              backgroundColor: "hsl(var(--card))",
              arrowColor: "hsl(var(--card))",
              overlayColor: "rgba(0, 0, 0, 0.5)",
              zIndex: 10000,
            },
            tooltip: { borderRadius: "8px", padding: "16px" },
            tooltipContainer: { textAlign: "left" },
            tooltipTitle: { fontSize: "16px", fontWeight: 600, marginBottom: "8px" },
            tooltipContent: { fontSize: "13px" },
            buttonNext: {
              backgroundColor: "hsl(var(--primary))",
              color: "hsl(var(--primary-foreground))",
              borderRadius: "6px",
              padding: "8px 16px",
            },
            buttonBack: { color: "hsl(var(--muted-foreground))", marginRight: "8px" },
            buttonSkip: { color: "hsl(var(--muted-foreground))" },
            spotlight: { borderRadius: "8px" },
          }}
          locale={{ back: "Back", close: "Close", last: "Got it", next: "Next", skip: "Skip" }}
        />
      )}
    </TourContext.Provider>
  );
}
