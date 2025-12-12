import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { 
  ChevronRight, 
  SkipForward, 
  Rocket, 
  Users, 
  Calculator, 
  ClipboardList,
  Target,
  Clock,
  Shield,
  AlertCircle
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/hooks/use-auth";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface WalkthroughStatus {
  walkthroughCompleted: boolean;
  walkthroughStep: number;
  walkthroughStartedAt: string | null;
  totalSteps: number;
  role: string;
  walkthrough: {
    roleName: string;
    welcomeMessage: string;
    completionMessage: string;
    currentStep: any | null;
  } | null;
}

const DISMISSED_KEY = "smartmanage-welcome-dismissed";

const roleFeatures: Record<string, { icon: any; features: string[]; intro: string }> = {
  ADMIN: {
    icon: Shield,
    intro: "As an Administrator, you have full control over the platform. Here's what I'll help you master:",
    features: [
      "Building your team with the right roles and permissions",
      "Setting up your vendor and supplier network",
      "Creating winning bids and estimates",
      "Managing projects from bid to completion",
    ],
  },
  MANAGER: {
    icon: Users,
    intro: "As a Manager, you'll oversee projects and your team. Let me show you the ropes:",
    features: [
      "Reviewing and approving bids from your team",
      "Keeping tabs on all active projects",
      "Handling change orders smoothly",
      "Coordinating with your superintendents and estimators",
    ],
  },
  ESTIMATOR: {
    icon: Calculator,
    intro: "As an Estimator, you're the heart of our bidding process. I'll walk you through:",
    features: [
      "Creating accurate bids with powerful estimating tools",
      "Using AI to analyze bid documents automatically",
      "Pulling vendor pricing right into your estimates",
      "Generating polished, professional quotes",
    ],
  },
  SUPERINTENDENT: {
    icon: ClipboardList,
    intro: "As a Superintendent, you run the field. Here's what you'll learn:",
    features: [
      "Tracking daily progress and activities",
      "Managing your crew's timesheets",
      "Documenting delays and issues properly",
      "Handling T&M work and change orders",
    ],
  },
  OFFICE_MANAGER: {
    icon: Target,
    intro: "As Office Manager, you keep everything running smoothly. Let's cover:",
    features: [
      "Managing billing and keeping invoices organized",
      "Maintaining strong vendor relationships",
      "Streamlining supply ordering",
      "Staying connected with field teams",
    ],
  },
  HOURLY_EMPLOYEE: {
    icon: Clock,
    intro: "Welcome to the team! Here's what you need to know:",
    features: [
      "Clocking in and out — it's super simple",
      "Checking your work schedule anytime",
      "Staying in the loop with your team",
      "Viewing project details when you need them",
    ],
  },
  SUPER_ADMIN: {
    icon: Shield,
    intro: "As a Platform Administrator, you have the keys to the kingdom. Let me show you:",
    features: [
      "Monitoring all organizations on the platform",
      "Viewing analytics and usage insights",
      "Helping users when they need support",
      "Managing platform-wide settings",
    ],
  },
};

