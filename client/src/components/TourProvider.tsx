import { createContext, useContext, useState, useCallback, useEffect, useRef } from "react";
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
    title: "Vendor Portal",
    content: "Welcome to your vendor portal. Manage your relationship with construction companies using SmartManage.",
    profitabilityTip: "Direct access to your customers streamlines communication.",
    path: "/vendor",
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
    path: "/vendor",
    disableBeacon: true,
  },
  {
    target: '[data-testid="nav-vendor-bid-inbox"]',
    title: "Bid Inbox",
    content: "Receive bid invitations from contractors. Review project details and submit your competitive quotes.",
    profitabilityTip: "More bid opportunities means more business — respond quickly to win.",
    path: "/vendor",
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
  
  return (
    <TourContext.Provider value={{ startTour, skipTour, isTourActive, currentStep, currentTourTarget }}>
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
    </TourContext.Provider>
  );
}