export function FirstTimeWelcomeModal() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [location] = useLocation();
  const [showModal, setShowModal] = useState(false);
  const [isExiting, setIsExiting] = useState(false);
  const [hasError, setHasError] = useState(false);

  // Only show the modal on the dashboard, not on onboarding or other pages
  const isOnDashboard = location === '/' || location === '/dashboard';

  const { data: walkthroughStatus, isLoading } = useQuery<WalkthroughStatus>({
    queryKey: ["/api/ai/walkthrough/status"],
    enabled: !!user && isOnDashboard, // Only fetch when on dashboard
    refetchOnWindowFocus: false,
    refetchOnMount: "always", // Always fetch fresh data when modal mounts
    staleTime: 0, // Consider data always stale to ensure fresh fetch
    gcTime: 0, // Don't cache - always fetch fresh
  });

  const hasNotStarted = walkthroughStatus && 
    !walkthroughStatus.walkthroughCompleted && 
    walkthroughStatus.walkthroughStep === 0;

  useEffect(() => {
    // Only show modal on dashboard page
    if (hasNotStarted && user && isOnDashboard) {
      const dismissed = sessionStorage.getItem(DISMISSED_KEY);
      if (!dismissed) {
        // Show immediately - no delay needed, faster UX
        setShowModal(true);
      }
    } else {
      // Hide modal if conditions are no longer met (navigating away from dashboard)
      setShowModal(false);
    }
  }, [hasNotStarted, user, isOnDashboard]);

  const startWalkthroughMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/ai/walkthrough/start");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ai/walkthrough/status"] });
      // Only dismiss after successful start
      sessionStorage.setItem(DISMISSED_KEY, "true");
      handleClose();
      // Dispatch event to open the AI assistant widget
      window.dispatchEvent(new CustomEvent("open-ai-assistant"));
    },
    onError: () => {
      setHasError(true);
      toast({
        title: "Couldn't start the tour",
        description: "Please try again or use the Start Tutorial button in the sidebar.",
        variant: "destructive",
      });
    },
  });

  const skipWalkthroughMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/ai/walkthrough/complete");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ai/walkthrough/status"] });
      sessionStorage.setItem(DISMISSED_KEY, "true");
      handleCloseWithoutDismiss();
    },
    onError: () => {
      // If skip fails, just close the modal locally
      // User can restart from sidebar if needed
      sessionStorage.setItem(DISMISSED_KEY, "true");
      handleCloseWithoutDismiss();
    },
  });

  const handleCloseWithoutDismiss = () => {
    setIsExiting(true);
    setTimeout(() => {
      setShowModal(false);
      setIsExiting(false);
    }, 300);
  };

  const handleClose = () => {
    sessionStorage.setItem(DISMISSED_KEY, "true");
    handleCloseWithoutDismiss();
  };

  const handleSkip = () => {
    // Call the mutation to mark walkthrough as complete on server
    skipWalkthroughMutation.mutate();
  };

  const handleStartTour = () => {
    setHasError(false);
    startWalkthroughMutation.mutate();
    // Don't set DISMISSED_KEY here - only set it on success
  };

  if (!showModal || !user || isLoading) return null;

  const roleConfig = roleFeatures[user.role] || roleFeatures.ADMIN;
  const RoleIcon = roleConfig.icon;
  const roleName = walkthroughStatus?.walkthrough?.roleName || user.role;
  const totalSteps = walkthroughStatus?.totalSteps || 0;
  
  // Extract first name for personal greeting
  const firstName = user.firstName || 'there';

  return (
    <div 
      className={`fixed inset-0 flex items-center justify-center p-4 transition-all duration-300 ${
        isExiting ? "opacity-0" : "opacity-100"
      }`}
      style={{ zIndex: 99999, backgroundColor: "rgba(0, 0, 0, 0.85)" }}
      data-testid="first-time-welcome-modal"
    >
      <div 
        className={`relative w-full max-w-2xl bg-card border-2 border-primary/30 rounded-2xl shadow-2xl overflow-hidden transition-all duration-300 ${
          isExiting ? "scale-95 opacity-0" : "scale-100 opacity-100"
        }`}
      >
        <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-purple-500/5 pointer-events-none" />
        
        <div className="relative p-8">
          <div className="flex justify-center mb-6">
            <div className="relative">
              <div className="absolute inset-0 blur-2xl bg-primary/30 rounded-full" />
              <div className="relative p-5 rounded-full bg-gradient-to-br from-primary to-purple-600 shadow-lg">
                <Rocket className="h-10 w-10 text-white" />
              </div>
            </div>
          </div>

          <div className="text-center mb-8">
            <Badge variant="secondary" className="mb-4 px-4 py-1 text-sm">
              <RoleIcon className="h-3.5 w-3.5 mr-1.5" />
              {roleName}
            </Badge>
            <h1 className="text-3xl font-bold mb-3">
              Hey {firstName}, welcome aboard!
            </h1>
            <p className="text-lg text-muted-foreground max-w-md mx-auto">
              I'm your AI assistant and I'll be guiding you through SmartManageAI. 
              Let me show you around — you'll be up and running in no time!
            </p>
          </div>

          <div className="bg-muted/50 rounded-xl p-5 mb-8">
            <p className="text-sm text-muted-foreground mb-4">
              {roleConfig.intro}
            </p>
            <ul className="space-y-2.5">
              {roleConfig.features.map((feature, idx) => (
                <li key={idx} className="flex items-start gap-3 text-sm">
                  <div className="mt-1 h-5 w-5 rounded-full bg-primary/20 flex items-center justify-center shrink-0">
                    <span className="text-xs font-semibold text-primary">{idx + 1}</span>
                  </div>
                  <span className="text-muted-foreground">{feature}</span>
                </li>
              ))}
            </ul>
            <p className="text-xs text-muted-foreground/70 mt-4 italic">
              {totalSteps} quick steps · About 5 minutes
            </p>
          </div>

          <div className="flex flex-col gap-3">
            {hasError && (
              <div className="flex items-center gap-2 p-3 rounded-lg bg-destructive/10 text-destructive text-sm">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>Something went wrong. Please try again.</span>
              </div>
            )}
            
            <Button 
              size="lg"
              className="w-full h-14 text-lg font-semibold bg-gradient-to-r from-primary to-purple-600 hover:from-primary/90 hover:to-purple-600/90 shadow-lg"
              onClick={handleStartTour}
              disabled={startWalkthroughMutation.isPending}
              data-testid="button-start-tour-modal"
            >
              {startWalkthroughMutation.isPending ? (
                <>
                  <div className="h-5 w-5 border-2 border-white/30 border-t-white rounded-full animate-spin mr-3" />
                  Starting...
                </>
              ) : hasError ? (
                <>
                  <Rocket className="h-5 w-5 mr-3" />
                  Try Again
                  <ChevronRight className="h-5 w-5 ml-2" />
                </>
              ) : (
                <>
                  <Rocket className="h-5 w-5 mr-3" />
                  Start Guided Tour
                  <ChevronRight className="h-5 w-5 ml-2" />
                </>
              )}
            </Button>
            
            <Button 
              variant="ghost"
              className="w-full text-muted-foreground hover:text-foreground"
              onClick={handleSkip}
              disabled={skipWalkthroughMutation.isPending}
              data-testid="button-skip-tour-modal"
            >
              <SkipForward className="h-4 w-4 mr-2" />
              Skip for now (you can start the tour anytime from the sidebar)
            </Button>
          </div>

          <p className="text-center text-xs text-muted-foreground mt-6">
            Feel free to ask me questions anytime during the tour!
          </p>
        </div>
      </div>
    </div>
  );
}
